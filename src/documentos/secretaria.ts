/**
 * Documentos da Secretaria a partir dos modelos da pasta MODELOS DOCUMENTOS (PPC aprovado):
 *   01/02/06 requerimentos (formulários assinados à mão) · 03/04/05 portarias de aproveitamento ·
 *   07 guia de transferência · 08 histórico escolar do curso técnico.
 * Cada documento é montado com o motor de blocos (prévia em HTML e PDF idênticos) a partir do cadastro vivo; os registrados
 * guardam o layout inteiro no snapshot (src/documentos/emissao.ts).
 *
 * Os textos fixos dos modelos foram mantidos; as lacunas ("________") viram dados do cadastro ou campos informados na
 * emissão. O que não estiver informado num formulário sai como lacuna, para preencher à mão.
 */
import { avaliarDisciplina, avaliarModulo, criteriosDoCurso, type CriteriosAprovacao } from '../lib/aprovacao';
import { formatarCPF } from '../lib/cpf';
import { dataBR } from '../lib/datas';
import { numBR } from '../lib/form';
import { ROTULO_STATUS } from '../lib/matricula';
import {
  descreverAto, descreverPortaria, hojeMS, linhasAutorizacao, NaoEncontrado, nomeDoAluno, rotuloQualificacao, type Signatario,
} from '../certificado/dados';
import { ITEM_CATALOGO, type TipoCatalogo, type TipoDocumento, type TipoFormulario } from './catalogo';
import {
  assinaturasOficiais, camposCurso, camposIdentificacao, descricaoCurso, juntarLista, layoutComCabecalho, LINHA, localEData,
  paragrafoAproveitamento, registrosAproveitamento, tituloProfissional,
} from './comum';
import type { ResumoDocumento } from './montar';
import type { Bloco, DocumentoLayout } from './tipos';

// ------------------------------------------------------------------ entrada (tela de emissão)

/** O que vem da tela: aluno/turma escolhidos e os campos informados (texto ou lista, para as caixas de seleção). */
export interface EntradaDocumento {
  alunoId: number | null;
  turmaId: number | null;
  /** módulo do documento (matrícula em módulo, módulo cursando na transferência, módulo de classificação) */
  moduloId: number | null;
  cursoId: number | null;
  dataEmissao: string;
  campos: Record<string, string>;
  listas: Record<string, string[]>;
}

/** Lê a entrada de um URLSearchParams (GET) ou do corpo do formulário (POST). */
export function lerEntrada(fonte: Record<string, string | string[] | File | (string | File)[]>): EntradaDocumento {
  const um = (k: string) => {
    const x = fonte[k];
    const s = Array.isArray(x) ? x[0] : x;
    return typeof s === 'string' ? s.trim() : '';
  };
  const varios = (k: string) => {
    const x = fonte[k];
    return (Array.isArray(x) ? x : x == null ? [] : [x]).filter((s): s is string => typeof s === 'string' && s.trim() !== '');
  };
  const int = (k: string) => (/^\d+$/.test(um(k)) ? Number(um(k)) : null);
  const campos: Record<string, string> = {};
  for (const k of ['origem', 'origem_curso', 'origem_instituicao', 'forma', 'resp_email', 'resp_cpf', 'data', 'numero', 'obs', 'data_conclusao']) {
    if (um(k)) campos[k] = um(k);
  }
  const data = um('data_emissao');
  return {
    alunoId: int('aluno'),
    turmaId: int('turma'),
    moduloId: int('modulo'),
    cursoId: int('curso'),
    dataEmissao: /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : hojeMS(),
    campos,
    listas: { modulos: varios('modulos'), disciplinas: varios('disciplinas') },
  };
}

/** Querystring equivalente (para a prévia em iframe e os links de PDF). */
export function entradaParaQuery(e: EntradaDocumento): string {
  const p = new URLSearchParams();
  if (e.turmaId) p.set('turma', String(e.turmaId));
  if (e.alunoId) p.set('aluno', String(e.alunoId));
  if (e.moduloId) p.set('modulo', String(e.moduloId));
  if (e.cursoId) p.set('curso', String(e.cursoId));
  p.set('data_emissao', e.dataEmissao);
  for (const [k, v] of Object.entries(e.campos)) p.set(k, v);
  for (const [k, l] of Object.entries(e.listas)) for (const v of l) p.append(k, v);
  return p.toString();
}

// ------------------------------------------------------------------ contexto (dados do cadastro)

export interface ModuloCtx {
  id: number; ordem: number; nome: string; carga_horaria: number; qualificacao_conferida: string | null;
  situacao: 'planejado' | 'em_andamento' | 'concluido' | null; data_inicio: string | null; data_fim: string | null;
}
export interface ComponenteCtx {
  id: number; modulo_id: number | null; tipo: string; ordem: number; nome: string; ch: number; cht: number | null; chp: number | null;
}

export interface ContextoDocumento {
  aluno: Record<string, any>;
  nome: string;
  matricula: { id: number; turma_id: number; turma_codigo: string; status: string; situacao: string; data_conclusao: string | null } | null;
  /** turmas em que o aluno está matriculado (para escolher) */
  matriculas: { id: number; turma_id: number; turma_codigo: string; curso_id: number; status: string }[];
  curso: Record<string, any>;
  instituicao: Record<string, any>;
  cabecalho: { credenciamento: string | null; atos: string[] };
  atoPpc: Record<string, any> | null;
  diretor: Signatario | null;
  secretario: Signatario | null;
  criterios: CriteriosAprovacao;
  modulos: ModuloCtx[];
  componentes: ComponenteCtx[];
  resultados: Map<number, Record<string, any>>;
  transferencia: { data: string; motivo: string | null } | null;
  avisos: string[];
}

export class SemAluno extends Error {}

/** @param matriculaPadrao sem turma escolhida, usa a matrícula mais recente do aluno (documentos por aluno). */
export async function carregarContexto(db: D1Database, e: EntradaDocumento, matriculaPadrao = false): Promise<ContextoDocumento> {
  if (!e.alunoId) throw new SemAluno('Selecione o aluno.');
  const aluno = await db.prepare('SELECT * FROM alunos WHERE id = ?').bind(e.alunoId).first<Record<string, any>>();
  if (!aluno) throw new NaoEncontrado('Aluno não encontrado');
  const matriculas = (await db.prepare(
    `SELECT m.id, m.turma_id, t.codigo AS turma_codigo, t.curso_id, m.status, m.situacao, m.data_conclusao, t.matriz_id
       FROM matriculas m JOIN turmas t ON t.id = m.turma_id WHERE m.aluno_id = ? ORDER BY t.data_inicio DESC, m.id DESC`,
  ).bind(aluno.id).all<Record<string, any>>()).results;
  const mat = e.turmaId ? matriculas.find((m) => m.turma_id === e.turmaId) ?? null : matriculaPadrao ? matriculas[0] ?? null : null;
  const cursoId = mat?.curso_id ?? e.cursoId ?? matriculas[0]?.curso_id
    ?? (await db.prepare('SELECT id FROM cursos WHERE ativo = 1 ORDER BY id LIMIT 1').first<{ id: number }>())?.id;
  if (!cursoId) throw new NaoEncontrado('Nenhum curso cadastrado');
  const matrizId = mat?.matriz_id ?? (await db.prepare('SELECT id FROM matrizes_curriculares WHERE curso_id = ? ORDER BY versao DESC LIMIT 1')
    .bind(cursoId).first<{ id: number }>())?.id ?? 0;

  const [curso, instituicao, credenciamento, atoPpc, signatarios, modulos, componentes, resultados, transf] = await Promise.all([
    db.prepare('SELECT cu.*, e.nome AS eixo FROM cursos cu LEFT JOIN eixos_tecnologicos e ON e.id = cu.eixo_id WHERE cu.id = ?').bind(cursoId).first<Record<string, any>>(),
    db.prepare('SELECT * FROM instituicoes WHERE id = (SELECT instituicao_id FROM cursos WHERE id = ?)').bind(cursoId).first<Record<string, any>>(),
    db.prepare(`SELECT * FROM atos_regulatorios WHERE finalidade = 'credenciamento' AND ativo = 1
                 AND instituicao_id = (SELECT instituicao_id FROM cursos WHERE id = ?) ORDER BY data DESC LIMIT 1`).bind(cursoId).first<Record<string, any>>(),
    db.prepare(`SELECT * FROM atos_regulatorios WHERE finalidade = 'autorizacao_curso' AND ativo = 1 AND curso_id = ? ORDER BY data DESC LIMIT 1`)
      .bind(cursoId).first<Record<string, any>>(),
    db.prepare(`SELECT nome, cargo, funcao, assinatura_r2_key, portaria_tipo, portaria_numero, portaria_data FROM signatarios
                 WHERE ativo = 1 AND funcao IN ('diretor_pedagogico','secretario')`).all<Record<string, any>>(),
    db.prepare(
      `SELECT mt.id, mt.ordem, mt.nome, mt.carga_horaria, mt.qualificacao_conferida, tm.situacao, tm.data_inicio, tm.data_fim
         FROM modulos_tematicos mt LEFT JOIN turma_modulos tm ON tm.modulo_id = mt.id AND tm.turma_id = ?
        WHERE mt.matriz_id = ? ORDER BY mt.ordem`,
    ).bind(mat?.turma_id ?? 0, matrizId).all<ModuloCtx>(),
    db.prepare(
      `SELECT cc.id, cc.modulo_id, cc.tipo, cc.ordem, cc.nome, cc.carga_horaria_total AS ch, cc.carga_horaria_teorica AS cht, cc.carga_horaria_pratica AS chp
         FROM componentes_curriculares cc LEFT JOIN modulos_tematicos mt ON mt.id = cc.modulo_id
        WHERE cc.matriz_id = ? ORDER BY cc.modulo_id IS NULL, mt.ordem, cc.ordem`,
    ).bind(matrizId).all<ComponenteCtx>(),
    db.prepare('SELECT * FROM resultados WHERE matricula_id = ?').bind(mat?.id ?? 0).all<Record<string, any>>(),
    db.prepare(`SELECT data, motivo FROM matricula_status_historico WHERE matricula_id = ? AND status_novo = 'transferido' ORDER BY id DESC LIMIT 1`)
      .bind(mat?.id ?? 0).first<{ data: string; motivo: string | null }>(),
  ]);
  if (!curso || !instituicao) throw new NaoEncontrado('Curso ou instituição não encontrados');
  const sig = (f: string): Signatario | null => {
    const s = signatarios.results.find((x) => x.funcao === f);
    return s ? { nome: s.nome, cargo: s.cargo, assinatura_r2_key: s.assinatura_r2_key, portaria: descreverPortaria(s) } : null;
  };
  const avisos: string[] = [];
  const atos = [...linhasAutorizacao(instituicao.texto_atos), ...linhasAutorizacao(curso.texto_autorizacao)];
  if (!atos.length) avisos.push('Atos da instituição e do curso não preenchidos: o cabeçalho sairá sem eles.');
  return {
    aluno,
    nome: nomeDoAluno(aluno),
    matricula: mat ? { id: mat.id, turma_id: mat.turma_id, turma_codigo: mat.turma_codigo, status: mat.status, situacao: mat.situacao, data_conclusao: mat.data_conclusao } : null,
    matriculas: matriculas.map((m) => ({ id: m.id, turma_id: m.turma_id, turma_codigo: m.turma_codigo, curso_id: m.curso_id, status: m.status })),
    curso,
    instituicao,
    cabecalho: {
      credenciamento: credenciamento ? `Credenciamento ${descreverAto(credenciamento)}` : null,
      atos,
    },
    atoPpc: atoPpc ?? null,
    diretor: sig('diretor_pedagogico'),
    secretario: sig('secretario'),
    criterios: criteriosDoCurso(curso as any),
    modulos: modulos.results,
    componentes: componentes.results,
    resultados: new Map(resultados.results.map((r) => [r.componente_id as number, r])),
    transferencia: transf ?? null,
    avisos,
  };
}

// ------------------------------------------------------------------ resultado da montagem

export interface DocumentoSecretaria {
  tipo: TipoCatalogo;
  ctx: ContextoDocumento;
  layout: DocumentoLayout;
  /** só nos registrados */
  resumo: ResumoDocumento | null;
  /** referências do registro (nº da portaria, módulo) */
  refs: { moduloId: number | null; numero: string | null };
  faltantes: string[];
  avisos: string[];
}

const vazio = (v: unknown) => v == null || String(v).trim() === '';
/** Espaços não separáveis: a quebra de linha junta espaços comuns, e as caixas "(   )" precisam ficar como no modelo. */
const NB = '\u00A0';
const CAIXA = `(${NB}${NB}${NB}${NB})`;
const marca = (sim: boolean) => (sim ? `(${NB}X${NB})` : CAIXA);
const DEFERIMENTO = (a: string, b: string) => `${CAIXA} ${a}${NB.repeat(12)}${CAIXA} ${b}`;

/** Próximo nº de portaria do ano ("004/2026"), a partir das já registradas — sugestão editável na tela. */
export async function proximoNumeroPortaria(db: D1Database, ano: number): Promise<string> {
  const r = await db.prepare(`SELECT numero FROM documentos WHERE numero LIKE ?`).bind(`%/${ano}`).all<{ numero: string }>();
  const max = r.results.reduce((m, x) => Math.max(m, Number.parseInt(x.numero, 10) || 0), 0);
  return `${String(max + 1).padStart(3, '0')}/${ano}`;
}

function avaliar(ctx: ContextoDocumento, comps: ComponenteCtx[]) {
  return avaliarModulo(comps.map((c) => c.nome), comps.map((c) => {
    const r = ctx.resultados.get(c.id);
    return { componente: c.nome, nota: r?.nota ?? null, notaExameFinal: r?.nota_exame_final ?? null, frequencia: r?.frequencia ?? null, aproveitada: !!r?.aproveitado_de_resultado_id };
  }), ctx.criterios);
}

const fmtNota = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
const fmtFreq = (n: number | null | undefined) => (n == null ? '—' : numBR(n, 1));

/** Frequência do módulo ponderada pela carga horária das disciplinas com frequência lançada. */
function frequenciaPonderada(ctx: ContextoDocumento, comps: ComponenteCtx[]): number | null {
  const com = comps.filter((c) => ctx.resultados.get(c.id)?.frequencia != null);
  if (!com.length) return null;
  const ch = com.reduce((a, c) => a + c.ch, 0);
  return com.reduce((a, c) => a + ctx.resultados.get(c.id)!.frequencia * c.ch, 0) / ch;
}

function exigirSignatarios(ctx: ContextoDocumento, faltantes: string[], quem: ('diretor' | 'secretario')[]) {
  if (quem.includes('diretor') && (!ctx.diretor || ctx.diretor.nome.includes('A DEFINIR'))) faltantes.push('Signatário: Diretor(a) Pedagógico(a) não cadastrado');
  if (quem.includes('secretario') && (!ctx.secretario || ctx.secretario.nome.includes('A DEFINIR'))) faltantes.push('Signatário: Secretário(a) não cadastrado');
}

function exigirAluno(ctx: ContextoDocumento, faltantes: string[], campos: [string, string][]) {
  for (const [k, r] of campos) if (vazio(ctx.aluno[k])) faltantes.push(`Aluno: ${r}`);
}

const ATO_PPC = (ctx: ContextoDocumento) => (ctx.atoPpc ? descreverAto(ctx.atoPpc) : LINHA);
const cargoDiretor = (ctx: ContextoDocumento) => ctx.diretor?.cargo || 'Diretora Pedagógica';

/** Abertura das portarias (modelo 03 a 05). */
function aberturaPortaria(ctx: ContextoDocumento): string {
  const i = ctx.instituicao;
  return `A ${cargoDiretor(ctx)} do ${i.razao_social}, sediado na ${i.endereco}, ${i.bairro}, ${i.municipio} - ${i.uf}, no uso de suas atribuições legais, ` +
    `e considerando o disposto na Lei nº 9.394/96 e no Projeto Pedagógico do Curso aprovado pela ${ATO_PPC(ctx)},`;
}

// ------------------------------------------------------------------ montagem por tipo

export async function montarDocumentoSecretaria(
  db: D1Database,
  tipo: Exclude<TipoCatalogo, 'declaracao_conclusao_modulo' | 'historico_escolar'>,
  e: EntradaDocumento,
  emissao: { codigo: string | null; url: string | null; usuario: string; quando: string },
): Promise<DocumentoSecretaria> {
  const item = ITEM_CATALOGO[tipo];
  const ctx = await carregarContexto(db, e, item.contexto === 'aluno');
  const faltantes: string[] = [];
  const avisos = [...ctx.avisos];
  const a = ctx.aluno;
  const NOME = ctx.nome.toUpperCase();
  const curso = ctx.curso;
  const desc = descricaoCurso(curso);
  const local = `${ctx.instituicao.municipio}/${ctx.instituicao.uf}`;
  const modulo = (id: number | null) => ctx.modulos.find((m) => m.id === id) ?? null;
  const compsDo = (moduloId: number | null) => ctx.componentes.filter((c) => c.modulo_id === moduloId && c.tipo === 'disciplina');
  const foraDosModulos = ctx.componentes.filter((c) => c.modulo_id == null);
  if (!ctx.atoPpc) faltantes.push('Curso: ato de aprovação do PPC / autorização (Cadastros → Cursos e Matrizes)');
  if (item.contexto === 'matricula' && !ctx.matricula) faltantes.push('Selecione a turma do aluno (o documento usa a matrícula e os resultados da turma).');

  let paginas: DocumentoLayout['paginas'] = [];
  let moduloRef: number | null = null;
  let numero: string | null = null;
  const itensResumo: [string, string][] = [];
  let registro: string | undefined;

  switch (tipo) {
    // ---------------------------------------------------------------- 01 e 02: requerimentos de aproveitamento
    case 'requerimento_aproveitamento_estudos':
    case 'requerimento_aproveitamento_conhecimentos': {
      const estudos = tipo === 'requerimento_aproveitamento_estudos';
      const origem = e.campos.origem || LINHA + LINHA;
      const forma = e.campos.forma;
      const pedido = estudos
        ? `venho requerer de Vossa Senhoria, por meio da análise documental ${marca(forma === 'analise')} avaliação ${marca(forma === 'avaliacao')}, aproveitamento de estudos concluídos com êxito no ${origem}`
        : `venho requerer de Vossa Senhoria, por meio de avaliação, aproveitamento de conhecimentos e experiências anteriores concluídos com êxito no ${origem}`;
      paginas = [{
        blocos: [
          { tipo: 'espaco', altura: 10 },
          { tipo: 'titulo', texto: estudos ? 'REQUERIMENTO DE APROVEITAMENTO DE ESTUDOS' : 'REQUERIMENTO DE APROVEITAMENTO DE CONHECIMENTOS E EXPERIÊNCIAS ANTERIORES' },
          { tipo: 'espaco', altura: 14 },
          { tipo: 'paragrafo', texto: `Senhora ${cargoDiretor(ctx)},`, alinhar: 'esquerda', tamanho: 11.5 },
          {
            tipo: 'paragrafo', recuo: true, tamanho: 11.5, entrelinha: 1.8,
            texto: `Eu, ${NOME}, ${pedido}, para o ${desc}, conforme o disposto no Projeto Pedagógico de Curso aprovado pela ${ATO_PPC(ctx)}.`,
          },
          { tipo: 'paragrafo', texto: 'Nestes Termos\nP. Deferimento', alinhar: 'esquerda', tamanho: 11.5 },
          localEData(local, e.campos.data ?? null),
          { tipo: 'espaco', altura: 8 },
          { tipo: 'assinaturas', itens: [{ legenda: 'Assinatura do(a) interessado(a)', nome: ctx.nome }] },
          { tipo: 'espaco', altura: 22 },
          { tipo: 'secao', texto: 'Parecer da Direção' },
          { tipo: 'paragrafo', texto: DEFERIMENTO('DEFIRO', 'INDEFIRO'), negrito: true, alinhar: 'esquerda', tamanho: 11 },
          localEData(local, null),
          { tipo: 'espaco', altura: 8 },
          { tipo: 'assinaturas', itens: [{ legenda: cargoDiretor(ctx), nome: ctx.diretor?.nome ?? null, detalhe: ctx.diretor?.portaria ?? null }] },
        ],
      }];
      break;
    }

    // ---------------------------------------------------------------- 06: requerimento de matrícula
    case 'requerimento_matricula': {
      const mod = modulo(e.moduloId) ?? ctx.modulos.find((m) => m.situacao === 'em_andamento') ?? ctx.modulos[0] ?? null;
      moduloRef = mod?.id ?? null;
      const rg = vazio(a.rg) ? null : `${a.rg}${a.rg_orgao_expedidor ? ` ${a.rg_orgao_expedidor}` : ''}${a.rg_uf ? `-${a.rg_uf}` : ''}`;
      const endereco = [a.endereco, a.complemento, a.bairro].filter((x) => !vazio(x)).join(', ') || null;
      const nee = String(a.necessidades_especificas ?? '').trim();
      const semNee = /^(n[aã]o|nenhum[a]?|-|n\/a)$/i.test(nee);
      const neeTexto = !nee ? `${CAIXA} SIM  Qual: ____________   ${CAIXA} NÃO` : semNee ? `${CAIXA} SIM   ${marca(true)} NÃO` : `${marca(true)} SIM  Qual: ${nee}   ${CAIXA} NÃO`;
      paginas = [{
        blocos: [
          { tipo: 'titulo', texto: 'REQUERIMENTO DE MATRÍCULA' },
          { tipo: 'paragrafo', texto: `Ilma. Senhora ${cargoDiretor(ctx)} do ${ctx.instituicao.razao_social}`, alinhar: 'esquerda', tamanho: 10.5 },
          {
            tipo: 'campos', itens: ([
              { rotulo: 'Estudante', valor: NOME, span: 4 },
              { rotulo: 'RG', valor: rg },
              { rotulo: 'Data de nascimento', valor: vazio(a.data_nascimento) ? null : dataBR(a.data_nascimento) },
              { rotulo: 'Local', valor: a.naturalidade_municipio ?? null },
              { rotulo: 'Estado', valor: a.naturalidade_uf ?? null },
              { rotulo: 'Pai', valor: a.nome_pai ?? null, span: 2 },
              { rotulo: 'Mãe', valor: a.nome_mae ?? null, span: 2 },
              { rotulo: 'Endereço', valor: endereco, span: 4 },
              { rotulo: 'Município', valor: a.endereco_municipio ?? null },
              { rotulo: 'Estado', valor: a.endereco_uf ?? null },
              { rotulo: 'CEP', valor: a.cep ?? null },
              { rotulo: 'Telefone', valor: a.celular || a.telefone || null },
              { rotulo: 'Cor/Raça', valor: a.cor_raca ?? null, span: 2 },
              { rotulo: 'CPF', valor: vazio(a.cpf) ? null : formatarCPF(a.cpf), span: 2 },
              { rotulo: 'E-mail', valor: a.email ?? null, span: 2 },
              { rotulo: 'Deficiência, TGD, altas habilidades ou superdotação?', valor: neeTexto, span: 2 },
              { rotulo: 'E-mail (responsável)', valor: e.campos.resp_email ?? '', span: 2 },
              { rotulo: 'CPF (responsável)', valor: e.campos.resp_cpf ?? '', span: 2 },
            ] as { rotulo: string; valor: string | null; span?: 1 | 2 | 3 | 4 }[]).map((x) => ({ ...x, valor: x.valor ?? '' })),
          },
          {
            tipo: 'paragrafo', recuo: true, tamanho: 10.5,
            texto: `Anexando ao presente os documentos exigidos no Projeto Pedagógico de Curso, vem requerer sua matrícula no módulo temático ${mod ? mod.nome.toUpperCase() : LINHA} do ${desc}.`,
          },
          {
            tipo: 'paragrafo', recuo: true, tamanho: 10.5,
            texto: `O requerente declara estar ciente de que a comprovação de conclusão do ensino médio e o cumprimento da totalidade da carga horária do Curso são condições indispensáveis para obtenção do diploma do ${curso.nome}. ` +
              `Declara ainda aceitar, de livre e espontânea vontade, as disposições das Normas de Convivência expressas no Regimento Escolar e no Projeto Pedagógico de Curso, e os procedimentos financeiros que regularão seu vínculo com o ${ctx.instituicao.razao_social}.`,
          },
          localEData(local, e.campos.data ?? null),
          { tipo: 'assinaturas', itens: [{ legenda: 'Estudante', nome: ctx.nome }, { legenda: 'Funcionário(a) responsável' }] },
          { tipo: 'espaco', altura: 6 },
          { tipo: 'paragrafo', texto: DEFERIMENTO('Defiro', 'Indefiro'), negrito: true, alinhar: 'esquerda', tamanho: 11 },
          { tipo: 'assinaturas', itens: [{ legenda: cargoDiretor(ctx), nome: ctx.diretor?.nome ?? null, detalhe: ctx.diretor?.portaria ?? null }] },
        ],
      }];
      break;
    }

    // ---------------------------------------------------------------- 03, 04 e 05: portarias
    case 'portaria_aproveitamento_conhecimentos':
    case 'portaria_aproveitamento_modulos':
    case 'portaria_aproveitamento_disciplinas': {
      numero = e.campos.numero || null;
      if (!numero) faltantes.push('Informe o nº da portaria.');
      else if (!/^\d{1,4}\/\d{4}$/.test(numero)) faltantes.push('Nº da portaria no formato 001/2026.');
      exigirSignatarios(ctx, faltantes, ['diretor']);
      exigirAluno(ctx, faltantes, [['nome_civil', 'Nome civil'], ['cpf', 'CPF']]);
      const classif = modulo(e.moduloId);
      moduloRef = classif?.id ?? null;
      let art1: string;
      let art2: string;
      if (tipo === 'portaria_aproveitamento_conhecimentos') {
        if (!e.campos.origem) faltantes.push('Informe onde os conhecimentos e experiências foram adquiridos.');
        art1 = `Art. 1º Aproveitar os conhecimentos e experiências adquiridos por ${NOME} no ${e.campos.origem ?? LINHA}, tendo em vista os resultados obtidos nas avaliações realizadas pela equipe técnico-pedagógica desta instituição de ensino.`;
        art2 = `Art. 2º Classificar o estudante ${classif ? `no módulo temático ${classif.nome.toUpperCase()} do` : 'no'} ${desc}.`;
        registro = `aproveitamento de conhecimentos e experiências (${e.campos.origem ?? ''})`;
      } else {
        if (!classif) faltantes.push('Escolha o módulo em que o estudante será classificado.');
        if (!e.campos.origem_curso) faltantes.push('Informe o curso em que os estudos foram concluídos.');
        if (!e.campos.origem_instituicao) faltantes.push('Informe a instituição de ensino de origem.');
        const origem = `no ${e.campos.origem_curso ?? LINHA}, na instituição de ensino denominada ${e.campos.origem_instituicao ?? LINHA}`;
        if (tipo === 'portaria_aproveitamento_modulos') {
          const mods = ctx.modulos.filter((m) => e.listas.modulos.includes(String(m.id)));
          if (!mods.length) faltantes.push('Marque o(s) módulo(s) aproveitado(s).');
          if (classif && mods.some((m) => m.id === classif.id)) faltantes.push('O módulo de classificação não pode ser um dos módulos aproveitados.');
          const nomes = juntarLista(mods.map((m) => m.nome));
          art1 = `Art. 1º Aproveitar os estudos de ${NOME}, realizados com êxito no(s) módulo(s) ${nomes || LINHA}, concluído(s) com êxito ${origem}, em conformidade com a análise da ementa curricular apresentada, realizada pela equipe técnico-pedagógica desta instituição de ensino.`;
          art2 = `Art. 2º Classificar o estudante em referência no Art. 1º para o módulo ${classif ? classif.nome.toUpperCase() : LINHA} do ${desc}.`;
          registro = `aproveitamento de estudos — módulo(s) ${nomes}`;
          itensResumo.push(['Módulo(s) aproveitado(s)', nomes]);
        } else {
          const discs = ctx.componentes.filter((c) => e.listas.disciplinas.includes(String(c.id)));
          if (!discs.length) faltantes.push('Marque a(s) disciplina(s) aproveitada(s).');
          const nomes = juntarLista(discs.map((c) => c.nome));
          art1 = `Art. 1º Aproveitar os estudos de ${NOME}, referentes às disciplinas ${nomes || LINHA}, concluída(s) com êxito ${origem}, tendo em vista os resultados obtidos nas avaliações realizadas pela equipe técnico-pedagógica desta instituição de ensino.`;
          art2 = `Art. 2º Classificar o estudante para o módulo temático ${classif ? classif.nome.toUpperCase() : LINHA} do ${desc}, dispensando-o de cursar as disciplinas constantes do Art. 1º.`;
          registro = `aproveitamento de estudos — disciplina(s) ${nomes}`;
          itensResumo.push(['Disciplina(s) aproveitada(s)', nomes]);
        }
      }
      const dataPortaria = (() => { try { return dataBR(e.dataEmissao); } catch { return ''; } })();
      registro = `Portaria nº ${numero ?? '___'}, de ${dataPortaria}: ${registro}`;
      if (classif) itensResumo.push(['Classificação', `Módulo ${classif.ordem} — ${classif.nome}`]);
      paginas = [{
        blocos: [
          { tipo: 'espaco', altura: 10 },
          { tipo: 'titulo', texto: `PORTARIA Nº ${numero ?? '____/____'}`, subtitulo: item.rotulo.replace(/^Portaria de /, '') },
          { tipo: 'espaco', altura: 12 },
          { tipo: 'paragrafo', texto: aberturaPortaria(ctx), recuo: true, tamanho: 11, entrelinha: 1.6 },
          { tipo: 'paragrafo', texto: 'RESOLVE:', negrito: true, alinhar: 'esquerda', tamanho: 11 },
          { tipo: 'paragrafo', texto: art1, recuo: true, tamanho: 11, entrelinha: 1.6 },
          { tipo: 'paragrafo', texto: art2, recuo: true, tamanho: 11, entrelinha: 1.6 },
          {
            tipo: 'paragrafo', recuo: true, tamanho: 11, entrelinha: 1.6,
            texto: `Art. 3º Determinar o registro da presente Portaria no Histórico Escolar do ${desc} e demais documentos da vida escolar do estudante.`,
          },
          { tipo: 'paragrafo', texto: 'Art. 4º Esta Portaria entrará em vigor na data de sua aprovação.', recuo: true, tamanho: 11, entrelinha: 1.6 },
          { tipo: 'espaco', altura: 6 },
          localEData(local, e.dataEmissao),
          { tipo: 'espaco', altura: 12 },
          { tipo: 'assinaturas', itens: [{ legenda: cargoDiretor(ctx), nome: ctx.diretor?.nome ?? null, assinatura_r2_key: ctx.diretor?.assinatura_r2_key ?? null, detalhe: ctx.diretor?.portaria ?? null }] },
        ],
      }];
      break;
    }

    // ---------------------------------------------------------------- 07: guia de transferência
    case 'guia_transferencia': {
      exigirSignatarios(ctx, faltantes, ['diretor', 'secretario']);
      exigirAluno(ctx, faltantes, [['nome_civil', 'Nome civil'], ['cpf', 'CPF'], ['rg', 'RG'], ['data_nascimento', 'Data de nascimento']]);
      if (ctx.matricula && ctx.matricula.status !== 'transferido') {
        faltantes.push(`A matrícula está como "${ROTULO_STATUS[ctx.matricula.status] ?? ctx.matricula.status}": altere o status para Transferido (Turma → Status), com a data e o motivo.`);
      }
      const dataT = ctx.transferencia?.data ?? null;
      const cursando = modulo(e.moduloId)
        ?? ctx.modulos.find((m) => m.situacao === 'em_andamento')
        ?? ctx.modulos.find((m) => m.situacao !== 'concluido')
        ?? null;
      moduloRef = cursando?.id ?? null;
      if (!cursando) faltantes.push('Escolha o módulo que o estudante estava cursando.');

      const linhas: (string | null)[][] = [];
      for (const m of ctx.modulos) {
        const comps = compsDo(m.id);
        const comResultado = m.situacao === 'concluido' && m.id !== cursando?.id;
        const av = comResultado ? avaliar(ctx, comps) : null;
        comps.forEach((c, i) => linhas.push([
          i === 0 ? m.nome : '', c.nome, String(c.ch),
          comResultado ? fmtFreq(ctx.resultados.get(c.id)?.frequencia) : '',
          comResultado ? fmtNota(av!.disciplinas[i].mediaFinal) : '',
        ]));
        linhas.push(['CARGA HORÁRIA DO MÓDULO', null, String(m.carga_horaria), '', '']);
      }
      for (const c of foraDosModulos) linhas.push([c.nome, null, String(c.ch), '', '']);
      const total = ctx.modulos.reduce((s, m) => s + m.carga_horaria, 0) + foraDosModulos.reduce((s, c) => s + c.ch, 0);
      const parciais = compsDo(cursando?.id ?? null);
      const obs = e.campos.obs ?? ctx.transferencia?.motivo ?? '';
      itensResumo.push(['Transferência', dataT ? dataBR(dataT) : '—']);
      if (cursando) itensResumo.push(['Módulo em curso', `Módulo ${cursando.ordem} — ${cursando.nome}`]);
      paginas = [
        {
          blocos: [
            { tipo: 'titulo', texto: 'GUIA DE TRANSFERÊNCIA' },
            camposIdentificacao(a, ctx.nome, true),
            { tipo: 'secao', texto: 'Resultado dos estudos realizados' },
            camposCurso(curso, true),
            {
              tipo: 'tabela',
              colunas: [
                { titulo: 'Módulo temático', largura: 1.5 }, { titulo: 'Disciplinas', largura: 6.3 },
                { titulo: 'CH', largura: 0.65, alinhar: 'centro' }, { titulo: 'F', largura: 0.75, alinhar: 'centro' }, { titulo: 'M', largura: 0.75, alinhar: 'centro' },
              ],
              linhas, compacta: true,
              total: [`TOTAL DA CARGA HORÁRIA DO ${String(curso.nome).toUpperCase()} - EIXO TECNOLÓGICO: ${String(curso.eixo ?? '').toUpperCase()} - ${String(curso.nivel ?? '').toUpperCase()}`, null, String(total), '', ''],
            },
            { tipo: 'nota', texto: 'Legenda: CH = Carga Horária   F = Frequência (%)   M = Média. Resultados dos módulos concluídos; o módulo em curso está no verso.' },
            {
              tipo: 'paragrafo', tamanho: 9.5, entrelinha: 1.35,
              texto: `A ${cargoDiretor(ctx)} do ${ctx.instituicao.razao_social}, no uso de suas atribuições legais, de acordo com o inciso VII do Artigo 24 da Lei nº 9.394/96, certifica que ${NOME}, CPF: ${vazio(a.cpf) ? LINHA : formatarCPF(a.cpf)}, em ${dataT ? dataBR(dataT) : '____/____/______'} foi considerado(a) TRANSFERIDO(A) cursando o Módulo ${cursando ? `${cursando.ordem} — ${cursando.nome}` : '____'} do ${desc}. (vide verso)`,
            },
            localEData(local, e.dataEmissao),
            assinaturasOficiais(ctx.diretor, ctx.secretario),
          ],
        },
        {
          blocos: [
            { tipo: 'titulo', texto: 'VERSO DA GUIA DE TRANSFERÊNCIA', subtitulo: `DADOS PARCIAIS PARA FINS DE TRANSFERÊNCIA DO MÓDULO TEMÁTICO ${cursando ? `${cursando.ordem} — ${cursando.nome.toUpperCase()}` : '____'} EM CURSO` },
            {
              tipo: 'tabela',
              colunas: [
                { titulo: 'Componentes curriculares', largura: 5 }, { titulo: 'Carga horária (teórica/prática)', largura: 1.8, alinhar: 'centro' },
                { titulo: 'Faltas', largura: 1, alinhar: 'centro' }, { titulo: 'Notas/Médias', largura: 1.2, alinhar: 'centro' },
              ],
              linhas: parciais.map((c) => {
                const r = ctx.resultados.get(c.id);
                const ch = c.cht != null || c.chp != null ? `${c.cht ?? 0}/${c.chp ?? 0} (${c.ch} h)` : `${c.ch} h`;
                return [c.nome, ch, r?.faltas == null ? '—' : String(r.faltas), fmtNota(r?.nota)];
              }),
              total: ['Carga horária do módulo', `${cursando?.carga_horaria ?? ''} h`, '', ''],
            },
            { tipo: 'nota', texto: 'Faltas em número de aulas. Notas lançadas até a data da transferência.' },
            { tipo: 'paragrafo', texto: `OBS: ${obs || LINHA + LINHA + LINHA}`, alinhar: 'esquerda', tamanho: 10, entrelinha: 1.7 },
            { tipo: 'espaco', altura: 10 },
            assinaturasOficiais(ctx.diretor, ctx.secretario),
          ],
        },
      ];
      break;
    }

    // ---------------------------------------------------------------- 08: histórico escolar do curso técnico
    case 'historico_curso_tecnico': {
      exigirSignatarios(ctx, faltantes, ['diretor', 'secretario']);
      exigirAluno(ctx, faltantes, [
        ['nome_civil', 'Nome civil'], ['cpf', 'CPF'], ['rg', 'RG'], ['data_nascimento', 'Data de nascimento'],
        ['naturalidade_municipio', 'Naturalidade'], ['naturalidade_uf', 'UF de naturalidade'], ['nome_mae', 'Nome da mãe'],
        ['ensino_medio_instituicao', 'Ensino médio: instituição (exigido para o diploma)'], ['ensino_medio_ano_conclusao', 'Ensino médio: ano de conclusão'],
      ]);
      const rotulo = rotuloQualificacao(curso.tipo);
      const linhas: (string | null)[][] = [];
      for (const m of ctx.modulos) {
        const comps = compsDo(m.id);
        const av = avaliar(ctx, comps);
        if (!av.aprovado) faltantes.push(`Módulo ${m.ordem} — ${m.nome}: ${av.pendente && !av.disciplinas.some((x) => x.resultado === 'RP') ? 'resultados incompletos' : 'estudante não aprovado'}`);
        comps.forEach((c, i) => linhas.push([
          i === 0 ? m.nome : '', c.nome, String(c.ch), fmtFreq(ctx.resultados.get(c.id)?.frequencia), fmtNota(av.disciplinas[i].mediaFinal),
        ]));
        const fm = frequenciaPonderada(ctx, comps);
        linhas.push(['', 'RESULTADO FINAL', '', fmtFreq(fm), av.aprovado ? 'AP' : av.pendente && !av.disciplinas.some((x) => x.resultado === 'RP') ? '—' : 'RP']);
        linhas.push([`CARGA HORÁRIA DA ${rotulo.toUpperCase()} EM ${String(m.qualificacao_conferida ?? m.nome).toUpperCase()}`, null, String(m.carga_horaria), '', '']);
      }
      for (const c of foraDosModulos) {
        const r = ctx.resultados.get(c.id);
        const av = avaliarDisciplina({ componente: c.nome, nota: r?.nota ?? null, notaExameFinal: r?.nota_exame_final ?? null, frequencia: r?.frequencia ?? null }, ctx.criterios);
        if (av.resultado !== 'AP') faltantes.push(`${c.nome}: ${av.resultado === 'PENDENTE' ? 'resultado não lançado' : 'estudante não aprovado'}`);
        linhas.push([c.nome, null, String(c.ch), fmtFreq(r?.frequencia), av.resultado === 'PENDENTE' ? '—' : fmtNota(av.mediaFinal)]);
      }
      const total = ctx.modulos.reduce((s, m) => s + m.carga_horaria, 0) + foraDosModulos.reduce((s, c) => s + c.ch, 0);
      if (curso.carga_horaria_total && total !== curso.carga_horaria_total) faltantes.push(`Matriz: os componentes somam ${total} h, mas o curso tem ${curso.carga_horaria_total} h`);
      const ultimoFim = ctx.modulos.map((m) => m.data_fim).filter(Boolean).sort().at(-1) ?? null;
      const conclusao = e.campos.data_conclusao ?? ctx.matricula?.data_conclusao ?? ultimoFim;
      if (!conclusao) faltantes.push('Informe a data de conclusão do curso.');
      const perfil = String(curso.perfil_profissional_conclusao ?? '').trim();
      if (!perfil) faltantes.push('Curso: perfil profissional de conclusão não cadastrado (Cadastros → Cursos e Matrizes)');
      const registros = await registrosAproveitamento(db, a.id, curso.id);
      itensResumo.push(['Conclusão do curso', conclusao ? dataBR(conclusao) : '—'], ['Carga horária', `${total} horas`]);
      paginas = [
        {
          blocos: [
            { tipo: 'titulo', texto: 'HISTÓRICO ESCOLAR' },
            camposIdentificacao(a, ctx.nome, true),
            { tipo: 'secao', texto: 'Resultado dos estudos realizados' },
            camposCurso(curso, true),
            {
              tipo: 'tabela',
              colunas: [
                { titulo: 'Módulo temático', largura: 1.5 }, { titulo: 'Componente curricular', largura: 6.3 },
                { titulo: 'CH', largura: 0.65, alinhar: 'centro' }, { titulo: 'F', largura: 0.75, alinhar: 'centro' }, { titulo: 'M', largura: 0.75, alinhar: 'centro' },
              ],
              linhas, compacta: true,
              total: [`TOTAL DA CARGA HORÁRIA DO ${String(curso.nome).toUpperCase()} - EIXO TECNOLÓGICO: ${String(curso.eixo ?? '').toUpperCase()} - ${String(curso.nivel ?? '').toUpperCase()}`, null, String(total), '', ''],
            },
            { tipo: 'nota', texto: 'Legenda: F = Frequência (%)   CH = Carga Horária   M = Média   AP = Aprovado   RP = Reprovado' },
            paragrafoAproveitamento(registros),
            {
              tipo: 'paragrafo', tamanho: 9.5, entrelinha: 1.35,
              texto: `A ${cargoDiretor(ctx)} do ${ctx.instituicao.razao_social}, no uso de suas atribuições legais, de acordo com o inciso VII do Artigo 24 da Lei nº 9.394/96, certifica que ${NOME}, CPF: ${vazio(a.cpf) ? LINHA : formatarCPF(a.cpf)}, concluiu em ${conclusao ? dataBR(conclusao) : '____/____/______'} o ${desc}.`,
            },
            localEData(local, e.dataEmissao),
            assinaturasOficiais(ctx.diretor, ctx.secretario),
          ],
        },
        {
          blocos: [
            { tipo: 'titulo', texto: 'HISTÓRICO ESCOLAR — VERSO', subtitulo: ctx.nome },
            { tipo: 'secao', texto: `Perfil e competências profissionais do ${tituloProfissional(curso.nome)}` },
            { tipo: 'paragrafo', texto: perfil || '[perfil profissional de conclusão não cadastrado]', tamanho: 10, entrelinha: 1.45 },
            { tipo: 'espaco', altura: 14 },
            assinaturasOficiais(ctx.diretor, ctx.secretario),
          ],
        },
      ];
      break;
    }
  }

  const registrado = item.registrado;
  const rodapeFormulario = registrado ? undefined : [
    'Formulário para assinatura — não possui código de validação.',
    `Gerado em ${emissao.quando} por ${emissao.usuario}.`,
  ];
  const layout = layoutComCabecalho(
    ctx.instituicao, ctx.cabecalho, `${item.rotulo} — ${ctx.nome}`, paginas, { codigo: emissao.codigo, url: emissao.url }, rodapeFormulario,
  );
  const resumo: ResumoDocumento | null = registrado
    ? {
      tipo: tipo as TipoDocumento,
      aluno: ctx.nome,
      cpf: a.cpf ?? '',
      curso: curso.nome,
      eixo: curso.eixo ?? '',
      dataEmissao: e.dataEmissao,
      itens: [...(numero ? [['Portaria', `nº ${numero}`] as [string, string]] : []), ...itensResumo],
      ...(numero ? { numero, registro } : {}),
    }
    : null;
  return { tipo, ctx, layout, resumo, refs: { moduloId: moduloRef, numero }, faltantes, avisos };
}

export type TipoSecretaria = Exclude<TipoCatalogo, 'declaracao_conclusao_modulo' | 'historico_escolar'>;
export const ehFormulario = (t: TipoCatalogo): t is TipoFormulario => !ITEM_CATALOGO[t].registrado;
