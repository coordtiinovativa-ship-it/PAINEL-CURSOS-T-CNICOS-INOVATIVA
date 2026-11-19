/** Secretaria → Relatórios. Disponível para admin master, administrador, coordenador e secretaria. */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { descreverAto } from '../certificado/dados';
import { DocumentoHtml } from '../documentos/html';
import { gerarPdfDocumento } from '../documentos/pdf';
import { recursosDocumento } from '../documentos/emissao';
import { urlArquivo } from '../lib/arquivos';
import { asset, r2 } from '../certificado/recursos';
import { hojeMS } from '../certificado/dados';
import { dadosControle, ErroControle, lerFiltroControle } from '../relatorios/controle';
import { gerarPdfControle, type TipoControle } from '../relatorios/controlePdf';
import { consultar, dataHoraMS, gerarCSVRelatorio, lerFiltros, montarLayout, SITUACOES_MATRICULA, type Filtros } from '../relatorios/alunosSituacao';

export const rotasRelatorios = new Hono<Env>();
rotasRelatorios.use('*', exigir('relatorios.emitir'));

const CSS = `
.relatorios{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(420px,100%),1fr));gap:1rem}
.relatorio{background:var(--superficie);border:1px solid var(--borda);border-radius:14px;box-shadow:var(--sombra);overflow:hidden}
.relatorio .cab{display:flex;gap:.8rem;align-items:flex-start;padding:1rem 1.2rem;border-bottom:1px solid var(--borda);background:var(--superficie-2)}
.relatorio .cab .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;flex:none;color:#fff;background:linear-gradient(135deg,var(--marinho),var(--ciano))}
.relatorio .cab .ic svg{width:22px;height:22px}
.relatorio .cab h2{margin:0;font-size:1.05rem}
.relatorio .cab p{margin:.2rem 0 0;font-size:.85rem;color:var(--texto-2)}
.relatorio form{padding:1rem 1.2rem 1.2rem;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.7rem 1rem}
.relatorio form .largo{grid-column:1/-1}
.relatorio .botoes{grid-column:1/-1;display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.3rem}
@media (max-width:600px){.relatorios{grid-template-columns:1fr} .relatorio form{grid-template-columns:minmax(0,1fr)}}
`;

rotasRelatorios.get('/', async (c) => {
  const db = c.env.DB;
  const [cursos, turmas] = await Promise.all([
    db.prepare('SELECT id, nome FROM cursos ORDER BY ativo DESC, nome').all<{ id: number; nome: string }>(),
    db.prepare('SELECT t.id, t.codigo, cu.nome AS curso FROM turmas t JOIN cursos cu ON cu.id = t.curso_id ORDER BY t.data_inicio DESC, t.codigo').all<{ id: number; codigo: string; curso: string }>(),
  ]);
  const turmaSel = Number(c.req.query('turma')) || null;
  // Controle de Notas e Faltas: disciplinas da matriz da turma, agrupadas por módulo
  const discs = turmaSel ? (await db.prepare(
    `SELECT cc.id, cc.nome, mt.id AS modulo_id, mt.ordem, mt.nome AS modulo, tm.situacao
       FROM turmas t JOIN componentes_curriculares cc ON cc.matriz_id = t.matriz_id JOIN modulos_tematicos mt ON mt.id = cc.modulo_id
       LEFT JOIN turma_modulos tm ON tm.turma_id = t.id AND tm.modulo_id = mt.id
      WHERE t.id = ? ORDER BY mt.ordem, cc.ordem`,
  ).bind(turmaSel).all<{ id: number; nome: string; modulo_id: number; ordem: number; modulo: string; situacao: string | null }>()).results : [];
  const modulos = [...new Map(discs.map((d) => [d.modulo_id, d])).values()];
  const discSel = c.req.query('disc') ?? '';
  return c.html(
    <Pagina titulo="Relatórios" usuario={c.get('usuario')} caminho={c.req.path} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Relatórios</h1>
      <p class="muted" style="margin-top:-.6rem">Escolha os filtros e emita. Todo relatório registra quem emitiu, com data e hora, e fica na auditoria.</p>
      <div class="relatorios">
        <section class="relatorio" id="alunos-situacao">
          <div class="cab">
            <span class="ic"><Icone nome="alunos" /></span>
            <div><h2>Alunos por situação de matrícula</h2><p>Cursando, concluído, reprovado ou desistente — por curso e turma.</p></div>
          </div>
          <form method="get" action="/admin/relatorios/alunos-situacao.pdf" target="_blank">
            <label class="largo">Situação da matrícula
              <select name="situacao">
                <option value="">Todas as situações</option>
                {SITUACOES_MATRICULA.map(([v, r]) => <option value={v}>{r}</option>)}
              </select>
            </label>
            <label>Curso
              <select name="curso"><option value="">Todos os cursos</option>{cursos.results.map((cu) => <option value={cu.id}>{cu.nome}</option>)}</select>
            </label>
            <label>Turma
              <select name="turma"><option value="">Todas as turmas</option>{turmas.results.map((t) => <option value={t.id} selected={t.id === turmaSel}>{t.codigo} — {t.curso}</option>)}</select>
            </label>
            <div class="botoes">
              <button><Icone nome="certificados" />Emitir PDF</button>
              <button class="sec" formaction="/admin/relatorios/alunos-situacao"><Icone nome="documento" />Visualizar na tela</button>
              <button class="sec" formaction="/admin/relatorios/alunos-situacao.csv" formtarget="_self"><Icone nome="baixar" />Exportar planilha (CSV)</button>
            </div>
          </form>
        </section>

        <section class="relatorio" id="controle">
          <div class="cab">
            <span class="ic"><Icone nome="pedagogico" /></span>
            <div><h2>Controle de Notas e Controle de Faltas</h2><p>Por turma e disciplina (ou todas do módulo), no modelo do sysGEP, em PDF paisagem.</p></div>
          </div>
          <form method="get" action="/admin/relatorios/controle-notas.pdf" target="_blank">
            <label class="largo">Turma
              <select name="turma" required onchange="location='/admin/relatorios?turma='+this.value+'#controle'">
                <option value="">Selecione a turma</option>
                {turmas.results.map((t) => <option value={t.id} selected={t.id === turmaSel}>{t.codigo} — {t.curso}</option>)}
              </select>
            </label>
            <label class="largo">Disciplina
              <select name="disc" required disabled={!turmaSel}>
                <option value="">{turmaSel ? 'Selecione' : 'Escolha a turma primeiro'}</option>
                {modulos.map((m) => (
                  <optgroup label={`${m.ordem}º módulo — ${m.modulo}${m.situacao === 'em_andamento' ? ' (em andamento)' : m.situacao === 'concluido' ? ' (concluído)' : ''}`}>
                    <option value={`m:${m.modulo_id}`} selected={discSel === `m:${m.modulo_id}`}>Todas as disciplinas do {m.ordem}º módulo</option>
                    {discs.filter((d) => d.modulo_id === m.modulo_id).map((d) => <option value={`c:${d.id}`} selected={discSel === `c:${d.id}`}>{d.nome}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>Ordenação dos alunos
              <select name="ordem"><option value="alfabetica">Alfabética</option><option value="chamada">Nº de chamada</option></select>
            </label>
            <label style="flex-direction:row;align-items:center;gap:.4rem;align-self:end">
              <input type="checkbox" name="com_faltas" value="1" />Faltas: só alunos com falta
            </label>
            <div class="botoes">
              <button disabled={!turmaSel}><Icone nome="certificados" />Controle de Notas (PDF)</button>
              <button class="sec" disabled={!turmaSel} formaction="/admin/relatorios/controle-faltas.pdf"><Icone nome="certificados" />Controle de Faltas (PDF)</button>
            </div>
          </form>
        </section>
      </div>
    </Pagina>,
  );
});

async function preparar(c: any, formato: string) {
  const db = c.env.DB as D1Database;
  const filtros: Filtros = lerFiltros(c.req.query());
  const u = c.get('usuario');
  const [dados, inst, cred] = await Promise.all([
    consultar(db, filtros),
    db.prepare('SELECT * FROM instituicoes WHERE id = 1').first<Record<string, any>>(),
    db.prepare(`SELECT * FROM atos_regulatorios WHERE finalidade = 'credenciamento' AND instituicao_id = 1 AND ativo = 1 ORDER BY data DESC LIMIT 1`).first<Record<string, any>>(),
  ]);
  const quando = dataHoraMS();
  const emissor = { nome: u.nome, email: u.email };
  await auditar(c, 'emitir_relatorio', 'relatorio', null, null, { relatorio: 'alunos_por_situacao', formato, filtros, total: dados.linhas.length });
  return { dados, emissor, quando, layout: () => montarLayout(inst!, cred ? `Credenciamento ${descreverAto(cred)}` : '', dados, emissor, quando) };
}

rotasRelatorios.get('/alunos-situacao.pdf', async (c) => {
  const r = await preparar(c, 'pdf');
  const layout = r.layout();
  const pdf = await gerarPdfDocumento(layout, await recursosDocumento(c.env, layout));
  return new Response(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="alunos-por-situacao.pdf"', 'Cache-Control': 'private, no-store' },
  });
});

rotasRelatorios.get('/alunos-situacao', async (c) => {
  const r = await preparar(c, 'tela');
  return c.html('<!doctype html>' + (<DocumentoHtml layout={r.layout()} url={urlArquivo} tema={c.get('usuario').tema} />));
});

rotasRelatorios.get('/alunos-situacao.csv', async (c) => {
  const r = await preparar(c, 'csv');
  return new Response(gerarCSVRelatorio(r.dados, r.emissor, r.quando), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="alunos-por-situacao.csv"', 'Cache-Control': 'no-store' },
  });
});

// ------------------------------------------------------------------ Controle de Notas / Controle de Faltas
async function controle(c: any, tipo: TipoControle) {
  const db = c.env.DB as D1Database;
  const f = lerFiltroControle(c.req.query());
  if (!f) return c.redirect('/admin/relatorios?erro=' + encodeURIComponent('Escolha a turma e a disciplina.') + '#controle');
  let dados;
  try {
    dados = await dadosControle(db, f, hojeMS());
  } catch (e) {
    if (e instanceof ErroControle) return c.redirect(`/admin/relatorios?turma=${f.turmaId}&erro=` + encodeURIComponent(e.message) + '#controle');
    throw e;
  }
  const u = c.get('usuario');
  const agora = new Date(Date.now() - 4 * 3600_000).toISOString();
  const quando = `${agora.slice(8, 10)}/${agora.slice(5, 7)}/${agora.slice(0, 4)} ${agora.slice(11, 19)}`;
  const curso = await db.prepare('SELECT cu.* FROM turmas t JOIN cursos cu ON cu.id = t.curso_id WHERE t.id = ?').bind(f.turmaId).first<Record<string, any>>();
  const n = (x: number) => String(x).replace('.', ',');
  const criterios = curso ? `Aprovado com frequência ≥ ${n(curso.frequencia_minima)}% e média ≥ ${n(curso.nota_minima)} (ou média final ≥ ${n(curso.nota_minima_exame)} após exame).` : undefined;
  const [fonteRegular, fonteNegrito, logoR2] = await Promise.all([
    asset(c.env, '/fontes/Arimo-Regular.ttf'), asset(c.env, '/fontes/Arimo-Bold.ttf'), r2(c.env, dados.instituicao.logo_r2_key ?? null),
  ]);
  const pdf = await gerarPdfControle(tipo, dados, { fonteRegular, fonteNegrito, logo: logoR2 ?? (await asset(c.env, '/modelo/logo.png')) }, u.nome || u.email, quando, criterios);
  await auditar(c, 'emitir_relatorio', 'relatorio', null, null, {
    relatorio: tipo === 'notas' ? 'controle_de_notas' : 'controle_de_faltas', formato: 'pdf', filtros: f,
    turma: dados.turma.codigo, disciplinas: dados.disciplinas.map((d) => d.nome),
  });
  const nome = `controle-de-${tipo}-${dados.turma.codigo}.pdf`.replace(/[^\w.-]/g, '_');
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nome}"`, 'Cache-Control': 'private, no-store' } });
}
rotasRelatorios.get('/controle-notas.pdf', (c) => controle(c, 'notas'));
rotasRelatorios.get('/controle-faltas.pdf', (c) => controle(c, 'faltas'));
