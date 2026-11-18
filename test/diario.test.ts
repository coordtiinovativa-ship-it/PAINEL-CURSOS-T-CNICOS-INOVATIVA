import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';
import { aulasPrevistas, calcularFrequencia, descreverHorario } from '../src/lib/frequencia';

const msg = (r: Response) => decodeURIComponent(r.headers.get('Location') ?? '');

async function pronto(perfil = 'secretaria') {
  const amb = await criarAmbiente({ ficticios: true });
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  return { ...amb, c };
}

describe('frequência pelas faltas', () => {
  it('calcula aulas previstas, frequência e descreve o horário', () => {
    expect(aulasPrevistas(80, 50)).toBe(96);
    expect(calcularFrequencia(6, 50, 80)).toBe(93.75); // 6 × 50 min = 5 h de 80 h
    expect(calcularFrequencia(0, 50, 80)).toBe(100);
    expect(calcularFrequencia(200, 50, 80)).toBe(0); // nunca negativa
    expect(descreverHorario('seg,qua', '19:00', '22:30')).toBe('Seg e Qua, 19:00 às 22:30');
    expect(descreverHorario('seg,qua,sex', null, null)).toBe('Seg, Qua e Sex');
    expect(descreverHorario(null, null, null)).toBeNull();
  });
});

/** Professor lotado na disciplina 1 (módulo 1) da turma fictícia. */
const LOTAR = `INSERT INTO funcionarios (id, nome, cpf) VALUES (1, 'Prof. Fictício', '52998224725');
  INSERT INTO funcionario_categorias VALUES (1, 'professor');
  INSERT INTO lotacoes (turma_id, componente_id, funcionario_id, data_inicio) VALUES (1, 1, 1, '2026-02-09');`;
const NOTAS = '/admin/notas?ano=2026&turma=1&modulo=1&disciplina=1';
const PED = '/admin/pedagogico/notas?ano=2026&turma=1&modulo=1&disciplina=1';
const TOTAL = '/admin/faltas/total?ano=2026&turma=1&modulo=1&disciplina=1';
const nota = (sqlite: any, m: number) => (sqlite.prepare('SELECT nota FROM resultados WHERE matricula_id = ? AND componente_id = 1').get(m) as any)?.nota;

describe('Notas: Gestão Pedagógica (coordenador) e Secretaria', () => {
  it('menu: Secretaria tem Notas e Faltas separados; coordenador lança em Gestão Pedagógica e não acessa a correção', async () => {
    const sec = await pronto('secretaria');
    const menu = await (await sec.c.req('/admin')).text();
    expect(menu).toContain('href="/admin/notas"');
    expect(menu).toContain('href="/admin/faltas"');
    expect(menu).toContain('href="/admin/pedagogico/notas"');
    expect((await sec.c.req('/admin/diario')).headers.get('Location')).toBe('/admin/notas');
    const coord = await pronto('coordenador');
    expect((await coord.c.req('/admin/notas')).status).toBe(403);
    expect((await coord.c.req('/admin/faltas')).status).toBe(403);
    expect((await coord.c.req(PED)).status).toBe(200);
  });

  it('nota só com professor lotado; todos os alunos da turma aparecem; vale a última digitação', async () => {
    const { c, sqlite } = await pronto('coordenador');
    let html = await (await c.req(PED)).text();
    expect(html).toContain('faça a <a');
    expect(html).toContain('sem lotação');
    let r = await c.post(PED, { o_nota_1: '8,5', nota_1: '9' });
    expect(msg(r)).toContain('Faça a lotação');
    sqlite.exec(LOTAR);
    html = await (await c.req(PED)).text();
    expect(html).toContain('Prof. Fictício');
    for (const n of ['Ana Beatriz Fictícia Souza', 'João Pedro Fictício Lima', 'Renata Fictícia Alves']) expect(html).toContain(n);

    // só o que mudou é gravado
    r = await c.post(PED, { o_nota_1: '8,5', nota_1: '8,5', o_nota_2: '7', nota_2: '7,5' });
    expect(msg(r)).toContain('1 aluno(s) atualizado(s)');
    expect(nota(sqlite, 1)).toBe(8.5);
    expect(nota(sqlite, 2)).toBe(7.5);
    // outra pessoa salvou 6 no aluno 1 depois que a tela foi aberta: quem não mexeu não desfaz
    sqlite.exec('UPDATE resultados SET nota = 6 WHERE matricula_id = 1 AND componente_id = 1');
    r = await c.post(PED, { o_nota_1: '8,5', nota_1: '8,5', o_nota_2: '7,5', nota_2: '8' });
    expect(nota(sqlite, 1)).toBe(6);
    expect(nota(sqlite, 2)).toBe(8);
    // e quem mexeu por último prevalece
    r = await c.post(PED, { o_nota_1: '8,5', nota_1: '9' });
    expect(nota(sqlite, 1)).toBe(9);
    // histórico com professor, usuário e origem
    const h = sqlite.prepare(`SELECT campo, valor_anterior, valor_novo, origem, professor_id, usuario FROM resultados_historico
                               WHERE matricula_id = 2 AND componente_id = 1 ORDER BY id`).all().map((x: any) => ({ ...x }));
    expect(h).toEqual([
      { campo: 'nota', valor_anterior: 7, valor_novo: 7.5, origem: 'professor', professor_id: 1, usuario: 'u@iect.test' },
      { campo: 'nota', valor_anterior: 7.5, valor_novo: 8, origem: 'professor', professor_id: 1, usuario: 'u@iect.test' },
    ]);
    // apagar um valor também é alteração
    await c.post(PED, { o_exame_3: '', exame_3: '5' });
    await c.post(PED, { o_exame_3: '5', exame_3: '' });
    expect((sqlite.prepare('SELECT nota_exame_final FROM resultados WHERE matricula_id = 3 AND componente_id = 1').get() as any).nota_exame_final).toBeNull();
  });

  it('matrícula não ativa: bloqueada na Gestão Pedagógica, corrigida só pela Secretaria', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    amb.sqlite.exec(LOTAR);
    await amb.criarUsuario('coord@iect.test', 'coordenador');
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const coord = amb.cliente(); await coord.entrar('coord@iect.test');
    const sec = amb.cliente(); await sec.entrar('sec@iect.test');
    // só a secretaria muda o status (com data e motivo; fica no histórico)
    expect((await coord.post('/admin/turmas/1/matriculas/2/status', { status: 'transferido', data: '2026-09-01', motivo: 'x' })).status).toBe(403);
    let r = await sec.post('/admin/turmas/1/matriculas/2/status', { status: 'transferido', data: '2026-09-01' });
    expect(msg(r)).toContain('Informe o motivo');
    r = await sec.post('/admin/turmas/1/matriculas/2/status', { status: 'transferido', data: '2026-09-01', motivo: 'Transferido para a Escola Exemplo' });
    expect(msg(r)).toContain('Status alterado para "Transferido"');
    expect(amb.sqlite.prepare('SELECT status_anterior, status_novo, data, motivo, usuario FROM matricula_status_historico').get())
      .toEqual({ status_anterior: 'ativa', status_novo: 'transferido', data: '2026-09-01', motivo: 'Transferido para a Escola Exemplo', usuario: 'sec@iect.test' });
    const turma = await (await sec.req('/admin/turmas/1')).text();
    expect(turma).toContain('Transferido');
    expect(turma).toContain('Transferido para a Escola Exemplo');

    // Gestão Pedagógica: aparece bloqueado e o que vier no formulário é ignorado
    const tela = await (await coord.req(PED)).text();
    expect(tela).toContain('só a Secretaria corrige');
    expect(tela).not.toContain('name="nota_2"');
    await coord.post(PED, { o_nota_2: '7', nota_2: '10' });
    expect(nota(amb.sqlite, 2)).toBe(7);
    // Secretaria corrige
    expect(await (await sec.req(NOTAS)).text()).toContain('name="nota_2"');
    r = await sec.post(NOTAS, { o_nota_2: '7', nota_2: '10' });
    expect(msg(r)).toContain('1 aluno(s) atualizado(s)');
    expect(nota(amb.sqlite, 2)).toBe(10);
  });

  it('Faltas → total por disciplina (sem chamada): tempo da aula, limite de aulas previstas e frequência', async () => {
    const { c, sqlite } = await pronto('secretaria');
    sqlite.exec(LOTAR);
    let r = await c.post(TOTAL, { o_faltas_1: '', faltas_1: '3' });
    expect(msg(r)).toContain('Informe o tempo de cada aula');
    r = await c.post(`/admin/faltas/total/tempo?ano=2026&turma=1&modulo=1&disciplina=1`, { duracao_aula_min: '50' });
    expect(msg(r)).toContain('Tempo das aulas salvo');
    expect(await (await c.req(TOTAL)).text()).toContain('Aulas previstas <b>96</b>');
    r = await c.post(TOTAL, { o_faltas_1: '', faltas_1: '97' });
    expect(msg(r)).toContain('o máximo é 96 aulas previstas');
    r = await c.post(TOTAL, { o_faltas_1: '', faltas_1: '6', o_faltas_3: '', faltas_3: '30' });
    expect(msg(r)).toContain('2 aluno(s) atualizado(s)');
    const res = (m: number) => sqlite.prepare('SELECT faltas, frequencia, resultado FROM resultados WHERE matricula_id = ? AND componente_id = 1').get(m);
    expect(res(1)).toEqual({ faltas: 6, frequencia: 93.75, resultado: 'AP' });
    expect(res(3)).toEqual({ faltas: 30, frequencia: 68.75, resultado: 'RP' }); // abaixo de 75%
    // mudar o tempo da aula recalcula a frequência de quem tem faltas
    await c.post(`/admin/faltas/total/tempo?ano=2026&turma=1&modulo=1&disciplina=1`, { duracao_aula_min: '40' });
    expect(res(1)).toMatchObject({ faltas: 6, frequencia: 95 });
  });

  it('módulo planejado não aparece para lançamento; a tela antiga da disciplina redireciona para Notas', async () => {
    const { c } = await pronto();
    const html = await (await c.req('/admin/notas?ano=2026&turma=1')).text();
    expect(html).toContain('2. Empreendedorismo (em andamento)'); // módulo 2 em andamento
    expect(html).not.toContain('3. Ambiente Organizacional'); // módulo 3 ainda planejado
    expect((await c.req('/admin/turmas/1/modulos/1/disciplinas/1')).headers.get('Location')).toBe('/admin/notas?turma=1&modulo=1&disciplina=1');
    expect(msg(await c.req('/admin/turmas/1/modulos/3/disciplinas/13'))).toContain('ainda está "planejado"');
  });
});

describe('portarias abaixo das assinaturas', () => {
  it('prévia do certificado mostra nome e portaria de nomeação dos signatários', async () => {
    const { c, sqlite } = await pronto();
    sqlite.exec(`UPDATE signatarios SET nome = 'Maria Diretora', portaria_tipo = 'Portaria', portaria_numero = '12/2025', portaria_data = '2025-02-03' WHERE id = 1;
                 UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`);
    const html = await (await c.req('/admin/previa/1/1')).text();
    expect(html).toContain('Maria Diretora');
    expect(html).toContain('Portaria nº 12/2025, de 03/02/2025');
    expect(html).toContain('portaria não cadastrada'); // secretário sem portaria fica destacado
  });
});

describe('prévias mostram QR code de exemplo', () => {
  it('certificado (tela de emissão e prévia) e declaração/histórico trazem o QR de exemplo', async () => {
    const { c } = await pronto();
    const emissao = await (await c.req('/admin/certificados/emitir/1/1')).text();
    expect(emissao).toContain('src="/admin/previa/1/1?embutida=1"');
    expect(emissao).toContain('Como vai ficar');
    const previa = await (await c.req('/admin/previa/1/1?embutida=1')).text();
    expect(previa).toContain('aria-label="QR code de exemplo"');
    expect(previa).toContain('INV-AAAA-NNNNN (QR de exemplo)');
    expect(previa).not.toContain('class="barra"');
    const doc = await (await c.req('/admin/documentos/declaracao_conclusao_modulo/1/1/previa')).text();
    expect(doc).toContain('aria-label="QR code de exemplo"');
    const tela = await (await c.req('/admin/documentos/historico_escolar/1/1')).text();
    expect(tela).toContain('Ver em tela');
  });
});
