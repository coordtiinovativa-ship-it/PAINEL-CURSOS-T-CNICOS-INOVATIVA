/**
 * Gestão Pedagógica → Faltas do Aluno (chamada do dia completo do professor).
 * Datas = aulas previstas do professor (grade × lotação × período do módulo × calendário letivo, até hoje).
 * Salvar grava a aula (turma + data + tempo, com a duração) e as faltas; depois recalcula faltas e frequência da
 * disciplina em Notas e Faltas (src/lib/pedagogico.ts → recalcularFrequenciaDaChamada).
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { lerCorpo } from '../lib/form';
import { dataBR } from '../lib/datas';
import { hojeMS, nomeDoAluno } from '../certificado/dados';
import { aulasPrevistasDoProfessor, DIAS_GRADE, diaDaSemana, recalcularFrequenciaDaChamada, type AnoLetivo, type AulaPrevista } from '../lib/pedagogico';

export const rotasChamada = new Hono<Env>();
rotasChamada.use('*', exigir('resultados.lancar'));

const BASE = '/admin/pedagogico/faltas';
const diaCurto = (iso: string) => DIAS_GRADE.find(([d]) => d === diaDaSemana(iso))?.[1] ?? 'DOM';
const sigla = (nome: string) => {
  const p = nome.split(/\s+/).filter((x) => x.length > 2 || /^[IVX]+$/.test(x));
  return p.length > 1 ? p.slice(0, 4).map((x) => (/^[IVX]+$/.test(x) ? x : x[0].toUpperCase())).join('') : nome.slice(0, 8);
};

const CSS = `
.filtros{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.6rem 1rem;align-items:end}
table.chamada th,table.chamada td{vertical-align:middle}
table.chamada th.aula{text-align:center;font-size:.78rem;line-height:1.25;min-width:5.5rem}
table.chamada th.aula b{display:block;font-size:.85rem;color:var(--texto)}
table.chamada td.pf{text-align:center}
.pf label{display:inline-flex;cursor:pointer}
.pf input{position:absolute;opacity:0;pointer-events:none}
.pf span{display:inline-grid;place-items:center;width:2rem;height:2rem;border-radius:50%;font-weight:800;background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-borda)}
.pf input:checked + span{background:var(--erro-bg);color:var(--erro);border-color:var(--erro-borda)}
.pf span::before{content:"P"} .pf input:checked + span::before{content:"F"}
.pf input:focus-visible + span{outline:3px solid var(--foco)}
.reg{font-size:.72rem;color:var(--texto-2);font-weight:400}
`;

const JS = `
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-todos]'); if(!b) return; e.preventDefault();
  document.querySelectorAll('input[data-col="'+b.dataset.todos+'"]').forEach(function(i){i.checked=false});
});`;

async function contexto(db: D1Database, q: Record<string, string>) {
  const anos = (await db.prepare('SELECT * FROM anos_letivos ORDER BY ano DESC').all<AnoLetivo>()).results;
  const ano = anos.find((a) => a.ano === Number(q.ano)) ?? anos.find((a) => a.ano === new Date().getFullYear()) ?? anos[0] ?? null;
  const profs = ano ? (await db.prepare(
    `SELECT DISTINCT f.id, f.nome FROM funcionarios f JOIN lotacoes l ON l.funcionario_id = f.id JOIN turmas t ON t.id = l.turma_id
      WHERE t.ano_letivo = ? ORDER BY f.nome`,
  ).bind(ano.ano).all<{ id: number; nome: string }>()).results : [];
  const prof = profs.find((p) => p.id === Number(q.prof)) ?? null;
  const previstas = ano && prof ? await aulasPrevistasDoProfessor(db, prof.id, ano, hojeMS()) : [];
  return { anos, ano, profs, prof, previstas };
}

rotasChamada.get('/', async (c) => {
  const db = c.env.DB;
  const q = c.req.query();
  const { anos, ano, profs, prof, previstas } = await contexto(db, q);
  const datas = [...new Set(previstas.map((a) => a.data))].sort().reverse();
  // chamadas já registradas (para marcar as datas)
  const registradas = prof && datas.length ? (await db.prepare(
    `SELECT data, turma_id, tempo FROM aulas WHERE data BETWEEN ? AND ? AND turma_id IN (${[...new Set(previstas.map((a) => a.turma_id))].join(',')})`,
  ).bind(datas.at(-1), datas[0]).all<{ data: string; turma_id: number; tempo: number }>()).results : [];
  const chave = (d: string, t: number, tempo: number) => `${d}|${t}|${tempo}`;
  const reg = new Set(registradas.map((r) => chave(r.data, r.turma_id, r.tempo)));
  const completa = (d: string) => previstas.filter((a) => a.data === d).every((a) => reg.has(chave(d, a.turma_id, a.tempo)));
  const data = datas.includes(q.data ?? '') ? q.data! : datas.find((d) => !completa(d)) ?? datas[0] ?? null;
  const doDia = data ? previstas.filter((a) => a.data === data) : [];
  const turmas = [...new Map(doDia.map((a) => [a.turma_id, a.turma])).entries()];

  // alunos e faltas já registradas no dia
  const alunos = new Map<number, Record<string, any>[]>();
  const faltas = new Set<string>();
  const registro = new Map<string, Record<string, any>>();
  for (const [turmaId] of turmas) {
    alunos.set(turmaId, (await db.prepare(
      `SELECT m.id, m.situacao, a.nome_civil, a.nome_social, a.usar_nome_social FROM matriculas m JOIN alunos a ON a.id = m.aluno_id
        WHERE m.turma_id = ? AND m.situacao <> 'desistente'
        ORDER BY CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END`,
    ).bind(turmaId).all<Record<string, any>>()).results);
  }
  if (data && turmas.length) {
    const rs = (await db.prepare(
      `SELECT au.id, au.turma_id, au.tempo, au.registrado_por, au.registrado_em, f.matricula_id FROM aulas au LEFT JOIN faltas_aula f ON f.aula_id = au.id
        WHERE au.data = ? AND au.turma_id IN (${turmas.map(([t]) => t).join(',')})`,
    ).bind(data).all<Record<string, any>>()).results;
    for (const r of rs) {
      registro.set(`${r.turma_id}|${r.tempo}`, r);
      if (r.matricula_id) faltas.add(`${r.turma_id}|${r.tempo}|${r.matricula_id}`);
    }
  }

  return c.html(
    <Pagina titulo="Faltas do aluno" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Faltas do aluno — dia completo</h1>
      <div class="cartao">
        <form method="get" class="filtros">
          <label>Ano letivo<select name="ano" onchange="this.form.prof.value='';this.form.submit()">{anos.map((a) => <option selected={a.id === ano?.id}>{a.ano}</option>)}</select></label>
          <label>Professor(a)<select name="prof" onchange="this.form.data.value='';this.form.submit()"><option value="">Selecione</option>
            {profs.map((p) => <option value={p.id} selected={p.id === prof?.id}>{p.nome}</option>)}</select></label>
          <label>Data<select name="data" onchange="this.form.submit()">
            {!datas.length && <option value="">Nenhuma aula prevista até hoje</option>}
            {datas.map((d) => <option value={d} selected={d === data}>{dataBR(d)} - {diaCurto(d)} {completa(d) ? '✓' : ''}</option>)}</select></label>
          <noscript><button class="sec">Abrir</button></noscript>
        </form>
        <p class="muted" style="margin-bottom:0">As datas vêm do horário do professor, dentro do período da lotação e do módulo, sem feriados e recessos do calendário. ✓ = chamada registrada.</p>
      </div>
      {!ano && <p class="muted">Cadastre o <a href="/admin/pedagogico/anos">ano letivo</a>.</p>}
      {ano && !profs.length && <p class="muted">Nenhum professor com lotação em {ano.ano}. Faça a <a href="/admin/pedagogico/lotacao">lotação</a> e monte o <a href="/admin/pedagogico/horario">horário</a>.</p>}
      {prof && !datas.length && <p class="muted">Nenhuma aula prevista até hoje para {prof.nome}: confira o <a href={`/admin/pedagogico/horario?ano=${ano!.ano}&prof=${prof.id}`}>horário</a>, o período do módulo na turma e o calendário.</p>}

      {data && turmas.length > 0 && (
        <form method="post" action={`${BASE}?ano=${ano!.ano}&prof=${prof!.id}&data=${data}`}>
          {turmas.map(([turmaId, turmaCod]) => {
            const aulasT = doDia.filter((a) => a.turma_id === turmaId);
            const lista = alunos.get(turmaId) ?? [];
            return (
              <div class="cartao">
                <h2 style="margin-top:0">Turma {turmaCod}</h2>
                <table class="chamada">
                  <tr>
                    <th style="width:2.5rem">#</th><th>Aluno</th><th>Situação</th>
                    {aulasT.map((a) => {
                      const r = registro.get(`${turmaId}|${a.tempo}`);
                      return (
                        <th class="aula" title={a.componente}>
                          <input type="hidden" name="aula" value={`${turmaId}:${a.tempo}`} />
                          <b>{a.tempo}º tempo</b>{sigla(a.componente)}<br />{a.hora_inicio}–{a.hora_fim}
                          <div class="reg">{r ? `registrada (${r.registrado_por})` : 'não registrada'}</div>
                          <a href="#" data-todos={`${turmaId}-${a.tempo}`} class="reg">todos presentes</a>
                        </th>
                      );
                    })}
                  </tr>
                  {lista.map((m, i) => (
                    <tr>
                      <td class="n">{i + 1}</td>
                      <td>{nomeDoAluno(m)}</td>
                      <td><span class={`tag ${m.situacao === 'cursando' ? 'ok' : ''}`}>{m.situacao}</span></td>
                      {aulasT.map((a) => (
                        <td class="pf">
                          <label title="Clique para alternar presença/falta">
                            <input type="checkbox" name={`falta_${turmaId}_${a.tempo}_${m.id}`} value="1" data-col={`${turmaId}-${a.tempo}`}
                              checked={faltas.has(`${turmaId}|${a.tempo}|${m.id}`)} />
                            <span />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </table>
                {!lista.length && <p class="muted">Nenhum aluno matriculado nesta turma.</p>}
              </div>
            );
          })}
          <div class="acoes"><button><Icone nome="salvar" />Salvar chamada de {dataBR(data)}</button>
            <span class="muted">P = presente, F = falta (clique para alternar). As faltas e a frequência da disciplina são atualizadas em Notas e Faltas.</span></div>
        </form>
      )}
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </Pagina>,
  );
});

rotasChamada.post('/', async (c) => {
  const db = c.env.DB;
  const q = c.req.query();
  const { prof, previstas } = await contexto(db, q);
  const data = q.data ?? '';
  const ir = (tipo: string, msg: string) => c.redirect(`${BASE}?ano=${q.ano ?? ''}&prof=${q.prof ?? ''}&data=${data}&${tipo}=` + encodeURIComponent(msg));
  if (!prof) return ir('erro', 'Selecione o professor.');
  const corpo = await lerCorpo(c);
  const enviadas = new Set(([] as unknown[]).concat(corpo.aula ?? []).map(String));
  // só aulas previstas para o professor nesse dia (não aceita turma/tempo de fora da grade)
  const aulas: AulaPrevista[] = previstas.filter((a) => a.data === data && enviadas.has(`${a.turma_id}:${a.tempo}`));
  if (!aulas.length) return ir('erro', 'Nenhuma aula prevista para esse professor nessa data.');

  const recalcular = new Set<string>();
  const resumo: Record<string, unknown>[] = [];
  for (const a of aulas) {
    const matriculas = (await db.prepare(`SELECT id FROM matriculas WHERE turma_id = ? AND situacao <> 'desistente'`).bind(a.turma_id).all<{ id: number }>()).results.map((m) => m.id);
    const faltosos = matriculas.filter((m) => corpo[`falta_${a.turma_id}_${a.tempo}_${m}`] != null);
    const antes = await db.prepare('SELECT id, componente_id FROM aulas WHERE turma_id = ? AND data = ? AND tempo = ?').bind(a.turma_id, data, a.tempo).first<{ id: number; componente_id: number }>();
    if (antes && antes.componente_id !== a.componente_id) recalcular.add(`${a.turma_id}|${antes.componente_id}`);
    const aula = await db.prepare(
      `INSERT INTO aulas (turma_id, componente_id, lotacao_id, funcionario_id, data, tempo, duracao_min, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (turma_id, data, tempo) DO UPDATE SET componente_id = excluded.componente_id, lotacao_id = excluded.lotacao_id,
         funcionario_id = excluded.funcionario_id, duracao_min = excluded.duracao_min, registrado_por = excluded.registrado_por,
         registrado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       RETURNING id`,
    ).bind(a.turma_id, a.componente_id, a.lotacao_id, prof.id, data, a.tempo, a.duracao_min, c.get('usuario').email).first<{ id: number }>();
    await db.batch([
      db.prepare('DELETE FROM faltas_aula WHERE aula_id = ?').bind(aula!.id),
      ...faltosos.map((m) => db.prepare('INSERT INTO faltas_aula (aula_id, matricula_id) VALUES (?, ?)').bind(aula!.id, m)),
    ]);
    recalcular.add(`${a.turma_id}|${a.componente_id}`);
    resumo.push({ turma: a.turma, disciplina: a.componente, tempo: a.tempo, faltas: faltosos.length, presentes: matriculas.length - faltosos.length });
  }
  for (const k of recalcular) {
    const [t, comp] = k.split('|').map(Number);
    await recalcularFrequenciaDaChamada(db, t, comp);
  }
  await auditar(c, 'registrar_chamada', 'funcionario', prof.id, null, { professor: prof.nome, data, aulas: resumo });
  const total = resumo.reduce((s, r) => s + (r.faltas as number), 0);
  return ir('ok', `Chamada de ${dataBR(data)} salva: ${aulas.length} aula(s), ${total} falta(s). Frequência atualizada em Notas e Faltas.`);
});
