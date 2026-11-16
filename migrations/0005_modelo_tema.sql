-- Migração 0005 — fundo próprio para o verso do certificado e tema (claro/escuro) por usuário

-- fundo_r2_key passa a ser o fundo da FRENTE; o verso pode ter fundo próprio.
-- Sem fundo de verso, o verso usa o fundo da frente (ou o padrão do modelo aprovado).
ALTER TABLE instituicoes ADD COLUMN fundo_verso_r2_key TEXT;

ALTER TABLE usuarios ADD COLUMN tema TEXT NOT NULL DEFAULT 'sistema'
  CHECK (tema IN ('sistema','claro','escuro'));
