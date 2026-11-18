-- Calendário Escolar gerado automaticamente + ajuste dia a dia (decisão de 18/11/2026).
-- O código de cada dia é calculado (dia da semana + feriados/recessos/eventos); o responsável pode trocar o código
-- de um dia: o ajuste fica aqui e vale sobre o cálculo. Incluir um evento depois apaga os ajustes do período
-- (vale a última alteração).
CREATE TABLE calendario_dias (
  ano_letivo_id INTEGER NOT NULL REFERENCES anos_letivos(id),
  data TEXT NOT NULL,
  codigo TEXT NOT NULL CHECK (codigo IN ('L', 'D', 'S', 'SL', 'DL', 'F', 'NL')),
  descricao TEXT,
  atualizado_por TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ano_letivo_id, data)
);

ALTER TABLE anos_letivos ADD COLUMN calendario_gerado_em TEXT;
ALTER TABLE anos_letivos ADD COLUMN calendario_gerado_por TEXT;
