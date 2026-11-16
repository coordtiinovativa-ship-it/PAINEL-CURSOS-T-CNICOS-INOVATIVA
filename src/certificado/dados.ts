/**
 * Monta todos os dados de um certificado de qualificação intermediária a partir do banco.
 * Usado pela prévia em tela e, no passo 3, pelo PDF e pelo snapshot da emissão.
 */
import { avaliarModulo, criteriosDoCurso, type AvaliacaoModulo, type CriteriosAprovacao } from '../lib/aprovacao';
import { dataExtenso } from '../lib/datas';
import { segmentarModelo, type Segmento } from '../lib/modelo';

export const CAMPOS_ALUNO = [
  'ra', 'nome_civil', 'nome_social', 'cpf', 'rg', 'rg_orgao_expedidor', 'rg_uf', 'data_nascimento', 'sexo',
  'cor_raca', 'naturalidade_municipio', 'naturalidade_uf', 'nacionalidade', 'nome_pai', 'nome_mae',
  'escolaridade', 'ensino_medio_instituicao', 'ensino_medio_municipio', 'ensino_medio_uf',
  'ensino_medio_ano_conclusao', 'email', 'telefone',
  // ficha completa (migração 0008)
  'usar_nome_social', 'estado_civil', 'necessidades_especificas', 'rg_data_expedicao', 'celular',
  'cep', 'endereco', 'bairro', 'complemento', 'endereco_municipio', 'endereco_uf',
] as const;
export type CampoAluno = (typeof CAMPOS_ALUNO)[number];
export type Aluno = { id: number } & Record<CampoAluno, string | null>;

export const ESTADOS: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/** Campos do aluno exigidos no certificado (frente e verso — art. 76, II, "a", Del. CEE/MS 10.603/2014). */
export const OBRIGATORIOS_ALUNO: [CampoAluno, string][] = [
  ['nome_civil', 'Nome civil'],
  ['nacionalidade', 'Nacionalidade'],
  ['naturalidade_municipio', 'Naturalidade (município)'],
  ['naturalidade_uf', 'Naturalidade (UF)'],
  ['data_nascimento', 'Data de nascimento'],
  ['rg', 'RG'],
  ['rg_orgao_expedidor', 'Órgão expedidor do RG'],
  ['rg_uf', 'UF do RG'],
  ['nome_mae', 'Nome da mãe'],
  ['ensino_medio_instituicao', 'Ensino médio: instituição'],
  ['ensino_medio_municipio', 'Ensino médio: município'],
  ['ensino_medio_uf', 'Ensino médio: UF'],
  ['ensino_medio_ano_conclusao', 'Ensino médio: ano de conclusão'],
];

export interface Signatario {
  nome: string;
  cargo: string;
  assinatura_r2_key: string | null;
}

export interface DisciplinaResultado {
  id: number;
  nome: string;
  ch: number;
  nota: number | null;
  exame: number | null;
  frequencia: number | null;
  resultado: 'AP' | 'RP' | 'PENDENTE';
  mediaFinal: number | null;
}

export interface DadosCertificado {
  matriculaId: number;
  instituicao: Record<string, any>;
  credenciamentoTexto: string | null;
  atoAutorizacao: Record<string, any> | null;
  curso: Record<string, any>;
  criterios: CriteriosAprovacao;
  modulo: { id: number; nome: string; ordem: number; carga_horaria: number; qualificacao_conferida: string | null };
  turma: Record<string, any>;
  aluno: Aluno;
  nomeExibido: string;
  disciplinas: DisciplinaResultado[];
  avaliacao: AvaliacaoModulo;
  diretor: Signatario | null;
  secretario: Signatario | null;
  textoFrente: Segmento[];
  localEmissao: string;
  dataEmissao: string; // ISO
  /** Itens que impedem a emissão (campos obrigatórios). */
  faltantes: string[];
  /** Avisos que não impedem a emissão, mas devem ser conferidos. */
  avisos: string[];
}

export class NaoEncontrado extends Error {}

/** "Deliberação CEE/MS nº 13.111, de 18 de dezembro de 2024" a partir de um ato regulatório. */
export function descreverAto(a: Record<string, any>): string {
  const orgao = a.orgao_emissor.includes('CEE/MS') ? 'CEE/MS ' : '';
  return `${a.tipo} ${orgao}nº ${a.numero}, de ${dataExtenso(a.data)}`;
}

/** Variáveis aceitas no texto do certificado (tela de textos do curso). */
export const VARIAVEIS_CERTIFICADO: [string, string][] = [
  ['nome', 'nome do(a) estudante (social, se a chave estiver ligada)'], ['nacionalidade', 'nacionalidade'],
  ['naturalidade_municipio', 'município de naturalidade'], ['naturalidade_uf', 'estado de naturalidade, por extenso'],
  ['data_nascimento_extenso', 'data de nascimento por extenso'], ['rg', 'RG'], ['rg_orgao', 'órgão expedidor do RG'], ['rg_uf', 'UF do RG'],
  ['nome_pai', 'filiação (pai)'], ['nome_mae', 'filiação (mãe)'],
  ['curso', 'nome do curso'], ['eixo', 'eixo tecnológico'], ['area', 'área tecnológica'], ['nivel', 'nível'],
  ['carga_horaria', 'carga horária do módulo'], ['carga_horaria_curso', 'carga horária total do curso'],
  ['modulo', 'nome do módulo (maiúsculas)'], ['qualificacao', 'qualificação conferida pelo módulo'],
  ['ato_ppc_numero', 'nº do ato de aprovação do PPC / autorização do curso'], ['ato_ppc_data_extenso', 'data desse ato por extenso'],
  ['ato_ppc_completo', 'ato de autorização completo (tipo, órgão, nº e data)'],
  ['ato_reconhecimento_completo', 'ato de reconhecimento do curso, completo'], ['ato_criacao_curso_completo', 'ato de criação do curso, completo'],
  ['ato_credenciamento_completo', 'credenciamento da instituição (fixo)'], ['instituicao', 'nome da instituição (fixo)'], ['mantenedora', 'mantenedora (fixo)'],
];

/** Data de hoje em Mato Grosso do Sul (UTC−4), ISO. */
export function hojeMS(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}

const vazio = (v: unknown) => v == null || String(v).trim() === '';

export async function montarDadosCertificado(
  db: D1Database,
  matriculaId: number,
  moduloId: number,
  alunoSobrescrito?: Partial<Record<CampoAluno, string | null>>,
): Promise<DadosCertificado> {
  const base = await db
    .prepare(
      `SELECT m.id AS matricula_id, m.aluno_id, t.id AS turma_id, t.codigo AS turma_codigo, t.matriz_id, t.ano_letivo,
              t.data_inicio, t.data_fim, cu.id AS curso_id
         FROM matriculas m JOIN turmas t ON t.id = m.turma_id JOIN cursos cu ON cu.id = t.curso_id
        WHERE m.id = ?`,
    )
    .bind(matriculaId)
    .first<Record<string, any>>();
  if (!base) throw new NaoEncontrado('Matrícula não encontrada');
  return comporDados(db, base, moduloId, { alunoSobrescrito });
}

/** Aluno fictício usado na prévia da tela "Modelo do certificado". */
export const ALUNO_EXEMPLO: Aluno = {
  id: 0, ra: '0000000', nome_civil: 'Maria Exemplo da Silva', nome_social: null, cpf: '52998224725',
  rg: '0000000', rg_orgao_expedidor: 'SEJUSP', rg_uf: 'MS', data_nascimento: '2000-01-15', sexo: 'F', cor_raca: null,
  naturalidade_municipio: 'Campo Grande', naturalidade_uf: 'MS', nacionalidade: 'brasileira',
  nome_pai: 'João Exemplo da Silva', nome_mae: 'Ana Exemplo da Silva', escolaridade: 'Ensino médio completo',
  ensino_medio_instituicao: 'Escola Estadual Exemplo', ensino_medio_municipio: 'Campo Grande', ensino_medio_uf: 'MS',
  ensino_medio_ano_conclusao: '2018', email: null, telefone: null,
  usar_nome_social: '0', estado_civil: null, necessidades_especificas: null, rg_data_expedicao: null, celular: null,
  cep: null, endereco: null, bairro: null, complemento: null, endereco_municipio: null, endereco_uf: null,
};

/** Nome impresso nos documentos: o social só quando a chave "usar nome social" estiver ligada. */
export function nomeDoAluno(a: { nome_civil?: string | null; nome_social?: string | null; usar_nome_social?: unknown }): string {
  const usar = a.usar_nome_social == null || String(a.usar_nome_social) !== '0';
  return ((usar && a.nome_social?.trim()) || a.nome_civil || '').trim();
}

/** Dados de certificado com aluno fictício e todas as disciplinas aprovadas (prévia do modelo). */
export async function montarDadosExemplo(db: D1Database): Promise<DadosCertificado> {
  const base = await db
    .prepare(
      `SELECT 0 AS matricula_id, 0 AS aluno_id, 0 AS turma_id, 'EXEMPLO' AS turma_codigo, mc.id AS matriz_id,
              CAST(strftime('%Y','now') AS INTEGER) AS ano_letivo, NULL AS data_inicio, NULL AS data_fim, cu.id AS curso_id,
              (SELECT id FROM modulos_tematicos WHERE matriz_id = mc.id ORDER BY ordem LIMIT 1) AS modulo_id
         FROM cursos cu JOIN matrizes_curriculares mc ON mc.curso_id = cu.id
        WHERE cu.ativo = 1 ORDER BY cu.id, mc.versao DESC LIMIT 1`,
    )
    .first<Record<string, any>>();
  if (!base?.modulo_id) throw new NaoEncontrado('Nenhum curso com matriz e módulos cadastrados');
  return comporDados(db, base, base.modulo_id, { aluno: ALUNO_EXEMPLO, todosAprovados: true });
}

async function comporDados(
  db: D1Database,
  base: Record<string, any>,
  moduloId: number,
  opcoes: {
    alunoSobrescrito?: Partial<Record<CampoAluno, string | null>>;
    aluno?: Aluno;
    todosAprovados?: boolean;
  },
): Promise<DadosCertificado> {
  const { alunoSobrescrito } = opcoes;
  const matriculaId = base.matricula_id as number;
  const [instituicao, curso, modulo, alunoDb, credenciamento, atoPpc, componentes, resultados, signatarios, atosCurso] = await Promise.all([
    db.prepare('SELECT * FROM instituicoes WHERE id = (SELECT instituicao_id FROM cursos WHERE id = ?)').bind(base.curso_id).first<Record<string, any>>(),
    db.prepare('SELECT cu.*, e.nome AS eixo FROM cursos cu LEFT JOIN eixos_tecnologicos e ON e.id = cu.eixo_id WHERE cu.id = ?').bind(base.curso_id).first<Record<string, any>>(),
    db.prepare('SELECT * FROM modulos_tematicos WHERE id = ? AND matriz_id = ?').bind(moduloId, base.matriz_id).first<DadosCertificado['modulo']>(),
    opcoes.aluno ? Promise.resolve(opcoes.aluno) : db.prepare('SELECT * FROM alunos WHERE id = ?').bind(base.aluno_id).first<Aluno>(),
    db.prepare(`SELECT * FROM atos_regulatorios WHERE finalidade = 'credenciamento' AND ativo = 1
                 AND instituicao_id = (SELECT instituicao_id FROM cursos WHERE id = ?) ORDER BY data DESC LIMIT 1`).bind(base.curso_id).first<Record<string, any>>(),
    db.prepare(`SELECT * FROM atos_regulatorios WHERE finalidade = 'autorizacao_curso' AND ativo = 1 AND curso_id = ?
                 ORDER BY data DESC LIMIT 1`).bind(base.curso_id).first<Record<string, any>>(),
    db.prepare('SELECT id, nome, carga_horaria_total AS ch FROM componentes_curriculares WHERE modulo_id = ? ORDER BY ordem').bind(moduloId).all<{ id: number; nome: string; ch: number }>(),
    db.prepare('SELECT * FROM resultados WHERE matricula_id = ?').bind(matriculaId).all<Record<string, any>>(),
    db.prepare(`SELECT nome, cargo, funcao, assinatura_r2_key FROM signatarios WHERE ativo = 1 AND funcao IN ('diretor_pedagogico','secretario')`).all<Signatario & { funcao: string }>(),
    db.prepare(`SELECT * FROM atos_regulatorios WHERE curso_id = ? AND ativo = 1 ORDER BY data DESC`).bind(base.curso_id).all<Record<string, any>>(),
  ]);
  const atoDo = (...finalidades: string[]) => atosCurso.results.find((a) => finalidades.includes(a.finalidade)) ?? null;
  if (!modulo) throw new NaoEncontrado('Módulo não pertence à matriz da turma');
  if (!alunoDb || !instituicao || !curso) throw new NaoEncontrado('Dados incompletos');

  const aluno: Aluno = { ...alunoDb };
  if (alunoSobrescrito) for (const k of CAMPOS_ALUNO) if (k in alunoSobrescrito) aluno[k] = alunoSobrescrito[k] ?? null;

  const criterios = criteriosDoCurso(curso as any);
  const lista = opcoes.todosAprovados
    ? componentes.results.map((cc) => ({ componente_id: cc.id, nota: 10, nota_exame_final: null, frequencia: 100 }))
    : resultados.results;
  const porComp = new Map(lista.map((r: Record<string, any>) => [r.componente_id, r]));
  const lancados = componentes.results.map((cc) => {
    const r = porComp.get(cc.id);
    return {
      componente: cc.nome,
      nota: r?.nota ?? null,
      notaExameFinal: r?.nota_exame_final ?? null,
      frequencia: r?.frequencia ?? null,
      aproveitada: !!r?.aproveitado_de_resultado_id,
    };
  });
  const avaliacao = avaliarModulo(componentes.results.map((cc) => cc.nome), lancados, criterios);
  const disciplinas: DisciplinaResultado[] = componentes.results.map((cc, i) => ({
    id: cc.id,
    nome: cc.nome,
    ch: cc.ch,
    nota: lancados[i].nota,
    exame: lancados[i].notaExameFinal,
    frequencia: lancados[i].frequencia,
    resultado: avaliacao.disciplinas[i].resultado,
    mediaFinal: avaliacao.disciplinas[i].mediaFinal,
  }));

  const diretor = signatarios.results.find((s) => s.funcao === 'diretor_pedagogico') ?? null;
  const secretario = signatarios.results.find((s) => s.funcao === 'secretario') ?? null;
  const nomeExibido = nomeDoAluno(aluno);

  const faltantes: string[] = [];
  const avisos: string[] = [];
  for (const [campo, rotulo] of OBRIGATORIOS_ALUNO) if (vazio(aluno[campo])) faltantes.push(`Aluno: ${rotulo}`);
  if (vazio(aluno.nome_pai)) avisos.push('Nome do pai não informado: a filiação sairá só com o nome da mãe.');
  if (aluno.nome_social && nomeExibido !== aluno.nome_civil) avisos.push('O certificado usará o nome social do(a) estudante.');
  if (!credenciamento) faltantes.push('Instituição: ato de credenciamento');
  if (!atoPpc) faltantes.push('Curso: ato de aprovação do PPC / autorização');
  if (!modulo.qualificacao_conferida) faltantes.push('Módulo: qualificação conferida');
  const chComponentes = componentes.results.reduce((soma, cc) => soma + cc.ch, 0);
  if (!componentes.results.length) faltantes.push('Matriz: módulo sem disciplinas cadastradas');
  else if (chComponentes !== modulo.carga_horaria) {
    faltantes.push(`Matriz: as disciplinas do módulo somam ${chComponentes} h, mas o módulo tem ${modulo.carga_horaria} h`);
  }
  for (const [s, rotulo] of [[diretor, 'Diretor(a) Pedagógico(a)'], [secretario, 'Secretário(a)']] as const) {
    if (!s || s.nome.includes('A DEFINIR')) faltantes.push(`Signatário: ${rotulo} não cadastrado`);
    else if (!s.assinatura_r2_key) avisos.push(`Assinatura digitalizada de ${rotulo} não enviada (será assinada à mão).`);
  }
  if (!avaliacao.aprovado) {
    faltantes.push(avaliacao.pendente ? 'Resultados do módulo incompletos' : 'Aluno não aprovado no módulo');
  }
  if (!atoPpc?.publicacao_doe_numero) avisos.push('Publicação do ato do curso no DOE/MS ainda não informada.');

  // Texto aprovado da frente
  const modeloRow = await db
    .prepare(`SELECT texto FROM modelos_texto WHERE documento = 'certificado_qualificacao' AND ativo = 1
               AND (curso_id = ? OR curso_id IS NULL) ORDER BY curso_id IS NULL, id DESC LIMIT 1`)
    .bind(curso.id)
    .first<{ texto: string }>();
  let modelo = modeloRow?.texto ?? '';
  if (!modelo.trim()) faltantes.push('Curso: texto do certificado não cadastrado');
  if (vazio(aluno.nome_pai)) modelo = modelo.replace(/\{nome_pai\}\s+e\s+\{nome_mae\}/, '{nome_mae}');

  const ext = (iso: string | null) => {
    try { return iso ? dataExtenso(iso) : null; } catch { return null; }
  };
  const textoFrente = segmentarModelo(modelo, {
    instituicao: instituicao.razao_social,
    mantenedora: instituicao.mantenedora_razao_social,
    ato_credenciamento_completo: credenciamento ? descreverAto(credenciamento) : null,
    ato_ppc_completo: atoPpc ? descreverAto(atoPpc) : null,
    ato_reconhecimento_completo: (() => { const a = atoDo('renovacao_reconhecimento', 'reconhecimento'); return a ? descreverAto(a) : null; })(),
    ato_criacao_curso_completo: (() => { const a = atoDo('criacao_curso'); return a ? descreverAto(a) : null; })(),
    carga_horaria: String(modulo.carga_horaria),
    carga_horaria_curso: String(curso.carga_horaria_total),
    curso: curso.nome,
    eixo: curso.eixo,
    area: curso.area_tecnologica,
    nivel: curso.nivel,
    ato_ppc_numero: atoPpc?.numero,
    ato_ppc_data_extenso: ext(atoPpc?.data ?? null),
    nome: nomeExibido.toUpperCase(),
    nacionalidade: aluno.nacionalidade,
    naturalidade_municipio: aluno.naturalidade_municipio,
    naturalidade_uf: aluno.naturalidade_uf ? ESTADOS[aluno.naturalidade_uf] ?? aluno.naturalidade_uf : null,
    data_nascimento_extenso: ext(aluno.data_nascimento),
    rg: aluno.rg,
    rg_orgao: aluno.rg_orgao_expedidor,
    rg_uf: aluno.rg_uf,
    nome_pai: aluno.nome_pai,
    nome_mae: aluno.nome_mae,
    modulo: modulo.nome.toUpperCase(),
    qualificacao: modulo.qualificacao_conferida,
  });

  // Variável usada no texto mas sem valor (ex.: ato de reconhecimento ainda não cadastrado) impede a emissão
  const jaApontados = new Set(['nome', 'nacionalidade', 'naturalidade_municipio', 'naturalidade_uf', 'data_nascimento_extenso', 'rg', 'rg_orgao', 'rg_uf', 'nome_pai', 'nome_mae', 'ato_ppc_numero', 'ato_ppc_data_extenso', 'ato_ppc_completo', 'qualificacao']);
  for (const v of new Set(textoFrente.filter((x) => x.faltante).map((x) => x.variavel!))) {
    if (!jaApontados.has(v)) faltantes.push(`Texto do certificado: {${v}} sem valor`);
  }

  const credenciamentoTexto = credenciamento
    ? `Credenciamento ${credenciamento.tipo} ${credenciamento.orgao_emissor.includes('CEE/MS') ? 'CEE/MS ' : ''}nº ${credenciamento.numero}, de ${dataExtenso(credenciamento.data)}`
    : null;

  return {
    matriculaId,
    instituicao,
    credenciamentoTexto,
    atoAutorizacao: atoPpc ?? null,
    curso,
    criterios,
    modulo,
    turma: base,
    aluno,
    nomeExibido,
    disciplinas,
    avaliacao,
    diretor,
    secretario,
    textoFrente,
    localEmissao: `${instituicao.municipio}/${instituicao.uf}`,
    dataEmissao: hojeMS(),
    faltantes,
    avisos,
  };
}
