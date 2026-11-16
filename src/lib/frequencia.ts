/**
 * Frequência a partir das faltas em nº de aulas (decisão da direção, 16/11/2026):
 *   horas faltadas = faltas × tempo da aula (min) ÷ 60
 *   frequência (%) = 100 × (1 − horas faltadas ÷ carga horária da disciplina)
 */

export const DIAS_SEMANA: [string, string][] = [
  ['seg', 'Seg'], ['ter', 'Ter'], ['qua', 'Qua'], ['qui', 'Qui'], ['sex', 'Sex'], ['sab', 'Sáb'], ['dom', 'Dom'],
];

/** Total de aulas previstas na disciplina (arredondado para cima). */
export function aulasPrevistas(chHoras: number, duracaoMin: number): number {
  return Math.ceil((chHoras * 60) / duracaoMin);
}

/** Frequência em % (2 casas), nunca abaixo de 0. */
export function calcularFrequencia(faltas: number, duracaoMin: number, chHoras: number): number {
  const horasFaltadas = (faltas * duracaoMin) / 60;
  const f = 100 * (1 - horasFaltadas / chHoras);
  return Math.max(0, Math.round(f * 100) / 100);
}

/** "seg,qua" + "19:00" + "22:30" → "Seg e Qua, 19:00 às 22:30" */
export function descreverHorario(dias: string | null, inicio: string | null, fim: string | null): string | null {
  const nomes = (dias ?? '').split(',').filter(Boolean).map((d) => DIAS_SEMANA.find(([k]) => k === d)?.[1] ?? d);
  const ds = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0] ?? '';
  const hs = inicio && fim ? `${inicio} às ${fim}` : inicio ?? '';
  return [ds, hs].filter(Boolean).join(', ') || null;
}
