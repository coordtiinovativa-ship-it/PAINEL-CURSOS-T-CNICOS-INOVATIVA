/**
 * Renderizador PDF do motor de documentos (A4 retrato). Coordenadas "a partir do topo", em pt.
 * Blocos que não cabem vão para a próxima página (com cabeçalho repetido); tabelas quebram por linha.
 */
import { degrees, PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import qrcode from 'qrcode-generator';
import { A4, CORES, type Bloco, type DocumentoLayout } from './tipos';

export interface RecursosDocumento {
  fonteRegular: Uint8Array;
  fonteNegrito: Uint8Array;
  logo: Uint8Array;
  /** imagens de assinatura por chave do R2 */
  assinaturas: Record<string, Uint8Array>;
}

const MM = 72 / 25.4;
const W = A4.largura * MM;
const H = A4.altura * MM;
const X0 = A4.margem.lado * MM;
const LARG = W - 2 * X0;
const LIMITE = H - A4.margem.base * MM; // fim da área útil (acima do rodapé)
const LH = 1.22;
const cor = (c: readonly number[]): RGB => rgb(c[0] / 255, c[1] / 255, c[2] / 255);
const PRETO = rgb(0.07, 0.11, 0.19);
const MARINHO = cor(CORES.marinho);
const CINZA = cor(CORES.cinza);
const BORDA = cor(CORES.borda);
// Sem ligaduras e sem recorte de fonte (o pdf-lib perde glifos ao recortar). Fonte Arimo = métrica da Arial do modelo.
const OPCOES_FONTE = { subset: false, features: { liga: false, clig: false, dlig: false, calt: false, rlig: false } };

interface Ctx {
  doc: PDFDocument;
  r: PDFFont;
  b: PDFFont;
  logo: PDFImage;
  ass: Record<string, PDFImage>;
  layout: DocumentoLayout;
  previa: boolean;
  marca?: string;
  qrExemplo?: string;
  pagina: PDFPage;
  y: number;
}

export function quebrarTexto(t: string, font: PDFFont, size: number, largura: number, recuo = 0): string[] {
  const linhas: string[] = [];
  for (const paragrafo of t.split('\n')) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);
    let atual = '';
    for (const p of palavras) {
      const tentativa = atual ? `${atual} ${p}` : p;
      const disp = largura - (linhas.length === 0 ? recuo : 0); // recuo só na 1ª linha do texto
      if (atual && font.widthOfTextAtSize(tentativa, size) > disp) {
        linhas.push(atual);
        atual = p;
      } else atual = tentativa;
    }
    linhas.push(atual);
  }
  return linhas;
}

function texto(ctx: Ctx, t: string, x: number, topo: number, size: number, font: PDFFont, c: RGB = PRETO, lh = size * LH) {
  ctx.pagina.drawText(t, { x, y: H - (topo + (lh - size) / 2 + size * 0.78), size, font, color: c });
}
function centro(ctx: Ctx, t: string, topo: number, size: number, font: PDFFont, c: RGB = PRETO, x0 = X0, larg = LARG) {
  texto(ctx, t, x0 + (larg - font.widthOfTextAtSize(t, size)) / 2, topo, size, font, c);
}
function retangulo(ctx: Ctx, x: number, topo: number, w: number, h: number, opc: { fundo?: RGB; borda?: RGB; esp?: number }) {
  ctx.pagina.drawRectangle({ x, y: H - topo - h, width: w, height: h, color: opc.fundo, borderColor: opc.borda, borderWidth: opc.borda ? (opc.esp ?? 0.5) : 0 });
}
function linha(ctx: Ctx, x1: number, t1: number, x2: number, t2: number, c: RGB = BORDA, esp = 0.5) {
  ctx.pagina.drawLine({ start: { x: x1, y: H - t1 }, end: { x: x2, y: H - t2 }, thickness: esp, color: c });
}
function imagem(ctx: Ctx, img: PDFImage, x: number, topo: number, w: number, h: number) {
  const e = Math.min(w / img.width, h / img.height);
  const iw = img.width * e;
  const ih = img.height * e;
  ctx.pagina.drawImage(img, { x: x + (w - iw) / 2, y: H - (topo + (h - ih) / 2) - ih, width: iw, height: ih });
}

/** Linha justificada (distribui o espaço entre as palavras). */
function linhaJustificada(ctx: Ctx, t: string, x: number, topo: number, size: number, font: PDFFont, largura: number, lh: number) {
  const palavras = t.split(' ');
  if (palavras.length < 2) return texto(ctx, t, x, topo, size, font, PRETO, lh);
  const ws = palavras.map((p) => font.widthOfTextAtSize(p, size));
  const gap = (largura - ws.reduce((a, b) => a + b, 0)) / (palavras.length - 1);
  let cx = x;
  palavras.forEach((p, i) => {
    texto(ctx, p, cx, topo, size, font, PRETO, lh);
    cx += ws[i] + gap;
  });
}

/** Tamanho de fonte para a linha caber na largura (nunca maior que o padrão; linhas do cabeçalho não quebram). */
export function tamanhoQueCabe(t: string, font: PDFFont, padrao: number, largura: number): number {
  const w = font.widthOfTextAtSize(t, padrao);
  return w <= largura ? padrao : Math.floor((padrao * largura) / w * 10) / 10;
}

/** Junta linhas curtas seguidas ("a · b") enquanto couberem na largura; nenhuma linha é cortada. */
export function agruparLinhas(linhas: string[], font: PDFFont, size: number, largura: number): string[] {
  const out: string[] = [];
  for (const l of linhas) {
    const junto = out.length ? `${out.at(-1)}  ·  ${l}` : '';
    if (junto && font.widthOfTextAtSize(junto, size) <= largura) out[out.length - 1] = junto;
    else out.push(l);
  }
  return out;
}

// ------------------------------- página -------------------------------
function novaPagina(ctx: Ctx) {
  ctx.pagina = ctx.doc.addPage([W, H]);
  const inst = ctx.layout.instituicao;
  const atos = agruparLinhas(inst.atos ?? [], ctx.r, 7, LARG);
  // Com as linhas de atos (que já trazem o credenciamento), o cabeçalho fica compacto: logo menor, sem a linha
  // "Credenciamento ..." repetida e atos em 7 pt — o histórico precisa caber em anverso e verso.
  const altLogo = (atos.length ? 10.5 : 13) * MM;
  let y = A4.margem.topo * MM;
  imagem(ctx, ctx.logo, X0 + (LARG - 50 * MM) / 2, y, 50 * MM, altLogo);
  y += altLogo + 2.5;
  centro(ctx, inst.nome, y, 10, ctx.b, MARINHO);
  y += 10 * LH + 1;
  for (const t of atos.length ? [inst.enderecoLinha] : [inst.enderecoLinha, inst.credenciamento]) {
    centro(ctx, t, y, tamanhoQueCabe(t, ctx.r, 8, LARG), ctx.r, CINZA);
    y += 8 * LH;
  }
  for (const t of atos) {
    centro(ctx, t, y, tamanhoQueCabe(t, ctx.r, 7, LARG), ctx.r, CINZA);
    y += 7 * 1.12;
  }
  y += atos.length ? 2.5 : 4;
  // faixa com as cores da marca
  const seg = LARG / CORES.faixa.length;
  CORES.faixa.forEach((c, i) => retangulo(ctx, X0 + i * seg, y, seg + 0.3, 2.2, { fundo: cor(c) }));
  ctx.y = y + 2.2 + 12;
  rodape(ctx);
}

function rodape(ctx: Ctx) {
  const v = ctx.layout.validacao;
  const topo = H - A4.rodape * MM + 2 * MM;
  linha(ctx, X0, topo - 3, X0 + LARG, topo - 3);
  if (ctx.layout.rodape) {
    ctx.layout.rodape.forEach((l, i) => texto(ctx, l, X0, topo + 2 + i * 9.5, 7.5, i === 0 ? ctx.b : ctx.r, CINZA));
    return;
  }
  const lado = 16 * MM;
  const xq = X0 + LARG - lado;
  if (v.url) desenharQr(ctx, v.url, xq, topo, lado);
  else if (ctx.qrExemplo) desenharQr(ctx, ctx.qrExemplo, xq, topo, lado);
  else retangulo(ctx, xq, topo, lado, lado, { borda: BORDA });
  const linhas = v.codigo
    ? [`Documento registrado sob o código ${v.codigo}.`, `Confira a autenticidade em ${v.url!.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}`, 'ou pelo QR code ao lado.']
    : ctx.qrExemplo
      ? ['PRÉVIA — o código de validação (INV-AAAA-NNNNN) e o QR code definitivo são gerados na emissão.', 'QR code de exemplo ao lado: no documento emitido, ele leva à página de validação.']
      : ['PRÉVIA — o código de validação e o QR code são gerados na emissão.'];
  linhas.forEach((l, i) => texto(ctx, l, X0, topo + 2 + i * 9.5, 7.5, i === 0 ? ctx.b : ctx.r, CINZA));
  if (ctx.previa || ctx.marca) {
    const t = ctx.previa ? 'PRÉVIA — SEM VALIDADE' : ctx.marca!;
    const size = Math.min(54, (W * 0.85) / ctx.b.widthOfTextAtSize(t, 1));
    const w = ctx.b.widthOfTextAtSize(t, size);
    const a = (40 * Math.PI) / 180;
    ctx.pagina.drawText(t, { x: W / 2 - (w / 2) * Math.cos(a), y: H / 2 - (w / 2) * Math.sin(a), size, font: ctx.b, color: rgb(0.85, 0.2, 0.2), opacity: 0.16, rotate: degrees(40) });
  }
}

function desenharQr(ctx: Ctx, conteudo: string, x: number, topo: number, lado: number) {
  const qr = qrcode(0, 'M');
  qr.addData(conteudo);
  qr.make();
  const n = qr.getModuleCount();
  const cel = lado / (n + 4);
  retangulo(ctx, x, topo, lado, lado, { fundo: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      const ini = c;
      while (c < n && qr.isDark(r, c)) c++;
      ctx.pagina.drawRectangle({ x: x + (2 + ini) * cel, y: H - topo - (2 + r + 1) * cel, width: (c - ini) * cel, height: cel, color: rgb(0, 0, 0) });
    }
  }
}

// ------------------------------- blocos -------------------------------
/** Desenha (ou só mede, se desenhar=false) um bloco a partir de ctx.y. Retorna a altura. */
function bloco(ctx: Ctx, bl: Exclude<Bloco, { tipo: 'tabela' }>, desenhar: boolean): number {
  const y = ctx.y;
  switch (bl.tipo) {
    case 'espaco':
      return bl.altura;
    case 'titulo': {
      if (desenhar) centro(ctx, bl.texto, y, 15, ctx.b, MARINHO);
      let h = 15 * LH + 2;
      if (bl.subtitulo) {
        const ls = quebrarTexto(bl.subtitulo, ctx.r, 10, LARG);
        if (desenhar) ls.forEach((l, i) => centro(ctx, l, y + h + i * 10 * LH, 10, ctx.r, CINZA));
        h += ls.length * 10 * LH;
      }
      return h + 6;
    }
    case 'secao': {
      if (desenhar) {
        retangulo(ctx, X0, y, LARG, 14, { fundo: MARINHO });
        texto(ctx, bl.texto.toUpperCase(), X0 + 6, y + 1, 8.5, ctx.b, rgb(1, 1, 1), 12);
      }
      return 14 + 4;
    }
    case 'paragrafo': {
      const size = bl.tamanho ?? 10.5;
      const lh = size * (bl.entrelinha ?? 1.5);
      const font = bl.negrito ? ctx.b : ctx.r;
      const recuo = bl.recuo ? 15 * MM : 0;
      const ls = quebrarTexto(bl.texto, font, size, LARG, recuo);
      if (desenhar) {
        ls.forEach((l, i) => {
          const x = X0 + (i === 0 ? recuo : 0);
          const larg = LARG - (i === 0 ? recuo : 0);
          const top = y + i * lh;
          const al = bl.alinhar ?? 'justificado';
          if (al === 'justificado' && i < ls.length - 1) linhaJustificada(ctx, l, x, top, size, font, larg, lh);
          else if (al === 'centro') centro(ctx, l, top, size, font);
          else if (al === 'direita') texto(ctx, l, X0 + LARG - font.widthOfTextAtSize(l, size), top, size, font, PRETO, lh);
          else texto(ctx, l, x, top, size, font, PRETO, lh);
        });
      }
      return ls.length * lh + 6;
    }
    case 'nota': {
      const ls = quebrarTexto(bl.texto, ctx.r, 8, LARG);
      if (desenhar) ls.forEach((l, i) => texto(ctx, l, X0, y + i * 8 * 1.35, 8, ctx.r, CINZA, 8 * 1.35));
      return ls.length * 8 * 1.35 + 6;
    }
    case 'lista': {
      let h = 0;
      for (const it of bl.itens) {
        const ls = quebrarTexto(it, ctx.r, 9.5, LARG - 12);
        if (desenhar) {
          ctx.pagina.drawCircle({ x: X0 + 4, y: H - (y + h + 9.5 * 0.72), size: 1.4, color: MARINHO });
          ls.forEach((l, i) => texto(ctx, l, X0 + 12, y + h + i * 9.5 * 1.4, 9.5, ctx.r, PRETO, 9.5 * 1.4));
        }
        h += ls.length * 9.5 * 1.4 + 3;
      }
      return h + 5;
    }
    case 'campos': {
      const colW = LARG / 4;
      let h = 0;
      let linhaAtual: typeof bl.itens = [];
      const linhas: (typeof bl.itens)[] = [];
      let ocupadas = 0;
      for (const it of bl.itens) {
        const span = it.span ?? 1;
        if (ocupadas + span > 4) { linhas.push(linhaAtual); linhaAtual = []; ocupadas = 0; }
        linhaAtual.push(it);
        ocupadas += span;
      }
      if (linhaAtual.length) linhas.push(linhaAtual);
      for (const ln of linhas) {
        let x = X0;
        const alturas = ln.map((it) => quebrarTexto(it.valor ?? '—', ctx.r, 9.5, (it.span ?? 1) * colW - 8).length);
        const hLinha = 7 * LH + 2 + Math.max(...alturas) * 9.5 * 1.25 + 3.5;
        if (desenhar) {
          ln.forEach((it, i) => {
            const w = (it.span ?? 1) * colW;
            retangulo(ctx, x, y + h, w, hLinha, { borda: BORDA });
            texto(ctx, it.rotulo.toUpperCase(), x + 4, y + h + 2, 6.8, ctx.b, CINZA);
            quebrarTexto(it.valor ?? '—', ctx.r, 9.5, w - 8).forEach((l, k) =>
              texto(ctx, l, x + 4, y + h + 2 + 7 * LH + 0.5 + k * 9.5 * 1.25, 9.5, ctx.r, it.valor ? PRETO : CINZA, 9.5 * 1.25),
            );
            x += w;
            void alturas[i];
          });
        }
        h += hLinha;
      }
      return h + 6;
    }
    case 'assinaturas': {
      const n = bl.itens.length;
      const colW = LARG / n;
      const altImg = 12 * MM;
      const top = y + 6;
      if (desenhar) {
        bl.itens.forEach((it, i) => {
          const cx = X0 + i * colW;
          const img = it.assinatura_r2_key ? ctx.ass[it.assinatura_r2_key] : undefined;
          if (img) imagem(ctx, img, cx + 10, top, colW - 20, altImg);
          const lw = Math.min(colW - 24, 70 * MM);
          linha(ctx, cx + (colW - lw) / 2, top + altImg + 2, cx + (colW + lw) / 2, top + altImg + 2, PRETO, 0.7);
          let ty = top + altImg + 5;
          if (it.nome) { centro(ctx, it.nome, ty, 9, ctx.b, PRETO, cx, colW); ty += 9 * LH; }
          centro(ctx, it.legenda, ty, 8.5, ctx.r, CINZA, cx, colW);
          if (it.detalhe) centro(ctx, it.detalhe, ty + 8.5 * LH, 7.5, ctx.r, CINZA, cx, colW);
        });
      }
      return 6 + altImg + 5 + 9 * LH + 8.5 * LH + (bl.itens.some((i) => i.detalhe) ? 7.5 * LH : 0) + 6;
    }
  }
}

function tabela(ctx: Ctx, bl: Extract<Bloco, { tipo: 'tabela' }>) {
  const soma = bl.colunas.reduce((a, c) => a + c.largura, 0);
  const larguras = bl.colunas.map((c) => (c.largura / soma) * LARG);
  const pad = 4;
  const alturaLinha = (cels: string[], font: PDFFont, size: number) =>
    Math.max(...cels.map((t, i) => quebrarTexto(t, font, size, larguras[i] - 2 * pad).length)) * size * 1.25 + 5;

  const desenharLinha = (cels: string[], font: PDFFont, size: number, fundo?: RGB) => {
    const h = alturaLinha(cels, font, size);
    let x = X0;
    cels.forEach((t, i) => {
      retangulo(ctx, x, ctx.y, larguras[i], h, { fundo, borda: BORDA });
      const al = bl.colunas[i].alinhar ?? 'esquerda';
      quebrarTexto(t, font, size, larguras[i] - 2 * pad).forEach((l, k) => {
        const w = font.widthOfTextAtSize(l, size);
        const tx = al === 'centro' ? x + (larguras[i] - w) / 2 : al === 'direita' ? x + larguras[i] - pad - w : x + pad;
        texto(ctx, l, tx, ctx.y + 2.5 + k * size * 1.25, size, font, PRETO, size * 1.25);
      });
      x += larguras[i];
    });
    ctx.y += h;
  };
  const titulos = bl.colunas.map((c) => c.titulo);
  const cabecalho = () => desenharLinha(titulos, ctx.b, 8.2, cor(CORES.cabecalhoTabela));

  if (ctx.y + alturaLinha(titulos, ctx.b, 8.2) + alturaLinha(bl.linhas[0] ?? titulos, ctx.r, 9) > LIMITE) novaPagina(ctx);
  cabecalho();
  bl.linhas.forEach((ln, i) => {
    if (ctx.y + alturaLinha(ln, ctx.r, 9) > LIMITE) { novaPagina(ctx); cabecalho(); }
    desenharLinha(ln, ctx.r, 9, i % 2 ? cor(CORES.zebra) : undefined);
  });
  if (bl.total) {
    if (ctx.y + alturaLinha(bl.total, ctx.b, 9) > LIMITE) { novaPagina(ctx); cabecalho(); }
    desenharLinha(bl.total, ctx.b, 9, cor(CORES.cabecalhoTabela));
  }
  ctx.y += 8;
}

const ehPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50;

export async function gerarPdfDocumento(layout: DocumentoLayout, rec: RecursosDocumento, opcoes: { previa?: boolean; qrExemplo?: string; marca?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(layout.titulo);
  doc.setAuthor(layout.instituicao.nome);
  doc.setCreator('Sistema de Certificados IECT');
  doc.setProducer('Sistema de Certificados IECT');
  if (layout.validacao.codigo) doc.setKeywords([layout.validacao.codigo]);
  const emb = (b: Uint8Array) => (ehPng(b) ? doc.embedPng(b) : doc.embedJpg(b));
  const ass: Record<string, PDFImage> = {};
  for (const [k, v] of Object.entries(rec.assinaturas)) ass[k] = await emb(v);
  const ctx: Ctx = {
    doc, layout, ass, previa: !!opcoes.previa, marca: opcoes.marca, qrExemplo: opcoes.qrExemplo,
    r: await doc.embedFont(rec.fonteRegular, OPCOES_FONTE),
    b: await doc.embedFont(rec.fonteNegrito, OPCOES_FONTE),
    logo: await emb(rec.logo),
    pagina: undefined as unknown as PDFPage,
    y: 0,
  };
  for (const pg of layout.paginas) {
    novaPagina(ctx);
    for (const bl of pg.blocos) {
      if (bl.tipo === 'tabela') { tabela(ctx, bl); continue; }
      const h = bloco(ctx, bl, false);
      if (ctx.y + h > LIMITE && bl.tipo !== 'espaco') novaPagina(ctx);
      bloco(ctx, bl, true);
      ctx.y += h;
    }
  }
  if (layout.rodape) {
    // numeração "Página X de Y" no rodapé dos relatórios
    const paginas = doc.getPages();
    paginas.forEach((pg, i) => {
      const t = `Página ${i + 1} de ${paginas.length}`;
      pg.drawText(t, { x: X0 + LARG - ctx.r.widthOfTextAtSize(t, 7.5), y: H - (H - A4.rodape * MM + 2 * MM + 2 + 7.5 * 0.9), size: 7.5, font: ctx.r, color: CINZA });
    });
  }
  return doc.save();
}
