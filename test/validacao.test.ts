import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';

const SIG = `UPDATE signatarios SET nome = 'Maria Diretora' WHERE id = 1; UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`;
const EMISSAO = {
  data_emissao: '2026-12-05', registro_numero: '1', folha: '1', livro: '1', data_registro: '2026-12-05',
  sistec_codigo: 'SISTEC-1', sistec_data: '2026-12-04',
};

/** Ambiente com o certificado INV-2026-00001 emitido para a aluna fictícia Ana (CPF 111.222.333-96). */
async function comCertificado() {
  const amb = await criarAmbiente({ ficticios: true });
  amb.sqlite.exec(SIG);
  await amb.criarUsuario('sec@iect.test', 'secretaria');
  const painel = amb.cliente();
  await painel.entrar('sec@iect.test');
  const r = await painel.post('/admin/certificados/emitir/1/1', EMISSAO);
  if (r.status !== 302) throw new Error('emissão falhou');
  const ce = amb.sqlite.prepare('SELECT id, token FROM certificados').get() as { id: number; token: string };
  return { ...amb, painel, publico: amb.cliente(), token: ce.token, id: ce.id };
}

describe('página pública de validação', () => {
  it('via QR code: mostra os dados do certificado, CPF mascarado e botão do PDF', async () => {
    const { publico, token, auditoria } = await comCertificado();
    const r = await publico.req(`/v/INV-2026-00001?t=${token}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('X-Robots-Tag')).toContain('noindex');
    const html = await r.text();
    expect(html).toContain('Certificado válido');
    expect(html).toContain('Ana Beatriz Fictícia Souza');
    expect(html).toContain('***.222.333-**');
    expect(html).not.toContain('111.222.333-96');
    expect(html).not.toContain('11122233396');
    expect(html).toContain('Inspetor de Qualidade');
    expect(html).toContain('Gestão e Negócios');
    expect(html).toContain('400 horas');
    expect(html).toContain('09/02/2026 a 27/11/2026'); // período da turma
    expect(html).toContain('5 de dezembro de 2026');
    expect(html).toContain('Nº 1 · Folha 1 · Livro 1');
    expect(html).toContain('Deliberação CEE/MS nº 13.111, de 18 de dezembro de 2024');
    expect(html).toContain(`/v/INV-2026-00001/pdf?t=${token}`);
    // LGPD: nada além do necessário
    for (const proibido of ['1234567', 'SEJUSP', 'Carlos Fictício', 'Maria Fictícia Souza', '14 de março de 1998', 'ana@exemplo']) {
      expect(html, proibido).not.toContain(proibido);
    }
    expect(auditoria().at(-1)).toMatchObject({ usuario_email: 'público', acao: 'consulta_publica' });
  }, 30_000);

  it('consulta manual pelo código: mostra dados, mas não libera o PDF', async () => {
    const { publico } = await comCertificado();
    const ir = await publico.req('/v?codigo=inv-2026-00001');
    expect(ir.headers.get('Location')).toBe('/v/INV-2026-00001');
    const html = await (await publico.req('/v/inv-2026-00001')).text();
    expect(html).toContain('Certificado válido');
    expect(html).not.toContain('/pdf?t=');
    expect(html).toContain('leia o QR code');
  }, 30_000);

  it('PDF original só com a chave correta', async () => {
    const { publico, token } = await comCertificado();
    expect((await publico.req('/v/INV-2026-00001/pdf')).status).toBe(404);
    expect((await publico.req('/v/INV-2026-00001/pdf?t=ERRADO1234')).status).toBe(404);
    const ok = await publico.req(`/v/INV-2026-00001/pdf?t=${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('application/pdf');
    expect(new TextDecoder().decode(new Uint8Array(await ok.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
  }, 30_000);

  it('certificado revogado aparece em destaque e sem PDF', async () => {
    const { publico, token, sqlite } = await comCertificado();
    sqlite.exec(`UPDATE certificados SET status = 'revogado', motivo_revogacao = 'Erro no nome', revogado_em = '2026-12-10T10:00:00Z'`);
    const html = await (await publico.req(`/v/INV-2026-00001?t=${token}`)).text();
    expect(html).toContain('Certificado revogado');
    expect(html).toContain('não tem validade');
    expect(html).toContain('Motivo: Erro no nome');
    expect(html).not.toContain('Certificado válido');
    expect(html).not.toContain('/pdf?t=');
    expect((await publico.req(`/v/INV-2026-00001/pdf?t=${token}`)).status).toBe(404);
  }, 30_000);

  it('código inexistente ou inválido: 404 sem expor nada', async () => {
    const { publico, auditoria } = await comCertificado();
    for (const cod of ['INV-2026-00099', 'INV-26-1', 'qualquer-coisa', "INV-2026-00001'--"]) {
      const r = await publico.req(`/v/${encodeURIComponent(cod)}`);
      expect(r.status, cod).toBe(404);
      expect(await r.text()).toContain('Certificado não encontrado');
    }
    // consultas a códigos inexistentes não gravam no banco (proteção da cota de gravações do D1)
    expect(auditoria().some((a) => a.acao === 'consulta_publica_inexistente')).toBe(false);
  }, 30_000);

  it('página inicial de consulta não exige login', async () => {
    const amb = await criarAmbiente();
    const r = await amb.cliente().req('/v');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Validar um certificado');
  });

  it('o QR code do PDF aponta para a página de validação que funciona', async () => {
    const { publico, sqlite } = await comCertificado();
    const s = JSON.parse((sqlite.prepare('SELECT snapshot_json FROM certificados').get() as any).snapshot_json);
    const url = new URL(s.validacao.url);
    expect(url.pathname).toBe('/v/INV-2026-00001');
    const html = await (await publico.req(url.pathname + url.search)).text();
    expect(html).toContain('Baixar o PDF original');
  }, 30_000);
});

describe('emissão de certificados (lista de pendentes)', () => {
  it('lista aprovados prontos, esconde reprovados e some depois de emitido', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    amb.sqlite.exec(SIG);
    await amb.criarUsuario('coord@iect.test', 'coordenador');
    const c = amb.cliente();
    await c.entrar('coord@iect.test');
    let html = await (await c.req('/admin/certificados/pendentes')).text();
    expect(html).toContain('Ana Beatriz Fictícia Souza');
    expect(html).toContain('João Pedro Fictício Lima');
    expect(html).not.toContain('Renata Fictícia Alves'); // reprovada no módulo 1
    expect(html).toContain('/admin/certificados/emitir/1/1');
    // com "todos", aparece a reprovada e os módulos sem notas
    html = await (await c.req('/admin/certificados/pendentes?todos=1')).text();
    expect(html).toContain('Renata Fictícia Alves');
    expect(html).toContain('Não aprovado');
    expect(html).toContain('Notas incompletas');
    await c.post('/admin/certificados/emitir/1/1', EMISSAO);
    html = await (await c.req('/admin/certificados/pendentes')).text();
    expect(html).not.toContain('/admin/certificados/emitir/1/1');
  }, 30_000);

  it('aprovado com cadastro incompleto aparece como "faltam dados"', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    amb.sqlite.exec(SIG + ` UPDATE alunos SET rg = NULL WHERE id = 2;`);
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const c = amb.cliente();
    await c.entrar('sec@iect.test');
    const html = await (await c.req('/admin/certificados/pendentes')).text();
    expect(html).toMatch(/João Pedro Fictício Lima[\s\S]*?Aprovado — faltam dados[\s\S]*?RG/);
  });
});

describe('menu lateral (estilo SysGEP)', () => {
  it('secretaria vê só a seção Secretaria e a troca de senha; item ativo destacado e seção aberta', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const c = amb.cliente();
    await c.entrar('sec@iect.test');
    const html = await (await c.req('/admin/alunos')).text();
    expect(html).toMatch(/<details open="" data-secao="secretaria">/);
    expect(html).toMatch(/<a href="\/admin\/alunos" class="ativo">Alunos/);
    expect(html).toContain('Emissão de Certificados');
    expect(html).not.toContain('data-secao="cadastros"');
    expect(html).toContain('data-secao="sistema"'); // só "Alterar Minha Senha"
    expect(html).not.toContain('Usuários e Perfis');
    expect(html).not.toContain('Modelo do Certificado');
  });

  it('item mais específico fica ativo (Emissão × Certificados Emitidos)', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    await amb.criarUsuario('m@iect.test', 'admin_master');
    const c = amb.cliente();
    await c.entrar('m@iect.test');
    const html = await (await c.req('/admin/certificados/pendentes')).text();
    expect(html).toMatch(/<a href="\/admin\/certificados\/pendentes" class="ativo">/);
    expect(html).toMatch(/<a href="\/admin\/certificados" class="">/);
    expect(html).toContain('data-secao="cadastros"');
  });
});
