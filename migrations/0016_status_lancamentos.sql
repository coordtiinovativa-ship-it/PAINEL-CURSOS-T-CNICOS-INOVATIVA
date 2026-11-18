-- Migração 0016 — status da matrícula e rastreio dos lançamentos (pedido de 18/11/2026).
--
-- (1) STATUS do vínculo do aluno com a turma, separado da situação acadêmica (cursando/concluído/reprovado):
--     ativa | desistente | transferido | cancelada | falecido | transferencia_interna. Todo aluno entra "ativa";
--     só a secretaria muda (com data e motivo, histórico guardado). Aluno não ativo: notas e faltas só pela Secretaria.
ALTER TABLE matriculas ADD COLUMN status TEXT NOT NULL DEFAULT 'ativa'
  CHECK (status IN ('ativa','desistente','transferido','cancelada','falecido','transferencia_interna'));
-- quem estava como "desistente" na situação passa a ter o status desistente (a situação acadêmica volta a "cursando")
UPDATE matriculas SET status = 'desistente', situacao = 'cursando' WHERE situacao = 'desistente';

CREATE TABLE matricula_status_historico (
  id               INTEGER PRIMARY KEY,
  matricula_id     INTEGER NOT NULL REFERENCES matriculas(id),
  status_anterior  TEXT NOT NULL,
  status_novo      TEXT NOT NULL,
  data             TEXT NOT NULL,          -- a partir de quando (ISO)
  motivo           TEXT,
  usuario          TEXT NOT NULL,
  registrado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_status_hist_matricula ON matricula_status_historico(matricula_id);

-- (2) Lançamentos: vale a ÚLTIMA digitação (data e hora). Cada resultado guarda quem e de onde veio a última alteração e o
--     professor da disciplina (lotação); cada campo alterado vai para o histórico.
ALTER TABLE resultados ADD COLUMN atualizado_por TEXT;
ALTER TABLE resultados ADD COLUMN origem TEXT;            -- professor | secretaria | chamada | importacao
ALTER TABLE resultados ADD COLUMN professor_id INTEGER REFERENCES funcionarios(id);

CREATE TABLE resultados_historico (
  id             INTEGER PRIMARY KEY,
  matricula_id   INTEGER NOT NULL REFERENCES matriculas(id),
  componente_id  INTEGER NOT NULL REFERENCES componentes_curriculares(id),
  campo          TEXT NOT NULL CHECK (campo IN ('nota','exame','faltas','frequencia')),
  valor_anterior REAL,
  valor_novo     REAL,
  origem         TEXT NOT NULL,
  professor_id   INTEGER REFERENCES funcionarios(id),
  usuario        TEXT NOT NULL,
  registrado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_resultados_hist ON resultados_historico(matricula_id, componente_id);
