/**
 * Gestão Pedagógica → Horário do Professor: grade semanal (Seg–Sáb × tempos do turno) montada a partir das lotações
 * ativas. Escolha a disciplina à esquerda e clique no horário livre; clique em × para tirar. Sem choque na turma nem no
 * professor (src/lib/pedagogico.ts). Tempos de aula por turno em /tempos.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, lerCorpo, texto } from '../lib/form';
import { DIAS_GRADE, gradeAtiva, minutosEntre, ROTULO_TURNO, temposDoTurno, validarAulaGrade, type Tempo } from '../lib/pedagogico';

export const rotasHorario = new Hono<Env>();
rotasHorario.use('*', exigir('pedagogico.gerenciar'));

const BASE = '/admin/pedagogico/horario';
const TURNOS = ['matutino', 'vespertino', 'noturno', 'integral'];
const sigla = (nome: string) => {
  const p = nome.split(/\s+/).filter((x) => x.length > 2 || /^[IVX]+$/.test(x));
  return p.length > 1 ? p.slice(0, 4).map((x) => (/^[IVX]+$/.test(x) ? x : x[0].toUpperCase())).join('') : nome.slice(0, 6);
};

const CSS = `
.horario{display:grid;grid-template-columns:minmax(260px,320px) 1fr;gap:1rem;align-items:start}
.lots{display:flex;flex-direction:column;gap:.5rem}
.lot{display:flex;gap:.6rem;align-items:flex-start;padding:.6rem .7rem;border:1px solid var(--borda);border-radius:10px;background:var(--superficie);cursor:pointer}
.lot:has(input:checked){border-color:var(--ciano);box-shadow:0 0 0 3px var(--foco)}
.lot input{margin-top:.25rem}
.lot b{display:block;font-size:.88rem}
.lot .muted{font-size:.76rem}
.lot .cont{margin-left:auto;font-weight:700;font-size:.8rem;padding:.1rem .45rem;border-radius:999px;background:var(--ok-bg);color:var(--ok);white-space:nowrap}
.lot .cont.zero{background:var(--aviso-bg);color:var(--aviso)}
table.grade{table-layout:fixed}
table.grade th,table.grade td{text-align:center;vertical-align:middle;padding:.3rem}
table.grade td.tempo{width:5.5rem;font-size:.78rem;color:var(--texto-2)}
table.grade td.tempo b{display:block;color:var(--texto);font-size:.9rem}
table.grade button.livre{width:100%;min-height:2.6rem;background:transparent;border:1px dashed var(--borda);color:var(--texto-2);justify-content:center;font-size:1.1rem}
table.grade button.livre:hover{border-color:var(--ciano);color:var(--ciano);background:var(--superficie-2)}
.aula{position:relative;border-radius:8px;padding:.3rem .4rem;background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-borda);font-size:.78rem;line-height:1.2}
.aula b{display:block;font-size:.82rem}
.aula button{position:absolute;top:2px;right:2px;padding:0 .3rem;font-size:.75rem;line-height:1.2;background:transparent;color:var(--erro);border:0}
@media (max-width:900px){.horario{grid-template-columns:1fr} table.grade{font-size:.75rem}}
`;

rotasHorario.get('/', async (c) => {
  const db = c.env.DB;
  const anos = (await db.prepare('SELECT DISTINCT ano_letivo AS ano FROM turmas WHERE ano_letivo IS NOT NULL ORDER BY ano DESC').all<{ ano: number }>()).results.map((x) => x.ano);
  const ano = Number(c.req.query('ano')) || anos[0] || new Date().getFullYear();
  const profs = (await db.prepare(
    `SELECT DISTINCT f.id, f.nome FROM funcionarios f JOIN lotacoes l ON l.funcionario_id = f.id JOIN turmas t ON t.id = l.turma_id
      WHERE l.data_fim IS NULL AND t.ano_letivo = ? ORDER BY f.nome`,
  ).bind(ano).all<{ id: number; nome: string }>()).results;
  const prof = profs.find((p) => p.id === Number(c.req.query('prof'))) ?? null;

  let lots: Record<string, any>[] = [];
  let aulas: Awaited<ReturnType<typeof gradeAtiva>> = [];
  const tempos = new Map<string, Tempo[]>();
  if (prof) {
    lots = (await db.prepare(
      `SELECT l.id, l.turma_id, t.codigo AS turma, t.turno, cc.nome AS componente, cc.carga_horaria_total AS ch, mt.ordem, mt.qualificacao_conferida,
              (SELECT count(*) FROM horario_aulas ha WHERE ha.lotacao_id = l.id) AS aulas
         FROM lotacoes l JOIN turmas t ON t.id = l.turma_id JOIN componentes_curriculares cc ON cc.id = l.componente_id
         LEFT JOIN modulos_tematicos mt ON mt.id = cc.modulo_id
        WHERE l.funcionario_id = ? AND l.data_fim IS NULL AND t.ano_letivo = ? ORDER BY t.turno, t.codigo, cc.ordem`,
    ).bind(prof.id, ano).all<Record<string, any>>()).results;
    aulas = (await gradeAtiva(db, { funcionarioId: prof.id })).filter((a) => lots.some((l) => l.id === a.lotacao_id));
    for (const turno of new Set(lots.map((l) => l.turno).filter(Boolean))) tempos.set(turno, await temposDoTurno(db, turno));
  }
  const selecionada = Number(c.req.query('lot')) || lots[0]?.id;
  const semTurno = lots.filter((l) => !l.turno);

  return c.html(
    <Pagina titulo="Horário do professor" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Horário do professor</h1>
      <div class="acoes" style="margin-top:0">
        <form method="get" class="acoes" style="margin:0">
          <label>Ano letivo<select name="ano" onchange="this.form.submit()">{(anos.length ? anos : [ano]).map((a) => <option selected={a === ano}>{a}</option>)}</select></label>
          <label>Professor(a)<select name="prof" onchange="this.form.submit()" style="min-width:280px"><option value="">Selecione</option>
            {profs.map((p) => <option value={p.id} selected={p.id === prof?.id}>{p.nome}</option>)}</select></label>
          <noscript><button class="sec">Abrir</button></noscript>
        </form>
        <a class="botao sec" style="align-self:flex-end" href={`${BASE}/tempos`}><Icone nome="auditoria" />Tempos de aula</a>
      </div>
      {!profs.length && <p class="muted">Nenhum professor com lotação ativa em {ano}. Faça a <a href="/admin/pedagogico/lotacao">lotação</a> primeiro.</p>}
      {semTurno.length > 0 && <div class="msg aviso">Turma(s) sem turno: {[...new Set(semTurno.map((l) => l.turma))].join(', ')}. Informe o turno na tela da turma para usar a grade.</div>}

      {prof && (
        <form method="post" action={`${BASE}?ano=${ano}&prof=${prof.id}`} class="horario">
          <div class="lots">
            <div class="muted">1. Escolha a disciplina</div>
            {lots.map((l) => (
              <label class="lot">
                <input type="radio" name="lotacao_id" value={l.id} checked={l.id === selecionada} disabled={!l.turno} />
                <span><b>{l.componente}</b>
                  <span class="muted">Turma {l.turma} · {l.turno ? ROTULO_TURNO[l.turno] : 'sem turno'}{l.qualificacao_conferida ? ` · ${l.qualificacao_conferida}` : ''}</span></span>
                <span class={`cont ${l.aulas ? '' : 'zero'}`} title="aulas por semana na grade">{l.aulas}/sem</span>
              </label>
            ))}
          </div>
          <div>
            <div class="muted" style="margin-bottom:.4rem">2. Clique no horário livre (+) para incluir; × tira a aula da grade.</div>
            {[...tempos.entries()].map(([turno, ts]) => (
              <>
                <h2 style="margin-top:0">{ROTULO_TURNO[turno]}</h2>
                {!ts.length && <p class="muted">Turno sem tempos de aula cadastrados: <a href={`${BASE}/tempos`}>cadastre os tempos</a>.</p>}
                {ts.length > 0 && (
                  <table class="grade">
                    <tr><th style="width:5.5rem">Tempo</th>{DIAS_GRADE.map(([, s]) => <th>{s}</th>)}</tr>
                    {ts.map((t) => (
                      <tr>
                        <td class="tempo"><b>{t.numero}º</b>{t.hora_inicio}–{t.hora_fim}</td>
                        {DIAS_GRADE.map(([d]) => {
                          const a = aulas.find((x) => x.turno === turno && x.dia_semana === d && x.tempo === t.numero);
                          return (
                            <td>{a
                              ? <div class="aula" title={`${a.componente} — turma ${a.turma}`}><b>{sigla(a.componente)}</b>{a.turma}
                                  <button name="remover" value={a.id} title="Tirar da grade" formnovalidate>×</button></div>
                              : <button class="livre" name="incluir" value={`${d}:${t.numero}`} title="Incluir a disciplina escolhida neste horário">+</button>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </table>
                )}
              </>
            ))}
            {!lots.length && <p class="muted">Este professor não tem lotação ativa em {ano}.</p>}
          </div>
        </form>
      )}
    </Pagina>,
  );
});

rotasHorario.post('/', async (c) => {
  const db = c.env.DB;
  const corpo = await lerCorpo(c);
  const qs = new URL(c.req.url).search;
  const lot = texto(corpo, 'lotacao_id');
  const ir = (tipo: string, msg: string) => c.redirect(`${BASE}${qs}${lot ? `&lot=${lot}` : ''}&${tipo}=` + encodeURIComponent(msg));
  try {
    const remover = texto(corpo, 'remover');
    if (remover) {
      const a = await db.prepare(
        `SELECT ha.*, cc.nome AS componente, t.codigo AS turma FROM horario_aulas ha JOIN lotacoes l ON l.id = ha.lotacao_id
           JOIN componentes_curriculares cc ON cc.id = l.componente_id JOIN turmas t ON t.id = l.turma_id WHERE ha.id = ? AND l.data_fim IS NULL`,
      ).bind(Number(remover)).first<Record<string, any>>();
      if (!a) throw new ErroValidacao('Aula não encontrada na grade.');
      await db.prepare('DELETE FROM horario_aulas WHERE id = ?').bind(a.id).run();
      await auditar(c, 'remover_aula_grade', 'lotacao', a.lotacao_id, a, null);
      return ir('ok', `${a.componente} (${a.turma}) retirada do horário.`);
    }
    const incluir = texto(corpo, 'incluir');
    if (!incluir) throw new ErroValidacao('Nada a fazer.');
    if (!lot) throw new ErroValidacao('Escolha primeiro a disciplina à esquerda.');
    const [dia, tempo] = incluir.split(':').map(Number);
    await validarAulaGrade(db, Number(lot), dia, tempo);
    await db.prepare('INSERT INTO horario_aulas (lotacao_id, dia_semana, tempo) VALUES (?, ?, ?)').bind(Number(lot), dia, tempo).run();
    await auditar(c, 'incluir_aula_grade', 'lotacao', Number(lot), null, { dia_semana: dia, tempo });
    return ir('ok', `Aula incluída: ${DIAS_GRADE.find(([d]) => d === dia)?.[2]}, ${tempo}º tempo.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return ir('erro', e.message);
    throw e;
  }
});

// ------------------------------------------------------------------ tempos de aula
rotasHorario.get('/tempos', async (c) => {
  const db = c.env.DB;
  const lista = await Promise.all(TURNOS.map((t) => temposDoTurno(db, t)));
  return c.html(
    <Pagina titulo="Tempos de aula" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')} voltar={BASE}>
      <h1>Tempos de aula</h1>
      <p class="muted" style="margin-top:-.6rem">Horário de cada tempo por turno. A duração de cada tempo é usada para calcular a frequência (horas faltadas).
        Linhas em branco são removidas; tempos que já estão na grade não podem ser removidos.</p>
      <div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
        {TURNOS.map((turno, i) => (
          <form method="post" action={`${BASE}/tempos/${turno}`} class="cartao" style="margin:0">
            <h2 style="margin-top:0">{ROTULO_TURNO[turno]}</h2>
            <table>
              <tr><th>Tempo</th><th>Início</th><th>Término</th><th class="n">Min</th></tr>
              {Array.from({ length: Math.max(lista[i].length + 2, 5) }, (_, k) => {
                const t = lista[i][k];
                return (
                  <tr>
                    <td>{k + 1}º</td>
                    <td><input type="time" name={`inicio_${k + 1}`} value={t?.hora_inicio ?? ''} /></td>
                    <td><input type="time" name={`fim_${k + 1}`} value={t?.hora_fim ?? ''} /></td>
                    <td class="n">{t ? minutosEntre(t.hora_inicio, t.hora_fim) : ''}</td>
                  </tr>
                );
              })}
            </table>
            <div class="acoes"><button><Icone nome="salvar" />Salvar {ROTULO_TURNO[turno].toLowerCase()}</button></div>
          </form>
        ))}
      </div>
    </Pagina>,
  );
});

rotasHorario.post('/tempos/:turno', async (c) => {
  const turno = c.req.param('turno');
  if (!TURNOS.includes(turno)) return c.notFound();
  const db = c.env.DB;
  const corpo = await lerCorpo(c);
  try {
    const novos: { numero: number; inicio: string; fim: string }[] = [];
    for (let n = 1; n <= 12; n++) {
      const inicio = texto(corpo, `inicio_${n}`);
      const fim = texto(corpo, `fim_${n}`);
      if (!inicio && !fim) continue;
      if (!inicio || !fim || !/^\d{2}:\d{2}$/.test(inicio) || !/^\d{2}:\d{2}$/.test(fim)) throw new ErroValidacao(`${n}º tempo: informe início e término (hh:mm).`);
      if (fim <= inicio) throw new ErroValidacao(`${n}º tempo: o término deve ser depois do início.`);
      if (minutosEntre(inicio, fim) < 10) throw new ErroValidacao(`${n}º tempo: duração mínima de 10 minutos.`);
      novos.push({ numero: novos.length + 1, inicio, fim });
    }
    for (let k = 1; k < novos.length; k++) {
      if (novos[k].inicio < novos[k - 1].fim) throw new ErroValidacao(`${novos[k].numero}º tempo começa antes do fim do ${novos[k - 1].numero}º.`);
    }
    const usados = (await db.prepare(
      `SELECT DISTINCT ha.tempo FROM horario_aulas ha JOIN lotacoes l ON l.id = ha.lotacao_id JOIN turmas t ON t.id = l.turma_id
        WHERE t.turno = ? AND l.data_fim IS NULL`,
    ).bind(turno).all<{ tempo: number }>()).results.map((x) => x.tempo);
    const sobrando = usados.filter((u) => u > novos.length);
    if (sobrando.length) throw new ErroValidacao(`O(s) tempo(s) ${sobrando.join(', ')} do ${ROTULO_TURNO[turno].toLowerCase()} estão na grade de algum professor: tire as aulas antes de remover o tempo.`);
    const antes = await temposDoTurno(db, turno);
    await db.batch([
      db.prepare('DELETE FROM horario_tempos WHERE turno = ?').bind(turno),
      ...novos.map((t) => db.prepare('INSERT INTO horario_tempos (turno, numero, hora_inicio, hora_fim) VALUES (?, ?, ?, ?)').bind(turno, t.numero, t.inicio, t.fim)),
    ]);
    await auditar(c, 'atualizar_tempos', 'horario_tempos', null, { turno, tempos: antes }, { turno, tempos: novos });
    return c.redirect(`${BASE}/tempos?ok=` + encodeURIComponent(`Tempos do ${ROTULO_TURNO[turno].toLowerCase()} salvos.`));
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect(`${BASE}/tempos?erro=` + encodeURIComponent(e.message));
    throw e;
  }
});
