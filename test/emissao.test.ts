import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { criarAmbiente } from './ambiente';
import { hashSnapshot, jsonCanonico, type SnapshotCertificado } from '../src/certificado/snapshot';

const SIG = `UPDATE signatarios SET nome = 'Maria Diretora' WHERE id = 1; UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`;

const camposEmissao = (extra: Record<string, string> = {}) => ({
  data_emissao: '2026-12-05', registro_numero: '1', folha: '1', livro: '1', data_registro: '2026-12-05',
  sistec_codigo: 'SISTEC-ABC-123', sistec_data: '2026-12-04', ...extra,
});

async function prontoParaEmitir(perfil = 'secretaria') {
  const amb = await criarAmbiente({ ficticios: true });
  amb.sqlite.exec(SIG);
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  return { ...amb, c };
}

describe('hash do snapshot', () => {
  const base = { versao: 1, aluno: { nome: 'A', cpf: '1' }, textoFrente: 'x', lista: [1, 2] } as unknown as SnapshotCertificado;

  it('JSON canônico independe da ordem das chaves', () => {
    expect(jsonCanonico({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
  });
  it('mesmo conteúdo → mesmo hash; qualquer alteração muda o hash', async () => {
    const h1 = await hashSnapshot(base);
    const reordenado = JSON.parse('{"textoFrente":"x","lista":[1,2],"aluno":{"cpf":"1","nome":"A"},"versao":1}');
    expect(await hashSnapshot(reordenado)).toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSnapshot({ ...base, textoFrente: 'y' } as SnapshotCertificado)).not.toBe(h1);
    expect(await hashSnapshot({ ...base, aluno: { nome: 'A', cpf: '2' } } as unknown as SnapshotCertificado)).not.toBe(h1);
  });
});

describe('emissão do certificado', () => {
  it('secretaria emite: gera código INV-AAAA-NNNNN, PDF de 2 páginas no R2, snapshot, hash e auditoria', async () => {
    const { c, sqlite, env, auditoria } = await prontoParaEmitir('secretaria');
    const r = await c.post('/admin/certificados/emitir/1/1', camposEmissao());
    expect(r.status).toBe(302);
    const ce = sqlite.prepare('SELECT * FROM certificados').get() as any;
    expect(ce.codigo_validacao).toBe('INV-2026-00001');
    expect(ce.token).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    expect(ce.emitido_por).toBe('u@iect.test');
    expect(ce.codigo_autenticacao_sistec).toBe('SISTEC-ABC-123');
    expect(ce.pdf_r2_key).toBe('certificados/2026/INV-2026-00001.pdf');

    const s = JSON.parse(ce.snapshot_json) as SnapshotCertificado;
    expect(s.aluno.nome).toBe('Ana Beatriz Fictícia Souza');
    expect(s.textoFrente).toContain('ANA BEATRIZ FICTÍCIA SOUZA');
    expect(s.validacao.url).toBe(`https://certificadostecnicos.inovativa.com.br/v/INV-2026-00001?t=${ce.token}`);
    expect(s.registro).toMatchObject({ numero: '1', folha: '1', livro: '1', anoLetivo: 2026 });
    expect(await hashSnapshot(s)).toBe(ce.hash_sha256);

    const sigs = sqlite.prepare('SELECT nome, cargo FROM certificado_signatarios ORDER BY ordem').all();
    expect(sigs.map((x: any) => x.nome)).toEqual(['Maria Diretora', 'José Secretário']);

    const obj = await env.ARQUIVOS.get(ce.pdf_r2_key);
    const bytes = new Uint8Array(await obj!.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const [w, h] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
    expect(Math.round(w)).toBe(842); // A4 paisagem
    expect(Math.round(h)).toBe(595);
    expect(pdf.getKeywords()).toContain('INV-2026-00001');

    expect(auditoria().at(-1)).toMatchObject({ acao: 'emitir', entidade: 'certificado', usuario_email: 'u@iect.test' });

    // download do PDF pelo painel
    const dl = await c.req(`/admin/certificados/${ce.id}/pdf`);
    expect(dl.headers.get('Content-Type')).toBe('application/pdf');
    expect(auditoria().at(-1)!.acao).toBe('baixar_pdf');
  }, 30_000);

  it('bloqueia sem código SISTEC e mostra o motivo', async () => {
    const { c, sqlite, auditoria } = await prontoParaEmitir();
    const r = await c.post('/admin/certificados/emitir/1/1', camposEmissao({ sistec_codigo: '' }));
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('código de autenticação SISTEC');
    expect(sqlite.prepare('SELECT count(*) AS n FROM certificados').get()).toEqual({ n: 0 });
    expect(auditoria().at(-1)!.acao).toBe('emissao_bloqueada');
  });

  it('bloqueia aluno reprovado e signatários não cadastrados', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    await amb.criarUsuario('u@iect.test', 'coordenador');
    const c = amb.cliente();
    await c.entrar('u@iect.test');
    const r = await c.post('/admin/certificados/emitir/3/1', camposEmissao());
    const html = await r.text();
    expect(r.status).toBe(400);
    expect(html).toContain('Aluno não aprovado no módulo');
    expect(html).toContain('Signatário: Diretor(a) Pedagógico(a) não cadastrado');
  });

  it('não emite duas vezes o mesmo módulo nem repete registro/SISTEC; código é sequencial', async () => {
    const { c, sqlite } = await prontoParaEmitir();
    expect((await c.post('/admin/certificados/emitir/1/1', camposEmissao())).status).toBe(302);
    // mesmo aluno e módulo
    const dup = await c.post('/admin/certificados/emitir/1/1', camposEmissao({ registro_numero: '2', sistec_codigo: 'OUTRO' }));
    expect(dup.status).toBe(400);
    expect(await dup.text()).toContain('Já emitido: <a href="/admin/certificados/1">INV-2026-00001</a>');
    // outro aluno, mesmo registro e SISTEC
    const rep = await (await c.post('/admin/certificados/emitir/2/1', camposEmissao())).text();
    expect(rep).toContain('Registro nº 1, folha 1, livro 1 já usado');
    expect(rep).toContain('Código SISTEC já usado');
    // outro aluno, dados novos → INV-2026-00002
    expect((await c.post('/admin/certificados/emitir/2/1', camposEmissao({ registro_numero: '2', folha: '2', sistec_codigo: 'S-2' }))).status).toBe(302);
    const codigos = sqlite.prepare('SELECT codigo_validacao FROM certificados ORDER BY id').all().map((x: any) => x.codigo_validacao);
    expect(codigos).toEqual(['INV-2026-00001', 'INV-2026-00002']);
  }, 30_000);

  it('sugere o próximo registro conforme registros por folha', async () => {
    const { c, sqlite } = await prontoParaEmitir();
    sqlite.exec('UPDATE instituicoes SET registros_por_folha = 2, folhas_por_livro = 1');
    await c.post('/admin/certificados/emitir/1/1', camposEmissao());
    await c.post('/admin/certificados/emitir/2/1', camposEmissao({ registro_numero: '2', sistec_codigo: 'S-2' }));
    const html = await (await c.req('/admin/certificados/emitir/1/2')).text();
    // 3º registro: 2 por folha → folha 2; 1 folha por livro → livro 2, folha 1
    expect(html).toContain('Sugerido: 3');
    expect(html).toContain('Sugerida: 1');
    expect(html).toContain('Sugerido: 2');
  }, 30_000);

  it('PDF de prévia sai sem gravar nada', async () => {
    const { c, sqlite } = await prontoParaEmitir();
    const r = await c.req('/admin/previa/1/1/pdf?registro_numero=7');
    expect(r.headers.get('Content-Type')).toBe('application/pdf');
    const pdf = await PDFDocument.load(new Uint8Array(await r.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(2);
    expect(sqlite.prepare('SELECT count(*) AS n FROM certificados').get()).toEqual({ n: 0 });
    expect(sqlite.prepare('SELECT count(*) AS n FROM sequencias_certificado').get()).toEqual({ n: 0 });
  }, 30_000);
});
