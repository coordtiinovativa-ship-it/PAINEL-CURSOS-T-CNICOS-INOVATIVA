/**
 * Leitura de planilhas enviadas pela secretaria: CSV (UTF-8 ou Windows-1252, separador ; , ou tab)
 * e XLSX (primeira aba). Também normaliza os valores típicos do Excel brasileiro.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { ESTADOS } from '../certificado/dados';
import { ErroValidacao } from '../lib/form';

export type Tabela = string[][];

export const MAX_LINHAS = 3000;

// ------------------------------- decodificação -------------------------------
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** UTF-8 (com ou sem BOM); se inválido, Windows-1252 (CSV salvo pelo Excel em português). */
export function decodificarTexto(b: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(b).replace(/^﻿/, '');
  } catch {
    let s = '';
    for (const x of b) s += String.fromCharCode(CP1252[x] ?? x);
    return s;
  }
}

// ------------------------------------ CSV ------------------------------------
export function lerCSV(texto: string): Tabela {
  const primeira = texto.slice(0, texto.indexOf('\n') >= 0 ? texto.indexOf('\n') : texto.length);
  const contar = (ch: string) => primeira.split(ch).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => contar(b) - contar(a))[0];
  const linhas: Tabela = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += ch;
    } else if (ch === '"' && campo === '') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// ------------------------------------ XLSX ------------------------------------
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const desescapar = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m);
const textoRuns = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => desescapar(m[1])).join('');

function colunaIndice(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref)![0];
  let n = 0;
  for (const l of letras) n = n * 26 + (l.charCodeAt(0) - 64);
  return n - 1;
}

export function lerXLSX(bytes: Uint8Array): Tabela {
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  } catch {
    throw new ErroValidacao('Arquivo .xlsx inválido ou corrompido.');
  }
  const ler = (n: string) => (arquivos[n] ? strFromU8(arquivos[n]) : null);
  // primeira aba (pela ordem do workbook)
  let caminho = 'xl/worksheets/sheet1.xml';
  const wb = ler('xl/workbook.xml');
  const rels = ler('xl/_rels/workbook.xml.rels');
  const rid = wb && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  if (rid && rels) {
    const alvo = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
    if (alvo) caminho = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`;
  }
  const folha = ler(caminho);
  if (!folha) throw new ErroValidacao('Não encontrei a primeira aba da planilha.');
  const compartilhadas = [...(ler('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoRuns(m[1]));

  const tabela: Tabela = [];
  for (const mLinha of folha.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(/\br="(\d+)"/.exec(mLinha[0])?.[1] ?? tabela.length + 1) - 1;
    const linha: string[] = [];
    for (const c of (mLinha[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const t = /\bt="(\w+)"/.exec(attrs)?.[1];
      const corpo = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let valor = '';
      if (t === 's') valor = compartilhadas[Number(v)] ?? '';
      else if (t === 'inlineStr') valor = textoRuns(corpo);
      else if (t === 'b') valor = v === '1' ? 'VERDADEIRO' : 'FALSO';
      else valor = v != null ? desescapar(v) : '';
      linha[ref ? colunaIndice(ref) : linha.length] = valor;
    }
    tabela[r] = Array.from(linha, (x) => x ?? '');
  }
  return Array.from(tabela, (l) => l ?? []);
}

/** Lê CSV ou XLSX pelo conteúdo; remove linhas vazias. */
export function lerPlanilha(bytes: Uint8Array): Tabela {
  const ehZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const t = ehZip ? lerXLSX(bytes) : lerCSV(decodificarTexto(bytes));
  const limpa = t.map((l) => l.map((c) => (c ?? '').trim())).filter((l) => l.some((c) => c !== ''));
  if (limpa.length > MAX_LINHAS + 1) throw new ErroValidacao(`A planilha tem mais de ${MAX_LINHAS} linhas; divida em arquivos menores.`);
  return limpa;
}

// ------------------------------ normalização ------------------------------
/** "Data de Nascimento" → "data_de_nascimento" (sem acentos, minúsculas). */
export function chave(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const UF_POR_NOME = Object.fromEntries(Object.entries(ESTADOS).map(([uf, nome]) => [chave(nome), uf]));

export function normalizarUF(v: string): string | null {
  if (!v) return null;
  const u = v.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(u) && ESTADOS[u]) return u;
  return UF_POR_NOME[chave(v)] ?? null;
}

/** dd/mm/aaaa, d/m/aa, aaaa-mm-dd ou número de série do Excel → ISO. null se vazio; lança se inválido. */
export function normalizarData(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  let a: number, m: number, d: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t))) {
    d = +r[1]; m = +r[2]; a = +r[3];
    if (r[3].length === 2) a += a > new Date().getFullYear() % 100 ? 1900 : 2000;
  } else if ((r = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) {
    a = +r[1]; m = +r[2]; d = +r[3];
  } else if (/^\d{4,6}(\.\d+)?$/.test(t)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400_000); // série do Excel
    a = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else throw new ErroValidacao(`data inválida "${t}"`);
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new ErroValidacao(`data inexistente "${t}"`);
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** CPF só com dígitos; recompõe zeros à esquerda que o Excel remove. */
export function normalizarCPF(v: string): string | null {
  let d = v.replace(/\.0+$/, '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length >= 8 && d.length < 11) d = d.padStart(11, '0');
  return d;
}

/** "7,5" / "7.5" / "95%" → número; vazio → null; lança se inválido. */
export function normalizarNumero(v: string, rotulo: string): number | null {
  const t = v.trim().replace('%', '').replace(/\s/g, '');
  if (!t || t === '-' || t === '—') return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) throw new ErroValidacao(`${rotulo}: número inválido "${v}"`);
  return Math.round(n * 100) / 100;
}

/** Gera CSV para o Excel brasileiro (separador ;, BOM UTF-8). */
export function gerarCSV(linhas: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + linhas.map((l) => l.map(esc).join(';')).join('\r\n') + '\r\n';
}
