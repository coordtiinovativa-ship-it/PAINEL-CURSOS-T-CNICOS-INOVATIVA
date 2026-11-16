-- Migração 0002 — dados reais (PPC aprovado e atos confirmados pela direção)
-- IDs fixos para que outras migrações/seeds possam referenciá-los.

-- ---------------------------------------------------------------------
-- Eixos tecnológicos do CNCT
-- ---------------------------------------------------------------------
INSERT INTO eixos_tecnologicos (id, nome) VALUES
  (1,  'Ambiente e Saúde'),
  (2,  'Controle e Processos Industriais'),
  (3,  'Desenvolvimento Educacional e Social'),
  (4,  'Gestão e Negócios'),
  (5,  'Informação e Comunicação'),
  (6,  'Infraestrutura'),
  (7,  'Produção Alimentícia'),
  (8,  'Produção Cultural e Design'),
  (9,  'Produção Industrial'),
  (10, 'Recursos Naturais'),
  (11, 'Segurança'),
  (12, 'Turismo, Hospitalidade e Lazer'),
  (13, 'Militar');

-- ---------------------------------------------------------------------
-- Instituição
-- ---------------------------------------------------------------------
INSERT INTO instituicoes (
  id, razao_social, nome_fantasia, sigla, cnpj,
  mantenedora_razao_social, mantenedora_cnpj,
  endereco, bairro, municipio, uf, cep
) VALUES (
  1,
  'Instituto Inovativa de Educação, Ciência e Tecnologia - IECT',
  'Instituto Inovativa',
  'IECT',
  '44.362.171/0001-36',
  'Instituto de Inovação, Tecnologia e Desenvolvimento Educacional – Inovativa',
  '44.362.171/0001-36',
  'Rua do Rosário, 815',
  'Coronel Antonino',
  'Campo Grande',
  'MS',
  '79010-310'
);

-- Atos da instituição
INSERT INTO atos_regulatorios (id, instituicao_id, finalidade, tipo, numero, data, orgao_emissor, descricao) VALUES
  (1, 1, 'criacao_instituicao', 'Ata', '01', '2010-02-23',
      'Instituto de Inovação, Tecnologia e Desenvolvimento Educacional – Inovativa',
      'Ata de criação da instituição'),
  (2, 1, 'credenciamento', 'Deliberação', '10.994', '2017-02-06',
      'Conselho Estadual de Educação de Mato Grosso do Sul - CEE/MS',
      'Credenciamento para Educação Profissional Técnica de Nível Médio');

-- ---------------------------------------------------------------------
-- Curso Técnico em Inovação e Desenvolvimento Corporativo
-- ---------------------------------------------------------------------
INSERT INTO cursos (
  id, instituicao_id, nome, tipo, nivel, eixo_id, area_tecnologica,
  forma_oferta, modalidade, oferta_experimental, carga_horaria_total,
  prazo_integralizacao_anos, frequencia_minima, nota_minima, nota_minima_exame
) VALUES (
  1, 1,
  'Curso Técnico em Inovação e Desenvolvimento Corporativo',
  'Curso Técnico',
  'Educação Profissional Técnica de nível médio',
  4,                       -- Gestão e Negócios
  'Gerencial',
  'Concomitante/Subsequente',
  'presencial',
  1,
  1300,                    -- 1200 h + TCC 100 h
  4,
  75, 6.0, 5.0
);

-- Aprovação do PPC e autorização de funcionamento (publicação no DOE/MS: pendente)
INSERT INTO atos_regulatorios (id, curso_id, finalidade, tipo, numero, data, orgao_emissor, descricao, processo, veiculo_publicacao) VALUES
  (3, 1, 'autorizacao_curso', 'Deliberação', '13.111', '2024-12-18',
      'Conselho Estadual de Educação de Mato Grosso do Sul - CEE/MS',
      'Aprovação do Projeto Pedagógico do Curso e autorização de funcionamento',
      'NUP 29.092.431-2024',
      'DOE/MS');
-- Reconhecimento do curso: pendente (será cadastrado quando houver o ato).

-- ---------------------------------------------------------------------
-- Matriz curricular v1
-- ---------------------------------------------------------------------
INSERT INTO matrizes_curriculares (id, curso_id, versao, vigente_desde, descricao)
VALUES (1, 1, 1, '2024-12-18', 'Matriz do PPC aprovado pela Deliberação CEE/MS nº 13.111/2024');

INSERT INTO modulos_tematicos (id, matriz_id, ordem, nome, carga_horaria, tem_terminalidade, qualificacao_conferida) VALUES
  (1, 1, 1, 'Qualidade',               400, 1, 'Inspetor de Qualidade'),
  (2, 1, 2, 'Empreendedorismo',        400, 1, 'Empreendedor Corporativo'),
  (3, 1, 3, 'Ambiente Organizacional', 400, 1, 'Trabalhador em Ambiente Organizacional');

INSERT INTO componentes_curriculares (id, matriz_id, modulo_id, tipo, ordem, nome, carga_horaria_total) VALUES
  -- Módulo 1 — Qualidade
  (1,  1, 1, 'disciplina', 1, 'Atendimento a Clientes e Fornecedores', 80),
  (2,  1, 1, 'disciplina', 2, 'Introdução a Gestão da Qualidade', 40),
  (3,  1, 1, 'disciplina', 3, 'Sustentabilidade no Ambiente de Trabalho', 40),
  (4,  1, 1, 'disciplina', 4, 'Gestão por Resultados', 80),
  (5,  1, 1, 'disciplina', 5, 'Ferramentas para Gestão da Qualidade', 80),
  (6,  1, 1, 'disciplina', 6, 'Investigação Científica e Tecnológica', 80),
  -- Módulo 2 — Empreendedorismo
  (7,  1, 2, 'disciplina', 1, 'Design Thinking', 80),
  (8,  1, 2, 'disciplina', 2, 'Educação Financeira', 80),
  (9,  1, 2, 'disciplina', 3, 'Marketing Digital', 80),
  (10, 1, 2, 'disciplina', 4, 'E-Commerce', 40),
  (11, 1, 2, 'disciplina', 5, 'Empreendedorismo', 40),
  (12, 1, 2, 'disciplina', 6, 'Desenvolvimento Local', 80),
  -- Módulo 3 — Ambiente Organizacional
  (13, 1, 3, 'disciplina', 1, 'Qualidade de Vida, Segurança e Saúde no Trabalho', 80),
  (14, 1, 3, 'disciplina', 2, 'Comunicação Oral e Escrita', 40),
  (15, 1, 3, 'disciplina', 3, 'Postura e Ética Profissional', 40),
  (16, 1, 3, 'disciplina', 4, 'Legislação do Trabalho', 80),
  (17, 1, 3, 'disciplina', 5, 'Gestão de Conflitos', 80),
  (18, 1, 3, 'disciplina', 6, 'Empresa Pedagógica', 80),
  -- TCC (fora dos módulos)
  (19, 1, NULL, 'tcc', 1, 'Trabalho de Conclusão de Curso', 100);

-- ---------------------------------------------------------------------
-- Signatários (placeholders até a direção informar nomes e assinaturas)
-- ---------------------------------------------------------------------
INSERT INTO signatarios (id, instituicao_id, nome, cargo) VALUES
  (1, 1, '[NOME A DEFINIR]', 'Diretora Pedagógica'),
  (2, 1, '[NOME A DEFINIR]', 'Secretário(a) Escolar');

-- ---------------------------------------------------------------------
-- Texto aprovado da frente do certificado de qualificação intermediária
-- ---------------------------------------------------------------------
INSERT INTO modelos_texto (id, documento, curso_id, texto) VALUES (
  1, 'certificado_qualificacao', 1,
  'A Direção do Instituto Inovativa de Educação, Ciência e Tecnologia - IECT no uso de suas atribuições, de acordo com a Lei nº 9.394/1996, a Resolução CNE/CP Nº 1, de 5 de janeiro de 2021 e a Deliberação CEE/MS nº 10.603/2014 e com o disposto no Projeto Pedagógico do {curso} - Eixo Tecnológico: {eixo} - Área Tecnológica: {area} - {nivel}, aprovado, conforme Deliberação CEE/MS nº {ato_ppc_numero}, de {ato_ppc_data_extenso} confere ao(a) estudante {nome}, nacionalidade {nacionalidade}, natural de {naturalidade_municipio}, Estado de {naturalidade_uf}, nascido(a) em {data_nascimento_extenso}, RG {rg} Org. Expedidor {rg_orgao}-{rg_uf}, filho(a) de {nome_pai} e {nome_mae}, o presente CERTIFICADO por ter concluído com êxito o MÓDULO TEMÁTICO DA QUALIFICAÇÃO PROFISSIONAL TÉCNICA {modulo}, conferindo-lhe o título de {qualificacao}.'
);
