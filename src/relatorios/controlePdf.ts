/**
 * PDF dos relatórios Controle de Notas e Controle de Faltas — A4 paisagem, no layout do sysGEP:
 * linha "Emitido por / Emissão / Página", cabeçalho (logo, instituição, título), faixa do local, curso/qualificação/turma,
 * professor/U.C. e a tabela (repetidos em todas as páginas). Coordenadas "a partir do topo", em pt.
 */
import { degrees, PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { formatarTelefone } from '../certificado/dados';
import { ROTULO_TURNO } from '../lib/pedagogico';
import { ROTULO_STATUS } from '../lib/matricula';
import type { AlunoControle, DadosControle, DisciplinaControle } from './controle';

export interface RecursosControle { fonteRegular: Uint8Array; fonteNegrito: Uint8Array; logo: Uint8Array }
export type TipoControle = 'notas' | 'faltas';

const W = 841.89;
const H = 595.28;
const X0 = 20;
const LARG = W - 2 * X0;
const BASE = H - 20; // limite inferior da área útil
const PRETO = rgb(0.08, 0.08, 0.1);
const BORDA = rgb(0.45, 0.45, 0.45);
const CINZA_FAIXA = rgb(0.42, 0.42, 0.42);
const CINZA_CAB = rgb(0.86, 0.86, 0.86);
const CINZA_LINHA = rgb(0.9, 0.9, 0.9);
const BRANCO = rgb(1, 1, 1);
const OPCOES_FONTE = { subset: false, features: { liga: false, clig: false, dlig: false, calt: false, rlig: false } };

interface Ctx { doc: PDFDocument; r: PDFFont; b: PDFFont; logo: PDFImage; pg: PDFPage }

const num = (n: number | null, casas = 2) => (n == null ? '' : n.toFixed(casas).replace('.', ','));
const dataBR = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

function texto(ctx: Ctx, t: string, x: number, topo: number, size: number, font: PDFFont, cor: RGB = PRETO, rot?: number) {
  ctx.pg.drawText(t, { x, y: H - topo - size * 0.8, size, font, color: cor, ...(rot ? { rotate: degrees(rot) } : {}) });
}
/** Tamanho de fonte para caber na largura (até `min`); abaixo disso, corta com reticências. */
function caber(t: string, font: PDFFont, size: number, largura: number, min = 5): { t: string; size: number } {
  let s = size;
  while (s > min && font.widthOfTextAtSize(t, s) > largura) s -= 0.25;
  if (font.widthOfTextAtSize(t, s) <= largura) return { t, size: s };
  let u = t;
  while (u.length > 1 && font.widthOfTextAtSize(u + '…', s) > largura) u = u.slice(0, -1);
  return { t: u + '…', size: s };
}
function celula(ctx: Ctx, t: string, x: number, topo: number, w: number, h: number, opc: { font?: PDFFont; size?: number; alinhar?: 'e' | 'c' | 'd'; cor?: RGB } = {}) {
  const font = opc.font ?? ctx.r;
  const f = caber(t, font, opc.size ?? 7, w - 4);
  const tw = font.widthOfTextAtSize(f.t, f.size);
  const x1 = opc.alinhar === 'c' ? x + (w - tw) / 2 : opc.alinhar === 'd' ? x + w - 2 - tw : x + 2;
  texto(ctx, f.t, x1, topo + (h - f.size) / 2 + 0.6, f.size, font, opc.cor);
}
function caixa(ctx: Ctx, x: number, topo: number, w: number, h: number, opc: { fundo?: RGB; borda?: RGB | null; esp?: number } = {}) {
  ctx.pg.drawRectangle({
    x, y: H - topo - h, width: w, height: h,
    ...(opc.fundo ? { color: opc.fundo } : {}),
    ...(opc.borda === null ? {} : { borderColor: opc.borda ?? BORDA, borderWidth: opc.esp ?? 0.5 }),
  });
}
/** Texto centralizado em várias linhas (quebra por palavra). */
function centroQuebrado(ctx: Ctx, t: string, x: number, topo: number, w: number, size: number, font: PDFFont, maxLinhas = 2): number {
  const linhas: string[] = [];
  let atual = '';
  for (const p of t.split(/\s+/)) {
    const tent = atual ? `${atual} ${p}` : p;
    if (font.widthOfTextAtSize(tent, size) > w && atual) { linhas.push(atual); atual = p; } else atual = tent;
  }
  if (atual) linhas.push(atual);
  linhas.slice(0, maxLinhas).forEach((l, i) => {
    const f = caber(l, font, size, w);
    texto(ctx, f.t, x + (w - font.widthOfTextAtSize(f.t, f.size)) / 2, topo + i * size * 1.15, f.size, font);
  });
  return Math.min(linhas.length, maxLinhas) * size * 1.15;
}

/** Cabeçalho completo da página; devolve o topo onde começa a tabela. */
function cabecalho(ctx: Ctx, tipo: TipoControle, d: DadosControle, disc: DisciplinaControle, parte: string | null): number {
  const i = d.instituicao;
  // bloco: logo | instituição | título
  const topo = 22, alt = 64, wLogo = 96, wInst = 300, wTit = LARG - wLogo - wInst;
  caixa(ctx, X0, topo, LARG, alt);
  ctx.pg.drawLine({ start: { x: X0 + wLogo, y: H - topo }, end: { x: X0 + wLogo, y: H - topo - alt }, thickness: 0.5, color: BORDA });
  ctx.pg.drawLine({ start: { x: X0 + wLogo + wInst, y: H - topo }, end: { x: X0 + wLogo + wInst, y: H - topo - alt }, thickness: 0.5, color: BORDA });
  const esc = Math.min((wLogo - 12) / ctx.logo.width, (alt - 10) / ctx.logo.height);
  const lw = ctx.logo.width * esc, lh = ctx.logo.height * esc;
  ctx.pg.drawImage(ctx.logo, { x: X0 + (wLogo - lw) / 2, y: H - topo - (alt + lh) / 2, width: lw, height: lh });
  const xi = X0 + wLogo + 6, wi = wInst - 12;
  let y = topo + 5;
  y += centroQuebrado(ctx, (i.razao_social ?? '').toUpperCase(), xi, y, wi, 9, ctx.b);
  const tel = formatarTelefone(i.telefone);
  const linhas = [
    [i.endereco, i.bairro].filter(Boolean).join(' - ') + (i.cep ? ` - CEP ${i.cep}` : ''),
    [i.municipio && `${i.municipio}-${i.uf ?? ''}`, tel && `Fone: ${tel}`].filter(Boolean).join(' - '),
    i.email ? `E-mail: ${i.email}` : '',
  ].filter(Boolean);
  for (const l of linhas) {
    const f = caber(l, ctx.r, 6.8, wi);
    texto(ctx, f.t, xi + (wi - ctx.r.widthOfTextAtSize(f.t, f.size)) / 2, y + 1, f.size, ctx.r);
    y += 8.2;
  }
  const xt = X0 + wLogo + wInst;
  const titulo = tipo === 'notas' ? 'CONTROLE DE NOTAS' : 'CONTROLE DE FALTAS';
  texto(ctx, titulo, xt + (wTit - ctx.b.widthOfTextAtSize(titulo, 15)) / 2, topo + 8, 15, ctx.b);
  const fase = `Ano Letivo: ${d.turma.ano ?? '—'}      Fase: ${d.modulo.ordem}º MÓDULO - ${d.modulo.nome.toUpperCase()}`;
  const ff = caber(fase, ctx.b, 8.5, wTit - 12);
  texto(ctx, ff.t, xt + (wTit - ctx.b.widthOfTextAtSize(ff.t, ff.size)) / 2, topo + 31, ff.size, ctx.b);
  const sub = (tipo === 'faltas' ? `Período do módulo: ${dataBR(d.modulo.inicio)} até ${d.modulo.fim ? dataBR(d.modulo.fim) : 'em andamento'} · ` : '')
    + `Ordenação dos alunos: ${d.ordem === 'alfabetica' ? 'Alfabética' : 'Nº de chamada'}${parte ? ` · ${parte}` : ''}`;
  const fs = caber(sub, ctx.r, 6.8, wTit - 12);
  texto(ctx, fs.t, xt + (wTit - ctx.r.widthOfTextAtSize(fs.t, fs.size)) / 2, topo + 46, fs.size, ctx.r);

  // faixa do local
  const local = d.turma.polo?.trim() || [i.nome_fantasia || i.razao_social, i.municipio && `${i.municipio}-${i.uf ?? ''}`].filter(Boolean).join(' - ');
  caixa(ctx, X0, topo + alt, LARG, 13, { fundo: CINZA_FAIXA, borda: null });
  celula(ctx, `LOCAL: ${String(local).toUpperCase()}`, X0, topo + alt, LARG, 13, { font: ctx.b, size: 8.5, alinhar: 'c', cor: BRANCO });

  // curso | qualificação | turma ; professor | U.C.
  const l1 = topo + alt + 13, l2 = l1 + 12;
  const turno = d.turma.turno ? ` - ${(ROTULO_TURNO[d.turma.turno] ?? d.turma.turno).toUpperCase()}` : '';
  const c1 = LARG * 0.42, c2 = LARG * 0.36, c3 = LARG - c1 - c2;
  caixa(ctx, X0, l1, c1, 12); caixa(ctx, X0 + c1, l1, c2, 12); caixa(ctx, X0 + c1 + c2, l1, c3, 12);
  celula(ctx, `Curso: ${d.curso.toUpperCase()}`, X0, l1, c1, 12, { font: ctx.b, size: 8 });
  celula(ctx, `Qualificação: ${(d.modulo.qualificacao ?? d.modulo.nome).toUpperCase()}`, X0 + c1, l1, c2, 12, { font: ctx.b, size: 8 });
  celula(ctx, `Turma: ${d.turma.codigo}${turno}`, X0 + c1 + c2, l1, c3, 12, { font: ctx.b, size: 8 });
  caixa(ctx, X0, l2, c1 + c2 * 0.35, 12); caixa(ctx, X0 + c1 + c2 * 0.35, l2, LARG - c1 - c2 * 0.35, 12);
  celula(ctx, `Professor(a): ${(disc.professor ?? '—').toUpperCase()}`, X0, l2, c1 + c2 * 0.35, 12, { font: ctx.b, size: 8 });
  celula(ctx, `U.C.: ${disc.nome.toUpperCase()} (${disc.ch} h)`, X0 + c1 + c2 * 0.35, l2, LARG - c1 - c2 * 0.35, 12, { font: ctx.b, size: 8 });
  return l2 + 12 + 4;
}

/** Nome do aluno + sufixo do status em negrito (ex.: " - TRANSF. 12/06/2026"). */
function nomeAluno(ctx: Ctx, a: AlunoControle, x: number, topo: number, w: number, h: number) {
  const nome = a.nome.toUpperCase();
  const suf = a.sufixo ? ` - ${a.sufixo}` : '';
  let s = 6.8;
  while (s > 4.8 && ctx.r.widthOfTextAtSize(nome, s) + ctx.b.widthOfTextAtSize(suf, s) > w - 4) s -= 0.2;
  const f = caber(nome, ctx.r, s, w - 4 - ctx.b.widthOfTextAtSize(suf, s), s);
  const ty = topo + (h - f.size) / 2 + 0.6;
  texto(ctx, f.t, x + 2, ty, f.size, ctx.r);
  if (suf) texto(ctx, suf, x + 2 + ctx.r.widthOfTextAtSize(f.t, f.size), ty, f.size, ctx.b);
}

interface Coluna { rotulo: string; w: number; valor: (a: AlunoControle) => string; alinhar?: 'e' | 'c' | 'd'; nome?: boolean }

function desenharTabela(
  ctx: Ctx, novaPagina: () => number, colunas: Coluna[], alunos: AlunoControle[], altCab: number,
  cabecalhoColuna: (c: Coluna, x: number, topo: number) => void, nota?: string,
) {
  const ALT = 11;
  let topo = novaPagina();
  const cab = (t: number) => {
    let x = X0;
    for (const c of colunas) { caixa(ctx, x, t, c.w, altCab, { fundo: CINZA_CAB }); cabecalhoColuna(c, x, t); x += c.w; }
    return t + altCab;
  };
  topo = cab(topo);
  if (!alunos.length) {
    caixa(ctx, X0, topo, LARG, ALT);
    celula(ctx, 'Nenhum aluno para listar.', X0, topo, LARG, ALT, { alinhar: 'c' });
    topo += ALT;
  }
  for (const a of alunos) {
    if (topo + ALT > BASE) topo = cab(novaPagina());
    let x = X0;
    const inativo = a.status !== 'ativa';
    for (const c of colunas) {
      caixa(ctx, x, topo, c.w, ALT, inativo ? { fundo: CINZA_LINHA } : {});
      if (c.nome) nomeAluno(ctx, a, x, topo, c.w, ALT);
      else celula(ctx, c.valor(a), x, topo, c.w, ALT, { alinhar: c.alinhar ?? 'c', size: 6.8 });
      x += c.w;
    }
    topo += ALT;
  }
  if (nota) {
    if (topo + 12 > BASE) topo = novaPagina();
    const f = caber(nota, ctx.r, 6.5, LARG);
    texto(ctx, f.t, X0, topo + 4, f.size, ctx.r);
  }
}

export async function gerarPdfControle(
  tipo: TipoControle, d: DadosControle, rec: RecursosControle, emissor: string, quando: string, criterios?: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${tipo === 'notas' ? 'Controle de Notas' : 'Controle de Faltas'} — ${d.turma.codigo}`);
  doc.setCreator('Sistema de Certificados IECT');
  doc.setProducer('Sistema de Certificados IECT');
  const ehPng = rec.logo[0] === 0x89 && rec.logo[1] === 0x50;
  const ctx: Ctx = {
    doc,
    r: await doc.embedFont(rec.fonteRegular, OPCOES_FONTE),
    b: await doc.embedFont(rec.fonteNegrito, OPCOES_FONTE),
    logo: ehPng ? await doc.embedPng(rec.logo) : await doc.embedJpg(rec.logo),
    pg: undefined as unknown as PDFPage,
  };

  for (const disc of d.disciplinas) {
    if (tipo === 'notas') {
      const nova = () => { ctx.pg = doc.addPage([W, H]); return cabecalho(ctx, tipo, d, disc, null); };
      const fixas = 48 + 24 + 66 + 48 * 3 + 40 + 44 + 44;
      const colunas: Coluna[] = [
        { rotulo: 'ID ALUNO', w: 48, valor: (a) => a.id, alinhar: 'd' },
        { rotulo: 'N.C.', w: 24, valor: (a) => String(a.nc) },
        { rotulo: 'NOME DO ALUNO', w: LARG - fixas, valor: () => '', nome: true },
        { rotulo: 'STATUS', w: 66, valor: (a) => (ROTULO_STATUS[a.status] ?? a.status).toUpperCase() },
        { rotulo: 'MÉDIA', w: 48, valor: (a) => num(a.nota) },
        { rotulo: 'EXAME FINAL', w: 48, valor: (a) => num(a.exame) },
        { rotulo: 'MÉDIA FINAL', w: 48, valor: (a) => num(a.mediaFinal) },
        { rotulo: 'FALTAS', w: 40, valor: (a) => (a.faltas == null ? '' : String(a.faltas)) },
        { rotulo: 'FREQ. (%)', w: 44, valor: (a) => num(a.frequencia) },
        { rotulo: 'RESULT.', w: 44, valor: (a) => a.resultado ?? '' },
      ];
      desenharTabela(ctx, nova, colunas, disc.alunos, 18,
        (c, x, t) => celula(ctx, c.rotulo, x, t, c.w, 18, { font: ctx.b, size: 6.8, alinhar: 'c' }),
        `AP = aprovado · RP = reprovado · em branco = sem lançamento.${criterios ? ` ${criterios}` : ''}`);
      continue;
    }
    // faltas: uma coluna por dia de aula; muitas datas → continua em outra página (parte 2, 3...)
    const wNc = 22, wNome = 210, wTot = 30;
    const livre = LARG - wNc - wNome - wTot;
    const maxCols = Math.floor(livre / 9.5);
    const partes: string[][] = [];
    for (let k = 0; k < Math.max(1, disc.datas.length); k += maxCols) partes.push(disc.datas.slice(k, k + maxCols));
    partes.forEach((datas, ip) => {
      const parte = partes.length > 1 ? `Parte ${ip + 1} de ${partes.length}` : null;
      const nova = () => { ctx.pg = doc.addPage([W, H]); return cabecalho(ctx, tipo, d, disc, parte); };
      const wd = datas.length ? Math.min(16, livre / datas.length) : 0;
      const colunas: Coluna[] = [
        { rotulo: 'N.C.', w: wNc, valor: (a) => String(a.nc) },
        { rotulo: 'NOME DO ALUNO', w: wNome + (datas.length ? livre - wd * datas.length : livre), valor: () => '', nome: true },
        ...datas.map((dt): Coluna => ({ rotulo: dt, w: wd, valor: (a) => (a.faltasPorDia[dt] ? String(a.faltasPorDia[dt]) : '') })),
        { rotulo: 'TOT.', w: wTot, valor: (a) => String(a.faltas ?? Object.values(a.faltasPorDia).reduce((s, n) => s + n, 0)) },
      ];
      const nota = !disc.datas.length
        ? 'Sem aulas registradas na chamada nem previstas no horário até hoje: o total vem do lançamento de faltas da disciplina.'
        : !disc.comChamada ? 'Chamada ainda não registrada: os dias são as aulas previstas no horário; o total vem do lançamento de faltas da disciplina.'
          : 'Cada número é a quantidade de aulas em que o aluno faltou no dia. TOT. = total de aulas faltadas na disciplina.';
      desenharTabela(ctx, nova, colunas, disc.alunos, 30, (c, x, t) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(c.rotulo)) {
          const r = `${c.rotulo.slice(8, 10)}/${c.rotulo.slice(5, 7)}`;
          ctx.pg.drawText(r, { x: x + c.w / 2 + 2.2, y: H - t - 30 + 3, size: 6, font: ctx.r, color: PRETO, rotate: degrees(90) });
        } else celula(ctx, c.rotulo, x, t, c.w, 30, { font: ctx.b, size: 7, alinhar: 'c' });
      }, nota);
    });
  }

  // linha de emissão e numeração em todas as páginas
  const paginas = doc.getPages();
  paginas.forEach((pg, i) => {
    ctx.pg = pg;
    texto(ctx, `Emitido por: ${emissor.toUpperCase()}`, X0, 10, 6.2, ctx.r);
    const pag = `Página: ${String(i + 1).padStart(6, '0')} de ${String(paginas.length).padStart(5, '0')}`;
    const em = `Emissão: ${quando}`;
    texto(ctx, pag, X0 + LARG - ctx.r.widthOfTextAtSize(pag, 7), 10, 7, ctx.r);
    texto(ctx, em, X0 + LARG - ctx.r.widthOfTextAtSize(pag, 7) - 40 - ctx.r.widthOfTextAtSize(em, 7), 10, 7, ctx.r);
  });
  return doc.save();
}
