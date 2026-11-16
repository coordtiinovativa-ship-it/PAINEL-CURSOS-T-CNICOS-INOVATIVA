import type { Env } from '../tipos';
import type { RecursosPdf } from './pdf';
import type { SnapshotCertificado } from './snapshot';

type Bindings = Env['Bindings'];

// Cache por isolate: fontes e imagens padrão não mudam entre requisições.
const cacheAssets = new Map<string, Promise<Uint8Array>>();

export function asset(env: Bindings, caminho: string): Promise<Uint8Array> {
  let p = cacheAssets.get(caminho);
  if (!p) {
    p = (async () => {
      if (!env.ASSETS) throw new Error('Binding ASSETS não configurado');
      const r = await env.ASSETS.fetch(new Request(`https://assets.local${caminho}`));
      if (!r.ok) throw new Error(`Arquivo estático ausente: ${caminho}`);
      return new Uint8Array(await r.arrayBuffer());
    })();
    p.catch(() => cacheAssets.delete(caminho));
    cacheAssets.set(caminho, p);
  }
  return p;
}

export async function r2(env: Bindings, chave: string | null): Promise<Uint8Array | null> {
  if (!chave) return null;
  const o = await env.ARQUIVOS.get(chave);
  return o ? new Uint8Array(await o.arrayBuffer()) : null;
}

export async function carregarRecursos(env: Bindings, s: SnapshotCertificado): Promise<RecursosPdf> {
  const [fonteRegular, fonteNegrito, logoR2, fundoR2, fundoVersoR2, ...assinaturas] = await Promise.all([
    asset(env, '/fontes/Arimo-Regular.ttf'),
    asset(env, '/fontes/Arimo-Bold.ttf'),
    r2(env, s.instituicao.logo_r2_key),
    r2(env, s.instituicao.fundo_r2_key),
    r2(env, s.instituicao.fundo_verso_r2_key ?? null),
    ...s.signatarios.map((sig) => r2(env, sig.assinatura_r2_key)),
  ]);
  const rec: RecursosPdf = {
    fonteRegular,
    fonteNegrito,
    logo: logoR2 ?? (await asset(env, '/modelo/logo.png')),
    fundoFrente: fundoR2 ?? (await asset(env, '/modelo/fundo.jpg')),
    fundoVerso: fundoVersoR2 ?? fundoR2 ?? (await asset(env, '/modelo/fundo.jpg')),
    assinaturas: {},
  };
  s.signatarios.forEach((sig, i) => {
    const b = assinaturas[i];
    if (b) rec.assinaturas[sig.funcao] = b;
  });
  return rec;
}
