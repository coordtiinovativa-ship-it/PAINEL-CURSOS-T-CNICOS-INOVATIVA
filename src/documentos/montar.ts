/**
 * Monta o layout (blocos) da declaração de conclusão de módulo e do histórico escolar a partir
 * dos mesmos dados do certificado (montarDadosCertificado), com as pendências que impedem a emissão.
 */
import { descreverAto, linhaEndereco, montarDadosCertificado, ESTADOS, type DadosCertificado } from '../certificado/dados';
import { formatarCPF } from '../lib/cpf';
import { dataBR, dataExtenso } from '../lib/datas';
import { numBR } from '../lib/form';
import { preencherModelo } from '../lib/modelo';
import type { TipoDocumento } from './catalogo';
import {
  assinaturasOficiais, camposCurso, camposIdentificacao, descricaoCurso, paragrafoAproveitamento, registrosAproveitamento,
} from './comum';
import type { Bloco, DocumentoLayout } from './tipos';

export type { TipoDocumento } from './catalogo';
export { ROTULO_DOCUMENTO } from './catalogo';
/** Documentos por módulo (matrícula + módulo), emitidos pelas rotas /admin/documentos/:tipo/:mat/:mod. */
export type TipoDocumentoModulo = 'declaracao_conclusao_modulo' | 'historico_escolar';
export const TIPOS_DOCUMENTO: TipoDocumentoModulo[] = ['declaracao_conclusao_modulo', 'historico_escolar'];

export const TEXTO_DECLARACAO_PADRAO =
  'Declaramos, para os devidos fins, que {nome}, inscrito(a) no CPF sob o nº {cpf}, portador(a) do RG nº {rg} {rg_orgao}-{rg_uf}, nascido(a) em {data_nascimento_extenso}, concluiu com aprovação o MÓDULO TEMÁTICO {modulo}, com carga horária de {carga_horaria} horas, que confere a {tipo_qualificacao} de {qualificacao}, integrante do {curso} - Eixo Tecnológico: {eixo}, autorizado pela {ato_ppc_completo}, tendo cursado o módulo na turma {turma}, no período de {periodo}, com frequência de {frequencia}%. {situacao_certificado}';

/** Variáveis aceitas no texto da declaração (exibidas na tela de edição). */
export const VARIAVEIS_DECLARACAO = [
  'nome', 'cpf', 'rg', 'rg_orgao', 'rg_uf', 'data_nascimento_extenso', 'nacionalidade', 'naturalidade_municipio',
  'naturalidade_uf', 'curso', 'eixo', 'area', 'nivel', 'ato_ppc_numero', 'ato_ppc_data_extenso', 'modulo',
  'qualificacao', 'carga_horaria', 'turma', 'periodo', 'frequencia', 'situacao_certificado',
  'tipo_qualificacao', 'ato_ppc_completo', 'instituicao',
];

/** Resumo exibido na validação pública (sem dados pessoais além do permitido). */
export interface ResumoDocumento {
  tipo: TipoDocumento;
  aluno: string;
  cpf: string;
  curso: string;
  eixo: string;
  /** declaração e histórico por módulo */
  modulo?: { ordem: number; nome: string; qualificacao: string; cargaHoraria: number };
  /** ausente em documentos emitidos antes de 16/11/2026 */
  rotuloQualificacao?: string;
  periodo?: { inicio: string | null; fim: string | null };
  dataEmissao: string;
  situacaoModulo?: 'aprovado' | 'reprovado' | 'em andamento';
  /** documentos da Secretaria: linhas mostradas na validação pública (sem dados pessoais além do permitido) */
  itens?: [string, string][];
  /** portarias: nº e texto citado em "Registro de Aproveitamento de Estudos" dos históricos */
  numero?: string;
  registro?: string;
}

export interface DocumentoPreparado {
  tipo: TipoDocumentoModulo;
  dados: DadosCertificado;
  layout: DocumentoLayout;
  resumo: ResumoDocumento;
  faltantes: string[];
  avisos: string[];
}

const vazio = (v: unknown) => v == null || String(v).trim() === '';
const ext = (iso: string | null | undefined) => {
  try { return iso ? dataExtenso(iso) : null; } catch { return null; }
};

function frequenciaModulo(d: DadosCertificado): number | null {
  const com = d.disciplinas.filter((x) => x.frequencia != null);
  if (!com.length) return null;
  const ch = com.reduce((a, x) => a + x.ch, 0);
  return com.reduce((a, x) => a + (x.frequencia as number) * x.ch, 0) / ch;
}

export async function prepararDocumento(
  db: D1Database,
  tipo: TipoDocumentoModulo,
  matriculaId: number,
  moduloId: number,
  emissao: { dataEmissao?: string; codigo: string | null; url: string | null },
): Promise<DocumentoPreparado> {
  const d = await montarDadosCertificado(db, matriculaId, moduloId);
  const dataEmissao = emissao.dataEmissao ?? d.dataEmissao;
  const [cert, modeloTexto] = await Promise.all([
    db.prepare(`SELECT codigo_validacao, registro_numero, folha, livro, codigo_autenticacao_sistec FROM certificados
                 WHERE matricula_id = ? AND modulo_id = ? AND status = 'válido'`).bind(matriculaId, moduloId).first<Record<string, string>>(),
    db.prepare(`SELECT texto FROM modelos_texto WHERE documento = 'declaracao_conclusao_modulo' AND ativo = 1
                 AND (curso_id = ? OR curso_id IS NULL) ORDER BY curso_id IS NULL, id DESC LIMIT 1`).bind(d.curso.id).first<{ texto: string }>(),
  ]);
  const a = d.aluno;
  const mod = d.modulo as DadosCertificado['modulo'] & { perfil_profissional?: string | null; competencias?: string | null };
  const ato = d.atoAutorizacao;
  const freq = frequenciaModulo(d);
  // período do módulo na turma (módulos em sequência); sem ele, o da turma
  const pIni = d.moduloTurma?.data_inicio ?? d.turma.data_inicio ?? null;
  const pFim = d.moduloTurma?.data_inicio ? d.moduloTurma.data_fim : d.turma.data_fim ?? null;
  const periodo = pIni && pFim ? `${dataBR(pIni)} a ${dataBR(pFim)}` : null;
  const situacao: ResumoDocumento['situacaoModulo'] = d.avaliacao.aprovado ? 'aprovado' : d.avaliacao.pendente && !d.disciplinas.some((x) => x.resultado === 'RP') ? 'em andamento' : 'reprovado';

  const faltantes: string[] = [];
  const avisos: string[] = [...d.avisos.filter((x) => !x.includes('DOE'))];
  for (const [s, rotulo] of [[d.diretor, 'Diretor(a) Pedagógico(a)'], [d.secretario, 'Secretário(a)']] as const) {
    if (!s || s.nome.includes('A DEFINIR')) faltantes.push(`Signatário: ${rotulo} não cadastrado`);
  }
  if (!ato) faltantes.push('Curso: ato de aprovação do PPC / autorização');
  // módulos em sequência: só de módulo concluído na turma; a declaração também exige os módulos anteriores aprovados
  for (const f of d.faltantes) {
    if (f.startsWith('Módulo ainda não concluído')) faltantes.push(f);
    if (tipo === 'declaracao_conclusao_modulo' && f.startsWith('Os módulos são feitos em ordem')) faltantes.push(f);
  }

  const assinaturas: Bloco = {
    tipo: 'assinaturas',
    itens: [
      { legenda: d.secretario?.cargo ?? 'Secretário(a)', nome: d.secretario?.nome ?? null, assinatura_r2_key: d.secretario?.assinatura_r2_key ?? null, detalhe: d.secretario?.portaria ?? null },
      { legenda: d.diretor?.cargo ?? 'Diretora Pedagógica', nome: d.diretor?.nome ?? null, assinatura_r2_key: d.diretor?.assinatura_r2_key ?? null, detalhe: d.diretor?.portaria ?? null },
    ],
  };
  const localData: Bloco = { tipo: 'paragrafo', texto: `${d.localEmissao}, ${dataExtenso(dataEmissao)}.`, alinhar: 'direita', tamanho: 10.5 };
  const qualif = mod.qualificacao_conferida ?? '';
  const atoTexto = ato ? descreverAto(ato) : null;
  const rotulo = d.rotuloQualificacao;
  const rotuloNivel = `${rotulo}${d.curso.tipo === 'Curso Técnico' ? ' de Nível Médio' : ''}`;

  let paginas: DocumentoLayout['paginas'];
  let titulo: string;

  if (tipo === 'declaracao_conclusao_modulo') {
    titulo = `Declaração de conclusão — ${d.nomeExibido} — ${mod.nome}`;
    if (!d.avaliacao.aprovado) faltantes.push(d.avaliacao.pendente ? 'Resultados do módulo incompletos' : 'Aluno não aprovado no módulo');
    for (const [k, r] of [['nome_civil', 'Nome civil'], ['cpf', 'CPF'], ['rg', 'RG'], ['rg_orgao_expedidor', 'Órgão expedidor do RG'], ['rg_uf', 'UF do RG'], ['data_nascimento', 'Data de nascimento']] as const) {
      if (vazio(a[k])) faltantes.push(`Aluno: ${r}`);
    }
    const situacaoCert = cert
      ? `O respectivo certificado foi expedido e registrado sob o nº ${cert.registro_numero}, folha ${cert.folha}, livro ${cert.livro}.`
      : 'O respectivo certificado encontra-se em fase de expedição e registro.';
    const { texto } = preencherModelo(modeloTexto?.texto ?? TEXTO_DECLARACAO_PADRAO, {
      nome: d.nomeExibido.toUpperCase(),
      cpf: a.cpf ? formatarCPF(a.cpf) : null,
      rg: a.rg, rg_orgao: a.rg_orgao_expedidor, rg_uf: a.rg_uf,
      data_nascimento_extenso: ext(a.data_nascimento),
      nacionalidade: a.nacionalidade,
      naturalidade_municipio: a.naturalidade_municipio,
      naturalidade_uf: a.naturalidade_uf ? ESTADOS[a.naturalidade_uf] ?? a.naturalidade_uf : null,
      curso: d.curso.nome, eixo: d.curso.eixo, area: d.curso.area_tecnologica, nivel: d.curso.nivel,
      ato_ppc_numero: ato?.numero, ato_ppc_data_extenso: ext(ato?.data),
      modulo: mod.nome.toUpperCase(), qualificacao: qualif.toUpperCase(),
      carga_horaria: String(mod.carga_horaria), turma: d.turma.turma_codigo,
      periodo, frequencia: freq == null ? null : numBR(freq, 1),
      situacao_certificado: situacaoCert,
      tipo_qualificacao: rotulo.toUpperCase(),
      ato_ppc_completo: atoTexto,
      instituicao: d.instituicao.razao_social,
    });
    paginas = [{
      blocos: [
        { tipo: 'espaco', altura: 24 },
        { tipo: 'titulo', texto: 'DECLARAÇÃO DE CONCLUSÃO DE MÓDULO', subtitulo: `${rotuloNivel} — ${qualif}` },
        { tipo: 'espaco', altura: 18 },
        { tipo: 'paragrafo', texto, recuo: true, tamanho: 11.5, entrelinha: 1.8 },
        { tipo: 'espaco', altura: 10 },
        localData,
        { tipo: 'espaco', altura: 36 },
        assinaturas,
      ],
    }];
  } else {
    // Modelo aprovado (MODELOS DOCUMENTOS/09 a 11): "Histórico Escolar da Qualificação Profissional Técnica em ..."
    titulo = `Histórico escolar — ${d.nomeExibido} — ${mod.nome}`;
    if (d.avaliacao.pendente) faltantes.push('Resultados do módulo incompletos (lance todas as notas e frequências)');
    for (const [k, r] of [
      ['nome_civil', 'Nome civil'], ['cpf', 'CPF'], ['rg', 'RG'], ['rg_orgao_expedidor', 'Órgão expedidor do RG'], ['rg_uf', 'UF do RG'],
      ['data_nascimento', 'Data de nascimento'], ['naturalidade_municipio', 'Naturalidade'], ['naturalidade_uf', 'UF de naturalidade'],
      ['nome_mae', 'Nome da mãe'],
    ] as const) if (vazio(a[k])) faltantes.push(`Aluno: ${r}`);
    const perfil = mod.perfil_profissional?.trim() || d.curso.perfil_profissional_conclusao?.trim() || null;
    const competencias = (mod.competencias ?? '').split('\n').map((s) => s.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    if (!perfil) faltantes.push('Módulo: perfil profissional de conclusão não cadastrado (Cadastros → Cursos)');
    if (!competencias.length) faltantes.push('Módulo: competências não cadastradas (Cadastros → Cursos)');

    const fmtNota = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
    const chTotal = d.disciplinas.reduce((s, x) => s + x.ch, 0);
    const tituloQualif = `${rotulo} em ${qualif}`.toUpperCase();
    const registros = await registrosAproveitamento(db, a.id, d.curso.id);
    const cpf = a.cpf ? formatarCPF(a.cpf) : '—';
    const certifica = situacao === 'aprovado'
      ? `concluiu em ${pFim ? dataBR(pFim) : '____/____/______'} a ${rotulo} em ${qualif} do ${descricaoCurso(d.curso)}.`
      : situacao === 'reprovado'
        ? `cursou${periodo ? `, no período de ${periodo},` : ''} o Módulo Temático ${mod.nome} da ${rotulo} em ${qualif} do ${descricaoCurso(d.curso)}, não obtendo aprovação (RP).`
        : `está cursando o Módulo Temático ${mod.nome} da ${rotulo} em ${qualif} do ${descricaoCurso(d.curso)}.`;
    const assinaturasHist = assinaturasOficiais(d.diretor, d.secretario);
    const cargoDiretor = d.diretor?.cargo ?? 'Diretora Pedagógica';

    paginas = [
      {
        blocos: [
          { tipo: 'titulo', texto: `HISTÓRICO ESCOLAR DA ${tituloQualif}` },
          camposIdentificacao({ ...a }, d.nomeExibido),
          { tipo: 'secao', texto: 'Resultado dos estudos realizados' },
          camposCurso(d.curso),
          {
            tipo: 'tabela',
            colunas: [
              { titulo: 'Módulo temático', largura: 1.7 },
              { titulo: 'Componente curricular', largura: 5 },
              { titulo: 'CH', largura: 0.8, alinhar: 'centro' },
              { titulo: 'F', largura: 0.9, alinhar: 'centro' },
              { titulo: 'M', largura: 0.9, alinhar: 'centro' },
            ],
            linhas: [
              ...d.disciplinas.map((x, i) => [
                i === 0 ? mod.nome : '', x.nome, String(x.ch), x.frequencia == null ? '—' : numBR(x.frequencia, 1), fmtNota(x.mediaFinal),
              ]),
              ['', 'TOTAL DA CARGA HORÁRIA', String(chTotal), '', ''],
            ],
            total: ['', 'RESULTADO FINAL', '', freq == null ? '—' : numBR(freq, 1), situacao === 'aprovado' ? 'AP' : situacao === 'reprovado' ? 'RP' : '—'],
          },
          { tipo: 'paragrafo', texto: tituloQualif, negrito: true, alinhar: 'centro', tamanho: 10 },
          { tipo: 'nota', texto: 'Legenda: F = Frequência (%)   CH = Carga Horária   M = Média   AP = Aprovado   RP = Reprovado' },
          paragrafoAproveitamento(registros),
          {
            tipo: 'paragrafo', tamanho: 10.5, entrelinha: 1.5,
            texto: `A ${cargoDiretor} do ${d.instituicao.razao_social}, no uso de suas atribuições legais, de acordo com o inciso VII do Artigo 24 da Lei nº 9.394/96, certifica que ${d.nomeExibido.toUpperCase()}, CPF: ${cpf}, ${certifica}`,
          },
          localData,
          assinaturasHist,
        ],
      },
      {
        blocos: [
          { tipo: 'titulo', texto: `VERSO DO HISTÓRICO ESCOLAR DA ${tituloQualif}`, subtitulo: `${d.nomeExibido} · Módulo ${mod.ordem}: ${mod.nome}` },
          { tipo: 'secao', texto: `Perfil e competências profissionais do ${qualif}` },
          { tipo: 'paragrafo', texto: `Perfil Profissional: ${perfil ?? '[perfil profissional de conclusão não cadastrado]'}`, tamanho: 10, entrelinha: 1.45 },
          { tipo: 'paragrafo', texto: 'Competências:', negrito: true, alinhar: 'esquerda', tamanho: 10 },
          competencias.length ? { tipo: 'lista', itens: competencias, numerada: true } : { tipo: 'paragrafo', texto: '[competências não cadastradas]', tamanho: 10 },
          { tipo: 'espaco', altura: 14 },
          assinaturasHist,
        ],
      },
    ];
  }

  const layout: DocumentoLayout = {
    versao: 1,
    titulo,
    instituicao: {
      nome: String(d.instituicao.razao_social).toUpperCase(),
      enderecoLinha: linhaEndereco(d.instituicao),
      credenciamento: d.credenciamentoTexto ?? '',
      atos: d.atosCabecalho,
      logo_r2_key: d.instituicao.logo_r2_key ?? null,
    },
    paginas,
    validacao: { codigo: emissao.codigo, url: emissao.url },
  };
  const resumo: ResumoDocumento = {
    tipo,
    aluno: d.nomeExibido,
    cpf: a.cpf ?? '',
    curso: d.curso.nome,
    eixo: d.curso.eixo,
    modulo: { ordem: mod.ordem, nome: mod.nome, qualificacao: qualif, cargaHoraria: mod.carga_horaria },
    rotuloQualificacao: rotulo,
    periodo: { inicio: pIni, fim: pFim },
    dataEmissao,
    situacaoModulo: situacao,
  };
  return { tipo, dados: d, layout, resumo, faltantes, avisos };
}
