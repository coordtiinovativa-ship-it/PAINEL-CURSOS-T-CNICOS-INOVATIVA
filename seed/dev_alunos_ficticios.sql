-- DADOS FICTÍCIOS — somente ambiente dev. Nunca aplicar em produção.
-- Cobrem os três casos da regra de aprovação (PPC 11.1.1) no Módulo 1 — Qualidade:
--   aluno 1: aprovado direto (médias >= 6,0 e frequência >= 75%)
--   aluno 2: aprovado após exame final em uma disciplina (média final >= 5,0)
--   aluno 3: reprovado por frequência em uma disciplina

INSERT INTO turmas (id, curso_id, matriz_id, codigo, polo, data_inicio, data_fim, turno, ano_letivo)
VALUES (1, 1, 1, 'TIDC-2026-1', 'Sede — Campo Grande/MS', '2026-02-09', '2026-11-27', 'noturno', 2026);

-- Módulos da turma em sequência: 1 concluído, 2 em andamento, 3 planejado
INSERT INTO turma_modulos (turma_id, modulo_id, data_inicio, data_fim, situacao) VALUES
  (1, 1, '2026-02-09', '2026-06-26', 'concluido'),
  (1, 2, '2026-08-03', NULL, 'em_andamento'),
  (1, 3, NULL, NULL, 'planejado');

INSERT INTO alunos (id, ra, nome_civil, nome_social, cpf, rg, rg_orgao_expedidor, rg_uf, data_nascimento, sexo,
  naturalidade_municipio, naturalidade_uf, nacionalidade, nome_pai, nome_mae,
  ensino_medio_instituicao, ensino_medio_municipio, ensino_medio_uf, ensino_medio_ano_conclusao, email)
VALUES
  (1, '2026001', 'Ana Beatriz Fictícia Souza', NULL, '11122233396', '1234567', 'SEJUSP', 'MS', '1998-03-14', 'F',
   'Campo Grande', 'MS', 'brasileira', 'Carlos Fictício Souza', 'Maria Fictícia Souza',
   'Escola Estadual Exemplo', 'Campo Grande', 'MS', 2015, 'ana@exemplo.invalid'),
  (2, '2026002', 'João Pedro Fictício Lima', NULL, '22233344405', '7654321', 'SSP', 'MT', '2001-11-02', 'M',
   'Cuiabá', 'MT', 'brasileira', 'Paulo Fictício Lima', 'Joana Fictícia Lima',
   'Colégio Exemplo', 'Cuiabá', 'MT', 2018, 'joao@exemplo.invalid'),
  (3, '2026003', 'Roberto Fictício Alves', 'Renata Fictícia Alves', '33344455508', '2468135', 'SEJUSP', 'MS', '1995-07-30', 'F',
   'Dourados', 'MS', 'brasileira', 'Antônio Fictício Alves', 'Lúcia Fictícia Alves',
   'Escola Estadual Modelo', 'Dourados', 'MS', 2012, 'renata@exemplo.invalid');

INSERT INTO matriculas (id, aluno_id, turma_id, situacao) VALUES
  (1, 1, 1, 'cursando'),
  (2, 2, 1, 'cursando'),
  (3, 3, 1, 'cursando');

-- Resultados do Módulo 1 (componentes 1 a 6)
INSERT INTO resultados (matricula_id, componente_id, nota, nota_exame_final, frequencia) VALUES
  (1, 1, 8.5, NULL, 95), (1, 2, 7.0, NULL, 90), (1, 3, 9.0, NULL, 100),
  (1, 4, 6.5, NULL, 85), (1, 5, 8.0, NULL, 92), (1, 6, 7.5, NULL, 88),

  (2, 1, 7.0, NULL, 80), (2, 2, 4.5, 5.5,  78), (2, 3, 6.0, NULL, 90),
  (2, 4, 6.8, NULL, 82), (2, 5, 7.2, NULL, 85), (2, 6, 6.1, NULL, 76),

  (3, 1, 9.0, NULL, 70), (3, 2, 8.0, NULL, 90), (3, 3, 8.5, NULL, 95),
  (3, 4, 7.0, NULL, 88), (3, 5, 9.5, NULL, 91), (3, 6, 8.0, NULL, 85);
