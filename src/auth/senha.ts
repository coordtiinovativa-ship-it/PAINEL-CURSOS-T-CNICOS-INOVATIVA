/**
 * Hash de senha com PBKDF2-SHA256 (WebCrypto, disponível no Worker e no Node).
 * Formato armazenado: pbkdf2$<iterações>$<salt base64>$<hash base64>
 * 100.000 iterações é o máximo aceito pelo runtime do Workers.
 */

const ITERACOES = 100_000;
const enc = new TextEncoder();

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(senha: string, salt: Uint8Array, iteracoes: number): Promise<Uint8Array> {
  const chave = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iteracoes },
    chave,
    256,
  );
  return new Uint8Array(bits);
}

export async function gerarHashSenha(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(senha, salt, ITERACOES);
  return `pbkdf2$${ITERACOES}$${b64(salt)}$${b64(hash)}`;
}

export async function verificarSenha(senha: string, armazenado: string): Promise<boolean> {
  const [alg, it, salt, hash] = armazenado.split('$');
  if (alg !== 'pbkdf2' || !it || !salt || !hash) return false;
  const calculado = await derivar(senha, deB64(salt), Number(it));
  const esperado = deB64(hash);
  if (calculado.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= calculado[i] ^ esperado[i];
  return dif === 0;
}

/** Regras mínimas: 10+ caracteres, com letra e número. Retorna o problema ou null. */
export function problemaSenha(senha: string): string | null {
  if (senha.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/\d/.test(senha)) return 'A senha deve ter letras e números.';
  return null;
}

/** Senha temporária legível (sem caracteres ambíguos), sempre com letras e números. */
export function gerarSenhaTemporaria(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const nums = '23456789';
  const todos = letras + nums;
  const b = crypto.getRandomValues(new Uint8Array(12));
  let s = letras[b[0] % letras.length] + nums[b[1] % nums.length];
  for (let i = 2; i < 12; i++) s += todos[b[i] % todos.length];
  return s;
}
