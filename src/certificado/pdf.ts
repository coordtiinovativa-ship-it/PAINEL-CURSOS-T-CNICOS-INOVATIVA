/**
 * PDF do certificado (A4 paisagem, frente + verso) com pdf-lib, a partir do snapshot.
 * Mesmo layout e medidas da prévia em tela (src/certificado/previa.tsx), extraídos do
 * modelo aprovado no PPC. Fonte Arimo (métrica idêntica à Arial do modelo; a Arial não pode ser embutida).
 */
import { degrees, PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import qrcode from 'qrcode-generator';
import type { SnapshotCertificado } from './snapshot';
import { espacosCabecalho, linhasCabecalho } from './dados';
import { tamanhoQueCabe } from '../documentos/pdf';
import { dataExtenso } from '../lib/datas';

export interface RecursosPdf {
  fonteRegular: Uint8Array;
  fonteNegrito: Uint8Array;
  logo: Uint8Array;
  fundoFrente: Uint8Array;
  fundoVerso: Uint8Array;
  assinaturas: Partial<Record<'diretor_pedagogico' | 'secretario', Uint8Array>>;
}

const MM = 72 / 25.4;
const W = 297 * MM;
const H = 210 * MM;
const MARGEM = { topo: 11.43 * MM, dir: 24.13 * MM, base: 13.97 * MM, esq: 24.13 * MM };
const LARG = W - MARGEM.esq - MARGEM.dir;
const PRETO = rgb(0, 0, 0);
const CINZA = rgb(0.33, 0.33, 0.33);
const LH_NORMAL = 1.15; // altura de linha "normal" da Arial/Arimo
// Sem ligaduras (fi, ti...): o pdf-lib calcula errado a largura delas e "come" espaços.
// subset: false — o recorte de fonte do pdf-lib/fontkit perde glifos.
const OPCOES_FONTE = { subset: false, features: { liga: false, clig: false, dlig: false, calt: false, rlig: false } };

interface Fontes { r: PDFFont; b: PDFFont }

function ehPng(b: Uint8Array) {
  return b[0] === 0x89 && b[1] === 0x50;
}
async function embutirImagem(doc: PDFDocument, b: Uint8Array): Promise<PDFImage> {
  return ehPng(b) ? doc.embedPng(b) : doc.embedJpg(b);
}

/** Página com coordenadas "a partir do topo", como no HTML. */
class Folha {
  constructor(public p: PDFPage, public f: Fontes) {}

  /** Desenha texto com a linha de base calculada a partir do topo da caixa da linha. */
  texto(t: string, x: number, topo: number, size: number, font: PDFFont, lh = size * LH_NORMAL, cor = PRETO) {
    const base = topo + (lh - size) / 2 + size * 0.78;
    this.p.drawText(t, { x, y: H - base, size, font, color: cor });
  }

  centro(t: string, topo: number, size: number, font: PDFFont, x0 = MARGEM.esq, largura = LARG, lh?: number) {
    const w = font.widthOfTextAtSize(t, size);
    this.texto(t, x0 + (largura - w) / 2, topo, size, font, lh);
  }

  /** Quebra em linhas e centraliza; retorna a altura usada. */
  centroQuebrado(t: string, topo: number, size: number, font: PDFFont, x0 = MARGEM.esq, largura = LARG, lh = size * LH_NORMAL) {
    const linhas = quebrar(t, font, size, largura);
    linhas.forEach((l, i) => this.centro(l.join(' '), topo + i * lh, size, font, x0, largura, lh));
    return linhas.length * lh;
  }

  linha(x1: number, topo1: number, x2: number, topo2: number, esp = 0.75) {
    this.p.drawLine({ start: { x: x1, y: H - topo1 }, end: { x: x2, y: H - topo2 }, thickness: esp, color: PRETO });
  }

  /** Imagem ajustada (contain) dentro da caixa, alinhada embaixo e ao centro. */
  imagem(img: PDFImage, x: number, topo: number, largura: number, altura: number, alinhar: 'centro' | 'base' = 'centro') {
    const esc = Math.min(largura / img.width, altura / img.height);
    const w = img.width * esc;
    const h = img.height * esc;
    const dy = alinhar === 'base' ? altura - h : (altura - h) / 2;
    this.p.drawImage(img, { x: x + (largura - w) / 2, y: H - (topo + dy + h), width: w, height: h });
  }
}

/** Quebra o texto em linhas (listas de palavras) para a largura dada. */
export function quebrar(t: string, font: PDFFont, size: number, largura: number, recuo = 0): string[][] {
  const palavras = t.split(/\s+/).filter(Boolean);
  const esp = font.widthOfTextAtSize(' ', size);
  const linhas: string[][] = [];
  let atual: string[] = [];
  let w = 0;
  for (const p of palavras) {
    const wp = font.widthOfTextAtSize(p, size);
    const disponivel = largura - (linhas.length === 0 ? recuo : 0);
    if (atual.length && w + esp + wp > disponivel) {
      linhas.push(atual);
      atual = [p];
      w = wp;
    } else {
      w += (atual.length ? esp : 0) + wp;
      atual.push(p);
    }
  }
  if (atual.length) linhas.push(atual);
  return linhas;
}

/** Parágrafo justificado com recuo na primeira linha. Retorna a altura usada. */
function justificado(fo: Folha, t: string, topo: number, size: number, font: PDFFont, lh: number, recuo: number) {
  const linhas = quebrar(t, font, size, LARG, recuo);
  linhas.forEach((palavras, i) => {
    const x0 = MARGEM.esq + (i === 0 ? recuo : 0);
    const disponivel = LARG - (i === 0 ? recuo : 0);
    const larguras = palavras.map((p) => font.widthOfTextAtSize(p, size));
    const soma = larguras.reduce((a, b) => a + b, 0);
    const ultima = i === linhas.length - 1;
    const gap = !ultima && palavras.length > 1 ? (disponivel - soma) / (palavras.length - 1) : font.widthOfTextAtSize(' ', size);
    let x = x0;
    palavras.forEach((p, j) => {
      fo.texto(p, x, topo + i * lh, size, font, lh);
      x += larguras[j] + gap;
    });
  });
  return linhas.length * lh;
}

/** Parágrafo justificado com trechos em negrito/normal (texto rico), recuo na 1ª linha. Retorna a altura. */
function justificadoRico(fo: Folha, trechos: { t: string; b: boolean }[], topo: number, size: number, lh: number, recuo: number) {
  // palavras = sequência de pedaços (texto, negrito) sem espaço entre eles
  type Palavra = { pedacos: { t: string; font: PDFFont }[]; w: number };
  const palavras: Palavra[] = [];
  let atual: Palavra | null = null;
  for (const tr of trechos) {
    const font = tr.b ? fo.f.b : fo.f.r;
    const partes = tr.t.split(/(\s+)/);
    for (const parte of partes) {
      if (!parte) continue;
      if (/^\s+$/.test(parte)) { atual = null; continue; }
      if (!atual) { atual = { pedacos: [], w: 0 }; palavras.push(atual); }
      atual.pedacos.push({ t: parte, font });
      atual.w += font.widthOfTextAtSize(parte, size);
    }
  }
  const esp = fo.f.r.widthOfTextAtSize(' ', size);
  const linhas: Palavra[][] = [];
  let linha: Palavra[] = [];
  let w = 0;
  for (const pal of palavras) {
    const disp = LARG - (linhas.length === 0 ? recuo : 0);
    if (linha.length && w + esp + pal.w > disp) { linhas.push(linha); linha = [pal]; w = pal.w; }
    else { w += (linha.length ? esp : 0) + pal.w; linha.push(pal); }
  }
  if (linha.length) linhas.push(linha);
  linhas.forEach((ls, i) => {
    const x0 = MARGEM.esq + (i === 0 ? recuo : 0);
    const disponivel = LARG - (i === 0 ? recuo : 0);
    const soma = ls.reduce((a, p) => a + p.w, 0);
    const gap = i < linhas.length - 1 && ls.length > 1 ? (disponivel - soma) / (ls.length - 1) : esp;
    let x = x0;
    for (const pal of ls) {
      let px = x;
      for (const pd of pal.pedacos) { fo.texto(pd.t, px, topo + i * lh, size, pd.font, lh); px += pd.font.widthOfTextAtSize(pd.t, size); }
      x += pal.w + gap;
    }
  });
  return linhas.length * lh;
}

type Parte = { t: string; b?: boolean } | { v: string | number | null | undefined; min: number };

/** Linha com rótulos e valores; valor vazio vira traço sublinhado (como no modelo). */
function linhaCampos(fo: Folha, partes: Parte[], x: number, topo: number, size: number, lh = size * LH_NORMAL) {
  let cx = x;
  const base = topo + (lh - size) / 2 + size * 0.78;
  for (const p of partes) {
    if ('t' in p) {
      const font = p.b ? fo.f.b : fo.f.r;
      fo.texto(p.t, cx, topo, size, font, lh);
      cx += font.widthOfTextAtSize(p.t, size);
    } else if (p.v == null || String(p.v).trim() === '') {
      fo.linha(cx, base + 1.5, cx + p.min, base + 1.5, 0.6);
      cx += p.min;
    } else {
      const s = String(p.v);
      fo.texto(s, cx, topo, size, fo.f.r, lh);
      cx += fo.f.r.widthOfTextAtSize(s, size);
    }
  }
  return cx;
}

function desenharQr(fo: Folha, texto: string, x: number, topo: number, lado: number) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const margem = 2; // zona de silêncio (módulos)
  const cel = lado / (n + margem * 2);
  fo.p.drawRectangle({ x, y: H - topo - lado, width: lado, height: lado, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      const ini = c;
      while (c < n && qr.isDark(r, c)) c++;
      fo.p.drawRectangle({
        x: x + (margem + ini) * cel,
        y: H - topo - (margem + r + 1) * cel,
        width: (c - ini) * cel,
        height: cel,
        color: PRETO,
      });
    }
  }
}

/** Linhas abaixo do endereço (certificados emitidos antes da migração 0013 continuam como foram emitidos). */
const linhasAtos = (s: SnapshotCertificado) => linhasCabecalho(s.instituicao.credenciamento, s.instituicao.atos);

function cabecalho(fo: Folha, s: SnapshotCertificado, logo: PDFImage): number {
  let y = MARGEM.topo;
  fo.imagem(logo, MARGEM.esq + (LARG - 59.7 * MM) / 2, y, 59.7 * MM, 15.6 * MM);
  y += 15.6 * MM + 1.4 * MM;
  fo.centro(s.instituicao.nome, y, 10.5, fo.f.b);
  y += 10.5 * LH_NORMAL + 1;
  for (const t of [s.instituicao.enderecoLinha, ...linhasAtos(s)]) {
    fo.centro(t, y, tamanhoQueCabe(t, fo.f.r, 9, LARG), fo.f.r);
    y += 9 * LH_NORMAL + 1;
  }
  return y;
}

function marcaPrevia(fo: Folha, t: string) {
  const size = Math.min(64, (W * 0.8) / fo.f.b.widthOfTextAtSize(t, 1));
  const w = fo.f.b.widthOfTextAtSize(t, size);
  const ang = 25 * (Math.PI / 180);
  fo.p.drawText(t, {
    x: W / 2 - (w / 2) * Math.cos(ang),
    y: H / 2 - (w / 2) * Math.sin(ang),
    size,
    font: fo.f.b,
    color: rgb(0.85, 0.2, 0.2),
    opacity: 0.18,
    rotate: degrees(25),
  });
}

const localData = (local: string, iso: string | null) => (iso ? `${local}, ${dataExtenso(iso)}` : null);

export async function gerarPdfCertificado(
  s: SnapshotCertificado,
  rec: RecursosPdf,
  /** marca: texto em marca d'água no documento emitido (ex.: ambiente de teste) */
  opcoes: { previa?: boolean; qrExemplo?: string; marca?: string } = {},
): Promise<Uint8Array> {
  const marca = opcoes.previa ? 'PRÉVIA — SEM VALIDADE' : opcoes.marca;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Certificado ${s.validacao.codigo ?? '(prévia)'} — ${s.aluno.nome}`);
  doc.setAuthor(s.instituicao.nome);
  const rotulo = s.curso.rotuloQualificacao ?? 'Qualificação Profissional Técnica';
  doc.setSubject(`${rotulo} ${s.modulo.qualificacao}`);
  doc.setCreator('Sistema de Certificados IECT');
  doc.setProducer('Sistema de Certificados IECT');
  if (s.validacao.codigo) doc.setKeywords([s.validacao.codigo]);

  const f: Fontes = {
    r: await doc.embedFont(rec.fonteRegular, OPCOES_FONTE),
    b: await doc.embedFont(rec.fonteNegrito, OPCOES_FONTE),
  };
  const fundoFrente = await embutirImagem(doc, rec.fundoFrente);
  const fundoVerso = rec.fundoVerso === rec.fundoFrente ? fundoFrente : await embutirImagem(doc, rec.fundoVerso);
  const logo = await embutirImagem(doc, rec.logo);
  const ass: Partial<Record<string, PDFImage>> = {};
  for (const [k, v] of Object.entries(rec.assinaturas)) if (v) ass[k] = await embutirImagem(doc, v);

  // ============================== FRENTE ==============================
  {
    const fo = new Folha(doc.addPage([W, H]), f);
    fo.p.drawImage(fundoFrente, { x: 0, y: 0, width: W, height: H });
    let y = cabecalho(fo, s, logo);
    const esp = espacosCabecalho(linhasAtos(s).length);
    y += esp.antesTitulo;
    fo.centro('C  E  R  T  I  F  I  C  A  D  O', y, 21, f.b);
    y += 21 * LH_NORMAL + esp.depoisTitulo;
    // certificados antigos (sem texto rico) saíam com o texto inteiro em negrito
    y += justificadoRico(fo, s.textoFrenteRico ?? [{ t: s.textoFrente, b: true }], y, 11, 11 * 1.55, 19.05 * MM);
    y += 14 + 4;
    const ld = `${localData(s.local, s.dataEmissao)}.`;
    fo.texto(ld, MARGEM.esq + LARG - f.r.widthOfTextAtSize(ld, 11), y, 11, f.r);
    y += 11 * LH_NORMAL + 18;

    const col = LARG / 3;
    const altImg = 15 * MM;
    const larLinha = 62 * MM;
    const sigDe = (funcao: string) => s.signatarios.find((x) => x.funcao === funcao);
    const colunas: [string[], PDFImage | undefined, ReturnType<typeof sigDe>][] = [
      [['Assinatura da Diretora', 'Pedagógica'], ass.diretor_pedagogico, sigDe('diretor_pedagogico')],
      [['Assinatura Titular'], undefined, undefined],
      [['Assinatura do Secretário(a)'], ass.secretario, sigDe('secretario')],
    ];
    colunas.forEach(([legenda, img, sig], i) => {
      const cx = MARGEM.esq + i * col;
      if (img) fo.imagem(img, cx + (col - 55 * MM) / 2, y, 55 * MM, altImg, 'base');
      const topoLinha = y + altImg + 1 * MM;
      fo.linha(cx + (col - larLinha) / 2, topoLinha, cx + (col + larLinha) / 2, topoLinha);
      legenda.forEach((l, k) => fo.centro(l, topoLinha + 1 * MM + k * 10.5 * 1.15, 10.5, f.r, cx, col, 10.5 * 1.15));
      // nome e portaria de nomeação do signatário
      if (sig) {
        const base = topoLinha + 1 * MM + legenda.length * 10.5 * 1.15 + 1;
        fo.centro(sig.nome, base, 8, f.b, cx, col, 8 * 1.2);
        if (sig.portaria) fo.centro(sig.portaria, base + 8 * 1.2, 8, f.r, cx, col, 8 * 1.2);
      }
    });

    const cod = s.validacao.codigo ? `Validação: ${s.validacao.codigo}` : 'Validação: INV-AAAA-NNNNN (exemplo — gerado na emissão)';
    fo.texto(cod, MARGEM.esq, H - 6 * MM - 7 * LH_NORMAL, 7, f.r, 7 * LH_NORMAL, CINZA);
    if (marca) marcaPrevia(fo, marca);
  }

  // =============================== VERSO ===============================
  {
    const fo = new Folha(doc.addPage([W, H]), f);
    fo.p.drawImage(fundoVerso, { x: 0, y: 0, width: W, height: H });
    let y = cabecalho(fo, s, logo);
    y += espacosCabecalho(linhasAtos(s).length).topoVerso; // o modelo atualizado não tem a linha "(Verso do Certificado da ...)"
    const qualif = s.modulo.qualificacao.toUpperCase();

    const xEm = MARGEM.esq + 3.8 * MM;
    const em = s.aluno.ensinoMedio;
    const lh10 = 10 * LH_NORMAL;
    fo.texto('Conclusão do Ensino Médio:', xEm, y, 10, f.r);
    y += lh10 + 5;
    linhaCampos(fo, [
      { t: 'Instituição: ' }, { v: em.instituicao, min: 90 * MM }, { t: '        Município: ' }, { v: em.municipio, min: 30 * MM },
      { t: '   UF: ' }, { v: em.uf, min: 10 * MM },
    ], xEm, y, 10);
    y += lh10 + 5;
    linhaCampos(fo, [{ t: 'Ano de Conclusão do Curso: ' }, { v: em.anoConclusao, min: 30 * MM }], xEm, y, 10);
    y += lh10 + 10;

    // Quadro com Registro do IECT (esq.) e Registro do SISTEC (dir.)
    const topoQuadro = y;
    const colW = LARG / 2;
    const padV = 3 * MM;
    const padH = 4 * MM;
    const interno = colW - 2 * padH;
    const sz = 9.5;
    const lh = sz * 1.15;
    const local = s.local;

    // --- esquerda
    let ye = topoQuadro + padV;
    const xe = MARGEM.esq + padH;
    ye += fo.centroQuebrado('REGISTRO DO INSTITUTO INOVATIVA DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA - IECT', ye, sz, f.b, xe, interno, lh) + 10;
    for (const l of quebrar(`CERTIFICADO DA ${rotulo.toUpperCase()} ${qualif}`, f.r, sz, interno)) {
      fo.texto(l.join(' '), xe, ye, sz, f.r, lh);
      ye += lh;
    }
    ye += 8;
    const campos: [string, string | number | null, number][] = [
      ['REGISTRO Nº  ', s.registro.numero, 8],
      ['FOLHA Nº: ', s.registro.folha, 8],
      ['LIVRO Nº: ', s.registro.livro, 8],
      ['ANO LETIVO: ', s.registro.anoLetivo, 14],
    ];
    for (const [rot, v, depois] of campos) {
      linhaCampos(fo, [{ t: rot }, { v, min: 60 * MM }], xe, ye, sz, lh);
      ye += lh + depois;
    }
    const dataReg = localData(local, s.registro.data);
    linhaCampos(fo, dataReg ? [{ t: dataReg }] : [{ t: `${local}, ` }, { v: null, min: 50 * MM }], xe, ye, sz, lh);
    ye += lh + 6 + 2;
    const gap = 6 * MM;
    const meia = (interno - gap) / 2;
    const altAss = 11 * MM;
    const sigsVerso = [s.signatarios.find((x) => x.funcao === 'diretor_pedagogico'), s.signatarios.find((x) => x.funcao === 'secretario')];
    ([['Diretora Pedagógica', ass.diretor_pedagogico], ['Secretário(a)', ass.secretario]] as const).forEach(([leg, img], i) => {
      const cx = xe + i * (meia + gap);
      if (img) fo.imagem(img, cx + (meia - 45 * MM) / 2, ye, 45 * MM, altAss, 'base');
      fo.linha(cx, ye + altAss, cx + meia, ye + altAss);
      fo.centro(leg, ye + altAss + 1 * MM, sz, f.r, cx, meia, lh);
      const sig = sigsVerso[i];
      if (sig) {
        fo.centro(sig.nome, ye + altAss + 1 * MM + lh, 7.5, f.b, cx, meia, 7.5 * 1.2);
        if (sig.portaria) fo.centro(sig.portaria, ye + altAss + 1 * MM + lh + 7.5 * 1.2, 7.5, f.r, cx, meia, 7.5 * 1.2);
      }
    });
    ye += altAss + 1 * MM + lh + (sigsVerso.some(Boolean) ? 2 * 7.5 * 1.2 : 0);

    // --- direita
    const xd = MARGEM.esq + colW + padH;
    let yd = topoQuadro + padV + 4;
    fo.centro('REGISTRO DO SISTEC', yd, sz, f.b, xd, interno, lh);
    yd += lh + 18;
    linhaCampos(fo, [{ t: 'CÓDIGO DE AUTENTICAÇÃO SISTEC Nº: ' }, { v: s.sistec.codigo, min: 45 * MM }], xd, yd, sz, lh);
    yd += lh + 18;
    const dataSis = localData(local, s.sistec.data);
    linhaCampos(fo, dataSis ? [{ t: dataSis }] : [{ t: `${local}, ` }, { v: null, min: 50 * MM }], xd, yd, sz, lh);
    yd += lh + 6;
    const ladoQr = 22 * MM;
    if (s.validacao.url) desenharQr(fo, s.validacao.url, xd, yd, ladoQr);
    else if (opcoes.qrExemplo) desenharQr(fo, opcoes.qrExemplo, xd, yd, ladoQr);
    else fo.p.drawRectangle({ x: xd, y: H - yd - ladoQr, width: ladoQr, height: ladoQr, borderColor: CINZA, borderWidth: 0.5, borderDashArray: [2, 2] });
    const xt = xd + ladoQr + 3 * MM;
    const lh7 = 7.5 * LH_NORMAL;
    const urlVisivel = s.validacao.url ? s.validacao.url.replace(/^https?:\/\//, '').replace(/\?.*$/, '') : 'certificadostecnicos.institutoinovativa.org/v/…';
    const codVerso = s.validacao.codigo ?? (opcoes.qrExemplo ? 'INV-AAAA-NNNNN (QR de exemplo)' : 'INV-AAAA-NNNNN');
    const yt = yd + (ladoQr - 3 * lh7) / 2;
    fo.texto('Autenticidade deste certificado:', xt, yt, 7.5, f.r, lh7, CINZA);
    fo.texto(codVerso, xt, yt + lh7, 7.5, f.b, lh7, CINZA);
    fo.texto(urlVisivel, xt, yt + 2 * lh7, 7.5, f.r, lh7, CINZA);
    yd += ladoQr;

    const fundoQuadro = Math.max(ye, yd) + padV;
    fo.p.drawRectangle({
      x: MARGEM.esq, y: H - fundoQuadro, width: LARG, height: fundoQuadro - topoQuadro, borderColor: PRETO, borderWidth: 0.75,
    });
    fo.linha(MARGEM.esq + colW, topoQuadro, MARGEM.esq + colW, fundoQuadro);
    if (marca) marcaPrevia(fo, marca);
  }

  return doc.save();
}
