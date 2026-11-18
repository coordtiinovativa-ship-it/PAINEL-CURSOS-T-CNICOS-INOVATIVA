/**
 * Gestão Pedagógica → Lotação de Professores: professor de cada disciplina da turma (por módulo).
 * Tela no padrão sysGEP: filtros (ano, curso, local, qualificação, turma), painel de atribuições ativas (Seq · Ações · UC ·
 * Professor · Data início) e histórico das encerradas. Incluir (+) · Trocar (encerra a atual com motivo, abre a nova e passa a
 * grade de horário) · Encerrar (bandeira) · Excluir (só atribuição feita por engano, sem chamada nem notas). Histórico preservado.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, inteiro, lerCorpo, texto } from '../lib/form';
import { dataBR } from '../lib/datas';
import { hojeMS } from '../certificado/dados';
import { modulosDaTurma, ROTULO_SITUACAO } from '../lib/turmaModulos';
import { DIAS_GRADE, validarAulaGrade } from '../lib/pedagogico';

export const rotasLotacao = new Hono<Env>();
rotasLotacao.use('*', exigir('pedagogico.gerenciar'));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BASE = '/admin/pedagogico/lotacao';
const diaAnterior = (iso: string) => new Date(Date.parse(iso + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
const nomeDia = Object.fromEntries(DIAS_GRADE.map(([d, s]) => [d, s]));

const CSS = `
.lot-filtros{display:grid;grid-template-columns:110px minmax(0,2fr) minmax(0,1.6fr);gap:.55rem .9rem;align-items:end}
.lot-filtros .l2{grid-column:1/3} .lot-filtros .l3{grid-column:3}
.lot-filtros label span.obr{color:var(--erro)}
.lot-filtros .ro{padding:.48rem .6rem;border:1px solid var(--borda);border-radius:8px;background:var(--superficie-2);color:var(--texto-2);font-size:.92rem;min-height:2.3rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:900px){.lot-filtros{grid-template-columns:1fr}.lot-filtros .l2,.lot-filtros .l3{grid-column:auto}}
.painel-lot{background:var(--superficie);border:1px solid var(--borda);border-radius:12px;box-shadow:var(--sombra);margin:1rem 0;overflow:hidden}
.painel-lot>header{display:flex;align-items:center;gap:.7rem;padding:.55rem .8rem;border-bottom:1px solid var(--borda)}
.painel-lot>header h2{flex:1;text-align:center;margin:0;font-size:.82rem;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--texto-2)}
.painel-lot>header h2 small{text-transform:none;letter-spacing:0;font-weight:500}
.painel-lot>header .mais{width:30px;height:30px;padding:0;justify-content:center;border-radius:7px;background:var(--verde-agua);color:#fff}
.painel-lot>header .mais:hover{background:#008f7a}
.painel-lot>header .mais svg{width:18px;height:18px}
.painel-lot table{border:0;border-radius:0;box-shadow:none}
.painel-lot th{text-align:center;background:var(--th);color:var(--titulo);font-weight:650}
.painel-lot td.seq{text-align:center;width:3.2rem;color:var(--texto-2)}
.painel-lot td.acoes-lot{white-space:nowrap;width:1%}
.painel-lot .vazio{padding:1.6rem 1rem;text-align:center;color:var(--texto-2)}
.pill{display:inline-flex;align-items:center;gap:.25rem;padding:.12rem .55rem;border:1px solid var(--link);border-radius:7px;background:transparent;color:var(--link);font-size:.78rem;font-weight:650;cursor:pointer}
.pill:hover{background:var(--superficie-2)}
.pill svg{width:14px;height:14px}
.ic-bt{background:transparent;border:0;padding:.15rem .3rem;color:var(--texto-2);cursor:pointer;vertical-align:middle}
.ic-bt svg{width:17px;height:17px}
.ic-bt:hover{background:var(--superficie-2);color:var(--titulo)}
.ic-bt.excluir{color:var(--erro)}
.prof-mun{color:var(--link);white-space:nowrap}
td .grade-chip{display:inline-block;margin:.1rem .2rem 0 0;padding:0 .4rem;border-radius:6px;background:var(--th);font-size:.72rem;color:var(--texto-2)}
.pendentes{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;padding:.6rem .8rem;border-top:1px dashed var(--borda-forte);font-size:.85rem;color:var(--texto-2)}
.pendentes button{font-size:.78rem;padding:.15rem .55rem;background:var(--aviso-bg);color:var(--aviso);border:1px solid var(--aviso-borda)}
.pendentes button:hover{background:var(--aviso-bg);border-color:var(--aviso)}
dialog.dlg-lot{border:1px solid var(--borda);border-radius:14px;padding:0;max-width:480px;width:calc(100% - 32px);background:var(--superficie);color:var(--texto);box-shadow:var(--sombra)}
dialog.dlg-lot::backdrop{background:rgba(0,0,0,.45)}
dialog.dlg-lot header{padding:.75rem 1rem;background:var(--degrade);color:#fff;font-weight:700}
dialog.dlg-lot form{padding:1rem;display:grid;gap:.75rem}
dialog.dlg-lot .info{font-size:.88rem;color:var(--texto-2)}
details.det summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:.25rem;color:var(--link);font-size:.8rem;font-weight:600}
details.det summary::-webkit-details-marker{display:none}
details.det div{margin-top:.35rem;font-size:.8rem;color:var(--texto-2);min-width:14rem}
`;

const JS = `
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-abrir]'); if(!b) return;
  var d=document.getElementById(b.dataset.abrir); if(!d) return;
  d.querySelectorAll('[data-campo]').forEach(function(x){
    var v=b.dataset[x.dataset.campo]; if(v===undefined) return;
    if(x.tagName==='INPUT'||x.tagName==='SELECT') x.value=v; else x.textContent=v;
  });
  var acao=b.dataset.acao; if(acao) d.querySelector('form').action=acao;
  // no "trocar", o professor atual não aparece na lista
  var atual=b.dataset.prof; d.querySelectorAll('select[name=funcionario_id] option').forEach(function(o){o.hidden=!!atual&&o.value===atual});
  d.showModal();
});
document.addEventListener('click',function(e){ if(e.target.matches('[data-fechar]')) e.target.closest('dialog').close(); });
`;

async function professores(db: D1Database) {
  return (await db.prepare(
    `SELECT f.id, f.nome, f.endereco_municipio AS municipio, f.endereco_uf AS uf FROM funcionarios f
       JOIN funcionario_categorias fc ON fc.funcionario_id = f.id AND fc.categoria = 'professor'
      WHERE f.ativo = 1 ORDER BY f.nome`,
  ).all<{ id: number; nome: string; municipio: string | null; uf: string | null }>()).results;
}

const munUf = (m?: string | null, uf?: string | null) => [m, uf].filter(Boolean).join('-').toUpperCase();

const Obr = () => <span class="obr"> *</span>;

rotasLotacao.get('/', async (c) => {
  const db = c.env.DB;
  const anos = (await db.prepare('SELECT DISTINCT ano_letivo AS ano FROM turmas WHERE ano_letivo IS NOT NULL ORDER BY ano DESC').all<{ ano: number }>()).results.map((x) => x.ano);
  const ano = Number(c.req.query('ano')) || anos[0] || new Date().getFullYear();
  const todas = (await db.prepare(
    `SELECT t.id, t.codigo, t.turno, t.polo, t.curso_id, cu.nome AS curso FROM turmas t JOIN cursos cu ON cu.id = t.curso_id
      WHERE t.ano_letivo = ? ORDER BY cu.nome, t.codigo`,
  ).bind(ano).all<{ id: number; codigo: string; turno: string | null; polo: string | null; curso_id: number; curso: string }>()).results;
  const cursos = [...new Map(todas.map((t) => [t.curso_id, t.curso])).entries()];
  const turmaQ = todas.find((t) => t.id === Number(c.req.query('turma')));
  const cursoId = Number(c.req.query('curso')) || turmaQ?.curso_id || (cursos.length === 1 ? cursos[0][0] : 0);
  const turmas = todas.filter((t) => t.curso_id === cursoId);
  const turma = turmas.find((t) => t.id === turmaQ?.id) ?? (turmas.length === 1 ? turmas[0] : null);
  const modulos = turma ? await modulosDaTurma(db, turma.id) : [];
  const modulo = modulos.find((m) => m.modulo_id === Number(c.req.query('modulo')))
    ?? modulos.find((m) => m.situacao === 'em_andamento') ?? modulos[0] ?? null;
  const profs = await professores(db);
  const inst = await db.prepare('SELECT nome_fantasia, municipio, uf FROM instituicoes ORDER BY id LIMIT 1').first<{ nome_fantasia: string | null; municipio: string | null; uf: string | null }>();
  const local = turma?.polo || [inst?.nome_fantasia, munUf(inst?.municipio, inst?.uf)].filter(Boolean).join(' — ');

  let disciplinas: Record<string, any>[] = [];
  let historico: Record<string, any>[] = [];
  const grade = new Map<number, string[]>();
  if (turma && modulo) {
    disciplinas = (await db.prepare(
      `SELECT cc.id, cc.nome, cc.carga_horaria_total AS ch, l.id AS lotacao_id, l.data_inicio, l.criado_por, l.criado_em,
              f.id AS funcionario_id, f.nome AS professor, f.endereco_municipio AS municipio, f.endereco_uf AS uf
         FROM componentes_curriculares cc
         LEFT JOIN lotacoes l ON l.componente_id = cc.id AND l.turma_id = ? AND l.data_fim IS NULL
         LEFT JOIN funcionarios f ON f.id = l.funcionario_id
        WHERE cc.modulo_id = ? ORDER BY cc.ordem`,
    ).bind(turma.id, modulo.modulo_id).all<Record<string, any>>()).results;
    historico = (await db.prepare(
      `SELECT l.*, cc.nome AS componente, f.nome AS professor, f.endereco_municipio AS municipio, f.endereco_uf AS uf
         FROM lotacoes l JOIN componentes_curriculares cc ON cc.id = l.componente_id
         JOIN funcionarios f ON f.id = l.funcionario_id WHERE l.turma_id = ? AND cc.modulo_id = ? AND l.data_fim IS NOT NULL
        ORDER BY l.encerrada_em DESC, l.id DESC`,
    ).bind(turma.id, modulo.modulo_id).all<Record<string, any>>()).results;
    const aulas = (await db.prepare(
      `SELECT ha.lotacao_id, ha.dia_semana, ha.tempo FROM horario_aulas ha JOIN lotacoes l ON l.id = ha.lotacao_id
        WHERE l.turma_id = ? AND l.data_fim IS NULL ORDER BY ha.dia_semana, ha.tempo`,
    ).bind(turma.id).all<{ lotacao_id: number; dia_semana: number; tempo: number }>()).results;
    for (const a of aulas) grade.set(a.lotacao_id, [...(grade.get(a.lotacao_id) ?? []), `${nomeDia[a.dia_semana]} T${a.tempo}`]);
  }
  const ativas = disciplinas.filter((d) => d.lotacao_id);
  const semProf = disciplinas.filter((d) => !d.lotacao_id);
  const voltaQS = turma && modulo ? `?ano=${ano}&curso=${cursoId}&turma=${turma.id}&modulo=${modulo.modulo_id}` : `?ano=${ano}&curso=${cursoId}`;
  const inicioPadrao = modulo?.data_inicio && modulo.data_inicio > hojeMS() ? modulo.data_inicio : modulo?.data_inicio ?? hojeMS();
  const nomeProf = (p: { professor: string; municipio?: string | null; uf?: string | null }) => (
    <>{p.professor.toUpperCase()}{munUf(p.municipio, p.uf) && <span class="prof-mun"> - {munUf(p.municipio, p.uf)}</span>}</>
  );

  return c.html(
    <Pagina titulo="Lotação de professores" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Lotação de Professores</h1>
      <div class="cartao">
        <form method="get" class="lot-filtros">
          <label><span>Ano Letivo<Obr /></span><select name="ano" onchange="this.form.curso.value='';this.form.turma.value='';this.form.submit()">
            {(anos.length ? anos : [ano]).map((a) => <option selected={a === ano}>{a}</option>)}</select></label>
          <label><span>Curso<Obr /></span><select name="curso" onchange="this.form.turma.value='';this.form.modulo.value='';this.form.submit()">
            <option value="">Selecione</option>
            {cursos.map(([id, nome]) => <option value={id} selected={id === cursoId}>{nome.toUpperCase()}</option>)}</select></label>
          <label>Escola / Local<div class="ro" title={local}>{(local || '—').toUpperCase()}</div></label>
          <label class="l2"><span>Qualificação (módulo)<Obr /></span><select name="modulo" onchange="this.form.submit()" disabled={!modulos.length}>
            {!modulos.length && <option value="">Selecione a turma</option>}
            {modulos.map((m) => <option value={m.modulo_id} selected={m.modulo_id === modulo?.modulo_id}>
              {(m.qualificacao_conferida || m.nome).toUpperCase()} — {m.ordem}º módulo ({ROTULO_SITUACAO[m.situacao].toLowerCase()})</option>)}</select></label>
          <label class="l3"><span>Turma<Obr /></span><select name="turma" onchange="this.form.modulo.value='';this.form.submit()" disabled={!turmas.length}>
            <option value="">{turmas.length ? 'Selecione' : 'Selecione o curso'}</option>
            {turmas.map((t) => <option value={t.id} selected={t.id === turma?.id}>{t.codigo}{t.turno ? ` - ${t.turno.toUpperCase()}` : ''}</option>)}</select></label>
          <noscript><button class="sec">Filtrar</button></noscript>
        </form>
      </div>
      {!profs.length && <div class="msg aviso">Nenhum professor ativo cadastrado. Cadastre em <a href="/admin/pedagogico/funcionarios/novo">Funcionários</a> (categoria Professor).</div>}
      {turma && !turma.turno && <div class="msg aviso">A turma {turma.codigo} está sem turno: informe o turno na <a href={`/admin/turmas/${turma.id}`}>tela da turma</a> para montar o horário.</div>}
      {!todas.length && <p class="muted">Nenhuma turma no ano letivo {ano}.</p>}

      {turma && modulo && (
        <>
          <section class="painel-lot">
            <header>
              <button type="button" class="mais" title="Incluir atribuição" aria-label="Incluir atribuição" data-abrir="dlg-atribuir"
                data-comp={String(semProf[0]?.id ?? '')} disabled={!semProf.length || !profs.length}><Icone nome="incluir" /></button>
              <h2>Atribuições ativas <small>(Professor por UC)</small></h2>
              <span style="width:30px" />
            </header>
            {ativas.length ? (
              <table>
                <tr><th>Seq</th><th>Ações</th><th>Unidade Curricular</th><th>Professor</th><th>Data Início</th><th>Horário</th></tr>
                {ativas.map((d, i) => (
                  <tr>
                    <td class="seq">{i + 1}</td>
                    <td class="acoes-lot">
                      <button type="button" class="pill" data-abrir="dlg-trocar" data-acao={`${BASE}/${d.lotacao_id}/trocar${voltaQS}`}
                        data-uc={d.nome} data-atual={d.professor} data-prof={String(d.funcionario_id)} title="Trocar o professor"><Icone nome="atualizar" />Trocar</button>
                      <button type="button" class="ic-bt" title="Encerrar a atribuição (fica no histórico)" aria-label="Encerrar" data-abrir="dlg-encerrar"
                        data-acao={`${BASE}/${d.lotacao_id}/encerrar${voltaQS}`} data-uc={d.nome} data-atual={d.professor}><Icone nome="bandeira" /></button>
                      <form method="post" action={`${BASE}/${d.lotacao_id}/excluir${voltaQS}`} style="display:inline"
                        onsubmit={`return confirm('Excluir a atribuição de ${String(d.professor).replace(/'/g, '')} em ${String(d.nome).replace(/'/g, '')}? Use só para atribuição feita por engano (sem chamada registrada). O horário dela sai da grade.')`}>
                        <button class="ic-bt excluir" title="Excluir (atribuição feita por engano)" aria-label="Excluir"><Icone nome="excluir" /></button>
                      </form>
                    </td>
                    <td>{d.nome.toUpperCase()} <span class="muted">({d.ch} h)</span></td>
                    <td>{nomeProf(d as any)}</td>
                    <td class="c">{dataBR(d.data_inicio)}</td>
                    <td>{(grade.get(d.lotacao_id) ?? []).map((g) => <span class="grade-chip">{g}</span>)}
                      {!grade.get(d.lotacao_id) && <a href={`/admin/pedagogico/horario?ano=${ano}&prof=${d.funcionario_id}`} style="font-size:.8rem">montar horário</a>}</td>
                  </tr>
                ))}
              </table>
            ) : <div class="vazio">Nenhuma atribuição ativa neste módulo. Use o <b>+</b> para incluir.</div>}
            {semProf.length > 0 && (
              <div class="pendentes">
                <span class="tag aviso">sem professor</span>
                {semProf.map((d) => (
                  <button type="button" data-abrir="dlg-atribuir" data-comp={String(d.id)} disabled={!profs.length} title="Atribuir professor">
                    {d.nome}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section class="painel-lot">
            <header><h2>Histórico de atribuições <small>(encerradas)</small></h2></header>
            {historico.length ? (
              <table>
                <tr><th>Detalhes</th><th>Unidade Curricular</th><th>Professor</th><th>Período</th><th>Motivo</th><th>Desativado por</th><th>Data desativação</th></tr>
                {historico.map((h) => (
                  <tr>
                    <td class="c">
                      <details class="det"><summary><Icone nome="buscar" />ver</summary>
                        <div>Atribuída em {h.criado_em ? `${dataBR(h.criado_em)}` : '—'}{h.criado_por ? ` por ${h.criado_por}` : ''}.<br />
                          Lecionou de {dataBR(h.data_inicio)} a {dataBR(h.data_fim)}.</div>
                      </details>
                    </td>
                    <td>{h.componente.toUpperCase()}</td>
                    <td>{nomeProf(h as any)}</td>
                    <td class="c">{dataBR(h.data_inicio)} a {dataBR(h.data_fim)}</td>
                    <td>{h.motivo_fim ?? ''}</td>
                    <td>{h.encerrada_por ?? ''}</td>
                    <td class="c">{h.encerrada_em ? dataBR(h.encerrada_em) : ''}</td>
                  </tr>
                ))}
              </table>
            ) : <div class="vazio">Sem histórico de atribuições encerradas.</div>}
          </section>

          <dialog class="dlg-lot" id="dlg-atribuir">
            <header>Incluir atribuição — {turma.codigo}</header>
            <form method="post" action={`${BASE}/atribuir${voltaQS}`}>
              <input type="hidden" name="turma_id" value={turma.id} />
              <label>Unidade curricular<select name="componente_id" data-campo="comp" required>
                {semProf.map((d) => <option value={d.id}>{d.nome} ({d.ch} h)</option>)}</select></label>
              <label>Professor(a)<select name="funcionario_id" required><option value="">Selecione</option>
                {profs.map((p) => <option value={p.id}>{p.nome}{munUf(p.municipio, p.uf) ? ` - ${munUf(p.municipio, p.uf)}` : ''}</option>)}</select></label>
              <label>Data de início<input type="date" name="data_inicio" value={inicioPadrao} required /></label>
              <div class="acoes"><button><Icone nome="salvar" />Atribuir</button><button type="button" class="sec" data-fechar>Cancelar</button></div>
            </form>
          </dialog>

          <dialog class="dlg-lot" id="dlg-trocar">
            <header>Trocar professor</header>
            <form method="post">
              <p class="info"><b data-campo="uc" /><br />Professor atual: <span data-campo="atual" /></p>
              <label>Novo professor(a)<select name="funcionario_id" required><option value="">Selecione</option>
                {profs.map((p) => <option value={p.id}>{p.nome}{munUf(p.municipio, p.uf) ? ` - ${munUf(p.municipio, p.uf)}` : ''}</option>)}</select></label>
              <label>Novo professor a partir de<input type="date" name="data" value={hojeMS()} required /></label>
              <label>Motivo<input name="motivo" required placeholder="Ex.: licença, substituição" /></label>
              <p class="info">A atribuição atual vai para o histórico e o horário passa para o novo professor (se não houver choque).</p>
              <div class="acoes"><button><Icone nome="atualizar" />Trocar</button><button type="button" class="sec" data-fechar>Cancelar</button></div>
            </form>
          </dialog>

          <dialog class="dlg-lot" id="dlg-encerrar">
            <header>Encerrar atribuição</header>
            <form method="post">
              <p class="info"><b data-campo="uc" /><br />Professor: <span data-campo="atual" /></p>
              <label>Último dia<input type="date" name="data_fim" value={hojeMS()} required /></label>
              <label>Motivo<input name="motivo" required placeholder="Ex.: disciplina concluída" /></label>
              <p class="info">A disciplina fica sem professor e o horário dela sai da grade. A atribuição fica no histórico.</p>
              <div class="acoes"><button class="perigo"><Icone nome="bandeira" />Encerrar</button><button type="button" class="sec" data-fechar>Cancelar</button></div>
            </form>
          </dialog>
          <script dangerouslySetInnerHTML={{ __html: JS }} />
        </>
      )}
    </Pagina>,
  );
});

const voltar = (c: any, tipo: 'ok' | 'erro', msg: string) => {
  const qs = new URL(c.req.url).search;
  return c.redirect(`${BASE}${qs}${qs ? '&' : '?'}${tipo}=` + encodeURIComponent(msg));
};

async function validarProfessor(db: D1Database, id: number | null) {
  const p = id ? await db.prepare(
    `SELECT f.id, f.nome FROM funcionarios f JOIN funcionario_categorias fc ON fc.funcionario_id = f.id AND fc.categoria = 'professor' WHERE f.id = ? AND f.ativo = 1`,
  ).bind(id).first<{ id: number; nome: string }>() : null;
  if (!p) throw new ErroValidacao('Selecione um professor ativo.');
  return p;
}

async function validarDataNoAno(db: D1Database, turmaId: number, data: string | null, rotulo: string) {
  if (!data || !ISO.test(data)) throw new ErroValidacao(`Informe ${rotulo}.`);
  const a = await db.prepare('SELECT a.* FROM turmas t JOIN anos_letivos a ON a.ano = t.ano_letivo WHERE t.id = ?').bind(turmaId).first<{ data_inicio: string; data_fim: string; ano: number }>();
  if (a && (data < a.data_inicio || data > a.data_fim)) throw new ErroValidacao(`${rotulo[0].toUpperCase() + rotulo.slice(1)} fora do ano letivo ${a.ano} (${dataBR(a.data_inicio)} a ${dataBR(a.data_fim)}).`);
}

rotasLotacao.post('/atribuir', async (c) => {
  const db = c.env.DB;
  const corpo = await lerCorpo(c);
  try {
    const turmaId = inteiro(corpo, 'turma_id') ?? 0;
    const compId = inteiro(corpo, 'componente_id') ?? 0;
    const data = texto(corpo, 'data_inicio');
    const ok = await db.prepare('SELECT t.codigo, cc.nome FROM turmas t JOIN componentes_curriculares cc ON cc.matriz_id = t.matriz_id WHERE t.id = ? AND cc.id = ?')
      .bind(turmaId, compId).first<{ codigo: string; nome: string }>();
    if (!ok) throw new ErroValidacao('Disciplina não pertence à matriz da turma.');
    const prof = await validarProfessor(db, inteiro(corpo, 'funcionario_id'));
    await validarDataNoAno(db, turmaId, data, 'a data de início');
    if (await db.prepare('SELECT 1 FROM lotacoes WHERE turma_id = ? AND componente_id = ? AND data_fim IS NULL').bind(turmaId, compId).first()) {
      throw new ErroValidacao('Esta disciplina já tem professor: use "Trocar".');
    }
    const r = await db.prepare('INSERT INTO lotacoes (turma_id, componente_id, funcionario_id, data_inicio, criado_por) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(turmaId, compId, prof.id, data, c.get('usuario').email).first<{ id: number }>();
    await auditar(c, 'atribuir', 'lotacao', r!.id, null, { turma: ok.codigo, disciplina: ok.nome, professor: prof.nome, data_inicio: data });
    return voltar(c, 'ok', `${prof.nome} atribuído(a) a ${ok.nome}. Agora monte o horário.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, 'erro', e.message);
    throw e;
  }
});

async function lotacaoAtiva(db: D1Database, id: number) {
  return db.prepare(
    `SELECT l.*, t.codigo AS turma, cc.nome AS componente, f.nome AS professor FROM lotacoes l JOIN turmas t ON t.id = l.turma_id
       JOIN componentes_curriculares cc ON cc.id = l.componente_id JOIN funcionarios f ON f.id = l.funcionario_id WHERE l.id = ? AND l.data_fim IS NULL`,
  ).bind(id).first<Record<string, any>>();
}

rotasLotacao.post('/:id{[0-9]+}/trocar', async (c) => {
  const db = c.env.DB;
  const l = await lotacaoAtiva(db, Number(c.req.param('id')));
  if (!l) return voltar(c, 'erro', 'Lotação não encontrada ou já encerrada.');
  const corpo = await lerCorpo(c);
  try {
    const prof = await validarProfessor(db, inteiro(corpo, 'funcionario_id'));
    if (prof.id === l.funcionario_id) throw new ErroValidacao('Escolha um professor diferente do atual.');
    const data = texto(corpo, 'data');
    const motivo = texto(corpo, 'motivo');
    await validarDataNoAno(db, l.turma_id, data, 'a data da troca');
    if (data! < l.data_inicio) throw new ErroValidacao(`A troca não pode ser antes do início da lotação atual (${dataBR(l.data_inicio)}).`);
    if (!motivo) throw new ErroValidacao('Informe o motivo da troca.');
    const fimAnterior = data! > l.data_inicio ? diaAnterior(data!) : l.data_inicio;
    const aulas = (await db.prepare('SELECT dia_semana, tempo FROM horario_aulas WHERE lotacao_id = ?').bind(l.id).all<{ dia_semana: number; tempo: number }>()).results;
    // encerra a atual e abre a nova; a grade passa para a nova lotação (se o novo professor não tiver choque)
    await db.batch([
      db.prepare(`UPDATE lotacoes SET data_fim = ?, motivo_fim = ?, encerrada_por = ?, encerrada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
        .bind(fimAnterior, `Troca: ${motivo}`, c.get('usuario').email, l.id),
      db.prepare('INSERT INTO lotacoes (turma_id, componente_id, funcionario_id, data_inicio, criado_por) VALUES (?, ?, ?, ?, ?)')
        .bind(l.turma_id, l.componente_id, prof.id, data, c.get('usuario').email),
    ]);
    const nova = (await db.prepare('SELECT id FROM lotacoes WHERE turma_id = ? AND componente_id = ? AND data_fim IS NULL').bind(l.turma_id, l.componente_id).first<{ id: number }>())!;
    const passou: string[] = [];
    const choques: string[] = [];
    for (const a of aulas) {
      try {
        await validarAulaGrade(db, nova.id, a.dia_semana, a.tempo);
        await db.prepare('INSERT INTO horario_aulas (lotacao_id, dia_semana, tempo) VALUES (?, ?, ?)').bind(nova.id, a.dia_semana, a.tempo).run();
        passou.push(`${nomeDia[a.dia_semana]} T${a.tempo}`);
      } catch (e) {
        if (e instanceof ErroValidacao) choques.push(`${nomeDia[a.dia_semana]} T${a.tempo}`);
        else throw e;
      }
    }
    await auditar(c, 'trocar', 'lotacao', l.id, { professor: l.professor, data_inicio: l.data_inicio },
      { turma: l.turma, disciplina: l.componente, novo_professor: prof.nome, a_partir_de: data, motivo, horario_transferido: passou, horario_com_choque: choques });
    const msg = `${l.componente}: ${prof.nome} a partir de ${dataBR(data!)}.` +
      (choques.length ? ` Atenção: ${choques.join(', ')} não passaram para o novo professor por choque de horário — ajuste em Horário do Professor.` : '');
    return voltar(c, choques.length ? 'erro' : 'ok', msg);
  } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, 'erro', e.message);
    throw e;
  }
});

rotasLotacao.post('/:id{[0-9]+}/encerrar', async (c) => {
  const db = c.env.DB;
  const l = await lotacaoAtiva(db, Number(c.req.param('id')));
  if (!l) return voltar(c, 'erro', 'Lotação não encontrada ou já encerrada.');
  const corpo = await lerCorpo(c);
  try {
    const data = texto(corpo, 'data_fim');
    const motivo = texto(corpo, 'motivo');
    await validarDataNoAno(db, l.turma_id, data, 'o último dia');
    if (data! < l.data_inicio) throw new ErroValidacao(`O último dia não pode ser antes do início (${dataBR(l.data_inicio)}).`);
    if (!motivo) throw new ErroValidacao('Informe o motivo.');
    await db.prepare(`UPDATE lotacoes SET data_fim = ?, motivo_fim = ?, encerrada_por = ?, encerrada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(data, motivo, c.get('usuario').email, l.id).run();
    await auditar(c, 'encerrar', 'lotacao', l.id, { professor: l.professor, data_inicio: l.data_inicio }, { turma: l.turma, disciplina: l.componente, data_fim: data, motivo });
    return voltar(c, 'ok', `Lotação de ${l.professor} em ${l.componente} encerrada em ${dataBR(data!)}.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, 'erro', e.message);
    throw e;
  }
});

// Excluir: só para atribuição feita por engano — sem chamada registrada nem notas lançadas por esse professor na disciplina.
rotasLotacao.post('/:id{[0-9]+}/excluir', async (c) => {
  const db = c.env.DB;
  const l = await lotacaoAtiva(db, Number(c.req.param('id')));
  if (!l) return voltar(c, 'erro', 'Lotação não encontrada ou já encerrada.');
  const chamada = await db.prepare(
    `SELECT count(*) AS n FROM aulas WHERE lotacao_id = ? OR (turma_id = ? AND componente_id = ? AND funcionario_id = ? AND data >= ?)`,
  ).bind(l.id, l.turma_id, l.componente_id, l.funcionario_id, l.data_inicio).first<{ n: number }>();
  const notas = await db.prepare(
    `SELECT count(*) AS n FROM resultados r JOIN matriculas m ON m.id = r.matricula_id
      WHERE m.turma_id = ? AND r.componente_id = ? AND r.professor_id = ?`,
  ).bind(l.turma_id, l.componente_id, l.funcionario_id).first<{ n: number }>();
  if (chamada?.n || notas?.n) {
    return voltar(c, 'erro', `Não é possível excluir: ${l.professor} já tem ${[chamada?.n ? `${chamada.n} aula(s) na chamada` : '', notas?.n ? `${notas.n} nota(s) lançada(s)` : ''].filter(Boolean).join(' e ')} em ${l.componente}. Use "Encerrar" (bandeira) ou "Trocar" — o histórico fica preservado.`);
  }
  const horario = (await db.prepare('SELECT dia_semana, tempo FROM horario_aulas WHERE lotacao_id = ?').bind(l.id).all()).results;
  await db.batch([
    db.prepare('DELETE FROM horario_aulas WHERE lotacao_id = ?').bind(l.id),
    db.prepare('DELETE FROM lotacoes WHERE id = ?').bind(l.id),
  ]);
  await auditar(c, 'excluir', 'lotacao', l.id, { turma: l.turma, disciplina: l.componente, professor: l.professor, data_inicio: l.data_inicio, horario }, null);
  return voltar(c, 'ok', `Atribuição de ${l.professor} em ${l.componente} excluída.`);
});
