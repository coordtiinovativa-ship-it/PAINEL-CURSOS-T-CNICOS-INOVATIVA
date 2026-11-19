import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { criarAmbiente } from './ambiente';
import { jsonCanonico } from '../src/certificado/snapshot';
import { hashTexto, type SnapshotDocumento } from '../src/documentos/emissao';
import { CATALOGO } from '../src/documentos/catalogo';

const SIG = `UPDATE signatarios SET nome = 'Maria Diretora' WHERE id = 1; UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`;
const PERFIL = `UPDATE modulos_tematicos SET perfil_profissional = 'Atua na inspeção da qualidade.', competencias = 'Aplicar ferramentas da qualidade' WHERE id = 1;`;
const BASE = '/admin/secretaria/documentos';
const ATO = 'Deliberação CEE/MS nº 13.111, de 18 de dezembro de 2024';

async function pronto(perfil = 'secretaria', extraSql = '') {
  const amb = await criarAmbiente({ ficticios: true });
  amb.sqlite.exec(SIG + extraSql);
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  /** POST com campos repetidos (caixas de seleção) */
  const enviar = (caminho: string, campos: [string, string][]) => {
    const corpo = new URLSearchParams();
    for (const [k, v] of campos) corpo.append(k, v);
    return c.req(caminho, { method: 'POST', body: corpo, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  };
  return { ...amb, c, enviar };
}
const docs = (sqlite: any) => sqlite.prepare('SELECT * FROM documentos ORDER BY id').all() as any[];
const texto = async (r: Response) => r.text();

describe('central e menu', () => {
  it('a central lista todos os documentos do catálogo e o menu traz o painel lateral', async () => {
    const { c } = await pronto();
    const central = await texto(await c.req(BASE));
    for (const i of CATALOGO) expect(central).toContain(i.rotulo);
    const inicio = await texto(await c.req('/admin'));
    expect(inicio).toContain('class="voo"');
    expect(inicio).not.toContain('painel-voo');
    expect(inicio).toContain(`${BASE}/guia_transferencia`);
    expect(inicio).toContain('Controle de Faltas');
    expect(inicio).toContain('Documentos Emitidos');
  });

  it('declaração/histórico por módulo: a tela leva à emissão já existente', async () => {
    const { c } = await pronto();
    const r = await c.req(`${BASE}/historico_escolar?turma=1&aluno=1&modulo=1&abrir=1`);
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('/admin/documentos/historico_escolar/1/1');
  });
});

describe('requerimentos (formulários)', () => {
  it('aproveitamento de estudos: preenchido com o cadastro, PDF sem registro e com auditoria', async () => {
    const { c, sqlite, auditoria } = await pronto();
    const q = 'aluno=1&forma=analise&origem=Curso+T%C3%A9cnico+em+Administra%C3%A7%C3%A3o';
    const tela = await texto(await c.req(`${BASE}/requerimento_aproveitamento_estudos?${q}`));
    expect(tela).toContain('Formulário pronto para imprimir');
    const previa = await texto(await c.req(`${BASE}/requerimento_aproveitamento_estudos/previa?${q}`));
    expect(previa).toContain('REQUERIMENTO DE APROVEITAMENTO DE ESTUDOS');
    expect(previa).toContain('Eu, ANA BEATRIZ FICTÍCIA SOUZA, venho requerer');
    expect(previa).toContain('análise documental ( X ) avaliação (    )'); // espaços não separáveis
    expect(previa).toContain('concluídos com êxito no Curso Técnico em Administração');
    expect(previa).toContain('Curso Técnico em Inovação e Desenvolvimento Corporativo – Eixo Tecnológico: Gestão e Negócios – Área Tecnológica: Gerencial');
    expect(previa).toContain(ATO);
    expect(previa).toContain('não possui código de validação');
    expect(previa).not.toContain('PRÉVIA — SEM VALIDADE');
    const pdf = await c.req(`${BASE}/requerimento_aproveitamento_estudos/previa.pdf?${q}`);
    expect(pdf.headers.get('Content-Type')).toBe('application/pdf');
    expect((await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()))).getPageCount()).toBe(1);
    expect(auditoria().at(-1)).toMatchObject({ acao: 'gerar_formulario', entidade: 'aluno', entidade_id: 1 });
    expect(docs(sqlite)).toHaveLength(0);
    // formulário não é registrado
    expect((await c.post(`${BASE}/requerimento_aproveitamento_estudos`, { aluno: '1' })).status).toBe(404);
  }, 30_000);

  it('matrícula: ficha com os dados do aluno e o módulo em andamento da turma', async () => {
    const { c } = await pronto('secretaria', `UPDATE alunos SET endereco = 'Rua A, 10', bairro = 'Centro', cep = '79000-000', necessidades_especificas = 'Baixa visão' WHERE id = 1;`);
    const previa = await texto(await c.req(`${BASE}/requerimento_matricula/previa?aluno=1&turma=1`));
    expect(previa).toContain('REQUERIMENTO DE MATRÍCULA');
    expect(previa).toContain('Rua A, 10, Centro');
    expect(previa).toContain('( X ) SIM  Qual: Baixa visão');
    expect(previa).toContain('matrícula no módulo temático EMPREENDEDORISMO');
    expect(previa).toContain('____ de ______________ de ______'); // data em branco
  });

  it('sem aluno escolhido, pede o aluno e não mostra prévia', async () => {
    const { c } = await pronto();
    const tela = await texto(await c.req(`${BASE}/requerimento_matricula`));
    expect(tela).toContain('Selecione o aluno para ver o documento');
    expect(tela).not.toContain('<iframe');
  });
});

describe('portarias de aproveitamento', () => {
  const campos = (numero: string): [string, string][] => [
    ['aluno', '1'], ['numero', numero], ['data_emissao', '2026-11-19'], ['modulos', '1'],
    ['origem_curso', 'Curso Técnico em Qualidade'], ['origem_instituicao', 'Escola Técnica Exemplo'], ['modulo', '2'],
  ];

  it('sugere o nº, bloqueia sem dados, registra com QR, nº único e cita no histórico', async () => {
    const { c, sqlite, enviar, auditoria } = await pronto('secretaria', PERFIL);
    const tela = await texto(await c.req(`${BASE}/portaria_aproveitamento_modulos?aluno=1&data_emissao=2026-11-19`));
    expect(tela).toContain('value="001/2026"');
    expect(tela).toContain('Marque o(s) módulo(s) aproveitado(s)');

    let r = await enviar(`${BASE}/portaria_aproveitamento_modulos`, [['aluno', '1'], ['numero', '001/2026'], ['data_emissao', '2026-11-19']]);
    expect(r.status).toBe(400);
    expect(docs(sqlite)).toHaveLength(0);

    const previa = await texto(await c.req(`${BASE}/portaria_aproveitamento_modulos/previa?aluno=1&numero=001%2F2026&data_emissao=2026-11-19&modulos=1&origem_curso=Curso+T%C3%A9cnico+em+Qualidade&origem_instituicao=Escola+T%C3%A9cnica+Exemplo&modulo=2`));
    expect(previa).toContain('PORTARIA Nº 001/2026');
    expect(previa).toContain('Aproveitar os estudos de ANA BEATRIZ FICTÍCIA SOUZA, realizados com êxito no(s) módulo(s) Qualidade');
    expect(previa).toContain('na instituição de ensino denominada Escola Técnica Exemplo');
    expect(previa).toContain('para o módulo EMPREENDEDORISMO do Curso Técnico em Inovação');
    expect(previa).toContain(`Projeto Pedagógico do Curso aprovado pela ${ATO}`);

    r = await enviar(`${BASE}/portaria_aproveitamento_modulos`, campos('001/2026'));
    expect(r.status).toBe(302);
    const [d] = docs(sqlite);
    expect(d).toMatchObject({ tipo: 'portaria_aproveitamento_modulos', numero: '001/2026', aluno_id: 1, matricula_id: 1, curso_id: 1, modulo_id: 2, codigo_validacao: 'INV-2026-00001' });
    const snap = JSON.parse(d.snapshot_json) as SnapshotDocumento;
    expect(await hashTexto(jsonCanonico(snap))).toBe(d.hash_sha256);
    expect(snap.resumo.registro).toBe('Portaria nº 001/2026, de 19/11/2026: aproveitamento de estudos — módulo(s) Qualidade');
    expect(auditoria().at(-1)).toMatchObject({ acao: 'emitir', entidade: 'documento' });

    // nº repetido é recusado (e o código INV não é consumido)
    r = await enviar(`${BASE}/portaria_aproveitamento_modulos`, campos('001/2026'));
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('já foi usado na portaria INV-2026-00001');
    expect(docs(sqlite)).toHaveLength(1);
    expect(await texto(await c.req(`${BASE}/portaria_aproveitamento_modulos?aluno=1&data_emissao=2026-11-19`))).toContain('value="002/2026"');

    // validação pública
    const pub = await texto(await c.req(`/v/${d.codigo_validacao}`));
    expect(pub).toContain('Portaria de Aproveitamento de Estudos (Módulos) válida');
    expect(pub).toContain('nº 001/2026');
    expect(pub).toContain('***.222.333-**');

    // o histórico da qualificação cita a portaria em "Registro de Aproveitamento de Estudos"
    const hist = await texto(await c.req('/admin/documentos/historico_escolar/1/1/previa'));
    expect(hist).toContain('Registro de Aproveitamento de Estudos: Portaria nº 001/2026, de 19/11/2026');
  }, 30_000);

  it('disciplinas e conhecimentos: textos do modelo', async () => {
    const { c } = await pronto();
    const disc = await texto(await c.req(`${BASE}/portaria_aproveitamento_disciplinas/previa?aluno=2&numero=005%2F2026&disciplinas=1&disciplinas=2&origem_curso=Curso+X&origem_instituicao=Escola+Y&modulo=1`));
    expect(disc).toContain('referentes às disciplinas Atendimento a Clientes e Fornecedores e Introdução a Gestão da Qualidade');
    expect(disc).toContain('dispensando-o de cursar as disciplinas constantes do Art. 1º');
    const con = await texto(await c.req(`${BASE}/portaria_aproveitamento_conhecimentos/previa?aluno=2&numero=006%2F2026&origem=exerc%C3%ADcio+profissional`));
    expect(con).toContain('Aproveitar os conhecimentos e experiências adquiridos por JOÃO PEDRO FICTÍCIO LIMA no exercício profissional');
    expect(con).toContain('Art. 4º Esta Portaria entrará em vigor na data de sua aprovação.');
  });
});

describe('guia de transferência', () => {
  it('bloqueada enquanto a matrícula não está como Transferido; depois emite com módulo em curso e verso', async () => {
    const { c, sqlite, env } = await pronto();
    let tela = await texto(await c.req(`${BASE}/guia_transferencia?turma=1&aluno=1`));
    expect(tela).toContain('altere o status para Transferido');
    expect((await c.post(`${BASE}/guia_transferencia`, { turma: '1', aluno: '1', data_emissao: '2026-11-19' })).status).toBe(400);

    sqlite.exec(`UPDATE matriculas SET status = 'transferido' WHERE id = 1;
      INSERT INTO matricula_status_historico (matricula_id, status_anterior, status_novo, data, motivo, usuario)
      VALUES (1, 'ativa', 'transferido', '2026-09-10', 'Mudança de cidade', 'u@iect.test');
      UPDATE resultados SET faltas = 2 WHERE matricula_id = 1 AND componente_id = 1;`);
    sqlite.exec(`INSERT INTO resultados (matricula_id, componente_id, nota, frequencia, faltas) VALUES (1, 7, 7.5, 90, 4);`);
    tela = await texto(await c.req(`${BASE}/guia_transferencia?turma=1&aluno=1`));
    expect(tela).toContain('pronto para emitir');
    const previa = await texto(await c.req(`${BASE}/guia_transferencia/previa?turma=1&aluno=1`));
    expect(previa).toContain('GUIA DE TRANSFERÊNCIA');
    expect(previa).toContain('em 10/09/2026 foi considerado(a) TRANSFERIDO(A) cursando o Módulo 2 — Empreendedorismo');
    expect(previa).toContain('DADOS PARCIAIS PARA FINS DE TRANSFERÊNCIA DO MÓDULO TEMÁTICO 2 — EMPREENDEDORISMO EM CURSO');
    expect(previa).toContain('OBS: Mudança de cidade');
    expect(previa).toContain('TOTAL DA CARGA HORÁRIA DO CURSO TÉCNICO EM INOVAÇÃO E DESENVOLVIMENTO CORPORATIVO');
    expect(previa).toContain('1300');

    const r = await c.post(`${BASE}/guia_transferencia`, { turma: '1', aluno: '1', data_emissao: '2026-11-19' });
    expect(r.status).toBe(302);
    const [d] = docs(sqlite);
    expect(d).toMatchObject({ tipo: 'guia_transferencia', matricula_id: 1, modulo_id: 2, numero: null });
    const pdf = await PDFDocument.load(new Uint8Array(await (await env.ARQUIVOS.get(d.pdf_r2_key))!.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(2);
    expect(await texto(await c.req('/admin/documentos'))).toContain('Guia de Transferência');
  }, 30_000);

  it('exige a turma (matrícula)', async () => {
    const { c } = await pronto();
    const tela = await texto(await c.req(`${BASE}/guia_transferencia?aluno=1`));
    expect(tela).toContain('Selecione a turma do aluno');
  });
});

describe('histórico escolar do curso técnico', () => {
  it('mostra todos os módulos e o TCC; bloqueia enquanto faltam resultados', async () => {
    const { c } = await pronto();
    const tela = await texto(await c.req(`${BASE}/historico_curso_tecnico?turma=1&aluno=1`));
    expect(tela).toContain('Módulo 2 — Empreendedorismo: resultados incompletos');
    expect(tela).toContain('Trabalho de Conclusão de Curso: resultado não lançado');
    const previa = await texto(await c.req(`${BASE}/historico_curso_tecnico/previa?turma=1&aluno=1`));
    expect(previa).toContain('HISTÓRICO ESCOLAR');
    expect(previa).toContain('CARGA HORÁRIA DA QUALIFICAÇÃO PROFISSIONAL TÉCNICA EM INSPETOR DE QUALIDADE');
    expect(previa).toContain('CARGA HORÁRIA DA QUALIFICAÇÃO PROFISSIONAL TÉCNICA EM TRABALHADOR EM AMBIENTE ORGANIZACIONAL');
    expect(previa).toContain('Trabalho de Conclusão de Curso');
    expect(previa).toContain('1300');
    expect((await c.post(`${BASE}/historico_curso_tecnico`, { turma: '1', aluno: '1', data_emissao: '2026-11-19' })).status).toBe(400);
    // anverso (todos os módulos + TCC) e verso: 2 páginas, como o modelo
    const pdf = await c.req(`${BASE}/historico_curso_tecnico/previa.pdf?turma=1&aluno=1`);
    expect((await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()))).getPageCount()).toBe(2);
  });
});

describe('migração 0019', () => {
  it('documentos ficam ligados ao aluno; nº de portaria é único; nunca se apagam', async () => {
    const { sqlite } = await pronto();
    const ins = (cod: string, numero: string | null, tipo = 'portaria_aproveitamento_modulos') => sqlite.prepare(
      `INSERT INTO documentos (tipo, codigo_validacao, token, aluno_id, numero, data_emissao, hash_sha256, pdf_r2_key, snapshot_json, emitido_por)
       VALUES (?, ?, ?, 1, ?, '2026-11-19', 'h', 'k', '{}', 'x')`).run(tipo, cod, cod, numero);
    ins('INV-2026-00010', '010/2026');
    expect(() => ins('INV-2026-00011', '010/2026')).toThrow();
    expect(() => ins('INV-2026-00012', null)).toThrow(); // portaria sem nº
    expect(() => ins('INV-2026-00013', null, 'tipo_inexistente')).toThrow();
    expect(() => sqlite.exec(`DELETE FROM documentos`)).toThrow(/não podem ser apagados/);
    expect(() => sqlite.exec(`UPDATE documentos SET numero = '099/2026'`)).toThrow(/imutáveis/);
  });
});
