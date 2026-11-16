/**
 * Prévia do certificado de qualificação intermediária — reproduz o modelo aprovado no PPC
 * (Modelo_Certificado_IECT_PPC.docx): A4 paisagem, fundo de página inteira, logo centralizado,
 * cabeçalho, título espaçado, texto justificado em negrito, três assinaturas; verso com
 * Ensino Médio, Registro do IECT e Registro do SISTEC. Medidas convertidas do .docx.
 * QR code e código de validação são acréscimos discretos (gerados no passo 3).
 */
import type { Child, FC } from 'hono/jsx';
import type { DadosCertificado, Signatario } from './dados';
import { dataExtenso } from '../lib/datas';

export interface ImagensCertificado {
  logo: string;
  fundoFrente: string;
  fundoVerso: string;
  assinaturaDiretor: string | null;
  assinaturaSecretario: string | null;
}

export interface RegistroCertificado {
  codigoValidacao?: string | null;
  urlValidacao?: string | null;
  registroNumero?: string | null;
  folha?: string | null;
  livro?: string | null;
  dataRegistro?: string | null;
  sistecCodigo?: string | null;
  sistecData?: string | null;
}

const CSS = `
@page { size: A4 landscape; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; background: #e9edf2 }
html[data-tema="escuro"] body { background: #0A1422 }
@media (prefers-color-scheme: dark) { html[data-tema="sistema"] body { background: #0A1422 } }
body { font-family: Arial, Arimo, "Liberation Sans", Helvetica, sans-serif; color: #000;
  -webkit-print-color-adjust: exact; print-color-adjust: exact }
.folha { width: 297mm; height: 210mm; position: relative; margin: 8mm auto; background: #fff;
  box-shadow: 0 2px 14px rgba(0,0,0,.18); overflow: hidden; page-break-after: always; break-after: page }
.folha > .fundo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; z-index: 0 }
.conteudo { position: absolute; top: 11.43mm; right: 24.13mm; bottom: 13.97mm; left: 24.13mm; z-index: 1 }
p { margin: 0 }
.logo { text-align: center; margin-bottom: 1.4mm } .logo img { width: 59.7mm; height: 15.6mm; object-fit: contain }
.cab1 { text-align: center; font-weight: 700; font-size: 10.5pt; margin-bottom: 1pt }
.cab2 { text-align: center; font-size: 9pt; margin-bottom: 1pt }
.titulo { text-align: center; font-weight: 700; font-size: 21pt; margin: 4pt 0 16pt; white-space: pre }
.corpo { text-align: justify; font-weight: 400; font-size: 11pt; line-height: 1.55; text-indent: 19.05mm; margin-bottom: 14pt }
.local { text-align: right; font-size: 11pt; margin: 4pt 0 18pt }
.assinaturas { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; font-size: 10.5pt; line-height: 1.15 }
.assin { display: flex; flex-direction: column; align-items: center }
.assin .img { height: 15mm; display: flex; align-items: flex-end; justify-content: center }
.assin .img img { max-height: 15mm; max-width: 55mm }
.assin .linha { width: 62mm; border-top: 1px solid #000; margin-top: 1mm; padding-top: 1mm }
.port { font-size: 8pt; color: #222; line-height: 1.2; margin-top: 1pt } .port b { font-weight: 700 }
.verso-titulo { text-align: center; font-weight: 700; font-size: 11pt; margin: 0 0 10pt }
.em { font-size: 10pt; margin-left: 3.8mm } .em p { margin-bottom: 5pt } .em p.ult { margin-bottom: 10pt }
.registros { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; font-size: 9.5pt; margin: 0 auto; width: 100% }
.registros > div { padding: 3mm 4mm } .registros > div + div { border-left: 1px solid #000 }
.registros h3 { font-size: 9.5pt; text-align: center; margin: 0 0 10pt; font-weight: 700 }
.registros p { line-height: 1.15; margin-bottom: 8pt }
.duas-assin { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; text-align: center; margin-top: 2pt }
.duas-assin .img { height: 11mm; display: flex; align-items: flex-end; justify-content: center }
.duas-assin .img img { max-height: 11mm; max-width: 45mm }
.duas-assin .linha { border-top: 1px solid #000; padding-top: 1mm }
.validacao { display: flex; gap: 3mm; align-items: center; margin-top: 6pt; font-size: 7.5pt; color: #333 }
.qr { width: 22mm; height: 22mm; border: 1px dashed #98a2b3; display: flex; align-items: center; justify-content: center;
  font-size: 7pt; color: #667085; text-align: center; background: #fff }
.codigo-frente { position: absolute; left: 24.13mm; bottom: 6mm; font-size: 7pt; color: #555; z-index: 1 }
.falta { background: #fff2b3; color: #8a5a00; outline: 1px dashed #d9a400 }
.vazio { display: inline-block; min-width: 35mm; border-bottom: 1px solid #000; height: 1em; vertical-align: baseline }
.ph-assin { width: 42mm; height: 11mm; border: 1px dashed #b8c2cf; color: #98a2b3; font-size: 7pt; display: flex;
  align-items: center; justify-content: center; font-weight: 400 }
@media print { html, body { background: #fff } .folha { margin: 0; box-shadow: none } .nao-imprimir { display: none !important }
  .falta { background: none; outline: none; color: #000 } .ph-assin { visibility: hidden } }
`;

const Valor: FC<{ v: string | number | null | undefined; largura?: string }> = ({ v, largura }) =>
  v == null || String(v).trim() === '' ? <span class="vazio" style={largura ? `min-width:${largura}` : ''} /> : <>{v}</>;

const Cabecalho: FC<{ d: DadosCertificado; img: ImagensCertificado }> = ({ d, img }) => {
  const i = d.instituicao;
  return (
    <>
      <div class="logo"><img src={img.logo} alt="Logo" /></div>
      <p class="cab1">{String(i.razao_social).toUpperCase()}</p>
      <p class="cab2">{i.endereco} – {i.bairro}, {i.municipio} - {i.uf}, {i.cep}</p>
      <p class="cab2">{d.credenciamentoTexto ?? <span class="falta">[ato de credenciamento]</span>}</p>
      <p class="cab2">Atos autorizativos vigentes</p>
    </>
  );
};

/** Nome e portaria de nomeação do signatário, abaixo da linha de assinatura. */
const Portaria: FC<{ s: DadosCertificado['diretor'] }> = ({ s }) =>
  s && !s.nome.includes('A DEFINIR') ? (
    <div class="port"><b>{s.nome}</b>{s.portaria ? <><br />{s.portaria}</> : <><br /><span class="falta">[portaria não cadastrada]</span></>}</div>
  ) : null;

const ImgAssinatura: FC<{ src: string | null; grande?: boolean }> = ({ src }) =>
  src ? <img src={src} alt="assinatura" /> : <span class="ph-assin">assinatura digitalizada</span>;

/** Trechos seguidos com o mesmo peso viram um só <b> (variáveis dentro de um trecho em negrito). */
function agruparNegrito<T extends { negrito?: boolean }>(segs: T[]) {
  const out: { negrito: boolean; itens: T[] }[] = [];
  for (const s of segs) {
    const n = !!s.negrito;
    if (out.length && out.at(-1)!.negrito === n) out.at(-1)!.itens.push(s);
    else out.push({ negrito: n, itens: [s] });
  }
  return out;
}

const localData = (local: string, iso: string | null | undefined) =>
  iso ? `${local}, ${dataExtenso(iso)}` : null;

export const Frente: FC<{ d: DadosCertificado; img: ImagensCertificado; reg?: RegistroCertificado }> = ({ d, img, reg }) => (
  <section class="folha">
    <img class="fundo" src={img.fundoFrente} alt="" />
    <div class="conteudo">
      <Cabecalho d={d} img={img} />
      <p class="titulo" style="margin-top:14pt">C  E  R  T  I  F  I  C  A  D  O</p>
      <p class="corpo">
        {agruparNegrito(d.textoFrente).map((g) => {
          const conteudo = g.itens.map((s) => s.faltante ? <span class="falta" title={`Campo não preenchido: ${s.variavel}`}>{s.texto}</span> : s.texto);
          return g.negrito ? <b>{conteudo}</b> : conteudo;
        })}
      </p>
      <p class="local">{localData(d.localEmissao, d.dataEmissao)}.</p>
      <div class="assinaturas">
        <div class="assin">
          <div class="img"><ImgAssinatura src={img.assinaturaDiretor} /></div>
          <div class="linha">Assinatura da Diretora<br />Pedagógica</div>
          <Portaria s={d.diretor} />
        </div>
        <div class="assin">
          <div class="img" />
          <div class="linha">Assinatura Titular</div>
        </div>
        <div class="assin">
          <div class="img"><ImgAssinatura src={img.assinaturaSecretario} /></div>
          <div class="linha">Assinatura do Secretário(a)</div>
          <Portaria s={d.secretario} />
        </div>
      </div>
    </div>
    <div class="codigo-frente">
      {reg?.codigoValidacao ? `Validação: ${reg.codigoValidacao}` : 'Validação: INV-AAAA-NNNNN (gerado na emissão)'}
    </div>
  </section>
);

export const Verso: FC<{ d: DadosCertificado; img: ImagensCertificado; reg?: RegistroCertificado; qr?: Child }> = ({ d, img, reg, qr }) => {
  const a = d.aluno;
  const qualif = (d.modulo.qualificacao_conferida ?? '').toUpperCase();
  const local = d.localEmissao;
  return (
    <section class="folha">
      <img class="fundo" src={img.fundoVerso} alt="" />
      <div class="conteudo">
        <Cabecalho d={d} img={img} />
        <div style="height:8pt" />
        <div class="em">
          <p>Conclusão do Ensino Médio:</p>
          <p>
            Instituição: <Valor v={a.ensino_medio_instituicao} largura="90mm" />
            {'        '}&nbsp;&nbsp;&nbsp;&nbsp;Município: <Valor v={a.ensino_medio_municipio} largura="30mm" />
            &nbsp;&nbsp;&nbsp;UF: <Valor v={a.ensino_medio_uf} largura="10mm" />
          </p>
          <p class="ult">Ano de Conclusão do Curso: <Valor v={a.ensino_medio_ano_conclusao} largura="30mm" /></p>
        </div>
        <div class="registros">
          <div>
            <h3>REGISTRO DO INSTITUTO INOVATIVA DE EDUCAÇÃO, CIÊNCIA E TECNOLOGIA - IECT</h3>
            <p>CERTIFICADO DA {d.rotuloQualificacao.toUpperCase()} {qualif}</p>
            <p>REGISTRO Nº &nbsp;<Valor v={reg?.registroNumero} largura="60mm" /></p>
            <p>FOLHA Nº: <Valor v={reg?.folha} largura="60mm" /></p>
            <p>LIVRO Nº: <Valor v={reg?.livro} largura="60mm" /></p>
            <p style="margin-bottom:14pt">ANO LETIVO: <Valor v={d.turma.ano_letivo} largura="60mm" /></p>
            <p style="margin-bottom:6pt">{reg?.dataRegistro ? localData(local, reg.dataRegistro) : <>{local}, <Valor v={null} largura="50mm" /></>}</p>
            <div class="duas-assin">
              <div><div class="img"><ImgAssinatura src={img.assinaturaDiretor} /></div><div class="linha">Diretora Pedagógica</div><Portaria s={d.diretor} /></div>
              <div><div class="img"><ImgAssinatura src={img.assinaturaSecretario} /></div><div class="linha">Secretário(a)</div><Portaria s={d.secretario} /></div>
            </div>
          </div>
          <div>
            <h3 style="margin-top:4pt;margin-bottom:18pt">REGISTRO DO SISTEC</h3>
            <p style="margin-bottom:18pt">CÓDIGO DE AUTENTICAÇÃO SISTEC Nº: <Valor v={reg?.sistecCodigo} largura="45mm" /></p>
            <p>{reg?.sistecData ? localData(local, reg.sistecData) : <>{local}, <Valor v={null} largura="50mm" /></>}</p>
            <div class="validacao">
              {qr ?? <div class="qr">QR code<br />(gerado na emissão)</div>}
              <div>
                Autenticidade deste certificado:<br />
                <b>{reg?.codigoValidacao ?? 'INV-AAAA-NNNNN'}</b><br />
                {reg?.urlValidacao ?? 'certificadostecnicos.institutoinovativa.org/v/…'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/** Documento HTML completo (usado na página de prévia e no iframe da edição ao vivo). */
export const DocumentoPrevia: FC<{
  d: DadosCertificado;
  img: ImagensCertificado;
  reg?: RegistroCertificado;
  barra?: Child;
  tema?: string;
}> = ({ d, img, reg, barra, tema = 'sistema' }) => (
  <html lang="pt-BR" data-tema={tema}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Prévia — {d.nomeExibido} — {d.modulo.nome}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Arimo:wght@400;700&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      {barra}
      <div id="folhas">
        <Frente d={d} img={img} reg={reg} />
        <Verso d={d} img={img} reg={reg} />
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var f=document.getElementById('folhas');function z(){var w=document.documentElement.clientWidth-24;var p=297*96/25.4;f.style.zoom=Math.min(1,w/p)}z();addEventListener('resize',z);matchMedia('print').addEventListener('change',function(e){f.style.zoom=e.matches?1:'';if(!e.matches)z()})})();`,
        }}
      />
    </body>
  </html>
);

export function imagensPadrao(d: DadosCertificado, url: (k: string | null) => string | null): ImagensCertificado {
  const ass = (s: Signatario | null) => (s?.assinatura_r2_key ? url(s.assinatura_r2_key) : null);
  return {
    logo: url(d.instituicao.logo_r2_key) ?? '/modelo/logo.png',
    fundoFrente: url(d.instituicao.fundo_r2_key) ?? '/modelo/fundo.jpg',
    fundoVerso: url(d.instituicao.fundo_verso_r2_key) ?? url(d.instituicao.fundo_r2_key) ?? '/modelo/fundo.jpg',
    assinaturaDiretor: ass(d.diretor),
    assinaturaSecretario: ass(d.secretario),
  };
}
