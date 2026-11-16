/**
 * Importação de planilhas (fase 6): alunos e notas/frequência.
 * Enviar → conferência (nada gravado) → aplicar. A análise é refeita na aplicação, contra o banco atual.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { pode } from '../auth/permissoes';
import { auditar } from '../lib/auditoria';
import { arquivo, ErroValidacao, lerCorpo, numBR, texto } from '../lib/form';
import { dataBR } from '../lib/datas';
import { formatarCPF } from '../lib/cpf';
import { lerPlanilha } from '../importacao/planilha';
import { aplicarAlunos, analisarAlunos, modeloAlunosCSV, pendenciasAlunosCSV, type AnaliseAlunos, type Modo } from '../importacao/alunos';
import { aplicarNotas, analisarNotas, conferenciaNotasCSV, criteriosDaTurma, modeloNotasCSV, type AnaliseNotas } from '../importacao/notas';

export const rotasImportacao = new Hono<Env>();
rotasImportacao.use('*', exigir('alunos.editar'));

const MAX_MB = 5;
const csv = (conteudo: string, nome: string) =>
  new Response(conteudo, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"`, 'Cache-Control': 'no-store' } });

interface Importacao {
  id: number; tipo: 'alunos' | 'notas'; turma_id: number | null; modulo_id: number | null; modo: Modo | null;
  nome_arquivo: string; arquivo_r2_key: string; status: 'conferencia' | 'aplicada' | 'descartada';
  resumo_json: string | null; criado_por: string; criado_em: string; concluido_por: string | null; concluido_em: string | null;
}

async function alvos(db: D1Database) {
  return (
    await db.prepare(
      `SELECT t.id AS turma_id, mt.id AS modulo_id, t.codigo || ' — Módulo ' || mt.ordem || ': ' || mt.nome AS rotulo
         FROM turmas t JOIN modulos_tematicos mt ON mt.matriz_id = t.matriz_id ORDER BY t.data_inicio DESC, t.codigo, mt.ordem`,
    ).all<{ turma_id: number; modulo_id: number; rotulo: string }>()
  ).results;
}

// ------------------------------ Página inicial ------------------------------
rotasImportacao.get('/', async (c) => {
  const db = c.env.DB;
  const u = c.get('usuario');
  const [turmas, pares, historico] = await Promise.all([
    db.prepare('SELECT id, codigo FROM turmas ORDER BY data_inicio DESC, codigo').all<{ id: number; codigo: string }>(),
    alvos(db),
    db.prepare(`SELECT i.*, t.codigo AS turma FROM importacoes i LEFT JOIN turmas t ON t.id = i.turma_id ORDER BY i.id DESC LIMIT 30`).all<Importacao & { turma: string | null }>(),
  ]);
  const podeNotas = pode(u.perfil, 'resultados.lancar');
  return c.html(
    <Pagina titulo="Importar planilhas" usuario={u} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <h1>Importar planilhas</h1>
      <p class="muted" style="margin-top:-.6rem">
        Aceita <b>.xlsx</b> (Excel) ou <b>.csv</b>. Depois de enviar, você vê um relatório de conferência — nada é gravado até você confirmar.
      </p>
      <div class="modelo-grade" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:1rem">
        <div class="cartao">
          <h2 style="margin-top:0">1. Alunos</h2>
          <p class="muted">Cadastra alunos novos e completa os existentes (identificados pelo CPF). Opcionalmente, matricula todos numa turma.
            Os cabeçalhos podem estar em qualquer ordem (ex.: "Nome", "Data de Nascimento", "Nome da mãe").</p>
          <p><a href="/admin/importacao/modelo-alunos.csv"><Icone nome="baixar" /> Baixar planilha modelo de alunos</a></p>
          <form method="post" action="/admin/importacao/alunos" enctype="multipart/form-data" class="grade">
            <label class="largo">Planilha (.xlsx ou .csv)<input type="file" name="arquivo" accept=".xlsx,.csv,text/csv" required /></label>
            <label class="largo">Matricular na turma (opcional)
              <select name="turma_id"><option value="">Não matricular</option>{turmas.results.map((t) => <option value={t.id}>{t.codigo}</option>)}</select>
            </label>
            <label class="largo">Alunos já cadastrados
              <select name="modo">
                <option value="preencher">Só preencher campos vazios (recomendado)</option>
                <option value="sobrescrever">Substituir pelos dados da planilha</option>
              </select>
            </label>
            <div class="largo"><button>Enviar para conferência</button></div>
          </form>
        </div>
        {podeNotas && (
          <div class="cartao">
            <h2 style="margin-top:0">2. Notas e frequência</h2>
            <p class="muted">Escolha a turma e o módulo, baixe a planilha <b>já preenchida</b> com os alunos e disciplinas, complete no Excel e envie.
              Células vazias não alteram nada. A conferência mostra quem ficará aprovado ou reprovado.</p>
            <label>Turma e módulo
              <select name="alvo" form="form-notas" required onchange="document.getElementById('alvo-modelo').value=this.value">
                {pares.map((p) => <option value={`${p.turma_id}:${p.modulo_id}`}>{p.rotulo}</option>)}</select>
            </label>
            <form method="get" action="/admin/importacao/modelo-notas.csv" class="acoes">
              <input type="hidden" name="alvo" id="alvo-modelo" value={pares[0] ? `${pares[0].turma_id}:${pares[0].modulo_id}` : ''} />
              <button class="sec" disabled={!pares.length}><Icone nome="baixar" />Baixar planilha da turma (já preenchida)</button>
            </form>
            <form method="post" action="/admin/importacao/notas" enctype="multipart/form-data" class="grade" id="form-notas">
              <label class="largo">Planilha (.xlsx ou .csv)<input type="file" name="arquivo" accept=".xlsx,.csv,text/csv" required /></label>
              <div class="largo"><button>Enviar para conferência</button></div>
            </form>
          </div>
        )}
      </div>

      <h2>Importações recentes</h2>
      {historico.results.length > 0 && <table>
        <tr><th>Quando</th><th>Tipo</th><th>Arquivo</th><th>Turma</th><th>Situação</th><th>Por</th><th></th></tr>
        {historico.results.map((i) => (
          <tr>
            <td>{dataBR(i.criado_em)}</td>
            <td>{i.tipo === 'alunos' ? 'Alunos' : 'Notas e frequência'}</td>
            <td>{i.nome_arquivo}</td>
            <td>{i.turma ?? '—'}</td>
            <td><span class={`tag ${i.status === 'aplicada' ? 'ok' : i.status === 'descartada' ? '' : 'aviso'}`}>{i.status === 'conferencia' ? 'aguardando conferência' : i.status}</span></td>
            <td class="muted">{i.criado_por}</td>
            <td><a href={`/admin/importacao/${i.id}`}>abrir</a></td>
          </tr>
        ))}
      </table>}
      {!historico.results.length && <div class="cartao muted" style="text-align:center">Nenhuma importação ainda.</div>}
    </Pagina>,
  );
});

rotasImportacao.get('/modelo-alunos.csv', (c) => csv(modeloAlunosCSV(), 'modelo-alunos.csv'));

rotasImportacao.get('/modelo-notas.csv', exigir('resultados.lancar'), async (c) => {
  const [t, m] = (c.req.query('alvo') ?? '').split(':').map(Number);
  try {
    const conteudo = await modeloNotasCSV(c.env.DB, t, m);
    const turma = await c.env.DB.prepare('SELECT codigo FROM turmas WHERE id = ?').bind(t).first<{ codigo: string }>();
    return csv(conteudo, `notas-${turma?.codigo ?? t}-modulo-${m}.csv`);
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect('/admin/importacao?erro=' + encodeURIComponent(e.message));
    throw e;
  }
});

// ------------------------------ Envio ------------------------------
async function receber(c: any, tipo: 'alunos' | 'notas') {
  const corpo = await lerCorpo(c);
  const arq = arquivo(corpo, 'arquivo');
  if (!arq) throw new ErroValidacao('Selecione a planilha.');
  if (arq.size > MAX_MB * 1024 * 1024) throw new ErroValidacao(`Arquivo maior que ${MAX_MB} MB.`);
  const bytes = new Uint8Array(await arq.arrayBuffer());
  const tabela = lerPlanilha(bytes); // valida o formato já no envio
  let turmaId: number | null = null;
  let moduloId: number | null = null;
  let modo: Modo | null = null;
  if (tipo === 'alunos') {
    turmaId = Number(texto(corpo, 'turma_id')) || null;
    modo = texto(corpo, 'modo') === 'sobrescrever' ? 'sobrescrever' : 'preencher';
    await analisarAlunos(c.env.DB, tabela, { turmaId, modo });
  } else {
    [turmaId, moduloId] = (texto(corpo, 'alvo') ?? '').split(':').map(Number);
    await analisarNotas(c.env.DB, tabela, turmaId, moduloId);
  }
  const ext = bytes[0] === 0x50 && bytes[1] === 0x4b ? 'xlsx' : 'csv';
  const chave = `importacoes/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  await c.env.ARQUIVOS.put(chave, bytes, { httpMetadata: { contentType: ext === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
  const r = await (c.env.DB as D1Database).prepare(
    'INSERT INTO importacoes (tipo, turma_id, modulo_id, modo, nome_arquivo, arquivo_r2_key, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
  ).bind(tipo, turmaId, moduloId, modo, arq.name.slice(0, 200), chave, c.get('usuario').email).first<{ id: number }>();
  await auditar(c, 'importar_enviar', 'importacao', r!.id, null, { tipo, arquivo: arq.name, turma_id: turmaId, modulo_id: moduloId, linhas: tabela.length - 1 });
  return r!.id;
}

for (const tipo of ['alunos', 'notas'] as const) {
  rotasImportacao.post(`/${tipo}`, exigir(tipo === 'notas' ? 'resultados.lancar' : 'alunos.editar'), async (c) => {
    try {
      const id = await receber(c, tipo);
      return c.redirect(`/admin/importacao/${id}`);
    } catch (e) {
      if (e instanceof ErroValidacao) return c.redirect('/admin/importacao?erro=' + encodeURIComponent(e.message));
      throw e;
    }
  });
}

// ------------------------------ Conferência ------------------------------
async function carregar(c: any) {
  return (c.env.DB as D1Database).prepare('SELECT * FROM importacoes WHERE id = ?').bind(Number(c.req.param('id'))).first<Importacao>();
}

async function analisar(c: any, imp: Importacao): Promise<AnaliseAlunos | AnaliseNotas> {
  const obj = await c.env.ARQUIVOS.get(imp.arquivo_r2_key);
  if (!obj) throw new ErroValidacao('Arquivo da importação não encontrado.');
  const tabela = lerPlanilha(new Uint8Array(await obj.arrayBuffer()));
  return imp.tipo === 'alunos'
    ? analisarAlunos(c.env.DB, tabela, { turmaId: imp.turma_id, modo: imp.modo ?? 'preencher' })
    : analisarNotas(c.env.DB, tabela, imp.turma_id!, imp.modulo_id!);
}

const ROTULO_ACAO = { novo: ['novo', 'ok'], atualizar: ['atualizar', 'aviso'], sem_alteracao: ['sem alteração', ''], erro: ['erro', 'erro'] } as const;
const fmt = (n: number | null) => (n == null ? '—' : numBR(n, 2));

function RelatorioAlunos({ a, turma }: { a: AnaliseAlunos; turma: string | null }) {
  return (
    <>
      <div class="kpis" style="margin-bottom:1rem">
        <div class="cartao"><b>{a.totais.novo}</b>alunos novos</div>
        <div class="cartao"><b>{a.totais.atualizar}</b>cadastros a completar/atualizar</div>
        <div class="cartao"><b>{a.totais.sem_alteracao}</b>sem alteração</div>
        <div class="cartao"><b>{a.totais.erro}</b>linhas com erro (serão ignoradas)</div>
        {turma && <div class="cartao"><b>{a.totais.matricular}</b>serão matriculados em {turma}</div>}
        <div class="cartao"><b>{a.totais.com_faltantes}</b>ficarão com campos faltando para o certificado</div>
      </div>
      <p class="muted">
        Colunas reconhecidas: {a.colunas.reconhecidas.map(([h]) => h).join(', ')}.
        {a.colunas.ignoradas.length > 0 && <> <b>Ignoradas:</b> {a.colunas.ignoradas.join(', ')}.</>}
      </p>
      <table>
        <tr><th>Linha</th><th>Aluno</th><th>CPF</th><th>Ação</th><th>Detalhes</th></tr>
        {a.linhas.map((l) => (
          <tr>
            <td class="n">{l.linha}</td>
            <td>{l.nome}{l.matricular && <div class="muted">+ matrícula na turma</div>}</td>
            <td style="white-space:nowrap">{l.cpf?.length === 11 ? formatarCPF(l.cpf) : l.cpf ?? '—'}</td>
            <td><span class={`tag ${ROTULO_ACAO[l.acao][1]}`}>{ROTULO_ACAO[l.acao][0]}</span></td>
            <td>
              {l.erros.map((e) => <div style="color:var(--erro)">{e}</div>)}
              {l.mudancas.length > 0 && <details><summary>{l.mudancas.length} campo(s)</summary>{l.mudancas.map((m) => <div class="muted">{m}</div>)}</details>}
              {l.acao !== 'erro' && l.faltantes.length > 0 && <div style="color:var(--aviso)">Faltam para o certificado: {l.faltantes.join(', ')}</div>}
            </td>
          </tr>
        ))}
      </table>
    </>
  );
}

function RelatorioNotas({ a }: { a: AnaliseNotas }) {
  return (
    <>
      <div class="kpis" style="margin-bottom:1rem">
        <div class="cartao"><b>{a.totais.alunos}</b>alunos na planilha</div>
        <div class="cartao"><b>{a.totais.alteracoes}</b>disciplinas com valores novos</div>
        <div class="cartao"><b>{a.totais.erros}</b>erros (linhas ignoradas)</div>
        <div class="cartao"><b>{a.totais.aprovados}</b>ficarão aprovados no módulo</div>
        <div class="cartao"><b>{a.totais.reprovados}</b>ficarão reprovados</div>
        <div class="cartao"><b>{a.totais.pendentes}</b>com notas incompletas</div>
      </div>
      {a.ausentes.length > 0 && <div class="msg aviso">Matriculados que não aparecem na planilha (nada muda para eles): {a.ausentes.join(', ')}.</div>}
      {a.colunasIgnoradas.length > 0 && <p class="muted">Colunas ignoradas: {a.colunasIgnoradas.join(', ')}.</p>}
      <table>
        <tr><th>Linha</th><th>Aluno</th><th>Alterações</th><th>Situação no módulo após importar</th></tr>
        {a.linhas.map((l) => {
          const av = l.avaliacao;
          const sit = !av ? null : av.aprovado ? ['Aprovado', 'ok'] : av.disciplinas.some((d) => d.resultado === 'RP') ? ['Reprovado', 'erro'] : ['Notas incompletas', 'aviso'];
          return (
            <tr>
              <td class="n">{l.linha}</td>
              <td>{l.aluno}</td>
              <td>
                {l.erros.map((e) => <div style="color:var(--erro)">{e}</div>)}
                {l.alteracoes.map((x) => (
                  <div class="muted">
                    <b>{x.disciplina}</b>: média {fmt(x.antes.nota)} → {fmt(x.depois.nota)}
                    {(x.antes.exame != null || x.depois.exame != null) && <> · exame {fmt(x.antes.exame)} → {fmt(x.depois.exame)}</>}
                    {' '}· freq. {fmt(x.antes.freq)} → {fmt(x.depois.freq)}
                  </div>
                ))}
                {!l.erros.length && !l.alteracoes.length && <span class="muted">sem alterações</span>}
              </td>
              <td>{sit && <span class={`tag ${sit[1]}`}>{sit[0]}</span>}{av && av.motivos.length > 0 && <div class="muted" title={av.motivos.join('\n')}>{av.motivos.slice(0, 2).join(' · ')}{av.motivos.length > 2 ? ' …' : ''}</div>}</td>
            </tr>
          );
        })}
      </table>
    </>
  );
}

rotasImportacao.get('/:id{[0-9]+}', async (c) => {
  const imp = await carregar(c);
  if (!imp) return c.notFound();
  const u = c.get('usuario');
  if (imp.tipo === 'notas' && !pode(u.perfil, 'resultados.lancar')) return c.text('Sem permissão', 403);
  const alvo = imp.turma_id
    ? await c.env.DB.prepare(`SELECT t.codigo, mt.nome AS modulo, mt.ordem FROM turmas t LEFT JOIN modulos_tematicos mt ON mt.id = ? WHERE t.id = ?`)
      .bind(imp.modulo_id, imp.turma_id).first<{ codigo: string; modulo: string | null; ordem: number | null }>()
    : null;
  let analise: AnaliseAlunos | AnaliseNotas | null = null;
  let erro: string | null = null;
  if (imp.status === 'conferencia') {
    try { analise = await analisar(c, imp); } catch (e) { if (e instanceof ErroValidacao) erro = e.message; else throw e; }
  }
  const resumo = imp.resumo_json ? JSON.parse(imp.resumo_json) : null;
  const aplicaveis = analise
    ? imp.tipo === 'alunos'
      ? (analise as AnaliseAlunos).totais.novo + (analise as AnaliseAlunos).totais.atualizar + (analise as AnaliseAlunos).totais.matricular
      : (analise as AnaliseNotas).linhas.filter((l) => !l.erros.length).reduce((s, l) => s + l.alteracoes.length, 0)
    : 0;
  return c.html(
    <Pagina voltar={"/admin/importacao"} titulo="Conferência da importação" usuario={u} caminho="/admin/importacao" ok={c.req.query('ok')} erro={erro}>
      <h1>{imp.tipo === 'alunos' ? 'Importação de alunos' : 'Importação de notas e frequência'}</h1>
      <p class="muted" style="margin-top:-.6rem">
        Arquivo <b>{imp.nome_arquivo}</b> · enviado por {imp.criado_por} em {dataBR(imp.criado_em)}
        {alvo && <> · turma <b>{alvo.codigo}</b>{alvo.modulo && <> · Módulo {alvo.ordem}: {alvo.modulo}</>}</>}
        {imp.modo && <> · {imp.modo === 'preencher' ? 'só preencher campos vazios' : 'substituir dados existentes'}</>}
      </p>
      {imp.status !== 'conferencia' && (
        <div class={`msg ${imp.status === 'aplicada' ? 'ok' : 'aviso'}`}>
          Importação {imp.status} por {imp.concluido_por} em {imp.concluido_em ? dataBR(imp.concluido_em) : ''}.
          {resumo && <div class="muted">{Object.entries(resumo).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</div>}
        </div>
      )}
      {analise && (
        <>
          <div class="acoes">
            <form method="post" action={`/admin/importacao/${imp.id}/aplicar`} onsubmit="return confirm('Aplicar a importação? As linhas com erro serão ignoradas.')">
              <button disabled={!aplicaveis}>Confirmar e aplicar ({aplicaveis} alteração(ões))</button>
            </form>
            <form method="post" action={`/admin/importacao/${imp.id}/descartar`}><button class="sec">Descartar</button></form>
            <a class="botao sec" href={`/admin/importacao/${imp.id}/relatorio.csv`}><Icone nome="baixar" />Baixar relatório de pendências</a>
          </div>
          {imp.tipo === 'alunos'
            ? <RelatorioAlunos a={analise as AnaliseAlunos} turma={alvo?.codigo ?? null} />
            : <RelatorioNotas a={analise as AnaliseNotas} />}
        </>
      )}
    </Pagina>,
  );
});

rotasImportacao.get('/:id{[0-9]+}/relatorio.csv', async (c) => {
  const imp = await carregar(c);
  if (!imp || imp.status !== 'conferencia') return c.notFound();
  const a = await analisar(c, imp);
  return csv(imp.tipo === 'alunos' ? pendenciasAlunosCSV(a as AnaliseAlunos) : conferenciaNotasCSV(a as AnaliseNotas), `conferencia-importacao-${imp.id}.csv`);
});

rotasImportacao.post('/:id{[0-9]+}/aplicar', async (c) => {
  const imp = await carregar(c);
  if (!imp) return c.notFound();
  if (imp.tipo === 'notas' && !pode(c.get('usuario').perfil, 'resultados.lancar')) return c.text('Sem permissão', 403);
  if (imp.status !== 'conferencia') return c.redirect(`/admin/importacao/${imp.id}`);
  const db = c.env.DB;
  let resumo: Record<string, number>;
  let detalhes: unknown;
  try {
    const a = await analisar(c, imp);
    if (imp.tipo === 'alunos') {
      const al = a as AnaliseAlunos;
      await aplicarAlunos(db, al, imp.turma_id);
      resumo = { novos: al.totais.novo, atualizados: al.totais.atualizar, matriculados: al.totais.matricular, ignorados_por_erro: al.totais.erro };
      detalhes = al.linhas.filter((l) => l.acao === 'novo' || l.acao === 'atualizar').map((l) => ({ cpf: l.cpf, acao: l.acao, mudancas: l.mudancas }));
    } else {
      const an = a as AnaliseNotas;
      await aplicarNotas(db, an, await criteriosDaTurma(db, imp.turma_id!));
      const validas = an.linhas.filter((l) => !l.erros.length);
      resumo = { alunos: validas.filter((l) => l.alteracoes.length).length, disciplinas_alteradas: validas.reduce((s, l) => s + l.alteracoes.length, 0), linhas_com_erro: an.linhas.length - validas.length };
      detalhes = validas.filter((l) => l.alteracoes.length).map((l) => ({ matricula_id: l.matriculaId, aluno: l.aluno, alteracoes: l.alteracoes }));
    }
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect(`/admin/importacao/${imp.id}?erro=` + encodeURIComponent(e.message));
    throw e;
  }
  await db.prepare(`UPDATE importacoes SET status = 'aplicada', resumo_json = ?, concluido_por = ?, concluido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .bind(JSON.stringify(resumo), c.get('usuario').email, imp.id).run();
  await auditar(c, 'importar_aplicar', 'importacao', imp.id, null, { tipo: imp.tipo, arquivo: imp.nome_arquivo, resumo, detalhes });
  return c.redirect(`/admin/importacao/${imp.id}?ok=` + encodeURIComponent('Importação aplicada.'));
});

rotasImportacao.post('/:id{[0-9]+}/descartar', async (c) => {
  const imp = await carregar(c);
  if (!imp) return c.notFound();
  if (imp.status === 'conferencia') {
    await c.env.DB.prepare(`UPDATE importacoes SET status = 'descartada', concluido_por = ?, concluido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(c.get('usuario').email, imp.id).run();
    await auditar(c, 'importar_descartar', 'importacao', imp.id, null, { arquivo: imp.nome_arquivo });
  }
  return c.redirect('/admin/importacao?ok=' + encodeURIComponent('Importação descartada.'));
});
