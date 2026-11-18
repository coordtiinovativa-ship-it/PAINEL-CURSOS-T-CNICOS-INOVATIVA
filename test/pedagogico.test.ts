import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';
import { aulasPrevistasDoProfessor, classificarDia, diaDaSemana, feriadosNacionais, pascoa, type AnoLetivo } from '../src/lib/pedagogico';
import { sigla } from '../src/rotas/horario';

describe('sigla da disciplina no quadro de horário', () => {
  it('iniciais e numeral romano, como no sysGEP', () => {
    expect(sigla('Unidade Curricular Profissional III')).toBe('UCP-III');
    expect(sigla('Design Thinking')).toBe('DT');
    expect(sigla('Qualidade de Vida, Segurança e Saúde no Trabalho')).toBe('QVSS');
    expect(sigla('E-Commerce')).toBe('E-Commer');
  });
});

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

  it('classifica cada dia como no sysGEP (L, D, S, SL, F, NL) e a tela mostra os totais do período', async () => {
    const ano = { data_inicio: '2026-02-01', data_fim: '2026-12-18' };
    expect(classificarDia('2026-01-31', ano)).toBeNull(); // fora do ano letivo
    expect(classificarDia('2026-02-02', ano)).toBe('L'); // segunda
    expect(classificarDia('2026-02-07', ano)).toBe('S');
    expect(classificarDia('2026-02-08', ano)).toBe('D');
    expect(classificarDia('2026-02-28', ano, [{ tipo: 'dia_letivo_extra', descricao: 'Sábado letivo' }])).toBe('SL');
    expect(classificarDia('2026-04-21', ano, [{ tipo: 'feriado', descricao: 'Tiradentes' }])).toBe('F');
    expect(classificarDia('2026-02-16', ano, [{ tipo: 'ponto_facultativo', descricao: 'Carnaval' }])).toBe('NL');
    expect(classificarDia('2026-07-13', ano, [{ tipo: 'recesso', descricao: 'Recesso' }, { tipo: 'dia_letivo_extra', descricao: 'x' }])).toBe('NL'); // não letivo vence
    expect(classificarDia('2026-03-10', ano, [{ tipo: 'evento', descricao: 'Feira' }])).toBe('L');

    const { c, sqlite } = await pronto();
    const ano26 = sqlite.prepare('SELECT id FROM anos_letivos WHERE ano = 2026').get() as { id: number };
    await c.post(`/admin/pedagogico/calendario/${ano26.id}/eventos`, { tipo: 'dia_letivo_extra', data_inicio: '2026-02-28', descricao: 'Sábado letivo' });
    const html = await (await c.req('/admin/pedagogico/calendario?ano=2026')).text();
    expect(html).toContain('Fevereiro/2026');
    expect(html).toContain('Dezembro/2026');
    expect(html).toContain('Janeiro/2026'); // janeiro a dezembro, sempre
    expect(html).toMatch(/data-data="2026-01-05"[^>]*class="[^"]*fora-periodo|class="[^"]*fora-periodo[^"]*"[^>]*data-data="2026-01-05"/); // férias, esmaecido
    expect(html).toContain('<b>321</b> dias'); // 01/02 a 18/12
    expect(html).toContain('ainda não foi gerado');
    expect(html).toMatch(/data-data="2026-02-28"[^>]*>[\s\S]*?<small>SL<\/small>/);
    expect(html).toContain('Ver legendas do mês');
    expect(html).toContain('SÁBADO LETIVO');
    const mes = await (await c.req('/admin/pedagogico/calendario?ano=2026&vista=mes&mes=2')).text();
    expect(mes).toContain('mes-cal grande');
    expect(mes).toContain('Março ›');
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

  it('gera o calendário automaticamente e o responsável ajusta dia a dia (vale a última alteração)', async () => {
    const { c, sqlite, env } = await pronto();
    const ano = sqlite.prepare('SELECT * FROM anos_letivos WHERE ano = 2026').get() as unknown as AnoLetivo;
    const dia = (dados: Record<string, string>) => c.post(`/admin/pedagogico/calendario/${ano.id}/dia`, dados);
    const codigo = async (d: string) => {
      const html = await (await c.req('/admin/pedagogico/calendario?ano=2026')).text();
      return html.match(new RegExp(`data-data="${d}" data-codigo="(\\w+)"`))?.[1];
    };

    let r = await c.post(`/admin/pedagogico/calendario/${ano.id}/gerar`, {});
    expect(msg(r)).toContain('Calendário de 2026 gerado: 13 feriado(s)');
    expect(sqlite.prepare('SELECT calendario_gerado_em FROM anos_letivos WHERE id = ?').get(ano.id)).toMatchObject({ calendario_gerado_em: expect.any(String) });
    expect(await codigo('2026-04-21')).toBe('F'); // Tiradentes
    expect(await codigo('2026-01-05')).toBe('NL'); // janeiro, fora do período: férias

    // segunda letiva vira não letiva (reunião), com descrição obrigatória
    r = await dia({ data: '2026-03-09', codigo: 'NL', descricao: '' });
    expect(msg(r)).toContain('Informe a descrição');
    r = await dia({ data: '2026-03-09', codigo: 'NL', descricao: 'Reunião pedagógica' });
    expect(msg(r)).toContain('09/03/2026 agora é NL');
    expect(await codigo('2026-03-09')).toBe('NL');
    // sábado vira letivo; código de sábado não serve para segunda
    r = await dia({ data: '2026-03-14', codigo: 'SL', descricao: 'Reposição' });
    expect(await codigo('2026-03-14')).toBe('SL');
    r = await dia({ data: '2026-03-10', codigo: 'SL', descricao: 'x' });
    expect(msg(r)).toContain('Escolha um código válido');
    // fora do período do ano letivo não pode ser letivo
    r = await dia({ data: '2026-01-10', codigo: 'SL', descricao: 'x' });
    expect(msg(r)).toContain('fora do período do ano letivo');
    // feriado vira letivo (L) sem descrição; e volta ao automático
    r = await dia({ data: '2026-04-21', codigo: 'L', descricao: '' });
    expect(await codigo('2026-04-21')).toBe('L');
    r = await dia({ data: '2026-04-21', acao: 'automatico' });
    expect(msg(r)).toContain('voltou ao automático (F');
    expect(await codigo('2026-04-21')).toBe('F');

    // a chamada usa os ajustes: segunda 09/03 sai, sábado 14/03 entra
    const evs = (await import('../src/lib/pedagogico')).eventosPorDia;
    const porDia = await evs(env.DB, ano.id);
    expect(classificarDia('2026-03-09', ano, porDia.get('2026-03-09'))).toBe('NL');
    expect(classificarDia('2026-03-14', ano, porDia.get('2026-03-14'))).toBe('SL');

    // incluir um período depois substitui o ajuste à mão desses dias
    r = await c.post(`/admin/pedagogico/calendario/${ano.id}/eventos`, { tipo: 'recesso', data_inicio: '2026-03-13', data_fim: '2026-03-14', descricao: 'Recesso' });
    expect(msg(r)).toContain('1 ajuste(s) à mão nesses dias foram substituídos');
    expect(await codigo('2026-03-14')).toBe('NL');
    // gerar de novo descartando os ajustes
    r = await c.post(`/admin/pedagogico/calendario/${ano.id}/gerar`, { descartar: '1' });
    expect(msg(r)).toContain('1 ajuste(s) à mão descartado(s)');
    expect(await codigo('2026-03-09')).toBe('L');

    // ano letivo novo já nasce com o calendário gerado
    r = await c.post('/admin/pedagogico/anos', { ano: '2027', data_inicio: '2027-02-01', data_fim: '2027-12-17', situacao: 'aberto' });
    expect(msg(r)).toContain('Ano letivo 2027 cadastrado e calendário gerado (13 feriado(s)');
    expect(sqlite.prepare("SELECT count(*) AS n FROM calendario_eventos e JOIN anos_letivos a ON a.id = e.ano_letivo_id WHERE a.ano = 2027").get()).toEqual({ n: 13 });
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
    const { c, sqlite, env, professor, criarUsuario, cliente } = await pronto();
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

    // horário (quadro de arrastar → API): segunda, 1º tempo (19:00–19:45); a turma não pode ter duas aulas no mesmo tempo
    const api = async (prof: number, dados: Record<string, string>) =>
      (await c.post(`/admin/pedagogico/horario/api?ano=2026&prof=${prof}`, dados)).json() as Promise<any>;
    let j = await api(lucas, { acao: 'incluir', lotacao_id: String(lotLucas), dia: '1', tempo: '1' });
    expect(j.msg).toContain('Design Thinking: Segunda, 1º tempo');
    expect(j.estado.aulas).toEqual([{ id: expect.any(Number), lotacao_id: lotLucas, dia: 1, tempo: 1, turno: 'noturno' }]);
    expect(j.estado.lots[0]).toMatchObject({ componente: 'Design Thinking', sigla: 'DT', aulas: 1, ch: 80 });
    expect(j.estado.lots[0].horas).toBeGreaterThan(0); // horas cobertas pela grade até o fim do módulo/ano
    j = await api(ana, { acao: 'incluir', lotacao_id: String(lotAna), dia: '1', tempo: '1' });
    expect(j.erro).toContain('A turma TIDC-2026-1 já tem Design Thinking nesse dia e tempo');
    j = await api(lucas, { acao: 'incluir', lotacao_id: String(lotLucas), dia: '1', tempo: '9' });
    expect(j.erro).toContain('não tem o tempo 9');
    j = await api(ana, { acao: 'incluir', lotacao_id: String(lotLucas), dia: '2', tempo: '1' });
    expect(j.erro).toContain('não está lotada para este professor');
    // mover (arrastar a aula) e remover (soltar no painel / dois cliques)
    j = await api(ana, { acao: 'incluir', lotacao_id: String(lotAna), dia: '2', tempo: '2' });
    const aulaAna = j.estado.aulas[0].id as number;
    j = await api(ana, { acao: 'mover', aula_id: String(aulaAna), dia: '1', tempo: '1' });
    expect(j.erro).toContain('já tem Design Thinking'); // choque na turma ao mover
    j = await api(ana, { acao: 'mover', aula_id: String(aulaAna), dia: '3', tempo: '2' });
    expect(j.msg).toContain('movida para Quarta, 2º tempo');
    j = await api(lucas, { acao: 'remover', aula_id: String(aulaAna) });
    expect(j.erro).toContain('não encontrada na grade deste professor'); // aula de outro professor
    j = await api(ana, { acao: 'remover', aula_id: String(aulaAna) });
    expect(j.msg).toContain('retirada do horário');
    expect(j.estado.aulas).toEqual([]);
    const grade = await (await c.req(`/admin/pedagogico/horario?ano=2026&prof=${lucas}`)).text();
    expect(grade).toContain('id="quadro"');
    expect(grade).toContain('"turma":"TIDC-2026-1"');
    expect(grade).toContain('"hora_inicio":"19:00"');

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

    // aula de sábado no horário: só entra na chamada no sábado marcado como dia letivo (SL) no calendário
    j = await api(ana, { acao: 'incluir', lotacao_id: String(lotAna), dia: '6', tempo: '1' });
    const aulaSab = j.estado.aulas[0].id as number;
    expect((await aulasPrevistasDoProfessor(env.DB, ana, ano, '2026-09-30')).map((a) => a.data)).toEqual([]);
    await c.post(`/admin/pedagogico/calendario/${ano.id}/eventos`, { tipo: 'dia_letivo_extra', data_inicio: '2026-08-08', descricao: 'Sábado letivo' });
    expect((await aulasPrevistasDoProfessor(env.DB, ana, ano, '2026-09-30')).map((a) => a.data)).toEqual(['2026-08-08']);
    await api(ana, { acao: 'remover', aula_id: String(aulaSab) });

    // chamada de 03/08: aluno da matrícula 1 faltou ao 1º tempo (45 min)
    const ch = await (await c.req(`/admin/pedagogico/faltas?ano=2026&prof=${lucas}&data=2026-08-03`)).text();
    expect(ch).toContain('Turma TIDC-2026-1');
    expect(ch).toContain('Ana Beatriz Fictícia Souza');
    const CH = `/admin/pedagogico/faltas?ano=2026&prof=${lucas}&data=2026-08-03`;
    r = await c.post(CH, { aula: '1:1', falta_1_1_1: '1' }); // aula nova: grava o estado inteiro
    expect(msg(r)).toContain('1 aula(s), 1 alteração(ões)');
    const res = (m: number) => sqlite.prepare('SELECT faltas, frequencia FROM resultados WHERE matricula_id = ? AND componente_id = 7').get(m);
    expect(res(1)).toEqual({ faltas: 1, frequencia: 99.06 }); // 100 × (1 − 0,75 h ÷ 80 h)
    expect(res(2)).toEqual({ faltas: 0, frequencia: 100 });
    expect(sqlite.prepare('SELECT origem, professor_id, atualizado_por FROM resultados WHERE matricula_id = 1 AND componente_id = 7').get())
      .toEqual({ origem: 'chamada', professor_id: lucas, atualizado_por: 'coord@iect.test' });
    // aula fora da grade não é aceita
    r = await c.post(`/admin/pedagogico/faltas?ano=2026&prof=${lucas}&data=2026-08-04`, { aula: '1:1' });
    expect(msg(r)).toContain('Nenhuma aula prevista');
    // tirar a falta (célula mostrada como F, enviada como P)
    await c.post(CH, { aula: '1:1', o_falta_1_1_1: '1', o_falta_1_1_2: '0', o_falta_1_1_3: '0' });
    expect(res(1)).toEqual({ faltas: 0, frequencia: 100 });
    // vale a última digitação: tela aberta com o aluno 1 presente; enquanto isso a secretaria marcou falta no aluno 2;
    // o professor marca falta no aluno 1 e salva sem mexer no aluno 2 → as duas faltas ficam
    const SEC = `/admin/faltas?ano=2026&turma=1&data=2026-08-03`;
    sqlite.exec(`INSERT INTO faltas_aula (aula_id, matricula_id) SELECT id, 2 FROM aulas WHERE turma_id = 1 AND data = '2026-08-03' AND tempo = 1`);
    await c.post(CH, { aula: '1:1', o_falta_1_1_1: '0', falta_1_1_1: '1', o_falta_1_1_2: '0', o_falta_1_1_3: '0' });
    expect(res(1)).toEqual({ faltas: 1, frequencia: 99.06 });
    expect(res(2)).toEqual({ faltas: 1, frequencia: 99.06 }); // a falta lançada pela outra pessoa não foi desfeita
    // Secretaria → Faltas (por turma e dia) corrige; coordenador não acessa
    expect((await c.req(SEC)).status).toBe(403);
    await criarUsuario('sec@iect.test', 'secretaria');
    const sec = cliente(); await sec.entrar('sec@iect.test');
    const telaSec = await (await sec.req(SEC)).text();
    expect(telaSec).toContain('Lucas Fictício Nunes'); // professor da aula aparece para a secretaria
    r = await sec.post(SEC, { aula: '1:1', o_falta_1_1_2: '1' }); // tirou a falta do aluno 2
    expect(msg(r)).toContain('1 alteração(ões)');
    expect(res(2)).toEqual({ faltas: 0, frequencia: 100 });
    expect(sqlite.prepare('SELECT origem, atualizado_por FROM resultados WHERE matricula_id = 2 AND componente_id = 7').get())
      .toEqual({ origem: 'secretaria', atualizado_por: 'sec@iect.test' });

    // aluno com matrícula não ativa: bloqueado na chamada do professor (falta enviada é ignorada); a secretaria corrige
    sqlite.exec(`UPDATE matriculas SET status = 'transferido' WHERE id = 3`);
    const telaProf = await (await c.req(CH)).text();
    expect(telaProf).toContain('só a Secretaria corrige');
    expect(telaProf).not.toContain('name="falta_1_1_3"');
    await c.post(CH, { aula: '1:1', o_falta_1_1_3: '0', falta_1_1_3: '1' });
    expect(res(3)).toEqual({ faltas: 0, frequencia: 100 });
    expect(await (await sec.req(SEC)).text()).toContain('name="falta_1_1_3"');
    await sec.post(SEC, { aula: '1:1', o_falta_1_1_3: '0', falta_1_1_3: '1' });
    expect(res(3)).toEqual({ faltas: 1, frequencia: 99.06 });

    // Notas (Gestão Pedagógica): professor da lotação; faltas vêm da chamada (só leitura); nota vinculada ao professor
    const NT = '/admin/pedagogico/notas?ano=2026&turma=1&modulo=2&disciplina=7';
    const telaNotas = await (await c.req(NT)).text();
    expect(telaNotas).toContain('Lucas Fictício Nunes');
    expect(telaNotas).toContain('da chamada (1 aula(s))');
    expect(telaNotas).not.toContain('name="faltas_1"');
    r = await c.post(NT, { o_nota_1: '', nota_1: '8', faltas_1: '30' });
    expect(res(1)).toEqual({ faltas: 1, frequencia: 99.06 }); // faltas no formulário são ignoradas
    expect(sqlite.prepare('SELECT nota, professor_id FROM resultados WHERE matricula_id = 1 AND componente_id = 7').get()).toEqual({ nota: 8, professor_id: lucas });

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
