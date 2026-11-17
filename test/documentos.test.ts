import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { criarAmbiente } from './ambiente';
import { jsonCanonico } from '../src/certificado/snapshot';
import { hashTexto, type SnapshotDocumento } from '../src/documentos/emissao';
import { gerarPdfDocumento } from '../src/documentos/pdf';
import type { DocumentoLayout } from '../src/documentos/tipos';

const RAIZ = join(import.meta.dirname, '..');
const SIG = `UPDATE signatarios SET nome = 'Maria Diretora' WHERE id = 1; UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`;
const PERFIL = `UPDATE modulos_tematicos SET perfil_profissional = 'Atua na inspeção da qualidade de processos e produtos.',
  competencias = 'Aplicar ferramentas da qualidade' || char(10) || 'Atender clientes e fornecedores' WHERE id = 1;`;
const DECL = '/admin/documentos/declaracao_conclusao_modulo';
const HIST = '/admin/documentos/historico_escolar';

async function pronto(perfil = 'secretaria', extraSql = '') {
  const amb = await criarAmbiente({ ficticios: true });
  amb.sqlite.exec(SIG + extraSql);
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  return { ...amb, c };
}

const docs = (sqlite: any) => sqlite.prepare('SELECT * FROM documentos ORDER BY id').all() as any[];

describe('declaração de conclusão de módulo', () => {
  it('secretaria emite: código, PDF A4 retrato no R2, snapshot com hash e auditoria', async () => {
    const { c, sqlite, env, auditoria } = await pronto();
    const tela = await (await c.req(`${DECL}/1/1`)).text();
    expect(tela).toContain('pronto para emitir');
    const previa = await (await c.req(`${DECL}/1/1/previa`)).text();
    expect(previa).toContain('DECLARAÇÃO DE CONCLUSÃO DE MÓDULO');
    expect(previa).toContain('ANA BEATRIZ FICTÍCIA SOUZA');
    expect(previa).toContain('111.222.333-96');
    expect(previa).toContain('QUALIFICAÇÃO PROFISSIONAL TÉCNICA de INSPETOR DE QUALIDADE');
    expect(previa).toContain('encontra-se em fase de expedição e registro');

    const r = await c.post(`${DECL}/1/1`, { data_emissao: '2026-12-05' });
    expect(r.status).toBe(302);
    const [d] = docs(sqlite);
    expect(d).toMatchObject({ tipo: 'declaracao_conclusao_modulo', codigo_validacao: 'INV-2026-00001', emitido_por: 'u@iect.test', status: 'válido' });
    const snap = JSON.parse(d.snapshot_json) as SnapshotDocumento;
    expect(await hashTexto(jsonCanonico(snap))).toBe(d.hash_sha256);
    expect(snap.layout.validacao.url).toBe(`https://certificadostecnicos.institutoinovativa.org/v/INV-2026-00001?t=${d.token}`);
    const obj = await env.ARQUIVOS.get(d.pdf_r2_key);
    const pdf = await PDFDocument.load(new Uint8Array(await obj!.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(1);
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(595); // A4 retrato
    expect(Math.round(pdf.getPage(0).getHeight())).toBe(842);
    expect(auditoria().at(-1)).toMatchObject({ acao: 'emitir', entidade: 'documento' });
  }, 30_000);

  it('bloqueia aluno não aprovado no módulo', async () => {
    const { c, sqlite } = await pronto();
    const r = await c.post(`${DECL}/3/1`, { data_emissao: '2026-12-05' });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('Aluno não aprovado no módulo');
    expect(docs(sqlite)).toHaveLength(0);
  });

  it('depois do certificado emitido, cita o registro; códigos seguem a mesma sequência', async () => {
    const { c, sqlite } = await pronto();
    await c.post('/admin/certificados/emitir/1/1', {
      data_emissao: '2026-12-05', registro_numero: '7', folha: '2', livro: '1', data_registro: '2026-12-05', sistec_codigo: 'S-1', sistec_data: '2026-12-04',
    });
    const previa = await (await c.req(`${DECL}/1/1/previa`)).text();
    expect(previa).toContain('registrado sob o nº 7, folha 2, livro 1');
    await c.post(`${DECL}/1/1`, { data_emissao: '2026-12-05' });
    expect(docs(sqlite)[0].codigo_validacao).toBe('INV-2026-00002'); // 00001 é o certificado
  }, 30_000);

  it('texto da declaração é editável, rejeita variável desconhecida e pode ser restaurado', async () => {
    const { c, sqlite, auditoria } = await pronto('administrador');
    let r = await c.post('/admin/modelo/texto-declaracao', { texto: 'Declaramos que {nome} concluiu o módulo {modulo} com {nota_secreta} pontos, para os fins.' });
    expect(decodeURIComponent(r.headers.get('Location')!)).toContain('Variáveis desconhecidas no texto: {nota_secreta}');
    r = await c.post('/admin/modelo/texto-declaracao', { texto: 'Declaramos, para os devidos fins, que {nome} concluiu o módulo {modulo} na turma {turma}.' });
    expect(decodeURIComponent(r.headers.get('Location')!)).toContain('Texto da declaração salvo');
    expect(await (await c.req(`${DECL}/1/1/previa`)).text()).toContain('que ANA BEATRIZ FICTÍCIA SOUZA concluiu o módulo QUALIDADE na turma TIDC-2026-1.');
    const versoes = sqlite.prepare(`SELECT ativo FROM modelos_texto WHERE documento = 'declaracao_conclusao_modulo' ORDER BY id`).all().map((x: any) => x.ativo);
    expect(versoes).toEqual([0, 1]); // versão anterior guardada
    await c.post('/admin/modelo/texto-declaracao', { restaurar: '1' });
    expect(await (await c.req(`${DECL}/1/1/previa`)).text()).toContain('inscrito(a) no CPF');
    expect(auditoria().map((a) => a.acao)).toEqual(expect.arrayContaining(['atualizar_texto', 'restaurar_texto']));
  }, 30_000);
});

describe('histórico escolar', () => {
  it('continua em 2 páginas com várias linhas de atos no cabeçalho (instituição + 3 do curso)', async () => {
    const tres = `UPDATE cursos SET texto_autorizacao = 'Curso Técnico em Inovação e Desenvolvimento Corporativo: Deliberação CEE/MS n. 13111, de 18/12/2024'
      || char(10) || 'Reconhecimento: Deliberação CEE/MS n. 99999, de 01/12/2026' || char(10) || 'Renovação de reconhecimento: Deliberação CEE/MS n. 99998, de 01/12/2029';`;
    const { c, sqlite, env } = await pronto('coordenador', PERFIL + tres);
    expect((await c.post(`${HIST}/1/1`, { data_emissao: '2026-12-05' })).status).toBe(302);
    const [d] = docs(sqlite);
    expect(JSON.parse(d.snapshot_json).layout.instituicao.atos).toHaveLength(5);
    const pdf = await PDFDocument.load(new Uint8Array(await (await env.ARQUIVOS.get(d.pdf_r2_key))!.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(2);
  }, 30_000);

  it('bloqueia enquanto o módulo não tem perfil e competências', async () => {
    const { c } = await pronto();
    const tela = await (await c.req(`${HIST}/1/1`)).text();
    expect(tela).toContain('perfil profissional de conclusão não cadastrado');
    expect(tela).toContain('competências não cadastradas');
    expect((await c.post(`${HIST}/1/1`, { data_emissao: '2026-12-05' })).status).toBe(400);
  });

  it('com perfil/competências: anverso com notas e frequência, verso com competências; 2 páginas', async () => {
    const { c, sqlite, env } = await pronto('coordenador', PERFIL);
    const previa = await (await c.req(`${HIST}/1/1/previa`)).text();
    expect(previa).toContain('HISTÓRICO ESCOLAR');
    expect(previa).toContain('Atendimento a Clientes e Fornecedores');
    expect(previa).toContain('8,5'); // média da 1ª disciplina
    expect(previa).toContain('Carga horária total do módulo');
    expect(previa).toContain('400');
    expect(previa).toContain('APROVADO(A)');
    expect(previa).toContain('Aplicar ferramentas da qualidade');
    expect(previa).toContain('Escola Estadual Exemplo');
    expect((await c.post(`${HIST}/1/1`, { data_emissao: '2026-12-05' })).status).toBe(302);
    const [d] = docs(sqlite);
    const pdf = await PDFDocument.load(new Uint8Array(await (await env.ARQUIVOS.get(d.pdf_r2_key))!.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(2);
  }, 30_000);

  it('histórico de aluno reprovado pode ser emitido e mostra RP', async () => {
    const { c } = await pronto('secretaria', PERFIL);
    const previa = await (await c.req(`${HIST}/3/1/previa`)).text();
    expect(previa).toContain('REPROVADO(A)');
    expect((await c.post(`${HIST}/3/1`, { data_emissao: '2026-12-05' })).status).toBe(302);
  }, 30_000);

  it('perfil e competências são editados em Cursos (com auditoria)', async () => {
    const { c, sqlite, auditoria } = await pronto('administrador');
    const r = await c.post('/admin/cursos/1/modulos/2', {
      qualificacao_conferida: 'Empreendedor Corporativo', perfil_profissional: 'Perfil do empreendedor.', competencias: '- Elaborar plano de negócios\n\n• Avaliar mercado\n',
    });
    expect(r.status).toBe(302);
    expect(sqlite.prepare('SELECT competencias FROM modulos_tematicos WHERE id = 2').get()).toEqual({ competencias: 'Elaborar plano de negócios\nAvaliar mercado' });
    expect(auditoria().at(-1)).toMatchObject({ acao: 'atualizar', entidade: 'modulo_tematico' });
    expect((await c.req('/admin/cursos/1/modulos')).status).toBe(200);
  });
});

describe('validação pública de documentos', () => {
  it('mostra o documento com CPF mascarado e libera o PDF só com a chave do QR', async () => {
    const { c, sqlite } = await pronto();
    await c.post(`${DECL}/1/1`, { data_emissao: '2026-12-05' });
    const d = docs(sqlite)[0];
    const html = await (await c.req(`/v/${d.codigo_validacao}`)).text();
    expect(html).toContain('Declaração de conclusão de módulo válida');
    expect(html).toContain('***.222.333-**');
    expect(html).not.toContain('1234567');
    expect(html).not.toContain('/pdf?t=');
    const comQr = await (await c.req(`/v/${d.codigo_validacao}?t=${d.token}`)).text();
    expect(comQr).toContain(`/v/${d.codigo_validacao}/pdf?t=${d.token}`);
    expect((await c.req(`/v/${d.codigo_validacao}/pdf`)).status).toBe(404);
    expect((await c.req(`/v/${d.codigo_validacao}/pdf?t=${d.token}`)).headers.get('Content-Type')).toBe('application/pdf');
  }, 30_000);

  it('documento emitido não pode ser apagado nem alterado', async () => {
    const { c, sqlite } = await pronto();
    await c.post(`${DECL}/1/1`, { data_emissao: '2026-12-05' });
    expect(() => sqlite.exec('DELETE FROM documentos')).toThrow(/revogação/);
    expect(() => sqlite.exec(`UPDATE documentos SET snapshot_json = '{}'`)).toThrow(/imutáveis/);
  }, 30_000);
});

describe('motor de documentos', () => {
  it('tabela longa quebra em várias páginas repetindo o cabeçalho', async () => {
    const layout: DocumentoLayout = {
      versao: 1,
      titulo: 'Teste',
      instituicao: { nome: 'INSTITUTO', enderecoLinha: 'Rua X', credenciamento: 'Cred.', logo_r2_key: null },
      validacao: { codigo: null, url: null },
      paginas: [{ blocos: [{ tipo: 'tabela', colunas: [{ titulo: 'Nº', largura: 1 }, { titulo: 'Nome', largura: 5 }], linhas: Array.from({ length: 120 }, (_, i) => [String(i + 1), `Aluno ${i + 1}`]) }] }],
    };
    const ler = (f: string) => new Uint8Array(readFileSync(join(RAIZ, 'public', f)));
    const bytes = await gerarPdfDocumento(layout, {
      fonteRegular: ler('fontes/Arimo-Regular.ttf'), fonteNegrito: ler('fontes/Arimo-Bold.ttf'), logo: ler('modelo/logo.png'), assinaturas: {},
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
  }, 30_000);
});

describe('prévia a partir da tela Declarações e históricos', () => {
  it('escolhe turma, aluno, módulo e documento; abre prévia em tela, PDF de prévia ou a emissão', async () => {
    const { c } = await pronto();
    const lista = await (await c.req('/admin/documentos')).text();
    expect(lista).toContain('Prévia e emissão');
    expect(lista).toContain('Selecione a turma');
    expect(lista).toContain('TIDC-2026-1');

    const comTurma = await (await c.req('/admin/documentos?turma=1')).text();
    expect(comTurma).toContain('action="/admin/documentos/abrir"');
    expect(comTurma).toContain('Ana Beatriz Fictícia Souza');
    expect(comTurma).toMatch(/Módulo 1: Qualidade — concluído/);
    expect(comTurma).toContain('Histórico escolar');

    const ir = async (ver: string) => (await c.req(`/admin/documentos/abrir?mat=1&mod=1&tipo=declaracao_conclusao_modulo&ver=${ver}`)).headers.get('Location');
    expect(await ir('tela')).toBe(`${DECL}/1/1/previa`);
    expect(await ir('pdf')).toBe(`${DECL}/1/1/previa.pdf`);
    expect(await ir('emitir')).toBe(`${DECL}/1/1`);
    // a prévia aberta por esse caminho funciona
    expect(await (await c.req(`${DECL}/1/1/previa`)).text()).toContain('DECLARAÇÃO DE CONCLUSÃO DE MÓDULO');
    // parâmetros inválidos voltam para a lista
    expect((await c.req('/admin/documentos/abrir?mat=1&mod=1&tipo=outro')).headers.get('Location')).toBe('/admin/documentos');
  });
});
