/**
 * Snapshot: cópia congelada de tudo o que é impresso no certificado. O PDF é gerado a partir dele,
 * a validação pública o exibe e o hash SHA-256 é calculado sobre ele — assim o certificado emitido
 * não muda se os cadastros forem alterados depois.
 */
import type { DadosCertificado } from './dados';
import { dataExtenso } from '../lib/datas';

export interface DadosEmissao {
  dataEmissao: string; // ISO
  codigoValidacao: string | null;
  urlValidacao: string | null;
  registroNumero: string | null;
  folha: string | null;
  livro: string | null;
  dataRegistro: string | null; // ISO
  sistecCodigo: string | null;
  sistecData: string | null; // ISO
}

export interface SignatarioSnapshot {
  funcao: 'diretor_pedagogico' | 'secretario';
  nome: string;
  cargo: string;
  assinatura_r2_key: string | null;
  portaria?: string | null;
}

export interface SnapshotCertificado {
  versao: 1;
  tipo: 'qualificacao_intermediaria';
  instituicao: {
    nome: string;
    cnpj: string | null;
    enderecoLinha: string;
    credenciamento: string;
    /** texto "Autorização" do curso, linha a linha (ausente em certificados anteriores à migração 0013) */
    autorizacao?: string[];
    logo_r2_key: string | null;
    fundo_r2_key: string | null;
    /** ausente em certificados emitidos antes da migração 0005 */
    fundo_verso_r2_key?: string | null;
  };
  curso: {
    id: number;
    nome: string;
    eixo: string;
    area: string | null;
    nivel: string | null;
    atoAutorizacao: { tipo: string; numero: string; data: string; orgao: string; doeNumero: string | null; doeData: string | null } | null;
    /** ausente em certificados emitidos antes de 16/11/2026 (eram todos de curso técnico) */
    rotuloQualificacao?: string;
  };
  modulo: { id: number; ordem: number; nome: string; qualificacao: string; cargaHoraria: number;
    /** período do módulo na turma (ausente em certificados anteriores a 16/11/2026) */
    periodo?: { inicio: string | null; fim: string | null } | null };
  turma: { codigo: string; anoLetivo: number | null; dataInicio: string | null; dataFim: string | null };
  aluno: {
    id: number;
    nome: string; // nome impresso (social, se houver)
    cpf: string;
    ensinoMedio: { instituicao: string | null; municipio: string | null; uf: string | null; anoConclusao: string | null };
  };
  disciplinas: { nome: string; ch: number; mediaFinal: number | null; frequencia: number | null; resultado: string }[];
  textoFrente: string;
  /** trechos com negrito (ausente em certificados antigos: o texto inteiro saía em negrito) */
  textoFrenteRico?: { t: string; b: boolean }[];
  local: string;
  dataEmissao: string;
  registro: { numero: string | null; folha: string | null; livro: string | null; anoLetivo: number | null; data: string | null };
  sistec: { codigo: string | null; data: string | null };
  signatarios: SignatarioSnapshot[];
  validacao: { codigo: string | null; url: string | null };
}

export function montarSnapshot(d: DadosCertificado, e: DadosEmissao): SnapshotCertificado {
  const i = d.instituicao;
  const ato = d.atoAutorizacao;
  const sig = (s: DadosCertificado['diretor'], funcao: SignatarioSnapshot['funcao']): SignatarioSnapshot[] =>
    s ? [{ funcao, nome: s.nome, cargo: s.cargo, assinatura_r2_key: s.assinatura_r2_key, portaria: s.portaria ?? null }] : [];
  return {
    versao: 1,
    tipo: 'qualificacao_intermediaria',
    instituicao: {
      nome: String(i.razao_social).toUpperCase(),
      cnpj: i.cnpj ?? null,
      enderecoLinha: `${i.endereco} – ${i.bairro}, ${i.municipio} - ${i.uf}, ${i.cep}`,
      credenciamento: d.credenciamentoTexto ?? '[ato de credenciamento]',
      autorizacao: d.autorizacaoLinhas,
      logo_r2_key: i.logo_r2_key ?? null,
      fundo_r2_key: i.fundo_r2_key ?? null,
      fundo_verso_r2_key: i.fundo_verso_r2_key ?? null,
    },
    curso: {
      id: d.curso.id,
      nome: d.curso.nome,
      eixo: d.curso.eixo,
      area: d.curso.area_tecnologica ?? null,
      nivel: d.curso.nivel ?? null,
      rotuloQualificacao: d.rotuloQualificacao,
      atoAutorizacao: ato
        ? { tipo: ato.tipo, numero: ato.numero, data: ato.data, orgao: ato.orgao_emissor, doeNumero: ato.publicacao_doe_numero ?? null, doeData: ato.publicacao_doe_data ?? null }
        : null,
    },
    modulo: {
      id: d.modulo.id,
      ordem: d.modulo.ordem,
      nome: d.modulo.nome,
      qualificacao: d.modulo.qualificacao_conferida ?? '',
      cargaHoraria: d.modulo.carga_horaria,
      periodo: d.moduloTurma ? { inicio: d.moduloTurma.data_inicio, fim: d.moduloTurma.data_fim } : null,
    },
    turma: {
      codigo: d.turma.turma_codigo,
      anoLetivo: d.turma.ano_letivo ?? null,
      dataInicio: d.turma.data_inicio ?? null,
      dataFim: d.turma.data_fim ?? null,
    },
    aluno: {
      id: d.aluno.id,
      nome: d.nomeExibido,
      cpf: d.aluno.cpf ?? '',
      ensinoMedio: {
        instituicao: d.aluno.ensino_medio_instituicao,
        municipio: d.aluno.ensino_medio_municipio,
        uf: d.aluno.ensino_medio_uf,
        anoConclusao: d.aluno.ensino_medio_ano_conclusao == null ? null : String(d.aluno.ensino_medio_ano_conclusao),
      },
    },
    disciplinas: d.disciplinas.map((x) => ({ nome: x.nome, ch: x.ch, mediaFinal: x.mediaFinal, frequencia: x.frequencia, resultado: x.resultado })),
    textoFrente: d.textoFrente.map((s) => s.texto).join(''),
    textoFrenteRico: d.textoFrente.reduce<{ t: string; b: boolean }[]>((acc, s) => {
      const b = !!s.negrito;
      if (acc.length && acc[acc.length - 1].b === b) acc[acc.length - 1].t += s.texto;
      else if (s.texto) acc.push({ t: s.texto, b });
      return acc;
    }, []),
    local: d.localEmissao,
    dataEmissao: e.dataEmissao,
    registro: { numero: e.registroNumero, folha: e.folha, livro: e.livro, anoLetivo: d.turma.ano_letivo ?? null, data: e.dataRegistro },
    sistec: { codigo: e.sistecCodigo, data: e.sistecData },
    signatarios: [...sig(d.diretor, 'diretor_pedagogico'), ...sig(d.secretario, 'secretario')],
    validacao: { codigo: e.codigoValidacao, url: e.urlValidacao },
  };
}

/** JSON com chaves ordenadas: a mesma informação gera sempre o mesmo texto (e o mesmo hash). */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(',')}}`;
}

export async function hashSnapshot(s: SnapshotCertificado): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jsonCanonico(s)));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const dataExt = (iso: string | null | undefined) => (iso ? dataExtenso(iso) : null);
