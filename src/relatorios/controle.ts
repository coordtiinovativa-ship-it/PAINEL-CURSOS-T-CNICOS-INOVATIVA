/**
 * Relatórios Controle de Notas e Controle de Faltas (padrão sysGEP), por turma e disciplina (ou todas as do módulo).
 * Notas: média, exame final, média final, faltas, frequência e resultado (PPC 11.1.1).
 * Faltas: uma coluna por dia de aula da disciplina (chamada registrada ou aula prevista no horário), nº de faltas no dia e total.
 */
import { avaliarDisciplina, criteriosDoCurso } from '../lib/aprovacao';
import { anoLetivo, aulasPrevistasDaTurma } from '../lib/pedagogico';

export interface FiltroControle {
  turmaId: number;
  moduloId: number | null;
  componenteId: number | null;
  ordem: 'alfabetica' | 'chamada';
  somenteComFaltas: boolean;
}

/** `disc` = "m:<módulo>" (todas as disciplinas do módulo) ou "c:<disciplina>". */
export function lerFiltroControle(q: Record<string, string | undefined>): FiltroControle | null {
  const turmaId = Number(q.turma);
  const m = /^([mc]):(\d+)$/.exec(q.disc ?? '');
  if (!turmaId || !m) return null;
  return {
    turmaId,
    moduloId: m[1] === 'm' ? Number(m[2]) : null,
    componenteId: m[1] === 'c' ? Number(m[2]) : null,
    ordem: q.ordem === 'chamada' ? 'chamada' : 'alfabetica',
    somenteComFaltas: q.com_faltas === '1',
  };
}

const SUFIXO_STATUS: Record<string, string> = {
  transferido: 'TRANSF.', transferencia_interna: 'TRANSF. INT.', desistente: 'DESIST.', cancelada: 'CANCEL.', falecido: 'FALEC.',
};

export interface AlunoControle {
  matriculaId: number;
  id: string; // RA (ou código interno)
  nc: number; // nº de chamada = ordem de matrícula na turma
  nome: string;
  status: string;
  /** "TRANSF. 12/06/2026" etc. para matrícula não ativa */
  sufixo: string | null;
  nota: number | null;
  exame: number | null;
  mediaFinal: number | null;
  faltas: number | null;
  frequencia: number | null;
  resultado: string | null;
  faltasPorDia: Record<string, number>;
}

export interface DisciplinaControle {
  id: number;
  nome: string;
  ch: number;
  professor: string | null;
  /** dias de aula (ISO), em ordem */
  datas: string[];
  comChamada: boolean;
  alunos: AlunoControle[];
}

export interface DadosControle {
  instituicao: Record<string, any>;
  turma: { id: number; codigo: string; turno: string | null; polo: string | null; ano: number | null };
  curso: string;
  modulo: { id: number; ordem: number; nome: string; qualificacao: string | null; inicio: string | null; fim: string | null };
  disciplinas: DisciplinaControle[];
  ordem: FiltroControle['ordem'];
}

export class ErroControle extends Error {}

const nomeSql = `CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END`;
const dataBRc = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export async function dadosControle(db: D1Database, f: FiltroControle, hoje: string): Promise<DadosControle> {
  const turma = await db.prepare('SELECT t.*, cu.nome AS curso_nome FROM turmas t JOIN cursos cu ON cu.id = t.curso_id WHERE t.id = ?')
    .bind(f.turmaId).first<Record<string, any>>();
  if (!turma) throw new ErroControle('Turma não encontrada.');
  const comps = f.componenteId
    ? (await db.prepare(`SELECT id, nome, carga_horaria_total AS ch, modulo_id FROM componentes_curriculares WHERE id = ? AND matriz_id = ? AND modulo_id IS NOT NULL`)
      .bind(f.componenteId, turma.matriz_id).all<{ id: number; nome: string; ch: number; modulo_id: number }>()).results
    : (await db.prepare(`SELECT id, nome, carga_horaria_total AS ch, modulo_id FROM componentes_curriculares WHERE modulo_id = ? AND matriz_id = ? ORDER BY ordem`)
      .bind(f.moduloId, turma.matriz_id).all<{ id: number; nome: string; ch: number; modulo_id: number }>()).results;
  if (!comps.length) throw new ErroControle('Escolha uma disciplina ou módulo da turma.');
  const moduloId = comps[0].modulo_id;

  const [inst, curso, modulo, matriculas] = await Promise.all([
    db.prepare('SELECT * FROM instituicoes WHERE id = 1').first<Record<string, any>>(),
    db.prepare('SELECT * FROM cursos WHERE id = ?').bind(turma.curso_id).first<any>(),
    db.prepare(`SELECT mt.id, mt.ordem, mt.nome, mt.qualificacao_conferida, tm.data_inicio, tm.data_fim
                  FROM modulos_tematicos mt LEFT JOIN turma_modulos tm ON tm.modulo_id = mt.id AND tm.turma_id = ? WHERE mt.id = ?`)
      .bind(f.turmaId, moduloId).first<Record<string, any>>(),
    db.prepare(
      `SELECT m.id, m.status, a.id AS aluno_id, a.ra, ${nomeSql} AS nome,
              (SELECT h.data FROM matricula_status_historico h WHERE h.matricula_id = m.id AND h.status_novo = m.status ORDER BY h.id DESC LIMIT 1) AS status_data
         FROM matriculas m JOIN alunos a ON a.id = m.aluno_id WHERE m.turma_id = ? ORDER BY m.id`,
    ).bind(f.turmaId).all<{ id: number; status: string; aluno_id: number; ra: string | null; nome: string; status_data: string | null }>(),
  ]);
  const criterios = criteriosDoCurso(curso);
  const ano = turma.ano_letivo ? await anoLetivo(db, turma.ano_letivo) : null;
  const previstas = ano ? await aulasPrevistasDaTurma(db, f.turmaId, ano, hoje) : [];

  const base = matriculas.results.map((m, i) => ({
    matriculaId: m.id,
    id: m.ra ?? String(m.aluno_id),
    nc: i + 1,
    nome: m.nome,
    status: m.status ?? 'ativa',
    sufixo: m.status && m.status !== 'ativa' ? `${SUFIXO_STATUS[m.status] ?? m.status.toUpperCase()}${m.status_data ? ` ${dataBRc(m.status_data)}` : ''}` : null,
  }));
  if (f.ordem === 'alfabetica') base.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const disciplinas: DisciplinaControle[] = [];
  for (const cc of comps) {
    const [res, faltasDia, aulasReg, prof] = await Promise.all([
      db.prepare(
        `SELECT r.matricula_id, r.nota, r.nota_exame_final, r.faltas, r.frequencia FROM resultados r JOIN matriculas m ON m.id = r.matricula_id
          WHERE m.turma_id = ? AND r.componente_id = ?`,
      ).bind(f.turmaId, cc.id).all<{ matricula_id: number; nota: number | null; nota_exame_final: number | null; faltas: number | null; frequencia: number | null }>(),
      db.prepare(
        `SELECT f.matricula_id, au.data, count(*) AS n FROM faltas_aula f JOIN aulas au ON au.id = f.aula_id
          WHERE au.turma_id = ? AND au.componente_id = ? GROUP BY f.matricula_id, au.data`,
      ).bind(f.turmaId, cc.id).all<{ matricula_id: number; data: string; n: number }>(),
      db.prepare('SELECT DISTINCT data FROM aulas WHERE turma_id = ? AND componente_id = ?').bind(f.turmaId, cc.id).all<{ data: string }>(),
      db.prepare(
        `SELECT fu.nome FROM lotacoes l JOIN funcionarios fu ON fu.id = l.funcionario_id WHERE l.turma_id = ? AND l.componente_id = ?
          ORDER BY l.data_fim IS NULL DESC, l.data_inicio DESC LIMIT 1`,
      ).bind(f.turmaId, cc.id).first<{ nome: string }>(),
    ]);
    const porMat = new Map(res.results.map((r) => [r.matricula_id, r]));
    const fd = new Map<number, Record<string, number>>();
    for (const x of faltasDia.results) fd.set(x.matricula_id, { ...(fd.get(x.matricula_id) ?? {}), [x.data]: x.n });
    const datas = [...new Set([...aulasReg.results.map((x) => x.data), ...previstas.filter((p) => p.componente_id === cc.id).map((p) => p.data)])].sort();
    let alunos: AlunoControle[] = base.map((b) => {
      const r = porMat.get(b.matriculaId);
      const av = r ? avaliarDisciplina({ componente: cc.nome, nota: r.nota, notaExameFinal: r.nota_exame_final, frequencia: r.frequencia }, criterios) : null;
      return {
        ...b,
        nota: r?.nota ?? null, exame: r?.nota_exame_final ?? null, mediaFinal: av?.mediaFinal ?? null,
        faltas: r?.faltas ?? null, frequencia: r?.frequencia ?? null,
        resultado: av && av.resultado !== 'PENDENTE' ? av.resultado : null,
        faltasPorDia: fd.get(b.matriculaId) ?? {},
      };
    });
    if (f.somenteComFaltas) alunos = alunos.filter((a) => (a.faltas ?? 0) > 0 || Object.keys(a.faltasPorDia).length > 0);
    disciplinas.push({ id: cc.id, nome: cc.nome, ch: cc.ch, professor: prof?.nome ?? null, datas, comChamada: aulasReg.results.length > 0, alunos });
  }

  return {
    instituicao: inst ?? {},
    turma: { id: turma.id, codigo: turma.codigo, turno: turma.turno, polo: turma.polo, ano: turma.ano_letivo },
    curso: turma.curso_nome,
    modulo: {
      id: modulo!.id, ordem: modulo!.ordem, nome: modulo!.nome, qualificacao: modulo!.qualificacao_conferida,
      inicio: modulo!.data_inicio ?? null, fim: modulo!.data_fim ?? null,
    },
    disciplinas,
    ordem: f.ordem,
  };
}
