-- se-vazio: funcionarios
-- Dados FICTÍCIOS de Gestão Pedagógica — somente para o ambiente local de testes (npm run local).
-- Requer dev_alunos_ficticios.sql (turma 1 TIDC-2026-1, noturno, módulo 2 em andamento desde 03/08/2026).

INSERT INTO funcionarios (id, nome, cpf, sexo, escolaridade, formacao, email, celular, endereco_municipio, endereco_uf) VALUES
  (1, 'Lucas Fictício Nunes', '52998224725', 'M', 'Especialização', 'Administração — Especialização em Gestão da Qualidade', 'lucas.ficticio@exemplo.com', '(67) 99999-0001', 'Campo Grande', 'MS'),
  (2, 'Ana Fictícia Prado', '11144477735', 'F', 'Mestrado', 'Economia — Mestrado em Desenvolvimento Local', 'ana.ficticia@exemplo.com', '(67) 99999-0002', 'Campo Grande', 'MS'),
  (3, 'Carlos Exemplo Ribeiro', '12345678909', 'M', 'Superior completo', 'Marketing', 'carlos.exemplo@exemplo.com', '(67) 99999-0003', 'Campo Grande', 'MS'),
  (4, 'Beatriz Teste Coordenadora', '93541134780', 'F', 'Especialização', 'Pedagogia — Gestão Escolar', 'beatriz.teste@exemplo.com', '(67) 99999-0004', 'Campo Grande', 'MS');

INSERT INTO funcionario_categorias (funcionario_id, categoria) VALUES
  (1, 'professor'), (2, 'professor'), (3, 'professor'), (4, 'coordenador'), (4, 'professor');

-- Lotações do módulo 2 (Empreendedorismo) da turma 1 — disciplinas 7 a 12
INSERT INTO lotacoes (id, turma_id, componente_id, funcionario_id, data_inicio, criado_por) VALUES
  (1, 1, 7, 1, '2026-08-03', 'seed'),   -- Design Thinking — Lucas
  (2, 1, 8, 2, '2026-08-03', 'seed'),   -- Educação Financeira — Ana
  (3, 1, 9, 3, '2026-08-03', 'seed'),   -- Marketing Digital — Carlos
  (4, 1, 10, 3, '2026-08-03', 'seed'),  -- E-Commerce — Carlos
  (5, 1, 11, 4, '2026-08-03', 'seed'),  -- Empreendedorismo — Beatriz
  (6, 1, 12, 2, '2026-08-03', 'seed');  -- Desenvolvimento Local — Ana

-- Grade (noturno: tempos 1–4); dia 1 = segunda
INSERT INTO horario_aulas (lotacao_id, dia_semana, tempo) VALUES
  (1, 1, 1), (1, 1, 2),     -- seg: Design Thinking
  (2, 2, 1), (2, 2, 2),     -- ter: Educação Financeira
  (3, 3, 1), (3, 3, 2),     -- qua: Marketing Digital
  (4, 3, 3),                -- qua: E-Commerce
  (5, 4, 1), (5, 4, 2),     -- qui: Empreendedorismo
  (6, 5, 1), (6, 5, 2),     -- sex: Desenvolvimento Local
  (1, 1, 3);                -- seg: Design Thinking (3º tempo)

-- Calendário 2026: feriados nacionais + municipal/estadual de exemplo + recesso de julho
INSERT INTO calendario_eventos (ano_letivo_id, data_inicio, data_fim, tipo, descricao) VALUES
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-01-01', '2026-01-01', 'feriado', 'Confraternização Universal'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-02-16', '2026-02-16', 'ponto_facultativo', 'Carnaval'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-02-17', '2026-02-17', 'ponto_facultativo', 'Carnaval'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-04-03', '2026-04-03', 'feriado', 'Sexta-feira Santa'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-04-21', '2026-04-21', 'feriado', 'Tiradentes'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-05-01', '2026-05-01', 'feriado', 'Dia do Trabalho'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-06-04', '2026-06-04', 'ponto_facultativo', 'Corpus Christi'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-07-06', '2026-07-31', 'recesso', 'Recesso escolar de julho'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-08-26', '2026-08-26', 'feriado', 'Aniversário de Campo Grande (exemplo)'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-09-07', '2026-09-07', 'feriado', 'Independência do Brasil'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-10-11', '2026-10-11', 'feriado', 'Criação do Estado de MS (exemplo)'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-10-12', '2026-10-12', 'feriado', 'Nossa Senhora Aparecida'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-11-02', '2026-11-02', 'feriado', 'Finados'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-11-15', '2026-11-15', 'feriado', 'Proclamação da República'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-11-20', '2026-11-20', 'feriado', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ((SELECT id FROM anos_letivos WHERE ano = 2026), '2026-12-25', '2026-12-25', 'feriado', 'Natal');