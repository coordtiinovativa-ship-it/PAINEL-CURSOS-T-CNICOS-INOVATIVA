import qrcode from 'qrcode-generator';

/**
 * QR code das prévias: o código INV e a chave só existem na emissão, então a prévia mostra um
 * QR de EXEMPLO que leva à página pública de consulta (/v) — mesmo tamanho e posição do definitivo.
 */
export const urlQrExemplo = (urlPublica: string) => `${urlPublica.replace(/\/$/, '')}/v`;

/** SVG (escalável, ocupa 100% da caixa) com zona de silêncio de 2 módulos. */
export function qrSvg(conteudo: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(conteudo);
  qr.make();
  const n = qr.getModuleCount();
  const m = 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      const ini = c;
      while (c < n && qr.isDark(r, c)) c++;
      d += `M${ini + m} ${r + m}h${c - ini}v1h-${c - ini}z`;
    }
  }
  const t = n + 2 * m;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" width="100%" height="100%" shape-rendering="crispEdges" role="img" aria-label="QR code de exemplo"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
