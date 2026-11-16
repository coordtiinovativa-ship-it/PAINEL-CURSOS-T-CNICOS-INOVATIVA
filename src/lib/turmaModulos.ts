/**
 * Módulos da turma: período e situação de cada módulo, em sequência (decisão da direção, 16/11/2026).
 * Regras:
 *  - um módulo só fica "em andamento" ou "concluído" se o anterior (pela ordem) estiver concluído;
 *  - "em andamento" exige data de início; "concluído" exige início e término;
 *  - módulo concluído com certificado válido emitido na turma não pode ser reaberto;
 *  - notas só podem ser lançadas em módulo em andamento ou concluído;
 *  - documentos só de módulo concluído.
 */
import { ErroValidacao } from './form';
import { dataBR } from './datas';

export type SituacaoModulo = 'planejado' | 'em_andamento' | 'concluido';
export const ROTULO_SITUACAO: Record<SituacaoModulo, string> = { planejado: 'Planejado', em_andamento: 'Em andamento', concluido: 'Concluído' };

export interface ModuloTurma {
  id: number;
  turma_id: number;
  modulo_id: number;
  ordem: number;
  nome: string;
  qualificacao_conferida: string | null;
  carga_horaria: number;
  tem_terminalidade: number;
  data_inicio: string | null;
  data_fim: string | null;
  situacao: SituacaoModulo;
}

/** Cria as linhas que faltarem (turmas novas ou criadas fora da tela): 1º módulo em andamento, demais planejados. */
export async function garantirModulosDaTurma(db: D1Database, turmaId: number): Promise<void> {
  const existentes = await db.prepare('SELECT count(*) AS n FROM turma_modulos WHERE turma_id = ?').bind(turmaId).first<{ n: number }>();
  if (!existentes?.n) {
    // turma nova: 1º módulo em andamento desde o início da turma
    await db.prepare(
      `INSERT INTO turma_modulos (turma_id, modulo_id, data_inicio, situacao)
       SELECT t.id, mt.id,
              CASE WHEN mt.ordem = (SELECT min(ordem) FROM modulos_tematicos WHERE matriz_id = t.matriz_id) THEN coalesce(t.data_inicio, date('now')) END,
              CASE WHEN mt.ordem = (SELECT min(ordem) FROM modulos_tematicos WHERE matriz_id = t.matriz_id) THEN 'em_andamento' ELSE 'planejado' END
         FROM turmas t JOIN modulos_tematicos mt ON mt.matriz_id = t.matriz_id WHERE t.id = ?`,
    ).bind(turmaId).run();
    return;
  }
  // linhas que faltarem entram como planejadas
  await db.prepare(
    `INSERT INTO turma_modulos (turma_id, modulo_id, situacao)
     SELECT t.id, mt.id, 'planejado' FROM turmas t JOIN modulos_tematicos mt ON mt.matriz_id = t.matriz_id
      WHERE t.id = ? AND NOT EXISTS (SELECT 1 FROM turma_modulos tm WHERE tm.turma_id = t.id AND tm.modulo_id = mt.id)`,
  ).bind(turmaId).run();
}

export async function modulosDaTurma(db: D1Database, turmaId: number): Promise<ModuloTurma[]> {
  await garantirModulosDaTurma(db, turmaId);
  return (
    await db.prepare(
      `SELECT tm.id, tm.turma_id, tm.modulo_id, mt.ordem, mt.nome, mt.qualificacao_conferida, mt.carga_horaria, mt.tem_terminalidade,
              tm.data_inicio, tm.data_fim, tm.situacao
         FROM turma_modulos tm JOIN modulos_tematicos mt ON mt.id = tm.modulo_id
        WHERE tm.turma_id = ? ORDER BY mt.ordem`,
    ).bind(turmaId).all<ModuloTurma>()
  ).results;
}

/** Situação de um módulo na turma (sem criar linhas). Ausente = planejado. */
export async function moduloNaTurma(db: D1Database, turmaId: number, moduloId: number): Promise<Pick<ModuloTurma, 'data_inicio' | 'data_fim' | 'situacao'>> {
  const r = await db.prepare('SELECT data_inicio, data_fim, situacao FROM turma_modulos WHERE turma_id = ? AND modulo_id = ?').bind(turmaId, moduloId)
    .first<Pick<ModuloTurma, 'data_inicio' | 'data_fim' | 'situacao'>>();
  return r ?? { data_inicio: null, data_fim: null, situacao: 'planejado' };
}

/** Lança ErroValidacao se o módulo ainda não começou (não aceita notas). */
export async function exigirModuloIniciado(db: D1Database, turmaId: number, moduloId: number, nomeModulo: string): Promise<void> {
  const m = await moduloNaTurma(db, turmaId, moduloId);
  if (m.situacao === 'planejado') {
    throw new ErroValidacao(`O módulo ${nomeModulo} ainda está "planejado" nesta turma: inicie o módulo em "Módulos da turma" antes de lançar notas.`);
  }
}

/** Valida a mudança de período/situação de um módulo respeitando a sequência. Retorna os valores normalizados. */
export async function validarMudanca(
  db: D1Database,
  modulos: ModuloTurma[],
  alvo: ModuloTurma,
  novo: { data_inicio: string | null; data_fim: string | null; situacao: SituacaoModulo },
): Promise<typeof novo> {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  for (const [k, r] of [['data_inicio', 'início'], ['data_fim', 'término']] as const) {
    if (novo[k] && !iso.test(novo[k]!)) throw new ErroValidacao(`Data de ${r} inválida.`);
  }
  if (!(novo.situacao in ROTULO_SITUACAO)) throw new ErroValidacao('Situação inválida.');
  if (novo.situacao !== 'planejado' && !novo.data_inicio) throw new ErroValidacao(`Informe a data de início do módulo ${alvo.nome}.`);
  if (novo.situacao === 'concluido' && !novo.data_fim) throw new ErroValidacao(`Informe a data de término para concluir o módulo ${alvo.nome}.`);
  if (novo.data_inicio && novo.data_fim && novo.data_fim < novo.data_inicio) throw new ErroValidacao('A data de término é anterior à de início.');

  const anteriores = modulos.filter((m) => m.ordem < alvo.ordem);
  const posteriores = modulos.filter((m) => m.ordem > alvo.ordem);
  if (novo.situacao !== 'planejado') {
    const pendente = anteriores.find((m) => m.situacao !== 'concluido');
    if (pendente) throw new ErroValidacao(`Os módulos são feitos em ordem: conclua antes o Módulo ${pendente.ordem} — ${pendente.nome}.`);
    const ultimo = anteriores.at(-1);
    if (ultimo?.data_fim && novo.data_inicio! < ultimo.data_fim) {
      throw new ErroValidacao(`O módulo ${alvo.nome} não pode começar antes do término do Módulo ${ultimo.ordem} (${dataBR(ultimo.data_fim)}).`);
    }
  }
  if (novo.situacao === 'planejado' && alvo.situacao !== 'planejado') {
    const notas = await db.prepare(
      `SELECT count(*) AS n FROM resultados r JOIN matriculas m ON m.id = r.matricula_id
        JOIN componentes_curriculares cc ON cc.id = r.componente_id WHERE m.turma_id = ? AND cc.modulo_id = ?`,
    ).bind(alvo.turma_id, alvo.modulo_id).first<{ n: number }>();
    if (notas?.n) throw new ErroValidacao(`O módulo ${alvo.nome} já tem notas lançadas e não pode voltar para "planejado".`);
  }
  if (novo.situacao !== 'concluido') {
    const adiante = posteriores.find((m) => m.situacao !== 'planejado');
    if (adiante) throw new ErroValidacao(`O Módulo ${adiante.ordem} — ${adiante.nome} já começou: não é possível reabrir o módulo ${alvo.nome}.`);
    if (alvo.situacao === 'concluido') {
      const cert = await db.prepare(
        `SELECT count(*) AS n FROM certificados ce JOIN matriculas m ON m.id = ce.matricula_id
          WHERE m.turma_id = ? AND ce.modulo_id = ? AND ce.status = 'válido'`,
      ).bind(alvo.turma_id, alvo.modulo_id).first<{ n: number }>();
      if (cert?.n) throw new ErroValidacao(`O módulo ${alvo.nome} já tem ${cert.n} certificado(s) emitido(s) nesta turma e não pode ser reaberto.`);
    }
  }
  return novo;
}
