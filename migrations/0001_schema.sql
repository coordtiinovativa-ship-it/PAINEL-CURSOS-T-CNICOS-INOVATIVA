-- Migração 0001 — schema inicial do Sistema de Certificados IECT
-- Convenções: datas em ISO (YYYY-MM-DD), timestamps em ISO 8601 UTC,
-- booleanos como INTEGER 0/1, cargas horárias em horas inteiras.


-- =====================================================================
-- INSTITUIÇÃO
-- =====================================================================
CREATE TABLE instituicoes (
  id                        INTEGER PRIMARY KEY,
  razao_social              TEXT NOT NULL,
  nome_fantasia             TEXT,
  sigla                     TEXT,
  cnpj                      TEXT,
  mantenedora_razao_social  TEXT,
  mantenedora_cnpj          TEXT,
  endereco                  TEXT,           -- logradouro e número
  bairro                    TEXT,
  municipio                 TEXT,
  uf                        TEXT CHECK (uf IS NULL OR length(uf) = 2),
  cep                       TEXT,
  telefone                  TEXT,
  email                     TEXT,
  site                      TEXT,
  validade_credenciamento   TEXT,           -- data ISO, para alerta de vencimento
  logo_r2_key               TEXT,
  cor_principal             TEXT DEFAULT '#1F3A5F',
  criado_em                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- =====================================================================
-- EIXOS TECNOLÓGICOS (lista do CNCT, editável)
-- =====================================================================
CREATE TABLE eixos_tecnologicos (
  id     INTEGER PRIMARY KEY,
  nome   TEXT NOT NULL UNIQUE,
  ativo  INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

-- =====================================================================
-- CURSOS
-- =====================================================================
CREATE TABLE cursos (
  id                            INTEGER PRIMARY KEY,
  instituicao_id                INTEGER NOT NULL REFERENCES instituicoes(id),
  nome                          TEXT NOT NULL,
  tipo                          TEXT NOT NULL CHECK (tipo IN (
                                  'Curso Técnico',
                                  'Qualificação Profissional / FIC',
                                  'Curso Livre',
                                  'Aperfeiçoamento',
                                  'Especialização Técnica')),
  nivel                         TEXT,       -- ex.: Educação Profissional Técnica de nível médio
  eixo_id                       INTEGER REFERENCES eixos_tecnologicos(id),
  area_tecnologica              TEXT,       -- ex.: Gerencial
  forma_oferta                  TEXT,       -- ex.: Concomitante/Subsequente
  modalidade                    TEXT NOT NULL DEFAULT 'presencial'
                                  CHECK (modalidade IN ('presencial','EAD','híbrido')),
  oferta_experimental           INTEGER NOT NULL DEFAULT 0 CHECK (oferta_experimental IN (0,1)),
  carga_horaria_total           INTEGER NOT NULL CHECK (carga_horaria_total > 0),
  prazo_integralizacao_anos     INTEGER,
  perfil_profissional_conclusao TEXT,
  requisitos_acesso             TEXT,
  escolaridade_minima           TEXT,
  itinerario_formativo          TEXT,
  frequencia_minima             REAL NOT NULL DEFAULT 75,   -- %
  nota_minima                   REAL NOT NULL DEFAULT 6.0,  -- média para aprovação direta
  nota_minima_exame             REAL NOT NULL DEFAULT 5.0,  -- média final após exame
  ativo                         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em                     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE curso_cbos (
  id         INTEGER PRIMARY KEY,
  curso_id   INTEGER NOT NULL REFERENCES cursos(id),
  codigo     TEXT NOT NULL,        -- ex.: 3912-05
  descricao  TEXT,
  UNIQUE (curso_id, codigo)
);

-- =====================================================================
-- ATOS REGULATÓRIOS (tabela única para instituição e curso)
-- =====================================================================
CREATE TABLE atos_regulatorios (
  id                     INTEGER PRIMARY KEY,
  instituicao_id         INTEGER REFERENCES instituicoes(id),
  curso_id               INTEGER REFERENCES cursos(id),
  finalidade             TEXT NOT NULL CHECK (finalidade IN (
                           'criacao_instituicao',
                           'credenciamento',
                           'criacao_curso',
                           'autorizacao_curso',      -- inclui aprovação do PPC
                           'reconhecimento',
                           'renovacao_reconhecimento')),
  tipo                   TEXT NOT NULL CHECK (tipo IN (
                           'Ata','Portaria','Resolução','Parecer','Deliberação','Reconhecimento')),
  numero                 TEXT NOT NULL,
  data                   TEXT NOT NULL,            -- ISO
  orgao_emissor          TEXT NOT NULL,
  descricao              TEXT,
  processo               TEXT,                     -- ex.: NUP 29.092.431-2024
  publicacao_doe_numero  TEXT,                     -- nº do DOE/MS (opcional até ser informado)
  publicacao_doe_data    TEXT,                     -- ISO
  veiculo_publicacao     TEXT,                     -- ex.: DOE/MS
  ativo                  INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- exatamente um dono: instituição OU curso
  CHECK ((instituicao_id IS NULL) <> (curso_id IS NULL))
);
CREATE INDEX idx_atos_instituicao ON atos_regulatorios(instituicao_id);
CREATE INDEX idx_atos_curso ON atos_regulatorios(curso_id);

-- =====================================================================
-- MATRIZ CURRICULAR (versionada)
-- =====================================================================
CREATE TABLE matrizes_curriculares (
  id                     INTEGER PRIMARY KEY,
  curso_id               INTEGER NOT NULL REFERENCES cursos(id),
  versao                 INTEGER NOT NULL,
  vigente_desde          TEXT NOT NULL,           -- ISO
  descricao              TEXT,
  estagio_supervisionado INTEGER NOT NULL DEFAULT 0 CHECK (estagio_supervisionado IN (0,1)),
  estagio_carga_horaria  INTEGER,
  criado_em              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (curso_id, versao)
);

CREATE TABLE modulos_tematicos (
  id                      INTEGER PRIMARY KEY,
  matriz_id               INTEGER NOT NULL REFERENCES matrizes_curriculares(id),
  ordem                   INTEGER NOT NULL,
  nome                    TEXT NOT NULL,          -- ex.: Qualidade
  carga_horaria           INTEGER NOT NULL,
  tem_terminalidade       INTEGER NOT NULL DEFAULT 1 CHECK (tem_terminalidade IN (0,1)),
  qualificacao_conferida  TEXT,                   -- título impresso: ex.: Inspetor de Qualidade
  perfil_profissional     TEXT,                   -- verso do histórico
  competencias            TEXT,                   -- verso do histórico
  UNIQUE (matriz_id, ordem)
);

-- Componentes: disciplinas (dentro de um módulo) e TCC (modulo_id NULL)
CREATE TABLE componentes_curriculares (
  id                     INTEGER PRIMARY KEY,
  matriz_id              INTEGER NOT NULL REFERENCES matrizes_curriculares(id),
  modulo_id              INTEGER REFERENCES modulos_tematicos(id),
  tipo                   TEXT NOT NULL DEFAULT 'disciplina' CHECK (tipo IN ('disciplina','tcc','estagio')),
  ordem                  INTEGER NOT NULL,
  nome                   TEXT NOT NULL,
  carga_horaria_teorica  INTEGER,
  carga_horaria_pratica  INTEGER,
  carga_horaria_total    INTEGER NOT NULL CHECK (carga_horaria_total > 0),
  CHECK (tipo <> 'disciplina' OR modulo_id IS NOT NULL)
);
CREATE INDEX idx_componentes_matriz ON componentes_curriculares(matriz_id);
CREATE INDEX idx_componentes_modulo ON componentes_curriculares(modulo_id);

-- Matriz é imutável depois que existir turma usando-a (certificados antigos não mudam)
CREATE TRIGGER trg_componentes_imutaveis_upd
BEFORE UPDATE ON componentes_curriculares
WHEN EXISTS (SELECT 1 FROM turmas WHERE matriz_id = OLD.matriz_id)
BEGIN
  SELECT RAISE(ABORT, 'Matriz em uso por turma: crie uma nova versão da matriz.');
END;

CREATE TRIGGER trg_componentes_imutaveis_del
BEFORE DELETE ON componentes_curriculares
WHEN EXISTS (SELECT 1 FROM turmas WHERE matriz_id = OLD.matriz_id)
BEGIN
  SELECT RAISE(ABORT, 'Matriz em uso por turma: crie uma nova versão da matriz.');
END;

-- =====================================================================
-- TURMAS
-- =====================================================================
CREATE TABLE turmas (
  id           INTEGER PRIMARY KEY,
  curso_id     INTEGER NOT NULL REFERENCES cursos(id),
  matriz_id    INTEGER NOT NULL REFERENCES matrizes_curriculares(id),
  codigo       TEXT NOT NULL UNIQUE,
  polo         TEXT,
  data_inicio  TEXT,
  data_fim     TEXT,
  turno        TEXT CHECK (turno IS NULL OR turno IN ('matutino','vespertino','noturno','integral')),
  ano_letivo   INTEGER,
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- =====================================================================
-- ALUNOS
-- =====================================================================
CREATE TABLE alunos (
  id                          INTEGER PRIMARY KEY,
  ra                          TEXT UNIQUE,
  nome_civil                  TEXT NOT NULL,
  nome_social                 TEXT,             -- se houver, aparece no certificado
  cpf                         TEXT NOT NULL UNIQUE,   -- só dígitos
  rg                          TEXT,
  rg_orgao_expedidor          TEXT,
  rg_uf                       TEXT,
  data_nascimento             TEXT,
  sexo                        TEXT CHECK (sexo IS NULL OR sexo IN ('F','M')),
  cor_raca                    TEXT,
  naturalidade_municipio      TEXT,
  naturalidade_uf             TEXT,
  nacionalidade               TEXT DEFAULT 'brasileira',
  nome_pai                    TEXT,
  nome_mae                    TEXT,
  escolaridade                TEXT,
  ensino_medio_instituicao    TEXT,
  ensino_medio_municipio      TEXT,
  ensino_medio_uf             TEXT,
  ensino_medio_ano_conclusao  INTEGER,
  email                       TEXT,
  telefone                    TEXT,
  criado_em                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- =====================================================================
-- MATRÍCULAS E RESULTADOS
-- =====================================================================
CREATE TABLE matriculas (
  id                INTEGER PRIMARY KEY,
  aluno_id          INTEGER NOT NULL REFERENCES alunos(id),
  turma_id          INTEGER NOT NULL REFERENCES turmas(id),
  situacao          TEXT NOT NULL DEFAULT 'cursando'
                      CHECK (situacao IN ('cursando','concluído','reprovado','desistente')),
  frequencia_final  REAL,
  data_conclusao    TEXT,
  criado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (aluno_id, turma_id)
);

CREATE TABLE resultados (
  id                          INTEGER PRIMARY KEY,
  matricula_id                INTEGER NOT NULL REFERENCES matriculas(id),
  componente_id               INTEGER NOT NULL REFERENCES componentes_curriculares(id),
  nota                        REAL CHECK (nota IS NULL OR (nota >= 0 AND nota <= 10)),
  nota_exame_final            REAL CHECK (nota_exame_final IS NULL OR (nota_exame_final >= 0 AND nota_exame_final <= 10)),
  frequencia                  REAL CHECK (frequencia IS NULL OR (frequencia >= 0 AND frequencia <= 100)),
  resultado                   TEXT CHECK (resultado IS NULL OR resultado IN ('AP','RP')),
  aproveitado_de_resultado_id INTEGER REFERENCES resultados(id),  -- disciplina aprovada em matrícula anterior
  atualizado_em               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (matricula_id, componente_id)
);

-- =====================================================================
-- SIGNATÁRIOS
-- =====================================================================
CREATE TABLE signatarios (
  id                  INTEGER PRIMARY KEY,
  instituicao_id      INTEGER NOT NULL REFERENCES instituicoes(id),
  nome                TEXT NOT NULL,
  cargo               TEXT NOT NULL,     -- ex.: Diretora Pedagógica, Secretário(a) Escolar
  assinatura_r2_key   TEXT,
  ativo               INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

-- =====================================================================
-- MODELOS DE TEXTO (frente do certificado etc.)
-- =====================================================================
CREATE TABLE modelos_texto (
  id              INTEGER PRIMARY KEY,
  documento       TEXT NOT NULL CHECK (documento IN (
                    'certificado_qualificacao','diploma_tecnico',
                    'declaracao_conclusao_modulo','historico_escolar')),
  curso_id        INTEGER REFERENCES cursos(id),
  texto           TEXT NOT NULL,
  ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- =====================================================================
-- CERTIFICADOS
-- =====================================================================
-- Sequência por ano: nunca decrementa, então código nunca é reaproveitado.
CREATE TABLE sequencias_certificado (
  ano     INTEGER PRIMARY KEY,
  ultimo  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE certificados (
  id                          INTEGER PRIMARY KEY,
  tipo                        TEXT NOT NULL CHECK (tipo IN ('qualificacao_intermediaria','diploma_tecnico')),
  codigo_validacao            TEXT NOT NULL UNIQUE,   -- INV-AAAA-NNNNN
  token                       TEXT NOT NULL UNIQUE,   -- aleatório curto, usado na URL
  matricula_id                INTEGER NOT NULL REFERENCES matriculas(id),
  modulo_id                   INTEGER REFERENCES modulos_tematicos(id),
  registro_numero             TEXT,
  folha                       TEXT,
  livro                       TEXT,
  ano_letivo                  INTEGER,
  data_emissao                TEXT NOT NULL,
  local_emissao               TEXT NOT NULL,
  codigo_autenticacao_sistec  TEXT,
  data_registro_sistec        TEXT,
  status                      TEXT NOT NULL DEFAULT 'válido'
                                CHECK (status IN ('válido','revogado','substituído')),
  motivo_revogacao            TEXT,
  revogado_em                 TEXT,
  certificado_substituto_id   INTEGER REFERENCES certificados(id),
  hash_sha256                 TEXT NOT NULL,
  pdf_r2_key                  TEXT,
  snapshot_json               TEXT NOT NULL,
  emitido_por                 TEXT,                   -- e-mail do Cloudflare Access
  criado_em                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (tipo <> 'qualificacao_intermediaria' OR modulo_id IS NOT NULL),
  CHECK (status <> 'revogado' OR motivo_revogacao IS NOT NULL)
);
CREATE INDEX idx_certificados_matricula ON certificados(matricula_id);
CREATE UNIQUE INDEX idx_certificados_registro ON certificados(livro, folha, registro_numero)
  WHERE registro_numero IS NOT NULL;

CREATE TABLE certificado_signatarios (
  certificado_id     INTEGER NOT NULL REFERENCES certificados(id),
  ordem              INTEGER NOT NULL,
  nome               TEXT NOT NULL,
  cargo              TEXT NOT NULL,
  assinatura_r2_key  TEXT,
  PRIMARY KEY (certificado_id, ordem)
);

-- Regra: nunca apagar certificado; só revogar.
CREATE TRIGGER trg_certificados_nao_apagar
BEFORE DELETE ON certificados
BEGIN
  SELECT RAISE(ABORT, 'Certificados não podem ser apagados; use a revogação.');
END;

-- Dados emitidos são imutáveis; só status/revogação/substituição/SISTEC/PDF podem mudar.
CREATE TRIGGER trg_certificados_imutaveis
BEFORE UPDATE ON certificados
WHEN NEW.codigo_validacao IS NOT OLD.codigo_validacao
  OR NEW.token            IS NOT OLD.token
  OR NEW.matricula_id     IS NOT OLD.matricula_id
  OR NEW.snapshot_json    IS NOT OLD.snapshot_json
  OR NEW.hash_sha256      IS NOT OLD.hash_sha256
  OR NEW.data_emissao     IS NOT OLD.data_emissao
BEGIN
  SELECT RAISE(ABORT, 'Dados emitidos do certificado são imutáveis; emita 2ª via.');
END;

-- =====================================================================
-- AUDITORIA
-- =====================================================================
CREATE TABLE auditoria (
  id             INTEGER PRIMARY KEY,
  usuario_email  TEXT NOT NULL,
  quando         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  acao           TEXT NOT NULL,    -- criar, atualizar, emitir, revogar, importar...
  entidade       TEXT NOT NULL,
  entidade_id    INTEGER,
  antes_json     TEXT,
  depois_json    TEXT
);
CREATE INDEX idx_auditoria_entidade ON auditoria(entidade, entidade_id);
