import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';
import { aulasPrevistas, calcularFrequencia, descreverHorario } from '../src/lib/frequencia';

const URL = '/admin/diario/1/1/1'; // turma 1, módulo 1, disciplina 1 (Atendimento a Clientes e Fornecedores, 80 h)
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

describe('Secretaria → Notas e Faltas', () => {
  it('lista turmas e módulos; módulo planejado não abre lançamento', async () => {
    const { c } = await pronto();
    const html = await (await c.req('/admin/diario')).text();
    expect(html).toContain('Notas e faltas');
    expect(html).toContain('TIDC-2026-1');
    expect(html).toContain('href="/admin/diario/1/1"');
    expect(html).toContain('href="/admin/diario/1/2"'); // módulo 2 em andamento
    expect(html).not.toContain('href="/admin/diario/1/3"'); // módulo 3 ainda planejado
    expect(await (await c.req('/admin/diario/1/1')).text()).toContain('Atendimento a Clientes e Fornecedores');
  });

  it('salva professor, dias, horário e tempo da aula; lança faltas e calcula a frequência', async () => {
    const { c, sqlite, auditoria } = await pronto();
    let r = await c.post(`${URL}/dados`, { professor: 'Prof. Fictício', dias: 'seg,qua', hora_inicio: '19:00', hora_fim: '22:30', duracao_aula_min: '50' });
    expect(msg(r)).toContain('Professor, horário e tempo das aulas salvos');
    expect(sqlite.prepare('SELECT professor, dias_semana, hora_inicio, hora_fim, duracao_aula_min FROM turma_disciplinas').get())
      .toEqual({ professor: 'Prof. Fictício', dias_semana: 'seg,qua', hora_inicio: '19:00', hora_fim: '22:30', duracao_aula_min: 50 });

    const tela = await (await c.req(URL)).text();
    expect(tela).toContain('Aulas previstas <b>96</b>');

    r = await c.post(URL, { faltas_1: '6', faltas_3: '30', nota_3: '9,5' });
    expect(msg(r)).toContain('2 aluno(s) atualizado(s)');
    const res = (m: number) => sqlite.prepare('SELECT faltas, frequencia, nota, resultado FROM resultados WHERE matricula_id = ? AND componente_id = 1').get(m);
    expect(res(1)).toEqual({ faltas: 6, frequencia: 93.75, nota: 8.5, resultado: 'AP' });
    expect(res(3)).toEqual({ faltas: 30, frequencia: 68.75, nota: 9.5, resultado: 'RP' }); // abaixo de 75%
    expect(res(2)).toMatchObject({ faltas: null, frequencia: 80 }); // vazio não altera
    expect(auditoria().map((a) => a.acao)).toEqual(expect.arrayContaining(['atualizar_disciplina_turma', 'lancar_notas_faltas']));

    // mudar o tempo da aula recalcula a frequência de quem tem faltas
    await c.post(`${URL}/dados`, { professor: 'Prof. Fictício', duracao_aula_min: '40' });
    expect(res(1)).toMatchObject({ frequencia: 95 }); // 6 × 40 min = 4 h de 80 h
  });

  it('valida faltas acima das aulas previstas, notas fora de 0–10 e exige o tempo da aula', async () => {
    const { c, sqlite } = await pronto('coordenador');
    let r = await c.post(URL, { faltas_1: '3' });
    expect(msg(r)).toContain('Informe o tempo de cada aula');
    await c.post(`${URL}/dados`, { professor: 'Prof. Fictício', duracao_aula_min: '50' });
    r = await c.post(URL, { faltas_1: '97' });
    expect(msg(r)).toContain('o máximo é 96 aulas previstas');
    r = await c.post(URL, { nota_1: '11' });
    expect(msg(r)).toContain('fora do intervalo 0–10');
    expect(sqlite.prepare('SELECT faltas FROM resultados WHERE matricula_id = 1 AND componente_id = 1').get()).toEqual({ faltas: null });
    r = await c.post(`${URL}/dados`, { professor: '', duracao_aula_min: '50' });
    expect(msg(r)).toContain('Informe o nome do professor');
  });

  it('módulo planejado não aceita lançamento; tela antiga da disciplina redireciona ao diário', async () => {
    const { c } = await pronto();
    const r = await c.post('/admin/diario/1/3/13', { nota_1: '8' });
    expect(msg(r)).toContain('ainda está planejado');
    const antiga = await c.req('/admin/turmas/1/modulos/1/disciplinas/1');
    expect(antiga.headers.get('Location')).toBe('/admin/diario/1/1/1');
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
