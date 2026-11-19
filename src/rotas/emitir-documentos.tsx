/**
 * Secretaria → Emissão de Documentos (/admin/secretaria/documentos): central com os documentos dos modelos da pasta
 * MODELOS DOCUMENTOS e uma tela por documento — escolher turma/aluno, preencher o que o modelo pede, conferir as
 * pendências e a prévia, e gerar o PDF (formulários) ou emitir e registrar (com código INV e QR code).
 * Catálogo em src/documentos/catalogo.ts; montagem em src/documentos/secretaria.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { lerCorpo } from '../lib/form';
import { urlArquivo } from '../lib/arquivos';
import { qrSvg, urlQrExemplo } from '../lib/qr';
import { mascararCPF } from '../lib/cpf';
import { ROTULO_STATUS } from '../lib/matricula';
import { NaoEncontrado } from '../certificado/dados';
import { dataHoraMS } from '../relatorios/alunosSituacao';
import {
  CATALOGO, ehTipoCatalogo, GRUPOS_DOCUMENTO, hrefEmissao, ITEM_CATALOGO, type TipoCatalogo,
} from '../documentos/catalogo';
import {
  entradaParaQuery, lerEntrada, montarDocumentoSecretaria, proximoNumeroPortaria, SemAluno,
  type DocumentoSecretaria, type EntradaDocumento, type TipoSecretaria,
} from '../documentos/secretaria';
import { DocumentoHtml } from '../documentos/html';
import { gerarPdfDocumento } from '../documentos/pdf';
import { ErroDocumento, recursosDocumento, registrarDocumento } from '../documentos/emissao';

export const rotasEmitirDocumentos = new Hono<Env>();
rotasEmitirDocumentos.use('*', exigir('relatorios.emitir'));

const DO_MODULO = new Set<TipoCatalogo>(['declaracao_conclusao_modulo', 'historico_escolar']);
const ehPortaria = (t: TipoCatalogo) => t.startsWith('portaria_');

const CSS = `
.docs-grupo{margin:1.4rem 0 .6rem;font-size:1rem;color:var(--texto-2);text-transform:uppercase;letter-spacing:.04em}
.docs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(330px,100%),1fr));gap:.9rem}
.doc{display:flex;gap:.8rem;align-items:flex-start;padding:1rem 1.1rem;background:var(--superficie);border:1px solid var(--borda);border-radius:14px;
  box-shadow:var(--sombra);text-decoration:none;color:inherit;transition:border-color .15s,transform .15s}
.doc:hover{border-color:var(--ciano);transform:translateY(-1px)}
.doc .ic{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;flex:none;color:#fff;background:linear-gradient(135deg,var(--marinho),var(--ciano))}
.doc .ic svg{width:21px;height:21px}
.doc b{display:block;font-size:.98rem;margin-bottom:.15rem}
.doc p{margin:0;font-size:.85rem;color:var(--texto-2)}
.doc .tag{margin-top:.45rem;display:inline-block}
.emissao form.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:.7rem 1rem;align-items:end}
.emissao form.grade .largo{grid-column:1/-1}
.emissao .marcas{display:flex;flex-wrap:wrap;gap:.3rem 1.1rem;margin-top:.25rem;font-weight:400}
.emissao .marcas label{flex-direction:row;align-items:center;gap:.35rem;font-weight:400}
.emissao .botoes{grid-column:1/-1;display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem}
`;

// ------------------------------------------------------------------ central

rotasEmitirDocumentos.get('/', (c) =>
  c.html(
    <Pagina titulo="Emissão de Documentos" usuario={c.get('usuario')} caminho={c.req.path}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Emissão de Documentos</h1>
      <p class="muted" style="margin-top:-.6rem">
        Escolha o documento. Os <b>registrados</b> recebem código de validação e QR code; os <b>formulários</b> saem preenchidos com o
        cadastro do aluno para assinatura. Os já emitidos ficam em <a href="/admin/documentos">Documentos Emitidos</a>.
      </p>
      {GRUPOS_DOCUMENTO.map((g) => (
        <>
          <h2 class="docs-grupo">{g}</h2>
          <div class="docs">
            {CATALOGO.filter((i) => i.grupo === g).map((i) => (
              <a class="doc" href={hrefEmissao(i.tipo)}>
                <span class="ic"><Icone nome={i.registrado ? 'certificados' : 'documento'} /></span>
                <span>
                  <b>{i.rotulo}</b>
                  <p>{i.descricao}</p>
                  <span class={`tag ${i.registrado ? 'ok' : ''}`}>{i.registrado ? 'Registrado com QR code' : 'Formulário para assinatura'}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      ))}
    </Pagina>,
  ),
);

// ------------------------------------------------------------------ tela do documento

async function opcoesSelecao(db: D1Database, e: EntradaDocumento) {
  const turmas = (await db.prepare(
    'SELECT t.id, t.codigo, cu.nome AS curso FROM turmas t JOIN cursos cu ON cu.id = t.curso_id ORDER BY t.data_inicio DESC, t.codigo',
  ).all<{ id: number; codigo: string; curso: string }>()).results;
  const nome = `CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END`;
  const alunos = e.turmaId
    ? (await db.prepare(`SELECT a.id, ${nome} AS nome, a.cpf, m.status FROM matriculas m JOIN alunos a ON a.id = m.aluno_id WHERE m.turma_id = ? ORDER BY nome`)
      .bind(e.turmaId).all<{ id: number; nome: string; cpf: string; status: string | null }>()).results
    : (await db.prepare(`SELECT a.id, ${nome} AS nome, a.cpf, NULL AS status FROM alunos a ORDER BY nome LIMIT 3000`)
      .all<{ id: number; nome: string; cpf: string; status: string | null }>()).results;
  return { turmas, alunos };
}

/** Campos próprios de cada documento (as lacunas do modelo). */
function CamposDoTipo({ tipo, e, doc }: { tipo: TipoCatalogo; e: EntradaDocumento; doc: DocumentoSecretaria | null }) {
  const ctx = doc?.ctx;
  const modulos = ctx?.modulos ?? [];
  const selMod = (rotulo: string, dica?: string) => (
    <label>{rotulo}
      <select name="modulo">
        <option value="">{dica ?? 'Selecione'}</option>
        {modulos.map((m) => <option value={m.id} selected={(doc?.refs.moduloId ?? e.moduloId) === m.id}>Módulo {m.ordem}: {m.nome}</option>)}
      </select>
    </label>
  );
  const val = (k: string) => e.campos[k] ?? '';
  const dataForm = (
    <label>Data do requerimento<input type="date" name="data" value={val('data')} />
      <span class="muted">Em branco: sai com lacunas para preencher à mão.</span></label>
  );
  switch (tipo) {
    case 'requerimento_aproveitamento_estudos':
      return (
        <>
          <label class="largo">Estudos concluídos com êxito no(a)
            <input name="origem" value={val('origem')} placeholder="Ex.: Curso Técnico em Administração, Escola Estadual X, em 2023" />
            <span class="muted">Em branco: sai com lacuna para o estudante preencher.</span></label>
          <label>Forma do aproveitamento
            <select name="forma">
              <option value="">Em branco (o estudante marca)</option>
              <option value="analise" selected={val('forma') === 'analise'}>Análise documental</option>
              <option value="avaliacao" selected={val('forma') === 'avaliacao'}>Avaliação</option>
            </select></label>
          {dataForm}
        </>
      );
    case 'requerimento_aproveitamento_conhecimentos':
      return (
        <>
          <label class="largo">Conhecimentos e experiências concluídos com êxito no(a)
            <input name="origem" value={val('origem')} placeholder="Ex.: exercício da função de auxiliar de qualidade na empresa X (2019–2024)" />
            <span class="muted">Em branco: sai com lacuna para o estudante preencher.</span></label>
          {dataForm}
        </>
      );
    case 'requerimento_matricula':
      return (
        <>
          {selMod('Módulo temático da matrícula')}
          <label>E-mail do responsável<input name="resp_email" value={val('resp_email')} placeholder="Só para menor de idade" /></label>
          <label>CPF do responsável<input name="resp_cpf" value={val('resp_cpf')} /></label>
          {dataForm}
        </>
      );
    case 'portaria_aproveitamento_conhecimentos':
    case 'portaria_aproveitamento_modulos':
    case 'portaria_aproveitamento_disciplinas':
      return (
        <>
          <label>Nº da portaria<input name="numero" value={val('numero')} required pattern="\d{1,4}/\d{4}" />
            <span class="muted">Sugerido o próximo do ano; pode alterar. Não pode repetir.</span></label>
          <label>Data da portaria<input type="date" name="data_emissao" value={e.dataEmissao} required /></label>
          {tipo === 'portaria_aproveitamento_conhecimentos' ? (
            <>
              <label class="largo">Conhecimentos e experiências adquiridos no(a)
                <input name="origem" value={val('origem')} placeholder="Ex.: exercício profissional como inspetor de qualidade na empresa X" /></label>
              {selMod('Classificar no módulo (opcional)', 'Só no curso (sem módulo)')}
            </>
          ) : (
            <>
              <label class="largo">{tipo === 'portaria_aproveitamento_modulos' ? 'Módulo(s) aproveitado(s)' : 'Disciplina(s) aproveitada(s)'}
                <span class="marcas">
                  {tipo === 'portaria_aproveitamento_modulos'
                    ? modulos.map((m) => <label><input type="checkbox" name="modulos" value={m.id} checked={e.listas.modulos.includes(String(m.id))} />Módulo {m.ordem}: {m.nome}</label>)
                    : (ctx?.componentes ?? []).filter((x) => x.tipo === 'disciplina').map((x) => (
                      <label><input type="checkbox" name="disciplinas" value={x.id} checked={e.listas.disciplinas.includes(String(x.id))} />{x.nome}</label>
                    ))}
                </span></label>
              <label>Concluído(s) com êxito no curso<input name="origem_curso" value={val('origem_curso')} placeholder="Ex.: Curso Técnico em Administração" /></label>
              <label>Instituição de ensino de origem<input name="origem_instituicao" value={val('origem_instituicao')} /></label>
              {selMod('Classificar no módulo')}
            </>
          )}
        </>
      );
    case 'guia_transferencia':
      return (
        <>
          {selMod('Módulo que estava cursando', 'Automático (módulo em andamento)')}
          <label>Data de emissão<input type="date" name="data_emissao" value={e.dataEmissao} required /></label>
          <label class="largo">Observações (verso)<textarea name="obs" rows={2} placeholder="Em branco: usa o motivo informado no status Transferido">{val('obs')}</textarea></label>
        </>
      );
    case 'historico_curso_tecnico':
      return (
        <>
          <label>Data de conclusão do curso<input type="date" name="data_conclusao" value={val('data_conclusao')} />
            <span class="muted">Em branco: data de conclusão da matrícula ou término do último módulo.</span></label>
          <label>Data de emissão<input type="date" name="data_emissao" value={e.dataEmissao} required /></label>
        </>
      );
    default:
      return null;
  }
}

async function montar(c: any, tipo: TipoSecretaria, e: EntradaDocumento, emissao: { codigo: string | null; url: string | null } = { codigo: null, url: null }) {
  const u = c.get('usuario');
  return montarDocumentoSecretaria(c.env.DB, tipo, e, { ...emissao, usuario: u.nome || u.email, quando: dataHoraMS() });
}

async function tela(c: any, tipo: TipoCatalogo, e: EntradaDocumento, erros?: string[]) {
  const db = c.env.DB as D1Database;
  const item = ITEM_CATALOGO[tipo];
  const base = hrefEmissao(tipo);
  if (ehPortaria(tipo) && !e.campos.numero) e.campos.numero = await proximoNumeroPortaria(db, Number(e.dataEmissao.slice(0, 4)));
  const { turmas, alunos } = await opcoesSelecao(db, e);
  let doc: DocumentoSecretaria | null = null;
  let semAluno = false;
  if (!DO_MODULO.has(tipo)) {
    try {
      doc = await montar(c, tipo as TipoSecretaria, e);
    } catch (err) {
      if (err instanceof SemAluno) semAluno = true;
      else if (err instanceof NaoEncontrado) semAluno = true;
      else throw err;
    }
  }
  const bloqueios = erros ?? doc?.faltantes ?? [];
  const query = entradaParaQuery(e);
  const precisaTurma = item.contexto !== 'aluno';
  const turmasDoAluno = doc?.ctx.matriculas ?? [];
  return (
    <Pagina titulo={item.rotulo} usuario={c.get('usuario')} caminho={base} voltar="/admin/secretaria/documentos">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div class="emissao">
        <h1>{item.rotulo}</h1>
        <p class="muted" style="margin-top:-.6rem">{item.descricao} <span class="tag">{item.registrado ? 'Registrado com QR code' : 'Formulário para assinatura'}</span></p>
        <div class="cartao">
          <form method="get" action={base} class="grade" id="form-doc">
            <label>Turma{precisaTurma ? '' : ' (opcional)'}
              <select name="turma" onchange="this.form.aluno&&(this.form.aluno.value='');this.form.submit()">
                <option value="">{precisaTurma ? 'Selecione a turma' : 'Todos os alunos'}</option>
                {turmas.map((t) => <option value={t.id} selected={t.id === e.turmaId}>{t.codigo} — {t.curso}</option>)}
              </select>
            </label>
            <label>Aluno
              <select name="aluno" onchange={DO_MODULO.has(tipo) ? undefined : 'this.form.submit()'} disabled={precisaTurma && !e.turmaId}>
                <option value="">{precisaTurma && !e.turmaId ? 'Escolha a turma primeiro' : 'Selecione o aluno'}</option>
                {alunos.map((a) => (
                  <option value={a.id} selected={a.id === e.alunoId}>
                    {a.nome} — CPF {mascararCPF(a.cpf ?? '')}{a.status && a.status !== 'ativa' ? ` (${ROTULO_STATUS[a.status] ?? a.status})` : ''}
                  </option>
                ))}
              </select>
            </label>
            {!precisaTurma && turmasDoAluno.length > 1 && !e.turmaId && (
              <p class="muted largo" style="margin:0">O aluno tem {turmasDoAluno.length} matrículas; o curso considerado é o da mais recente. Escolha a turma para usar outra.</p>
            )}
            {DO_MODULO.has(tipo) ? (
              <SelecaoModulo db={db} turmaId={e.turmaId} moduloId={e.moduloId} />
            ) : (
              !semAluno && <CamposDoTipo tipo={tipo} e={e} doc={doc} />
            )}
            <div class="botoes">
              {DO_MODULO.has(tipo) ? (
                <button name="abrir" value="1" disabled={!e.turmaId}><Icone nome="documento" />Abrir prévia e emissão</button>
              ) : (
                <>
                  <button class="sec" disabled={semAluno}><Icone nome="atualizar" />Atualizar prévia</button>
                  {item.registrado ? (
                    <>
                      <button class="sec" disabled={semAluno} formaction={`${base}/previa.pdf`} formtarget="_blank"><Icone nome="certificados" />PDF de prévia</button>
                      <button disabled={semAluno || bloqueios.length > 0} formmethod="post" formaction={base}
                        onclick={`return confirm('Emitir e registrar ${item.feminino ? 'a' : 'o'} ${item.rotulo.toLowerCase()}? ${item.feminino ? 'Ela recebe' : 'Ele recebe'} código de validação e não pode ser alterad${item.feminino ? 'a' : 'o'}.')`}>
                        <Icone nome="salvar" />Emitir e registrar
                      </button>
                    </>
                  ) : (
                    <button disabled={semAluno} formaction={`${base}/previa.pdf`} formtarget="_blank"><Icone nome="certificados" />Gerar PDF para impressão</button>
                  )}
                </>
              )}
            </div>
          </form>
          {semAluno && !DO_MODULO.has(tipo) && <p class="muted" style="margin:.8rem 0 0">Selecione {precisaTurma ? 'a turma e ' : ''}o aluno para ver o documento.</p>}
          {doc && (bloqueios.length > 0
            ? <div class={`msg ${item.registrado ? 'erro' : 'aviso'}`} style="margin:.9rem 0 0"><b>{item.registrado ? 'A emissão está bloqueada:' : 'Confira antes de imprimir:'}</b><ul>{bloqueios.map((m) => <li>{m}</li>)}</ul></div>
            : <div class="msg ok" style="margin:.9rem 0 0">{item.registrado ? 'Dados completos — pronto para emitir.' : 'Formulário pronto para imprimir.'}</div>)}
          {doc && doc.avisos.length > 0 && <div class="msg aviso" style="margin:.8rem 0 0"><ul style="margin:0 0 0 1.1rem">{doc.avisos.map((m) => <li>{m}</li>)}</ul></div>}
        </div>
        {doc && (
          <>
            <h2>Como vai ficar</h2>
            <p class="muted">Prévia com os dados atuais{item.registrado ? ' e um QR code de exemplo; o código de validação definitivo é gerado na emissão' : ''}. Depois de alterar os campos, clique em <b>Atualizar prévia</b>.</p>
            <iframe src={`${base}/previa?${query}`} title="Prévia" style="width:100%;height:1300px;border:1px solid var(--borda);border-radius:12px;background:var(--superficie-2)" />
          </>
        )}
      </div>
    </Pagina>
  );
}

/** Declaração e histórico por módulo: só escolhe o módulo e abre a tela de emissão já existente. */
async function SelecaoModulo({ db, turmaId, moduloId }: { db: D1Database; turmaId: number | null; moduloId: number | null }) {
  const mods = turmaId ? (await db.prepare(
    `SELECT mt.id, mt.ordem, mt.nome, coalesce(tm.situacao, 'planejado') AS situacao FROM turmas t JOIN modulos_tematicos mt ON mt.matriz_id = t.matriz_id
       LEFT JOIN turma_modulos tm ON tm.turma_id = t.id AND tm.modulo_id = mt.id WHERE t.id = ? ORDER BY mt.ordem`,
  ).bind(turmaId).all<{ id: number; ordem: number; nome: string; situacao: string }>()).results : [];
  const padrao = moduloId ?? mods.filter((m) => m.situacao === 'concluido').at(-1)?.id;
  return (
    <label>Módulo
      <select name="modulo" disabled={!turmaId}>
        {mods.map((m) => <option value={m.id} selected={m.id === padrao}>Módulo {m.ordem}: {m.nome}{m.situacao === 'concluido' ? ' (concluído)' : m.situacao === 'em_andamento' ? ' (em andamento)' : ''}</option>)}
      </select>
    </label>
  );
}

rotasEmitirDocumentos.get('/:tipo', async (c) => {
  const tipo = c.req.param('tipo');
  if (!ehTipoCatalogo(tipo)) return c.notFound();
  const e = entradaDaQuery(c);
  if (DO_MODULO.has(tipo) && e.turmaId && e.alunoId && e.moduloId && c.req.query('abrir')) {
    const m = await c.env.DB.prepare('SELECT id FROM matriculas WHERE turma_id = ? AND aluno_id = ?').bind(e.turmaId, e.alunoId).first<{ id: number }>();
    if (m) return c.redirect(`/admin/documentos/${tipo}/${m.id}/${e.moduloId}`);
  }
  return c.html(await tela(c, tipo, e));
});

function entradaDaQuery(c: any): EntradaDocumento {
  return lerEntrada(Object.fromEntries([...new URL(c.req.url).searchParams.keys()].map((k) => [k, c.req.queries(k) ?? []])));
}

rotasEmitirDocumentos.get('/:tipo/previa', async (c) => {
  const tipo = c.req.param('tipo');
  if (!ehTipoCatalogo(tipo) || DO_MODULO.has(tipo)) return c.notFound();
  try {
    const d = await montar(c, tipo as TipoSecretaria, entradaDaQuery(c));
    const registrado = ITEM_CATALOGO[tipo].registrado;
    return c.html('<!doctype html>' + (
      <DocumentoHtml layout={d.layout} url={urlArquivo} previa={registrado} tema={c.get('usuario').tema} qrSvg={registrado ? qrSvg(urlQrExemplo(c.env.URL_PUBLICA)) : undefined} />
    ));
  } catch (err) {
    if (err instanceof SemAluno || err instanceof NaoEncontrado) return c.text((err as Error).message, 404);
    throw err;
  }
});

rotasEmitirDocumentos.get('/:tipo/previa.pdf', async (c) => {
  const tipo = c.req.param('tipo');
  if (!ehTipoCatalogo(tipo) || DO_MODULO.has(tipo)) return c.notFound();
  const e = entradaDaQuery(c);
  try {
    const d = await montar(c, tipo as TipoSecretaria, e);
    const registrado = ITEM_CATALOGO[tipo].registrado;
    const pdf = await gerarPdfDocumento(d.layout, await recursosDocumento(c.env, d.layout), registrado ? { previa: true, qrExemplo: urlQrExemplo(c.env.URL_PUBLICA) } : {});
    await auditar(c, registrado ? 'visualizar_previa_documento' : 'gerar_formulario', 'aluno', d.ctx.aluno.id, null, {
      tipo, matricula_id: d.ctx.matricula?.id ?? null, campos: e.campos, ...(e.listas.modulos.length ? { modulos: e.listas.modulos } : {}),
      ...(e.listas.disciplinas.length ? { disciplinas: e.listas.disciplinas } : {}),
    });
    const nome = `${registrado ? 'previa-' : ''}${tipo}-${d.ctx.aluno.id}.pdf`;
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nome}"`, 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof SemAluno || err instanceof NaoEncontrado) return c.text((err as Error).message, 404);
    throw err;
  }
});

rotasEmitirDocumentos.post('/:tipo', async (c) => {
  const tipo = c.req.param('tipo');
  if (!ehTipoCatalogo(tipo) || DO_MODULO.has(tipo) || !ITEM_CATALOGO[tipo].registrado) return c.notFound();
  const e = lerEntrada(await lerCorpo(c));
  let base: DocumentoSecretaria;
  try {
    base = await montar(c, tipo as TipoSecretaria, e);
  } catch (err) {
    if (err instanceof SemAluno || err instanceof NaoEncontrado) return c.html(await tela(c, tipo, e, [(err as Error).message]), 400);
    throw err;
  }
  try {
    const r = await registrarDocumento(
      c.env, c.get('usuario').email,
      {
        tipo: tipo as any, alunoId: base.ctx.aluno.id, matriculaId: base.ctx.matricula?.id ?? null, cursoId: base.ctx.curso.id,
        moduloId: base.refs.moduloId, numero: base.refs.numero,
      },
      e.dataEmissao,
      async (em) => {
        const p = await montar(c, tipo as TipoSecretaria, e, { codigo: em.codigo, url: em.url });
        return { layout: p.layout, resumo: p.resumo!, faltantes: p.faltantes };
      },
    );
    await auditar(c, 'emitir', 'documento', r.id, null, { tipo, codigo: r.codigo, aluno: r.snapshot.resumo.aluno, numero: base.refs.numero, itens: r.snapshot.resumo.itens });
    const item = ITEM_CATALOGO[tipo];
    return c.redirect(`/admin/documentos/${r.id}?ok=` + encodeURIComponent(`${item.rotulo} ${r.codigo} ${item.feminino ? 'emitida' : 'emitido'}.`));
  } catch (err) {
    if (err instanceof ErroDocumento) {
      await auditar(c, 'emissao_bloqueada', 'aluno', base.ctx.aluno.id, null, { tipo, motivos: err.motivos });
      return c.html(await tela(c, tipo, e, err.motivos), 400);
    }
    throw err;
  }
});
