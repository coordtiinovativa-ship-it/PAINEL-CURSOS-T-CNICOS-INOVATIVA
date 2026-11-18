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
    versao: '1.15.0',
    data: '2026-11-18',
    melhorias: [
      { titulo: 'Nova ordem do menu', texto: 'Sistema, Cadastros, Gestão Pedagógica e Secretaria, nessa sequência.' },
      {
        titulo: 'Menu do perfil no canto superior direito',
        texto: 'clique no seu nome no alto da tela para trocar a aparência (claro, escuro ou automático), alterar a senha, ver as novidades ou sair.',
      },
    ],
  },
  {
    versao: '1.14.0',
    data: '2026-11-18',
    melhorias: [
      {
        titulo: 'Menu Gestão Pedagógica: Ano Letivo e Calendário Escolar primeiro',
        texto: 'são a base de tudo (lotação, horário e chamada usam o calendário), por isso agora abrem o menu.',
        href: '/admin/pedagogico/anos',
        perm: 'pedagogico.gerenciar',
      },
    ],
  },
  {
    versao: '1.13.0',
    data: '2026-11-18',
    novidades: [
      {
        titulo: 'Excluir calendário',
        texto: 'apaga todos os feriados, recessos, eventos e ajustes à mão do ano (o ano letivo continua) — para refazer o calendário do zero. ' +
          'Confirma digitando o ano; se algum dia com chamada deixar de ser letivo, o sistema avisa antes. Só admin master e administrador.',
        href: '/admin/pedagogico/calendario',
        perm: 'calendario.excluir',
      },
      {
        titulo: 'Excluir ano letivo',
        texto: 'em Ano Letivo → editar: apaga o ano e o calendário dele. Bloqueado se houver turmas no ano. Confirma digitando o ano; só admin master e administrador.',
        href: '/admin/pedagogico/anos',
        perm: 'calendario.excluir',
      },
    ],
  },
  {
    versao: '1.12.0',
    data: '2026-11-18',
    novidades: [
      {
        titulo: 'Gerar calendário automaticamente',
        texto: 'um clique monta o ano inteiro: segunda a sexta letivos, sábados e domingos, e os feriados nacionais (Carnaval e Corpus Christi como ponto facultativo). ' +
          'Ano letivo novo já nasce com o calendário gerado. Depois é só ajustar os dias diferentes.',
        href: '/admin/pedagogico/calendario',
        perm: 'pedagogico.gerenciar',
      },
      {
        titulo: 'Relatórios Controle de Notas e Controle de Faltas',
        texto: 'no modelo do sysGEP, em PDF paisagem, por turma e disciplina (ou todas as do módulo): notas com média, exame, média final, ' +
          'frequência e resultado; faltas dia a dia com o total. Matrículas não ativas aparecem destacadas (ex.: "TRANSF. 12/06/2026").',
        href: '/admin/relatorios#controle',
        perm: 'relatorios.emitir',
      },
      {
        titulo: 'Alerta ao alterar o calendário com chamada já feita',
        texto: 'se a alteração tirar um dia letivo que já tem chamada, o sistema avisa antes, lista as turmas e disciplinas e oferece o relatório de faltas. ' +
          'Só depois de confirmar os lançamentos desses dias são apagados — e precisarão ser refeitos.',
        href: '/admin/pedagogico/calendario',
        perm: 'pedagogico.gerenciar',
      },
      {
        titulo: 'Editar o dia no calendário',
        texto: 'clique num dia para trocar o código (L, F, NL, SL...) com uma descrição, ou voltar ao automático. Dias ajustados à mão ficam marcados com ✎ e já valem para a chamada.',
        href: '/admin/pedagogico/calendario',
        perm: 'pedagogico.gerenciar',
      },
    ],
    melhorias: [
      {
        titulo: 'Calendário de janeiro a dezembro',
        texto: 'os 12 meses aparecem sempre; os dias fora do período do ano letivo ficam esmaecidos (férias).',
        href: '/admin/pedagogico/calendario',
        perm: 'pedagogico.gerenciar',
      },
    ],
  },
  {
    versao: '1.11.0',
    data: '2026-11-18',
    novidades: [
      {
        titulo: 'Lançamento de Notas (Gestão Pedagógica)',
        texto: 'o coordenador escolhe a turma, o módulo e a disciplina e lança as notas de todos os alunos. Toda nota fica vinculada ao professor da disciplina (lotação). ' +
          'Alunos com matrícula não ativa aparecem bloqueados: a correção deles é só pela Secretaria.',
        href: '/admin/pedagogico/notas',
        perm: 'resultados.lancar',
      },
      {
        titulo: 'Status da matrícula',
        texto: 'Ativa, Desistente, Transferido, Matrícula cancelada, Falecido(a) e Transferência interna. Todo aluno entra como Ativa; ' +
          'a Secretaria altera na tela da turma (botão Status), informando a data e o motivo, e o histórico fica guardado.',
        href: '/admin/turmas',
        perm: 'matriculas.status',
      },
    ],
    melhorias: [
      {
        titulo: 'Secretaria: Notas e Faltas separados',
        texto: 'o antigo "Notas e Faltas" virou dois itens. Em Faltas, a Secretaria corrige a chamada por turma e dia ou, em disciplina sem chamada, o total de faltas. ' +
          'A Secretaria corrige qualquer aluno, inclusive com matrícula não ativa.',
        href: '/admin/notas',
        perm: 'resultados.corrigir',
      },
      {
        titulo: 'Calendário Escolar no padrão do sysGEP',
        texto: 'cada dia aparece como um bloco colorido com o código — L (letivo), D (domingo), S (sábado), SL (sábado letivo), F (feriado) e NL (não letivo). ' +
          'Cada mês mostra os totais de letivos e não letivos e a legenda com as contagens e os eventos; no topo, o período e os totais do ano. ' +
          'Visão por ano ou por mês; clicar num dia já preenche a data para incluir um evento.',
        href: '/admin/pedagogico/calendario',
        perm: 'pedagogico.gerenciar',
      },
      {
        titulo: 'Chamada só em dias letivos do calendário',
        texto: 'as datas da chamada vêm do horário do professor e passam pelo Calendário Escolar: só entram dias letivos. ' +
          'Aula de sábado no horário só aparece na chamada nos sábados marcados como "dia letivo extra".',
        href: '/admin/pedagogico/faltas',
        perm: 'resultados.lancar',
      },
      {
        titulo: 'Vale a última digitação',
        texto: 'se a Secretaria e o professor estiverem lançando ao mesmo tempo, cada um só grava o que mudou na própria tela e prevalece quem salvou por último — ninguém desfaz o que o outro digitou. ' +
          'Cada nota e falta guarda quem alterou, quando, de onde (Gestão Pedagógica, Secretaria, chamada ou planilha) e o histórico das alterações. Os documentos usam sempre o valor mais recente.',
      },
    ],
  },
  {
    versao: '1.10.0',
    data: '2026-11-17',
    melhorias: [
      {
        titulo: 'Horário do Professor em quadro de arrastar (estilo sysGEP)',
        texto: 'arraste a disciplina do painel para um horário livre (ou clique nela e depois no horário); arraste uma aula para mudá-la de lugar; ' +
          'solte-a de volta no painel ou dê dois cliques para remover. Tudo salva na hora, sem recarregar a página. ' +
          'Cada disciplina mostra as aulas por semana e quantas horas a grade cobre até o fim do módulo (descontando feriados e recessos) contra a carga horária.',
        href: '/admin/pedagogico/horario',
        perm: 'pedagogico.gerenciar',
      },
    ],
  },
  {
    versao: '1.9.0',
    data: '2026-11-17',
    resumo: 'Novo menu Gestão Pedagógica, no padrão do sysGEP.',
    novidades: [
      {
        titulo: 'Funcionários',
        texto: 'cadastro com dados pessoais, documentos, formação, contato, endereço, categorias (professor, coordenador...) e documentos anexos.',
        href: '/admin/pedagogico/funcionarios',
        perm: 'pedagogico.gerenciar',
      },
      {
        titulo: 'Lotação de Professores',
        texto: 'vincula o professor a cada disciplina da turma, por módulo. "Trocar" encerra a lotação atual com motivo e passa o horário para o novo professor; o histórico fica guardado.',
        href: '/admin/pedagogico/lotacao',
        perm: 'pedagogico.gerenciar',
      },
      {
        titulo: 'Horário do Professor',
        texto: 'grade semanal: escolha a disciplina e clique no horário livre. O sistema não deixa a turma ter duas aulas no mesmo tempo nem o professor estar em dois lugares. ' +
          'Os horários de cada tempo ficam em "Tempos de aula".',
        href: '/admin/pedagogico/horario',
        perm: 'pedagogico.gerenciar',
      },
      {
        titulo: 'Faltas do Aluno (chamada do dia)',
        texto: 'escolha o professor e a data — só aparecem os dias com aula no horário, sem feriados e recessos — e marque presença ou falta por tempo. ' +
          'A frequência da disciplina é calculada sozinha em Notas e Faltas.',
        href: '/admin/pedagogico/faltas',
        perm: 'resultados.lancar',
      },
      {
        titulo: 'Ano Letivo e Calendário Escolar',
        texto: 'período do ano letivo, dias letivos e calendário com feriados, recessos, pontos facultativos e eventos. O botão "Incluir feriados nacionais" já calcula Carnaval, Sexta-feira Santa e Corpus Christi.',
        href: '/admin/pedagogico/calendario',
        perm: 'pedagogico.gerenciar',
      },
    ],
    melhorias: [
      {
        titulo: 'Notas e Faltas ligadas à Gestão Pedagógica',
        texto: 'o professor vem da lotação (não é mais digitado), o horário e o tempo da aula vêm da grade e, quando a disciplina tem chamada registrada, as faltas vêm dela e não podem ser digitadas. ' +
          'Sem chamada, continua sendo possível lançar o total de faltas.',
        href: '/admin/diario',
        perm: 'resultados.lancar',
      },
      { titulo: 'Importação de notas', texto: 'a frequência de disciplina com chamada registrada não é sobrescrita pela planilha (aparece como coluna ignorada na conferência).' },
    ],
  },
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
        titulo: 'Prévia em Declarações e Históricos',
        texto: 'a tela Declarações e Históricos ganhou o quadro "Prévia e emissão": escolha a turma, o aluno, o módulo e o documento ' +
          'para ver a prévia em tela, abrir o PDF de prévia ou ir direto para a emissão, sem passar pela tela da turma.',
        href: '/admin/documentos',
        perm: 'relatorios.emitir',
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
