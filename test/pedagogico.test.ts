import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';
import { aulasPrevistasDoProfessor, diaDaSemana, feriadosNacionais, pascoa, type AnoLetivo } from '../src/lib/pedagogico';

const msg = (r: Response) => decodeURIComponent(r.headers.get('Location') ?? '');
const QS = '?ano=2026&turma=1&modulo=2';
// Turma fictícia TIDC-2026-1 (noturno): módulo 2 em andamento desde 03/08/2026; disciplina 7 = Design Thinking (80 h)

async function pronto() {
  const amb = await criarAmbiente({ ficticios: true });
  await amb.criarUsuario('coord@iect.test', 'coordenador');
  const c = amb.cliente();
  await c.entrar('coord@iect.test');
  const professor = async (nome: string, cpf: string) => {
    const r = await c.post('/admin/pedagogico/funcionarios/novo', { nome, cpf, categorias: 'professor', ativo: '1' });
    expect(r.status).toBe(302);
    return (amb.sqlite.prepare('SELECT id FROM funcionarios WHERE nome = ?').get(nome) as { id: number }).id;
  };
  return { ...amb, c, professor };
}

describe('calendário', () => {
  it('Páscoa e feriados nacionais calculados; dias da semana', () => {
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
    const f = feriadosNacionais(2026);
    expect(f.find((x) => x.descricao === 'Sexta-feira Santa')?.data).toBe('2026-04-03');
    expect(f.filter((x) => x.descricao === 'Carnaval').map((x) => x.data)).toEqual(['2026-02-16', '2026-02-17']);
    expect(f.find((x) => x.descricao === 'Corpus Christi')?.data).toBe('2026-06-04');
    expect(f).toHaveLength(13);
    expect(diaDaSemana('2026-08-03')).toBe(1); // segunda
    expect(diaDaSemana('2026-09-07')).toBe(1); // Independência cai numa segunda
    expect(diaDaSemana('2026-11-22')).toBe(7); // domingo
  });

  it('ano letivo e calendário: inclui feriados nacionais sem repetir, conta dias letivos e exclui evento', async () => {
    const { c, sqlite } = await pronto();
    expect(await (await c.req('/admin/pedagogico/anos')).text()).toContain('2026');
    const ano = sqlite.prepare('SELECT id FROM anos_letivos WHERE ano = 2026').get() as { id: number };
    let r = await c.post(`/admin/pedagogico/calendario/${ano.id}/feriados`, {});
    expect(msg(r)).toContain('13 feriado(s)');
    r = await c.post(`/admin/pedagogico/calendario/${ano.id}/feriados`, {});
    expect(msg(r)).toContain('0 feriado(s)');
    r = await c.post(`/admin/pedagogico/calendario/${ano.id}/eventos`, { tipo: 'recesso', data_inicio: '2026-07-13', data_fim: '2026-07-24', descricao: 'Recesso de julho' });
    expect(msg(r)).toContain('Incluído');
    const cal = await (await c.req('/admin/pedagogico/calendario?ano=2026')).text();
    expect(cal).toContain('Recesso de julho');
    expect(cal).toContain('Tiradentes');
    r = await c.post(`/admin/pedagogico/calendario/${ano.id}/eventos`, { tipo: 'feriado', data_inicio: '2026-05-10', data_fim: '2026-05-01', descricao: 'x' });
    expect(msg(r)).toContain('O término deve ser igual ou depois do início');
  });
});

describe('funcionários', () => {
  it('cadastra professor, valida CPF e categoria, impede CPF repetido e inativar com lotação ativa', async () => {
    const { c, sqlite, professor } = await pronto();
    let r = await c.post('/admin/pedagogico/funcionarios/novo', { nome: 'Fulano', cpf: '123', categorias: 'professor' });
    expect(await r.text()).toContain('CPF inválido');
    r = await c.post('/admin/pedagogico/funcionarios/novo', { nome: 'Fulano', cpf: '529.982.247-25' });
    expect(await r.text()).toContain('Marque ao menos uma categoria');
    const id = await professor('Lucas Fictício Nunes', '529.982.247-25');
    r = await c.post('/admin/pedagogico/funcionarios/novo', { nome: 'Outro', cpf: '52998224725', categorias: 'professor' });
    expect(await r.text()).toContain('CPF já cadastrado para Lucas Fictício Nunes');
    expect(await (await c.req('/admin/pedagogico/funcionarios')).text()).toContain('Lucas Fictício Nunes');

    await c.post(`/admin/pedagogico/lotacao/atribuir${QS}`, { turma_id: '1', componente_id: '7', funcionario_id: String(id), data_inicio: '2026-08-03' });
    r = await c.post(`/admin/pedagogico/funcionarios/${id}`, { nome: 'Lucas Fictício Nunes', cpf: '52998224725', categorias: 'professor' }); // sem "ativo"
    expect(await r.text()).toContain('lotação(ões) ativa(s)');
    expect((sqlite.prepare('SELECT ativo FROM funcionarios WHERE id = ?').get(id) as any).ativo).toBe(1);
  });
});

describe('lotação → horário → chamada → notas e faltas', () => {
  it('fluxo completo, com regras de choque, calendário e recálculo da frequência', async () => {
    const { c, sqlite, env, professor } = await pronto();
    const lucas = await professor('Lucas Fictício Nunes', '529.982.247-25');
    const ana = await professor('Ana Fictícia Prado', '111.444.777-35');

    // lotação: uma ativa por disciplina
    let r = await c.post(`/admin/pedagogico/lotacao/atribuir${QS}`, { turma_id: '1', componente_id: '7', funcionario_id: String(lucas), data_inicio: '2026-08-03' });
    expect(msg(r)).toContain('Lucas Fictício Nunes atribuído(a) a Design Thinking');
    r = await c.post(`/admin/pedagogico/lotacao/atribuir${QS}`, { turma_id: '1', componente_id: '7', funcionario_id: String(ana), data_inicio: '2026-08-03' });
    expect(msg(r)).toContain('já tem professor');
    r = await c.post(`/admin/pedagogico/lotacao/atribuir${QS}`, { turma_id: '1', componente_id: '8', funcionario_id: String(ana), data_inicio: '2026-08-03' });
    expect(msg(r)).toContain('Ana Fictícia Prado atribuído(a) a Educação Financeira');
    const lotLucas = (sqlite.prepare('SELECT id FROM lotacoes WHERE funcionario_id = ?').get(lucas) as { id: number }).id;
    const lotAna = (sqlite.prepare('SELECT id FROM lotacoes WHERE funcionario_id = ?').get(ana) as { id: number }).id;
    const tela = await (await c.req(`/admin/pedagogico/lotacao${QS}`)).text();
    expect(tela).toContain('Lucas Fictício Nunes');
    expect(tela).toContain('sem professor'); // demais disciplinas do módulo

    // horário: segunda, 1º tempo (19:00–19:45); a turma não pode ter duas aulas no mesmo tempo
    r = await c.post(`/admin/pedagogico/horario?ano=2026&prof=${lucas}`, { lotacao_id: String(lotLucas), incluir: '1:1' });
    expect(msg(r)).toContain('Aula incluída: Segunda, 1º tempo');
    r = await c.post(`/admin/pedagogico/horario?ano=2026&prof=${ana}`, { lotacao_id: String(lotAna), incluir: '1:1' });
    expect(msg(r)).toContain('A turma TIDC-2026-1 já tem Design Thinking nesse dia e tempo');
    r = await c.post(`/admin/pedagogico/horario?ano=2026&prof=${lucas}`, { lotacao_id: String(lotLucas), incluir: '1:9' });
    expect(msg(r)).toContain('não tem o tempo 9');
    const grade = await (await c.req(`/admin/pedagogico/horario?ano=2026&prof=${lucas}`)).text();
    expect(grade).toContain('TIDC-2026-1');
    expect(grade).toContain('19:00–19:45');

    // datas de aula: segundas desde 03/08, sem o feriado de 07/09 (depois de incluir no calendário)
    const ano = sqlite.prepare('SELECT * FROM anos_letivos WHERE ano = 2026').get() as unknown as AnoLetivo;
    let datas = (await aulasPrevistasDoProfessor(env.DB, lucas, ano, '2026-09-30')).map((a) => a.data);
    expect(datas).toContain('2026-09-07');
    await c.post(`/admin/pedagogico/calendario/${ano.id}/feriados`, {});
    datas = (await aulasPrevistasDoProfessor(env.DB, lucas, ano, '2026-09-30')).map((a) => a.data);
    expect(datas[0]).toBe('2026-08-03');
    expect(datas).not.toContain('2026-09-07');
    expect(datas.every((d) => diaDaSemana(d) === 1)).toBe(true);
    expect(datas).toHaveLength(8); // 03, 10, 17, 24, 31/08 · 14, 21, 28/09

    // chamada de 03/08: aluno da matrícula 1 faltou ao 1º tempo (45 min)
    const ch = await (await c.req(`/admin/pedagogico/faltas?ano=2026&prof=${lucas}&data=2026-08-03`)).text();
    expect(ch).toContain('Turma TIDC-2026-1');
    expect(ch).toContain('Ana Beatriz Fictícia Souza');
    r = await c.post(`/admin/pedagogico/faltas?ano=2026&prof=${lucas}&data=2026-08-03`, { aula: '1:1', falta_1_1_1: '1' });
    expect(msg(r)).toContain('1 aula(s), 1 falta(s)');
    const res = (m: number) => sqlite.prepare('SELECT faltas, frequencia FROM resultados WHERE matricula_id = ? AND componente_id = 7').get(m);
    expect(res(1)).toEqual({ faltas: 1, frequencia: 99.06 }); // 100 × (1 − 0,75 h ÷ 80 h)
    expect(res(2)).toEqual({ faltas: 0, frequencia: 100 });
    // aula fora da grade não é aceita
    r = await c.post(`/admin/pedagogico/faltas?ano=2026&prof=${lucas}&data=2026-08-04`, { aula: '1:1' });
    expect(msg(r)).toContain('Nenhuma aula prevista');
    // regravar a chamada sem a falta zera
    await c.post(`/admin/pedagogico/faltas?ano=2026&prof=${lucas}&data=2026-08-03`, { aula: '1:1' });
    expect(res(1)).toEqual({ faltas: 0, frequencia: 100 });
    await c.post(`/admin/pedagogico/faltas?ano=2026&prof=${lucas}&data=2026-08-03`, { aula: '1:1', falta_1_1_1: '1' });

    // Notas e Faltas: professor da lotação, horário da grade, faltas da chamada (não digitáveis)
    const lista = await (await c.req('/admin/diario/1/2')).text();
    expect(lista).toContain('Lucas Fictício Nunes');
    expect(lista).toContain('Seg 1º');
    expect(lista).toContain('45 min');
    const disc = await (await c.req('/admin/diario/1/2/7')).text();
    expect(disc).toContain('vêm da <a href="/admin/pedagogico/faltas">chamada</a>');
    expect(disc).not.toContain('name="faltas_1"');
    r = await c.post('/admin/diario/1/2/7', { faltas_1: '30', nota_1: '8' });
    expect(res(1)).toEqual({ faltas: 1, frequencia: 99.06 }); // faltas digitadas ignoradas
    expect((sqlite.prepare('SELECT nota FROM resultados WHERE matricula_id = 1 AND componente_id = 7').get() as any).nota).toBe(8);

    // trocar professor: encerra a lotação, abre outra e passa o horário
    r = await c.post(`/admin/pedagogico/lotacao/${lotLucas}/trocar${QS}`, { funcionario_id: String(ana), data: '2026-09-14', motivo: 'licença' });
    expect(msg(r)).toContain('Design Thinking: Ana Fictícia Prado a partir de 14/09/2026');
    expect(sqlite.prepare('SELECT data_fim, motivo_fim FROM lotacoes WHERE id = ?').get(lotLucas)).toEqual({ data_fim: '2026-09-13', motivo_fim: 'Troca: licença' });
    const nova = sqlite.prepare('SELECT l.id FROM lotacoes l WHERE l.componente_id = 7 AND l.data_fim IS NULL AND l.funcionario_id = ?').get(ana) as { id: number };
    expect(sqlite.prepare('SELECT dia_semana, tempo FROM horario_aulas WHERE lotacao_id = ?').all(nova.id)).toEqual([{ dia_semana: 1, tempo: 1 }]);
    // datas do professor antigo param na véspera da troca; as da nova professora começam nela
    const doLucas = (await aulasPrevistasDoProfessor(env.DB, lucas, ano, '2026-09-30')).map((a) => a.data);
    expect(doLucas.at(-1)).toBe('2026-08-31');
    const daAna = (await aulasPrevistasDoProfessor(env.DB, ana, ano, '2026-09-30')).filter((a) => a.componente_id === 7).map((a) => a.data);
    expect(daAna).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
    expect(await (await c.req(`/admin/pedagogico/lotacao${QS}`)).text()).toContain('Troca: licença');
  });

  it('menu Gestão Pedagógica aparece para os perfis e as telas abrem', async () => {
    const { c } = await pronto();
    const inicio = await (await c.req('/admin')).text();
    expect(inicio).toContain('Gestão Pedagógica');
    for (const u of ['/admin/pedagogico/funcionarios', '/admin/pedagogico/lotacao', '/admin/pedagogico/horario', '/admin/pedagogico/horario/tempos',
      '/admin/pedagogico/faltas', '/admin/pedagogico/anos', '/admin/pedagogico/calendario']) {
      expect((await c.req(u)).status, u).toBe(200);
    }
  });
});

describe('dados fictícios do ambiente local', () => {
  it('seed/dev_pedagogico.sql carrega sobre os alunos fictícios e gera aulas previstas', async () => {
    const { readFileSync } = await import('node:fs');
    const amb = await criarAmbiente({ ficticios: true });
    amb.sqlite.exec(readFileSync('seed/dev_pedagogico.sql', 'utf8'));
    const ano = amb.sqlite.prepare('SELECT * FROM anos_letivos WHERE ano = 2026').get() as unknown as AnoLetivo;
    const aulas = await aulasPrevistasDoProfessor(amb.env.DB, 1, ano, '2026-08-31');
    expect(aulas.length).toBeGreaterThan(0);
    expect(aulas.some((a) => a.data === '2026-08-26')).toBe(false); // feriado municipal de exemplo (quarta) — Lucas só dá aula às segundas
    expect(aulas.every((a) => a.data >= '2026-08-03')).toBe(true);
  });
});
