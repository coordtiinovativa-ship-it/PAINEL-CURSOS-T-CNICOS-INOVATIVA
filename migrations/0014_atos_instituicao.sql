-- Atos impressos no cabeçalho dos documentos, no lugar de "Atos autorizativos vigentes" (padrão do sysGEP):
--   1º as linhas FIXAS da instituição (criação e credenciamento) — instituicoes.texto_atos (nova)
--   2º as linhas DINÂMICAS do curso da turma — cursos.texto_autorizacao (migração 0013)
-- Texto livre: o que for digitado é o que sai, uma linha por linha.
-- (A 0013 já tinha sido aplicada em produção na 1ª versão; esta migração completa o padrão.)
ALTER TABLE instituicoes ADD COLUMN texto_atos TEXT;

-- Formato: "Deliberação CEE/MS n. 10994, de 06/02/2017" (número sem ponto, data dd/mm/aaaa).
UPDATE instituicoes
   SET texto_atos = (
     SELECT group_concat(linha, char(10)) FROM (
       SELECT 1 AS ordem, 'Criação: ' || lower(a.tipo) || ' n. ' || a.numero || ', de ' ||
              substr(a.data, 9, 2) || '/' || substr(a.data, 6, 2) || '/' || substr(a.data, 1, 4) || '.' AS linha
         FROM atos_regulatorios a
        WHERE a.instituicao_id = instituicoes.id AND a.finalidade = 'criacao_instituicao' AND a.ativo = 1
       UNION ALL
       SELECT 2, 'Educação Profissional Técnica de Nível Médio credenciamento: ' || a.tipo || ' ' ||
              CASE WHEN a.orgao_emissor LIKE '%CEE/MS%' THEN 'CEE/MS' ELSE a.orgao_emissor END ||
              ' n. ' || replace(a.numero, '.', '') || ', de ' ||
              substr(a.data, 9, 2) || '/' || substr(a.data, 6, 2) || '/' || substr(a.data, 1, 4) || '.'
         FROM atos_regulatorios a
        WHERE a.instituicao_id = instituicoes.id AND a.finalidade = 'credenciamento' AND a.ativo = 1
       ORDER BY 1))
 WHERE texto_atos IS NULL;

-- Curso: passa para o mesmo padrão ("n. 13111"), mas só se o texto ainda for exatamente o gerado pela 0013
-- (texto editado na tela não é tocado).
UPDATE cursos
   SET texto_autorizacao = (
     SELECT cursos.nome || ': ' || a.tipo || ' ' ||
            CASE WHEN a.orgao_emissor LIKE '%CEE/MS%' THEN 'CEE/MS' ELSE a.orgao_emissor END ||
            ' n. ' || replace(a.numero, '.', '') || ', de ' ||
            substr(a.data, 9, 2) || '/' || substr(a.data, 6, 2) || '/' || substr(a.data, 1, 4)
       FROM atos_regulatorios a
      WHERE a.curso_id = cursos.id AND a.finalidade = 'autorizacao_curso' AND a.ativo = 1
      ORDER BY a.data DESC LIMIT 1)
 WHERE texto_autorizacao = (
     SELECT cursos.nome || ': ' || a.tipo || ' ' ||
            CASE WHEN a.orgao_emissor LIKE '%CEE/MS%' THEN 'CEE/MS' ELSE a.orgao_emissor END ||
            ' nº ' || a.numero || ', de ' ||
            substr(a.data, 9, 2) || '/' || substr(a.data, 6, 2) || '/' || substr(a.data, 1, 4)
       FROM atos_regulatorios a
      WHERE a.curso_id = cursos.id AND a.finalidade = 'autorizacao_curso' AND a.ativo = 1
      ORDER BY a.data DESC LIMIT 1);
