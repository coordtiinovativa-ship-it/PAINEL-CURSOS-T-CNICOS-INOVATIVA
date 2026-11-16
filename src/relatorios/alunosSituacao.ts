/**
 * Relatório de alunos por situação de matrícula (Secretaria → Relatórios).
 * Usa o motor de documentos (A4 retrato) com rodapé próprio: quem emitiu, data e hora, em todas as páginas.
 */
import { formatarCPF } from '../lib/cpf';
import { dataBR } from '../lib/datas';
import { gerarCSV } from '../importacao/planilha';
import type { Bloco, DocumentoLayout } from '../documentos/tipos';

export const SITUACOES_MATRICULA: [string, string][] = [
  ['cursando', 'Cursando'], ['concluído', 'Concluído'], ['reprovado', 'Reprovado'], ['desistente', 'Desistente'],
];
const ROTULO = Object.fromEntries(SITUACOES_MATRICULA);

export interface Filtros { situacao: string | null; cursoId: number | null; turmaId: number | null }
export interface Emissor { nome: string; email: string }

export interface LinhaRelatorio { aluno: string; cpf: string; ra: string | null; turma: string; curso: string; situacao: string }

export function lerFiltros(q: Record<string, string>): Filtros {
  const situacao = q.situacao && ROTULO[q.situacao] ? q.situacao : null;
  return { situacao, cursoId: Number(q.curso) || null, turmaId: Number(q.turma) || null };
}

export async function consultar(db: D1Database, f: Filtros) {
  const linhas = (
    await db.prepare(
      `SELECT CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END AS aluno,
              a.cpf, a.ra, t.codigo AS turma, cu.nome AS curso, m.situacao
         FROM matriculas m JOIN alunos a ON a.id = m.aluno_id JOIN turmas t ON t.id = m.turma_id JOIN cursos cu ON cu.id = t.curso_id
        WHERE (?1 IS NULL OR m.situacao = ?1) AND (?2 IS NULL OR cu.id = ?2) AND (?3 IS NULL OR t.id = ?3)
        ORDER BY t.codigo, 1`,
    ).bind(f.situacao, f.cursoId, f.turmaId).all<LinhaRelatorio>()
  ).results;
  const [curso, turma] = await Promise.all([
    f.cursoId ? db.prepare('SELECT nome FROM cursos WHERE id = ?').bind(f.cursoId).first<{ nome: string }>() : null,
    f.turmaId ? db.prepare('SELECT codigo FROM turmas WHERE id = ?').bind(f.turmaId).first<{ codigo: string }>() : null,
  ]);
  const descricao = [
    `Situação: ${f.situacao ? ROTULO[f.situacao] : 'todas'}`,
    `Curso: ${curso?.nome ?? 'todos'}`,
    `Turma: ${turma?.codigo ?? 'todas'}`,
  ].join(' · ');
  return { linhas, descricao };
}

/** "16/11/2026 às 15:42" no horário de Mato Grosso do Sul (UTC−4). */
export function dataHoraMS(d = new Date()): string {
  const ms = new Date(d.getTime() - 4 * 3600_000).toISOString();
  return `${dataBR(ms)} às ${ms.slice(11, 16)}`;
}

export function montarLayout(
  instituicao: Record<string, any>,
  credenciamento: string,
  dados: Awaited<ReturnType<typeof consultar>>,
  emissor: Emissor,
  quando: string,
): DocumentoLayout {
  const { linhas, descricao } = dados;
  const cont = (s: string) => linhas.filter((l) => l.situacao === s).length;
  const emitido = `Emitido por ${emissor.nome} (${emissor.email}) em ${quando}.`;
  const blocos: Bloco[] = [
    { tipo: 'titulo', texto: 'RELATÓRIO DE ALUNOS POR SITUAÇÃO DE MATRÍCULA', subtitulo: descricao },
    {
      tipo: 'campos', itens: [
        { rotulo: 'Total de alunos', valor: String(linhas.length) },
        ...SITUACOES_MATRICULA.map(([v, r]) => ({ rotulo: r, valor: String(cont(v)) })),
      ].map((x, i) => ({ ...x, span: (i === 0 ? 4 : 1) as 1 | 4 })),
    },
  ];
  if (linhas.length) {
    blocos.push({
      tipo: 'tabela',
      colunas: [
        { titulo: 'Nº', largura: 0.55, alinhar: 'centro' }, { titulo: 'Aluno', largura: 4 }, { titulo: 'CPF', largura: 1.7 },
        { titulo: 'RA', largura: 1.1 }, { titulo: 'Turma', largura: 1.5 }, { titulo: 'Situação', largura: 1.3 },
      ],
      linhas: linhas.map((l, i) => [String(i + 1), l.aluno, l.cpf ? formatarCPF(l.cpf) : '', l.ra ?? '', l.turma, ROTULO[l.situacao] ?? l.situacao]),
      total: ['', `Total: ${linhas.length} aluno(s)`, '', '', '', ''],
    });
    const cursos = [...new Set(linhas.map((l) => `${l.turma}: ${l.curso}`))];
    blocos.push({ tipo: 'nota', texto: `Turmas e cursos: ${cursos.join(' · ')}.` });
  } else {
    blocos.push({ tipo: 'paragrafo', texto: 'Nenhum aluno encontrado com os filtros selecionados.', alinhar: 'centro', tamanho: 10.5 });
  }
  blocos.push({ tipo: 'nota', texto: emitido });
  return {
    versao: 1,
    titulo: 'Relatório de alunos por situação de matrícula',
    instituicao: {
      nome: String(instituicao.razao_social).toUpperCase(),
      enderecoLinha: `${instituicao.endereco} – ${instituicao.bairro}, ${instituicao.municipio} - ${instituicao.uf}, ${instituicao.cep}`,
      credenciamento,
      logo_r2_key: instituicao.logo_r2_key ?? null,
    },
    paginas: [{ blocos }],
    validacao: { codigo: null, url: null },
    rodape: [emitido, `Relatório de alunos por situação de matrícula · ${descricao}`, 'Documento de uso interno.'],
  };
}

export function gerarCSVRelatorio(dados: Awaited<ReturnType<typeof consultar>>, emissor: Emissor, quando: string): string {
  return gerarCSV([
    ['Relatório de alunos por situação de matrícula'],
    [dados.descricao],
    [`Emitido por ${emissor.nome} (${emissor.email}) em ${quando}`],
    [],
    ['Nº', 'Aluno', 'CPF', 'RA', 'Turma', 'Curso', 'Situação'],
    ...dados.linhas.map((l, i) => [i + 1, l.aluno, l.cpf ? formatarCPF(l.cpf) : '', l.ra ?? '', l.turma, l.curso, ROTULO[l.situacao] ?? l.situacao]),
  ]);
}
