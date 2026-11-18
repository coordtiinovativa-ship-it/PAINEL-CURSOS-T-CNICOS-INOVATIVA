/**
 * Chamada (faltas por aula) em dois lugares:
 *  - Gestão Pedagógica → Faltas do Aluno (`modo: 'professor'`, /admin/pedagogico/faltas): dia completo do professor.
 *    Aluno com matrícula não ativa aparece bloqueado: correção só pela Secretaria.
 *  - Secretaria → Faltas (`modo: 'secretaria'`, /admin/faltas): por turma e dia; corrige qualquer aluno.
 * Datas = aulas previstas (grade × lotação × período do módulo × calendário letivo, até hoje).
 * "Vale a última digitação": cada célula leva o valor mostrado (o_falta_...); só as células alteradas são gravadas.
 * Depois recalcula faltas e frequência da disciplina (src/lib/pedagogico.ts → recalcularFrequenciaDaChamada).
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { lerCorpo } from '../lib/form';
import { dataBR } from '../lib/datas';
import { hojeMS, nomeDoAluno } from '../certificado/dados';
import { classeStatus, estaAtiva, ROTULO_STATUS } from '../lib/matricula';
import {
  aulasPrevistasDaTurma, aulasPrevistasDoProfessor, DIAS_GRADE, diaDaSemana, recalcularFrequenciaDaChamada, type AnoLetivo, type AulaPrevista,
} from '../lib/pedagogico';

type Modo = 'professor' | 'secretaria';
const BASES: Record<Modo, string> = { professor: '/admin/pedagogico/faltas', secretaria: '/admin/faltas' };
const diaCurto = (iso: string) => DIAS_GRADE.find(([d]) => d === diaDaSemana(iso))?.[1] ?? 'DOM';
const sigla = (nome: string) => {
  const p = nome.split(/\s+/).filter((x) => x.length > 2 || /^[IVX]+$/.test(x));
  return p.length > 1 ? p.slice(0, 4).map((x) => (/^[IVX]+$/.test(x) ? x : x[0].toUpperCase())).join('') : nome.slice(0, 8);
};

const CSS = `
.filtros{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.6rem 1rem;align-items:end}
.abas-modo{display:flex;gap:.4rem;margin:0 0 .8rem}
.abas-modo a{padding:.35rem .8rem;border:1px solid var(--borda);border-radius:999px;text-decoration:none;color:var(--texto-2);font-size:.86rem}
.abas-modo a.ativa{border-color:var(--ciano);color:var(--titulo);font-weight:650;background:var(--superficie)}
table.chamada th,table.chamada td{vertical-align:middle}
table.chamada th.aula{text-align:center;font-size:.78rem;line-height:1.25;min-width:5.5rem}
table.chamada th.aula b{display:block;font-size:.85rem;color:var(--texto)}
table.chamada td.pf{text-align:center}
table.chamada tr.inativo td{opacity:.65}
.pf label{display:inline-flex;cursor:pointer}
.pf input{position:absolute;opacity:0;pointer-events:none}
.pf span{display:inline-grid;place-items:center;width:2rem;height:2rem;border-radius:50%;font-weight:800;background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-borda)}
.pf input:checked + span{background:var(--erro-bg);color:var(--erro);border-color:var(--erro-borda)}
.pf span::before{content:"P"} .pf input:checked + span::before{content:"F"}
.pf input:disabled + span{cursor:not-allowed;filter:grayscale(.6)}
.pf input:focus-visible + span{outline:3px solid var(--foco)}
.reg{font-size:.72rem;color:var(--texto-2);font-weight:400}
`;

const JS = `
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-todos]'); if(!b) return; e.preventDefault();
  document.querySelectorAll('input[data-col="'+b.dataset.todos+'"]:not(:disabled)').forEach(function(i){i.checked=false});
});`;

export function criarRotasChamada(modo: Modo) {
  const rotas = new Hono<Env>();
  rotas.use('*', exigir(modo === 'professor' ? 'resultados.lancar' : 'resultados.corrigir'));
  const BASE = BASES[modo];

  async function contexto(db: D1Database, q: Record<string, string>) {
    const anos = (await db.prepare('SELECT * FROM anos_letivos ORDER BY ano DESC').all<AnoLetivo>()).results;
    const ano = anos.find((a) => a.ano === Number(q.ano)) ?? anos.find((a) => a.ano === new Date().getFullYear()) ?? anos[0] ?? null;
    // professor (Gestão Pedagógica) ou turma (Secretaria)
    const opcoes = !ano ? [] : modo === 'professor'
      ? (await db.prepare(`SELECT DISTINCT f.id, f.nome FROM funcionarios f JOIN lotacoes l ON l.funcionario_id = f.id JOIN turmas t ON t.id = l.turma_id
          WHERE t.ano_letivo = ? ORDER BY f.nome`).bind(ano.ano).all<{ id: number; nome: string }>()).results
      : (await db.prepare('SELECT id, codigo AS nome FROM turmas WHERE ano_letivo = ? ORDER BY codigo').bind(ano.ano).all<{ id: number; nome: string }>()).results;
    const chaveSel = modo === 'professor' ? 'prof' : 'turma';
    const sel = opcoes.find((p) => p.id === Number(q[chaveSel])) ?? (modo === 'secretaria' && opcoes.length === 1 ? opcoes[0] : null);
    const previstas = ano && sel
      ? modo === 'professor' ? await aulasPrevistasDoProfessor(db, sel.id, ano, hojeMS()) : await aulasPrevistasDaTurma(db, sel.id, ano, hojeMS())
      : [];
    return { anos, ano, opcoes, sel, chaveSel, previstas };
  }

  rotas.get('/', async (c) => {
    const db = c.env.DB;
    const q = c.req.query();
    const { anos, ano, opcoes, sel, chaveSel, previstas } = await contexto(db, q);
    const datas = [...new Set(previstas.map((a) => a.data))].sort().reverse();
    const turmasIds = [...new Set(previstas.map((a) => a.turma_id))];
    const registradas = sel && datas.length ? (await db.prepare(
      `SELECT data, turma_id, tempo FROM aulas WHERE data BETWEEN ? AND ? AND turma_id IN (${turmasIds.join(',')})`,
    ).bind(datas.at(-1), datas[0]).all<{ data: string; turma_id: number; tempo: number }>()).results : [];
    const reg = new Set(registradas.map((r) => `${r.data}|${r.turma_id}|${r.tempo}`));
    const completa = (d: string) => previstas.filter((a) => a.data === d).every((a) => reg.has(`${d}|${a.turma_id}|${a.tempo}`));
    const data = datas.includes(q.data ?? '') ? q.data! : datas.find((d) => !completa(d)) ?? datas[0] ?? null;
    const doDia = data ? previstas.filter((a) => a.data === data) : [];
    const turmas = [...new Map(doDia.map((a) => [a.turma_id, a.turma])).entries()];

    const alunos = new Map<number, Record<string, any>[]>();
    const faltas = new Set<string>();
    const registro = new Map<string, Record<string, any>>();
    for (const [turmaId] of turmas) {
      alunos.set(turmaId, (await db.prepare(
        `SELECT m.id, m.status, a.nome_civil, a.nome_social, a.usar_nome_social FROM matriculas m JOIN alunos a ON a.id = m.aluno_id
          WHERE m.turma_id = ? ORDER BY m.status <> 'ativa',
                CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END`,
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
    const qs = `?ano=${ano?.ano ?? ''}&${chaveSel}=${sel?.id ?? ''}&data=${data ?? ''}`;

    return c.html(
      <Pagina titulo={modo === 'professor' ? 'Faltas do aluno' : 'Faltas — correção'} usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <h1>{modo === 'professor' ? 'Faltas do aluno — dia completo' : 'Faltas'}</h1>
        {modo === 'secretaria' && (
          <div class="abas-modo"><a class="ativa" href={BASE}>Por dia (chamada)</a><a href="/admin/faltas/total">Total por disciplina (sem chamada)</a></div>
        )}
        <div class="cartao">
          <form method="get" class="filtros">
            <label>Ano letivo<select name="ano" onchange={`this.form.${chaveSel}.value='';this.form.submit()`}>{anos.map((a) => <option selected={a.id === ano?.id}>{a.ano}</option>)}</select></label>
            <label>{modo === 'professor' ? 'Professor(a)' : 'Turma'}<select name={chaveSel} onchange="this.form.data.value='';this.form.submit()"><option value="">Selecione</option>
              {opcoes.map((p) => <option value={p.id} selected={p.id === sel?.id}>{p.nome}</option>)}</select></label>
            <label>Data<select name="data" onchange="this.form.submit()">
              {!datas.length && <option value="">Nenhuma aula prevista até hoje</option>}
              {datas.map((d) => <option value={d} selected={d === data}>{dataBR(d)} - {diaCurto(d)} {completa(d) ? '✓' : ''}</option>)}</select></label>
            <noscript><button class="sec">Abrir</button></noscript>
          </form>
          <p class="muted" style="margin-bottom:0">As datas vêm do horário, dentro do período da lotação e do módulo, sem feriados e recessos do calendário. ✓ = chamada registrada.
            {modo === 'professor' ? ' Alunos com matrícula não ativa aparecem bloqueados: a correção é feita pela Secretaria.' : ' A Secretaria corrige qualquer aluno, inclusive com matrícula não ativa.'}
            {' '}Vale a última alteração salva.</p>
        </div>
        {!ano && <p class="muted">Cadastre o <a href="/admin/pedagogico/anos">ano letivo</a>.</p>}
        {ano && !opcoes.length && <p class="muted">{modo === 'professor' ? `Nenhum professor com lotação em ${ano.ano}.` : `Nenhuma turma em ${ano.ano}.`} Faça a <a href="/admin/pedagogico/lotacao">lotação</a> e monte o <a href="/admin/pedagogico/horario">horário</a>.</p>}
        {sel && !datas.length && <p class="muted">Nenhuma aula prevista até hoje: confira o <a href="/admin/pedagogico/horario">horário</a>, o período do módulo na turma e o calendário.</p>}

        {data && turmas.length > 0 && (
          <form method="post" action={`${BASE}${qs}`}>
            {turmas.map(([turmaId, turmaCod]) => {
              const aulasT = doDia.filter((a) => a.turma_id === turmaId);
              const lista = alunos.get(turmaId) ?? [];
              return (
                <div class="cartao">
                  <h2 style="margin-top:0">Turma {turmaCod}</h2>
                  <table class="chamada">
                    <tr>
                      <th style="width:2.5rem">#</th><th>Aluno</th><th>Status</th>
                      {aulasT.map((a) => {
                        const r = registro.get(`${turmaId}|${a.tempo}`);
                        return (
                          <th class="aula" title={`${a.componente} — ${a.professor}`}>
                            <input type="hidden" name="aula" value={`${turmaId}:${a.tempo}`} />
                            <b>{a.tempo}º tempo</b>{sigla(a.componente)}<br />{a.hora_inicio}–{a.hora_fim}
                            {modo === 'secretaria' && <div class="reg">{a.professor}</div>}
                            <div class="reg">{r ? `registrada (${r.registrado_por})` : 'não registrada'}</div>
                            <a href="#" data-todos={`${turmaId}-${a.tempo}`} class="reg">todos presentes</a>
                          </th>
                        );
                      })}
                    </tr>
                    {lista.map((m, i) => {
                      const bloqueado = modo === 'professor' && !estaAtiva(m.status);
                      return (
                        <tr class={estaAtiva(m.status) ? '' : 'inativo'}>
                          <td class="n">{i + 1}</td>
                          <td>{nomeDoAluno(m)}</td>
                          <td><span class={`tag ${classeStatus(m.status)}`}>{ROTULO_STATUS[m.status] ?? m.status}</span>{bloqueado && <div class="reg">só a Secretaria corrige</div>}</td>
                          {aulasT.map((a) => {
                            const k = `${turmaId}_${a.tempo}_${m.id}`;
                            const marcada = faltas.has(`${turmaId}|${a.tempo}|${m.id}`);
                            return (
                              <td class="pf">
                                <label title={bloqueado ? 'Matrícula não ativa: correção só pela Secretaria' : 'Clique para alternar presença/falta'}>
                                  {!bloqueado && <input type="hidden" name={`o_falta_${k}`} value={marcada ? '1' : '0'} />}
                                  <input type="checkbox" name={bloqueado ? undefined : `falta_${k}`} value="1" data-col={`${turmaId}-${a.tempo}`} checked={marcada} disabled={bloqueado} />
                                  <span />
                                </label>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </table>
                  {!lista.length && <p class="muted">Nenhum aluno matriculado nesta turma.</p>}
                </div>
              );
            })}
            <div class="acoes"><button><Icone nome="salvar" />Salvar chamada de {dataBR(data)}</button>
              <span class="muted">P = presente, F = falta (clique para alternar). As faltas e a frequência da disciplina são atualizadas na hora.</span></div>
          </form>
        )}
        <script dangerouslySetInnerHTML={{ __html: JS }} />
      </Pagina>,
    );
  });

  rotas.post('/', async (c) => {
    const db = c.env.DB;
    const q = c.req.query();
    const { sel, chaveSel, previstas } = await contexto(db, q);
    const data = q.data ?? '';
    const ir = (tipo: string, msg: string) => c.redirect(`${BASE}?ano=${q.ano ?? ''}&${chaveSel}=${q[chaveSel] ?? ''}&data=${data}&${tipo}=` + encodeURIComponent(msg));
    if (!sel) return ir('erro', modo === 'professor' ? 'Selecione o professor.' : 'Selecione a turma.');
    const corpo = await lerCorpo(c);
    const usuario = c.get('usuario').email;
    const enviadas = new Set(([] as unknown[]).concat(corpo.aula ?? []).map(String));
    // só aulas previstas nessa data (não aceita turma/tempo de fora da grade)
    const aulas: AulaPrevista[] = previstas.filter((a) => a.data === data && enviadas.has(`${a.turma_id}:${a.tempo}`));
    if (!aulas.length) return ir('erro', 'Nenhuma aula prevista nessa data.');

    const recalcular = new Map<string, number>(); // turma|componente → professor
    const resumo: Record<string, unknown>[] = [];
    let alteradas = 0;
    for (const a of aulas) {
      const mats = (await db.prepare('SELECT id, status FROM matriculas WHERE turma_id = ?').bind(a.turma_id).all<{ id: number; status: string }>()).results;
      const editaveis = mats.filter((m) => modo === 'secretaria' || estaAtiva(m.status)).map((m) => m.id);
      const antes = await db.prepare('SELECT id, componente_id, funcionario_id FROM aulas WHERE turma_id = ? AND data = ? AND tempo = ?')
        .bind(a.turma_id, data, a.tempo).first<{ id: number; componente_id: number; funcionario_id: number | null }>();
      if (antes && antes.componente_id !== a.componente_id) recalcular.set(`${a.turma_id}|${antes.componente_id}`, antes.funcionario_id ?? a.funcionario_id);
      const aula = await db.prepare(
        `INSERT INTO aulas (turma_id, componente_id, lotacao_id, funcionario_id, data, tempo, duracao_min, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (turma_id, data, tempo) DO UPDATE SET componente_id = excluded.componente_id, lotacao_id = excluded.lotacao_id,
           funcionario_id = excluded.funcionario_id, duracao_min = excluded.duracao_min, registrado_por = excluded.registrado_por,
           registrado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         RETURNING id`,
      ).bind(a.turma_id, a.componente_id, a.lotacao_id, a.funcionario_id, data, a.tempo, a.duracao_min, usuario).first<{ id: number }>();
      // só as células que a pessoa mudou (vale a última digitação); aula nova: grava o estado inteiro
      const cmds: D1PreparedStatement[] = [];
      let faltasNaAula = 0;
      for (const m of editaveis) {
        const k = `${a.turma_id}_${a.tempo}_${m}`;
        if (corpo[`o_falta_${k}`] === undefined && antes) continue; // aluno não estava na tela
        const falta = corpo[`falta_${k}`] != null;
        if (falta) faltasNaAula++;
        const mostrado = corpo[`o_falta_${k}`] === '1';
        if (antes && falta === mostrado) continue;
        if (!antes && !falta) continue; // aula nova: presença é o padrão, só as faltas são gravadas
        cmds.push(falta
          ? db.prepare('INSERT OR IGNORE INTO faltas_aula (aula_id, matricula_id) VALUES (?, ?)').bind(aula!.id, m)
          : db.prepare('DELETE FROM faltas_aula WHERE aula_id = ? AND matricula_id = ?').bind(aula!.id, m));
      }
      if (cmds.length) await db.batch(cmds);
      alteradas += cmds.length;
      recalcular.set(`${a.turma_id}|${a.componente_id}`, a.funcionario_id);
      resumo.push({ turma: a.turma, disciplina: a.componente, professor: a.professor, tempo: a.tempo, faltas_marcadas: faltasNaAula, celulas_alteradas: cmds.length });
    }
    for (const [k, prof] of recalcular) {
      const [t, comp] = k.split('|').map(Number);
      await recalcularFrequenciaDaChamada(db, t, comp, { usuario, origem: modo === 'professor' ? 'chamada' : 'secretaria', professorId: prof });
    }
    await auditar(c, 'registrar_chamada', modo === 'professor' ? 'funcionario' : 'turma', sel.id, null, { modo, data, aulas: resumo });
    return ir('ok', `Chamada de ${dataBR(data)} salva: ${aulas.length} aula(s), ${alteradas} alteração(ões). Frequência atualizada.`);
  });

  return rotas;
}

export const rotasChamada = criarRotasChamada('professor');
export const rotasFaltasSecretaria = criarRotasChamada('secretaria');
