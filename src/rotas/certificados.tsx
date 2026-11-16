import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { pode } from '../auth/permissoes';
import { auditar } from '../lib/auditoria';
import { lerCorpo, texto, type Corpo } from '../lib/form';
import { dataBR } from '../lib/datas';
import { mascararCPF } from '../lib/cpf';
import { hojeMS, montarDadosCertificado, NaoEncontrado } from '../certificado/dados';
import { emitirCertificado, ErroEmissao, sugerirRegistro, type EntradaEmissao } from '../certificado/emissao';
import type { SnapshotCertificado } from '../certificado/snapshot';

export const rotasCertificados = new Hono<Env>();
rotasCertificados.use('*', exigir('relatorios.emitir'));

const ROTULO_STATUS: Record<string, string> = { válido: 'ok', revogado: 'erro', substituído: 'aviso' };

rotasCertificados.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const lista = (
    await c.env.DB.prepare(
      `SELECT ce.id, ce.codigo_validacao, ce.data_emissao, ce.registro_numero, ce.folha, ce.livro, ce.status,
              CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END AS aluno, t.codigo AS turma, mt.nome AS modulo
         FROM certificados ce JOIN matriculas m ON m.id = ce.matricula_id JOIN alunos a ON a.id = m.aluno_id
         JOIN turmas t ON t.id = m.turma_id LEFT JOIN modulos_tematicos mt ON mt.id = ce.modulo_id
        WHERE ? = '' OR ce.codigo_validacao LIKE ? OR a.nome_civil LIKE ? OR a.nome_social LIKE ? OR t.codigo LIKE ?
        ORDER BY ce.id DESC LIMIT 300`,
    ).bind(q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`).all<Record<string, any>>()
  ).results;
  return c.html(
    <Pagina titulo="Certificados" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Certificados emitidos</h1>
      <form method="get" class="acoes">
        <input name="q" value={q} placeholder="Código, aluno ou turma" />
        <button class="sec">Buscar</button>
      </form>
      <table>
        <tr><th>Código</th><th>Aluno</th><th>Turma / módulo</th><th>Emissão</th><th>Registro</th><th>Situação</th><th></th></tr>
        {lista.map((ce) => (
          <tr>
            <td><a href={`/admin/certificados/${ce.id}`}><code>{ce.codigo_validacao}</code></a></td>
            <td>{ce.aluno}</td>
            <td>{ce.turma}<div class="muted">{ce.modulo}</div></td>
            <td>{dataBR(ce.data_emissao)}</td>
            <td>nº {ce.registro_numero} · fl. {ce.folha} · liv. {ce.livro}</td>
            <td><span class={`tag ${ROTULO_STATUS[ce.status]}`}>{ce.status}</span></td>
            <td><a href={`/admin/certificados/${ce.id}/pdf`} target="_blank">PDF</a></td>
          </tr>
        ))}
      </table>
      {!lista.length && <p class="muted">Nenhum certificado emitido ainda. A emissão é feita na tela de resultados do módulo de cada turma.</p>}
    </Pagina>,
  );
});

// ------------------------------- Emissão -------------------------------
function lerEntrada(corpo: Corpo, mat: number, mod: number): EntradaEmissao {
  return {
    matriculaId: mat,
    moduloId: mod,
    dataEmissao: texto(corpo, 'data_emissao') ?? '',
    registroNumero: texto(corpo, 'registro_numero'),
    folha: texto(corpo, 'folha'),
    livro: texto(corpo, 'livro'),
    dataRegistro: texto(corpo, 'data_registro'),
    sistecCodigo: texto(corpo, 'sistec_codigo'),
    sistecData: texto(corpo, 'sistec_data'),
  };
}

async function telaEmissao(c: any, mat: number, mod: number, entrada?: EntradaEmissao, erros?: string[]) {
  const db = c.env.DB as D1Database;
  const d = await montarDadosCertificado(db, mat, mod);
  const sug = await sugerirRegistro(db);
  const e: EntradaEmissao = entrada ?? {
    matriculaId: mat, moduloId: mod, dataEmissao: hojeMS(), registroNumero: sug.registroNumero, folha: sug.folha,
    livro: sug.livro, dataRegistro: hojeMS(), sistecCodigo: null, sistecData: null,
  };
  const bloqueios = erros ?? d.faltantes;
  const existente = await db.prepare(`SELECT id, codigo_validacao FROM certificados WHERE matricula_id = ? AND modulo_id = ? AND status = 'válido'`)
    .bind(mat, mod).first<{ id: number; codigo_validacao: string }>();
  const voltar = `/admin/turmas/${d.turma.turma_id}/modulos/${mod}`;
  const qsPrevia = new URLSearchParams(Object.entries({
    data_emissao: e.dataEmissao, registro_numero: e.registroNumero ?? '', folha: e.folha ?? '', livro: e.livro ?? '',
    data_registro: e.dataRegistro ?? '', sistec_codigo: e.sistecCodigo ?? '', sistec_data: e.sistecData ?? '',
  })).toString();

  return (
    <Pagina titulo="Emitir certificado" usuario={c.get('usuario')} caminho={c.req.path}>
      <p><a href={voltar}>← Módulo {d.modulo.nome} · turma {d.turma.turma_codigo}</a></p>
      <h1>Emitir certificado</h1>
      <div class="cartao">
        <p><b>{d.nomeExibido}</b> · CPF {mascararCPF(d.aluno.cpf ?? '')}<br />
          Qualificação Profissional Técnica: <b>{d.modulo.qualificacao_conferida}</b> (Módulo {d.modulo.ordem}: {d.modulo.nome}, {d.modulo.carga_horaria} h)</p>
        {existente ? (
          <div class="msg ok">Já emitido: <a href={`/admin/certificados/${existente.id}`}>{existente.codigo_validacao}</a>.</div>
        ) : bloqueios.length > 0 ? (
          <div class="msg erro"><b>A emissão está bloqueada:</b><ul>{bloqueios.map((m) => <li>{m}</li>)}</ul>
            {d.avaliacao.motivos.length > 0 && <><b>Aprovação:</b><ul>{d.avaliacao.motivos.map((m) => <li>{m}</li>)}</ul></>}
          </div>
        ) : (
          <div class="msg ok">Aluno apto e dados completos.</div>
        )}
        {d.avisos.length > 0 && <div class="msg aviso"><b>Conferir antes de emitir:</b><ul>{d.avisos.map((m) => <li>{m}</li>)}</ul></div>}
      </div>

      {!existente && (
        <div class="cartao">
          <form method="post" class="grade" onsubmit="return confirm('Confirmar a emissão? Depois de emitido, o certificado não pode ser alterado nem apagado (somente revogado).')">
            <Campo nome="data_emissao" rotulo="Data de emissão" tipo="date" valor={e.dataEmissao} obrigatorio />
            <Campo nome="registro_numero" rotulo="Registro nº" valor={e.registroNumero} obrigatorio dica={`Sugerido: ${sug.registroNumero}`} />
            <Campo nome="folha" rotulo="Folha nº" valor={e.folha} obrigatorio dica={`Sugerida: ${sug.folha}`} />
            <Campo nome="livro" rotulo="Livro nº" valor={e.livro} obrigatorio dica={`Sugerido: ${sug.livro}`} />
            <Campo nome="data_registro" rotulo="Data do registro (IECT)" tipo="date" valor={e.dataRegistro} />
            <Campo nome="sistec_codigo" rotulo="Código de autenticação SISTEC" valor={e.sistecCodigo} obrigatorio />
            <Campo nome="sistec_data" rotulo="Data do registro no SISTEC" tipo="date" valor={e.sistecData} obrigatorio />
            <div class="largo acoes">
              <button disabled={d.faltantes.length > 0}>Emitir certificado</button>
              <a class="botao sec" href={`/admin/previa/${mat}/${mod}/pdf?${qsPrevia}`} target="_blank">PDF de prévia</a>
              <a class="botao sec" href={`/admin/previa/${mat}/${mod}`} target="_blank">Prévia em tela</a>
            </div>
            <p class="largo muted">O PDF de prévia sai com marca d'água e sem QR code. O código de validação (INV-AAAA-NNNNN) e o QR code são gerados no momento da emissão.</p>
          </form>
        </div>
      )}
    </Pagina>
  );
}

const idsEmissao = (c: any) => ({ mat: Number(c.req.param('mat')), mod: Number(c.req.param('mod')) });

rotasCertificados.get('/emitir/:mat{[0-9]+}/:mod{[0-9]+}', exigir('certificados.emitir'), async (c) => {
  const { mat, mod } = idsEmissao(c);
  try {
    return c.html(await telaEmissao(c, mat, mod));
  } catch (e) {
    if (e instanceof NaoEncontrado) return c.notFound();
    throw e;
  }
});

rotasCertificados.post('/emitir/:mat{[0-9]+}/:mod{[0-9]+}', exigir('certificados.emitir'), async (c) => {
  const { mat, mod } = idsEmissao(c);
  const entrada = lerEntrada(await lerCorpo(c), mat, mod);
  try {
    const r = await emitirCertificado(c.env, c.get('usuario').email, entrada);
    await auditar(c, 'emitir', 'certificado', r.id, null, {
      codigo: r.codigo, aluno: r.snapshot.aluno.nome, modulo: r.snapshot.modulo.nome,
      registro: r.snapshot.registro, sistec: r.snapshot.sistec,
    });
    return c.redirect(`/admin/certificados/${r.id}?ok=` + encodeURIComponent(`Certificado ${r.codigo} emitido.`));
  } catch (e) {
    if (e instanceof ErroEmissao) {
      await auditar(c, 'emissao_bloqueada', 'matricula', mat, null, { modulo_id: mod, motivos: e.motivos });
      return c.html(await telaEmissao(c, mat, mod, entrada, e.motivos), 400);
    }
    if (e instanceof NaoEncontrado) return c.notFound();
    if (String(e).includes('UNIQUE')) {
      return c.html(await telaEmissao(c, mat, mod, entrada, ['Registro, código SISTEC ou certificado já utilizado por outra emissão simultânea. Confira e tente de novo.']), 409);
    }
    throw e;
  }
});

// --------------------------- Consulta e PDF ---------------------------
async function carregar(c: any) {
  return (c.env.DB as D1Database).prepare('SELECT * FROM certificados WHERE id = ?').bind(Number(c.req.param('id'))).first<Record<string, any>>();
}

rotasCertificados.get('/:id{[0-9]+}', async (c) => {
  const ce = await carregar(c);
  if (!ce) return c.notFound();
  const s = JSON.parse(ce.snapshot_json) as SnapshotCertificado;
  const u = c.get('usuario');
  return c.html(
    <Pagina titulo={ce.codigo_validacao} usuario={u} caminho={c.req.path} ok={c.req.query('ok')}>
      <p><a href="/admin/certificados">← Certificados</a></p>
      <h1>Certificado {ce.codigo_validacao} <span class={`tag ${ROTULO_STATUS[ce.status]}`}>{ce.status}</span></h1>
      <div class="acoes">
        <a class="botao" href={`/admin/certificados/${ce.id}/pdf`} target="_blank">Abrir PDF</a>
        <a class="botao sec" href={`/admin/certificados/${ce.id}/pdf?baixar=1`}>Baixar PDF</a>
      </div>
      <table style="max-width:900px">
        <tr><th>Estudante</th><td>{s.aluno.nome} · CPF {mascararCPF(s.aluno.cpf)}</td></tr>
        <tr><th>Curso</th><td>{s.curso.nome} · {s.curso.eixo}</td></tr>
        <tr><th>Qualificação</th><td>{s.modulo.qualificacao} — Módulo {s.modulo.ordem}: {s.modulo.nome} ({s.modulo.cargaHoraria} h)</td></tr>
        <tr><th>Turma</th><td>{s.turma.codigo} · ano letivo {s.turma.anoLetivo}</td></tr>
        <tr><th>Emissão</th><td>{s.local}, {dataBR(s.dataEmissao)} · por {ce.emitido_por}</td></tr>
        <tr><th>Registro IECT</th><td>nº {s.registro.numero} · folha {s.registro.folha} · livro {s.registro.livro}{s.registro.data ? ` · ${dataBR(s.registro.data)}` : ''}</td></tr>
        <tr><th>SISTEC</th><td>{s.sistec.codigo}{s.sistec.data ? ` · ${dataBR(s.sistec.data)}` : ''}</td></tr>
        <tr><th>Signatários</th><td>{s.signatarios.map((x) => `${x.nome} (${x.cargo})`).join(' · ')}</td></tr>
        <tr><th>Validação</th><td><code>{s.validacao.url}</code></td></tr>
        <tr><th>Hash SHA-256 dos dados</th><td><code style="word-break:break-all">{ce.hash_sha256}</code></td></tr>
      </table>
      {ce.status === 'revogado' && <div class="msg erro">Revogado: {ce.motivo_revogacao}</div>}
      {pode(u.perfil, 'certificados.revogar') && ce.status === 'válido' && (
        <p class="muted">Revogação e 2ª via: previstas para depois de 05/12.</p>
      )}
    </Pagina>,
  );
});

rotasCertificados.get('/:id{[0-9]+}/pdf', async (c) => {
  const ce = await carregar(c);
  if (!ce?.pdf_r2_key) return c.notFound();
  const obj = await c.env.ARQUIVOS.get(ce.pdf_r2_key);
  if (!obj) return c.notFound();
  await auditar(c, 'baixar_pdf', 'certificado', ce.id, null, { codigo: ce.codigo_validacao });
  const disp = c.req.query('baixar') ? 'attachment' : 'inline';
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disp}; filename="${ce.codigo_validacao}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
});

