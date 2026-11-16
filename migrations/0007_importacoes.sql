-- Migração 0007 — importação de planilhas (fase 6): cada envio fica registrado,
-- passa pela conferência e só grava os dados quando confirmado.

CREATE TABLE importacoes (
  id              INTEGER PRIMARY KEY,
  tipo            TEXT NOT NULL CHECK (tipo IN ('alunos','notas')),
  turma_id        INTEGER REFERENCES turmas(id),
  modulo_id       INTEGER REFERENCES modulos_tematicos(id),
  modo            TEXT CHECK (modo IS NULL OR modo IN ('preencher','sobrescrever')),
  nome_arquivo    TEXT NOT NULL,
  arquivo_r2_key  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'conferencia' CHECK (status IN ('conferencia','aplicada','descartada')),
  resumo_json     TEXT,            -- totais da conferência / da aplicação
  criado_por      TEXT NOT NULL,
  criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  concluido_por   TEXT,
  concluido_em    TEXT,
  CHECK (tipo <> 'notas' OR (turma_id IS NOT NULL AND modulo_id IS NOT NULL))
);
CREATE INDEX idx_importacoes_criado ON importacoes(criado_em);
