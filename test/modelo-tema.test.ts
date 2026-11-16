import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { criarAmbiente, ORIGEM } from './ambiente';
import { dimensoesImagem } from '../src/lib/arquivos';

const RAIZ = join(import.meta.dirname, '..');
const FUNDO_JPG = readFileSync(join(RAIZ, 'public/modelo/fundo.jpg')); // 2338 × 1654 (A4)
const LOGO_PNG = readFileSync(join(RAIZ, 'public/modelo/logo.png')); // 1111 × 290

async function logado(perfil: string, opcoes = { ficticios: true }) {
  const amb = await criarAmbiente(opcoes);
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  const enviar = (caminho: string, bytes: Buffer, nome: string, tipo: string) => {
    const fd = new FormData();
    fd.set('arquivo', new File([bytes], nome, { type: tipo }));
    return c.req(caminho, { method: 'POST', body: fd });
  };
  return { ...amb, c, enviar };
}

describe('dimensões de imagem', () => {
  it('lê PNG e JPEG pelo cabeçalho', () => {
    expect(dimensoesImagem(new Uint8Array(FUNDO_JPG))).toEqual({ largura: 2338, altura: 1654 });
    expect(dimensoesImagem(new Uint8Array(LOGO_PNG))).toEqual({ largura: 1111, altura: 290 });
    expect(dimensoesImagem(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('modelo do certificado', () => {
  it('tela mostra fundos, logo, assinaturas e prévia de exemplo', async () => {
    const { c } = await logado('administrador');
    const html = await (await c.req('/admin/modelo')).text();
    for (const t of ['Fundo da frente', 'Fundo do verso', 'Logo do cabeçalho', 'Diretora Pedagógica', 'Secretário(a)', '/admin/modelo/previa']) {
      expect(html).toContain(t);
    }
    const previa = await (await c.req('/admin/modelo/previa')).text();
    expect(previa).toContain('MARIA EXEMPLO DA SILVA');
    expect(previa).toContain('conferindo-lhe o título de Inspetor de Qualidade');
    const pdf = await c.req('/admin/modelo/previa.pdf');
    expect(pdf.headers.get('Content-Type')).toBe('application/pdf');
  }, 30_000);

  it('prévia de exemplo funciona mesmo sem nenhum aluno cadastrado', async () => {
    const { c } = await logado('admin_master', { ficticios: false });
    expect(await (await c.req('/admin/modelo/previa')).text()).toContain('MARIA EXEMPLO DA SILVA');
  });

  it('envia fundo da frente; verso herda a frente até ter o próprio; restaurar volta ao padrão', async () => {
    const { c, enviar, sqlite, auditoria } = await logado('administrador');
    const r = await enviar('/admin/modelo/imagem/frente', FUNDO_JPG, 'frente.jpg', 'image/jpeg');
    expect(decodeURIComponent(r.headers.get('Location')!)).toContain('Fundo da frente atualizado.');
    let inst = sqlite.prepare('SELECT fundo_r2_key, fundo_verso_r2_key FROM instituicoes').get() as any;
    expect(inst.fundo_r2_key).toMatch(/^modelo\/frente\/.+\.jpg$/);
    expect(inst.fundo_verso_r2_key).toBeNull();

    // prévia: verso usa a frente
    let previa = await (await c.req('/admin/modelo/previa')).text();
    expect(previa.match(new RegExp(`/admin/arquivos/${inst.fundo_r2_key}`, 'g'))).toHaveLength(2);

    await enviar('/admin/modelo/imagem/verso', FUNDO_JPG, 'verso.jpg', 'image/jpeg');
    inst = sqlite.prepare('SELECT fundo_r2_key, fundo_verso_r2_key FROM instituicoes').get() as any;
    expect(inst.fundo_verso_r2_key).toMatch(/^modelo\/verso\//);
    previa = await (await c.req('/admin/modelo/previa')).text();
    expect(previa).toContain(`/admin/arquivos/${inst.fundo_verso_r2_key}`);

    await c.post('/admin/modelo/imagem/frente/restaurar', {});
    inst = sqlite.prepare('SELECT fundo_r2_key FROM instituicoes').get() as any;
    expect(inst.fundo_r2_key).toBeNull();
    expect(auditoria().map((a) => a.acao)).toEqual(expect.arrayContaining(['enviar_modelo', 'restaurar_modelo']));

    // PDF de exemplo com fundos personalizados continua válido
    expect((await c.req('/admin/modelo/previa.pdf')).status).toBe(200);
  }, 30_000);

  it('avisa quando o fundo não é A4 paisagem e recusa arquivo que não é imagem', async () => {
    const { enviar } = await logado('administrador');
    const r = await enviar('/admin/modelo/imagem/frente', LOGO_PNG, 'logo.png', 'image/png');
    expect(decodeURIComponent(r.headers.get('Location')!)).toContain('o ideal é proporção A4 paisagem');
    const falso = await enviar('/admin/modelo/imagem/logo', Buffer.from('%PDF-1.4 falso'), 'x.png', 'image/png');
    expect(decodeURIComponent(falso.headers.get('Location')!)).toMatch(/erro=.*formato inválido/);
  });

  it('envia assinatura direto pela tela de modelo', async () => {
    const { enviar, sqlite } = await logado('admin_master');
    await enviar('/admin/modelo/assinatura/secretario', LOGO_PNG, 'ass.png', 'image/png');
    const s = sqlite.prepare(`SELECT assinatura_r2_key FROM signatarios WHERE funcao = 'secretario'`).get() as any;
    expect(s.assinatura_r2_key).toMatch(/^assinaturas\//);
  });

  it('coordenador e secretaria não acessam o modelo', async () => {
    for (const perfil of ['coordenador', 'secretaria']) {
      const { c } = await logado(perfil);
      expect((await c.req('/admin/modelo')).status).toBe(403);
    }
  });
});

describe('tema claro/escuro', () => {
  it('padrão é automático (segue o sistema) e o menu mostra o seletor', async () => {
    const { c } = await logado('secretaria');
    const html = await (await c.req('/admin')).text();
    expect(html).toContain('data-tema="sistema"');
    expect(html).toMatch(/value="escuro" aria-pressed="false"/);
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('escolha do usuário fica salva no cadastro e vale nas próximas páginas', async () => {
    const { c, sqlite } = await logado('secretaria');
    const r = await c.req('/admin/conta/tema', {
      method: 'POST', body: new URLSearchParams({ tema: 'escuro' }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch', Origin: ORIGEM },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get('Set-Cookie')).toContain('tema=escuro');
    expect((sqlite.prepare(`SELECT tema FROM usuarios WHERE email = 'u@iect.test'`).get() as any).tema).toBe('escuro');
    expect(await (await c.req('/admin/alunos')).text()).toContain('data-tema="escuro"');
    // sem JS: redireciona de volta
    const semJs = await c.post('/admin/conta/tema', { tema: 'claro' });
    expect(semJs.status).toBe(302);
    // valor inválido é ignorado
    await c.post('/admin/conta/tema', { tema: 'roxo' });
    expect((sqlite.prepare(`SELECT tema FROM usuarios WHERE email = 'u@iect.test'`).get() as any).tema).toBe('claro');
  });

  it('tela de login usa o tema do cookie', async () => {
    const amb = await criarAmbiente();
    const html = await (await amb.cliente().req('/login', { headers: { Cookie: 'tema=escuro' } })).text();
    expect(html).toContain('data-tema="escuro"');
    expect(html).toContain('/modelo/logo.png');
  });
});
