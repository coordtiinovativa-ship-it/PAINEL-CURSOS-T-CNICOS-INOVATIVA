import type { Context } from 'hono';
import type { Env } from '../tipos';

const CAMPOS_SENSIVEIS = new Set(['senha_hash', 'token_hash', 'senha', 'senha_atual', 'nova_senha']);

function limpar(dados: unknown): string | null {
  if (dados == null) return null;
  return JSON.stringify(dados, (k, v) => (CAMPOS_SENSIVEIS.has(k) ? '[omitido]' : v));
}

export function ipDaRequisicao(c: Context<Env>): string | null {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;
}

/** Registra uma ação. Usa o usuário da sessão, ou `quem` quando não há sessão (ex.: login falho). */
export async function auditar(
  c: Context<Env>,
  acao: string,
  entidade: string,
  entidadeId: number | null,
  antes?: unknown,
  depois?: unknown,
  quem?: { id: number | null; email: string },
): Promise<void> {
  const u = quem ?? c.get('usuario');
  await c.env.DB.prepare(
    `INSERT INTO auditoria (usuario_id, usuario_email, acao, entidade, entidade_id, antes_json, depois_json, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(u?.id ?? null, u?.email ?? 'anônimo', acao, entidade, entidadeId, limpar(antes), limpar(depois), ipDaRequisicao(c))
    .run();
}
