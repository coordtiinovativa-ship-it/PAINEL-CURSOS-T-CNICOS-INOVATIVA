import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { Env, UsuarioSessao } from '../tipos';
import { ipDaRequisicao } from '../lib/auditoria';
import { pode, type Permissao } from './permissoes';

export const DURACAO_SESSAO_H = 8;
export const MAX_TENTATIVAS = 5;
export const BLOQUEIO_MIN = 15;

const nomeCookie = (c: Context<Env>) => (c.env.AMBIENTE === 'production' ? '__Host-sessao' : 'sessao');

async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenAleatorio(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function criarSessao(c: Context<Env>, usuarioId: number): Promise<void> {
  const token = tokenAleatorio();
  const expira = new Date(Date.now() + DURACAO_SESSAO_H * 3600_000).toISOString();
  await c.env.DB.prepare(
    'INSERT INTO sessoes (token_hash, usuario_id, expira_em, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(await sha256(token), usuarioId, expira, ipDaRequisicao(c), c.req.header('User-Agent') ?? null)
    .run();
  setCookie(c, nomeCookie(c), token, {
    httpOnly: true,
    secure: c.env.AMBIENTE === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: DURACAO_SESSAO_H * 3600,
  });
}

export async function encerrarSessao(c: Context<Env>): Promise<void> {
  const token = getCookie(c, nomeCookie(c));
  if (token) await c.env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, nomeCookie(c), { path: '/', secure: c.env.AMBIENTE === 'production' });
}

/** Encerra todas as sessões de um usuário (desativação, troca/reset de senha). */
export async function encerrarSessoesDoUsuario(db: D1Database, usuarioId: number): Promise<void> {
  await db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(usuarioId).run();
}

/** Exige sessão válida em /admin/*. Redireciona para /login se ausente. */
export const exigirLogin: MiddlewareHandler<Env> = async (c, next) => {
  const token = getCookie(c, nomeCookie(c));
  let usuario: UsuarioSessao | null = null;
  if (token) {
    usuario = await c.env.DB.prepare(
      `SELECT u.id, u.nome, u.email, u.perfil, u.trocar_senha, u.tema
         FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1`,
    )
      .bind(await sha256(token), new Date().toISOString())
      .first<UsuarioSessao>();
  }
  if (!usuario) {
    const destino = encodeURIComponent(c.req.path + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : ''));
    return c.redirect(`/login?voltar=${destino}`);
  }
  c.set('usuario', usuario);
  // Senha temporária: só pode acessar a troca de senha e sair
  if (usuario.trocar_senha && !['/admin/conta/senha', '/admin/sair'].includes(c.req.path)) {
    return c.redirect('/admin/conta/senha');
  }
  await next();
};

/** Middleware de permissão para uma rota. */
export const exigir =
  (permissao: Permissao): MiddlewareHandler<Env> =>
  async (c, next) => {
    if (!pode(c.get('usuario').perfil, permissao)) {
      throw new HTTPException(403, { message: 'Seu perfil não tem permissão para esta ação.' });
    }
    await next();
  };
