-- Migração 0011 — (1) negrito parcial do texto do certificado, conforme o modelo atualizado (16/11/2026);
-- (2) lançamento de notas e faltas: professor, dias, horário e tempo das aulas por disciplina da turma.

-- (1) Trechos em negrito no modelo aprovado: nome do Instituto, "{curso} - Eixo Tecnológico:",
--     "Área Tecnológica:" e "CERTIFICADO por ter concluído com êxito o MÓDULO TEMÁTICO DA ... {modulo}".
UPDATE modelos_texto
   SET texto = replace(replace(replace(replace(replace(texto,
         'Instituto Inovativa de Educação, Ciência e Tecnologia - IECT no uso', '**Instituto Inovativa de Educação, Ciência e Tecnologia - IECT** no uso'),
         '{curso} - Eixo Tecnológico:', '**{curso} - Eixo Tecnológico:**'),
         'Área Tecnológica:', '**Área Tecnológica:**'),
         'CERTIFICADO por ter concluído com êxito o MÓDULO TEMÁTICO DA QUALIFICAÇÃO PROFISSIONAL TÉCNICA {modulo}',
         '**CERTIFICADO por ter concluído com êxito o MÓDULO TEMÁTICO DA QUALIFICAÇÃO PROFISSIONAL TÉCNICA {modulo}**'),
         'CERTIFICADO por ter concluído com êxito o MÓDULO TEMÁTICO DA {tipo_qualificacao} {modulo}',
         '**CERTIFICADO por ter concluído com êxito o MÓDULO TEMÁTICO DA {tipo_qualificacao} {modulo}**')
 WHERE documento = 'certificado_qualificacao' AND instr(texto, '**') = 0;

-- (2) Disciplina na turma: professor, dias da semana, horário e tempo de cada aula
CREATE TABLE turma_disciplinas (
  id                 INTEGER PRIMARY KEY,
  turma_id           INTEGER NOT NULL REFERENCES turmas(id),
  componente_id      INTEGER NOT NULL REFERENCES componentes_curriculares(id),
  professor          TEXT,
  dias_semana        TEXT,      -- ex.: "seg,qua"
  hora_inicio        TEXT,      -- "19:00"
  hora_fim           TEXT,      -- "22:30"
  duracao_aula_min   INTEGER CHECK (duracao_aula_min IS NULL OR (duracao_aula_min BETWEEN 10 AND 600)),
  atualizado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (turma_id, componente_id)
);

-- Faltas do aluno na disciplina, em nº de aulas (a frequência passa a ser calculada a partir delas)
ALTER TABLE resultados ADD COLUMN faltas INTEGER CHECK (faltas IS NULL OR faltas >= 0);
