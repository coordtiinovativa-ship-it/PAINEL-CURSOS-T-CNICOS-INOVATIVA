-- Texto livre da autorização do curso, impresso no cabeçalho dos documentos abaixo de
-- "Atos autorizativos vigentes" (uma linha por linha digitada). O que for digitado é o que sai.
ALTER TABLE cursos ADD COLUMN texto_autorizacao TEXT;

-- Cursos existentes: preenchido a partir do ato de autorização ativo mais recente (editável na tela).
-- Ex.: "Curso Técnico em Inovação e Desenvolvimento Corporativo: Deliberação CEE/MS nº 13.111, de 18/12/2024"
UPDATE cursos
   SET texto_autorizacao = (
     SELECT cursos.nome || ': ' || a.tipo || ' ' ||
            CASE WHEN a.orgao_emissor LIKE '%CEE/MS%' THEN 'CEE/MS' ELSE a.orgao_emissor END ||
            ' nº ' || a.numero || ', de ' ||
            substr(a.data, 9, 2) || '/' || substr(a.data, 6, 2) || '/' || substr(a.data, 1, 4)
       FROM atos_regulatorios a
      WHERE a.curso_id = cursos.id AND a.finalidade = 'autorizacao_curso' AND a.ativo = 1
      ORDER BY a.data DESC LIMIT 1)
 WHERE texto_autorizacao IS NULL;
