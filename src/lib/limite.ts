/**
 * Limite de requisições por IP com o Rate Limiting nativo do Cloudflare Workers
 * (bindings [[ratelimits]] no wrangler.toml). Os contadores ficam na borda da Cloudflare,
 * sem custo de banco. Sem o binding (ex.: testes que não o configuram), não limita.
 */
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../tipos';

type NomeLimite = 'LIMITE_VALIDACAO' | 'LIMITE_LOGIN';

const ESTILO = 'font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#12233D;line-height:1.5';

export function limitarPorIP(
  nome: NomeLimite,
  opcoes: { apenasMetodo?: string; mensagem: string },
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const limitador = c.env[nome];
    if (!limitador || (opcoes.apenasMetodo && c.req.method !== opcoes.apenasMetodo)) return next();
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'desconhecido';
    const { success } = await limitador.limit({ key: `${nome}:${ip}` });
    if (success) return next();
    console.warn(`[limite] ${nome} excedido por ${ip} em ${c.req.method} ${c.req.path}`);
    return c.html(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Muitas tentativas</title></head><body style="${ESTILO}">
<h1 style="color:#003C80">Muitas tentativas em pouco tempo</h1><p>${opcoes.mensagem}</p>
<p>Aguarde um minuto e tente novamente.</p></body></html>`,
      429,
      { 'Retry-After': '60', 'Cache-Control': 'no-store' },
    );
  };
}
