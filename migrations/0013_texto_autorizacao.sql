-- Atos impressos no cabeçalho dos documentos, no lugar de "Atos autorizativos vigentes" (padrão do sysGEP):
--   1º as linhas FIXAS da instituição (criação e credenciamento) — instituicoes.texto_atos
--   2º as linhas DINÂMICAS do curso da turma (autorização, reconhecimento...) — cursos.texto_autorizacao
-- Texto livre: o que for digitado é o que sai, uma linha por linha.
ALTER TABLE instituicoes ADD COLUMN texto_atos TEXT;
ALTER TABLE cursos ADD COLUMN texto_autorizacao TEXT;

-- Formato: "Deliberação CEE/MS n. 10994, de 06/02/2017" (número sem ponto, data dd/mm/aaaa).
-- Instituição: "Criação: ata n. 01, de 23/02/2010." + "Educação Profissional Técnica de Nível Médio credenciamento: ..."
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

-- Curso: "Curso Técnico em ...: Deliberação CEE/MS n. 13111, de 18/12/2024" (ato de autorização ativo mais recente).
UPDATE cursos
   SET texto_autorizacao = (
     SELECT cursos.nome || ': ' || a.tipo || ' ' ||
            CASE WHEN a.orgao_emissor LIKE '%CEE/MS%' THEN 'CEE/MS' ELSE a.orgao_emissor END ||
            ' n. ' || replace(a.numero, '.', '') || ', de ' ||
            substr(a.data, 9, 2) || '/' || substr(a.data, 6, 2) || '/' || substr(a.data, 1, 4)
       FROM atos_regulatorios a
      WHERE a.curso_id = cursos.id AND a.finalidade = 'autorizacao_curso' AND a.ativo = 1
      ORDER BY a.data DESC LIMIT 1)
 WHERE texto_autorizacao IS NULL;
