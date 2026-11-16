-- Migração 0008 — ficha do aluno no estilo SysGEP: nome social opcional, dados pessoais extras,
-- endereço e documentos digitalizados do aluno.

-- Nome social só é usado nos documentos quando a chave "usar nome social" estiver ligada.
-- Para quem já tem nome social cadastrado, a chave começa ligada (comportamento anterior).
ALTER TABLE alunos ADD COLUMN usar_nome_social INTEGER NOT NULL DEFAULT 1 CHECK (usar_nome_social IN (0,1));
UPDATE alunos SET usar_nome_social = 0 WHERE nome_social IS NULL OR trim(nome_social) = '';
ALTER TABLE alunos ADD COLUMN estado_civil TEXT;
ALTER TABLE alunos ADD COLUMN necessidades_especificas TEXT;
ALTER TABLE alunos ADD COLUMN rg_data_expedicao TEXT;   -- ISO
ALTER TABLE alunos ADD COLUMN celular TEXT;
ALTER TABLE alunos ADD COLUMN cep TEXT;
ALTER TABLE alunos ADD COLUMN endereco TEXT;
ALTER TABLE alunos ADD COLUMN bairro TEXT;
ALTER TABLE alunos ADD COLUMN complemento TEXT;
ALTER TABLE alunos ADD COLUMN endereco_municipio TEXT;
ALTER TABLE alunos ADD COLUMN endereco_uf TEXT;

CREATE TABLE aluno_documentos (
  id            INTEGER PRIMARY KEY,
  aluno_id      INTEGER NOT NULL REFERENCES alunos(id),
  descricao     TEXT NOT NULL,
  nome_arquivo  TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  tipo          TEXT NOT NULL,      -- application/pdf, image/png, image/jpeg
  tamanho       INTEGER NOT NULL,   -- bytes
  enviado_por   TEXT NOT NULL,
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  excluido_em   TEXT,               -- exclusão lógica: some da lista, o arquivo continua guardado
  excluido_por  TEXT
);
CREATE INDEX idx_aluno_documentos_aluno ON aluno_documentos(aluno_id);

CREATE TRIGGER trg_aluno_documentos_nao_apagar BEFORE DELETE ON aluno_documentos
BEGIN SELECT RAISE(ABORT, 'Documentos do aluno não são apagados; use a exclusão (fica no histórico).'); END;
