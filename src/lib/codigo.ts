/**
 * Código de validação: INV-AAAA-NNNNN, sequencial por ano, nunca reaproveitado.
 * A sequência fica em `sequencias_certificado` e só incrementa.
 */

export function formatarCodigo(ano: number, sequencial: number): string {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 9999) throw new Error(`Ano inválido: ${ano}`);
  if (!Number.isInteger(sequencial) || sequencial < 1 || sequencial > 99999) {
    throw new Error(`Sequencial fora do intervalo 1–99999: ${sequencial}`);
  }
  return `INV-${ano}-${String(sequencial).padStart(5, '0')}`;
}

const RE_CODIGO = /^INV-(\d{4})-(\d{5})$/;

export function analisarCodigo(codigo: string): { ano: number; sequencial: number } | null {
  const m = RE_CODIGO.exec(codigo.trim().toUpperCase());
  if (!m) return null;
  const sequencial = Number(m[2]);
  if (sequencial < 1) return null;
  return { ano: Number(m[1]), sequencial };
}

/** Alfabeto sem caracteres ambíguos (0/O, 1/I/L). */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LIMITE = 256 - (256 % ALFABETO.length); // rejeição para evitar viés de módulo

export function gerarToken(tamanho = 10): string {
  let s = '';
  const bytes = new Uint8Array(tamanho * 2);
  while (s.length < tamanho) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (s.length >= tamanho) break;
      if (b < LIMITE) s += ALFABETO[b % ALFABETO.length];
    }
  }
  return s;
}

/** Reserva atomicamente o próximo sequencial do ano no D1. */
export async function reservarProximoCodigo(db: D1Database, ano: number): Promise<string> {
  const row = await db
    .prepare(
      `INSERT INTO sequencias_certificado (ano, ultimo) VALUES (?1, 1)
       ON CONFLICT(ano) DO UPDATE SET ultimo = ultimo + 1
       RETURNING ultimo`,
    )
    .bind(ano)
    .first<{ ultimo: number }>();
  if (!row) throw new Error('Falha ao reservar código de validação');
  return formatarCodigo(ano, row.ultimo);
}
