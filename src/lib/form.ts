import type { Context } from 'hono';
import type { Env } from '../tipos';

export type Corpo = Record<string, string | File | (string | File)[]>;

export async function lerCorpo(c: Context<Env>): Promise<Corpo> {
  return (await c.req.parseBody({ all: true })) as Corpo;
}

/** Texto aparado; vazio vira null. */
export function texto(corpo: Corpo, campo: string): string | null {
  const v = corpo[campo];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** Número em formato brasileiro ("7,5") ou internacional; vazio vira null; inválido lança erro. */
export function numero(corpo: Corpo, campo: string, rotulo = campo): number | null {
  const t = texto(corpo, campo);
  if (t == null) return null;
  const n = Number(t.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new ErroValidacao(`${rotulo}: número inválido ("${t}")`);
  return n;
}

export function inteiro(corpo: Corpo, campo: string, rotulo = campo): number | null {
  const n = numero(corpo, campo, rotulo);
  if (n != null && !Number.isInteger(n)) throw new ErroValidacao(`${rotulo}: deve ser número inteiro`);
  return n;
}

export function marcado(corpo: Corpo, campo: string): 0 | 1 {
  return corpo[campo] != null && corpo[campo] !== '' && corpo[campo] !== '0' ? 1 : 0;
}

export function arquivo(corpo: Corpo, campo: string): File | null {
  const v = corpo[campo];
  return v instanceof File && v.size > 0 ? v : null;
}

export class ErroValidacao extends Error {}

/** Formata número com vírgula para exibição em campo de formulário. */
export const numBR = (n: number | null | undefined, casas = 1) =>
  n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
