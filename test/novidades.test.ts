import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';
import { VERSAO_ATUAL, VERSOES } from '../src/novidades';
import { PERMISSOES } from '../src/auth/permissoes';

const partes = (v: string) => v.split('.').map(Number);
const maior = (a: string, b: string) => {
  const [x, y] = [partes(a), partes(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

describe('histórico de versões', () => {
  it('versão atual é a primeira da lista e bate com o package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(VERSAO_ATUAL).toBe(VERSOES[0]);
    expect(pkg.version).toBe(VERSAO_ATUAL.versao);
  });

  it('versões únicas, em ordem decrescente, com datas ISO que não voltam no tempo', () => {
    for (const v of VERSOES) {
      expect(v.versao).toMatch(/^\d+\.\d+\.\d+$/);
      expect(v.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((v.novidades?.length ?? 0) + (v.melhorias?.length ?? 0) + (v.correcoes?.length ?? 0)).toBeGreaterThan(0);
    }
    for (let i = 1; i < VERSOES.length; i++) {
      expect(maior(VERSOES[i - 1].versao, VERSOES[i].versao), `${VERSOES[i - 1].versao} > ${VERSOES[i].versao}`).toBe(true);
      expect(VERSOES[i - 1].data >= VERSOES[i].data).toBe(true);
    }
  });

  it('links e permissões dos itens existem', () => {
    for (const v of VERSOES)
      for (const it of [...(v.novidades ?? []), ...(v.melhorias ?? []), ...(v.correcoes ?? [])]) {
        if (it.href) expect(it.href).toMatch(/^\/(admin|v)(\/|$)/);
        if (it.perm) expect(PERMISSOES).toHaveProperty(it.perm);
      }
  });
});

describe('tela Novidades do Sistema', () => {
  it('qualquer perfil abre; mostra versão atual no menu e esconde links sem permissão', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const c = amb.cliente();
    await c.entrar('sec@iect.test');
    const r = await c.req('/admin/novidades');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain(`Versão ${VERSAO_ATUAL.versao}`);
    expect(html).toContain('data-marcar-versao');
    expect(html).toContain('href="/admin/diario"'); // secretaria lança notas: link ativo
    expect(html).not.toContain('href="/admin/cursos"'); // secretaria não edita cursos: só texto

    const inicio = await (await c.req('/admin')).text();
    expect(inicio).toContain('data-aviso-versao');
    expect(inicio).toContain('href="/admin/novidades"');
  });

  it('exige login', async () => {
    const { cliente } = await criarAmbiente();
    expect((await cliente().req('/admin/novidades')).status).toBe(302);
  });
});
