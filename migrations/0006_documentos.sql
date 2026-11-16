-- Migração 0006 — documentos acadêmicos registrados (fase 5):
-- declaração de conclusão de módulo e histórico escolar, com código de validação, snapshot e PDF.

CREATE TABLE documentos (
  id                INTEGER PRIMARY KEY,
  tipo              TEXT NOT NULL CHECK (tipo IN ('declaracao_conclusao_modulo','historico_escolar')),
  codigo_validacao  TEXT NOT NULL UNIQUE,   -- mesma sequência INV-AAAA-NNNNN dos certificados
  token             TEXT NOT NULL UNIQUE,
  matricula_id      INTEGER NOT NULL REFERENCES matriculas(id),
  modulo_id         INTEGER REFERENCES modulos_tematicos(id),
  data_emissao      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'válido' CHECK (status IN ('válido','revogado')),
  motivo_revogacao  TEXT,
  revogado_em       TEXT,
  hash_sha256       TEXT NOT NULL,
  pdf_r2_key        TEXT NOT NULL,
  snapshot_json     TEXT NOT NULL,
  emitido_por       TEXT NOT NULL,
  criado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (status <> 'revogado' OR motivo_revogacao IS NOT NULL)
);
CREATE INDEX idx_documentos_matricula ON documentos(matricula_id);

CREATE TRIGGER trg_documentos_nao_apagar BEFORE DELETE ON documentos
BEGIN SELECT RAISE(ABORT, 'Documentos emitidos não podem ser apagados; use a revogação.'); END;

CREATE TRIGGER trg_documentos_imutaveis BEFORE UPDATE ON documentos
WHEN NEW.codigo_validacao IS NOT OLD.codigo_validacao OR NEW.token IS NOT OLD.token
  OR NEW.tipo IS NOT OLD.tipo OR NEW.matricula_id IS NOT OLD.matricula_id OR NEW.modulo_id IS NOT OLD.modulo_id
  OR NEW.data_emissao IS NOT OLD.data_emissao OR NEW.snapshot_json IS NOT OLD.snapshot_json
  OR NEW.hash_sha256 IS NOT OLD.hash_sha256 OR NEW.pdf_r2_key IS NOT OLD.pdf_r2_key
BEGIN SELECT RAISE(ABORT, 'Dados de documento emitido são imutáveis.'); END;

-- Código de validação é único entre certificados e documentos (nunca reaproveitado)
CREATE TRIGGER trg_documentos_codigo_unico BEFORE INSERT ON documentos
WHEN EXISTS (SELECT 1 FROM certificados WHERE codigo_validacao = NEW.codigo_validacao)
BEGIN SELECT RAISE(ABORT, 'Código de validação já utilizado.'); END;
CREATE TRIGGER trg_certificados_codigo_unico BEFORE INSERT ON certificados
WHEN EXISTS (SELECT 1 FROM documentos WHERE codigo_validacao = NEW.codigo_validacao)
BEGIN SELECT RAISE(ABORT, 'Código de validação já utilizado.'); END;

-- Texto padrão da declaração (proposta — editável em "Modelo do certificado")
INSERT INTO modelos_texto (documento, curso_id, texto) VALUES (
  'declaracao_conclusao_modulo', NULL,
  'Declaramos, para os devidos fins, que {nome}, inscrito(a) no CPF sob o nº {cpf}, portador(a) do RG nº {rg} {rg_orgao}-{rg_uf}, nascido(a) em {data_nascimento_extenso}, concluiu com aprovação o MÓDULO TEMÁTICO {modulo}, com carga horária de {carga_horaria} horas, que confere a QUALIFICAÇÃO PROFISSIONAL TÉCNICA de {qualificacao}, integrante do {curso} - Eixo Tecnológico: {eixo}, autorizado pela Deliberação CEE/MS nº {ato_ppc_numero}, de {ato_ppc_data_extenso}, tendo cursado o módulo na turma {turma}, no período de {periodo}, com frequência de {frequencia}%. {situacao_certificado}'
);
