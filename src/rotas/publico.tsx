/**
 * Página pública de validação (/v) — acesso sem login.
 *
 * LGPD: a consulta mostra apenas os dados listados no CLAUDE.md, com CPF mascarado, sempre a partir do
 * snapshot congelado na emissão. O PDF original (que contém RG, filiação e nascimento) só é liberado
 * com a chave secreta que vem no QR code — o código INV-AAAA-NNNNN sozinho é sequencial e adivinhável.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, PaginaPublica } from '../views/layout';
import { auditar } from '../lib/auditoria';
import { analisarCodigo } from '../lib/codigo';
import { mascararCPF } from '../lib/cpf';
import { dataBR, dataExtenso } from '../lib/datas';
import type { SnapshotCertificado } from '../certificado/snapshot';
import { temaDoCookie } from './auth';
import { ROTULO_DOCUMENTO, type TipoDocumento } from '../documentos/montar';
import { ITEM_CATALOGO } from '../documentos/catalogo';
import type { SnapshotDocumento } from '../documentos/emissao';

interface DocumentoRow {
  id: number;
  tipo: TipoDocumento;
  codigo_validacao: string;
  token: string;
  status: 'válido' | 'revogado';
  motivo_revogacao: string | null;
  revogado_em: string | null;
  pdf_r2_key: string;
  snapshot_json: string;
}

async function buscarDocumento(db: D1Database, codigo: string): Promise<DocumentoRow | null> {
  if (!analisarCodigo(codigo)) return null;
  return db.prepare('SELECT * FROM documentos WHERE codigo_validacao = ?').bind(codigo.trim().toUpperCase()).first<DocumentoRow>();
}

export const rotasPublico = new Hono<Env>();

const PUBLICO = { id: null, email: 'público' };

rotasPublico.use('*', async (c, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'same-origin'); // a chave do QR não vaza para outros sites
});

interface Certificado {
  id: number;
  codigo_validacao: string;
  token: string;
  status: 'válido' | 'revogado' | 'substituído';
  motivo_revogacao: string | null;
  revogado_em: string | null;
  certificado_substituto_id: number | null;
  pdf_r2_key: string | null;
  snapshot_json: string;
}

/** Comparação sem atalho (tempo constante para tamanhos iguais). */
function mesmoToken(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function buscar(db: D1Database, codigo: string): Promise<Certificado | null> {
  if (!analisarCodigo(codigo)) return null;
  return db.prepare('SELECT * FROM certificados WHERE codigo_validacao = ?').bind(codigo.trim().toUpperCase()).first<Certificado>();
}

const FormConsulta = ({ valor }: { valor?: string }) => (
  <form method="get" action="/v" class="consulta">
    <input name="codigo" value={valor ?? ''} placeholder="INV-2026-00001" required pattern="[Ii][Nn][Vv]-\d{4}-\d{5}"
      title="Formato: INV-AAAA-NNNNN" autocomplete="off" aria-label="Código de validação" />
    <button>Consultar</button>
  </form>
);

const Rodape = ({ s }: { s?: SnapshotCertificado }) => (
  <>
    <div>{s?.instituicao.nome ?? 'INSTITUTO INOVATIVA DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA - IECT'}{s?.instituicao.cnpj ? ` · CNPJ ${s.instituicao.cnpj}` : ''}</div>
    <div>{s?.instituicao.enderecoLinha ?? 'Rua do Rosário, 815 – Coronel Antonino, Campo Grande - MS, 79010-310'}</div>
  </>
);

// ------------------------------ Consulta manual ------------------------------
rotasPublico.get('/', (c) => {
  const codigo = (c.req.query('codigo') ?? '').trim().toUpperCase();
  if (codigo) return c.redirect(`/v/${encodeURIComponent(codigo)}`);
  return c.html(
    <PaginaPublica titulo="Validação de certificados" tema={temaDoCookie(c)} rodape={<Rodape />}>
      <h1>Validar um certificado</h1>
      <p class="muted">
        Digite o código de validação impresso no verso do certificado (formato <b>INV-AAAA-NNNNN</b>)
        ou aponte a câmera do celular para o QR code.
      </p>
      <div class="cartao"><FormConsulta /></div>
    </PaginaPublica>,
  );
});

// ------------------------------ Resultado ------------------------------
rotasPublico.get('/:codigo', async (c) => {
  const codigo = c.req.param('codigo').trim().toUpperCase();
  const tema = temaDoCookie(c);
  const ce = await buscar(c.env.DB, codigo);
  const doc = ce ? null : await buscarDocumento(c.env.DB, codigo);
  if (doc) return paginaDocumento(c, doc, tema);
  if (!ce) {
    // Sem gravar no banco: uma varredura de códigos não pode consumir a cota diária de gravações do D1.
    console.warn(`[validacao] código inexistente ${codigo.slice(0, 40)} ip=${c.req.header('CF-Connecting-IP') ?? '?'}`);
    return c.html(
      <PaginaPublica titulo="Certificado não encontrado" tema={tema} rodape={<Rodape />}>
        <div class="selo erro" style="text-transform:none">
          <Icone nome="alerta" />
          <div><b style="text-transform:none;font-size:1.25rem;letter-spacing:0">Certificado não encontrado</b>
            Nenhum certificado foi emitido com o código <code>{codigo.slice(0, 40)}</code>. Confira a digitação.</div>
        </div>
        <div class="cartao"><FormConsulta valor={codigo.slice(0, 40)} /></div>
      </PaginaPublica>,
      404,
    );
  }

  const s = JSON.parse(ce.snapshot_json) as SnapshotCertificado;
  const comChave = mesmoToken(c.req.query('t'), ce.token);
  await auditar(c, 'consulta_publica', 'certificado', ce.id, null, { codigo: ce.codigo_validacao, via_qrcode: comChave }, PUBLICO);

  let substituto: string | null = null;
  if (ce.status === 'substituído' && ce.certificado_substituto_id) {
    const r = await c.env.DB.prepare('SELECT codigo_validacao FROM certificados WHERE id = ?').bind(ce.certificado_substituto_id).first<{ codigo_validacao: string }>();
    substituto = r?.codigo_validacao ?? null;
  }
  const ato = s.curso.atoAutorizacao;
  const p = s.modulo.periodo?.inicio ? { i: s.modulo.periodo.inicio, f: s.modulo.periodo.fim } : { i: s.turma.dataInicio, f: s.turma.dataFim };
  const periodo = p.i && p.f ? `${dataBR(p.i)} a ${dataBR(p.f)}` : '—';

  return c.html(
    <PaginaPublica titulo={`Certificado ${ce.codigo_validacao}`} tema={tema} rodape={<Rodape s={s} />}>
      {ce.status === 'válido' && (
        <div class="selo ok">
          <Icone nome="valido" />
          <div><b>Certificado válido</b>Emitido pelo Instituto Inovativa e registrado no livro de registro da instituição.</div>
        </div>
      )}
      {ce.status === 'revogado' && (
        <div class="selo erro">
          <Icone nome="revogado" />
          <div>
            <b>Certificado revogado</b>
            Este certificado foi revogado{ce.revogado_em ? ` em ${dataBR(ce.revogado_em)}` : ''} e <strong>não tem validade</strong>.
            {ce.motivo_revogacao && <div>Motivo: {ce.motivo_revogacao}</div>}
          </div>
        </div>
      )}
      {ce.status === 'substituído' && (
        <div class="selo aviso">
          <Icone nome="alerta" />
          <div>
            <b>Certificado substituído por 2ª via</b>
            Este documento foi substituído e não deve mais ser usado.
            {substituto && <div>Consulte a via atual: <a href={`/v/${substituto}`}>{substituto}</a></div>}
          </div>
        </div>
      )}

      <dl class="dados">
        <dt>Código de validação</dt><dd><b>{ce.codigo_validacao}</b></dd>
        <dt>Estudante</dt><dd>{s.aluno.nome}</dd>
        <dt>CPF</dt><dd>{mascararCPF(s.aluno.cpf)}</dd>
        <dt>Certificado</dt><dd>{s.curso.rotuloQualificacao ?? 'Qualificação Profissional Técnica'} — <b>{s.modulo.qualificacao}</b></dd>
        <dt>Módulo temático</dt><dd>Módulo {s.modulo.ordem}: {s.modulo.nome} · {s.modulo.cargaHoraria} horas</dd>
        <dt>Curso</dt><dd>{s.curso.nome}{s.curso.nivel ? <div class="muted">{s.curso.nivel}</div> : null}</dd>
        <dt>Eixo tecnológico</dt><dd>{s.curso.eixo}{s.curso.area ? ` · Área ${s.curso.area}` : ''}</dd>
        <dt>Período</dt><dd>{periodo}</dd>
        <dt>Data de emissão</dt><dd>{dataExtenso(s.dataEmissao)} · {s.local}</dd>
        <dt>Registro</dt><dd>Nº {s.registro.numero} · Folha {s.registro.folha} · Livro {s.registro.livro}{s.registro.anoLetivo ? ` · Ano letivo ${s.registro.anoLetivo}` : ''}</dd>
        {s.sistec.codigo && <><dt>Registro SISTEC</dt><dd>{s.sistec.codigo}</dd></>}
        <dt>Autorização do curso</dt>
        <dd>
          {ato ? `${ato.tipo} ${ato.orgao.includes('CEE/MS') ? 'CEE/MS ' : ''}nº ${ato.numero}, de ${dataExtenso(ato.data)}` : '—'}
          {ato?.doeNumero && <div class="muted">Publicação: DOE/MS nº {ato.doeNumero}{ato.doeData ? `, de ${dataBR(ato.doeData)}` : ''}</div>}
        </dd>
        <dt>Instituição</dt><dd>{s.instituicao.nome}<div class="muted">{s.instituicao.credenciamento}</div></dd>
      </dl>

      <div class="acoes" style="margin-top:1rem">
        {ce.status === 'válido' && comChave && ce.pdf_r2_key ? (
          <a class="botao" href={`/v/${ce.codigo_validacao}/pdf?t=${ce.token}`} target="_blank" rel="noopener">
            <Icone nome="baixar" />Baixar o PDF original
          </a>
        ) : ce.status === 'válido' ? (
          <p class="muted" style="margin:0">Para baixar o PDF original, leia o QR code impresso no verso do certificado.</p>
        ) : null}
      </div>

      <h2>Consultar outro certificado</h2>
      <div class="cartao"><FormConsulta /></div>
    </PaginaPublica>,
  );
});

// ------------------------ Documentos (declaração/histórico) ------------------------
async function paginaDocumento(c: any, doc: DocumentoRow, tema: ReturnType<typeof temaDoCookie>) {
  const { resumo: r } = JSON.parse(doc.snapshot_json) as SnapshotDocumento;
  const comChave = mesmoToken(c.req.query('t'), doc.token);
  await auditar(c, 'consulta_publica', 'documento', doc.id, null, { codigo: doc.codigo_validacao, via_qrcode: comChave }, PUBLICO);
  const rotulo = ROTULO_DOCUMENTO[doc.tipo];
  const periodo = r.periodo?.inicio && r.periodo.fim ? `${dataBR(r.periodo.inicio)} a ${dataBR(r.periodo.fim)}` : '—';
  const feminino = ITEM_CATALOGO[doc.tipo]?.feminino ?? false;
  return c.html(
    <PaginaPublica titulo={`${rotulo} ${doc.codigo_validacao}`} tema={tema} rodape={<Rodape />}>
      {doc.status === 'válido' ? (
        <div class="selo ok">
          <Icone nome="valido" />
          <div><b>{rotulo} {feminino ? 'válida' : 'válido'}</b>Documento emitido e registrado pelo Instituto Inovativa.</div>
        </div>
      ) : (
        <div class="selo erro">
          <Icone nome="revogado" />
          <div>
            <b>Documento revogado</b>
            Este documento foi revogado{doc.revogado_em ? ` em ${dataBR(doc.revogado_em)}` : ''} e <strong>não tem validade</strong>.
            {doc.motivo_revogacao && <div>Motivo: {doc.motivo_revogacao}</div>}
          </div>
        </div>
      )}
      <dl class="dados">
        <dt>Código de validação</dt><dd><b>{doc.codigo_validacao}</b></dd>
        <dt>Documento</dt><dd>{rotulo}</dd>
        <dt>Estudante</dt><dd>{r.aluno}</dd>
        <dt>CPF</dt><dd>{mascararCPF(r.cpf)}</dd>
        <dt>Curso</dt><dd>{r.curso}</dd>
        <dt>Eixo tecnológico</dt><dd>{r.eixo}</dd>
        {r.modulo && <><dt>Módulo temático</dt><dd>Módulo {r.modulo.ordem}: {r.modulo.nome} · {r.modulo.cargaHoraria} horas</dd>
        <dt>Qualificação</dt><dd>{r.rotuloQualificacao ?? 'Qualificação Profissional Técnica'} — {r.modulo.qualificacao}</dd>
        <dt>Período</dt><dd>{periodo}</dd></>}
        {(r.itens ?? []).map(([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>)}
        <dt>Data de emissão</dt><dd>{dataExtenso(r.dataEmissao)}</dd>
      </dl>
      <div class="acoes" style="margin-top:1rem">
        {doc.status === 'válido' && comChave ? (
          <a class="botao" href={`/v/${doc.codigo_validacao}/pdf?t=${doc.token}`} target="_blank" rel="noopener"><Icone nome="baixar" />Baixar o PDF original</a>
        ) : doc.status === 'válido' ? (
          <p class="muted" style="margin:0">Para baixar o PDF original, leia o QR code impresso no documento.</p>
        ) : null}
      </div>
      <h2>Consultar outro documento</h2>
      <div class="cartao"><FormConsulta /></div>
    </PaginaPublica>,
  );
}

// ------------------------------ PDF original ------------------------------
rotasPublico.get('/:codigo/pdf', async (c) => {
  const doc = await buscarDocumento(c.env.DB, c.req.param('codigo'));
  if (doc) {
    if (doc.status !== 'válido' || !mesmoToken(c.req.query('t'), doc.token)) return c.text('PDF indisponível. Use o QR code impresso no documento.', 404);
    const obj = await c.env.ARQUIVOS.get(doc.pdf_r2_key);
    if (!obj) return c.text('PDF indisponível.', 404);
    await auditar(c, 'download_publico_pdf', 'documento', doc.id, null, { codigo: doc.codigo_validacao }, PUBLICO);
    return new Response(obj.body, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${doc.codigo_validacao}.pdf"`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' },
    });
  }
  const ce = await buscar(c.env.DB, c.req.param('codigo'));
  if (!ce || ce.status !== 'válido' || !ce.pdf_r2_key || !mesmoToken(c.req.query('t'), ce.token)) {
    return c.text('PDF indisponível. Use o QR code impresso no certificado.', 404);
  }
  const obj = await c.env.ARQUIVOS.get(ce.pdf_r2_key);
  if (!obj) return c.text('PDF indisponível.', 404);
  await auditar(c, 'download_publico_pdf', 'certificado', ce.id, null, { codigo: ce.codigo_validacao }, PUBLICO);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${ce.codigo_validacao}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'same-origin',
    },
  });
});
