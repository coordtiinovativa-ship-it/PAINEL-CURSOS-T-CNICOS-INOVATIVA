-- Migração 0004 — emissão de certificados (fase 3)

-- Numeração automática do livro de registro (editável na emissão)
ALTER TABLE instituicoes ADD COLUMN registros_por_folha INTEGER NOT NULL DEFAULT 1 CHECK (registros_por_folha > 0);
ALTER TABLE instituicoes ADD COLUMN folhas_por_livro INTEGER NOT NULL DEFAULT 200 CHECK (folhas_por_livro > 0);

-- Data do registro no livro do IECT (verso); por padrão igual à data de emissão
ALTER TABLE certificados ADD COLUMN data_registro TEXT;

-- Um único certificado válido por matrícula + módulo + tipo (2ª via exige substituir o anterior)
CREATE UNIQUE INDEX idx_certificados_unico_valido
  ON certificados(matricula_id, coalesce(modulo_id, 0), tipo) WHERE status = 'válido';

-- Código SISTEC não se repete
CREATE UNIQUE INDEX idx_certificados_sistec
  ON certificados(codigo_autenticacao_sistec) WHERE codigo_autenticacao_sistec IS NOT NULL;

-- Não permitir emissão sem o código SISTEC (regra do PPC / AJUSTES)
CREATE TRIGGER trg_certificados_exige_sistec
BEFORE INSERT ON certificados
WHEN NEW.codigo_autenticacao_sistec IS NULL OR trim(NEW.codigo_autenticacao_sistec) = ''
BEGIN
  SELECT RAISE(ABORT, 'Código de autenticação SISTEC obrigatório para emitir o certificado.');
END;

-- Tudo o que é impresso no certificado passa a ser imutável após a emissão
DROP TRIGGER trg_certificados_imutaveis;
CREATE TRIGGER trg_certificados_imutaveis
BEFORE UPDATE ON certificados
WHEN NEW.codigo_validacao           IS NOT OLD.codigo_validacao
  OR NEW.token                      IS NOT OLD.token
  OR NEW.tipo                       IS NOT OLD.tipo
  OR NEW.matricula_id               IS NOT OLD.matricula_id
  OR NEW.modulo_id                  IS NOT OLD.modulo_id
  OR NEW.snapshot_json              IS NOT OLD.snapshot_json
  OR NEW.hash_sha256                IS NOT OLD.hash_sha256
  OR NEW.data_emissao               IS NOT OLD.data_emissao
  OR NEW.local_emissao              IS NOT OLD.local_emissao
  OR NEW.registro_numero            IS NOT OLD.registro_numero
  OR NEW.folha                      IS NOT OLD.folha
  OR NEW.livro                      IS NOT OLD.livro
  OR NEW.ano_letivo                 IS NOT OLD.ano_letivo
  OR NEW.data_registro              IS NOT OLD.data_registro
  OR NEW.codigo_autenticacao_sistec IS NOT OLD.codigo_autenticacao_sistec
  OR NEW.data_registro_sistec       IS NOT OLD.data_registro_sistec
BEGIN
  SELECT RAISE(ABORT, 'Dados emitidos do certificado são imutáveis; emita 2ª via.');
END;

CREATE TRIGGER trg_certificado_signatarios_imutaveis_upd BEFORE UPDATE ON certificado_signatarios
BEGIN SELECT RAISE(ABORT, 'Signatários de certificado emitido são imutáveis.'); END;
CREATE TRIGGER trg_certificado_signatarios_imutaveis_del BEFORE DELETE ON certificado_signatarios
BEGIN SELECT RAISE(ABORT, 'Signatários de certificado emitido são imutáveis.'); END;
