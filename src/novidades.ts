/*
 * Novidades do Sistema — fonte única do histórico de versões exibido em /admin/novidades.
 *
 * A cada entrega: acrescente a nova versão NO TOPO da lista e atualize "version" no package.json
 * (um teste confere que os dois batem). Escreva para quem usa o painel (secretaria, coordenação),
 * em linguagem simples, dizendo o que mudou na tela — não detalhes de programação.
 *
 * Numeração: MAIOR.MENOR.CORREÇÃO
 *   - MENOR (1.7.0 → 1.8.0): telas ou funções novas, melhorias visíveis.
 *   - CORREÇÃO (1.7.0 → 1.7.1): só correções de erro.
 *   - 0.x = fase de desenvolvimento; 1.0.0 = entrada em produção.
 */
import type { Permissao } from './auth/permissoes';

export interface ItemNovidade {
  /** Frase curta em destaque (vira link quando há `href`). */
  titulo: string;
  /** Explicação opcional, logo após o título. */
  texto?: string;
  /** Tela do painel onde a novidade está. */
  href?: string;
  /** Permissão necessária para a tela do link (sem ela, o texto aparece sem link). */
  perm?: Permissao;
}

export interface Versao {
  versao: string;
  /** Data da entrega, em ISO (AAAA-MM-DD). */
  data: string;
  resumo?: string;
  novidades?: ItemNovidade[];
  melhorias?: ItemNovidade[];
  correcoes?: ItemNovidade[];
}

export const VERSOES: Versao[] = [
  {
    versao: '1.8.0',
    data: '2026-11-17',
    novidades: [
      {
        titulo: 'RG unificado ao CPF',
        texto: 'no cadastro do aluno, uma chave ao lado do RG indica a nova Carteira de Identidade Nacional (CIN), em que o número do RG é o próprio CPF. ' +
          'Com a chave ligada, o RG é preenchido com o CPF e sai assim no certificado. O órgão expedidor e a UF continuam sendo informados. ' +
          'Na importação de planilhas, quando o RG vier igual ao CPF, a chave é ligada sozinha.',
        href: '/admin/alunos',
        perm: 'alunos.editar',
      },
      {
        titulo: 'Atos no cabeçalho dos documentos',
        texto: 'no lugar de "Atos autorizativos vigentes", o cabeçalho do certificado, da declaração e do histórico traz primeiro os atos fixos da instituição ' +
          '(criação e credenciamento da Educação Profissional Técnica, editáveis em Instituição e Atos) e, logo abaixo, os atos do curso da turma ' +
          '(campo "Autorização" em Cursos e Matrizes → Dados do curso). O que for digitado é o que sai, uma linha por linha. ' +
          'Os campos já vieram preenchidos com a ata de criação, a Deliberação CEE/MS n. 10994 e a Deliberação CEE/MS n. 13111. ' +
          'A antiga linha "Credenciamento Deliberação..." saiu do cabeçalho, porque o credenciamento já está nos atos da instituição.',
        href: '/admin/instituicao',
        perm: 'instituicao.editar',
      },
      {
        titulo: 'Telefone e e-mail nos documentos',
        texto: 'o telefone e o e-mail cadastrados em Instituição e Atos passam a sair na linha do endereço, no cabeçalho do certificado, ' +
          'da declaração, do histórico e dos relatórios.',
        href: '/admin/instituicao',
        perm: 'instituicao.editar',
      },
    ],
    melhorias: [
      {
        titulo: 'Logo do Instituto Inovativa no Início',
        texto: 'a tela inicial mostra o logo centralizado, como no sysGEP. No tema escuro, o logo aparece sobre um fundo branco.',
        href: '/admin',
      },
    ],
  },
  {
    versao: '1.7.0',
    data: '2026-11-17',
    novidades: [
      {
        titulo: 'Novidades do Sistema',
        texto: 'esta tela mostra o que mudou em cada versão, com busca por palavra (ex.: "faltas", "QR code", "1.5"). ' +
          'Quando sai uma versão nova, aparece o selo "novo" no rodapé do menu e um aviso no Início.',
        href: '/admin/novidades',
      },
    ],
  },
  {
    versao: '1.6.0',
    data: '2026-11-16',
    novidades: [
      {
        titulo: 'Prévia do certificado na tela de emissão',
        texto: 'antes de emitir, a tela mostra "Como vai ficar", com a frente e o verso. O botão "Ver em tela" abre a prévia inteira. ' +
          'Declaração e histórico escolar ganharam a mesma prévia.',
        href: '/admin/certificados/pendentes',
        perm: 'certificados.emitir',
      },
      {
        titulo: 'QR code de exemplo nas prévias',
        texto: 'as prévias (tela e PDF) mostram um QR code no mesmo lugar e tamanho do definitivo, com o código "INV-AAAA-NNNNN (exemplo)". ' +
          'O código e o QR code verdadeiros só são gerados na emissão.',
      },
      {
        titulo: 'Excluir turma cadastrada por engano',
        texto: 'na tela da turma, o administrador pode excluir uma turma digitando o código dela para confirmar. ' +
          'Os cadastros dos alunos continuam. Não é possível excluir turma que já tenha certificado ou documento emitido.',
        href: '/admin/turmas',
        perm: 'turmas.excluir',
      },
    ],
    melhorias: [
      { titulo: 'Ícones com tamanho padrão em todas as telas.' },
      { titulo: 'Telas ajustadas para o celular', texto: 'sem conteúdo cortado ou saindo para os lados.' },
      { titulo: 'Listas vazias', texto: 'mostram um aviso no lugar de uma tabela em branco.' },
      { titulo: 'Ajustes visuais na importação de planilhas e nos resultados do módulo.' },
    ],
  },
  {
    versao: '1.5.0',
    data: '2026-11-16',
    novidades: [
      {
        titulo: 'Notas e Faltas',
        texto: 'novo lançamento por turma → módulo → disciplina. Para cada disciplina, cadastre professor, dias da semana, horário e tempo de cada aula. ' +
          'As faltas são lançadas em número de aulas e a frequência (%) é calculada sozinha.',
        href: '/admin/diario',
        perm: 'resultados.lancar',
      },
      {
        titulo: 'Modelo atualizado do certificado',
        texto: 'fonte Arial e trechos em negrito, como no modelo aprovado. O verso não traz mais a linha "(Verso do Certificado da ...)".',
        href: '/admin/modelo',
        perm: 'instituicao.editar',
      },
      {
        titulo: 'Portaria abaixo das assinaturas',
        texto: 'certificados, declarações e históricos mostram o nome do signatário e a portaria de nomeação, tirados do cadastro de Signatários.',
        href: '/admin/signatarios',
        perm: 'signatarios.editar',
      },
    ],
  },
  {
    versao: '1.4.0',
    data: '2026-11-16',
    novidades: [
      {
        titulo: 'Relatórios',
        texto: 'relatório de alunos por situação de matrícula, com filtro por curso e turma, em PDF, na tela ou em planilha. ' +
          'Todo relatório informa quem emitiu, a data e a hora.',
        href: '/admin/relatorios',
        perm: 'relatorios.emitir',
      },
      { titulo: 'Botão Voltar', texto: 'presente em todas as telas do painel.' },
    ],
    melhorias: [
      { titulo: 'Tela da turma redesenhada', texto: 'com os dados da turma, um resumo, os módulos em etapas e a lista de alunos.', href: '/admin/turmas', perm: 'turmas.editar' },
      {
        titulo: 'Atos regulatórios',
        texto: 'todo ato cadastrado aparece como publicado. Número e data do DOE/MS passam a ser opcionais e os avisos de "publicação pendente" foram retirados.',
      },
    ],
  },
  {
    versao: '1.3.0',
    data: '2026-11-16',
    novidades: [
      {
        titulo: 'Módulos em sequência',
        texto: 'cada turma faz o curso com os módulos em ordem. Cada módulo tem período e situação (planejado, em andamento, concluído). ' +
          'Um módulo só começa depois que o anterior for concluído. As notas só podem ser lançadas em módulo já iniciado, e certificados e documentos só saem de módulo concluído.',
        href: '/admin/turmas',
        perm: 'turmas.editar',
      },
      { titulo: 'Período do módulo nos documentos', texto: 'certificados, declarações, históricos e a validação pública mostram o período do módulo, não o da turma inteira.' },
    ],
  },
  {
    versao: '1.2.0',
    data: '2026-11-16',
    novidades: [
      {
        titulo: 'Cursos e Matrizes',
        texto: 'cadastro de vários cursos, com dados do PPC, atos do curso, matriz curricular com versões (módulos e disciplinas com carga horária teórica e prática) e texto próprio do certificado.',
        href: '/admin/cursos',
        perm: 'cursos.editar',
      },
      { titulo: 'Documentos de acordo com o curso', texto: 'cada certificado e documento usa automaticamente os atos e o texto do curso da turma do aluno.' },
      { titulo: 'Novas variáveis no texto do certificado', texto: 'por exemplo {ato_ppc_completo}, {carga_horaria_curso} e {instituicao}. Variável sem valor bloqueia a emissão.' },
    ],
  },
  {
    versao: '1.1.0',
    data: '2026-11-16',
    melhorias: [
      { titulo: 'Cadastro de Alunos reorganizado', texto: 'com ficha completa, busca e botões de ação no mesmo estilo do sysGEP.', href: '/admin/alunos', perm: 'alunos.editar' },
    ],
  },
  {
    versao: '1.0.0',
    data: '2026-11-16',
    resumo: 'Entrada em produção.',
    novidades: [
      {
        titulo: 'Sistema no ar',
        texto: 'em certificadostecnicos.institutoinovativa.org. Os QR codes dos certificados apontam para este endereço.',
      },
      {
        titulo: 'Proteção contra abusos',
        texto: 'limite de consultas por conexão na validação pública e nas tentativas de entrar no sistema.',
      },
    ],
  },
  {
    versao: '0.3.0',
    data: '2026-11-16',
    novidades: [
      {
        titulo: 'Importar Planilhas',
        texto: 'envio de alunos e de notas e frequência em .xlsx ou .csv. Antes de gravar, o sistema mostra uma conferência com os campos que faltam e quem ficará aprovado ou reprovado.',
        href: '/admin/importacao',
        perm: 'alunos.editar',
      },
    ],
  },
  {
    versao: '0.2.0',
    data: '2026-11-16',
    novidades: [
      {
        titulo: 'Declaração de conclusão de módulo e histórico escolar',
        texto: 'registrados com código e QR code, e consultáveis na validação pública como os certificados.',
        href: '/admin/documentos',
        perm: 'relatorios.emitir',
      },
    ],
  },
  {
    versao: '0.1.0',
    data: '2026-11-16',
    resumo: 'Primeira versão (fase de desenvolvimento).',
    novidades: [
      { titulo: 'Login com perfis de acesso', texto: 'admin master, administrador, coordenador e secretaria. Tudo o que é feito fica registrado na auditoria.' },
      { titulo: 'Cadastros', texto: 'instituição e atos regulatórios, curso e matriz do PPC, turmas, alunos e signatários.' },
      { titulo: 'Lançamento de resultados', texto: 'com a regra de aprovação do PPC (frequência, média e exame final).' },
      { titulo: 'Emissão do certificado em PDF', texto: 'com frente e verso, QR code, código de validação e registro (livro, folha e número).' },
      { titulo: 'Validação pública', texto: 'consulta do certificado pelo QR code ou pelo código, sem login.', href: '/v' },
    ],
  },
];

export const VERSAO_ATUAL: Versao = VERSOES[0];
