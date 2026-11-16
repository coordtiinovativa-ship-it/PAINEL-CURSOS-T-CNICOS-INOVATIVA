import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';

const SIG = `UPDATE signatarios SET nome = 'Maria Diretora' WHERE id = 1; UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`;
// Ana (mat. 1) e Renata (mat. 3, reprovada no módulo 1 por frequência) aprovadas em todas as disciplinas do módulo 2
const NOTAS_MOD2 = [1, 3].flatMap((m) => [7, 8, 9, 10, 11, 12].map((c) => `(${m}, ${c}, 8, NULL, 90)`)).join(',');

async function ambiente(perfil = 'secretaria') {
  const amb = await criarAmbiente({ ficticios: true });
  amb.sqlite.exec(SIG);
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  const tm = (mod: number) => (amb.sqlite.prepare('SELECT * FROM turma_modulos WHERE turma_id = 1 AND modulo_id = ?').get(mod) as any);
  const salvar = (mod: number, campos: Record<string, string>) => c.post(`/admin/turmas/1/modulos-turma/${tm(mod).id}`, campos);
  return { ...amb, c, tm, salvar };
}
const msg = (r: Response) => decodeURIComponent(r.headers.get('Location') ?? '');
const EMISSAO = { data_emissao: '2026-12-05', registro_numero: '1', folha: '1', livro: '1', data_registro: '2026-12-05', sistec_codigo: 'S-1', sistec_data: '2026-12-04' };

describe('módulos da turma (em sequência)', () => {
  it('turma nova já nasce com o módulo 1 em andamento e os demais planejados', async () => {
    const { c, sqlite } = await ambiente('administrador');
    const r = await c.post('/admin/turmas/nova', { matriz_id: '1', codigo: 'TIDC-2027-1', data_inicio: '2027-02-01', data_fim: '2027-12-10', ano_letivo: '2027' });
    const id = Number(/turmas\/(\d+)/.exec(msg(r))![1]);
    const mods = sqlite.prepare('SELECT modulo_id, data_inicio, situacao FROM turma_modulos WHERE turma_id = ? ORDER BY modulo_id').all(id).map((x: any) => ({ ...x }));
    expect(mods).toEqual([
      { modulo_id: 1, data_inicio: '2027-02-01', situacao: 'em_andamento' },
      { modulo_id: 2, data_inicio: null, situacao: 'planejado' },
      { modulo_id: 3, data_inicio: null, situacao: 'planejado' },
    ]);
    const html = await (await c.req(`/admin/turmas/${id}`)).text();
    expect(html).toContain('Módulos da turma');
    expect(html).toContain('aguardando início');
  });

  it('respeita a ordem: não inicia o módulo 3 com o 2 em andamento; conclusão exige datas coerentes', async () => {
    const { salvar, tm } = await ambiente();
    expect(msg(await salvar(3, { data_inicio: '2026-09-01', situacao: 'em_andamento' }))).toContain('conclua antes o Módulo 2 — Empreendedorismo');
    expect(msg(await salvar(2, { data_inicio: '2026-08-03', situacao: 'concluido' }))).toContain('Informe a data de término');
    expect(msg(await salvar(2, { data_inicio: '2026-06-01', data_fim: '2026-11-27', situacao: 'concluido' }))).toContain('não pode começar antes do término do Módulo 1 (26/06/2026)');
    expect(msg(await salvar(2, { data_inicio: '2026-08-03', data_fim: '2026-11-27', situacao: 'concluido' }))).toContain('concluído');
    expect(tm(2)).toMatchObject({ situacao: 'concluido', data_fim: '2026-11-27' });
    expect(msg(await salvar(3, { data_inicio: '2026-12-01', situacao: 'em_andamento' }))).toContain('em andamento');
    // não reabre o 2 com o 3 já iniciado
    expect(msg(await salvar(2, { data_inicio: '2026-08-03', data_fim: '2026-11-27', situacao: 'em_andamento' }))).toContain('já começou');
  });

  it('notas só em módulo iniciado (tela e importação)', async () => {
    const { c } = await ambiente();
    expect(msg(await c.req('/admin/turmas/1/modulos/3/disciplinas/13'))).toContain('ainda está "planejado"');
    expect(msg(await c.post('/admin/turmas/1/modulos/3/disciplinas/13', { nota_1: '8', freq_1: '90' }))).toContain('ainda está "planejado"');
    const fd = new FormData();
    fd.set('alvo', '1:3');
    fd.set('arquivo', new File([new TextEncoder().encode('CPF;Disciplina;Média;Frequência\n11122233396;Gestão de Conflitos;8;90')], 'n.csv'));
    expect(msg(await c.req('/admin/importacao/notas', { method: 'POST', body: fd }))).toContain('ainda está "planejado"');
  });

  it('certificado só de módulo concluído e com o módulo anterior aprovado', async () => {
    const { c, sqlite, salvar } = await ambiente();
    sqlite.exec(`INSERT INTO resultados (matricula_id, componente_id, nota, nota_exame_final, frequencia) VALUES ${NOTAS_MOD2};`);
    // módulo 2 em andamento: bloqueado
    let html = await (await c.req('/admin/previa/1/2')).text();
    expect(html).toContain('Módulo ainda não concluído na turma (situação: Em andamento)');
    expect((await c.post('/admin/certificados/emitir/1/2', EMISSAO)).status).toBe(400);
    // conclui o módulo 2
    await salvar(2, { data_inicio: '2026-08-03', data_fim: '2026-11-27', situacao: 'concluido' });
    html = await (await c.req('/admin/previa/1/2')).text();
    expect(html).toContain('Apto para emissão');
    // Renata: aprovada no 2, mas reprovada no 1 → bloqueada pela ordem
    html = await (await c.req('/admin/previa/3/2')).text();
    expect(html).toContain('aluno ainda não aprovado no Módulo 1 — Qualidade');
    const lista = await (await c.req('/admin/certificados/pendentes')).text();
    expect(lista).toMatch(/Renata Fictícia Alves[\s\S]*?Aguardando aprovação no módulo anterior/);
    expect(lista).toContain('/admin/certificados/emitir/1/2');
    expect(lista).not.toContain('/admin/certificados/emitir/3/2');
    // declaração também respeita a ordem e usa o período do módulo
    expect(await (await c.req('/admin/documentos/declaracao_conclusao_modulo/3/2')).text()).toContain('aluno ainda não aprovado no Módulo 1');
    expect(await (await c.req('/admin/documentos/declaracao_conclusao_modulo/1/2/previa')).text()).toContain('no período de 03/08/2026 a 27/11/2026');
  }, 30_000);

  it('módulo com certificado emitido não pode ser reaberto', async () => {
    const { c, salvar, tm } = await ambiente('admin_master');
    expect((await c.post('/admin/certificados/emitir/1/1', EMISSAO)).status).toBe(302);
    // para testar só a trava do certificado, volta o módulo 2 para planejado (ninguém tem nota nele)
    expect(msg(await salvar(2, { situacao: 'planejado' }))).toContain('planejado');
    expect(msg(await salvar(1, { data_inicio: '2026-02-09', situacao: 'em_andamento' }))).toContain('já tem 1 certificado(s) emitido(s)');
    expect(tm(1).situacao).toBe('concluido');
  }, 30_000);

  it('módulo com notas lançadas não volta para "planejado"', async () => {
    const { sqlite, salvar, tm } = await ambiente();
    sqlite.exec(`INSERT INTO resultados (matricula_id, componente_id, nota, frequencia) VALUES (1, 7, 8, 90)`);
    expect(msg(await salvar(2, { situacao: 'planejado' }))).toContain('já tem notas lançadas');
    expect(tm(2).situacao).toBe('em_andamento');
  });
});
