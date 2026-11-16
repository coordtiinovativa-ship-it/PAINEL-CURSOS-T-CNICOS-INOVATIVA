/** Renderizador HTML do motor de documentos — mesmas medidas e blocos do PDF (src/documentos/pdf.ts). */
import type { Child, FC } from 'hono/jsx';
import { A4, CORES, type Bloco, type DocumentoLayout } from './tipos';

const rgb = (c: readonly number[]) => `rgb(${c.join(',')})`;
const FAIXA = `linear-gradient(90deg,${CORES.faixa.map((c, i) => `${rgb(c)} ${(i / (CORES.faixa.length - 1)) * 100}%`).join(',')})`;

const CSS = `
@page { size: A4 portrait; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; background: #e9edf2 }
html[data-tema="escuro"] body { background: #0A1422 }
@media (prefers-color-scheme: dark) { html[data-tema="sistema"] body { background: #0A1422 } }
body { font-family: Arial, Arimo, "Liberation Sans", Helvetica, sans-serif; color: rgb(18,28,48); -webkit-print-color-adjust: exact; print-color-adjust: exact }
.pg { width: ${A4.largura}mm; min-height: ${A4.altura}mm; margin: 8mm auto; background: #fff; position: relative; overflow: hidden;
  box-shadow: 0 2px 14px rgba(0,0,0,.18); padding: ${A4.margem.topo}mm ${A4.margem.lado}mm ${A4.margem.base}mm; break-after: page }
.cab { text-align: center } .cab img { width: 50mm; height: 13mm; object-fit: contain; display: block; margin: 0 auto 2.5pt }
.cab .n { font-weight: 700; font-size: 10pt; color: ${rgb(CORES.marinho)} }
.cab .s { font-size: 8pt; color: ${rgb(CORES.cinza)}; line-height: 1.22 }
.faixa { height: 2.2pt; background: ${FAIXA}; margin: 4pt 0 12pt }
.ti { text-align: center; margin-bottom: 6pt } .ti b { display: block; font-size: 15pt; color: ${rgb(CORES.marinho)} }
.ti span { font-size: 10pt; color: ${rgb(CORES.cinza)} }
.se { background: ${rgb(CORES.marinho)}; color: #fff; font-weight: 700; font-size: 8.5pt; text-transform: uppercase; padding: 1.5pt 6pt; height: 14pt; margin-bottom: 4pt }
.pa { margin: 0 0 6pt } .pa.just { text-align: justify } .pa.centro { text-align: center } .pa.direita { text-align: right }
.no { font-size: 8pt; color: ${rgb(CORES.cinza)}; line-height: 1.35; margin: 0 0 6pt }
.li { margin: 0 0 5pt; padding: 0 0 0 12pt; font-size: 9.5pt; line-height: 1.4 } .li li { margin-bottom: 3pt } .li li::marker { color: ${rgb(CORES.marinho)} }
.ca { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 6pt; border-left: 0.5pt solid ${rgb(CORES.borda)}; border-top: 0.5pt solid ${rgb(CORES.borda)} }
.ca div { border-right: 0.5pt solid ${rgb(CORES.borda)}; border-bottom: 0.5pt solid ${rgb(CORES.borda)}; padding: 2pt 4pt 2.5pt }
.ca small { display: block; font-size: 6.8pt; font-weight: 700; color: ${rgb(CORES.cinza)}; text-transform: uppercase }
.ca span { font-size: 9.5pt; line-height: 1.25 } .ca .vz { color: ${rgb(CORES.cinza)} }
table.tb { width: 100%; border-collapse: collapse; margin-bottom: 8pt; font-size: 9pt }
.tb th, .tb td { border: 0.5pt solid ${rgb(CORES.borda)}; padding: 2.5pt 4pt; line-height: 1.25; vertical-align: top }
.tb th { background: ${rgb(CORES.cabecalhoTabela)}; font-size: 8.2pt } .tb tr:nth-child(odd) td { background: ${rgb(CORES.zebra)} }
.tb tr.total td { background: ${rgb(CORES.cabecalhoTabela)}; font-weight: 700 }
.as { display: flex; margin-top: 6pt; text-align: center } .as > div { flex: 1; padding: 0 10pt }
.as .im { height: 12mm; display: flex; align-items: center; justify-content: center } .as .im img { max-height: 12mm; max-width: 100% }
.as .ln { border-top: 0.7pt solid rgb(18,28,48); margin: 2pt auto 3pt; max-width: 70mm }
.as b { display: block; font-size: 9pt } .as span { font-size: 8.5pt; color: ${rgb(CORES.cinza)} }
.ph { border: 1px dashed #b8c2cf; color: #98a2b3; font-size: 7pt; padding: 8pt 14pt }
.ro { position: absolute; left: ${A4.margem.lado}mm; right: ${A4.margem.lado}mm; bottom: ${A4.rodape - 16 - 2 - 2}mm; border-top: 0.5pt solid ${rgb(CORES.borda)};
  padding-top: 3pt; display: flex; justify-content: space-between; gap: 10pt; font-size: 7.5pt; color: ${rgb(CORES.cinza)}; line-height: 1.27 }
.ro .qr { width: 16mm; height: 16mm; border: 0.5pt solid ${rgb(CORES.borda)}; flex: none; display: flex; align-items: center; justify-content: center; font-size: 6pt; text-align: center }
.marca { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(-40deg); font-size: 54pt; font-weight: 700; color: rgba(217,51,51,.16); white-space: nowrap; pointer-events: none }
@media print { html, body { background: #fff } .pg { margin: 0; box-shadow: none } .nao-imprimir { display: none !important } .ph { visibility: hidden } }
`;

const Bl: FC<{ b: Bloco; url: (k: string | null | undefined) => string | null }> = ({ b, url }) => {
  switch (b.tipo) {
    case 'espaco':
      return <div style={`height:${b.altura}pt`} />;
    case 'titulo':
      return <div class="ti"><b>{b.texto}</b>{b.subtitulo && <span>{b.subtitulo}</span>}</div>;
    case 'secao':
      return <div class="se">{b.texto}</div>;
    case 'paragrafo': {
      const al = b.alinhar ?? 'justificado';
      const size = b.tamanho ?? 10.5;
      return (
        <p class={`pa ${al === 'justificado' ? 'just' : al}`}
          style={`font-size:${size}pt;line-height:${b.entrelinha ?? 1.5};${b.negrito ? 'font-weight:700;' : ''}${b.recuo ? 'text-indent:15mm;' : ''}white-space:pre-line`}>
          {b.texto}
        </p>
      );
    }
    case 'nota':
      return <p class="no">{b.texto}</p>;
    case 'lista':
      return <ul class="li">{b.itens.map((i) => <li>{i}</li>)}</ul>;
    case 'campos':
      return (
        <div class="ca">
          {b.itens.map((i) => (
            <div style={`grid-column:span ${i.span ?? 1}`}><small>{i.rotulo}</small><span class={i.valor ? '' : 'vz'}>{i.valor ?? '—'}</span></div>
          ))}
        </div>
      );
    case 'tabela': {
      const soma = b.colunas.reduce((a, c) => a + c.largura, 0);
      const al = (i: number) => `text-align:${b.colunas[i].alinhar === 'centro' ? 'center' : b.colunas[i].alinhar === 'direita' ? 'right' : 'left'}`;
      return (
        <table class="tb">
          <colgroup>{b.colunas.map((c) => <col style={`width:${(c.largura / soma) * 100}%`} />)}</colgroup>
          <tr>{b.colunas.map((c, i) => <th style={al(i)}>{c.titulo}</th>)}</tr>
          {b.linhas.map((l) => <tr>{l.map((t, i) => <td style={al(i)}>{t}</td>)}</tr>)}
          {b.total && <tr class="total">{b.total.map((t, i) => <td style={al(i)}>{t}</td>)}</tr>}
        </table>
      );
    }
    case 'assinaturas':
      return (
        <div class="as">
          {b.itens.map((i) => {
            const src = url(i.assinatura_r2_key);
            return (
              <div>
                <div class="im">{src ? <img src={src} alt="assinatura" /> : <span class="ph">assinatura</span>}</div>
                <div class="ln" />
                {i.nome && <b>{i.nome}</b>}
                <span>{i.legenda}</span>
                {i.detalhe && <span style="display:block;font-size:7.5pt">{i.detalhe}</span>}
              </div>
            );
          })}
        </div>
      );
  }
};

export const PaginasDocumento: FC<{ layout: DocumentoLayout; url: (k: string | null | undefined) => string | null; previa?: boolean; qrSvg?: string }> = ({ layout, url, previa, qrSvg }) => {
  const v = layout.validacao;
  const i = layout.instituicao;
  return (
    <div id="folhas">
      {layout.paginas.map((pg) => (
        <section class="pg">
          <div class="cab">
            <img src={url(i.logo_r2_key) ?? '/modelo/logo.png'} alt="Logo" />
            <div class="n">{i.nome}</div>
            <div class="s">{i.enderecoLinha}</div>
            <div class="s">{i.credenciamento}</div>
          </div>
          <div class="faixa" />
          {pg.blocos.map((b) => <Bl b={b} url={url} />)}
          {layout.rodape ? (
            <div class="ro"><div>{layout.rodape.map((l, i) => (i ? <><br />{l}</> : <b>{l}</b>))}</div></div>
          ) : (
          <div class="ro">
            <div>
              {v.codigo ? (
                <><b>Documento registrado sob o código {v.codigo}.</b><br />Confira a autenticidade em {v.url?.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}<br />ou pelo QR code ao lado.</>
              ) : (
                <><b>PRÉVIA — o código de validação (INV-AAAA-NNNNN) e o QR code definitivo são gerados na emissão.</b>{qrSvg && <><br />QR code de exemplo ao lado: no documento emitido, ele leva à página de validação.</>}</>
              )}
            </div>
            {qrSvg ? <div class="qr" style="border:0" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <div class="qr">{v.codigo ? 'QR' : 'QR code'}</div>}
          </div>
          )}
          {previa && <div class="marca">PRÉVIA — SEM VALIDADE</div>}
        </section>
      ))}
    </div>
  );
};

export const DocumentoHtml: FC<{ layout: DocumentoLayout; url: (k: string | null | undefined) => string | null; previa?: boolean; tema?: string; barra?: Child; qrSvg?: string }> = ({
  layout, url, previa, tema = 'sistema', barra, qrSvg,
}) => (
  <html lang="pt-BR" data-tema={tema}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{layout.titulo}</title>
      <link href="https://fonts.googleapis.com/css2?family=Arimo:wght@400;700&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      {barra}
      <PaginasDocumento layout={layout} url={url} previa={previa} qrSvg={qrSvg} />
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var f=document.getElementById('folhas');function z(){var w=document.documentElement.clientWidth-24;var p=210*96/25.4;f.style.zoom=Math.min(1,w/p)}z();addEventListener('resize',z);matchMedia('print').addEventListener('change',function(e){f.style.zoom=e.matches?1:'';if(!e.matches)z()})})();`,
        }}
      />
    </body>
  </html>
);
