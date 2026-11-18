/**
 * Lançamento de notas e de faltas (pedido de 18/11/2026):
 *  - Gestão Pedagógica → Lançamento de Notas (/admin/pedagogico/notas, `resultados.lancar`): o coordenador escolhe a turma
 *    e lança as notas de todos os alunos, disciplina a disciplina. Aluno com matrícula não ativa fica bloqueado.
 *  - Secretaria → Notas (/admin/notas, `resultados.corrigir`): mesma tela; corrige qualquer aluno.
 *  - Secretaria → Faltas → Total por disciplina (/admin/faltas/total): faltas pelo total, só em disciplina sem chamada.
 * Toda nota fica vinculada ao professor da disciplina (lotação ativa — sem lotação, não lança). Vale a última digitação
 * (src/lib/resultados.ts): só o que a pessoa mudou é gravado, com quem, quando, origem e histórico.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, inteiro, lerCorpo, numBR } from '../lib/form';
import { dataBR } from '../lib/datas';
import { avaliarDisciplina, criteriosDoCurso } from '../lib/aprovacao';
import { aulasPrevistas as totalAulasPrevistas } from '../lib/frequencia';
import { modulosDaTurma, ROTULO_SITUACAO } from '../lib/turmaModulos';
import { nomeDoAluno } from '../certificado/dados';
import { classeStatus, estaAtiva, ROTULO_STATUS } from '../lib/matricula';
import { gradeAtiva, minutosEntre } from '../lib/pedagogico';
import { gravarResultados, lerAlteracoes, type CampoNota, type Origem } from '../lib/resultados';

type Modo = 'professor' | 'secretaria' | 'faltas';
const ROTULO_ORIGEM: Record<string, string> = { professor: 'Gestão Pedagógica', secretaria: 'Secretaria', chamada: 'chamada', importacao: 'planilha' };
const quandoMS = (iso: string) => {
  const d = new Date(Date.parse(iso) - 4 * 3600_000).toISOString();
  return `${dataBR(d)} ${d.slice(11, 16)}`;
};

const CSS = `
.filtros{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.6rem 1rem;align-items:end}
.abas-modo{display:flex;gap:.4rem;margin:0 0 .8rem}
.abas-modo a{padding:.35rem .8rem;border:1px solid var(--borda);border-radius:999px;text-decoration:none;color:var(--texto-2);font-size:.86rem}
.abas-modo a.ativa{border-color:var(--ciano);color:var(--titulo);font-weight:650;background:var(--superficie)}
.info-disc{display:flex;gap:.5rem;flex-wrap:wrap;margin:.2rem 0 .8rem}
.info-disc .chip{display:inline-flex;gap:.3rem;padding:.2rem .65rem;border-radius:999px;background:var(--superficie);border:1px solid var(--borda);font-size:.82rem;color:var(--texto-2)}
.info-disc .chip b{color:var(--texto)}
table.lanc td{vertical-align:middle}
table.lanc input{width:5.2rem;text-align:right}
table.lanc tr.inativo td{opacity:.7}
table.lanc td.freq{font-weight:650;white-space:nowrap} table.lanc td.freq.baixa{color:var(--erro)}
.ult{font-size:.74rem;color:var(--texto-2);line-height:1.25}
`;

interface Filtros {
  ano: number; anos: number[];
  turmas: { id: number; codigo: string }[]; turma: Record<string, any> | null;
  modulos: Awaited<ReturnType<typeof modulosDaTurma>>; modulo: Awaited<ReturnType<typeof modulosDaTurma>>[number] | null;
  discs: { id: number; nome: string; ch: number }[]; disc: { id: number; nome: string; ch: number } | null;
}

async function lerFiltros(db: D1Database, q: Record<string, string>): Promise<Filtros> {
  const anos = (await db.prepare('SELECT DISTINCT ano_letivo AS ano FROM turmas WHERE ano_letivo IS NOT NULL ORDER BY ano DESC').all<{ ano: number }>()).results.map((x) => x.ano);
  const ano = Number(q.ano) || anos[0] || new Date().getFullYear();
  const turmas = (await db.prepare('SELECT id, codigo FROM turmas WHERE ano_letivo = ? ORDER BY codigo').bind(ano).all<{ id: number; codigo: string }>()).results;
  const tSel = turmas.find((t) => t.id === Number(q.turma)) ?? (turmas.length === 1 ? turmas[0] : null);
  const turma = tSel ? await db.prepare('SELECT t.*, cu.nome AS curso FROM turmas t JOIN cursos cu ON cu.id = t.curso_id WHERE t.id = ?').bind(tSel.id).first<Record<string, any>>() : null;
  const modulos = turma ? (await modulosDaTurma(db, turma.id)) : [];
  const iniciados = modulos.filter((m) => m.situacao !== 'planejado');
  const modulo = iniciados.find((m) => m.modulo_id === Number(q.modulo)) ?? iniciados.find((m) => m.situacao === 'em_andamento') ?? iniciados.at(-1) ?? null;
  const discs = modulo ? (await db.prepare('SELECT id, nome, carga_horaria_total AS ch FROM componentes_curriculares WHERE modulo_id = ? ORDER BY ordem')
    .bind(modulo.modulo_id).all<{ id: number; nome: string; ch: number }>()).results : [];
  const disc = discs.find((d) => d.id === Number(q.disciplina)) ?? discs[0] ?? null;
  return { ano, anos, turmas, turma, modulos, modulo, discs, disc };
}

const FormFiltros = ({ f }: { f: Filtros }) => (
  <form method="get" class="filtros">
    <label>Ano letivo<select name="ano" onchange="this.form.turma.value='';this.form.submit()">{(f.anos.length ? f.anos : [f.ano]).map((a) => <option selected={a === f.ano}>{a}</option>)}</select></label>
    <label>Turma<select name="turma" onchange="this.form.modulo.value='';this.form.disciplina.value='';this.form.submit()"><option value="">Selecione</option>
      {f.turmas.map((t) => <option value={t.id} selected={t.id === f.turma?.id}>{t.codigo}</option>)}</select></label>
    <label>Módulo<select name="modulo" onchange="this.form.disciplina.value='';this.form.submit()">
      {f.modulos.filter((m) => m.situacao !== 'planejado').map((m) => <option value={m.modulo_id} selected={m.modulo_id === f.modulo?.modulo_id}>
        {m.ordem}. {m.nome} ({ROTULO_SITUACAO[m.situacao].toLowerCase()})</option>)}</select></label>
    <label>Disciplina<select name="disciplina" onchange="this.form.submit()">
      {f.discs.map((d) => <option value={d.id} selected={d.id === f.disc?.id}>{d.nome} ({d.ch} h)</option>)}</select></label>
    <noscript><button class="sec">Abrir</button></noscript>
  </form>
);

/** Dados da disciplina na turma: professor (lotação ativa), tempo da aula (grade ou manual), chamada, alunos e resultados. */
async function dadosDisciplina(db: D1Database, f: Filtros) {
  const t = f.turma!, d = f.disc!;
  const [lotacao, grade, td, chamadas, alunos, res, curso] = await Promise.all([
    db.prepare(`SELECT l.id, f.id AS funcionario_id, f.nome FROM lotacoes l JOIN funcionarios f ON f.id = l.funcionario_id
                 WHERE l.turma_id = ? AND l.componente_id = ? AND l.data_fim IS NULL`).bind(t.id, d.id).first<{ id: number; funcionario_id: number; nome: string }>(),
    gradeAtiva(db, { turmaId: t.id }),
    db.prepare('SELECT duracao_aula_min FROM turma_disciplinas WHERE turma_id = ? AND componente_id = ?').bind(t.id, d.id).first<{ duracao_aula_min: number | null }>(),
    db.prepare('SELECT count(*) AS n FROM aulas WHERE turma_id = ? AND componente_id = ?').bind(t.id, d.id).first<{ n: number }>(),
    db.prepare(
      `SELECT m.id, m.status, a.nome_civil, a.nome_social, a.usar_nome_social FROM matriculas m JOIN alunos a ON a.id = m.aluno_id
        WHERE m.turma_id = ? ORDER BY m.status <> 'ativa',
              CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END`,
    ).bind(t.id).all<Record<string, any>>(),
    db.prepare(`SELECT r.*, f.nome AS professor FROM resultados r JOIN matriculas m ON m.id = r.matricula_id LEFT JOIN funcionarios f ON f.id = r.professor_id
                 WHERE m.turma_id = ? AND r.componente_id = ?`).bind(t.id, d.id).all<Record<string, any>>(),
    db.prepare('SELECT * FROM cursos WHERE id = ?').bind(t.curso_id).first<any>(),
  ]);
  const g = lotacao ? grade.filter((a) => a.lotacao_id === lotacao.id && a.hora_inicio && a.hora_fim) : [];
  const durGrade = g.length ? minutosEntre(g[0].hora_inicio!, g[0].hora_fim!) : null;
  return {
    lotacao, durGrade, dur: durGrade ?? td?.duracao_aula_min ?? null, chamadas: chamadas?.n ?? 0,
    alunos: alunos.results, porMat: new Map(res.results.map((r) => [r.matricula_id as number, r])), criterios: criteriosDoCurso(curso),
  };
}

const Ultima = ({ r }: { r?: Record<string, any> }) =>
  r?.atualizado_por ? <div class="ult">{ROTULO_ORIGEM[r.origem] ?? r.origem ?? ''} · {r.atualizado_por}<br />{quandoMS(r.atualizado_em)}</div> : <span class="ult">—</span>;

function qsDe(f: Filtros) {
  return `?ano=${f.ano}&turma=${f.turma?.id ?? ''}&modulo=${f.modulo?.modulo_id ?? ''}&disciplina=${f.disc?.id ?? ''}`;
}

// ================================================================== NOTAS
export function criarRotasNotas(modo: 'professor' | 'secretaria') {
  const rotas = new Hono<Env>();
  rotas.use('*', exigir(modo === 'professor' ? 'resultados.lancar' : 'resultados.corrigir'));
  const BASE = modo === 'professor' ? '/admin/pedagogico/notas' : '/admin/notas';

  rotas.get('/', async (c) => {
    const db = c.env.DB;
    const f = await lerFiltros(db, c.req.query());
    const x = f.turma && f.disc ? await dadosDisciplina(db, f) : null;
    const linkLot = f.turma ? `/admin/pedagogico/lotacao?ano=${f.ano}&turma=${f.turma.id}&modulo=${f.modulo?.modulo_id ?? ''}` : '/admin/pedagogico/lotacao';
    return c.html(
      <Pagina titulo={modo === 'professor' ? 'Lançamento de notas' : 'Notas'} usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <h1>{modo === 'professor' ? 'Lançamento de notas' : 'Notas'}</h1>
        <div class="cartao"><FormFiltros f={f} />
          <p class="muted" style="margin-bottom:0">{modo === 'professor'
            ? 'Todos os alunos da turma aparecem; matrícula não ativa fica bloqueada (correção só pela Secretaria). '
            : 'A Secretaria corrige qualquer aluno, inclusive com matrícula não ativa. '}
            Vale a última alteração salva: só os campos que você mudar são gravados, com seu nome, data e hora.</p>
        </div>
        {!f.turmas.length && <p class="muted">Nenhuma turma no ano letivo {f.ano}.</p>}
        {f.turma && !f.modulo && <div class="msg aviso">Nenhum módulo iniciado nesta turma: inicie o módulo na <a href={`/admin/turmas/${f.turma.id}`}>tela da turma</a>.</div>}
        {x && f.disc && f.turma && f.modulo && (
          <>
            <div class="info-disc">
              <span class="chip">Turma <b>{f.turma.codigo}</b></span>
              <span class="chip">Módulo {f.modulo.ordem}: <b>{f.modulo.nome}</b></span>
              <span class="chip">CH <b>{f.disc.ch} h</b></span>
              <span class="chip">Professor(a) {x.lotacao ? <b>{x.lotacao.nome}</b> : <a href={linkLot}>sem lotação</a>}</span>
              <span class="chip">Faltas {x.chamadas ? <b>da chamada ({x.chamadas} aula(s))</b> : <b>pelo total</b>}</span>
              <span class="chip">Mínimos <b>{numBR(x.criterios.frequenciaMinima)}% · média {numBR(x.criterios.notaMinima)}</b></span>
            </div>
            {!x.lotacao && <div class="msg erro">As notas ficam vinculadas ao professor da disciplina: faça a <a href={linkLot}>lotação</a> antes de lançar.</div>}
            <form method="post" action={`${BASE}${qsDe(f)}`}>
              <table class="lanc">
                <tr><th style="width:2.5rem">#</th><th>Aluno</th><th>Status</th><th class="n">Média</th><th class="n">Exame final</th>
                  <th class="n">Faltas</th><th class="n">Frequência</th><th class="c">Resultado</th><th>Última alteração</th></tr>
                {x.alunos.map((m, i) => {
                  const r = x.porMat.get(m.id);
                  const bloqueado = !x.lotacao || (modo === 'professor' && !estaAtiva(m.status));
                  const av = avaliarDisciplina({ componente: f.disc!.nome, nota: r?.nota ?? null, notaExameFinal: r?.nota_exame_final ?? null, frequencia: r?.frequencia ?? null }, x.criterios);
                  const campo = (nome: CampoNota, v: number | null | undefined) => bloqueado
                    ? <span>{v == null ? '—' : numBR(v, 2)}</span>
                    : <><input type="hidden" name={`o_${nome}_${m.id}`} value={numBR(v, 2)} /><input name={`${nome}_${m.id}`} inputmode="decimal" value={numBR(v, 2)} /></>;
                  return (
                    <tr class={estaAtiva(m.status) ? '' : 'inativo'}>
                      <td class="n">{i + 1}</td>
                      <td>{nomeDoAluno(m)}</td>
                      <td><span class={`tag ${classeStatus(m.status)}`}>{ROTULO_STATUS[m.status] ?? m.status}</span>
                        {modo === 'professor' && !estaAtiva(m.status) && <div class="ult">só a Secretaria corrige</div>}</td>
                      <td class="n">{campo('nota', r?.nota)}</td>
                      <td class="n">{campo('exame', r?.nota_exame_final)}</td>
                      <td class="n">{r?.faltas ?? '—'}</td>
                      <td class={`n freq ${r?.frequencia != null && r.frequencia < x.criterios.frequenciaMinima ? 'baixa' : ''}`}>{r?.frequencia != null ? `${numBR(r.frequencia, 2)}%` : '—'}</td>
                      <td class="c" title={av.motivos.join('\n')}><span class={`tag ${av.resultado}`}>{av.resultado === 'PENDENTE' ? '—' : av.resultado}</span></td>
                      <td><Ultima r={r} /></td>
                    </tr>
                  );
                })}
              </table>
              {!x.alunos.length && <p class="muted">Nenhum aluno matriculado nesta turma.</p>}
              <div class="acoes"><button disabled={!x.lotacao || !x.alunos.length}><Icone nome="salvar" />Salvar notas de {f.disc.nome}</button>
                <span class="muted">Média e exame de 0 a 10 (aceita vírgula). Apagar um valor também é uma alteração. Faltas: {x.chamadas
                  ? <a href={modo === 'professor' ? '/admin/pedagogico/faltas' : '/admin/faltas'}>chamada</a>
                  : modo === 'secretaria' ? <a href={`/admin/faltas/total${qsDe(f)}`}>Faltas → total por disciplina</a> : 'Faltas do Aluno (chamada)'}.</span></div>
            </form>
          </>
        )}
      </Pagina>,
    );
  });

  rotas.post('/', async (c) => {
    const db = c.env.DB;
    const f = await lerFiltros(db, c.req.query());
    const ir = (tipo: string, msg: string) => c.redirect(`${BASE}${qsDe(f)}&${tipo}=` + encodeURIComponent(msg));
    if (!f.turma || !f.modulo || !f.disc || Number(c.req.query('disciplina')) !== f.disc.id) return ir('erro', 'Selecione turma, módulo e disciplina.');
    const x = await dadosDisciplina(db, f);
    if (!x.lotacao) return ir('erro', 'Faça a lotação do professor da disciplina antes de lançar notas.');
    const corpo = await lerCorpo(c);
    try {
      // professor (Gestão Pedagógica) não altera aluno com matrícula não ativa
      const editaveis = x.alunos.filter((m) => modo === 'secretaria' || estaAtiva(m.status)).map((m) => ({ id: m.id as number, nome: nomeDoAluno(m) }));
      const alt = lerAlteracoes(corpo, editaveis, ['nota', 'exame']);
      const r = await gravarResultados(db, {
        turmaId: f.turma.id, componenteId: f.disc.id, usuario: c.get('usuario').email, origem: modo as Origem, professorId: x.lotacao.funcionario_id,
      }, alt);
      if (r.alunos) {
        await auditar(c, 'lancar_notas', 'componente_curricular', f.disc.id, null, {
          modo, turma: f.turma.codigo, disciplina: f.disc.nome, professor: x.lotacao.nome,
          alteracoes: [...alt.entries()].map(([mat, v]) => ({ matricula_id: mat, ...v })),
        });
      }
      return ir('ok', r.alunos ? `${r.alunos} aluno(s) atualizado(s).` : 'Nenhuma alteração para salvar.');
    } catch (e) {
      if (e instanceof ErroValidacao) return ir('erro', e.message);
      throw e;
    }
  });

  return rotas;
}

// ================================================================== FALTAS PELO TOTAL (Secretaria, disciplina sem chamada)
export const rotasFaltasTotal = new Hono<Env>();
rotasFaltasTotal.use('*', exigir('resultados.corrigir'));
const BASE_TOTAL = '/admin/faltas/total';

rotasFaltasTotal.get('/', async (c) => {
  const db = c.env.DB;
  const f = await lerFiltros(db, c.req.query());
  const x = f.turma && f.disc ? await dadosDisciplina(db, f) : null;
  const previstas = x?.dur && f.disc ? totalAulasPrevistas(f.disc.ch, x.dur) : null;
  return c.html(
    <Pagina titulo="Faltas — total por disciplina" usuario={c.get('usuario')} caminho="/admin/faltas" ok={c.req.query('ok')} erro={c.req.query('erro')} voltar="/admin/faltas">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Faltas</h1>
      <div class="abas-modo"><a href="/admin/faltas">Por dia (chamada)</a><a class="ativa" href={BASE_TOTAL}>Total por disciplina (sem chamada)</a></div>
      <div class="cartao"><FormFiltros f={f} />
        <p class="muted" style="margin-bottom:0">Para disciplina <b>sem chamada</b> registrada: lance o total de faltas (em nº de aulas). Com chamada, corrija pelo dia
          em <a href="/admin/faltas">Por dia (chamada)</a>. Vale a última alteração salva.</p>
      </div>
      {x && f.disc && f.turma && (
        <>
          <div class="info-disc">
            <span class="chip">Professor(a) <b>{x.lotacao?.nome ?? 'sem lotação'}</b></span>
            <span class="chip">Tempo da aula <b>{x.dur ? `${x.dur} min` : '—'}</b>{x.durGrade ? ' (pela grade)' : ''}</span>
            {previstas && <span class="chip">Aulas previstas <b>{previstas}</b></span>}
          </div>
          {x.chamadas > 0 ? (
            <div class="msg ok">Esta disciplina tem chamada registrada ({x.chamadas} aula(s)): as faltas vêm dela. Corrija pelo dia em <a href="/admin/faltas">Por dia (chamada)</a>.</div>
          ) : !x.lotacao ? (
            <div class="msg erro">As faltas ficam vinculadas ao professor da disciplina: faça a <a href="/admin/pedagogico/lotacao">lotação</a> antes de lançar.</div>
          ) : (
            <>
              {!x.durGrade && (
                <form method="post" action={`${BASE_TOTAL}/tempo${qsDe(f)}`} class="acoes">
                  <label>Tempo de cada aula (min) — sem horário na grade
                    <input type="number" name="duracao_aula_min" min={10} max={600} value={x.dur ?? ''} required placeholder="ex.: 45" /></label>
                  <button class="sec" style="align-self:flex-end"><Icone nome="salvar" />Salvar</button>
                </form>
              )}
              <form method="post" action={`${BASE_TOTAL}${qsDe(f)}`}>
                <table class="lanc">
                  <tr><th style="width:2.5rem">#</th><th>Aluno</th><th>Status</th><th class="n">Faltas (aulas)</th><th class="n">Frequência</th><th>Última alteração</th></tr>
                  {x.alunos.map((m, i) => {
                    const r = x.porMat.get(m.id);
                    return (
                      <tr class={estaAtiva(m.status) ? '' : 'inativo'}>
                        <td class="n">{i + 1}</td><td>{nomeDoAluno(m)}</td>
                        <td><span class={`tag ${classeStatus(m.status)}`}>{ROTULO_STATUS[m.status] ?? m.status}</span></td>
                        <td class="n"><input type="hidden" name={`o_faltas_${m.id}`} value={r?.faltas ?? ''} />
                          <input name={`faltas_${m.id}`} inputmode="numeric" value={r?.faltas ?? ''} disabled={!x.dur} /></td>
                        <td class={`n freq ${r?.frequencia != null && r.frequencia < x.criterios.frequenciaMinima ? 'baixa' : ''}`}>{r?.frequencia != null ? `${numBR(r.frequencia, 2)}%` : '—'}</td>
                        <td><Ultima r={r} /></td>
                      </tr>
                    );
                  })}
                </table>
                <div class="acoes"><button disabled={!x.dur || !x.alunos.length}><Icone nome="salvar" />Salvar faltas</button>
                  <span class="muted">Frequência = 100% − (faltas × tempo da aula ÷ carga horária).</span></div>
              </form>
            </>
          )}
        </>
      )}
    </Pagina>,
  );
});

rotasFaltasTotal.post('/', async (c) => {
  const db = c.env.DB;
  const f = await lerFiltros(db, c.req.query());
  const ir = (tipo: string, msg: string) => c.redirect(`${BASE_TOTAL}${qsDe(f)}&${tipo}=` + encodeURIComponent(msg));
  if (!f.turma || !f.disc || Number(c.req.query('disciplina')) !== f.disc.id) return ir('erro', 'Selecione turma, módulo e disciplina.');
  const x = await dadosDisciplina(db, f);
  if (x.chamadas) return ir('erro', 'Esta disciplina tem chamada registrada: corrija as faltas pelo dia.');
  if (!x.lotacao) return ir('erro', 'Faça a lotação do professor da disciplina antes de lançar faltas.');
  if (!x.dur) return ir('erro', 'Informe o tempo de cada aula antes de lançar faltas.');
  const previstas = totalAulasPrevistas(f.disc.ch, x.dur);
  try {
    const alt = lerAlteracoes(await lerCorpo(c), x.alunos.map((m) => ({ id: m.id as number, nome: nomeDoAluno(m) })), ['faltas']);
    for (const [mat, v] of alt) {
      if (v.faltas != null && v.faltas > previstas) {
        throw new ErroValidacao(`Faltas de ${nomeDoAluno(x.alunos.find((m) => m.id === mat)!)}: ${v.faltas} (o máximo é ${previstas} aulas previstas).`);
      }
    }
    const r = await gravarResultados(db, {
      turmaId: f.turma.id, componenteId: f.disc.id, usuario: c.get('usuario').email, origem: 'secretaria', professorId: x.lotacao.funcionario_id, duracaoAula: x.dur,
    }, alt);
    if (r.alunos) await auditar(c, 'lancar_faltas_total', 'componente_curricular', f.disc.id, null, { turma: f.turma.codigo, disciplina: f.disc.nome, alteracoes: [...alt.entries()] });
    return ir('ok', r.alunos ? `${r.alunos} aluno(s) atualizado(s).` : 'Nenhuma alteração para salvar.');
  } catch (e) {
    if (e instanceof ErroValidacao) return ir('erro', e.message);
    throw e;
  }
});

rotasFaltasTotal.post('/tempo', async (c) => {
  const db = c.env.DB;
  const f = await lerFiltros(db, c.req.query());
  const ir = (tipo: string, msg: string) => c.redirect(`${BASE_TOTAL}${qsDe(f)}&${tipo}=` + encodeURIComponent(msg));
  if (!f.turma || !f.disc) return ir('erro', 'Selecione turma, módulo e disciplina.');
  const x = await dadosDisciplina(db, f);
  if (x.durGrade) return ir('erro', 'O tempo da aula vem do horário (tempos do turno).');
  try {
    const dur = inteiro(await lerCorpo(c), 'duracao_aula_min', 'Tempo de cada aula');
    if (!dur || dur < 10 || dur > 600) throw new ErroValidacao('Tempo de cada aula deve estar entre 10 e 600 minutos.');
    await db.prepare(
      `INSERT INTO turma_disciplinas (turma_id, componente_id, duracao_aula_min) VALUES (?, ?, ?)
       ON CONFLICT (turma_id, componente_id) DO UPDATE SET duracao_aula_min = excluded.duracao_aula_min, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    ).bind(f.turma.id, f.disc.id, dur).run();
    // com faltas já lançadas pelo total, a frequência acompanha o novo tempo
    const comFaltas = [...x.porMat.values()].filter((r) => r.faltas != null);
    if (comFaltas.length && x.dur !== dur) {
      const alt = new Map(comFaltas.map((r) => [r.matricula_id as number, { faltas: r.faltas as number }]));
      await gravarResultados(db, { turmaId: f.turma.id, componenteId: f.disc.id, usuario: c.get('usuario').email, origem: 'secretaria',
        professorId: x.lotacao?.funcionario_id ?? null, duracaoAula: dur, recalcularFrequencia: true }, alt);
    }
    await auditar(c, 'atualizar_disciplina_turma', 'turma', f.turma.id, { duracao_aula_min: x.dur }, { disciplina: f.disc.nome, duracao_aula_min: dur });
    return ir('ok', 'Tempo das aulas salvo.');
  } catch (e) {
    if (e instanceof ErroValidacao) return ir('erro', e.message);
    throw e;
  }
});

export const rotasNotasProfessor = criarRotasNotas('professor');
export const rotasNotasSecretaria = criarRotasNotas('secretaria');
