# Sistema de Certificados — Instituto Inovativa

## Objetivo
Sistema web para cadastrar instituição, cursos, matrizes curriculares, turmas e alunos, e emitir
certificados de qualificação profissional em PDF (frente + verso com matriz/histórico), cada um com
QR code que leva a uma página pública de validação.

Prazo: primeira emissão real em dezembro/2026. Priorizar o essencial funcionando antes de refinamentos.

## Stack (Cloudflare)
- **Workers** com **Hono** (TypeScript) para API e páginas.
- **D1** (SQLite) como banco. Migrações versionadas em `/migrations`.
- **R2** para PDFs emitidos, logos, assinaturas digitalizadas e imagens de fundo.
- **Login próprio** (usuário e senha) protegendo `/admin/*`, com perfis de acesso — ver seção DECISÕES DA DIREÇÃO.
  (Substitui o Cloudflare Access previsto originalmente; o Access pode ser somado depois como camada extra.)
- Frontend do painel: HTML renderizado no servidor (Hono JSX) + um pouco de JS. Sem framework pesado.
- PDF: `pdf-lib` dentro do Worker. QR code: biblioteca pura em JS (ex.: `qrcode-generator`).
- Deploy com `wrangler`. Ambientes `dev` e `production`.

## Modelo de dados

### instituicao (normalmente 1 registro, mas suportar mais de uma unidade/polo)
- razao_social, nome_fantasia, cnpj
- mantenedora (razão social e CNPJ, opcionais)
- endereco, municipio, uf, cep, telefone, email, site
- **ato_credenciamento**: tipo (Portaria, Resolução, Parecer, Deliberação), número, data,
  órgão emissor (ex.: Conselho Estadual de Educação/MS), data de publicação, veículo (ex.: DOE/MS)
- **ato_criacao** da instituição: tipo, número, data, órgão
- validade do credenciamento (data), para alertar vencimento
- logo (R2), cor principal

### cursos
- nome, tipo (Qualificação Profissional / FIC, Curso Livre, Aperfeiçoamento, Especialização Técnica)
- **eixo_tecnologico** (lista fixa do CNCT, editável): Ambiente e Saúde; Controle e Processos Industriais;
  Desenvolvimento Educacional e Social; Gestão e Negócios; Informação e Comunicação; Infraestrutura;
  Produção Alimentícia; Produção Cultural e Design; Produção Industrial; Recursos Naturais; Segurança;
  Turismo, Hospitalidade e Lazer; Militar
- **codigo_cbo** (ocupação associada, opcional, pode ter mais de um)
- carga_horaria_total, modalidade (presencial / EAD / híbrido)
- **ato_criacao_curso**: tipo, número, data, órgão
- **ato_autorizacao_curso**: tipo, número, data, órgão, data de publicação, veículo
- ato de reconhecimento/renovação (opcional, mesmos campos)
- perfil_profissional_conclusao (texto), requisitos_acesso, escolaridade_minima
- itinerario_formativo (texto, opcional)
- frequencia_minima (%) e nota/conceito mínimo para aprovação
- ativo (sim/não)

> Os atos (credenciamento, criação, autorização, reconhecimento) devem usar uma tabela única
> `atos_regulatorios` ligada à instituição ou ao curso, para não repetir colunas.

### matriz_curricular (versionada — um curso pode mudar de matriz ao longo do tempo)
- curso_id, versao, vigente_desde
- módulos (opcional) → componentes curriculares: nome, carga_horaria_teorica,
  carga_horaria_pratica, carga_horaria_total, ordem
- estágio supervisionado (sim/não, carga horária)
- A turma fica presa à versão da matriz usada; certificados antigos não mudam se a matriz mudar.

### turmas
- curso_id, matriz_id, codigo, polo/local, data_inicio, data_fim, turno

### alunos
- nome_civil, **nome_social** (se houver, é o que aparece no certificado)
- cpf (único), rg, orgao_emissor, uf_rg
- data_nascimento, naturalidade (município/UF), nacionalidade
- escolaridade, email, telefone
- Importação em lote por planilha CSV.

### matriculas
- aluno_id, turma_id, situação (cursando, concluído, reprovado, desistente)
- frequência final (%), data de conclusão
- resultados por componente: nota ou conceito, frequência

### certificados
- codigo_validacao (formato `INV-AAAA-NNNNN`, sequencial por ano) + token aleatório curto na URL
- matricula_id
- **registro**: livro, folha, número de registro (preenchidos automaticamente, editáveis)
- data_emissao, local de emissão
- signatários (nome, cargo, assinatura em R2): ex. Diretor(a) e Secretário(a) Escolar
- status: válido, revogado, substituído (2ª via)
- motivo_revogacao, certificado_substituto_id
- hash SHA-256 dos dados que aparecem no PDF
- pdf_r2_key
- **snapshot JSON** de todos os dados impressos (instituição, atos, curso, matriz, aluno),
  para que a validação mostre exatamente o que foi emitido mesmo se cadastros mudarem depois.

### auditoria
- quem (usuário logado), quando, ação, entidade, dados antes/depois, IP. Somente inclusão (não se altera nem apaga).

## Funcionalidades

### Painel (`/admin`, protegido)
1. Cadastro da instituição e seus atos regulatórios.
2. CRUD de cursos, atos do curso e matrizes (com versão).
3. CRUD de turmas; importação de alunos por CSV; lançamento de resultados.
4. Emissão individual e em lote (todos os concluintes aptos de uma turma).
   Bloquear emissão se faltar campo obrigatório ou se o aluno não atingir frequência/nota mínima,
   mostrando o motivo.
5. Pré-visualização do PDF antes de emitir.
6. Revogar e emitir 2ª via.
7. Livro de registro exportável (CSV/PDF) com todos os certificados emitidos.

### Página pública (`/v/{codigo}`)
- Mostra: nome do aluno, CPF mascarado (`***.456.789-**`), curso, eixo tecnológico, carga horária,
  período, data de emissão, registro (livro/folha/nº), atos de autorização, status.
- Botão para baixar o PDF original.
- Formulário de consulta manual pelo código.
- Status revogado aparece em destaque. Não expor mais dados pessoais que isso (LGPD).

### Certificado (PDF, A4 paisagem)
- **Frente**: logo, nome da instituição e ato de credenciamento, texto de certificação
  (modelo editável com variáveis como `{{aluno}}`, `{{curso}}`, `{{carga_horaria}}`,
  `{{eixo}}`, `{{periodo}}`, `{{ato_autorizacao}}`), local e data, assinaturas, QR code e código.
- **Verso**: matriz curricular com componentes, carga horária e resultados, frequência final,
  perfil profissional de conclusão, dados de registro (livro/folha/nº), CBO, QR code repetido.

## Regras importantes
- Nunca apagar certificado; só revogar.
- Código de validação nunca é reaproveitado.
- Datas em formato brasileiro na interface e no PDF; armazenar em ISO.
- Toda a interface em português.
- Testes automatizados para: geração do código, cálculo de aptidão, hash, e página de validação.

## Ordem de construção (PRAZO: entrega em 05/12/2026)
Seguir esta ordem. Usar dados fictícios até os reais chegarem; tudo que vem do PPC já é definitivo.
1. Projeto, wrangler, D1 com migrações e seed real da instituição, atos, curso e matriz (seção AJUSTES).
2. Painel com cadastro de alunos, turma e resultados + **prévia visual do certificado em tela**
   (frente e verso no layout do modelo aprovado, atualizando ao editar os dados), com 3 alunos fictícios.
   Logo e assinaturas como imagens substituíveis (placeholders até a direção enviar).
3. Geração do PDF a partir da mesma prévia + QR code + código de validação.
4. Página pública de validação.
5. Declaração de conclusão de módulo e histórico escolar (mesmo motor da prévia).
6. Importação da planilha de alunos e resultados, com relatório de campos faltantes e conferência de aprovação.
7. Deploy em produção (domínio certificadostecnicos.institutoinovativa.org) e criação do primeiro admin master.
Depois de 05/12: emissão em lote, revogação, 2ª via, livro de registro exportável, ata de resultados.

---

## AJUSTES OBRIGATÓRIOS (a partir do PPC aprovado — prevalecem sobre o que estiver acima)

O primeiro curso é um **Curso Técnico de nível médio** regulado pelo CEE/MS, não um curso livre.
Os certificados de dezembro são **certificados intermediários de Qualificação Profissional Técnica**,
um por módulo temático concluído. O layout deve reproduzir fielmente o modelo aprovado no PPC;
o QR code e o código de validação são acréscimos discretos, sem alterar o texto aprovado.

### Campos adicionais
- **cursos**: `area_tecnologica` (ex.: Gerencial), `forma_oferta` (Concomitante/Subsequente),
  `nivel` (Educação Profissional Técnica de nível médio), `oferta_experimental` (sim/não),
  `prazo_integralizacao_anos`.
- **modulos_tematicos** (substitui "módulos" genéricos): nome, carga horária,
  `tem_terminalidade`, `qualificacao_conferida` (título impresso no certificado).
  O TCC é um componente do curso fora dos módulos.
- **alunos**: `nome_pai`, `nome_mae`, `rg_orgao_expedidor`, `rg_uf`, `sexo`, `cor_raca`,
  `naturalidade_municipio`, `naturalidade_uf`, `nacionalidade`, `ra`,
  `ensino_medio_instituicao`, `ensino_medio_municipio`, `ensino_medio_uf`, `ensino_medio_ano_conclusao`
  (obrigatórios no verso — exigência do art. 76, II, "a" da Deliberação CEE/MS 10.603/2014).
- **certificados**: `tipo` (qualificação intermediária | diploma técnico), `modulo_id`,
  `registro_numero`, `folha`, `livro`, `ano_letivo`, `codigo_autenticacao_sistec`,
  `data_registro_sistec`. **Não permitir emissão final sem o código SISTEC preenchido.**
- **resultados por disciplina**: nota (0–10), nota do exame final (opcional), frequência (%), resultado AP/RP.
- **atos_regulatorios**: adicionar tipo "Reconhecimento" e o campo `publicacao_doe` (número e data do DOE/MS).

### Regras de aprovação no módulo (seção 11.1.1 do PPC)
Aprovado se, em **todas** as disciplinas do módulo: frequência ≥ 75% **e**
(média ≥ 6,0 **ou** média final ≥ 5,0 após exame final). Caso contrário, reprovado.
Disciplinas aprovadas podem ser aproveitadas em nova matrícula no módulo.
Diploma técnico exige os 3 módulos + TCC + comprovante de ensino médio (prazo de 3 anos).

### Documentos a gerar (além do certificado)
1. **Histórico escolar**: anverso com disciplinas, CH, frequência e aproveitamento;
   verso com perfil profissional de conclusão e competências do módulo.
2. **Ata de resultados finais** por módulo/turma (legenda AP/RP), assinada por Diretora Pedagógica e Secretário(a).
3. **Livro de registro** de certificados.

### Texto da frente (modelo aprovado — variáveis entre chaves)
"A Direção do Instituto Inovativa de Educação, Ciência e Tecnologia - IECT no uso de suas atribuições,
de acordo com a Lei nº 9.394/1996, a Resolução CNE/CP Nº 1, de 5 de janeiro de 2021 e a Deliberação
CEE/MS nº 10.603/2014 e com o disposto no Projeto Pedagógico do {curso} - Eixo Tecnológico: {eixo} -
Área Tecnológica: {area} - {nivel}, aprovado, conforme Deliberação CEE/MS nº {ato_ppc_numero}, de
{ato_ppc_data_extenso} confere ao(a) estudante {nome}, nacionalidade {nacionalidade}, natural de
{naturalidade_municipio}, Estado de {naturalidade_uf}, nascido(a) em {data_nascimento_extenso},
RG {rg} Org. Expedidor {rg_orgao}-{rg_uf}, filho(a) de {nome_pai} e {nome_mae}, o presente
CERTIFICADO por ter concluído com êxito o MÓDULO TEMÁTICO DA QUALIFICAÇÃO PROFISSIONAL TÉCNICA
{modulo}, conferindo-lhe o título de {qualificacao}."
Assinaturas: Diretora Pedagógica, Titular (o próprio aluno, em branco para assinar), Secretário(a).
Cabeçalho: nome, endereço, "Credenciamento Deliberação CEE/MS nº 10.994, de 6 de fevereiro de 2017".

### Verso (modelo aprovado)
Conclusão do Ensino Médio (instituição, município, UF, ano) · Registro do IECT (certificado,
registro nº, folha, livro, ano letivo, local e data, assinaturas) · Registro do SISTEC (código de
autenticação, local e data) · QR code + código de validação.

### Dados iniciais (seed)
Instituição: Instituto Inovativa de Educação, Ciência e Tecnologia - IECT · Mantenedora: Instituto de
Inovação, Tecnologia e Desenvolvimento Educacional – Inovativa · CNPJ 44.362.171/0001-36 ·
Rua do Rosário, 815, Coronel Antonino, Campo Grande/MS, 79010-310.
Atos (confirmados pela direção):
- Criação da instituição — Ata nº 01, de 23/02/2010.
- Credenciamento para Educação Profissional Técnica de Nível Médio — Deliberação CEE/MS nº 10.994, de 06/02/2017.
- Curso Técnico em Inovação e Desenvolvimento Corporativo (aprovação do PPC e autorização de
  funcionamento) — Deliberação CEE/MS nº 13.111, de 18/12/2024. Processo NUP 29.092.431-2024.
- Publicação no DOE/MS: pendente (campo opcional até ser informado).
- Reconhecimento do curso: pendente.

Na frente do certificado: `{ato_ppc_numero}` = "13.111" e `{ato_ppc_data_extenso}` = "18 de dezembro de 2024".
No cabeçalho: "Credenciamento Deliberação CEE/MS nº 10.994, de 6 de fevereiro de 2017".
O ato de criação (ata) é tipo "Ata", órgão emissor = a própria mantenedora; não aparece no certificado,
mas fica no cadastro da instituição.

Curso: Técnico em Inovação e Desenvolvimento Corporativo · Gestão e Negócios · Área Gerencial ·
Concomitante/Subsequente · oferta experimental · 1200 h + TCC 100 h = 1300 h · integralização 4 anos.

| Módulo | Disciplina | CH |
|---|---|---|
| Qualidade → Inspetor de Qualidade (400 h) | Atendimento a Clientes e Fornecedores | 80 |
| | Introdução a Gestão da Qualidade | 40 |
| | Sustentabilidade no Ambiente de Trabalho | 40 |
| | Gestão por Resultados | 80 |
| | Ferramentas para Gestão da Qualidade | 80 |
| | Investigação Científica e Tecnológica | 80 |
| Empreendedorismo → Empreendedor Corporativo (400 h) | Design Thinking | 80 |
| | Educação Financeira | 80 |
| | Marketing Digital | 80 |
| | E-Commerce | 40 |
| | Empreendedorismo | 40 |
| | Desenvolvimento Local | 80 |
| Ambiente Organizacional → Trabalhador em Ambiente Organizacional (400 h) | Qualidade de Vida, Segurança e Saúde no Trabalho | 80 |
| | Comunicação Oral e Escrita | 40 |
| | Postura e Ética Profissional | 40 |
| | Legislação do Trabalho | 80 |
| | Gestão de Conflitos | 80 |
| | Empresa Pedagógica | 80 |
| TCC | Trabalho de Conclusão de Curso | 100 |

Teste obrigatório: a soma de cada módulo deve dar 400 h e o curso 1300 h.

---

## DECISÕES DA DIREÇÃO (13/11/2026 — prevalecem sobre o que estiver acima)

- **CNPJ 44.362.171/0001-36 é do IECT.** CNPJ da mantenedora: não informado.
- **Domínio público**: `certificadostecnicos.institutoinovativa.org` (QR code e página `/v/{codigo}`).
  Decisão de 16/11/2026: substitui `certificadostecnicos.inovativa.com.br`, porque inovativa.com.br usa o DNS do
  Registro.br e institutoinovativa.org já está na Cloudflare (domínio próprio do Worker + WAF sem migrar DNS).
- **Parâmetros de aprovação editáveis na tela** (por curso): frequência mínima, média mínima, média mínima
  após exame e forma de cálculo da média final após exame (média ponderada com pesos, exame substitui a
  média, ou maior nota). Padrão: ponderada 1:1, 75% / 6,0 / 5,0.
- **Signatários**: cadastro com upload da assinatura digitalizada (PNG/JPG) e da portaria de nomeação
  (tipo, número, data, órgão e PDF). Um signatário ativo por função (Diretor(a) Pedagógico(a), Secretário(a)).
- **Usuários e perfis** (login próprio com e-mail e senha; toda ação registrada na auditoria):
  - **Admin master**: vê e faz tudo, inclusive gerenciar usuários.
  - **Administrador**: vê quase tudo — não gerencia usuários nem revoga certificados.
  - **Coordenador** e **Secretaria**: cadastram alunos e turmas, lançam resultados, emitem relatórios/prévias
    e **emitem certificados** (decisão de 13/11/2026). Revogação/2ª via continua só com o admin master.
  - A matriz de permissões fica em `src/auth/permissoes.ts` (fonte única, exibida na tela de usuários).
- Senhas: PBKDF2-SHA256; senha temporária com troca obrigatória no 1º acesso; bloqueio de 15 min após 5 erros.
- O primeiro admin master é criado por `node scripts/criar-usuario.mjs` (não há cadastro aberto).

### Modelo do certificado e visual (13/11/2026)
- Tela **Modelo do certificado** (`/admin/modelo`): upload do fundo da frente, fundo do verso (se ausente,
  usa o da frente), logo e assinaturas, com prévia (tela e PDF) usando aluno fictício. Imagens antigas
  ficam no R2; certificados emitidos guardam no snapshot as chaves das imagens usadas.
- Visual do painel com as cores do logo: marinho #003C80, azul #2D7BB9, ciano #25A0DC,
  verde-água #00A890, verde #6EBE8B. Tokens de cor em `src/views/layout.tsx`.
- Tema **claro / escuro / automático** escolhido por usuário (salvo no cadastro e em cookie).

### Validação pública (fase 4) e menu
- `/v` (consulta pelo código) e `/v/{codigo}` sem login, com `noindex`. Mostra só os dados listados acima,
  CPF mascarado, a partir do snapshot. Revogado/substituído em destaque.
- **PDF original só com a chave do QR code** (`?t=token`): o código INV é sequencial e o PDF contém RG,
  filiação e nascimento (LGPD). Consulta manual pelo código mostra os dados, mas não libera o PDF.
- Toda consulta pública é registrada na auditoria como usuário "público".
- **Limite por IP** (Rate Limiting nativo do Workers, `[[ratelimits]]` no `wrangler.toml`, middleware
  `src/lib/limite.ts`): `/v` 20 consultas/min; `POST /login` 10 tentativas/min. Excedeu → página 429.
  Valores confirmados pela direção em 16/11/2026. **Em produção o limitador do Workers não bloqueou** (teste de
  16/11/2026); a proteção efetiva é a regra de WAF da zona (ver README), **criada e testada em 16/11/2026**: rajadas em `/v` e
  `POST /login` recebem 429 da Cloudflare; o acesso normal volta em segundos. Consultas a códigos inexistentes não gravam
  na auditoria (só log), para uma varredura não esgotar a cota diária de gravações do D1.
- Menu lateral no estilo SysGEP (seções recolhíveis: Secretaria, Cadastros, Sistema) em `src/views/layout.tsx`.
- "Emissão de Certificados" (`/admin/certificados/pendentes`): aprovados aguardando certificado, por turma.

### Declaração e histórico (fase 5)
- **Motor de documentos** (`src/documentos/`): o documento é uma lista de blocos (título, seção, parágrafo,
  campos, tabela, lista, nota, assinaturas) renderizada em HTML (prévia) e em PDF (A4 retrato), com quebra
  automática de página. Reutilizar para ata de resultados e livro de registro.
- Declaração e histórico são **registrados** (tabela `documentos`): código INV na mesma sequência dos
  certificados, chave do QR, snapshot (layout + resumo), hash, PDF no R2; validados em `/v` como os certificados.
- **Declaração de conclusão de módulo**: o PPC não tem modelo; texto proposto e editável (com versões guardadas)
  em Modelo do certificado. Exige aprovação no módulo. Cita o registro do certificado quando já emitido.
- **Histórico escolar por módulo**: anverso com identificação, disciplinas (CH, média final, frequência, AP/RP);
  verso com perfil profissional e competências do módulo (cadastrar em Cursos → perfil e competências, a partir
  do PPC). Exige notas completas; aluno reprovado também pode receber (mostra RP).

### Importação de planilhas (fase 6)
- `/admin/importacao` (Secretaria → Importar Planilhas). Aceita **.xlsx** e **.csv** (UTF-8 ou Windows-1252,
  separador ; , ou tab). Cabeçalhos flexíveis (apelidos em `src/importacao/alunos.ts`), CPF sem zero à esquerda,
  datas do Excel (série), "7,5", "95%".
- Fluxo: enviar → **conferência** (nada gravado) → aplicar em lote atômico; linhas com erro são ignoradas.
  Arquivo guardado no R2 e registro em `importacoes`; auditoria do envio e da aplicação com os detalhes.
- **Alunos**: chave CPF; matrícula opcional na turma; existentes: "só preencher vazios" (padrão) ou "substituir".
  Relatório de campos faltantes para o certificado.
- **Notas e frequência** por turma + módulo: modelo baixado já preenchido (formato "Disciplina | Média/Exame/
  Frequência (%)") ou formato uma linha por disciplina; células vazias não alteram; conferência mostra quem ficará
  aprovado/reprovado (PPC 11.1.1). Aluno precisa estar matriculado na turma.
- Aguardando a planilha real da secretaria para ajustar apelidos de cabeçalho, se necessário.

### Vários cursos (16/11/2026)
- Cadastros → **Cursos e Matrizes** (`src/rotas/cursos-gestao.tsx`): cadastro do curso (dados do PPC, CBO), atos do
  curso, matriz curricular versionada (módulos, disciplinas com CH teórica/prática/total, TCC/estágio) e textos.
- Cada documento usa automaticamente **os atos e o texto do curso da turma** + **os fixos da instituição**
  (cabeçalho, credenciamento, logo, fundos, assinaturas). Texto do curso → senão texto padrão geral (migração 0009).
- Variáveis extras no texto: `{ato_ppc_completo}`, `{ato_reconhecimento_completo}`, `{ato_criacao_curso_completo}`,
  `{ato_credenciamento_completo}`, `{instituicao}`, `{mantenedora}`, `{carga_horaria}`, `{carga_horaria_curso}`.
  Variável usada sem valor bloqueia a emissão.
- Matriz em uso por turma fica travada (crie nova versão, que copia a anterior). Módulo cuja soma das disciplinas
  difere da CH do módulo bloqueia a emissão.

### Módulos em sequência (decisão da direção, 16/11/2026)
- **Uma turma faz o curso inteiro, com os módulos em ordem.** Tabela `turma_modulos` (migração 0010): período
  (início/término) e situação (planejado → em andamento → concluído) de cada módulo na turma. Regras em
  `src/lib/turmaModulos.ts`: módulo só inicia/conclui com o anterior concluído; notas só em módulo iniciado
  (tela e importação); certificado, declaração e histórico só de módulo concluído; o aluno precisa estar
  aprovado nos módulos anteriores (certificado e declaração); módulo com certificado emitido não reabre;
  módulo com notas não volta a "planejado". Turma nova nasce com o módulo 1 em andamento.
- Documentos e validação usam o **período do módulo** (snapshot `modulo.periodo`), não o da turma inteira.
- Pendente para depois: rematrícula em módulo com aproveitamento de disciplinas aprovadas (PPC).

### Atos regulatórios publicados (decisão da direção, 16/11/2026)
- **Todo ato/deliberação cadastrado já foi devidamente publicado.** Não existe status "pendente" de publicação:
  telas mostram "publicado"; nº/data do DOE/MS são opcionais (só para registro). Sem avisos de DOE no Início,
  na prévia ou na emissão. (Substitui a linha "Publicação no DOE/MS: pendente" dos dados iniciais.)

### Navegação, visual e relatórios (16/11/2026)
- Botão **Voltar** padrão no layout (`Pagina` prop `voltar`; sem ela, sobe para a tela existente acima — `caminhoPai`).
- Tela da turma redesenhada: cabeçalho com dados, resumo, módulos como etapas, alunos com estado vazio.
- **Secretaria → Relatórios** (`/admin/relatorios`, permissão `relatorios.emitir`: todos os perfis):
  - Alunos por situação de matrícula (filtros situação/curso/turma) em PDF, tela ou CSV.
  - Todo relatório traz **quem emitiu, data e hora** (cabeçalho do PDF/rodapé de todas as páginas) e vai para a auditoria.
  - Motor de documentos aceita `rodape` próprio (sem QR) e numera as páginas.

### Produção (fase 7 — 16/11/2026)
- No ar em https://certificadostecnicos.institutoinovativa.org, conta Cloudflare **Admin@institutoinovativa.org's
  Account** (`account_id` 43c07b1a… no `wrangler.toml`), onde está a zona institutoinovativa.org.
- Primeiro admin master: coord.tiinovativa@institutoinovativa.org (senha temporária, troca obrigatória).
- **Recursos antigos mantidos por decisão do usuário**: na conta Coord.tiinovativa@institutoinovativa.org's Account
  (ebc3ab0a…) ficaram o Worker, o D1 e o R2 `certificados-iect`, vazios e sem endereço público. NÃO são produção.

### Emissão (fase 3)
- Código SISTEC e data do SISTEC são **obrigatórios no momento da emissão** (bloqueado também por trigger no banco).
- Registro (nº/folha/livro) sugerido automaticamente a partir de "registros por folha" e "folhas por livro"
  (tela da instituição), editável antes de emitir; não pode repetir.
- QR code aponta para `{URL_PUBLICA}/v/{codigo}?t={token}`; o verso imprime o código e a URL sem o token.
- PDF gerado com pdf-lib a partir do snapshot (não do cadastro vivo), fonte Carlito embutida inteira e sem
  ligaduras (o recorte de fonte do pdf-lib perde glifos). PDF de prévia sai com marca d'água e sem QR.

### Modelo atualizado do certificado e Notas e Faltas (16/11/2026)
- Modelo novo (`MODELOS CERTIFICADOS/Modelo_Certificado_IECT_PPC.docx`): fonte Arial (no sistema: **Arimo**, métricas
  idênticas, OFL, em `public/fontes`), **negrito parcial** no texto da frente (marcado com `**...**` no texto do modelo;
  migração 0011 aplica nos textos existentes) e verso **sem** a linha "(Verso do Certificado da ...)".
- **Portarias abaixo das assinaturas** (decisão da direção): nome do signatário + "Portaria nº X, de dd/mm/aaaa" (do cadastro
  de Signatários) na frente e no verso do certificado e nas declarações/históricos. Sem portaria → aviso na prévia.
- **Secretaria → Notas e Faltas** (`/admin/diario`, `src/rotas/diario.tsx`, permissão `resultados.lancar`): turma → módulo →
  disciplina. Por disciplina na turma (`turma_disciplinas`): professor, dias da semana, horário de início/término e tempo de
  cada aula (min). Faltas em **nº de aulas** (`resultados.faltas`); frequência calculada (`src/lib/frequencia.ts`):
  100 × (1 − faltas × tempo da aula ÷ 60 ÷ CH). Faltas não podem passar das aulas previstas; mudar o tempo da aula recalcula.
  A tela antiga de lançamento por disciplina (Turmas) redireciona para cá.
- Pendente: importar faltas pela planilha (hoje a importação aceita frequência em %).


### Excluir turma (16/11/2026)
- Tela da turma → "Excluir turma (cadastrada por engano)", permissão `turmas.excluir` (admin master e administrador).
- Confirmação digitando o código da turma. Apaga, em lote atômico, matrículas, resultados, períodos dos módulos,
  professores/horários das disciplinas e importações da turma; cadastros de alunos ficam. Auditoria guarda tudo no "antes".
- **Bloqueada** se houver qualquer certificado ou documento emitido para alunos da turma (esses nunca são apagados).

### Novidades do Sistema (17/11/2026)
- Sistema → **Novidades do Sistema** (`/admin/novidades`, todos os perfis), no estilo do "Sobre o sistema" do sysGEP:
  versão atual, busca (sem acento) e cada versão com Novidades / Melhorias / Correções e links para as telas
  (link só aparece se o perfil tem permissão).
- Fonte única: `src/novidades.ts`. **A cada entrega: nova versão no topo da lista + `version` do package.json**
  (teste confere). Texto para a secretaria, em linguagem simples. 0.x = desenvolvimento; 1.0.0 = produção.
- Versão nova não vista (por navegador, `localStorage`): selo "novo" ao lado da versão no rodapé do menu e aviso no Início.

### RG unificado ao CPF e texto de autorização (17/11/2026)
- **RG unificado ao CPF (CIN)**: chave no cadastro do aluno (`alunos.rg_unificado_cpf`, migração 0012). Ligada → RG = CPF
  formatado (sincronizado ao salvar, `ajustarRgUnificado` em `src/lib/cpf.ts`); RG digitado/importado igual ao CPF liga a chave.
  Órgão expedidor e UF continuam obrigatórios.
- **Atos no cabeçalho (padrão sysGEP, decisão de 17/11/2026)**: a linha "Atos autorizativos vigentes" foi **substituída** por
  1º as linhas FIXAS da instituição (`instituicoes.texto_atos`, migração 0014, tela Instituição: "Criação: ata n. 01, de 23/02/2010." e
  "Educação Profissional Técnica de Nível Médio credenciamento: Deliberação CEE/MS n. 10994, de 06/02/2017.") e, logo abaixo,
  2º as DINÂMICAS do curso da turma (`cursos.texto_autorizacao`, Cursos e Matrizes → Dados do curso → Autorização:
  "Curso Técnico em ...: Deliberação CEE/MS n. 13111, de 18/12/2024"). Migrações 0013 (curso) e 0014 (instituição + curso no formato "n. 13111") preenchem a partir dos atos. A 0013 foi aplicada em produção na 1ª versão: **nunca reescrever migração já aplicada** — corrigir com uma nova.
  Texto livre, impresso como digitado (uma linha por linha). Vazio → só aviso. Snapshot: `instituicao.atos`; certificados sem
  esse campo continuam com "Credenciamento..." + "Atos autorizativos vigentes". **A linha "Credenciamento Deliberação..." foi
  retirada** do cabeçalho de todos os documentos quando há atos (decisão da direção, 17/11/2026 — já está nas linhas fixas;
  substitui as linhas 185 e 205 acima). Na declaração/histórico os atos saem em 7 pt agrupados ("a · b") para o histórico
  caber em 2 páginas. Linhas além de 2 são compensadas nos respiros do certificado (`espacosCabecalho`, `linhasCabecalho`).
- **Telefone e e-mail** da instituição saem na linha do endereço de todos os documentos (`linhaEndereco` em
  `src/certificado/dados.ts`); linha do cabeçalho que não couber na largura diminui a fonte (`tamanhoQueCabe`), nunca ultrapassa a margem.

### Prévia em tela com QR code de exemplo (16/11/2026)
- Tela de emissão do certificado mostra a prévia (frente e verso) embutida ("Como vai ficar", `/admin/previa/{mat}/{mod}?embutida=1`)
  e botão "Ver em tela"; declaração e histórico idem (prévia embutida + "Ver em tela" + PDF de prévia).
- Todas as prévias (tela e PDF) trazem um **QR code de exemplo** no mesmo lugar e tamanho do definitivo (`src/lib/qr.ts`), apontando
  para a página pública de consulta (`/v`), com o texto "INV-AAAA-NNNNN (exemplo)". Código INV e QR definitivo só na emissão.
