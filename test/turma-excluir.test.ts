import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';

const msg = (r: Response) => decodeURIComponent(r.headers.get('Location') ?? '');

async function pronto(perfil: string) {
  const amb = await criarAmbiente({ ficticios: true });
  amb.sqlite.exec(`UPDATE signatarios SET nome = 'Maria Diretora' WHERE id = 1; UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`);
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  return { ...amb, c };
}
const conta = (sqlite: any, sql: string) => (sqlite.prepare(sql).get() as any).n;

describe('excluir turma cadastrada por engano', () => {
  it('secretaria e coordenador não excluem turma', async () => {
    const { c } = await pronto('secretaria');
    expect(await (await c.req('/admin/turmas/1')).text()).not.toContain('Excluir turma');
    expect((await c.post('/admin/turmas/1/excluir', { confirmacao: 'TIDC-2026-1' })).status).toBe(403);
  });

  it('administrador exclui digitando o código: apaga matrículas, resultados e módulos; alunos continuam; auditoria guarda tudo', async () => {
    const { c, sqlite, auditoria } = await pronto('administrador');
    const tela = await (await c.req('/admin/turmas/1')).text();
    expect(tela).toContain('Excluir turma (cadastrada por engano)');
    const alunos = conta(sqlite, 'SELECT count(*) n FROM alunos');
    expect(conta(sqlite, 'SELECT count(*) n FROM resultados')).toBeGreaterThan(0);

    let r = await c.post('/admin/turmas/1/excluir', { confirmacao: 'OUTRA' });
    expect(msg(r)).toContain('digite exatamente o código da turma');
    expect(conta(sqlite, 'SELECT count(*) n FROM turmas WHERE id = 1')).toBe(1);

    r = await c.post('/admin/turmas/1/excluir', { confirmacao: 'tidc-2026-1' });
    expect(r.headers.get('Location')).toMatch(/^\/admin\/turmas\?ok=/);
    expect(msg(r)).toContain('Turma TIDC-2026-1 excluída');
    expect(conta(sqlite, 'SELECT count(*) n FROM turmas WHERE id = 1')).toBe(0);
    expect(conta(sqlite, 'SELECT count(*) n FROM matriculas WHERE turma_id = 1')).toBe(0);
    expect(conta(sqlite, 'SELECT count(*) n FROM turma_modulos WHERE turma_id = 1')).toBe(0);
    expect(conta(sqlite, 'SELECT count(*) n FROM resultados')).toBe(0);
    expect(conta(sqlite, 'SELECT count(*) n FROM alunos')).toBe(alunos);
    const a = auditoria().at(-1)!;
    expect(a).toMatchObject({ acao: 'excluir', entidade: 'turma' });
    const antes = JSON.parse((sqlite.prepare(`SELECT antes_json FROM auditoria WHERE entidade = 'turma' AND acao = 'excluir'`).get() as any).antes_json);
    expect(antes.turma.codigo).toBe('TIDC-2026-1');
    expect(antes.matriculas.length).toBeGreaterThan(0);
    expect(antes.resultados.length).toBeGreaterThan(0);
  });

  it('turma com documento emitido não pode ser excluída', async () => {
    const { c, sqlite } = await pronto('administrador');
    expect((await c.post('/admin/documentos/declaracao_conclusao_modulo/1/1', { data_emissao: '2026-12-05' })).status).toBe(302);
    expect(await (await c.req('/admin/turmas/1')).text()).toContain('não pode ser excluída');
    const r = await c.post('/admin/turmas/1/excluir', { confirmacao: 'TIDC-2026-1' });
    expect(msg(r)).toContain('já tem 1 certificado(s)/documento(s) emitido(s)');
    expect(conta(sqlite, 'SELECT count(*) n FROM turmas WHERE id = 1')).toBe(1);
  }, 30_000);
});
