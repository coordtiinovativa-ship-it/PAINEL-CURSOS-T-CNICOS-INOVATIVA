-- Migração 0010 — módulos da turma: período e situação de cada módulo na turma.
-- A turma faz o curso inteiro com os módulos em sequência (decisão da direção, 16/11/2026):
-- um módulo só começa quando o anterior estiver concluído; certificados só de módulo concluído.

CREATE TABLE turma_modulos (
  id           INTEGER PRIMARY KEY,
  turma_id     INTEGER NOT NULL REFERENCES turmas(id),
  modulo_id    INTEGER NOT NULL REFERENCES modulos_tematicos(id),
  data_inicio  TEXT,    -- ISO
  data_fim     TEXT,    -- ISO (data de conclusão do módulo)
  situacao     TEXT NOT NULL DEFAULT 'planejado' CHECK (situacao IN ('planejado','em_andamento','concluido')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (turma_id, modulo_id),
  CHECK (situacao = 'planejado' OR data_inicio IS NOT NULL),
  CHECK (situacao <> 'concluido' OR data_fim IS NOT NULL),
  CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio)
);
CREATE INDEX idx_turma_modulos_turma ON turma_modulos(turma_id);

-- Turmas já existentes: módulo 1 em andamento desde o início da turma; demais planejados.
INSERT INTO turma_modulos (turma_id, modulo_id, data_inicio, situacao)
SELECT t.id, mt.id,
       CASE WHEN mt.ordem = (SELECT min(ordem) FROM modulos_tematicos WHERE matriz_id = t.matriz_id) THEN coalesce(t.data_inicio, date('now')) END,
       CASE WHEN mt.ordem = (SELECT min(ordem) FROM modulos_tematicos WHERE matriz_id = t.matriz_id) THEN 'em_andamento' ELSE 'planejado' END
  FROM turmas t JOIN modulos_tematicos mt ON mt.matriz_id = t.matriz_id;
