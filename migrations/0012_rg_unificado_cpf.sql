-- RG unificado ao CPF (Carteira de Identidade Nacional — CIN): o número do RG é o próprio CPF.
ALTER TABLE alunos ADD COLUMN rg_unificado_cpf INTEGER NOT NULL DEFAULT 0 CHECK (rg_unificado_cpf IN (0,1));

-- Alunos já cadastrados com RG igual ao CPF passam a usar a opção (RG no formato do CPF).
UPDATE alunos
   SET rg_unificado_cpf = 1,
       rg = substr(cpf, 1, 3) || '.' || substr(cpf, 4, 3) || '.' || substr(cpf, 7, 3) || '-' || substr(cpf, 10, 2)
 WHERE length(cpf) = 11
   AND replace(replace(replace(replace(coalesce(rg, ''), '.', ''), '-', ''), ' ', ''), '/', '') = cpf;
