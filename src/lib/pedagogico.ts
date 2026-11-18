/**
 * Gestão Pedagógica — regras (fonte única):
 *  - calendário: feriado, recesso e ponto facultativo tiram o dia letivo; o ano letivo limita as datas;
 *  - lotação: um professor ativo por disciplina da turma (trocar = encerrar + abrir, histórico preservado);
 *  - horário: aula = lotação + dia da semana + tempo do turno da turma; sem choque na turma nem no professor;
 *  - datas de aula do professor = dias da semana do horário ∩ período da lotação ∩ período do módulo da turma
 *    (em andamento/concluído) ∩ ano letivo ∩ dias letivos, até hoje;
 *  - chamada: faltas por aula; resultados.faltas = nº de aulas faltadas e
 *    frequência = 100 × (1 − horas faltadas ÷ CH da disciplina) (regra do PPC, src/lib/frequencia.ts).
 */
import { avaliarDisciplina, criteriosDoCurso } from './aprovacao';
import { ErroValidacao } from './form';

export const CATEGORIAS_FUNCIONARIO: [string, string][] = [
  ['professor', 'Professor(a)'], ['coordenador', 'Coordenador(a)'], ['diretor', 'Diretor(a)'],
  ['secretario', 'Secretário(a)'], ['administrativo', 'Administrativo'], ['outro', 'Outro'],
];

export const TIPOS_EVENTO: [string, string, boolean][] = [
  // [tipo, rótulo, é letivo?]
  ['feriado', 'Feriado', false],
  ['recesso', 'Recesso', false],
  ['ponto_facultativo', 'Ponto facultativo', false],
  ['dia_letivo_extra', 'Dia letivo extra', true],
  ['evento', 'Evento (informativo)', true],
];
export const ROTULO_EVENTO = Object.fromEntries(TIPOS_EVENTO.map(([t, r]) => [t, r]));
export const TIPOS_NAO_LETIVOS = TIPOS_EVENTO.filter(([, , letivo]) => !letivo).map(([t]) => t);

export const DIAS_GRADE: [number, string, string][] = [
  [1, 'SEG', 'Segunda'], [2, 'TER', 'Terça'], [3, 'QUA', 'Quarta'], [4, 'QUI', 'Quinta'], [5, 'SEX', 'Sexta'], [6, 'SÁB', 'Sábado'],
];
export const ROTULO_TURNO: Record<string, string> = { matutino: 'Matutino', vespertino: 'Vespertino', noturno: 'Noturno', integral: 'Integral' };

// ------------------------------------------------------------------ datas
const MS_DIA = 86_400_000;
const paraDia = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const paraISO = (t: number) => new Date(t).toISOString().slice(0, 10);

/** 1 = segunda ... 6 = sábado, 7 = domingo. */
export function diaDaSemana(iso: string): number {
  const d = new Date(paraDia(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function* diasEntre(inicio: string, fim: string): Generator<string> {
  for (let t = paraDia(inicio); t <= paraDia(fim); t += MS_DIA) yield paraISO(t);
}

export const minutosEntre = (inicio: string, fim: string) => {
  const m = (h: string) => +h.slice(0, 2) * 60 + +h.slice(3, 5);
  return m(fim) - m(inicio);
};

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Feriados nacionais (Lei 662/1949, 6.802/1980, 14.759/2023) + Carnaval, Sexta-feira Santa e Corpus Christi. */
export function feriadosNacionais(ano: number): { data: string; tipo: string; descricao: string }[] {
  const p = paraDia(pascoa(ano));
  const rel = (dias: number) => paraISO(p + dias * MS_DIA);
  const fixo = (md: string) => `${ano}-${md}`;
  return [
    { data: fixo('01-01'), tipo: 'feriado', descricao: 'Confraternização Universal' },
    { data: rel(-48), tipo: 'ponto_facultativo', descricao: 'Carnaval' },
    { data: rel(-47), tipo: 'ponto_facultativo', descricao: 'Carnaval' },
    { data: rel(-2), tipo: 'feriado', descricao: 'Sexta-feira Santa' },
    { data: fixo('04-21'), tipo: 'feriado', descricao: 'Tiradentes' },
    { data: fixo('05-01'), tipo: 'feriado', descricao: 'Dia do Trabalho' },
    { data: rel(60), tipo: 'ponto_facultativo', descricao: 'Corpus Christi' },
    { data: fixo('09-07'), tipo: 'feriado', descricao: 'Independência do Brasil' },
    { data: fixo('10-12'), tipo: 'feriado', descricao: 'Nossa Senhora Aparecida' },
    { data: fixo('11-02'), tipo: 'feriado', descricao: 'Finados' },
    { data: fixo('11-15'), tipo: 'feriado', descricao: 'Proclamação da República' },
    { data: fixo('11-20'), tipo: 'feriado', descricao: 'Dia Nacional de Zumbi e da Consciência Negra' },
    { data: fixo('12-25'), tipo: 'feriado', descricao: 'Natal' },
  ].sort((a, b) => a.data.localeCompare(b.data));
}

export interface AnoLetivo { id: number; ano: number; data_inicio: string; data_fim: string; situacao: string; observacao: string | null }

export async function anoLetivo(db: D1Database, ano: number): Promise<AnoLetivo | null> {
  return db.prepare('SELECT * FROM anos_letivos WHERE ano = ?').bind(ano).first<AnoLetivo>();
}

// ------------------------------------------------------------------ classificação dos dias (calendário visual, padrão sysGEP)
export type CodigoDia = 'L' | 'D' | 'S' | 'SL' | 'DL' | 'F' | 'NL';
/** [código, nome, é letivo?] — ordem da legenda */
export const CODIGOS_DIA: [CodigoDia, string, boolean][] = [
  ['D', 'Domingo', false], ['F', 'Feriado', false], ['L', 'Letivo', true], ['NL', 'Não letivo', false],
  ['S', 'Sábado', false], ['SL', 'Sábado letivo', true], ['DL', 'Domingo letivo', true],
];

export interface EventoDia { tipo: string; descricao: string }

/**
 * Código do dia: evento não letivo vence (feriado → F; recesso/ponto facultativo → NL); dia letivo extra torna letivo
 * o sábado (SL) e o domingo (DL); sem evento: segunda a sexta L, sábado S, domingo D. Fora do ano letivo: null.
 */
export function classificarDia(d: string, ano: { data_inicio: string; data_fim: string }, eventos: EventoDia[] = []): CodigoDia | null {
  if (d < ano.data_inicio || d > ano.data_fim) return null;
  if (eventos.some((e) => e.tipo === 'feriado')) return 'F';
  if (eventos.some((e) => TIPOS_NAO_LETIVOS.includes(e.tipo))) return 'NL';
  const dia = diaDaSemana(d);
  const extra = eventos.some((e) => e.tipo === 'dia_letivo_extra');
  if (dia === 6) return extra ? 'SL' : 'S';
  if (dia === 7) return extra ? 'DL' : 'D';
  return 'L';
}
export const ehLetivo = (c: CodigoDia | null) => c === 'L' || c === 'SL' || c === 'DL';

/** Eventos do calendário por dia (um evento de período vale em todos os seus dias). */
export async function eventosPorDia(db: D1Database, anoLetivoId: number): Promise<Map<string, (EventoDia & { id: number })[]>> {
  const evs = (await db.prepare('SELECT id, data_inicio, data_fim, tipo, descricao FROM calendario_eventos WHERE ano_letivo_id = ? ORDER BY data_inicio, id')
    .bind(anoLetivoId).all<{ id: number; data_inicio: string; data_fim: string; tipo: string; descricao: string }>()).results;
  const m = new Map<string, (EventoDia & { id: number })[]>();
  for (const e of evs) for (const d of diasEntre(e.data_inicio, e.data_fim)) m.set(d, [...(m.get(d) ?? []), { id: e.id, tipo: e.tipo, descricao: e.descricao }]);
  return m;
}

/** Dias letivos do ano: segunda a sexta + dias letivos extras, menos feriados/recessos/pontos facultativos. */
export async function contarDiasLetivos(db: D1Database, a: AnoLetivo): Promise<number> {
  const evs = await eventosPorDia(db, a.id);
  let n = 0;
  for (const d of diasEntre(a.data_inicio, a.data_fim)) if (ehLetivo(classificarDia(d, a, evs.get(d)))) n++;
  return n;
}

// ------------------------------------------------------------------ horário
export interface Tempo { turno: string; numero: number; hora_inicio: string; hora_fim: string }

export async function temposDoTurno(db: D1Database, turno: string | null): Promise<Tempo[]> {
  if (!turno) return [];
  return (await db.prepare('SELECT turno, numero, hora_inicio, hora_fim FROM horario_tempos WHERE turno = ? ORDER BY numero').bind(turno).all<Tempo>()).results;
}

export interface AulaGrade {
  id: number; lotacao_id: number; dia_semana: number; tempo: number;
  turma_id: number; turma: string; turno: string | null; componente_id: number; componente: string; funcionario_id: number;
  hora_inicio: string | null; hora_fim: string | null;
}

const SQL_GRADE = `
  SELECT ha.id, ha.lotacao_id, ha.dia_semana, ha.tempo, l.turma_id, t.codigo AS turma, t.turno, l.componente_id, cc.nome AS componente,
         l.funcionario_id, ht.hora_inicio, ht.hora_fim
    FROM horario_aulas ha JOIN lotacoes l ON l.id = ha.lotacao_id JOIN turmas t ON t.id = l.turma_id
    JOIN componentes_curriculares cc ON cc.id = l.componente_id
    LEFT JOIN horario_tempos ht ON ht.turno = t.turno AND ht.numero = ha.tempo`;

/** Aulas da grade nas lotações ativas (de um professor ou de uma turma). */
export async function gradeAtiva(db: D1Database, filtro: { funcionarioId?: number; turmaId?: number }): Promise<AulaGrade[]> {
  const cond = filtro.funcionarioId ? 'l.funcionario_id = ?' : 'l.turma_id = ?';
  return (await db.prepare(`${SQL_GRADE} WHERE l.data_fim IS NULL AND ${cond} ORDER BY ha.dia_semana, ht.hora_inicio, ha.tempo`)
    .bind(filtro.funcionarioId ?? filtro.turmaId).all<AulaGrade>()).results;
}

/**
 * Valida a inclusão (ou a mudança de lugar) de uma aula na grade: tempo existe no turno, sem choque na turma nem no
 * professor. `ignorarAulaId` = a própria aula que está sendo movida.
 */
export async function validarAulaGrade(db: D1Database, lotacaoId: number, dia: number, tempo: number, ignorarAulaId?: number): Promise<void> {
  const l = await db.prepare(
    `SELECT l.*, t.turno, t.codigo AS turma FROM lotacoes l JOIN turmas t ON t.id = l.turma_id WHERE l.id = ? AND l.data_fim IS NULL`,
  ).bind(lotacaoId).first<Record<string, any>>();
  if (!l) throw new ErroValidacao('Lotação não encontrada ou encerrada.');
  if (!l.turno) throw new ErroValidacao(`A turma ${l.turma} está sem turno: informe o turno na tela da turma.`);
  if (!DIAS_GRADE.some(([d]) => d === dia)) throw new ErroValidacao('Dia da semana inválido.');
  const t = (await temposDoTurno(db, l.turno)).find((x) => x.numero === tempo);
  if (!t) throw new ErroValidacao(`O turno ${ROTULO_TURNO[l.turno]} não tem o tempo ${tempo} (veja Tempos de aula).`);
  const daTurma = (await gradeAtiva(db, { turmaId: l.turma_id })).filter((a) => a.id !== ignorarAulaId);
  const choqueTurma = daTurma.find((a) => a.dia_semana === dia && a.tempo === tempo);
  if (choqueTurma) throw new ErroValidacao(`A turma ${l.turma} já tem ${choqueTurma.componente} nesse dia e tempo.`);
  const doProfessor = (await gradeAtiva(db, { funcionarioId: l.funcionario_id })).filter((a) => a.id !== ignorarAulaId);
  const choqueProf = doProfessor.find((a) => a.dia_semana === dia && a.hora_inicio && a.hora_fim
    && a.hora_inicio < t.hora_fim && t.hora_inicio < a.hora_fim);
  if (choqueProf) throw new ErroValidacao(`O professor já tem aula nesse horário: ${choqueProf.componente} na turma ${choqueProf.turma} (${choqueProf.hora_inicio}–${choqueProf.hora_fim}).`);
}

// ------------------------------------------------------------------ datas de aula (chamada)
export interface AulaPrevista {
  data: string; turma_id: number; turma: string; componente_id: number; componente: string; lotacao_id: number;
  funcionario_id: number; professor: string;
  tempo: number; hora_inicio: string; hora_fim: string; duracao_min: number;
}

/**
 * Aulas previstas do professor no ano letivo, até `ate` (normalmente hoje): grade de todas as lotações dele (ativas ou
 * encerradas) dentro dos períodos da lotação e do módulo da turma (em andamento/concluído), em dias letivos.
 */
export async function aulasPrevistasDoProfessor(db: D1Database, funcionarioId: number, ano: AnoLetivo, ate: string): Promise<AulaPrevista[]> {
  return aulasPrevistas(db, { funcionarioId }, ano, ate);
}

/** Aulas previstas da turma (todos os professores) — usada na correção de faltas pela Secretaria. */
export async function aulasPrevistasDaTurma(db: D1Database, turmaId: number, ano: AnoLetivo, ate: string): Promise<AulaPrevista[]> {
  return aulasPrevistas(db, { turmaId }, ano, ate);
}

async function aulasPrevistas(db: D1Database, filtro: { funcionarioId?: number; turmaId?: number }, ano: AnoLetivo, ate: string): Promise<AulaPrevista[]> {
  const grade = (await db.prepare(
    `SELECT ha.lotacao_id, ha.dia_semana, ha.tempo, l.turma_id, t.codigo AS turma, l.componente_id, cc.nome AS componente,
            l.funcionario_id, f.nome AS professor,
            ht.hora_inicio, ht.hora_fim, l.data_inicio AS l_ini, l.data_fim AS l_fim,
            tm.data_inicio AS m_ini, tm.data_fim AS m_fim, tm.situacao AS m_sit
       FROM horario_aulas ha JOIN lotacoes l ON l.id = ha.lotacao_id JOIN turmas t ON t.id = l.turma_id
       JOIN funcionarios f ON f.id = l.funcionario_id
       JOIN componentes_curriculares cc ON cc.id = l.componente_id
       JOIN horario_tempos ht ON ht.turno = t.turno AND ht.numero = ha.tempo
       LEFT JOIN turma_modulos tm ON tm.turma_id = l.turma_id AND tm.modulo_id = cc.modulo_id
      WHERE ${filtro.funcionarioId ? 'l.funcionario_id' : 'l.turma_id'} = ? AND t.ano_letivo = ?`,
  ).bind(filtro.funcionarioId ?? filtro.turmaId, ano.ano)
    .all<AulaGrade & { professor: string; l_ini: string; l_fim: string | null; m_ini: string | null; m_fim: string | null; m_sit: string | null }>()).results;
  if (!grade.length) return [];
  // mesma regra do Calendário Escolar: só dias letivos (L, SL, DL) — sábado só entra se marcado como dia letivo extra
  const evs = await eventosPorDia(db, ano.id);
  const letivo = (d: string) => ehLetivo(classificarDia(d, ano, evs.get(d)));
  const out: AulaPrevista[] = [];
  for (const g of grade) {
    if (!g.m_sit || g.m_sit === 'planejado' || !g.m_ini) continue; // módulo sem início: sem aula
    const ini = [ano.data_inicio, g.l_ini, g.m_ini].sort().at(-1)!;
    const fim = [ano.data_fim, g.l_fim ?? ano.data_fim, g.m_fim ?? ano.data_fim, ate].sort()[0];
    if (fim < ini) continue;
    for (const d of diasEntre(ini, fim)) {
      if (diaDaSemana(d) !== g.dia_semana || !letivo(d)) continue;
      out.push({ data: d, turma_id: g.turma_id, turma: g.turma, componente_id: g.componente_id, componente: g.componente, lotacao_id: g.lotacao_id,
        funcionario_id: g.funcionario_id, professor: g.professor, tempo: g.tempo, hora_inicio: g.hora_inicio!, hora_fim: g.hora_fim!, duracao_min: minutosEntre(g.hora_inicio!, g.hora_fim!) });
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data) || a.hora_inicio.localeCompare(b.hora_inicio) || a.turma.localeCompare(b.turma));
}

// ------------------------------------------------------------------ chamada → resultados
/**
 * Recalcula faltas e frequência da disciplina na turma a partir da chamada. Sem nenhuma aula registrada na chamada,
 * não mexe em nada (vale o lançamento manual/importação). Devolve o nº de alunos atualizados.
 */
export async function recalcularFrequenciaDaChamada(
  db: D1Database, turmaId: number, componenteId: number,
  quem: { usuario: string; origem?: string; professorId?: number | null } = { usuario: 'sistema' },
): Promise<number> {
  const registradas = await db.prepare('SELECT count(*) AS n FROM aulas WHERE turma_id = ? AND componente_id = ?').bind(turmaId, componenteId).first<{ n: number }>();
  if (!registradas?.n) return 0;
  const [cc, curso, linhas] = await Promise.all([
    db.prepare('SELECT nome, carga_horaria_total AS ch FROM componentes_curriculares WHERE id = ?').bind(componenteId).first<{ nome: string; ch: number }>(),
    db.prepare('SELECT cu.* FROM turmas t JOIN cursos cu ON cu.id = t.curso_id WHERE t.id = ?').bind(turmaId).first<any>(),
    db.prepare(
      `SELECT m.id AS matricula_id, r.id AS resultado_id, r.nota, r.nota_exame_final, r.faltas AS faltas_antes, r.frequencia AS freq_antes,
              (SELECT count(*) FROM faltas_aula f JOIN aulas a ON a.id = f.aula_id WHERE f.matricula_id = m.id AND a.turma_id = ?1 AND a.componente_id = ?2) AS faltas,
              (SELECT coalesce(sum(a.duracao_min), 0) FROM faltas_aula f JOIN aulas a ON a.id = f.aula_id WHERE f.matricula_id = m.id AND a.turma_id = ?1 AND a.componente_id = ?2) AS minutos
         FROM matriculas m LEFT JOIN resultados r ON r.matricula_id = m.id AND r.componente_id = ?2
        WHERE m.turma_id = ?1`,
    ).bind(turmaId, componenteId).all<Record<string, any>>(),
  ]);
  if (!cc || !curso) return 0;
  const criterios = criteriosDoCurso(curso);
  const cmds: D1PreparedStatement[] = [];
  for (const l of linhas.results) {
    const freq = Math.max(0, Math.round(100 * (1 - l.minutos / 60 / cc.ch) * 100) / 100);
    if (l.resultado_id && l.faltas_antes === l.faltas && l.freq_antes === freq) continue;
    const av = avaliarDisciplina({ componente: cc.nome, nota: l.nota ?? null, notaExameFinal: l.nota_exame_final ?? null, frequencia: freq }, criterios);
    const origem = quem.origem ?? 'chamada';
    cmds.push(db.prepare(
      `INSERT INTO resultados (matricula_id, componente_id, faltas, frequencia, resultado, atualizado_por, origem, professor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (matricula_id, componente_id) DO UPDATE SET faltas = excluded.faltas, frequencia = excluded.frequencia,
         resultado = excluded.resultado, atualizado_por = excluded.atualizado_por, origem = excluded.origem,
         professor_id = coalesce(excluded.professor_id, resultados.professor_id), atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    ).bind(l.matricula_id, componenteId, l.faltas, freq, av.resultado === 'PENDENTE' ? null : av.resultado, quem.usuario, origem, quem.professorId ?? null));
    // histórico do que mudou (vale a última chamada salva)
    for (const [campo, a, n] of [['faltas', l.faltas_antes ?? null, l.faltas], ['frequencia', l.freq_antes ?? null, freq]] as const) {
      if (a === n) continue;
      cmds.push(db.prepare(
        'INSERT INTO resultados_historico (matricula_id, componente_id, campo, valor_anterior, valor_novo, origem, professor_id, usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(l.matricula_id, componenteId, campo, a, n, origem, quem.professorId ?? null, quem.usuario));
    }
  }
  if (cmds.length) await db.batch(cmds);
  return cmds.length;
}

/** Disciplinas da turma com chamada registrada (as faltas vêm da chamada e não são digitadas). */
export async function disciplinasComChamada(db: D1Database, turmaId: number): Promise<Map<number, number>> {
  const r = (await db.prepare('SELECT componente_id, count(*) AS n FROM aulas WHERE turma_id = ? GROUP BY componente_id').bind(turmaId)
    .all<{ componente_id: number; n: number }>()).results;
  return new Map(r.map((x) => [x.componente_id, x.n]));
}
