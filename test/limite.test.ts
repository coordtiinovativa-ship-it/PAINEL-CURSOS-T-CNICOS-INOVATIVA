import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';

/** Simula o Rate Limiting do Workers: `max` chamadas por chave. */
function limitador(max: number) {
  const cont = new Map<string, number>();
  const chaves: string[] = [];
  return {
    chaves,
    async limit({ key }: { key: string }) {
      chaves.push(key);
      const n = (cont.get(key) ?? 0) + 1;
      cont.set(key, n);
      return { success: n <= max };
    },
  };
}

async function ambienteComLimites(maxValidacao: number, maxLogin: number) {
  const amb = await criarAmbiente();
  const lv = limitador(maxValidacao);
  const ll = limitador(maxLogin);
  Object.assign(amb.env, { LIMITE_VALIDACAO: lv, LIMITE_LOGIN: ll });
  return { ...amb, lv, ll };
}

describe('limite de requisições por IP', () => {
  it('validação pública: bloqueia com 429 ao passar do limite, por IP', async () => {
    const { cliente, lv } = await ambienteComLimites(3, 100);
    const c = cliente();
    const ip = (n: number) => ({ headers: { 'CF-Connecting-IP': `203.0.113.${n}` } });
    for (let i = 0; i < 3; i++) expect((await c.req(`/v/INV-2026-0000${i + 1}`, ip(1))).status).toBe(404); // não existe, mas passou
    const r = await c.req('/v/INV-2026-00009', ip(1));
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('60');
    expect(await r.text()).toContain('Muitas tentativas em pouco tempo');
    // a página inicial /v também conta
    expect((await c.req('/v', ip(1))).status).toBe(429);
    // outro IP não é afetado
    expect((await c.req('/v', ip(2))).status).toBe(200);
    expect(lv.chaves[0]).toBe('LIMITE_VALIDACAO:203.0.113.1');
  });

  it('login: limita só o envio (POST), não a exibição da tela', async () => {
    const { cliente, criarUsuario, ll } = await ambienteComLimites(100, 2);
    await criarUsuario('a@iect.test', 'secretaria');
    const c = cliente();
    const ip = { 'CF-Connecting-IP': '198.51.100.7' };
    for (let i = 0; i < 2; i++) {
      const r = await c.req('/login', { method: 'POST', body: new URLSearchParams({ email: 'x@y.z', senha: 'errada' }), headers: { ...ip, 'Content-Type': 'application/x-www-form-urlencoded' } });
      expect(r.status).toBe(401);
    }
    // 3ª tentativa: bloqueada mesmo com a senha certa
    const r = await c.req('/login', { method: 'POST', body: new URLSearchParams({ email: 'a@iect.test', senha: 'SenhaForte123' }), headers: { ...ip, 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(r.status).toBe(429);
    // a tela de login continua abrindo
    expect((await c.req('/login', { headers: ip })).status).toBe(200);
    expect(ll.chaves.every((k) => k === 'LIMITE_LOGIN:198.51.100.7')).toBe(true);
  });

  it('painel logado não passa pelo limite', async () => {
    const { cliente, criarUsuario, lv, ll } = await ambienteComLimites(0, 100);
    await criarUsuario('a@iect.test', 'secretaria');
    const c = cliente();
    await c.entrar('a@iect.test');
    expect((await c.req('/admin/alunos')).status).toBe(200);
    expect(lv.chaves).toHaveLength(0);
    expect(ll.chaves).toHaveLength(1); // só o POST /login
  });
});
