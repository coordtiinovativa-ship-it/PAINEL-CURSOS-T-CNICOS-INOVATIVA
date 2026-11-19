/**
 * Catálogo dos documentos da Secretaria — fonte única para o menu (painel lateral "Emissão de Documentos"),
 * a tela de escolha e as rotas de emissão. Modelos de origem em "MODELOS DOCUMENTOS/" (PPC aprovado).
 *
 *  - registrado: recebe código INV, QR code, snapshot e hash (tabela `documentos`) e é validado em /v.
 *  - formulário (registrado = false): requerimentos assinados à mão pelo estudante; saem preenchidos com os dados
 *    do cadastro, sem código de validação (não são atos da instituição), e a geração vai para a auditoria.
 *  - contexto: o que precisa ser escolhido — só o aluno, a matrícula (turma) ou a matrícula + o módulo.
 */

export type TipoDocumento =
  | 'declaracao_conclusao_modulo'
  | 'historico_escolar'
  | 'historico_curso_tecnico'
  | 'guia_transferencia'
  | 'portaria_aproveitamento_modulos'
  | 'portaria_aproveitamento_disciplinas'
  | 'portaria_aproveitamento_conhecimentos';

export type TipoFormulario = 'requerimento_matricula' | 'requerimento_aproveitamento_estudos' | 'requerimento_aproveitamento_conhecimentos';

export type TipoCatalogo = TipoDocumento | TipoFormulario;

export type GrupoDocumento = 'Vida escolar' | 'Requerimentos' | 'Portarias';
export const GRUPOS_DOCUMENTO: GrupoDocumento[] = ['Vida escolar', 'Requerimentos', 'Portarias'];

export interface ItemCatalogo {
  tipo: TipoCatalogo;
  rotulo: string;
  grupo: GrupoDocumento;
  descricao: string;
  registrado: boolean;
  contexto: 'aluno' | 'matricula' | 'matricula_modulo';
  /** substantivo feminino ("válida", "emitida") */
  feminino: boolean;
  /** modelo de origem na pasta MODELOS DOCUMENTOS */
  modelo: string;
}

export const CATALOGO: ItemCatalogo[] = [
  {
    tipo: 'declaracao_conclusao_modulo', rotulo: 'Declaração de Conclusão de Módulo', grupo: 'Vida escolar', registrado: true,
    contexto: 'matricula_modulo', feminino: true, modelo: '(texto do sistema)',
    descricao: 'Declara a conclusão do módulo temático com aprovação, enquanto o certificado é expedido.',
  },
  {
    tipo: 'historico_escolar', rotulo: 'Histórico Escolar da Qualificação', grupo: 'Vida escolar', registrado: true,
    contexto: 'matricula_modulo', feminino: false, modelo: '09 a 11 — Histórico da Qualificação',
    descricao: 'Disciplinas, carga horária, frequência e média do módulo; verso com perfil e competências da qualificação.',
  },
  {
    tipo: 'historico_curso_tecnico', rotulo: 'Histórico Escolar do Curso Técnico', grupo: 'Vida escolar', registrado: true,
    contexto: 'matricula', feminino: false, modelo: '08 — Histórico Escolar do Curso Técnico',
    descricao: 'Todos os módulos e o TCC, com resultado final; certifica a conclusão do curso técnico.',
  },
  {
    tipo: 'guia_transferencia', rotulo: 'Guia de Transferência', grupo: 'Vida escolar', registrado: true,
    contexto: 'matricula', feminino: true, modelo: '07 — Guia de Transferência',
    descricao: 'Resultados dos módulos concluídos e, no verso, os dados parciais do módulo em curso. Exige matrícula com status Transferido.',
  },
  {
    tipo: 'requerimento_matricula', rotulo: 'Requerimento de Matrícula', grupo: 'Requerimentos', registrado: false,
    contexto: 'aluno', feminino: false, modelo: '06 — Requerimento de Matrícula',
    descricao: 'Ficha de matrícula no módulo temático, preenchida com o cadastro do aluno, para assinatura e deferimento.',
  },
  {
    tipo: 'requerimento_aproveitamento_estudos', rotulo: 'Requerimento de Aproveitamento de Estudos', grupo: 'Requerimentos', registrado: false,
    contexto: 'aluno', feminino: false, modelo: '01 — Requerimento de Aproveitamento de Estudos',
    descricao: 'Pedido do estudante, por análise documental ou avaliação, de aproveitamento de estudos concluídos.',
  },
  {
    tipo: 'requerimento_aproveitamento_conhecimentos', rotulo: 'Requerimento de Aproveitamento de Conhecimentos e Experiências', grupo: 'Requerimentos',
    registrado: false, contexto: 'aluno', feminino: false, modelo: '02 — Requerimento de Aproveitamento de Conhecimentos e Experiências',
    descricao: 'Pedido do estudante, por avaliação, de aproveitamento de conhecimentos e experiências anteriores.',
  },
  {
    tipo: 'portaria_aproveitamento_modulos', rotulo: 'Portaria de Aproveitamento de Estudos (Módulos)', grupo: 'Portarias', registrado: true,
    contexto: 'aluno', feminino: true, modelo: '04 — Portaria de Aproveitamento de Estudos (Módulos)',
    descricao: 'Aproveita módulos concluídos em outra instituição e classifica o estudante no módulo seguinte.',
  },
  {
    tipo: 'portaria_aproveitamento_disciplinas', rotulo: 'Portaria de Aproveitamento de Estudos (Disciplinas)', grupo: 'Portarias', registrado: true,
    contexto: 'aluno', feminino: true, modelo: '05 — Portaria de Aproveitamento de Estudos (Disciplinas)',
    descricao: 'Aproveita disciplinas cursadas em outra instituição, dispensando o estudante de cursá-las.',
  },
  {
    tipo: 'portaria_aproveitamento_conhecimentos', rotulo: 'Portaria de Aproveitamento de Conhecimentos e Experiências', grupo: 'Portarias',
    registrado: true, contexto: 'aluno', feminino: true, modelo: '03 — Portaria de Aproveitamento de Conhecimentos e Experiências',
    descricao: 'Aproveita conhecimentos e experiências avaliados pela equipe técnico-pedagógica e classifica o estudante.',
  },
];

export const ITEM_CATALOGO = Object.fromEntries(CATALOGO.map((i) => [i.tipo, i])) as Record<TipoCatalogo, ItemCatalogo>;
export const ehTipoCatalogo = (t: string): t is TipoCatalogo => t in ITEM_CATALOGO;

/** Tipos registrados na tabela `documentos` (mesma lista do CHECK da migração 0019). */
export const TIPOS_REGISTRADOS = CATALOGO.filter((i) => i.registrado).map((i) => i.tipo) as TipoDocumento[];
export const ROTULO_DOCUMENTO = Object.fromEntries(CATALOGO.map((i) => [i.tipo, i.rotulo])) as Record<TipoCatalogo, string>;

/** Endereço da tela de emissão de cada documento. */
export const hrefEmissao = (tipo: TipoCatalogo) => `/admin/secretaria/documentos/${tipo}`;
export const HREF_CENTRAL_DOCUMENTOS = '/admin/secretaria/documentos';
