-- Migração 0003 — usuários e sessões (login próprio), parâmetros de aprovação
-- configuráveis, signatários com portaria, correção do CNPJ.

-- ---------------------------------------------------------------------
-- CNPJ confirmado pela direção: 44.362.171/0001-36 é do IECT.
-- CNPJ da mantenedora: não informado.
-- ---------------------------------------------------------------------
UPDATE instituicoes SET cnpj = '44.362.171/0001-36', mantenedora_cnpj = NULL WHERE id = 1;

ALTER TABLE instituicoes ADD COLUMN fundo_r2_key TEXT;   -- imagem de fundo do certificado

-- ---------------------------------------------------------------------
-- Parâmetros de aprovação por curso (editáveis no painel)
--   metodo_exame:
--     media_ponderada → média final = (média×peso_media + exame×peso_exame) / (soma dos pesos)
--     substitui       → média final = nota do exame
--     maior           → média final = maior entre média e exame
-- ---------------------------------------------------------------------
ALTER TABLE cursos ADD COLUMN metodo_exame TEXT NOT NULL DEFAULT 'media_ponderada'
  CHECK (metodo_exame IN ('media_ponderada','substitui','maior'));
ALTER TABLE cursos ADD COLUMN peso_media REAL NOT NULL DEFAULT 1 CHECK (peso_media >= 0);
ALTER TABLE cursos ADD COLUMN peso_exame REAL NOT NULL DEFAULT 1 CHECK (peso_exame >= 0);

-- ---------------------------------------------------------------------
-- Usuários e sessões
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  id                INTEGER PRIMARY KEY,
  nome              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash        TEXT NOT NULL,
  perfil            TEXT NOT NULL CHECK (perfil IN ('admin_master','administrador','coordenador','secretaria')),
  ativo             INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  trocar_senha      INTEGER NOT NULL DEFAULT 1 CHECK (trocar_senha IN (0,1)),
  tentativas_falhas INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate     TEXT,
  ultimo_acesso     TEXT,
  criado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE sessoes (
  token_hash   TEXT PRIMARY KEY,           -- SHA-256 do token do cookie (o token em si não é guardado)
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expira_em    TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);

-- Auditoria passa a referenciar o usuário e registrar IP
ALTER TABLE auditoria ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id);
ALTER TABLE auditoria ADD COLUMN ip TEXT;
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id, quando);
CREATE INDEX idx_auditoria_quando ON auditoria(quando);

-- Auditoria é somente inclusão
CREATE TRIGGER trg_auditoria_nao_alterar BEFORE UPDATE ON auditoria
BEGIN SELECT RAISE(ABORT, 'Registros de auditoria não podem ser alterados.'); END;
CREATE TRIGGER trg_auditoria_nao_apagar BEFORE DELETE ON auditoria
BEGIN SELECT RAISE(ABORT, 'Registros de auditoria não podem ser apagados.'); END;

-- ---------------------------------------------------------------------
-- Signatários: função no documento + portaria de nomeação
-- ---------------------------------------------------------------------
ALTER TABLE signatarios ADD COLUMN funcao TEXT NOT NULL DEFAULT 'outro'
  CHECK (funcao IN ('diretor_pedagogico','secretario','diretor_geral','outro'));
ALTER TABLE signatarios ADD COLUMN portaria_tipo TEXT;       -- Portaria, Ato, Ata...
ALTER TABLE signatarios ADD COLUMN portaria_numero TEXT;
ALTER TABLE signatarios ADD COLUMN portaria_data TEXT;       -- ISO
ALTER TABLE signatarios ADD COLUMN portaria_orgao TEXT;
ALTER TABLE signatarios ADD COLUMN portaria_r2_key TEXT;     -- PDF da portaria
ALTER TABLE signatarios ADD COLUMN atualizado_em TEXT;

UPDATE signatarios SET funcao = 'diretor_pedagogico', cargo = 'Diretora Pedagógica' WHERE id = 1;
UPDATE signatarios SET funcao = 'secretario', cargo = 'Secretário(a)' WHERE id = 2;

-- Só um signatário ativo por função (exceto "outro")
CREATE UNIQUE INDEX idx_signatario_funcao_ativo ON signatarios(instituicao_id, funcao)
  WHERE ativo = 1 AND funcao <> 'outro';
