import { marcaDoAmbiente } from '../lib/ambiente';
/**
 * Emissão de documentos acadêmicos (declaração de conclusão de módulo e histórico escolar).
 * Snapshot = layout completo + resumo; o PDF sai do snapshot e pode ser regerado idêntico.
 */
import type { Env } from '../tipos';
import { asset, r2 } from '../certificado/recursos';
import { jsonCanonico } from '../certificado/snapshot';
import { gerarToken, reservarProximoCodigo } from '../lib/codigo';
import { gerarPdfDocumento, type RecursosDocumento } from './pdf';
import { prepararDocumento, type ResumoDocumento, type TipoDocumento, type TipoDocumentoModulo } from './montar';
import type { DocumentoLayout } from './tipos';

type Bindings = Env['Bindings'];

export interface SnapshotDocumento {
  versao: 1;
  resumo: ResumoDocumento;
  layout: DocumentoLayout;
}

export class ErroDocumento extends Error {
  constructor(public motivos: string[]) {
    super(motivos.join('; '));
  }
}

export async function hashTexto(t: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function recursosDocumento(env: Bindings, layout: DocumentoLayout): Promise<RecursosDocumento> {
  const chaves = new Set<string>();
  for (const pg of layout.paginas)
    for (const b of pg.blocos)
      if (b.tipo === 'assinaturas') for (const i of b.itens) if (i.assinatura_r2_key) chaves.add(i.assinatura_r2_key);
  const [fonteRegular, fonteNegrito, logoR2, ...ass] = await Promise.all([
    asset(env, '/fontes/Arimo-Regular.ttf'),
    asset(env, '/fontes/Arimo-Bold.ttf'),
    r2(env, layout.instituicao.logo_r2_key),
    ...[...chaves].map((k) => r2(env, k)),
  ]);
  const assinaturas: Record<string, Uint8Array> = {};
  [...chaves].forEach((k, i) => { if (ass[i]) assinaturas[k] = ass[i]!; });
  return { fonteRegular, fonteNegrito, logo: logoR2 ?? (await asset(env, '/modelo/logo.png')), assinaturas };
}

/** Referências gravadas junto do documento (aluno sempre; matrícula, curso, módulo e nº da portaria quando houver). */
export interface RefsDocumento {
  tipo: TipoDocumento;
  alunoId: number;
  matriculaId: number | null;
  cursoId: number | null;
  moduloId: number | null;
  /** nº da portaria (único) */
  numero?: string | null;
}

/** Monta o documento com o código e a URL definitivos (ou nulos, na conferência antes de reservar o código). */
export type PrepararDocumento = (emissao: { dataEmissao: string; codigo: string | null; url: string | null }) =>
  Promise<{ layout: DocumentoLayout; resumo: ResumoDocumento; faltantes: string[] }>;

/**
 * Registra um documento: confere as pendências, reserva o código INV (mesma sequência dos certificados), gera o PDF a partir
 * do snapshot, guarda no R2 e insere em `documentos`. O código só é reservado quando não há pendências.
 */
export async function registrarDocumento(
  env: Bindings,
  usuarioEmail: string,
  refs: RefsDocumento,
  dataEmissao: string,
  preparar: PrepararDocumento,
): Promise<{ id: number; codigo: string; snapshot: SnapshotDocumento }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEmissao)) throw new ErroDocumento(['Data de emissão inválida.']);
  const verificacao = await preparar({ dataEmissao, codigo: null, url: null });
  if (verificacao.faltantes.length) throw new ErroDocumento(verificacao.faltantes);
  if (refs.numero) {
    const repetido = await env.DB.prepare('SELECT codigo_validacao FROM documentos WHERE numero = ?').bind(refs.numero).first<{ codigo_validacao: string }>();
    if (repetido) throw new ErroDocumento([`O nº ${refs.numero} já foi usado na portaria ${repetido.codigo_validacao}. Informe outro número.`]);
  }

  const codigo = await reservarProximoCodigo(env.DB, Number(dataEmissao.slice(0, 4)));
  const token = gerarToken();
  const url = `${env.URL_PUBLICA.replace(/\/$/, '')}/v/${codigo}?t=${token}`;
  const p = await preparar({ dataEmissao, codigo, url });
  const snapshot: SnapshotDocumento = { versao: 1, resumo: p.resumo, layout: p.layout };
  const json = jsonCanonico(snapshot);
  const hash = await hashTexto(json);
  const pdf = await gerarPdfDocumento(p.layout, await recursosDocumento(env, p.layout), { marca: marcaDoAmbiente(env) });
  const chave = `documentos/${dataEmissao.slice(0, 4)}/${codigo}.pdf`;
  await env.ARQUIVOS.put(chave, pdf, {
    httpMetadata: { contentType: 'application/pdf', contentDisposition: `inline; filename="${codigo}.pdf"` },
    customMetadata: { sha256_dados: hash },
  });
  const r = await env.DB.prepare(
    `INSERT INTO documentos (tipo, codigo_validacao, token, aluno_id, matricula_id, curso_id, modulo_id, numero, data_emissao,
                             hash_sha256, pdf_r2_key, snapshot_json, emitido_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(refs.tipo, codigo, token, refs.alunoId, refs.matriculaId, refs.cursoId, refs.moduloId, refs.numero ?? null, dataEmissao,
    hash, chave, json, usuarioEmail).first<{ id: number }>();
  if (!r) throw new Error('Falha ao registrar o documento');
  return { id: r.id, codigo, snapshot };
}

/** Declaração de conclusão e histórico por módulo. */
export async function emitirDocumento(
  env: Bindings,
  usuarioEmail: string,
  tipo: TipoDocumentoModulo,
  matriculaId: number,
  moduloId: number,
  dataEmissao: string,
): Promise<{ id: number; codigo: string; snapshot: SnapshotDocumento }> {
  const base = await prepararDocumento(env.DB, tipo, matriculaId, moduloId, { dataEmissao: /^\d{4}-\d{2}-\d{2}$/.test(dataEmissao) ? dataEmissao : undefined, codigo: null, url: null });
  return registrarDocumento(
    env, usuarioEmail,
    { tipo, alunoId: base.dados.aluno.id, matriculaId, cursoId: base.dados.curso.id, moduloId },
    dataEmissao,
    (e) => prepararDocumento(env.DB, tipo, matriculaId, moduloId, e),
  );
}
