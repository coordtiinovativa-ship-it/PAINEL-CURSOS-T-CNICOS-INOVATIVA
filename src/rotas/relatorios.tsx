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
import { consultar, dataHoraMS, gerarCSVRelatorio, lerFiltros, montarLayout, SITUACOES_MATRICULA, type Filtros } from '../relatorios/alunosSituacao';

export const rotasRelatorios = new Hono<Env>();
rotasRelatorios.use('*', exigir('relatorios.emitir'));

const CSS = `
.relatorios{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:1rem}
.relatorio{background:var(--superficie);border:1px solid var(--borda);border-radius:14px;box-shadow:var(--sombra);overflow:hidden}
.relatorio .cab{display:flex;gap:.8rem;align-items:flex-start;padding:1rem 1.2rem;border-bottom:1px solid var(--borda);background:var(--superficie-2)}
.relatorio .cab .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;flex:none;color:#fff;background:linear-gradient(135deg,var(--marinho),var(--ciano))}
.relatorio .cab .ic svg{width:22px;height:22px}
.relatorio .cab h2{margin:0;font-size:1.05rem}
.relatorio .cab p{margin:.2rem 0 0;font-size:.85rem;color:var(--texto-2)}
.relatorio form{padding:1rem 1.2rem 1.2rem;display:grid;grid-template-columns:1fr 1fr;gap:.7rem 1rem}
.relatorio form .largo{grid-column:1/-1}
.relatorio .botoes{grid-column:1/-1;display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.3rem}
@media (max-width:600px){.relatorios{grid-template-columns:1fr} .relatorio form{grid-template-columns:1fr}}
`;

rotasRelatorios.get('/', async (c) => {
  const db = c.env.DB;
  const [cursos, turmas] = await Promise.all([
    db.prepare('SELECT id, nome FROM cursos ORDER BY ativo DESC, nome').all<{ id: number; nome: string }>(),
    db.prepare('SELECT t.id, t.codigo, cu.nome AS curso FROM turmas t JOIN cursos cu ON cu.id = t.curso_id ORDER BY t.data_inicio DESC, t.codigo').all<{ id: number; codigo: string; curso: string }>(),
  ]);
  const turmaSel = Number(c.req.query('turma')) || null;
  return c.html(
    <Pagina titulo="Relatórios" usuario={c.get('usuario')} caminho={c.req.path}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Relatórios</h1>
      <p class="muted" style="margin-top:-.6rem">Escolha os filtros e emita. Todo relatório registra quem emitiu, com data e hora, e fica na auditoria.</p>
      <div class="relatorios">
        <section class="relatorio">
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
