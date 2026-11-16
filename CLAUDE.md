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
  Valores confirmados pela direção em 16/11/2026. Camada extra opcional: regra de WAF na zona (ver README).
- Menu lateral no estilo SysGEP (seções recolhíveis: Secretaria, Cadastros, Sistema) em `src/views/layout.tsx`.
- "Emissão de Certificados" (`/admin/certificados/pendentes`): aprovados aguardando certificado, por turma.

### Emissão (fase 3)
- Código SISTEC e data do SISTEC são **obrigatórios no momento da emissão** (bloqueado também por trigger no banco).
- Registro (nº/folha/livro) sugerido automaticamente a partir de "registros por folha" e "folhas por livro"
  (tela da instituição), editável antes de emitir; não pode repetir.
- QR code aponta para `{URL_PUBLICA}/v/{codigo}?t={token}`; o verso imprime o código e a URL sem o token.
- PDF gerado com pdf-lib a partir do snapshot (não do cadastro vivo), fonte Carlito embutida inteira e sem
  ligaduras (o recorte de fonte do pdf-lib perde glifos). PDF de prévia sai com marca d'água e sem QR.
