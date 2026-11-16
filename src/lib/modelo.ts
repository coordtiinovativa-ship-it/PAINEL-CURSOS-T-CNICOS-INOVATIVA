/** Preenche modelos de texto com variáveis entre chaves: {curso} ou {{curso}}. */

const RE_VAR = /\{\{?\s*([a-z_]+)\s*\}?\}/g;

export function variaveisDoModelo(modelo: string): string[] {
  return [...new Set([...modelo.matchAll(RE_VAR)].map((m) => m[1]))];
}

export interface Segmento {
  texto: string;
  variavel?: string;
  faltante?: boolean;
  negrito?: boolean;
}

/** Divide o modelo em trechos fixos e variáveis (para destacar faltantes na prévia). */
export function segmentarModelo(
  modelo: string,
  dados: Record<string, string | null | undefined>,
): Segmento[] {
  // Trechos entre **asteriscos duplos** saem em negrito (como no modelo aprovado)
  const out: Segmento[] = [];
  modelo.split('**').forEach((trecho, i) => {
    const negrito = i % 2 === 1;
    let ultimo = 0;
    for (const m of trecho.matchAll(RE_VAR)) {
      if (m.index! > ultimo) out.push({ texto: trecho.slice(ultimo, m.index), negrito });
      const nome = m[1];
      const v = dados[nome];
      const faltante = v == null || String(v).trim() === '';
      out.push({ texto: faltante ? `[${nome}]` : String(v), variavel: nome, faltante, negrito });
      ultimo = m.index! + m[0].length;
    }
    if (ultimo < trecho.length) out.push({ texto: trecho.slice(ultimo), negrito });
  });
  return out;
}

export function preencherModelo(
  modelo: string,
  dados: Record<string, string | null | undefined>,
): { texto: string; faltantes: string[] } {
  const faltantes = new Set<string>();
  const texto = modelo.replace(RE_VAR, (_, nome: string) => {
    const v = dados[nome];
    if (v == null || String(v).trim() === '') {
      faltantes.add(nome);
      return `[${nome}]`;
    }
    return String(v);
  });
  return { texto: texto.replace(/\*\*/g, ''), faltantes: [...faltantes] };
}
