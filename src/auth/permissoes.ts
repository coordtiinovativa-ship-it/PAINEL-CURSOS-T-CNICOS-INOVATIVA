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

export const PERMISSOES = {
  'usuarios.gerenciar': { rotulo: 'Gerenciar usuários e perfis', perfis: MASTER },
  'auditoria.ver': { rotulo: 'Ver auditoria', perfis: ADMINS },
  'instituicao.editar': { rotulo: 'Editar instituição, atos e imagens', perfis: ADMINS },
  'signatarios.editar': { rotulo: 'Gerenciar signatários, assinaturas e portarias', perfis: ADMINS },
  'cursos.editar': { rotulo: 'Editar cursos e parâmetros de aprovação', perfis: ADMINS },
  'alunos.editar': { rotulo: 'Cadastrar e editar alunos', perfis: TODOS },
  'alunos.excluir': { rotulo: 'Excluir aluno sem matrícula', perfis: ADMINS },
  'turmas.editar': { rotulo: 'Cadastrar turmas e matricular alunos', perfis: TODOS },
  'turmas.excluir': { rotulo: 'Excluir turma cadastrada por engano (sem documentos emitidos)', perfis: ADMINS },
  'resultados.lancar': { rotulo: 'Lançar notas e frequência', perfis: TODOS },
  'pedagogico.gerenciar': { rotulo: 'Gestão pedagógica: funcionários, ano letivo, calendário, lotação e horário', perfis: TODOS },
  'relatorios.emitir': { rotulo: 'Emitir relatórios e prévias', perfis: TODOS },
  'certificados.emitir': { rotulo: 'Emitir certificados', perfis: TODOS },
  'certificados.revogar': { rotulo: 'Revogar certificados e emitir 2ª via', perfis: MASTER },
} as const satisfies Record<string, { rotulo: string; perfis: Perfil[] }>;

export type Permissao = keyof typeof PERMISSOES;

export function pode(perfil: Perfil, permissao: Permissao): boolean {
  return (PERMISSOES[permissao].perfis as readonly Perfil[]).includes(perfil);
}
