-- Migração 0015 — Gestão Pedagógica (padrão sysGEP, pedido de 17/11/2026):
--   funcionários → lotação (professor por disciplina da turma) → horário (dia/tempo) →
--   ano letivo + calendário escolar (dias não letivos) → chamada por dia (faltas por aula).
-- As faltas da chamada alimentam resultados.faltas/frequencia (Notas e Faltas), com a regra do PPC:
--   frequência = 100 × (1 − horas faltadas ÷ CH da disciplina).

-- ---------------------------------------------------------------- funcionários
CREATE TABLE funcionarios (
  id                     INTEGER PRIMARY KEY,
  nome                   TEXT NOT NULL,
  cpf                    TEXT NOT NULL UNIQUE,           -- só dígitos
  rg                     TEXT,
  rg_orgao_expedidor     TEXT,
  rg_uf                  TEXT,
  rg_data_expedicao      TEXT,
  data_nascimento        TEXT,
  sexo                   TEXT CHECK (sexo IS NULL OR sexo IN ('F','M')),
  cor_raca               TEXT,
  estado_civil           TEXT,
  nacionalidade          TEXT DEFAULT 'brasileira',
  naturalidade_municipio TEXT,
  naturalidade_uf        TEXT,
  escolaridade           TEXT,                           -- grau de instrução
  formacao               TEXT,                           -- graduação / habilitação / área
  registro_profissional  TEXT,
  email                  TEXT,
  telefone               TEXT,
  celular                TEXT,
  cep                    TEXT,
  endereco               TEXT,
  bairro                 TEXT,
  complemento            TEXT,
  endereco_municipio     TEXT,
  endereco_uf            TEXT,
  observacao             TEXT,
  ativo                  INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE funcionario_categorias (
  funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
  categoria      TEXT NOT NULL CHECK (categoria IN ('professor','coordenador','diretor','secretario','administrativo','outro')),
  PRIMARY KEY (funcionario_id, categoria)
);

CREATE TABLE funcionario_documentos (
  id             INTEGER PRIMARY KEY,
  funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
  descricao      TEXT NOT NULL,
  nome_arquivo   TEXT NOT NULL,
  r2_key         TEXT NOT NULL,
  tipo           TEXT NOT NULL,
  tamanho        INTEGER NOT NULL,
  enviado_por    TEXT NOT NULL,
  criado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  excluido_em    TEXT,
  excluido_por   TEXT
);

-- ---------------------------------------------------------------- ano letivo e calendário
CREATE TABLE anos_letivos (
  id          INTEGER PRIMARY KEY,
  ano         INTEGER NOT NULL UNIQUE CHECK (ano BETWEEN 2000 AND 2100),
  data_inicio TEXT NOT NULL,
  data_fim    TEXT NOT NULL,
  situacao    TEXT NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto','encerrado')),
  observacao  TEXT,
  CHECK (data_fim > data_inicio)
);

-- Eventos do calendário: feriado, recesso e ponto facultativo tiram o dia da chamada (não letivo);
-- "dia letivo extra" (ex.: sábado letivo) e "evento" (informativo) mantêm o dia letivo.
CREATE TABLE calendario_eventos (
  id            INTEGER PRIMARY KEY,
  ano_letivo_id INTEGER NOT NULL REFERENCES anos_letivos(id),
  data_inicio   TEXT NOT NULL,
  data_fim      TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('feriado','recesso','ponto_facultativo','dia_letivo_extra','evento')),
  descricao     TEXT NOT NULL,
  CHECK (data_fim >= data_inicio)
);
CREATE INDEX idx_calendario_ano ON calendario_eventos(ano_letivo_id, data_inicio);

-- ---------------------------------------------------------------- horário
-- Tempos de aula por turno (modelo do horário): o "tempo 3" do noturno é, por exemplo, 20:40–21:30.
CREATE TABLE horario_tempos (
  id          INTEGER PRIMARY KEY,
  turno       TEXT NOT NULL CHECK (turno IN ('matutino','vespertino','noturno','integral')),
  numero      INTEGER NOT NULL CHECK (numero BETWEEN 1 AND 12),
  hora_inicio TEXT NOT NULL,
  hora_fim    TEXT NOT NULL,
  UNIQUE (turno, numero),
  CHECK (hora_fim > hora_inicio)
);

-- Lotação: professor de uma disciplina da turma. Uma lotação ativa (data_fim nula) por disciplina da turma;
-- "trocar" encerra a atual (motivo) e abre outra — o histórico fica.
CREATE TABLE lotacoes (
  id             INTEGER PRIMARY KEY,
  turma_id       INTEGER NOT NULL REFERENCES turmas(id),
  componente_id  INTEGER NOT NULL REFERENCES componentes_curriculares(id),
  funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
  data_inicio    TEXT NOT NULL,
  data_fim       TEXT,
  motivo_fim     TEXT,
  encerrada_por  TEXT,
  encerrada_em   TEXT,
  criado_por     TEXT,
  criado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);
CREATE UNIQUE INDEX idx_lotacao_ativa ON lotacoes(turma_id, componente_id) WHERE data_fim IS NULL;
CREATE INDEX idx_lotacao_professor ON lotacoes(funcionario_id);

-- Aulas na grade semanal da lotação (dia 1 = segunda ... 6 = sábado; tempo = horario_tempos.numero do turno da turma)
CREATE TABLE horario_aulas (
  id         INTEGER PRIMARY KEY,
  lotacao_id INTEGER NOT NULL REFERENCES lotacoes(id),
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 1 AND 6),
  tempo      INTEGER NOT NULL CHECK (tempo BETWEEN 1 AND 12),
  UNIQUE (lotacao_id, dia_semana, tempo)
);

-- ---------------------------------------------------------------- chamada (faltas por aula)
-- Uma aula dada = turma + data + tempo. A duração fica gravada (a frequência não muda se o horário mudar depois).
CREATE TABLE aulas (
  id             INTEGER PRIMARY KEY,
  turma_id       INTEGER NOT NULL REFERENCES turmas(id),
  componente_id  INTEGER NOT NULL REFERENCES componentes_curriculares(id),
  lotacao_id     INTEGER REFERENCES lotacoes(id),
  funcionario_id INTEGER REFERENCES funcionarios(id),
  data           TEXT NOT NULL,
  tempo          INTEGER NOT NULL,
  duracao_min    INTEGER NOT NULL CHECK (duracao_min BETWEEN 10 AND 600),
  registrado_por TEXT NOT NULL,
  registrado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (turma_id, data, tempo)
);
CREATE INDEX idx_aulas_disciplina ON aulas(turma_id, componente_id);

CREATE TABLE faltas_aula (
  aula_id      INTEGER NOT NULL REFERENCES aulas(id),
  matricula_id INTEGER NOT NULL REFERENCES matriculas(id),
  PRIMARY KEY (aula_id, matricula_id)
);

-- ---------------------------------------------------------------- dados iniciais
-- Ano letivo de cada turma já cadastrada (datas da turma ou o ano inteiro).
INSERT INTO anos_letivos (ano, data_inicio, data_fim)
SELECT ano, min(ini), max(fim) FROM (
  SELECT coalesce(ano_letivo, CAST(substr(coalesce(data_inicio, date('now')), 1, 4) AS INTEGER)) AS ano,
         coalesce(data_inicio, printf('%04d-01-01', coalesce(ano_letivo, CAST(strftime('%Y','now') AS INTEGER)))) AS ini,
         coalesce(data_fim, printf('%04d-12-31', coalesce(ano_letivo, CAST(strftime('%Y','now') AS INTEGER)))) AS fim
    FROM turmas)
 GROUP BY ano HAVING max(fim) > min(ini);
INSERT OR IGNORE INTO anos_letivos (ano, data_inicio, data_fim) VALUES (2026, '2026-02-01', '2026-12-18');

-- Tempos padrão (editáveis em Gestão Pedagógica → Horário do Professor → Tempos de aula)
INSERT INTO horario_tempos (turno, numero, hora_inicio, hora_fim) VALUES
  ('noturno', 1, '19:00', '19:45'), ('noturno', 2, '19:45', '20:30'), ('noturno', 3, '20:40', '21:25'), ('noturno', 4, '21:25', '22:10'),
  ('matutino', 1, '07:00', '07:50'), ('matutino', 2, '07:50', '08:40'), ('matutino', 3, '08:40', '09:30'), ('matutino', 4, '09:50', '10:40'), ('matutino', 5, '10:40', '11:30'),
  ('vespertino', 1, '13:00', '13:50'), ('vespertino', 2, '13:50', '14:40'), ('vespertino', 3, '14:40', '15:30'), ('vespertino', 4, '15:50', '16:40'), ('vespertino', 5, '16:40', '17:30');
