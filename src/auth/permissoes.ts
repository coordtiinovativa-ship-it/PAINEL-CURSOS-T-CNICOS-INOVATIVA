/**
 * Perfis e permissões — fonte única. Para mudar o que um perfil pode fazer,
 * altere apenas a matriz PERMISSOES abaixo (a tela de usuários exibe esta matriz).
 */

export type Perfil = 'admin_master' | 'administrador' | 'coordenador' | 'secretaria';

export const PERFIS: Perfil[] = ['admin_master', 'administrador', 'coordenador', 'secretaria'];

export const ROTULO_PERFIL: Record<Perfil, string> = {
  admin_master: 'Admin master',
  administrador: 'Administrador',
  coordenador: 'Coordenador',
  secretaria: 'Secretaria',
};

const TODOS: Perfil[] = PERFIS;
const ADMINS: Perfil[] = ['admin_master', 'administrador'];
const MASTER: Perfil[] = ['admin_master'];
/** Secretaria escolar (e os administradores): correções e vida acadêmica do aluno */
const SECRETARIA: Perfil[] = ['admin_master', 'administrador', 'secretaria'];

export const PERMISSOES = {
  'usuarios.gerenciar': { rotulo: 'Gerenciar usuários e perfis', perfis: MASTER },
  'usuarios.permissoes': { rotulo: 'Definir o que cada usuário pode acessar (liberar ou bloquear funções)', perfis: ADMINS },
  'auditoria.ver': { rotulo: 'Ver auditoria', perfis: ADMINS },
  'instituicao.editar': { rotulo: 'Editar instituição, atos e imagens', perfis: ADMINS },
  'signatarios.editar': { rotulo: 'Gerenciar signatários, assinaturas e portarias', perfis: ADMINS },
  'cursos.editar': { rotulo: 'Editar cursos e parâmetros de aprovação', perfis: ADMINS },
  'alunos.editar': { rotulo: 'Cadastrar e editar alunos', perfis: TODOS },
  'alunos.excluir': { rotulo: 'Excluir aluno sem matrícula', perfis: ADMINS },
  'turmas.editar': { rotulo: 'Cadastrar turmas e matricular alunos', perfis: TODOS },
  'turmas.excluir': { rotulo: 'Excluir turma cadastrada por engano (sem documentos emitidos)', perfis: ADMINS },
  'resultados.lancar': { rotulo: 'Lançar notas e faltas (Gestão Pedagógica) — só alunos com matrícula ativa', perfis: TODOS },
  'resultados.corrigir': { rotulo: 'Secretaria: notas e faltas de qualquer aluno (inclusive matrícula não ativa)', perfis: SECRETARIA },
  'matriculas.status': { rotulo: 'Alterar o status da matrícula (transferência, desistência...)', perfis: SECRETARIA },
  'calendario.excluir': { rotulo: 'Excluir o calendário de um ano letivo ou o ano letivo sem turmas', perfis: ADMINS },
  'pedagogico.gerenciar': { rotulo: 'Gestão pedagógica: funcionários, ano letivo, calendário, lotação e horário', perfis: TODOS },
  'relatorios.emitir': { rotulo: 'Emitir relatórios e prévias', perfis: TODOS },
  'certificados.emitir': { rotulo: 'Emitir certificados', perfis: TODOS },
  'certificados.revogar': { rotulo: 'Revogar certificados e emitir 2ª via', perfis: MASTER },
} as const satisfies Record<string, { rotulo: string; perfis: Perfil[] }>;

export type Permissao = keyof typeof PERMISSOES;

/** Quem está sendo conferido: só o perfil (padrão) ou o usuário logado com as permissões já calculadas. */
export type QuemPode = Perfil | { perfil: Perfil; permissoes?: readonly string[] };

export function padraoDoPerfil(perfil: Perfil, permissao: Permissao): boolean {
  return (PERMISSOES[permissao].perfis as readonly Perfil[]).includes(perfil);
}

/**
 * Pode fazer? Perfil sozinho → padrão do perfil. Usuário com `permissoes` → padrão do perfil com os ajustes
 * do usuário (liberado/bloqueado). O admin master sempre pode tudo.
 */
export function pode(quem: QuemPode, permissao: Permissao): boolean {
  if (typeof quem === 'string') return padraoDoPerfil(quem, permissao);
  if (quem.perfil === 'admin_master') return true;
  if (quem.permissoes) return quem.permissoes.includes(permissao);
  return padraoDoPerfil(quem.perfil, permissao);
}

export interface AjustePermissao { permissao: string; concedida: number }

/** Permissões efetivas = padrão do perfil + liberadas − bloqueadas. */
export function permissoesEfetivas(perfil: Perfil, ajustes: AjustePermissao[]): Permissao[] {
  const aj = new Map(ajustes.map((a) => [a.permissao, !!a.concedida]));
  return (Object.keys(PERMISSOES) as Permissao[]).filter((p) =>
    perfil === 'admin_master' ? true : aj.has(p) ? aj.get(p)! : padraoDoPerfil(perfil, p));
}

/** Funções que só o admin master libera ou bloqueia (gerência de usuários). */
const SO_MASTER_AJUSTA: Permissao[] = ['usuarios.gerenciar', 'usuarios.permissoes'];

/**
 * Quem ajusta as permissões de quem: o admin master ajusta qualquer usuário que não seja admin master;
 * o administrador ajusta só coordenador e secretaria. Ninguém ajusta a si mesmo.
 */
export function podeAjustarUsuario(editor: { id: number; perfil: Perfil; permissoes?: readonly string[] }, alvo: { id: number; perfil: Perfil }): boolean {
  if (editor.id === alvo.id || alvo.perfil === 'admin_master' || !pode(editor, 'usuarios.permissoes')) return false;
  return editor.perfil === 'admin_master' || alvo.perfil === 'coordenador' || alvo.perfil === 'secretaria';
}

/** Ninguém libera o que não tem; gerência de usuários e de permissões só o admin master mexe. */
export function podeAjustarPermissao(editor: { perfil: Perfil; permissoes?: readonly string[] }, permissao: Permissao): boolean {
  if (editor.perfil === 'admin_master') return true;
  return !SO_MASTER_AJUSTA.includes(permissao) && pode(editor, permissao);
}

/** Agrupamento das permissões na tela (mesmas seções do menu). */
export const GRUPOS_PERMISSAO: { rotulo: string; permissoes: Permissao[] }[] = [
  { rotulo: 'Sistema', permissoes: ['usuarios.gerenciar', 'usuarios.permissoes', 'auditoria.ver'] },
  { rotulo: 'Cadastros', permissoes: ['instituicao.editar', 'signatarios.editar', 'cursos.editar'] },
  { rotulo: 'Gestão Pedagógica', permissoes: ['pedagogico.gerenciar', 'calendario.excluir', 'resultados.lancar'] },
  {
    rotulo: 'Secretaria',
    permissoes: ['alunos.editar', 'alunos.excluir', 'turmas.editar', 'turmas.excluir', 'resultados.corrigir', 'matriculas.status',
      'relatorios.emitir', 'certificados.emitir', 'certificados.revogar'],
  },
];
