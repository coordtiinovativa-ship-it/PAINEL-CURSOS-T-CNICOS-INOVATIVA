/**
 * Importação de notas e frequência de uma turma + módulo, com conferência da aprovação (PPC 11.1.1).
 * Formatos: "largo" (uma linha por aluno, colunas "Disciplina | Média/Exame/Frequência") ou
 * "longo" (uma linha por aluno+disciplina). Células vazias = sem alteração.
 */
import { avaliarDisciplina, avaliarModulo, criteriosDoCurso, type AvaliacaoModulo, type CriteriosAprovacao } from '../lib/aprovacao';
import { formatarCPF } from '../lib/cpf';
import { ErroValidacao, numBR } from '../lib/form';
import { nomeDoAluno } from '../certificado/dados';
import { exigirModuloIniciado } from '../lib/turmaModulos';
import { chave, gerarCSV, normalizarCPF, normalizarNumero, type Tabela } from './planilha';

type Campo = 'nota' | 'exame' | 'freq';
const ROTULO_CAMPO: Record<Campo, string> = { nota: 'Média', exame: 'Exame', freq: 'Frequência (%)' };
const SUFIXOS: [RegExp, Campo][] = [
  [/^(media|nota|media_final|nf|mf|media_do_modulo)(_|$)/, 'nota'],
  [/^(exame|exame_final|ex|ef|recuperacao|nota_exame)(_|$)/, 'exame'],
  [/^(frequencia|freq|f|presenca|frequencia_final)(_|$)/, 'freq'],
];
const campoPorTexto = (s: string): Campo | null => SUFIXOS.find(([re]) => re.test(s))?.[1] ?? null;

interface Componente { id: number; nome: string; ch: number }
interface Matricula { id: number; aluno_id: number; status: string; cpf: string; ra: string | null; nome_civil: string; nome_social: string | null; usar_nome_social: number }
type Valores = { nota: number | null; exame: number | null; freq: number | null };

export interface Alteracao { componenteId: number; disciplina: string; antes: Valores; depois: Valores }
export interface LinhaNotas {
  linha: number;
  aluno: string;
  matriculaId: number | null;
  erros: string[];
  alteracoes: Alteracao[];
  avaliacao: AvaliacaoModulo | null;
}
export interface AnaliseNotas {
  formato: 'largo' | 'longo';
  linhas: LinhaNotas[];
  ausentes: string[]; // matriculados que não aparecem na planilha
  colunasIgnoradas: string[];
  totais: { alunos: number; alteracoes: number; erros: number; aprovados: number; reprovados: number; pendentes: number };
}

async function contexto(db: D1Database, turmaId: number, moduloId: number) {
  const turma = await db.prepare(
    `SELECT t.id, t.codigo, cu.* FROM turmas t JOIN cursos cu ON cu.id = t.curso_id
      JOIN modulos_tematicos mt ON mt.matriz_id = t.matriz_id AND mt.id = ? WHERE t.id = ?`,
  ).bind(moduloId, turmaId).first<Record<string, any>>();
  if (!turma) throw new ErroValidacao('Turma ou módulo inválido.');
  const [comps, mats, res] = await Promise.all([
    db.prepare('SELECT id, nome, carga_horaria_total AS ch FROM componentes_curriculares WHERE modulo_id = ? ORDER BY ordem').bind(moduloId).all<Componente>(),
    // a importação é da Secretaria: entram todos os alunos da turma, inclusive com matrícula não ativa
    db.prepare(`SELECT m.id, m.aluno_id, m.status, a.cpf, a.ra, a.nome_civil, a.nome_social, a.usar_nome_social FROM matriculas m JOIN alunos a ON a.id = m.aluno_id
                 WHERE m.turma_id = ? ORDER BY CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END`).bind(turmaId).all<Matricula>(),
    db.prepare(`SELECT r.* FROM resultados r JOIN matriculas m ON m.id = r.matricula_id WHERE m.turma_id = ?
                 AND r.componente_id IN (SELECT id FROM componentes_curriculares WHERE modulo_id = ?)`).bind(turmaId, moduloId).all<Record<string, any>>(),
  ]);
  const atuais = new Map(res.results.map((r) => [`${r.matricula_id}:${r.componente_id}`, { nota: r.nota, exame: r.nota_exame_final, freq: r.frequencia, aproveitada: !!r.aproveitado_de_resultado_id }]));
  // disciplinas com chamada (Faltas do Aluno): a frequência vem da chamada e não é importada
  const comChamada = new Set((await db.prepare('SELECT DISTINCT componente_id FROM aulas WHERE turma_id = ?').bind(turmaId).all<{ componente_id: number }>()).results.map((x) => x.componente_id));
  return { turma, criterios: criteriosDoCurso(turma as any), comps: comps.results, mats: mats.results, atuais, comChamada };
}

const nomeDe = (m: Matricula) => nomeDoAluno(m);

/** Modelo já preenchido com os alunos da turma, disciplinas do módulo e valores atuais. */
export async function modeloNotasCSV(db: D1Database, turmaId: number, moduloId: number): Promise<string> {
  const { comps, mats, atuais } = await contexto(db, turmaId, moduloId);
  const cab = ['CPF', 'RA', 'Nome'];
  for (const c of comps) cab.push(`${c.nome} | Média`, `${c.nome} | Exame`, `${c.nome} | Frequência (%)`);
  const fmt = (n: number | null | undefined) => (n == null ? '' : numBR(n, 2));
  return gerarCSV([
    cab,
    ...mats.map((m) => [
      formatarCPF(m.cpf), m.ra ?? '', nomeDe(m),
      ...comps.flatMap((c) => {
        const v = atuais.get(`${m.id}:${c.id}`);
        return [fmt(v?.nota), fmt(v?.exame), fmt(v?.freq)];
      }),
    ]),
  ]);
}

function localizarMatricula(mats: Matricula[], cpf: string | null, ra: string | null, nome: string | null): Matricula | null {
  if (cpf) return mats.find((m) => m.cpf === cpf) ?? null;
  if (ra) return mats.find((m) => m.ra === ra) ?? null;
  if (nome) {
    const k = chave(nome);
    const achados = mats.filter((m) => chave(m.nome_civil) === k || (m.nome_social && chave(m.nome_social) === k));
    return achados.length === 1 ? achados[0] : null;
  }
  return null;
}

export async function analisarNotas(db: D1Database, tabela: Tabela, turmaId: number, moduloId: number): Promise<AnaliseNotas> {
  if (tabela.length < 2) throw new ErroValidacao('A planilha está vazia ou só tem o cabeçalho.');
  const { turma, criterios, comps, mats, atuais, comChamada } = await contexto(db, turmaId, moduloId);
  const freqIgnorada = new Set<string>();
  const nomeModulo = (await db.prepare('SELECT nome FROM modulos_tematicos WHERE id = ?').bind(moduloId).first<{ nome: string }>())?.nome ?? '';
  await exigirModuloIniciado(db, turmaId, moduloId, `${nomeModulo} (turma ${turma.codigo})`);
  const cab = tabela[0].map(chave);
  const col = (...nomes: string[]) => cab.findIndex((h) => nomes.includes(h));
  const iCpf = col('cpf', 'cpf_do_aluno');
  const iRa = col('ra', 'matricula', 'registro_academico');
  const iNome = col('nome', 'nome_civil', 'aluno', 'nome_do_aluno', 'estudante');
  if (iCpf < 0 && iRa < 0 && iNome < 0) throw new ErroValidacao('A planilha precisa de uma coluna para identificar o aluno: CPF, RA ou Nome.');
  const compPorChave = comps.map((c) => ({ c, k: chave(c.nome) })).sort((a, b) => b.k.length - a.k.length);
  const acharComp = (texto: string) => compPorChave.find((x) => x.k === chave(texto))?.c ?? null;

  // ---- detecta formato
  const iDisc = col('disciplina', 'componente', 'componente_curricular');
  const colunasLargas: { i: number; comp: Componente; campo: Campo }[] = [];
  const ignoradas: string[] = [];
  if (iDisc < 0) {
    cab.forEach((h, i) => {
      if ([iCpf, iRa, iNome].includes(i) || !h) return;
      const x = compPorChave.find((y) => h.startsWith(`${y.k}_`));
      const campo = x ? campoPorTexto(h.slice(x.k.length + 1)) : null;
      if (x && campo) colunasLargas.push({ i, comp: x.c, campo });
      else ignoradas.push(tabela[0][i]);
    });
    if (!colunasLargas.length) {
      throw new ErroValidacao('Não reconheci colunas de disciplinas. Use "Disciplina | Média", "Disciplina | Exame" e "Disciplina | Frequência (%)", ou baixe o modelo da turma.');
    }
  }
  const iNota = col('media', 'nota', 'media_final', 'nf');
  const iExame = col('exame', 'exame_final', 'recuperacao');
  const iFreq = col('frequencia', 'frequencia_', 'freq', 'frequencia_final', 'presenca');
  if (iDisc >= 0 && iNota < 0 && iFreq < 0) throw new ErroValidacao('No formato "uma linha por disciplina", informe as colunas Média e/ou Frequência.');

  // ---- lê valores por (matrícula, componente)
  const novos = new Map<string, Partial<Valores>>();
  const linhasPorMat = new Map<number, LinhaNotas>();
  const semAluno: LinhaNotas[] = [];
  tabela.slice(1).forEach((bruta, idx) => {
    const n = idx + 2;
    const cpf = iCpf >= 0 ? normalizarCPF(bruta[iCpf] ?? '') : null;
    const ra = iRa >= 0 ? (bruta[iRa] ?? '').replace(/\.0+$/, '').trim() || null : null;
    const nome = iNome >= 0 ? (bruta[iNome] ?? '').trim() || null : null;
    const m = localizarMatricula(mats, cpf, ra, nome);
    if (!m) {
      const id = cpf ? `CPF ${cpf.length === 11 ? formatarCPF(cpf) : cpf}` : ra ? `RA ${ra}` : nome ?? '(sem identificação)';
      semAluno.push({ linha: n, aluno: nome ?? id, matriculaId: null, erros: [`${id}: aluno não está matriculado nesta turma`], alteracoes: [], avaliacao: null });
      return;
    }
    const lin = linhasPorMat.get(m.id) ?? { linha: n, aluno: nomeDe(m), matriculaId: m.id, erros: [], alteracoes: [], avaliacao: null };
    linhasPorMat.set(m.id, lin);
    const registrar = (comp: Componente, campo: Campo, bruto: string) => {
      try {
        const v = normalizarNumero(bruto ?? '', `${comp.nome} — ${ROTULO_CAMPO[campo]}`);
        if (v == null) return;
        if (campo === 'freq' && comChamada.has(comp.id)) { freqIgnorada.add(comp.nome); return; }
        const max = campo === 'freq' ? 100 : 10;
        if (v < 0 || v > max) throw new ErroValidacao(`${comp.nome} — ${ROTULO_CAMPO[campo]}: ${numBR(v, 2)} fora do intervalo 0–${max}`);
        const k = `${m.id}:${comp.id}`;
        novos.set(k, { ...(novos.get(k) ?? {}), [campo]: v });
      } catch (e) {
        lin.erros.push(`Linha ${n}: ${(e as Error).message}`);
      }
    };
    if (iDisc >= 0) {
      const comp = acharComp(bruta[iDisc] ?? '');
      if (!comp) { lin.erros.push(`Linha ${n}: disciplina "${bruta[iDisc]}" não pertence a este módulo`); return; }
      if (iNota >= 0) registrar(comp, 'nota', bruta[iNota]);
      if (iExame >= 0) registrar(comp, 'exame', bruta[iExame]);
      if (iFreq >= 0) registrar(comp, 'freq', bruta[iFreq]);
    } else for (const c of colunasLargas) registrar(c.comp, c.campo, bruta[c.i]);
  });

  // ---- alterações e conferência da aprovação
  for (const [matId, lin] of linhasPorMat) {
    const resultadoFinal = comps.map((comp) => {
      const k = `${matId}:${comp.id}`;
      const antes = atuais.get(k);
      const novo = novos.get(k) ?? {};
      const a: Valores = { nota: antes?.nota ?? null, exame: antes?.exame ?? null, freq: antes?.freq ?? null };
      const d: Valores = { nota: novo.nota ?? a.nota, exame: novo.exame ?? a.exame, freq: novo.freq ?? a.freq };
      if (d.nota !== a.nota || d.exame !== a.exame || d.freq !== a.freq) lin.alteracoes.push({ componenteId: comp.id, disciplina: comp.nome, antes: a, depois: d });
      return { componente: comp.nome, nota: d.nota, notaExameFinal: d.exame, frequencia: d.freq, aproveitada: antes?.aproveitada };
    });
    lin.avaliacao = avaliarModulo(comps.map((c) => c.nome), resultadoFinal, criterios);
  }

  const linhas = [...linhasPorMat.values(), ...semAluno].sort((a, b) => a.linha - b.linha);
  const ausentes = mats.filter((m) => !linhasPorMat.has(m.id) && m.status === 'ativa').map(nomeDe);
  const comAval = linhas.filter((l) => l.avaliacao);
  return {
    formato: iDisc >= 0 ? 'longo' : 'largo',
    linhas,
    ausentes,
    colunasIgnoradas: [...ignoradas, ...[...freqIgnorada].map((n) => `${n} | Frequência (vem da chamada em Faltas do Aluno)`)],
    totais: {
      alunos: linhasPorMat.size,
      alteracoes: linhas.reduce((s, l) => s + l.alteracoes.length, 0),
      erros: linhas.reduce((s, l) => s + l.erros.length, 0),
      aprovados: comAval.filter((l) => l.avaliacao!.aprovado).length,
      reprovados: comAval.filter((l) => !l.avaliacao!.aprovado && l.avaliacao!.disciplinas.some((d) => d.resultado === 'RP')).length,
      pendentes: comAval.filter((l) => !l.avaliacao!.aprovado && !l.avaliacao!.disciplinas.some((d) => d.resultado === 'RP')).length,
    },
  };
}

/** Grava as alterações (linhas sem erro), recalculando AP/RP, em um lote atômico. */
export async function aplicarNotas(db: D1Database, analise: AnaliseNotas, criterios: CriteriosAprovacao, usuario = 'importacao') {
  const cmds: D1PreparedStatement[] = [];
  // professor da disciplina (lotação ativa) para vincular o lançamento, como nas telas
  const turmaId = analise.linhas.find((l) => l.matriculaId)?.matriculaId
    ? (await db.prepare('SELECT turma_id FROM matriculas WHERE id = ?').bind(analise.linhas.find((l) => l.matriculaId)!.matriculaId).first<{ turma_id: number }>())?.turma_id
    : null;
  const professores = new Map(turmaId
    ? (await db.prepare('SELECT componente_id, funcionario_id FROM lotacoes WHERE turma_id = ? AND data_fim IS NULL').bind(turmaId)
        .all<{ componente_id: number; funcionario_id: number }>()).results.map((x) => [x.componente_id, x.funcionario_id])
    : []);
  for (const l of analise.linhas) {
    if (l.erros.length || !l.matriculaId) continue;
    for (const a of l.alteracoes) {
      const av = avaliarDisciplina({ componente: a.disciplina, nota: a.depois.nota, notaExameFinal: a.depois.exame, frequencia: a.depois.freq }, criterios);
      const prof = professores.get(a.componenteId) ?? null;
      cmds.push(
        db.prepare(
          `INSERT INTO resultados (matricula_id, componente_id, nota, nota_exame_final, frequencia, resultado, atualizado_por, origem, professor_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'importacao', ?)
           ON CONFLICT (matricula_id, componente_id) DO UPDATE SET nota = excluded.nota, nota_exame_final = excluded.nota_exame_final,
             frequencia = excluded.frequencia, resultado = excluded.resultado, atualizado_por = excluded.atualizado_por, origem = excluded.origem,
             professor_id = coalesce(excluded.professor_id, resultados.professor_id), atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
        ).bind(l.matriculaId, a.componenteId, a.depois.nota, a.depois.exame, a.depois.freq, av.resultado === 'PENDENTE' ? null : av.resultado, usuario, prof),
      );
      for (const [campo, antes, depois] of [['nota', a.antes.nota, a.depois.nota], ['exame', a.antes.exame, a.depois.exame], ['frequencia', a.antes.freq, a.depois.freq]] as const) {
        if (antes === depois) continue;
        cmds.push(db.prepare(
          `INSERT INTO resultados_historico (matricula_id, componente_id, campo, valor_anterior, valor_novo, origem, professor_id, usuario) VALUES (?, ?, ?, ?, ?, 'importacao', ?, ?)`,
        ).bind(l.matriculaId, a.componenteId, campo, antes, depois, prof, usuario));
      }
    }
  }
  if (cmds.length) await db.batch(cmds);
  return { comandos: cmds.length };
}

export async function criteriosDaTurma(db: D1Database, turmaId: number): Promise<CriteriosAprovacao> {
  const cu = await db.prepare('SELECT cu.* FROM turmas t JOIN cursos cu ON cu.id = t.curso_id WHERE t.id = ?').bind(turmaId).first<any>();
  return criteriosDoCurso(cu);
}

export function conferenciaNotasCSV(analise: AnaliseNotas): string {
  return gerarCSV([
    ['Linha', 'Aluno', 'Situação no módulo após importar', 'Motivos', 'Erros'],
    ...analise.linhas.map((l) => [
      l.linha, l.aluno,
      !l.avaliacao ? 'não importado' : l.avaliacao.aprovado ? 'Aprovado' : l.avaliacao.disciplinas.some((d) => d.resultado === 'RP') ? 'Reprovado' : 'Notas incompletas',
      l.avaliacao?.motivos.join(' | ') ?? '', l.erros.join(' | '),
    ]),
  ]);
}
