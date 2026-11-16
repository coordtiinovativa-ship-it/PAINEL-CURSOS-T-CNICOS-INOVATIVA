/**
 * Regras de aprovação no módulo — seção 11.1.1 do PPC.
 *
 * Disciplina aprovada (AP) se frequência >= 75% E
 *   (média >= 6,0  OU  média final >= 5,0 após exame final).
 * Módulo aprovado se TODAS as disciplinas do módulo estiverem AP.
 *
 * Os parâmetros (mínimos e forma de cálculo da média final após exame)
 * são configurados por curso no painel.
 */

export type MetodoExame = 'media_ponderada' | 'substitui' | 'maior';

export interface CriteriosAprovacao {
  frequenciaMinima: number; // %
  notaMinima: number; // aprovação direta
  notaMinimaExame: number; // média final após exame
  metodoExame: MetodoExame;
  pesoMedia: number;
  pesoExame: number;
}

export const CRITERIOS_PPC: CriteriosAprovacao = {
  frequenciaMinima: 75,
  notaMinima: 6.0,
  notaMinimaExame: 5.0,
  metodoExame: 'media_ponderada',
  pesoMedia: 1,
  pesoExame: 1,
};

export const ROTULO_METODO: Record<MetodoExame, string> = {
  media_ponderada: 'Média ponderada entre média e exame',
  substitui: 'Nota do exame substitui a média',
  maior: 'Maior nota entre média e exame',
};

/** Lê os critérios a partir das colunas da tabela `cursos`. */
export function criteriosDoCurso(c: {
  frequencia_minima: number;
  nota_minima: number;
  nota_minima_exame: number;
  metodo_exame: string;
  peso_media: number;
  peso_exame: number;
}): CriteriosAprovacao {
  return {
    frequenciaMinima: Number(c.frequencia_minima),
    notaMinima: Number(c.nota_minima),
    notaMinimaExame: Number(c.nota_minima_exame),
    metodoExame: c.metodo_exame as MetodoExame,
    pesoMedia: Number(c.peso_media),
    pesoExame: Number(c.peso_exame),
  };
}

export interface ResultadoDisciplina {
  componente: string;
  nota: number | null;
  notaExameFinal: number | null;
  frequencia: number | null;
  /** disciplina aprovada em matrícula anterior (aproveitamento) */
  aproveitada?: boolean;
}

export interface AvaliacaoDisciplina {
  componente: string;
  resultado: 'AP' | 'RP' | 'PENDENTE';
  mediaFinal: number | null;
  motivos: string[];
}

const EPS = 1e-9;
const fmt = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const arred = (n: number) => Math.round(n * 100) / 100;

export function calcularMediaFinal(
  media: number,
  exame: number,
  c: CriteriosAprovacao = CRITERIOS_PPC,
): number {
  switch (c.metodoExame) {
    case 'substitui':
      return arred(exame);
    case 'maior':
      return arred(Math.max(media, exame));
    case 'media_ponderada': {
      const soma = c.pesoMedia + c.pesoExame;
      if (soma <= 0) throw new Error('Pesos da média final inválidos (soma zero)');
      return arred((media * c.pesoMedia + exame * c.pesoExame) / soma);
    }
  }
}

export function avaliarDisciplina(
  r: ResultadoDisciplina,
  c: CriteriosAprovacao = CRITERIOS_PPC,
): AvaliacaoDisciplina {
  if (r.aproveitada) {
    return { componente: r.componente, resultado: 'AP', mediaFinal: r.nota, motivos: [] };
  }
  const motivos: string[] = [];
  if (r.nota == null || r.frequencia == null) {
    if (r.nota == null) motivos.push(`${r.componente}: nota não lançada`);
    if (r.frequencia == null) motivos.push(`${r.componente}: frequência não lançada`);
    return { componente: r.componente, resultado: 'PENDENTE', mediaFinal: null, motivos };
  }

  const freqOk = r.frequencia + EPS >= c.frequenciaMinima;
  if (!freqOk) {
    motivos.push(
      `${r.componente}: frequência ${fmt(r.frequencia)}% abaixo de ${fmt(c.frequenciaMinima)}%`,
    );
  }

  let mediaFinal = r.nota;
  let notaOk = r.nota + EPS >= c.notaMinima;
  if (!notaOk) {
    if (r.notaExameFinal == null) {
      motivos.push(
        `${r.componente}: média ${fmt(r.nota)} abaixo de ${fmt(c.notaMinima)} e sem exame final`,
      );
    } else {
      mediaFinal = calcularMediaFinal(r.nota, r.notaExameFinal, c);
      notaOk = mediaFinal + EPS >= c.notaMinimaExame;
      if (!notaOk) {
        motivos.push(
          `${r.componente}: média final ${fmt(mediaFinal)} após exame abaixo de ${fmt(c.notaMinimaExame)}`,
        );
      }
    }
  }

  return {
    componente: r.componente,
    resultado: freqOk && notaOk ? 'AP' : 'RP',
    mediaFinal,
    motivos,
  };
}

export interface AvaliacaoModulo {
  aprovado: boolean;
  pendente: boolean;
  disciplinas: AvaliacaoDisciplina[];
  motivos: string[];
}

/**
 * @param componentesDoModulo nomes de todas as disciplinas exigidas no módulo
 * @param resultados resultados lançados (podem faltar disciplinas)
 */
export function avaliarModulo(
  componentesDoModulo: string[],
  resultados: ResultadoDisciplina[],
  c: CriteriosAprovacao = CRITERIOS_PPC,
): AvaliacaoModulo {
  const porNome = new Map(resultados.map((r) => [r.componente, r]));
  const disciplinas = componentesDoModulo.map((nome) =>
    avaliarDisciplina(
      porNome.get(nome) ?? { componente: nome, nota: null, notaExameFinal: null, frequencia: null },
      c,
    ),
  );
  const motivos = disciplinas.flatMap((d) => d.motivos);
  const pendente = disciplinas.some((d) => d.resultado === 'PENDENTE');
  const aprovado = disciplinas.length > 0 && disciplinas.every((d) => d.resultado === 'AP');
  return { aprovado, pendente, disciplinas, motivos };
}
