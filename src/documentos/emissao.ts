/**
 * Emissão de documentos acadêmicos (declaração de conclusão de módulo e histórico escolar).
 * Snapshot = layout completo + resumo; o PDF sai do snapshot e pode ser regerado idêntico.
 */
import type { Env } from '../tipos';
import { asset, r2 } from '../certificado/recursos';
import { jsonCanonico } from '../certificado/snapshot';
import { gerarToken, reservarProximoCodigo } from '../lib/codigo';
import { gerarPdfDocumento, type RecursosDocumento } from './pdf';
import { prepararDocumento, type ResumoDocumento, type TipoDocumento } from './montar';
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
    asset(env, '/fontes/Carlito-Regular.ttf'),
    asset(env, '/fontes/Carlito-Bold.ttf'),
    r2(env, layout.instituicao.logo_r2_key),
    ...[...chaves].map((k) => r2(env, k)),
  ]);
  const assinaturas: Record<string, Uint8Array> = {};
  [...chaves].forEach((k, i) => { if (ass[i]) assinaturas[k] = ass[i]!; });
  return { fonteRegular, fonteNegrito, logo: logoR2 ?? (await asset(env, '/modelo/logo.png')), assinaturas };
}

export async function emitirDocumento(
  env: Bindings,
  usuarioEmail: string,
  tipo: TipoDocumento,
  matriculaId: number,
  moduloId: number,
  dataEmissao: string,
): Promise<{ id: number; codigo: string; snapshot: SnapshotDocumento }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEmissao)) throw new ErroDocumento(['Data de emissão inválida.']);
  const verificacao = await prepararDocumento(env.DB, tipo, matriculaId, moduloId, { dataEmissao, codigo: null, url: null });
  if (verificacao.faltantes.length) throw new ErroDocumento(verificacao.faltantes);

  const codigo = await reservarProximoCodigo(env.DB, Number(dataEmissao.slice(0, 4)));
  const token = gerarToken();
  const url = `${env.URL_PUBLICA.replace(/\/$/, '')}/v/${codigo}?t=${token}`;
  const p = await prepararDocumento(env.DB, tipo, matriculaId, moduloId, { dataEmissao, codigo, url });
  const snapshot: SnapshotDocumento = { versao: 1, resumo: p.resumo, layout: p.layout };
  const json = jsonCanonico(snapshot);
  const hash = await hashTexto(json);
  const pdf = await gerarPdfDocumento(p.layout, await recursosDocumento(env, p.layout));
  const chave = `documentos/${dataEmissao.slice(0, 4)}/${codigo}.pdf`;
  await env.ARQUIVOS.put(chave, pdf, {
    httpMetadata: { contentType: 'application/pdf', contentDisposition: `inline; filename="${codigo}.pdf"` },
    customMetadata: { sha256_dados: hash },
  });
  const r = await env.DB.prepare(
    `INSERT INTO documentos (tipo, codigo_validacao, token, matricula_id, modulo_id, data_emissao, hash_sha256, pdf_r2_key, snapshot_json, emitido_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(tipo, codigo, token, matriculaId, moduloId, dataEmissao, hash, chave, json, usuarioEmail).first<{ id: number }>();
  if (!r) throw new Error('Falha ao registrar o documento');
  return { id: r.id, codigo, snapshot };
}
