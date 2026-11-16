import { ErroValidacao } from './form';

export const TIPOS_IMAGEM = ['image/png', 'image/jpeg'];
export const TIPOS_PDF = ['application/pdf'];

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };

/** Confere tipo pelo conteúdo (assinatura do arquivo), não só pelo nome. */
function tipoReal(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  return null;
}

/** Valida e grava no R2. Retorna a chave. */
export async function salvarArquivo(
  r2: R2Bucket,
  pasta: string,
  arquivo: File,
  tiposAceitos: string[],
  maxMB: number,
  rotulo: string,
): Promise<string> {
  if (arquivo.size > maxMB * 1024 * 1024) throw new ErroValidacao(`${rotulo}: arquivo maior que ${maxMB} MB`);
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = tipoReal(bytes);
  if (!tipo || !tiposAceitos.includes(tipo)) {
    const aceitos = tiposAceitos.map((t) => EXT[t].toUpperCase()).join(' ou ');
    throw new ErroValidacao(`${rotulo}: formato inválido (envie ${aceitos})`);
  }
  const chave = `${pasta}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${EXT[tipo]}`;
  await r2.put(chave, bytes, { httpMetadata: { contentType: tipo } });
  return chave;
}

/** Largura × altura de PNG ou JPEG lendo só o cabeçalho. */
export function dimensoesImagem(b: Uint8Array): { largura: number; altura: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) return { largura: v.getUint32(16), altura: v.getUint32(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      const tam = v.getUint16(i + 2);
      // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { altura: v.getUint16(i + 5), largura: v.getUint16(i + 7) };
      }
      i += 2 + tam;
    }
  }
  return null;
}

/** URL interna (painel) para exibir um arquivo do R2. */
export const urlArquivo = (chave: string | null | undefined) =>
  chave ? `/admin/arquivos/${chave}` : null;
