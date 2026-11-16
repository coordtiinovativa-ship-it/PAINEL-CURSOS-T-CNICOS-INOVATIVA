/**
 * Emissão de certificado de qualificação intermediária (um por módulo temático concluído).
 * Ordem: valida → reserva código → monta snapshot/hash → gera PDF → grava no R2 → registra no D1.
 * Se algo falhar após a reserva, o código fica sem uso (nunca é reaproveitado — regra do sistema).
 */
import type { Env } from '../tipos';
import { montarDadosCertificado, type DadosCertificado } from './dados';
import { hashSnapshot, montarSnapshot, type SnapshotCertificado } from './snapshot';
import { gerarPdfCertificado } from './pdf';
import { carregarRecursos } from './recursos';
import { gerarToken, reservarProximoCodigo } from '../lib/codigo';
import { urlQrExemplo } from '../lib/qr';

type Bindings = Env['Bindings'];

export class ErroEmissao extends Error {
  constructor(public motivos: string[]) {
    super(motivos.join('; '));
  }
}

export interface EntradaEmissao {
  matriculaId: number;
  moduloId: number;
  dataEmissao: string;
  registroNumero: string | null;
  folha: string | null;
  livro: string | null;
  dataRegistro: string | null;
  sistecCodigo: string | null;
  sistecData: string | null;
}

export interface Sugestao { registroNumero: string; folha: string; livro: string }

/** Próximo nº de registro e a folha/livro correspondentes, conforme a configuração da instituição. */
export async function sugerirRegistro(db: D1Database): Promise<Sugestao> {
  const r = await db
    .prepare(
      `SELECT coalesce(max(CAST(registro_numero AS INTEGER)), 0) + 1 AS n,
              (SELECT registros_por_folha FROM instituicoes WHERE id = 1) AS rpf,
              (SELECT folhas_por_livro FROM instituicoes WHERE id = 1) AS fpl
         FROM certificados`,
    )
    .first<{ n: number; rpf: number; fpl: number }>();
  const n = r?.n ?? 1;
  const rpf = r?.rpf ?? 1;
  const fpl = r?.fpl ?? 200;
  const folhaGlobal = Math.ceil(n / rpf);
  return {
    registroNumero: String(n),
    folha: String(((folhaGlobal - 1) % fpl) + 1),
    livro: String(Math.floor((folhaGlobal - 1) / fpl) + 1),
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Validações que dependem só dos dados informados e do banco (sem reservar nada). */
export async function verificarEmissao(db: D1Database, d: DadosCertificado, e: EntradaEmissao): Promise<string[]> {
  const motivos = [...d.faltantes];
  if (!ISO.test(e.dataEmissao)) motivos.push('Data de emissão inválida.');
  if (e.dataRegistro && !ISO.test(e.dataRegistro)) motivos.push('Data do registro inválida.');
  if (!e.sistecCodigo) motivos.push('Informe o código de autenticação SISTEC (obrigatório para a emissão).');
  if (!e.sistecData || !ISO.test(e.sistecData)) motivos.push('Informe a data do registro no SISTEC.');
  if (!e.registroNumero || !e.folha || !e.livro) motivos.push('Informe registro, folha e livro.');

  const existente = await db
    .prepare(`SELECT codigo_validacao FROM certificados WHERE matricula_id = ? AND modulo_id = ? AND status = 'válido'`)
    .bind(e.matriculaId, e.moduloId)
    .first<{ codigo_validacao: string }>();
  if (existente) motivos.push(`Já existe certificado válido para este módulo (${existente.codigo_validacao}).`);

  if (e.registroNumero && e.folha && e.livro) {
    const dupReg = await db
      .prepare('SELECT codigo_validacao FROM certificados WHERE livro = ? AND folha = ? AND registro_numero = ?')
      .bind(e.livro, e.folha, e.registroNumero)
      .first<{ codigo_validacao: string }>();
    if (dupReg) motivos.push(`Registro nº ${e.registroNumero}, folha ${e.folha}, livro ${e.livro} já usado (${dupReg.codigo_validacao}).`);
  }
  if (e.sistecCodigo) {
    const dupSis = await db
      .prepare('SELECT codigo_validacao FROM certificados WHERE codigo_autenticacao_sistec = ?')
      .bind(e.sistecCodigo)
      .first<{ codigo_validacao: string }>();
    if (dupSis) motivos.push(`Código SISTEC já usado no certificado ${dupSis.codigo_validacao}.`);
  }
  return motivos;
}

export async function emitirCertificado(
  env: Bindings,
  usuarioEmail: string,
  e: EntradaEmissao,
): Promise<{ id: number; codigo: string; snapshot: SnapshotCertificado }> {
  const db = env.DB;
  const d = await montarDadosCertificado(db, e.matriculaId, e.moduloId);
  const motivos = await verificarEmissao(db, d, e);
  if (motivos.length) throw new ErroEmissao(motivos);

  const ano = Number(e.dataEmissao.slice(0, 4));
  const codigo = await reservarProximoCodigo(db, ano);
  const token = gerarToken();
  const url = `${env.URL_PUBLICA.replace(/\/$/, '')}/v/${codigo}?t=${token}`;

  const snapshot = montarSnapshot(d, {
    dataEmissao: e.dataEmissao,
    codigoValidacao: codigo,
    urlValidacao: url,
    registroNumero: e.registroNumero,
    folha: e.folha,
    livro: e.livro,
    dataRegistro: e.dataRegistro ?? e.dataEmissao,
    sistecCodigo: e.sistecCodigo,
    sistecData: e.sistecData,
  });
  const hash = await hashSnapshot(snapshot);
  const pdf = await gerarPdfCertificado(snapshot, await carregarRecursos(env, snapshot));
  const chavePdf = `certificados/${ano}/${codigo}.pdf`;
  await env.ARQUIVOS.put(chavePdf, pdf, {
    httpMetadata: { contentType: 'application/pdf', contentDisposition: `inline; filename="${codigo}.pdf"` },
    customMetadata: { sha256_dados: hash },
  });

  const cert = await db
    .prepare(
      `INSERT INTO certificados (tipo, codigo_validacao, token, matricula_id, modulo_id, registro_numero, folha, livro,
         ano_letivo, data_emissao, local_emissao, data_registro, codigo_autenticacao_sistec, data_registro_sistec,
         hash_sha256, pdf_r2_key, snapshot_json, emitido_por)
       VALUES ('qualificacao_intermediaria', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      codigo, token, e.matriculaId, e.moduloId, e.registroNumero, e.folha, e.livro, snapshot.registro.anoLetivo,
      e.dataEmissao, snapshot.local, snapshot.registro.data, e.sistecCodigo, e.sistecData, hash, chavePdf,
      JSON.stringify(snapshot), usuarioEmail,
    )
    .first<{ id: number }>();
  if (!cert) throw new Error('Falha ao registrar o certificado');

  if (snapshot.signatarios.length) {
    await db.batch(
      snapshot.signatarios.map((sig, i) =>
        db.prepare('INSERT INTO certificado_signatarios (certificado_id, ordem, nome, cargo, assinatura_r2_key) VALUES (?, ?, ?, ?, ?)')
          .bind(cert.id, i + 1, sig.nome, sig.cargo, sig.assinatura_r2_key),
      ),
    );
  }
  return { id: cert.id, codigo, snapshot };
}

/** PDF de prévia (marca d'água "PRÉVIA — SEM VALIDADE"), sem gravar nada. */
export async function gerarPdfPrevia(env: Bindings, d: DadosCertificado, extra: Partial<EntradaEmissao> = {}) {
  const snapshot = montarSnapshot(d, {
    dataEmissao: extra.dataEmissao ?? d.dataEmissao,
    codigoValidacao: null,
    urlValidacao: null,
    registroNumero: extra.registroNumero ?? null,
    folha: extra.folha ?? null,
    livro: extra.livro ?? null,
    dataRegistro: extra.dataRegistro ?? null,
    sistecCodigo: extra.sistecCodigo ?? null,
    sistecData: extra.sistecData ?? null,
  });
  return gerarPdfCertificado(snapshot, await carregarRecursos(env, snapshot), { previa: true, qrExemplo: urlQrExemplo(env.URL_PUBLICA) });
}
