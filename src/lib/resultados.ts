/**
 * Gravação de notas e faltas — fonte única para todas as telas (Gestão Pedagógica, Secretaria, chamada, importação).
 *
 * Regra "vale a última digitação" (18/11/2026): cada formulário envia, junto com o valor, o valor que MOSTROU na tela
 * (campo `o_...`). Só é gravado o que a pessoa realmente mudou; assim, se a secretaria e o professor estão com a mesma
 * tela aberta, um não desfaz o que o outro digitou e prevalece quem salvou por último. Apagar um valor (deixar vazio
 * o que tinha número) também é uma alteração.
 *
 * Cada gravação registra professor (lotação da disciplina), usuário e origem no resultado e cada campo alterado em
 * resultados_historico. Os documentos (certificado, histórico, declaração) usam sempre o valor atual.
 */
import { avaliarDisciplina, criteriosDoCurso } from './aprovacao';
import { calcularFrequencia } from './frequencia';
import { ErroValidacao, type Corpo } from './form';

export type Origem = 'professor' | 'secretaria' | 'chamada' | 'importacao';
export type CampoNota = 'nota' | 'exame' | 'faltas';

/** Valor de um campo do formulário: undefined = campo não veio; null = vazio; número = valor. */
function valorCampo(corpo: Corpo, campo: string, rotulo: string, inteiro = false): number | null | undefined {
  const v = corpo[campo];
  if (v === undefined) return undefined;
  const t = typeof v === 'string' ? v.trim() : '';
  if (t === '') return null;
  const n = Number(t.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new ErroValidacao(`${rotulo}: número inválido ("${t}")`);
  if (inteiro && !Number.isInteger(n)) throw new ErroValidacao(`${rotulo}: deve ser número inteiro`);
  return n;
}

/**
 * Lê do formulário só os campos que a pessoa alterou (comparando com o `o_<campo>_<matrícula>` mostrado na tela).
 * Devolve, por matrícula, os campos a gravar.
 */
export function lerAlteracoes(corpo: Corpo, matriculas: { id: number; nome: string }[], campos: CampoNota[]): Map<number, Partial<Record<CampoNota, number | null>>> {
  const out = new Map<number, Partial<Record<CampoNota, number | null>>>();
  const ROT: Record<CampoNota, string> = { nota: 'Média', exame: 'Exame final', faltas: 'Faltas' };
  for (const m of matriculas) {
    for (const campo of campos) {
      const novo = valorCampo(corpo, `${campo}_${m.id}`, `${ROT[campo]} de ${m.nome}`, campo === 'faltas');
      if (novo === undefined) continue; // campo não estava no formulário (ex.: aluno bloqueado)
      const mostrado = valorCampo(corpo, `o_${campo}_${m.id}`, ROT[campo], campo === 'faltas') ?? null;
      if (novo === mostrado) continue; // não mexeu: mantém o que estiver gravado (talvez alterado por outra pessoa)
      if (novo != null && campo !== 'faltas' && (novo < 0 || novo > 10)) throw new ErroValidacao(`${ROT[campo]} de ${m.nome} fora do intervalo 0–10.`);
      if (novo != null && campo === 'faltas' && novo < 0) throw new ErroValidacao(`Faltas de ${m.nome} não podem ser negativas.`);
      out.set(m.id, { ...(out.get(m.id) ?? {}), [campo]: novo });
    }
  }
  return out;
}

export interface Contexto {
  turmaId: number;
  componenteId: number;
  usuario: string;
  origem: Origem;
  /** professor da disciplina (lotação ativa) */
  professorId: number | null;
  /** tempo de cada aula (min) — necessário para gravar faltas pelo total */
  duracaoAula?: number | null;
  /** recalcula a frequência mesmo sem mudar as faltas (ex.: mudou o tempo da aula) */
  recalcularFrequencia?: boolean;
}

/** Grava as alterações (só os campos informados), recalcula frequência e AP/RP e registra o histórico. */
export async function gravarResultados(db: D1Database, ctx: Contexto, alteracoes: Map<number, Partial<Record<CampoNota, number | null>>>) {
  if (!alteracoes.size) return { alunos: 0, campos: 0 };
  const [cc, curso, atuais] = await Promise.all([
    db.prepare('SELECT nome, carga_horaria_total AS ch FROM componentes_curriculares WHERE id = ?').bind(ctx.componenteId).first<{ nome: string; ch: number }>(),
    db.prepare('SELECT cu.* FROM turmas t JOIN cursos cu ON cu.id = t.curso_id WHERE t.id = ?').bind(ctx.turmaId).first<any>(),
    db.prepare(`SELECT r.* FROM resultados r JOIN matriculas m ON m.id = r.matricula_id WHERE m.turma_id = ? AND r.componente_id = ?`)
      .bind(ctx.turmaId, ctx.componenteId).all<Record<string, any>>(),
  ]);
  if (!cc || !curso) throw new ErroValidacao('Disciplina ou turma não encontrada.');
  const criterios = criteriosDoCurso(curso);
  const porMat = new Map(atuais.results.map((r) => [r.matricula_id as number, r]));
  const cmds: D1PreparedStatement[] = [];
  let campos = 0;
  let alunos = 0;
  for (const [mat, alt] of alteracoes) {
    const antes = porMat.get(mat);
    const novo = {
      nota: antes?.nota ?? null as number | null,
      exame: antes?.nota_exame_final ?? null as number | null,
      faltas: antes?.faltas ?? null as number | null,
      frequencia: antes?.frequencia ?? null as number | null,
    };
    const hist: [string, number | null, number | null][] = [];
    for (const [campo, valor] of Object.entries(alt) as [CampoNota, number | null][]) {
      const anterior = campo === 'exame' ? novo.exame : novo[campo];
      if (anterior === valor) continue;
      hist.push([campo, anterior, valor]);
      if (campo === 'exame') novo.exame = valor; else novo[campo] = valor;
    }
    if ('faltas' in alt && (hist.some(([c]) => c === 'faltas') || ctx.recalcularFrequencia)) {
      if (novo.faltas != null && !ctx.duracaoAula) throw new ErroValidacao('Informe o tempo de cada aula antes de lançar faltas.');
      const freq = novo.faltas == null ? null : calcularFrequencia(novo.faltas, ctx.duracaoAula!, cc.ch);
      if (freq !== novo.frequencia) hist.push(['frequencia', novo.frequencia, freq]);
      novo.frequencia = freq;
    }
    if (!hist.length) continue;
    alunos++;
    const av = avaliarDisciplina({ componente: cc.nome, nota: novo.nota, notaExameFinal: novo.exame, frequencia: novo.frequencia }, criterios);
    cmds.push(db.prepare(
      `INSERT INTO resultados (matricula_id, componente_id, nota, nota_exame_final, faltas, frequencia, resultado, atualizado_por, origem, professor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (matricula_id, componente_id) DO UPDATE SET nota = excluded.nota, nota_exame_final = excluded.nota_exame_final,
         faltas = excluded.faltas, frequencia = excluded.frequencia, resultado = excluded.resultado, atualizado_por = excluded.atualizado_por,
         origem = excluded.origem, professor_id = excluded.professor_id, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    ).bind(mat, ctx.componenteId, novo.nota, novo.exame, novo.faltas, novo.frequencia, av.resultado === 'PENDENTE' ? null : av.resultado,
      ctx.usuario, ctx.origem, ctx.professorId));
    for (const [campo, a, n] of hist) {
      cmds.push(db.prepare(
        'INSERT INTO resultados_historico (matricula_id, componente_id, campo, valor_anterior, valor_novo, origem, professor_id, usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(mat, ctx.componenteId, campo, a, n, ctx.origem, ctx.professorId, ctx.usuario));
      campos++;
    }
  }
  if (cmds.length) await db.batch(cmds);
  return { alunos, campos };
}
