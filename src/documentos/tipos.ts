/**
 * Motor de documentos (A4 retrato): cada documento é uma lista de blocos. O mesmo layout é
 * renderizado em HTML (prévia em tela) e em PDF (pdf-lib). Usado pela declaração de conclusão,
 * histórico escolar e, depois, ata de resultados e livro de registro.
 * O layout inteiro é guardado como snapshot na emissão: o PDF pode ser regerado idêntico.
 */

export type Alinhamento = 'esquerda' | 'centro' | 'direita' | 'justificado';

export interface ColunaTabela {
  titulo: string;
  /** fração da largura útil (as larguras são normalizadas) */
  largura: number;
  alinhar?: 'esquerda' | 'centro' | 'direita';
}

export type Bloco =
  | { tipo: 'titulo'; texto: string; subtitulo?: string }
  | { tipo: 'secao'; texto: string }
  | { tipo: 'paragrafo'; texto: string; alinhar?: Alinhamento; recuo?: boolean; negrito?: boolean; tamanho?: number; entrelinha?: number }
  | { tipo: 'campos'; itens: { rotulo: string; valor: string | null; span?: 1 | 2 | 3 | 4 }[] }
  | { tipo: 'tabela'; colunas: ColunaTabela[]; linhas: string[][]; total?: string[] }
  | { tipo: 'lista'; itens: string[] }
  | { tipo: 'nota'; texto: string }
  | { tipo: 'assinaturas'; itens: { legenda: string; nome?: string | null; assinatura_r2_key?: string | null; detalhe?: string | null }[] }
  | { tipo: 'espaco'; altura: number };

export interface PaginaDoc {
  blocos: Bloco[];
}

export interface DocumentoLayout {
  versao: 1;
  titulo: string;
  instituicao: { nome: string; enderecoLinha: string; credenciamento: string; logo_r2_key: string | null;
    /** linhas de atos: fixas da instituição + do curso (ausente em documentos anteriores à migração 0013 e em relatórios) */
    atos?: string[] };
  paginas: PaginaDoc[];
  validacao: { codigo: string | null; url: string | null };
  /** Rodapé próprio (relatórios): substitui o rodapé de validação/QR e numera as páginas */
  rodape?: string[];
}

/** Medidas A4 retrato (mm) — compartilhadas pelos dois renderizadores. */
export const A4 = {
  largura: 210,
  altura: 297,
  margem: { topo: 12, lado: 18, base: 30 },
  rodape: 22, // faixa do rodapé com QR e código
};

/** Cores da marca usadas nos documentos. */
export const CORES = {
  marinho: [0, 60, 128] as const,
  faixa: [[0, 60, 128], [45, 123, 185], [37, 160, 220], [0, 168, 144], [110, 190, 139]] as const,
  cinza: [85, 102, 126] as const,
  borda: [200, 210, 222] as const,
  cabecalhoTabela: [237, 242, 248] as const,
  zebra: [247, 249, 252] as const,
};
