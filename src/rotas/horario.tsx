/**
 * Gestão Pedagógica → Horário do Professor, no estilo do sysGEP (quadro kanban):
 *  - à esquerda, as disciplinas lotadas do professor, agrupadas por turno, com aulas/semana e as horas que a grade cobre
 *    até o fim do módulo (calendário letivo) contra a CH da disciplina;
 *  - à direita, a grade Seg–Sáb × tempos do turno.
 * Arraste a disciplina para um horário livre (ou clique nela e depois no horário); arraste uma aula para mover; solte-a no
 * painel (ou dê dois cliques) para remover. Cada ação vai para /api, que valida (sem choque na turma nem no professor —
 * src/lib/pedagogico.ts) e devolve o estado novo da grade. Tempos de aula por turno em /tempos.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, lerCorpo, texto } from '../lib/form';
import {
  anoLetivo, aulasPrevistasDoProfessor, DIAS_GRADE, gradeAtiva, minutosEntre, ROTULO_TURNO, temposDoTurno, validarAulaGrade, type Tempo,
} from '../lib/pedagogico';

export const rotasHorario = new Hono<Env>();
rotasHorario.use('*', exigir('pedagogico.gerenciar'));

const BASE = '/admin/pedagogico/horario';
const TURNOS = ['matutino', 'vespertino', 'noturno', 'integral'];

/** Sigla curta da disciplina para o cartão da grade ("Design Thinking" → "DT", "Unidade Curricular Profissional III" → "UCP-III"). */
export function sigla(nome: string): string {
  const palavras = nome.split(/\s+/).filter(Boolean);
  const romano = palavras.find((x) => /^[IVX]+$/.test(x));
  const iniciais = palavras.filter((x) => x.length > 2 && !/^[IVX]+$/.test(x)).map((x) => x[0].toUpperCase()).join('').slice(0, 4);
  if (iniciais.length < 2) return nome.slice(0, 8);
  return romano ? `${iniciais}-${romano}` : iniciais;
}

// ------------------------------------------------------------------ estado da grade (JSON usado pela página e pela API)
interface Estado {
  lots: { id: number; componente: string; sigla: string; turma: string; turma_id: number; turno: string | null; qualificacao: string | null;
    ch: number; aulas: number; horas: number; cor: number }[];
  aulas: { id: number; lotacao_id: number; dia: number; tempo: number; turno: string | null }[];
  tempos: Record<string, Tempo[]>;
}

async function estadoDoProfessor(db: D1Database, profId: number, ano: number): Promise<Estado> {
  const lots = (await db.prepare(
    `SELECT l.id, l.turma_id, t.codigo AS turma, t.turno, cc.nome AS componente, cc.carga_horaria_total AS ch, mt.qualificacao_conferida AS qualificacao,
            (SELECT count(*) FROM horario_aulas ha WHERE ha.lotacao_id = l.id) AS aulas
       FROM lotacoes l JOIN turmas t ON t.id = l.turma_id JOIN componentes_curriculares cc ON cc.id = l.componente_id
       LEFT JOIN modulos_tematicos mt ON mt.id = cc.modulo_id
      WHERE l.funcionario_id = ? AND l.data_fim IS NULL AND t.ano_letivo = ? ORDER BY t.turno, t.codigo, cc.ordem`,
  ).bind(profId, ano).all<Record<string, any>>()).results;
  const aulas = (await gradeAtiva(db, { funcionarioId: profId })).filter((a) => lots.some((l) => l.id === a.lotacao_id));
  const tempos: Record<string, Tempo[]> = {};
  for (const turno of new Set(lots.map((l) => l.turno).filter(Boolean))) tempos[turno] = await temposDoTurno(db, turno);
  // horas que a grade cobre: aulas previstas da lotação até o fim do módulo (ou do ano letivo), em dias letivos
  const al = await anoLetivo(db, ano);
  const previstas = al ? await aulasPrevistasDoProfessor(db, profId, al, al.data_fim) : [];
  const horas = new Map<number, number>();
  for (const p of previstas) horas.set(p.lotacao_id, (horas.get(p.lotacao_id) ?? 0) + p.duracao_min / 60);
  return {
    // cor por disciplina (a mesma no cartão do painel e nas aulas da grade)
    lots: lots.map((l, i) => ({
      id: l.id, componente: l.componente, sigla: sigla(l.componente), turma: l.turma, turma_id: l.turma_id, turno: l.turno,
      qualificacao: l.qualificacao, ch: l.ch, aulas: l.aulas, horas: Math.round((horas.get(l.id) ?? 0) * 10) / 10, cor: i,
    })),
    aulas: aulas.map((a) => ({ id: a.id, lotacao_id: a.lotacao_id, dia: a.dia_semana, tempo: a.tempo, turno: a.turno })),
    tempos,
  };
}

const CSS = `
.quadro{display:grid;grid-template-columns:minmax(270px,340px) 1fr;gap:1rem;align-items:start}
.painel-ucs{background:var(--superficie);border:1px solid var(--borda);border-radius:12px;box-shadow:var(--sombra);overflow:hidden;position:sticky;top:12px;max-height:calc(100vh - 24px);display:flex;flex-direction:column}
.painel-ucs .cab{padding:.6rem .8rem;font-weight:650;font-size:.88rem;border-bottom:1px solid var(--borda);display:flex;align-items:center;gap:.4rem}
.painel-ucs .lista{overflow:auto;padding-bottom:.4rem}
.painel-ucs.alvo{outline:3px dashed var(--erro);outline-offset:-3px}
.faixa-turno{background:linear-gradient(90deg,#5b3fd1,#7b5cf0);color:#fff;font-size:.74rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:.35rem .8rem}
.uc{display:grid;grid-template-columns:1fr auto;gap:.15rem .5rem;padding:.6rem .8rem;border-bottom:1px solid var(--borda);cursor:grab;user-select:none;border-left:5px solid hsl(var(--h),65%,48%)}
.uc:hover{background:var(--linha-hover)}
.uc.sel{background:var(--superficie-2);box-shadow:inset 0 0 0 2px var(--ciano)}
.uc.sem-turno{opacity:.5;cursor:not-allowed}
.uc b{font-size:.84rem;line-height:1.25}
.uc .det{font-size:.74rem;color:var(--texto-2);grid-column:1}
.uc .cont{grid-row:1/span 3;grid-column:2;align-self:center;text-align:center;font-size:.72rem;color:var(--texto-2)}
.uc .cont b{display:block;font-size:.92rem;padding:.15rem .55rem;border-radius:999px;background:var(--aviso-bg);color:var(--aviso);margin-bottom:.2rem}
.uc .cont b.ok{background:var(--ok-bg);color:var(--ok)}
.uc .cont .h.falta{color:var(--erro);font-weight:700}
.dica{font-size:.78rem;color:var(--texto-2);margin:.5rem .1rem 0}
.grade-turno{background:var(--superficie);border:1px solid var(--borda);border-radius:12px;box-shadow:var(--sombra);overflow:hidden;margin-bottom:1rem}
.grade-turno .titulo{display:flex;align-items:center;gap:.5rem;padding:.55rem .8rem;border-bottom:1px solid var(--borda);border-left:4px solid #6d4fe6;font-weight:700}
.grade-turno .titulo .tot{margin-left:auto;font-size:.8rem;color:var(--texto-2);font-weight:600}
table.kanban{box-shadow:none;border:0;border-radius:0;table-layout:fixed}
table.kanban th{text-align:center}
table.kanban td{padding:.25rem;height:3.1rem;vertical-align:middle;border-left:1px solid var(--borda)}
table.kanban td.t{width:5.2rem;text-align:center;font-size:.72rem;color:var(--texto-2);border-left:0;background:var(--th)}
table.kanban td.t b{display:block;font-size:.95rem;color:var(--texto)}
table.kanban td.livre.pode{background:var(--superficie-2);cursor:copy}
table.kanban td.livre.pode:hover,table.kanban td.sobre{outline:2px dashed var(--ciano);outline-offset:-3px;background:var(--ok-bg)}
.aula{border-radius:8px;padding:.25rem .35rem;font-size:.74rem;line-height:1.2;text-align:center;cursor:grab;user-select:none;
  background:hsla(var(--h),75%,55%,.16);border:1px solid hsla(var(--h),70%,45%,.45);border-left:4px solid hsl(var(--h),65%,48%);color:var(--texto)}
.aula b{display:block;font-size:.82rem}
.aula.arrastando{opacity:.4}
.aviso-grade{position:fixed;right:18px;bottom:18px;z-index:50;max-width:420px;padding:.7rem 1rem;border-radius:10px;border:1px solid;box-shadow:var(--sombra);font-size:.88rem;display:none}
.aviso-grade.ok{display:block;background:var(--ok-bg);color:var(--ok);border-color:var(--ok-borda)}
.aviso-grade.erro{display:block;background:var(--erro-bg);color:var(--erro);border-color:var(--erro-borda)}
@media (max-width:900px){.quadro{grid-template-columns:1fr}.painel-ucs{position:static;max-height:none} table.kanban td.t{width:3.6rem}}
`;

const JS = `
(function(){
  var raiz=document.getElementById('quadro'); if(!raiz) return;
  var E=JSON.parse(document.getElementById('estado').textContent), sel=null, arr=null;
  var DIAS=${JSON.stringify(DIAS_GRADE.map(([d, s]) => [d, s]))}, TURNO=${JSON.stringify(ROTULO_TURNO)};
  var api=raiz.dataset.api, aviso=document.getElementById('aviso-grade'), tAviso;
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function lot(id){return E.lots.find(function(l){return l.id===id})}
  function avisar(tipo,msg){aviso.className='aviso-grade '+tipo;aviso.textContent=msg;clearTimeout(tAviso);tAviso=setTimeout(function(){aviso.className='aviso-grade'},tipo==='erro'?7000:2500)}
  function cor(l){return (l.cor*67+200)%360}
  function render(){
    // painel
    var h='', turnos=[];
    E.lots.forEach(function(l){var t=l.turno||'';if(turnos.indexOf(t)<0)turnos.push(t)});
    turnos.forEach(function(t){
      h+='<div class="faixa-turno">'+(t?esc(TURNO[t]):'Sem turno')+'</div>';
      E.lots.filter(function(l){return (l.turno||'')===t}).forEach(function(l){
        var ok=l.horas>=l.ch;
        h+='<div class="uc'+(sel===l.id?' sel':'')+(l.turno?'':' sem-turno')+'" style="--h:'+cor(l)+'" draggable="'+(l.turno?'true':'false')+'" data-lot="'+l.id+'" title="Arraste para a grade ou clique e escolha o horário">'
          +'<b>'+esc(l.componente)+'</b><span class="det">Turma '+esc(l.turma)+(l.qualificacao?' · '+esc(l.qualificacao):'')+'</span>'
          +'<span class="det">'+esc(l.sigla)+' · CH '+l.ch+' h</span>'
          +'<span class="cont"><b class="'+(l.aulas?'ok':'')+'">'+l.aulas+'/sem</b><span class="h'+(ok?'':' falta')+'" title="horas de aula que a grade cobre até o fim do módulo (calendário letivo) / CH">'+String(l.horas).replace('.',',')+' de '+l.ch+' h</span></span></div>';
      });
    });
    document.getElementById('lista-ucs').innerHTML=h||'<p class="dica" style="padding:.8rem">Sem disciplinas lotadas.</p>';
    // grades
    var g='';
    Object.keys(E.tempos).forEach(function(turno){
      var ts=E.tempos[turno], doTurno=E.aulas.filter(function(a){return a.turno===turno});
      g+='<div class="grade-turno"><div class="titulo">'+esc(TURNO[turno])+'<span class="tot">'+doTurno.length+' aula(s) na semana</span></div>';
      if(!ts.length){g+='<p class="dica" style="padding:.8rem">Turno sem tempos de aula: cadastre em Tempos de aula.</p></div>';return;}
      g+='<table class="kanban"><tr><th style="width:5.2rem">Tempo</th>'+DIAS.map(function(d){return '<th>'+d[1]+'</th>'}).join('')+'</tr>';
      ts.forEach(function(t){
        g+='<tr><td class="t"><b>'+t.numero+'</b>'+t.hora_inicio+'–'+t.hora_fim+'</td>';
        DIAS.forEach(function(d){
          var a=doTurno.find(function(x){return x.dia===d[0]&&x.tempo===t.numero});
          if(a){var l=lot(a.lotacao_id)||{componente:'?',sigla:'?',turma:'',cor:0};
            g+='<td><div class="aula" draggable="true" data-aula="'+a.id+'" style="--h:'+cor(l)+'" title="'+esc(l.componente)+' — turma '+esc(l.turma)+' (arraste para mover; dois cliques remove)"><b>'+esc(l.sigla)+'</b>'+esc(l.turma)+'</div></td>';
          } else g+='<td class="livre" data-dia="'+d[0]+'" data-tempo="'+t.numero+'" data-turno="'+turno+'"></td>';
        });
        g+='</tr>';
      });
      g+='</table></div>';
    });
    document.getElementById('grades').innerHTML=g;
    marcarPossiveis();
  }
  function turnoSel(){var l=sel&&lot(sel);return l?l.turno:null}
  function marcarPossiveis(){var t=turnoSel();document.querySelectorAll('td.livre').forEach(function(td){td.classList.toggle('pode',!!t&&td.dataset.turno===t)})}
  function chamar(acao,dados){
    var f=new URLSearchParams(dados);f.set('acao',acao);
    return fetch(api,{method:'POST',body:f,headers:{'Accept':'application/json'}}).then(function(r){return r.json()}).then(function(j){
      if(j.estado){E=j.estado;render()} avisar(j.erro?'erro':'ok',j.erro||j.msg);
    }).catch(function(){avisar('erro','Não foi possível salvar agora. Tente de novo.')});
  }
  // clique: escolher disciplina e depois o horário
  raiz.addEventListener('click',function(e){
    var uc=e.target.closest('.uc');
    if(uc&&!uc.classList.contains('sem-turno')){var id=+uc.dataset.lot;sel=sel===id?null:id;render();return;}
    var td=e.target.closest('td.livre');
    if(td){ if(!sel){avisar('erro','Escolha (ou arraste) uma disciplina do painel à esquerda.');return;}
      if(td.dataset.turno!==turnoSel()){avisar('erro','A turma dessa disciplina é de outro turno.');return;}
      chamar('incluir',{lotacao_id:sel,dia:td.dataset.dia,tempo:td.dataset.tempo}); }
  });
  raiz.addEventListener('dblclick',function(e){var a=e.target.closest('.aula');if(a)chamar('remover',{aula_id:a.dataset.aula})});
  // arrastar
  raiz.addEventListener('dragstart',function(e){
    var uc=e.target.closest('.uc'), a=e.target.closest('.aula');
    if(uc){arr={tipo:'lot',id:+uc.dataset.lot,turno:lot(+uc.dataset.lot).turno};sel=arr.id;}
    else if(a){var au=E.aulas.find(function(x){return x.id===+a.dataset.aula});arr={tipo:'aula',id:au.id,turno:au.turno};a.classList.add('arrastando');document.getElementById('painel-ucs').classList.add('alvo');}
    else return;
    e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',arr.tipo+':'+arr.id);
    document.querySelectorAll('td.livre').forEach(function(td){td.classList.toggle('pode',td.dataset.turno===arr.turno)});
  });
  raiz.addEventListener('dragend',function(){arr=null;document.getElementById('painel-ucs').classList.remove('alvo');
    document.querySelectorAll('.arrastando,.sobre').forEach(function(x){x.classList.remove('arrastando','sobre')});marcarPossiveis()});
  raiz.addEventListener('dragover',function(e){
    if(!arr) return;
    var td=e.target.closest('td.livre'), painel=e.target.closest('#painel-ucs');
    if((td&&td.dataset.turno===arr.turno)||(painel&&arr.tipo==='aula')){e.preventDefault();e.dataTransfer.dropEffect='move';}
    document.querySelectorAll('.sobre').forEach(function(x){if(x!==td)x.classList.remove('sobre')}); if(td&&td.dataset.turno===arr.turno) td.classList.add('sobre');
  });
  raiz.addEventListener('drop',function(e){
    if(!arr) return; e.preventDefault();
    var td=e.target.closest('td.livre'), painel=e.target.closest('#painel-ucs'), a=arr;
    if(td&&td.dataset.turno===a.turno){
      if(a.tipo==='lot') chamar('incluir',{lotacao_id:a.id,dia:td.dataset.dia,tempo:td.dataset.tempo});
      else chamar('mover',{aula_id:a.id,dia:td.dataset.dia,tempo:td.dataset.tempo});
    } else if(painel&&a.tipo==='aula') chamar('remover',{aula_id:a.id});
  });
  render();
})();`;

rotasHorario.get('/', async (c) => {
  const db = c.env.DB;
  const anos = (await db.prepare('SELECT DISTINCT ano_letivo AS ano FROM turmas WHERE ano_letivo IS NOT NULL ORDER BY ano DESC').all<{ ano: number }>()).results.map((x) => x.ano);
  const ano = Number(c.req.query('ano')) || anos[0] || new Date().getFullYear();
  const profs = (await db.prepare(
    `SELECT DISTINCT f.id, f.nome FROM funcionarios f JOIN lotacoes l ON l.funcionario_id = f.id JOIN turmas t ON t.id = l.turma_id
      WHERE l.data_fim IS NULL AND t.ano_letivo = ? ORDER BY f.nome`,
  ).bind(ano).all<{ id: number; nome: string }>()).results;
  const prof = profs.find((p) => p.id === Number(c.req.query('prof'))) ?? (profs.length === 1 ? profs[0] : null);
  const estado = prof ? await estadoDoProfessor(db, prof.id, ano) : null;
  const semTurno = estado ? [...new Set(estado.lots.filter((l) => !l.turno).map((l) => l.turma))] : [];

  return c.html(
    <Pagina titulo="Horário do professor" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Horário do professor</h1>
      <div class="acoes" style="margin-top:0">
        <form method="get" class="acoes" style="margin:0">
          <label>Ano letivo<select name="ano" onchange="this.form.submit()">{(anos.length ? anos : [ano]).map((a) => <option selected={a === ano}>{a}</option>)}</select></label>
          <label>Professor(a)<select name="prof" onchange="this.form.submit()" style="min-width:320px"><option value="">Selecione</option>
            {profs.map((p) => <option value={p.id} selected={p.id === prof?.id}>{p.nome}</option>)}</select></label>
          <noscript><button class="sec">Abrir</button></noscript>
        </form>
        <a class="botao sec" style="align-self:flex-end" href={`${BASE}/tempos`}><Icone nome="auditoria" />Tempos de aula</a>
      </div>
      {!profs.length && <p class="muted">Nenhum professor com lotação ativa em {ano}. Faça a <a href="/admin/pedagogico/lotacao">lotação</a> primeiro.</p>}
      {semTurno.length > 0 && <div class="msg aviso">Turma(s) sem turno: {semTurno.join(', ')}. Informe o turno na tela da turma para usar a grade.</div>}
      {prof && estado && (
        <div class="quadro" id="quadro" data-api={`${BASE}/api?ano=${ano}&prof=${prof.id}`}>
          <aside class="painel-ucs" id="painel-ucs">
            <div class="cab"><Icone nome="cursos" />Disciplinas lotadas</div>
            <div class="lista" id="lista-ucs" />
          </aside>
          <div>
            <div id="grades" />
            <p class="dica"><b>Arraste</b> uma disciplina para um horário livre (ou clique nela e depois no horário). <b>Arraste</b> uma aula para mover;
              solte-a no painel para <b>remover</b> (dois cliques também remove). O contador mostra aulas/semana e as horas que a grade cobre até o fim do
              módulo, descontando feriados e recessos, contra a carga horária.</p>
          </div>
          <script type="application/json" id="estado" dangerouslySetInnerHTML={{ __html: JSON.stringify(estado).replace(/</g, '\\u003c') }} />
        </div>
      )}
      <div id="aviso-grade" class="aviso-grade" role="status" aria-live="polite" />
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </Pagina>,
  );
});

// ------------------------------------------------------------------ API da grade (incluir / mover / remover)
rotasHorario.post('/api', async (c) => {
  const db = c.env.DB;
  const ano = Number(c.req.query('ano'));
  const profId = Number(c.req.query('prof'));
  const corpo = await lerCorpo(c);
  const acao = texto(corpo, 'acao');
  const num = (k: string) => Number(texto(corpo, k));
  /** aula da grade de uma lotação ativa deste professor */
  const aulaDoProfessor = async (id: number) => {
    const a = await db.prepare(
      `SELECT ha.*, l.funcionario_id, cc.nome AS componente, t.codigo AS turma FROM horario_aulas ha JOIN lotacoes l ON l.id = ha.lotacao_id
         JOIN componentes_curriculares cc ON cc.id = l.componente_id JOIN turmas t ON t.id = l.turma_id WHERE ha.id = ? AND l.data_fim IS NULL`,
    ).bind(id).first<Record<string, any>>();
    if (!a || a.funcionario_id !== profId) throw new ErroValidacao('Aula não encontrada na grade deste professor.');
    return a;
  };
  const nomeDia = (d: number) => DIAS_GRADE.find(([x]) => x === d)?.[2] ?? '';
  try {
    let msg = '';
    if (acao === 'incluir') {
      const lotId = num('lotacao_id'), dia = num('dia'), tempo = num('tempo');
      const l = await db.prepare('SELECT l.funcionario_id, cc.nome FROM lotacoes l JOIN componentes_curriculares cc ON cc.id = l.componente_id WHERE l.id = ? AND l.data_fim IS NULL')
        .bind(lotId).first<{ funcionario_id: number; nome: string }>();
      if (!l || l.funcionario_id !== profId) throw new ErroValidacao('Disciplina não está lotada para este professor.');
      await validarAulaGrade(db, lotId, dia, tempo);
      await db.prepare('INSERT INTO horario_aulas (lotacao_id, dia_semana, tempo) VALUES (?, ?, ?)').bind(lotId, dia, tempo).run();
      await auditar(c, 'incluir_aula_grade', 'lotacao', lotId, null, { dia_semana: dia, tempo });
      msg = `${l.nome}: ${nomeDia(dia)}, ${tempo}º tempo.`;
    } else if (acao === 'mover') {
      const a = await aulaDoProfessor(num('aula_id'));
      const dia = num('dia'), tempo = num('tempo');
      if (a.dia_semana === dia && a.tempo === tempo) return c.json({ ok: true, msg: 'Sem mudança.', estado: await estadoDoProfessor(db, profId, ano) });
      await validarAulaGrade(db, a.lotacao_id, dia, tempo, a.id);
      await db.prepare('UPDATE horario_aulas SET dia_semana = ?, tempo = ? WHERE id = ?').bind(dia, tempo, a.id).run();
      await auditar(c, 'mover_aula_grade', 'lotacao', a.lotacao_id, { dia_semana: a.dia_semana, tempo: a.tempo }, { dia_semana: dia, tempo });
      msg = `${a.componente} (${a.turma}) movida para ${nomeDia(dia)}, ${tempo}º tempo.`;
    } else if (acao === 'remover') {
      const a = await aulaDoProfessor(num('aula_id'));
      await db.prepare('DELETE FROM horario_aulas WHERE id = ?').bind(a.id).run();
      await auditar(c, 'remover_aula_grade', 'lotacao', a.lotacao_id, { dia_semana: a.dia_semana, tempo: a.tempo, componente: a.componente }, null);
      msg = `${a.componente} (${a.turma}) retirada do horário.`;
    } else throw new ErroValidacao('Ação inválida.');
    return c.json({ ok: true, msg, estado: await estadoDoProfessor(db, profId, ano) });
  } catch (e) {
    if (e instanceof ErroValidacao) return c.json({ ok: false, erro: e.message, estado: await estadoDoProfessor(db, profId, ano) }, 400);
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
