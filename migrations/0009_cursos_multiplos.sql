-- Migração 0009 — vários cursos: texto padrão geral do certificado (usado por cursos sem texto próprio).
-- O texto aprovado no PPC do primeiro curso continua vinculado a ele (curso_id = 1).
INSERT INTO modelos_texto (documento, curso_id, texto)
SELECT 'certificado_qualificacao', NULL, texto
  FROM modelos_texto
 WHERE documento = 'certificado_qualificacao' AND curso_id = 1 AND ativo = 1
   AND NOT EXISTS (SELECT 1 FROM modelos_texto WHERE documento = 'certificado_qualificacao' AND curso_id IS NULL)
 ORDER BY id DESC LIMIT 1;
