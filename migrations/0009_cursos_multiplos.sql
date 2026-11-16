-- Migração 0009 — vários cursos: texto padrão geral do certificado (usado por cursos sem texto próprio).
-- O texto aprovado no PPC do primeiro curso continua vinculado a ele (curso_id = 1).
INSERT INTO modelos_texto (documento, curso_id, texto)
SELECT 'certificado_qualificacao', NULL,
       replace(replace(texto, 'Deliberação CEE/MS nº {ato_ppc_numero}, de {ato_ppc_data_extenso}', '{ato_ppc_completo}'),
               'QUALIFICAÇÃO PROFISSIONAL TÉCNICA {modulo}', '{tipo_qualificacao} {modulo}')
  FROM modelos_texto
 WHERE documento = 'certificado_qualificacao' AND curso_id = 1 AND ativo = 1
   AND NOT EXISTS (SELECT 1 FROM modelos_texto WHERE documento = 'certificado_qualificacao' AND curso_id IS NULL)
 ORDER BY id DESC LIMIT 1;

-- Texto padrão geral da declaração: rótulo da qualificação e ato de autorização conforme o curso
UPDATE modelos_texto
   SET texto = replace(replace(texto,
         'QUALIFICAÇÃO PROFISSIONAL TÉCNICA de {qualificacao}', '{tipo_qualificacao} de {qualificacao}'),
         'Deliberação CEE/MS nº {ato_ppc_numero}, de {ato_ppc_data_extenso}', '{ato_ppc_completo}')
 WHERE documento = 'declaracao_conclusao_modulo' AND curso_id IS NULL AND ativo = 1;
