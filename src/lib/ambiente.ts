import type { MiddlewareHandler } from 'hono';
import type { Env } from '../tipos';

/**
 * Ambientes: 'dev' (computador local, http), 'teste' (homologação na Cloudflare, dados fictícios, para a direção testar)
 * e 'production'. Teste e produção são sistemas separados: Worker, banco D1 e arquivos R2 próprios.
 */
type ComAmbiente = { AMBIENTE: string };

/** Cookies seguros (HTTPS) em tudo que não é o computador local. */
export const usaHttps = (env: ComAmbiente) => env.AMBIENTE !== 'dev';

export const ehAmbienteTeste = (env: ComAmbiente) => env.AMBIENTE === 'teste';

export const MARCA_TESTE = 'AMBIENTE DE TESTE — SEM VALIDADE';

/** Marca d'água dos documentos emitidos no ambiente de teste (produção: nenhuma). */
export const marcaDoAmbiente = (env: ComAmbiente) => (ehAmbienteTeste(env) ? MARCA_TESTE : undefined);

const FAIXA = `<div role="note" style="position:relative;z-index:40;background:repeating-linear-gradient(135deg,#B45309 0 14px,#C2410C 14px 28px);` +
  `color:#fff;text-align:center;font:700 13px/1.3 'Segoe UI',system-ui,sans-serif;padding:6px 12px;letter-spacing:.03em">` +
  `AMBIENTE DE TESTE — dados fictícios para conhecer e testar o sistema. Nada feito aqui vale ou aparece na produção.</div>`;

/** Insere a faixa logo após <body> nas páginas HTML do ambiente de teste. */
export const faixaAmbienteTeste: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  if (!ehAmbienteTeste(c.env) || !c.res.headers.get('content-type')?.includes('text/html')) return;
  const html = await c.res.text();
  const i = html.indexOf('<body');
  const fim = i < 0 ? -1 : html.indexOf('>', i);
  const novo = fim < 0 ? FAIXA + html : html.slice(0, fim + 1) + FAIXA + html.slice(fim + 1);
  const h = new Headers(c.res.headers);
  h.delete('content-length');
  c.res = new Response(novo, { status: c.res.status, headers: h });
};
