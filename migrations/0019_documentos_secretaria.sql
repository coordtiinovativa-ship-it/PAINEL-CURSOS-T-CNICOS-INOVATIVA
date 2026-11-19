-- Documentos da Secretaria (19/11/2026): portarias de aproveitamento, guia de transferência e histórico do curso técnico
-- passam a ser registrados na tabela `documentos` (código INV, QR, snapshot, hash), como a declaração e o histórico por módulo.
--
-- A tabela é recriada porque o SQLite não altera CHECK: amplia os tipos, liga o documento ao ALUNO (matrícula opcional —
-- portaria de aproveitamento pode ser anterior à matrícula na turma), guarda o curso e o nº da portaria.
-- Documentos já emitidos são copiados sem alteração (código, snapshot, hash e PDF continuam os mesmos).

-- o gatilho de certificados consulta `documentos`: sai antes e volta no fim (o RENAME valida os gatilhos existentes)
DROP TRIGGER IF EXISTS trg_certificados_codigo_unico;

CREATE TABLE documentos_novo (
  id                INTEGER PRIMARY KEY,
  tipo              TEXT NOT NULL CHECK (tipo IN (
                      'declaracao_conclusao_modulo','historico_escolar',
                      'historico_curso_tecnico','guia_transferencia',
                      'portaria_aproveitamento_modulos','portaria_aproveitamento_disciplinas','portaria_aproveitamento_conhecimentos')),
  codigo_validacao  TEXT NOT NULL UNIQUE,   -- mesma sequência INV-AAAA-NNNNN dos certificados
  token             TEXT NOT NULL UNIQUE,
  aluno_id          INTEGER NOT NULL REFERENCES alunos(id),
  matricula_id      INTEGER REFERENCES matriculas(id),
  curso_id          INTEGER REFERENCES cursos(id),
  modulo_id         INTEGER REFERENCES modulos_tematicos(id),
  numero            TEXT,                   -- nº da portaria (ex.: 003/2026)
  data_emissao      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'válido' CHECK (status IN ('válido','revogado')),
  motivo_revogacao  TEXT,
  revogado_em       TEXT,
  hash_sha256       TEXT NOT NULL,
  pdf_r2_key        TEXT NOT NULL,
  snapshot_json     TEXT NOT NULL,
  emitido_por       TEXT NOT NULL,
  criado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (status <> 'revogado' OR motivo_revogacao IS NOT NULL),
  CHECK (tipo NOT LIKE 'portaria_%' OR numero IS NOT NULL)
);

INSERT INTO documentos_novo (id, tipo, codigo_validacao, token, aluno_id, matricula_id, curso_id, modulo_id, numero, data_emissao,
                             status, motivo_revogacao, revogado_em, hash_sha256, pdf_r2_key, snapshot_json, emitido_por, criado_em)
SELECT d.id, d.tipo, d.codigo_validacao, d.token, m.aluno_id, d.matricula_id, t.curso_id, d.modulo_id, NULL, d.data_emissao,
       d.status, d.motivo_revogacao, d.revogado_em, d.hash_sha256, d.pdf_r2_key, d.snapshot_json, d.emitido_por, d.criado_em
  FROM documentos d JOIN matriculas m ON m.id = d.matricula_id JOIN turmas t ON t.id = m.turma_id;

DROP TABLE documentos;
ALTER TABLE documentos_novo RENAME TO documentos;

CREATE INDEX idx_documentos_matricula ON documentos(matricula_id);
CREATE INDEX idx_documentos_aluno ON documentos(aluno_id);
-- nº de portaria nunca se repete (nem entre tipos de portaria)
CREATE UNIQUE INDEX idx_documentos_numero ON documentos(numero) WHERE numero IS NOT NULL;

CREATE TRIGGER trg_documentos_nao_apagar BEFORE DELETE ON documentos
BEGIN SELECT RAISE(ABORT, 'Documentos emitidos não podem ser apagados; use a revogação.'); END;

CREATE TRIGGER trg_documentos_imutaveis BEFORE UPDATE ON documentos
WHEN NEW.codigo_validacao IS NOT OLD.codigo_validacao OR NEW.token IS NOT OLD.token
  OR NEW.tipo IS NOT OLD.tipo OR NEW.aluno_id IS NOT OLD.aluno_id OR NEW.matricula_id IS NOT OLD.matricula_id
  OR NEW.curso_id IS NOT OLD.curso_id OR NEW.modulo_id IS NOT OLD.modulo_id OR NEW.numero IS NOT OLD.numero
  OR NEW.data_emissao IS NOT OLD.data_emissao OR NEW.snapshot_json IS NOT OLD.snapshot_json
  OR NEW.hash_sha256 IS NOT OLD.hash_sha256 OR NEW.pdf_r2_key IS NOT OLD.pdf_r2_key
BEGIN SELECT RAISE(ABORT, 'Dados de documento emitido são imutáveis.'); END;

CREATE TRIGGER trg_documentos_codigo_unico BEFORE INSERT ON documentos
WHEN EXISTS (SELECT 1 FROM certificados WHERE codigo_validacao = NEW.codigo_validacao)
BEGIN SELECT RAISE(ABORT, 'Código de validação já utilizado.'); END;
CREATE TRIGGER trg_certificados_codigo_unico BEFORE INSERT ON certificados
WHEN EXISTS (SELECT 1 FROM documentos WHERE codigo_validacao = NEW.codigo_validacao)
BEGIN SELECT RAISE(ABORT, 'Código de validação já utilizado.'); END;
