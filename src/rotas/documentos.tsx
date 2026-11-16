import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { lerCorpo, texto } from '../lib/form';
import { urlArquivo } from '../lib/arquivos';
import { qrSvg, urlQrExemplo } from '../lib/qr';
import { dataBR } from '../lib/datas';
import { mascararCPF } from '../lib/cpf';
import { hojeMS, NaoEncontrado } from '../certificado/dados';
import { prepararDocumento, ROTULO_DOCUMENTO, TIPOS_DOCUMENTO, type TipoDocumento } from '../documentos/montar';
import { DocumentoHtml } from '../documentos/html';
import { gerarPdfDocumento } from '../documentos/pdf';
import { emitirDocumento, ErroDocumento, recursosDocumento, type SnapshotDocumento } from '../documentos/emissao';

export const rotasDocumentos = new Hono<Env>();
rotasDocumentos.use('*', exigir('relatorios.emitir'));

const tipoValido = (t: string): t is TipoDocumento => (TIPOS_DOCUMENTO as string[]).includes(t);
const pdfResposta = (pdf: Uint8Array, nome: string, disp = 'inline') =>
  new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disp}; filename="${nome}.pdf"`, 'Cache-Control': 'private, no-store' } });

// ------------------------------ Lista ------------------------------
rotasDocumentos.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const lista = (
    await c.env.DB.prepare(
      `SELECT d.id, d.tipo, d.codigo_validacao, d.data_emissao, d.status, d.emitido_por, t.codigo AS turma, mt.nome AS modulo,
              CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END AS aluno
         FROM documentos d JOIN matriculas m ON m.id = d.matricula_id JOIN alunos a ON a.id = m.aluno_id
         JOIN turmas t ON t.id = m.turma_id LEFT JOIN modulos_tematicos mt ON mt.id = d.modulo_id
        WHERE ? = '' OR d.codigo_validacao LIKE ? OR a.nome_civil LIKE ? OR a.nome_social LIKE ? OR t.codigo LIKE ?
        ORDER BY d.id DESC LIMIT 300`,
    ).bind(q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`).all<Record<string, any>>()
  ).results;
  return c.html(
    <Pagina titulo="Declarações e históricos" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Declarações e históricos emitidos</h1>
      <p class="muted" style="margin-top:-.6rem">Para emitir, abra a turma → módulo e use os links "declaração" e "histórico" de cada aluno.</p>
      <form method="get" class="acoes"><input name="q" value={q} placeholder="Código, aluno ou turma" /><button class="sec">Buscar</button></form>
      <table>
        <tr><th>Código</th><th>Documento</th><th>Aluno</th><th>Turma / módulo</th><th>Emissão</th><th>Situação</th><th></th></tr>
        {lista.map((d) => (
          <tr>
            <td><a href={`/admin/documentos/${d.id}`}><code>{d.codigo_validacao}</code></a></td>
            <td>{ROTULO_DOCUMENTO[d.tipo as TipoDocumento]}</td>
            <td>{d.aluno}</td>
            <td>{d.turma}<div class="muted">{d.modulo}</div></td>
            <td>{dataBR(d.data_emissao)}<div class="muted">{d.emitido_por}</div></td>
            <td><span class={`tag ${d.status === 'válido' ? 'ok' : 'erro'}`}>{d.status}</span></td>
            <td><a href={`/admin/documentos/${d.id}/pdf`} target="_blank">PDF</a></td>
          </tr>
        ))}
      </table>
      {!lista.length && <p class="muted">Nenhum documento emitido ainda.</p>}
    </Pagina>,
  );
});

// --------------------------- Prévia e emissão ---------------------------
function parametros(c: any) {
  const tipo = c.req.param('tipo');
  return { tipo, mat: Number(c.req.param('mat')), mod: Number(c.req.param('mod')) };
}

async function tela(c: any, tipo: TipoDocumento, mat: number, mod: number, erros?: string[], dataEmissao = hojeMS()) {
  const p = await prepararDocumento(c.env.DB, tipo, mat, mod, { dataEmissao, codigo: null, url: null });
  const bloqueios = erros ?? p.faltantes;
  const anteriores = (
    await (c.env.DB as D1Database).prepare(
      'SELECT id, codigo_validacao, data_emissao, status FROM documentos WHERE tipo = ? AND matricula_id = ? AND modulo_id = ? ORDER BY id DESC',
    ).bind(tipo, mat, mod).all<{ id: number; codigo_validacao: string; data_emissao: string; status: string }>()
  ).results;
  const base = `/admin/documentos/${tipo}/${mat}/${mod}`;
  const outro: TipoDocumento = tipo === 'historico_escolar' ? 'declaracao_conclusao_modulo' : 'historico_escolar';
  return (
    <Pagina voltar={`/admin/turmas/${p.dados.turma.turma_id}/modulos/${mod}`} titulo={ROTULO_DOCUMENTO[tipo]} usuario={c.get('usuario')} caminho="/admin/documentos">
      <h1>{ROTULO_DOCUMENTO[tipo]}</h1>
      <div class="cartao">
        <p style="margin-top:0"><b>{p.dados.nomeExibido}</b> · CPF {mascararCPF(p.dados.aluno.cpf ?? '')} ·
          Módulo {p.dados.modulo.ordem}: {p.dados.modulo.nome} ({p.dados.modulo.qualificacao_conferida})</p>
        {bloqueios.length > 0
          ? <div class="msg erro" style="margin-bottom:0"><b>A emissão está bloqueada:</b><ul>{bloqueios.map((m) => <li>{m}</li>)}</ul></div>
          : <div class="msg ok" style="margin-bottom:0">Dados completos — pronto para emitir.</div>}
        {p.avisos.length > 0 && <div class="msg aviso" style="margin:.8rem 0 0"><ul style="margin:0 0 0 1.1rem">{p.avisos.map((m) => <li>{m}</li>)}</ul></div>}
        <form method="post" class="acoes" style="margin-top:1rem" onsubmit="return confirm('Emitir o documento? Ele recebe código de validação e não pode ser alterado.')">
          <Campo nome="data_emissao" rotulo="Data de emissão" tipo="date" valor={dataEmissao} obrigatorio />
          <button disabled={p.faltantes.length > 0} style="align-self:flex-end">Emitir documento</button>
          <a class="botao sec" style="align-self:flex-end" href={`${base}/previa`} target="_blank"><Icone nome="documento" />Ver em tela</a>
          <a class="botao sec" style="align-self:flex-end" href={`${base}/previa.pdf`} target="_blank"><Icone nome="certificados" />PDF de prévia</a>
          <a style="align-self:flex-end" href={`/admin/documentos/${outro}/${mat}/${mod}`}>{ROTULO_DOCUMENTO[outro]} →</a>
        </form>
        {anteriores.length > 0 && (
          <p class="muted" style="margin-bottom:0">
            Já emitidos: {anteriores.map((d, i) => <>{i ? ' · ' : ''}<a href={`/admin/documentos/${d.id}`}>{d.codigo_validacao}</a> ({dataBR(d.data_emissao)}{d.status !== 'válido' ? `, ${d.status}` : ''})</>)}
          </p>
        )}
      </div>
      <h2>Como vai ficar</h2>
      <p class="muted">Exemplo do documento com os dados atuais. O QR code mostrado é de exemplo: o código de validação e o QR code definitivo são gerados na emissão.</p>
      <iframe src={`${base}/previa`} title="Prévia" style="width:100%;height:1300px;border:1px solid var(--borda);border-radius:12px;background:var(--superficie-2)" />
    </Pagina>
  );
}

rotasDocumentos.get('/:tipo/:mat{[0-9]+}/:mod{[0-9]+}', async (c) => {
  const { tipo, mat, mod } = parametros(c);
  if (!tipoValido(tipo)) return c.notFound();
  try {
    return c.html(await tela(c, tipo, mat, mod));
  } catch (e) {
    if (e instanceof NaoEncontrado) return c.notFound();
    throw e;
  }
});

rotasDocumentos.get('/:tipo/:mat{[0-9]+}/:mod{[0-9]+}/previa', async (c) => {
  const { tipo, mat, mod } = parametros(c);
  if (!tipoValido(tipo)) return c.notFound();
  try {
    const p = await prepararDocumento(c.env.DB, tipo, mat, mod, { codigo: null, url: null });
    return c.html('<!doctype html>' + (<DocumentoHtml layout={p.layout} url={urlArquivo} previa tema={c.get('usuario').tema} qrSvg={qrSvg(urlQrExemplo(c.env.URL_PUBLICA))} />));
  } catch (e) {
    if (e instanceof NaoEncontrado) return c.notFound();
    throw e;
  }
});

rotasDocumentos.get('/:tipo/:mat{[0-9]+}/:mod{[0-9]+}/previa.pdf', async (c) => {
  const { tipo, mat, mod } = parametros(c);
  if (!tipoValido(tipo)) return c.notFound();
  try {
    const p = await prepararDocumento(c.env.DB, tipo, mat, mod, { codigo: null, url: null });
    const pdf = await gerarPdfDocumento(p.layout, await recursosDocumento(c.env, p.layout), { previa: true, qrExemplo: urlQrExemplo(c.env.URL_PUBLICA) });
    await auditar(c, 'visualizar_previa_documento', 'matricula', mat, null, { tipo, modulo_id: mod });
    return pdfResposta(pdf, `previa-${tipo}-${mat}-${mod}`);
  } catch (e) {
    if (e instanceof NaoEncontrado) return c.notFound();
    throw e;
  }
});

rotasDocumentos.post('/:tipo/:mat{[0-9]+}/:mod{[0-9]+}', async (c) => {
  const { tipo, mat, mod } = parametros(c);
  if (!tipoValido(tipo)) return c.notFound();
  const dataEmissao = texto(await lerCorpo(c), 'data_emissao') ?? '';
  try {
    const r = await emitirDocumento(c.env, c.get('usuario').email, tipo, mat, mod, dataEmissao);
    await auditar(c, 'emitir', 'documento', r.id, null, { tipo, codigo: r.codigo, aluno: r.snapshot.resumo.aluno, modulo: r.snapshot.resumo.modulo.nome });
    const msg = `${ROTULO_DOCUMENTO[tipo]} ${r.codigo} ${tipo === 'historico_escolar' ? 'emitido' : 'emitida'}.`;
    return c.redirect(`/admin/documentos/${r.id}?ok=` + encodeURIComponent(msg));
  } catch (e) {
    if (e instanceof ErroDocumento) {
      await auditar(c, 'emissao_bloqueada', 'matricula', mat, null, { tipo, modulo_id: mod, motivos: e.motivos });
      return c.html(await tela(c, tipo, mat, mod, e.motivos, dataEmissao || hojeMS()), 400);
    }
    if (e instanceof NaoEncontrado) return c.notFound();
    throw e;
  }
});

// ------------------------------ Consulta ------------------------------
async function carregar(c: any) {
  return (c.env.DB as D1Database).prepare('SELECT * FROM documentos WHERE id = ?').bind(Number(c.req.param('id'))).first<Record<string, any>>();
}

rotasDocumentos.get('/:id{[0-9]+}', async (c) => {
  const d = await carregar(c);
  if (!d) return c.notFound();
  const s = JSON.parse(d.snapshot_json) as SnapshotDocumento;
  return c.html(
    <Pagina voltar={"/admin/documentos"} titulo={d.codigo_validacao} usuario={c.get('usuario')} caminho="/admin/documentos" ok={c.req.query('ok')}>
      <h1>{ROTULO_DOCUMENTO[d.tipo as TipoDocumento]} {d.codigo_validacao} <span class={`tag ${d.status === 'válido' ? 'ok' : 'erro'}`}>{d.status}</span></h1>
      <div class="acoes">
        <a class="botao" href={`/admin/documentos/${d.id}/pdf`} target="_blank">Abrir PDF</a>
        <a class="botao sec" href={`/admin/documentos/${d.id}/pdf?baixar=1`}>Baixar PDF</a>
      </div>
      <table style="max-width:900px">
        <tr><th>Estudante</th><td>{s.resumo.aluno} · CPF {mascararCPF(s.resumo.cpf)}</td></tr>
        <tr><th>Curso</th><td>{s.resumo.curso}</td></tr>
        <tr><th>Módulo</th><td>Módulo {s.resumo.modulo.ordem}: {s.resumo.modulo.nome} — {s.resumo.modulo.qualificacao} ({s.resumo.modulo.cargaHoraria} h)</td></tr>
        <tr><th>Situação no módulo</th><td>{s.resumo.situacaoModulo}</td></tr>
        <tr><th>Emissão</th><td>{dataBR(d.data_emissao)} · por {d.emitido_por}</td></tr>
        <tr><th>Validação</th><td><code>{s.layout.validacao.url}</code></td></tr>
        <tr><th>Hash SHA-256 dos dados</th><td><code style="word-break:break-all">{d.hash_sha256}</code></td></tr>
      </table>
    </Pagina>,
  );
});

rotasDocumentos.get('/:id{[0-9]+}/pdf', async (c) => {
  const d = await carregar(c);
  if (!d) return c.notFound();
  const obj = await c.env.ARQUIVOS.get(d.pdf_r2_key);
  if (!obj) return c.notFound();
  await auditar(c, 'baixar_pdf', 'documento', d.id, null, { codigo: d.codigo_validacao });
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${c.req.query('baixar') ? 'attachment' : 'inline'}; filename="${d.codigo_validacao}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
