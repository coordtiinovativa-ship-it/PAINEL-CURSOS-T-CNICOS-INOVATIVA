/**
 * Status da matrícula (vínculo do aluno com a turma) — decisão de 18/11/2026.
 * Separado da situação acadêmica (cursando/concluído/reprovado). Todo aluno entra "Ativa"; só a secretaria muda
 * (com data e motivo; histórico em matricula_status_historico). Aluno não ativo: notas e faltas só pela Secretaria
 * (as telas da Gestão Pedagógica mostram o aluno, mas não deixam lançar).
 */
import { ErroValidacao } from './form';

export type StatusMatricula = 'ativa' | 'desistente' | 'transferido' | 'cancelada' | 'falecido' | 'transferencia_interna';

export const STATUS_MATRICULA: [StatusMatricula, string][] = [
  ['ativa', 'Ativa'],
  ['desistente', 'Desistente'],
  ['transferido', 'Transferido'],
  ['cancelada', 'Matrícula cancelada'],
  ['falecido', 'Falecido(a)'],
  ['transferencia_interna', 'Transferência interna'],
];
export const ROTULO_STATUS: Record<string, string> = Object.fromEntries(STATUS_MATRICULA);

export const estaAtiva = (status: string | null | undefined) => (status ?? 'ativa') === 'ativa';

/** Tag de status para as listas (vazia para "ativa", que é o normal). */
export const classeStatus = (status: string) => (status === 'ativa' ? 'ok' : status === 'cancelada' || status === 'falecido' ? 'erro' : 'aviso');

export async function alterarStatus(
  db: D1Database,
  matriculaId: number,
  dados: { status: string | null; data: string | null; motivo: string | null },
  usuario: string,
): Promise<{ antes: string; depois: StatusMatricula }> {
  const m = await db.prepare('SELECT status FROM matriculas WHERE id = ?').bind(matriculaId).first<{ status: string }>();
  if (!m) throw new ErroValidacao('Matrícula não encontrada.');
  if (!STATUS_MATRICULA.some(([s]) => s === dados.status)) throw new ErroValidacao('Selecione o status.');
  if (dados.status === m.status) throw new ErroValidacao(`A matrícula já está como "${ROTULO_STATUS[m.status]}".`);
  if (!dados.data || !/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) throw new ErroValidacao('Informe a data do novo status.');
  if (dados.status !== 'ativa' && !dados.motivo) throw new ErroValidacao('Informe o motivo (ex.: pedido de transferência para outra escola).');
  await db.batch([
    db.prepare('UPDATE matriculas SET status = ? WHERE id = ?').bind(dados.status, matriculaId),
    db.prepare('INSERT INTO matricula_status_historico (matricula_id, status_anterior, status_novo, data, motivo, usuario) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(matriculaId, m.status, dados.status, dados.data, dados.motivo, usuario),
  ]);
  return { antes: m.status, depois: dados.status as StatusMatricula };
}

export async function historicoStatus(db: D1Database, matriculaId: number) {
  return (await db.prepare('SELECT * FROM matricula_status_historico WHERE matricula_id = ? ORDER BY id DESC').bind(matriculaId)
    .all<{ status_anterior: string; status_novo: string; data: string; motivo: string | null; usuario: string; registrado_em: string }>()).results;
}
