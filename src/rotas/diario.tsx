/**
 * Secretaria → Notas e Faltas: lançamento por turma → módulo → disciplina, com professor, dias, horário
 * e tempo de cada aula. Faltas em nº de aulas; a frequência é calculada (src/lib/frequencia.ts).
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, inteiro, lerCorpo, numBR, numero, texto } from '../lib/form';
import { dataBR } from '../lib/datas';
import { avaliarDisciplina, criteriosDoCurso } from '../lib/aprovacao';
import { aulasPrevistas, calcularFrequencia, DIAS_SEMANA, descreverHorario } from '../lib/frequencia';
import { modulosDaTurma, ROTULO_SITUACAO } from '../lib/turmaModulos';
import { nomeDoAluno } from '../certificado/dados';

export const rotasDiario = new Hono<Env>();
rotasDiario.use('*', exigir('resultados.lancar'));

const CSS = `
.cartoes-turma{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:1rem}
.cartao-turma{background:var(--superficie);border:1px solid var(--borda);border-radius:14px;box-shadow:var(--sombra);padding:1rem 1.1rem}
.cartao-turma h2{margin:0 0 .15rem;font-size:1.08rem}
.cartao-turma .mods{display:flex;flex-direction:column;gap:.45rem;margin-top:.8rem}
.cartao-turma .mods a{display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.55rem .7rem;border:1px solid var(--borda);border-radius:10px;text-decoration:none;color:var(--texto);background:var(--superficie-2)}
.cartao-turma .mods a:hover{border-color:var(--ciano)}
.cartao-turma .mods span.inativo{display:flex;justify-content:space-between;padding:.55rem .7rem;border:1px dashed var(--borda);border-radius:10px;color:var(--texto-2);font-size:.9rem}
.disc-dados{display:grid;grid-template-columns:2fr 2fr 1fr 1fr 1fr auto;gap:.6rem .8rem;align-items:end}
.dias{display:flex;gap:.3rem;flex-wrap:wrap}
.dias label{flex-direction:row;align-items:center;gap:.25rem;padding:.3rem .5rem;border:1px solid var(--borda-forte);border-radius:8px;font-size:.82rem;cursor:pointer}
.dias input{margin:0}
.info-disc{display:flex;gap:.5rem;flex-wrap:wrap;margin:.2rem 0 1rem}
.info-disc .chip{display:inline-flex;gap:.3rem;padding:.2rem .65rem;border-radius:999px;background:var(--superficie);border:1px solid var(--borda);font-size:.82rem;color:var(--texto-2)}
.info-disc .chip b{color:var(--texto)}
table.grade-notas td{vertical-align:middle}
table.grade-notas input{width:5.4rem;text-align:right}
table.grade-notas td.freq{font-weight:650;white-space:nowrap}
table.grade-notas td.freq.baixa{color:var(--erro)}
@media (max-width:900px){.disc-dados{grid-template-columns:1fr 1fr}}
`;

// ------------------------------------------------------------------ 1. turmas e módulos
rotasDiario.get('/', async (c) => {
  const db = c.env.DB;
  const turmas = (await db.prepare(
    `SELECT t.id, t.codigo, cu.nome AS curso, (SELECT count(*) FROM matriculas m WHERE m.turma_id = t.id AND m.situacao <> 'desistente') AS alunos
       FROM turmas t JOIN cursos cu ON cu.id = t.curso_id ORDER BY t.data_inicio DESC, t.codigo`,
  ).all<{ id: number; codigo: string; curso: string; alunos: number }>()).results;
  const modulos = await Promise.all(turmas.map((t) => modulosDaTurma(db, t.id)));
  return c.html(
    <Pagina titulo="Notas e faltas" usuario={c.get('usuario')} caminho={c.req.path}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Notas e faltas</h1>
      <p class="muted" style="margin-top:-.6rem">Escolha a turma e o módulo. Só aparecem para lançamento os módulos em andamento ou concluídos.</p>
      <div class="cartoes-turma">
        {turmas.map((t, i) => (
          <div class="cartao-turma">
            <h2>{t.codigo}</h2>
            <div class="muted">{t.curso} · {t.alunos} aluno(s)</div>
            <div class="mods">
              {modulos[i].map((m) => m.situacao === 'planejado'
                ? <span class="inativo">{m.ordem}. {m.nome}<span>planejado</span></span>
                : <a href={`/admin/diario/${t.id}/${m.modulo_id}`}>{m.ordem}. {m.nome}
                    <span class={`tag ${m.situacao === 'concluido' ? 'ok' : 'aviso'}`}>{ROTULO_SITUACAO[m.situacao]}</span></a>)}
            </div>
          </div>
        ))}
      </div>
      {!turmas.length && <p class="muted">Nenhuma turma cadastrada.</p>}
    </Pagina>,
  );
});

async function contexto(c: any) {
  const db = c.env.DB as D1Database;
  const turmaId = Number(c.req.param('turma'));
  const moduloId = Number(c.req.param('modulo'));
  const t = await db.prepare('SELECT t.*, cu.nome AS curso FROM turmas t JOIN cursos cu ON cu.id = t.curso_id WHERE t.id = ?').bind(turmaId).first<Record<string, any>>();
  if (!t) return null;
  const mods = await modulosDaTurma(db, turmaId);
  const mt = mods.find((m) => m.modulo_id === moduloId);
  if (!mt) return null;
  return { db, t, mt, base: `/admin/diario/${turmaId}/${moduloId}` };
}

// ------------------------------------------------------------------ 2. disciplinas do módulo
rotasDiario.get('/:turma{[0-9]+}/:modulo{[0-9]+}', async (c) => {
  const ctx = await contexto(c);
  if (!ctx) return c.notFound();
  const { db, t, mt, base } = ctx;
  const discs = (await db.prepare(
    `SELECT cc.id, cc.nome, cc.carga_horaria_total AS ch, td.professor, td.dias_semana, td.hora_inicio, td.hora_fim, td.duracao_aula_min,
            (SELECT count(*) FROM resultados r JOIN matriculas m ON m.id = r.matricula_id
              WHERE r.componente_id = cc.id AND m.turma_id = ?1 AND r.nota IS NOT NULL AND r.frequencia IS NOT NULL) AS lancados
       FROM componentes_curriculares cc LEFT JOIN turma_disciplinas td ON td.componente_id = cc.id AND td.turma_id = ?1
      WHERE cc.modulo_id = ?2 ORDER BY cc.ordem`,
  ).bind(t.id, mt.modulo_id).all<Record<string, any>>()).results;
  const alunos = (await db.prepare(`SELECT count(*) AS n FROM matriculas WHERE turma_id = ? AND situacao <> 'desistente'`).bind(t.id).first<{ n: number }>())?.n ?? 0;
  return c.html(
    <Pagina titulo={`Notas e faltas — ${t.codigo}`} usuario={c.get('usuario')} caminho={c.req.path} voltar="/admin/diario">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>{t.codigo} · Módulo {mt.ordem}: {mt.nome}</h1>
      <div class="info-disc">
        <span class="chip"><b>{t.curso}</b></span>
        <span class={`tag ${mt.situacao === 'concluido' ? 'ok' : mt.situacao === 'em_andamento' ? 'aviso' : ''}`}>{ROTULO_SITUACAO[mt.situacao]}</span>
        <span class="chip">{mt.data_inicio ? dataBR(mt.data_inicio) : '—'} a {mt.data_fim ? dataBR(mt.data_fim) : 'em curso'}</span>
        <span class="chip">{alunos} aluno(s)</span>
      </div>
      {mt.situacao === 'planejado' && <div class="msg aviso">Este módulo ainda está planejado: inicie-o na tela da turma para lançar notas e faltas.</div>}
      <table>
        <tr><th>Disciplina</th><th class="n">CH</th><th>Professor</th><th>Horário</th><th class="n">Tempo da aula</th><th class="c">Lançados</th><th></th></tr>
        {discs.map((d) => (
          <tr>
            <td><b>{d.nome}</b></td>
            <td class="n">{d.ch} h</td>
            <td>{d.professor ?? <span class="tag aviso">não informado</span>}</td>
            <td>{descreverHorario(d.dias_semana, d.hora_inicio, d.hora_fim) ?? <span class="muted">—</span>}</td>
            <td class="n">{d.duracao_aula_min ? `${d.duracao_aula_min} min` : <span class="tag aviso">não informado</span>}</td>
            <td class="c"><span class={`tag ${d.lancados >= alunos && alunos ? 'ok' : ''}`}>{d.lancados} de {alunos}</span></td>
            <td>{mt.situacao !== 'planejado' && <a class="botao" style="padding:.35rem .8rem" href={`${base}/${d.id}`}>Lançar notas e faltas</a>}</td>
          </tr>
        ))}
      </table>
    </Pagina>,
  );
});

// ------------------------------------------------------------------ 3. lançamento por disciplina
async function contextoDisciplina(c: any) {
  const ctx = await contexto(c);
  if (!ctx) return null;
  const { db, t, mt } = ctx;
  const cc = await db.prepare('SELECT * FROM componentes_curriculares WHERE id = ? AND modulo_id = ?').bind(Number(c.req.param('comp')), mt.modulo_id).first<Record<string, any>>();
  if (!cc) return null;
  const [td, curso, alunos, resultados, professores] = await Promise.all([
    db.prepare('SELECT * FROM turma_disciplinas WHERE turma_id = ? AND componente_id = ?').bind(t.id, cc.id).first<Record<string, any>>(),
    db.prepare('SELECT * FROM cursos WHERE id = ?').bind(t.curso_id).first<any>(),
    db.prepare(
      `SELECT m.id, a.nome_civil, a.nome_social, a.usar_nome_social FROM matriculas m JOIN alunos a ON a.id = m.aluno_id
        WHERE m.turma_id = ? AND m.situacao <> 'desistente'
        ORDER BY CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END`,
    ).bind(t.id).all<Record<string, any>>(),
    db.prepare('SELECT r.* FROM resultados r JOIN matriculas m ON m.id = r.matricula_id WHERE m.turma_id = ? AND r.componente_id = ?').bind(t.id, cc.id).all<Record<string, any>>(),
    db.prepare('SELECT DISTINCT professor FROM turma_disciplinas WHERE professor IS NOT NULL ORDER BY professor').all<{ professor: string }>(),
  ]);
  return {
    ...ctx, cc, td, criterios: criteriosDoCurso(curso), alunos: alunos.results,
    porMatricula: new Map(resultados.results.map((r) => [r.matricula_id, r])), professores: professores.results.map((p) => p.professor),
    url: `${ctx.base}/${cc.id}`,
  };
}

const JS_FREQ = `
(function(){
  var g=document.getElementById('grade'); if(!g) return;
  var dur=+g.dataset.duracao, ch=+g.dataset.ch, min=+g.dataset.minimo;
  function calc(inp){
    var cel=document.getElementById('freq-'+inp.dataset.mat); if(!cel) return;
    var v=inp.value.trim(); if(v===''||!dur){cel.textContent='—';cel.classList.remove('baixa');return;}
    var f=Math.max(0,100*(1-(+v)*dur/60/ch)); f=Math.round(f*100)/100;
    cel.textContent=f.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%'; cel.classList.toggle('baixa',f<min);
  }
  g.querySelectorAll('input[data-mat]').forEach(function(i){i.addEventListener('input',function(){calc(i)});calc(i);});
})();`;

rotasDiario.get('/:turma{[0-9]+}/:modulo{[0-9]+}/:comp{[0-9]+}', async (c) => {
  const ctx = await contextoDisciplina(c);
  if (!ctx) return c.notFound();
  const { t, mt, cc, td, criterios, alunos, porMatricula, professores, url } = ctx;
  const dur: number | null = td?.duracao_aula_min ?? null;
  const previstas = dur ? aulasPrevistas(cc.carga_horaria_total, dur) : null;
  const dias = new Set(String(td?.dias_semana ?? '').split(',').filter(Boolean));
  const bloqueado = mt.situacao === 'planejado';
  return c.html(
    <Pagina titulo={`${cc.nome} — ${t.codigo}`} usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')} voltar={ctx.base}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>{cc.nome}</h1>
      <div class="info-disc">
        <span class="chip">Turma <b>{t.codigo}</b></span>
        <span class="chip">Módulo {mt.ordem}: <b>{mt.nome}</b></span>
        <span class="chip">CH <b>{cc.carga_horaria_total} h</b></span>
        {previstas && <span class="chip">Aulas previstas <b>{previstas}</b> de {dur} min</span>}
        <span class="chip">Frequência mínima <b>{numBR(criterios.frequenciaMinima)}%</b></span>
      </div>
      {bloqueado && <div class="msg aviso">O módulo ainda está planejado: inicie-o na tela da turma para lançar notas e faltas.</div>}

      <div class="cartao">
        <h2 style="margin-top:0">Professor, horário e tempo das aulas</h2>
        <form method="post" action={`${url}/dados`} class="disc-dados">
          <label>Professor(a)<input name="professor" list="lista-professores" value={td?.professor ?? ''} required placeholder="Nome completo" /></label>
          <label>Dias da semana
            <span class="dias">{DIAS_SEMANA.map(([k, r]) => <label><input type="checkbox" name="dias" value={k} checked={dias.has(k)} />{r}</label>)}</span>
          </label>
          <label>Início<input type="time" name="hora_inicio" value={td?.hora_inicio ?? ''} /></label>
          <label>Término<input type="time" name="hora_fim" value={td?.hora_fim ?? ''} /></label>
          <label>Tempo de cada aula (min)<input type="number" name="duracao_aula_min" min={10} max={600} value={td?.duracao_aula_min ?? ''} required placeholder="ex.: 50" /></label>
          <button><Icone nome="salvar" />Salvar</button>
          <datalist id="lista-professores">{professores.map((p) => <option value={p} />)}</datalist>
        </form>
      </div>

      <div class="cartao">
        <h2 style="margin-top:0">Notas e faltas</h2>
        {!dur && <div class="msg aviso">Informe acima o <b>tempo de cada aula</b> para lançar as faltas: a frequência é calculada a partir delas.</div>}
        <form method="post" action={url}>
          <table class="grade-notas" id="grade" data-duracao={dur ?? 0} data-ch={cc.carga_horaria_total} data-minimo={criterios.frequenciaMinima}>
            <tr><th>Aluno</th><th class="n">Faltas (aulas)</th><th class="n">Frequência</th><th class="n">Média</th><th class="n">Exame final</th><th class="c">Resultado</th></tr>
            {alunos.map((m) => {
              const r = porMatricula.get(m.id);
              const av = avaliarDisciplina({ componente: cc.nome, nota: r?.nota ?? null, notaExameFinal: r?.nota_exame_final ?? null, frequencia: r?.frequencia ?? null }, criterios);
              return (
                <tr>
                  <td>{nomeDoAluno(m)}</td>
                  <td class="n"><input name={`faltas_${m.id}`} inputmode="numeric" data-mat={m.id} value={r?.faltas ?? ''} disabled={!dur || bloqueado} /></td>
                  <td class="n freq" id={`freq-${m.id}`}>{r?.frequencia != null ? `${numBR(r.frequencia, 2)}%` : '—'}</td>
                  <td class="n"><input name={`nota_${m.id}`} inputmode="decimal" value={numBR(r?.nota, 2)} disabled={bloqueado} /></td>
                  <td class="n"><input name={`exame_${m.id}`} inputmode="decimal" value={numBR(r?.nota_exame_final, 2)} disabled={bloqueado} /></td>
                  <td class="c" title={av.motivos.join('\n')}><span class={`tag ${av.resultado}`}>{av.resultado === 'PENDENTE' ? '—' : av.resultado}</span></td>
                </tr>
              );
            })}
          </table>
          {!alunos.length && <p class="muted">Nenhum aluno matriculado nesta turma.</p>}
          <div class="acoes"><button disabled={bloqueado || !alunos.length}><Icone nome="salvar" />Salvar notas e faltas</button>
            <span class="muted">Frequência = 100% − (faltas × tempo da aula ÷ carga horária). Campos vazios não alteram nada.</span></div>
        </form>
      </div>
      <script dangerouslySetInnerHTML={{ __html: JS_FREQ }} />
    </Pagina>,
  );
});

rotasDiario.post('/:turma{[0-9]+}/:modulo{[0-9]+}/:comp{[0-9]+}/dados', async (c) => {
  const ctx = await contextoDisciplina(c);
  if (!ctx) return c.notFound();
  const corpo = await lerCorpo(c);
  const diasSel = ([] as string[]).concat((corpo.dias as string | string[] | undefined) ?? []).flatMap((d) => String(d).split(',')).filter((d) => DIAS_SEMANA.some(([k]) => k === d));
  let d;
  try {
    d = {
      professor: texto(corpo, 'professor'),
      dias_semana: DIAS_SEMANA.map(([k]) => k).filter((k) => diasSel.includes(k)).join(',') || null,
      hora_inicio: texto(corpo, 'hora_inicio'),
      hora_fim: texto(corpo, 'hora_fim'),
      duracao_aula_min: inteiro(corpo, 'duracao_aula_min', 'Tempo de cada aula'),
    };
    if (!d.professor) throw new ErroValidacao('Informe o nome do professor.');
    if (!d.duracao_aula_min || d.duracao_aula_min < 10 || d.duracao_aula_min > 600) throw new ErroValidacao('Tempo de cada aula deve estar entre 10 e 600 minutos.');
    for (const h of [d.hora_inicio, d.hora_fim]) if (h && !/^\d{2}:\d{2}$/.test(h)) throw new ErroValidacao('Horário inválido (use hh:mm).');
    if (d.hora_inicio && d.hora_fim && d.hora_fim <= d.hora_inicio) throw new ErroValidacao('O horário de término deve ser depois do início.');
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect(`${ctx.url}?erro=` + encodeURIComponent(e.message));
    throw e;
  }
  await ctx.db.prepare(
    `INSERT INTO turma_disciplinas (turma_id, componente_id, professor, dias_semana, hora_inicio, hora_fim, duracao_aula_min) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (turma_id, componente_id) DO UPDATE SET professor = excluded.professor, dias_semana = excluded.dias_semana,
       hora_inicio = excluded.hora_inicio, hora_fim = excluded.hora_fim, duracao_aula_min = excluded.duracao_aula_min,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ).bind(ctx.t.id, ctx.cc.id, d.professor, d.dias_semana, d.hora_inicio, d.hora_fim, d.duracao_aula_min).run();
  // se o tempo da aula mudou, recalcula a frequência de quem tem faltas lançadas
  if (ctx.td?.duracao_aula_min && ctx.td.duracao_aula_min !== d.duracao_aula_min) {
    const cmds = [...ctx.porMatricula.values()].filter((r) => r.faltas != null).map((r) => {
      const freq = calcularFrequencia(r.faltas, d.duracao_aula_min!, ctx.cc.carga_horaria_total);
      const av = avaliarDisciplina({ componente: ctx.cc.nome, nota: r.nota, notaExameFinal: r.nota_exame_final, frequencia: freq }, ctx.criterios);
      return ctx.db.prepare('UPDATE resultados SET frequencia = ?, resultado = ? WHERE id = ?').bind(freq, av.resultado === 'PENDENTE' ? null : av.resultado, r.id);
    });
    if (cmds.length) await ctx.db.batch(cmds);
  }
  await auditar(c, 'atualizar_disciplina_turma', 'turma', ctx.t.id, ctx.td ?? null, { disciplina: ctx.cc.nome, ...d });
  return c.redirect(`${ctx.url}?ok=` + encodeURIComponent('Professor, horário e tempo das aulas salvos.'));
});

rotasDiario.post('/:turma{[0-9]+}/:modulo{[0-9]+}/:comp{[0-9]+}', async (c) => {
  const ctx = await contextoDisciplina(c);
  if (!ctx) return c.notFound();
  const { db, t, mt, cc, td, criterios, alunos, porMatricula, url } = ctx;
  if (mt.situacao === 'planejado') return c.redirect(`${url}?erro=` + encodeURIComponent('O módulo ainda está planejado: inicie-o na tela da turma.'));
  const corpo = await lerCorpo(c);
  const dur: number | null = td?.duracao_aula_min ?? null;
  const previstas = dur ? aulasPrevistas(cc.carga_horaria_total, dur) : null;
  const cmds: D1PreparedStatement[] = [];
  const alteracoes: Record<string, unknown>[] = [];
  try {
    for (const m of alunos) {
      const nome = nomeDoAluno(m);
      const faltasTxt = texto(corpo, `faltas_${m.id}`);
      const faltas = faltasTxt == null ? null : inteiro(corpo, `faltas_${m.id}`, `Faltas de ${nome}`);
      const nota = numero(corpo, `nota_${m.id}`, `Média de ${nome}`);
      const exame = numero(corpo, `exame_${m.id}`, `Exame de ${nome}`);
      if (faltas != null && !dur) throw new ErroValidacao('Informe o tempo de cada aula antes de lançar faltas.');
      if (faltas != null && (faltas < 0 || faltas > previstas!)) throw new ErroValidacao(`Faltas de ${nome}: ${faltas} (o máximo é ${previstas} aulas previstas).`);
      for (const [v, r] of [[nota, 'Média'], [exame, 'Exame']] as const) {
        if (v != null && (v < 0 || v > 10)) throw new ErroValidacao(`${r} de ${nome} fora do intervalo 0–10.`);
      }
      const antes = porMatricula.get(m.id);
      const novo = {
        faltas: faltas ?? antes?.faltas ?? null,
        nota: nota ?? antes?.nota ?? null,
        exame: exame ?? antes?.nota_exame_final ?? null,
      };
      const freq = novo.faltas != null && dur ? calcularFrequencia(novo.faltas, dur, cc.carga_horaria_total) : antes?.frequencia ?? null;
      const igual = (antes?.faltas ?? null) === novo.faltas && (antes?.nota ?? null) === novo.nota && (antes?.nota_exame_final ?? null) === novo.exame && (antes?.frequencia ?? null) === freq;
      if (igual || (!antes && novo.faltas == null && novo.nota == null && novo.exame == null)) continue;
      const av = avaliarDisciplina({ componente: cc.nome, nota: novo.nota, notaExameFinal: novo.exame, frequencia: freq }, criterios);
      cmds.push(db.prepare(
        `INSERT INTO resultados (matricula_id, componente_id, nota, nota_exame_final, frequencia, faltas, resultado) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (matricula_id, componente_id) DO UPDATE SET nota = excluded.nota, nota_exame_final = excluded.nota_exame_final,
           frequencia = excluded.frequencia, faltas = excluded.faltas, resultado = excluded.resultado, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
      ).bind(m.id, cc.id, novo.nota, novo.exame, freq, novo.faltas, av.resultado === 'PENDENTE' ? null : av.resultado));
      alteracoes.push({ matricula_id: m.id, aluno: nome, antes: antes ? { faltas: antes.faltas, nota: antes.nota, exame: antes.nota_exame_final, frequencia: antes.frequencia } : null,
        depois: { ...novo, frequencia: freq, resultado: av.resultado } });
    }
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect(`${url}?erro=` + encodeURIComponent(e.message));
    throw e;
  }
  if (cmds.length) {
    await db.batch(cmds);
    await auditar(c, 'lancar_notas_faltas', 'componente_curricular', cc.id, null, { turma: t.codigo, disciplina: cc.nome, professor: td?.professor ?? null, alteracoes });
  }
  return c.redirect(`${url}?ok=` + encodeURIComponent(`${cmds.length} aluno(s) atualizado(s).`));
});
