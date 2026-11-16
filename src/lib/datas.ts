/** Datas: armazenadas em ISO (YYYY-MM-DD), exibidas em formato brasileiro. */

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function partes(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`Data ISO inválida: ${iso}`);
  const a = Number(m[1]);
  const mes = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(a, mes - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Data inexistente: ${iso}`);
  }
  return [a, mes, d];
}

/** 2024-12-18 → 18/12/2024 */
export function dataBR(iso: string): string {
  const [a, m, d] = partes(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

/** 2017-02-06 → "6 de fevereiro de 2017"; dia 1 → "1º de ..." */
export function dataExtenso(iso: string): string {
  const [a, m, d] = partes(iso);
  return `${d === 1 ? '1º' : d} de ${MESES[m - 1]} de ${a}`;
}

/** 18/12/2024 → 2024-12-18 (para importação de planilhas) */
export function dataISO(br: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(br.trim());
  if (!m) throw new Error(`Data inválida (use dd/mm/aaaa): ${br}`);
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  partes(iso);
  return iso;
}
