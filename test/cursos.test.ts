import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';

const SIG = `UPDATE signatarios SET nome = 'Maria Diretora' WHERE id = 1; UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`;

async function admin() {
  const amb = await criarAmbiente({ ficticios: true });
  amb.sqlite.exec(SIG);
  await amb.criarUsuario('adm@iect.test', 'administrador');
  const c = amb.cliente();
  await c.entrar('adm@iect.test');
  return { ...amb, c };
}
const msg = (r: Response) => decodeURIComponent(r.headers.get('Location') ?? '');

/** Cadastra o curso B completo pelas telas: dados, ato de autorização, matriz com 1 módulo e 2 disciplinas. */
async function cursoB(c: any, sqlite: any) {
  let r = await c.post('/admin/cursos/novo', {
    nome: 'Curso Técnico em Logística', tipo: 'Curso Técnico', nivel: 'Educação Profissional Técnica de nível médio',
    eixo_id: '4', area_tecnologica: 'Logística', carga_horaria_total: '200', ativo: '1', cbos: '3418-05 - Técnico em logística',
  });
  const id = Number(/\/admin\/cursos\/(\d+)/.exec(msg(r))![1]);
  r = await c.post('/admin/instituicao/atos/novo', {
    dono: `curso:${id}`, finalidade: 'autorizacao_curso', tipo: 'Deliberação', numero: '14.500', data: '2025-08-20',
    orgao_emissor: 'Conselho Estadual de Educação de Mato Grosso do Sul - CEE/MS',
  });
  expect(msg(r)).toContain(`/admin/cursos/${id}`);
  r = await c.post(`/admin/cursos/${id}/matrizes`, {});
  const mid = Number(/\/matrizes\/(\d+)/.exec(msg(r))![1]);
  await c.post(`/admin/cursos/${id}/matrizes/${mid}/modulos`, { ordem: '1', nome: 'Armazenagem', carga_horaria: '200', qualificacao_conferida: 'Auxiliar de Armazenagem', tem_terminalidade: '1' });
  const mod = (sqlite.prepare('SELECT id FROM modulos_tematicos WHERE matriz_id = ?').get(mid) as any).id;
  await c.post(`/admin/cursos/${id}/matrizes/${mid}/componentes`, { modulo_id: String(mod), nome: 'Gestão de Estoques', carga_horaria_teorica: '60', carga_horaria_pratica: '40' });
  await c.post(`/admin/cursos/${id}/matrizes/${mid}/componentes`, { modulo_id: String(mod), nome: 'Movimentação de Cargas', carga_horaria_total: '100' });
  return { id, mid, mod };
}

/** Turma do curso B com a aluna fictícia Ana aprovada no módulo. */
function turmaB(sqlite: any, cursoId: number, mid: number, mod: number) {
  sqlite.exec(`INSERT INTO turmas (id, curso_id, matriz_id, codigo, data_inicio, data_fim, ano_letivo) VALUES (10, ${cursoId}, ${mid}, 'LOG-2026-1', '2026-03-01', '2026-11-30', 2026);
               INSERT INTO matriculas (id, aluno_id, turma_id) VALUES (10, 1, 10);
               INSERT INTO turma_modulos (turma_id, modulo_id, data_inicio, data_fim, situacao) VALUES (10, ${mod}, '2026-03-01', '2026-11-30', 'concluido');`);
  for (const comp of sqlite.prepare('SELECT id FROM componentes_curriculares WHERE modulo_id = ?').all(mod) as any[]) {
    sqlite.prepare('INSERT INTO resultados (matricula_id, componente_id, nota, frequencia) VALUES (10, ?, 9, 100)').run(comp.id);
  }
}

/** O texto do certificado tem trechos em negrito (<b>); compara só o texto. */
const semTags = (h: string) => h.replace(/<\/?b>/g, '');

describe('vários cursos', () => {
  it('cadastra curso, ato, matriz e componentes pelas telas (com CBO e auditoria)', async () => {
    const { c, sqlite, auditoria } = await admin();
    const { id, mid } = await cursoB(c, sqlite);
    expect(sqlite.prepare('SELECT nome, carga_horaria_total, eixo_id FROM cursos WHERE id = ?').get(id)).toEqual({ nome: 'Curso Técnico em Logística', carga_horaria_total: 200, eixo_id: 4 });
    expect(sqlite.prepare('SELECT codigo, descricao FROM curso_cbos WHERE curso_id = ?').get(id)).toEqual({ codigo: '3418-05', descricao: 'Técnico em logística' });
    const comps = sqlite.prepare('SELECT nome, carga_horaria_teorica, carga_horaria_pratica, carga_horaria_total FROM componentes_curriculares WHERE matriz_id = ? ORDER BY ordem').all(mid);
    expect(comps.map((x: any) => ({ ...x }))).toEqual([
      { nome: 'Gestão de Estoques', carga_horaria_teorica: 60, carga_horaria_pratica: 40, carga_horaria_total: 100 },
      { nome: 'Movimentação de Cargas', carga_horaria_teorica: null, carga_horaria_pratica: null, carga_horaria_total: 100 },
    ]);
    const pagina = await (await c.req(`/admin/cursos/${id}`)).text();
    expect(pagina).toContain('Deliberação CEE/MS nº 14.500, de 20 de agosto de 2025');
    expect(pagina).toContain('usando o texto padrão geral');
    expect((await (await c.req('/admin/cursos')).text())).toContain('Curso Técnico em Logística');
    expect(auditoria().map((a) => a.entidade)).toEqual(expect.arrayContaining(['curso', 'ato_regulatorio', 'matriz_curricular', 'modulo_tematico', 'componente_curricular']));
  }, 30_000);

  it('o certificado de cada turma cita a deliberação do seu curso + os dados fixos da instituição', async () => {
    const { c, sqlite } = await admin();
    const { id, mid, mod } = await cursoB(c, sqlite);
    turmaB(sqlite, id, mid, mod);
    const b = semTags(await (await c.req(`/admin/previa/10/${mod}`)).text());
    expect(b).toContain('Projeto Pedagógico do Curso Técnico em Logística');
    expect(b).toContain('conforme Deliberação CEE/MS nº 14.500, de 20 de agosto de 2025');
    expect(b).not.toContain('13.111');
    expect(b).toContain('Credenciamento Deliberação CEE/MS nº 10.994, de 6 de fevereiro de 2017'); // fixo da instituição
    expect(b).toContain('conferindo-lhe o título de Auxiliar de Armazenagem');
    expect(b).toContain('Apto para emissão');
    // e o curso original continua com a sua deliberação
    expect(await (await c.req('/admin/previa/1/1')).text()).toContain('conforme Deliberação CEE/MS nº 13.111');
  }, 30_000);

  it('texto próprio do curso, com variáveis de atos do curso e fixas da instituição', async () => {
    const { c, sqlite } = await admin();
    const { id, mid, mod } = await cursoB(c, sqlite);
    turmaB(sqlite, id, mid, mod);
    let r = await c.post(`/admin/cursos/${id}/textos/certificado_qualificacao`, { texto: 'Texto com {variavel_inexistente} que não deve ser aceito pelo sistema de forma alguma.' });
    expect(msg(r)).toContain('Variáveis desconhecidas: {variavel_inexistente}');
    r = await c.post(`/admin/cursos/${id}/textos/certificado_qualificacao`, {
      texto: 'O {instituicao}, credenciado pela {ato_credenciamento_completo}, certifica que {nome} concluiu o módulo {modulo} ({carga_horaria} h) do {curso}, autorizado pela {ato_ppc_completo}, conferindo-lhe o título de {qualificacao}.',
    });
    expect(msg(r)).toContain('texto do curso salvo');
    const previa = await (await c.req(`/admin/previa/10/${mod}`)).text();
    expect(previa).toContain('credenciado pela Deliberação CEE/MS nº 10.994, de 6 de fevereiro de 2017, certifica que ANA BEATRIZ FICTÍCIA SOUZA concluiu o módulo ARMAZENAGEM (200 h) do Curso Técnico em Logística, autorizado pela Deliberação CEE/MS nº 14.500, de 20 de agosto de 2025');
    // o curso 1 não é afetado
    expect(semTags(await (await c.req('/admin/previa/1/1')).text())).toContain('A Direção do Instituto Inovativa');
    // variável sem valor (curso sem reconhecimento) bloqueia a emissão
    await c.post(`/admin/cursos/${id}/textos/certificado_qualificacao`, { texto: 'Certificamos que {nome} concluiu o {curso}, reconhecido pela {ato_reconhecimento_completo}, com aproveitamento.' });
    expect(await (await c.req(`/admin/previa/10/${mod}`)).text()).toContain('Texto do certificado: {ato_reconhecimento_completo} sem valor');
    // voltar ao padrão geral
    await c.post(`/admin/cursos/${id}/textos/certificado_qualificacao`, { usar_padrao: '1' });
    expect(semTags(await (await c.req(`/admin/previa/10/${mod}`)).text())).toContain('A Direção do Instituto Inovativa');
  }, 30_000);

  it('módulo cuja soma das disciplinas não confere bloqueia a emissão', async () => {
    const { c, sqlite } = await admin();
    const { id, mid, mod } = await cursoB(c, sqlite);
    await c.post(`/admin/cursos/${id}/matrizes/${mid}/modulos/${mod}`, { ordem: '1', nome: 'Armazenagem', carga_horaria: '240', qualificacao_conferida: 'Auxiliar de Armazenagem', tem_terminalidade: '1' });
    turmaB(sqlite, id, mid, mod);
    expect(await (await c.req(`/admin/previa/10/${mod}`)).text()).toContain('as disciplinas do módulo somam 200 h, mas o módulo tem 240 h');
  }, 30_000);

  it('matriz em uso fica travada; nova versão copia a estrutura', async () => {
    const { c, sqlite } = await admin();
    const { id, mid, mod } = await cursoB(c, sqlite);
    turmaB(sqlite, id, mid, mod);
    const r = await c.post(`/admin/cursos/${id}/matrizes/${mid}/modulos`, { ordem: '2', nome: 'Transporte', carga_horaria: '100' });
    expect(msg(r)).toContain('Matriz em uso pelas turmas LOG-2026-1');
    expect(await (await c.req(`/admin/cursos/${id}/matrizes/${mid}`)).text()).toContain('estrutura travada');
    const nv = await c.post(`/admin/cursos/${id}/matrizes`, { copiar_de: String(mid) });
    const mid2 = Number(/\/matrizes\/(\d+)/.exec(msg(nv))![1]);
    expect(sqlite.prepare('SELECT versao FROM matrizes_curriculares WHERE id = ?').get(mid2)).toEqual({ versao: 2 });
    expect(sqlite.prepare('SELECT count(*) AS n FROM componentes_curriculares WHERE matriz_id = ?').get(mid2)).toEqual({ n: 2 });
    expect((await c.post(`/admin/cursos/${id}/matrizes/${mid2}/modulos`, { ordem: '2', nome: 'Transporte', carga_horaria: '100' })).status).toBe(302);
    expect(sqlite.prepare('SELECT count(*) AS n FROM modulos_tematicos WHERE matriz_id = ?').get(mid2)).toEqual({ n: 2 });
  }, 30_000);

  it('dinâmico pela matrícula: o mesmo aluno em dois cursos recebe os dados de cada curso', async () => {
    const { c, sqlite } = await admin();
    const { id, mid, mod } = await cursoB(c, sqlite);
    turmaB(sqlite, id, mid, mod); // Ana (aluno 1) também matriculada no curso B (matrícula 10)
    const doCursoA = await (await c.req('/admin/previa/1/1')).text(); // matrícula 1 → curso A
    const doCursoB = await (await c.req(`/admin/previa/10/${mod}`)).text(); // matrícula 10 → curso B
    expect(doCursoA).toContain('ANA BEATRIZ FICTÍCIA SOUZA');
    expect(doCursoB).toContain('ANA BEATRIZ FICTÍCIA SOUZA');
    expect(doCursoA).toContain('Inovação e Desenvolvimento Corporativo');
    expect(doCursoA).toContain('nº 13.111');
    expect(doCursoA).toContain('INSPETOR DE QUALIDADE');
    expect(doCursoB).toContain('Curso Técnico em Logística');
    expect(doCursoB).toContain('nº 14.500');
    expect(doCursoB).toContain('AUXILIAR DE ARMAZENAGEM');
    expect(doCursoB).not.toContain('Inovação e Desenvolvimento Corporativo');
    // a declaração de cada matrícula também segue o seu curso
    const declB = await (await c.req(`/admin/documentos/declaracao_conclusao_modulo/10/${mod}/previa`)).text();
    expect(declB).toContain('Curso Técnico em Logística');
    expect(declB).toContain('autorizado pela Deliberação CEE/MS nº 14.500, de 20 de agosto de 2025');
  }, 30_000);

  it('curso FIC com Portaria: rótulo "Qualificação Profissional" e tipo do ato reais em todos os documentos', async () => {
    const { c, sqlite } = await admin();
    const { id, mid, mod } = await cursoB(c, sqlite);
    sqlite.exec(`UPDATE cursos SET tipo = 'Qualificação Profissional / FIC' WHERE id = ${id};
                 UPDATE atos_regulatorios SET tipo = 'Portaria', orgao_emissor = 'Secretaria de Estado de Educação - SED/MS' WHERE curso_id = ${id};`);
    turmaB(sqlite, id, mid, mod);
    const cert = semTags(await (await c.req(`/admin/previa/10/${mod}`)).text());
    expect(cert).toContain('MÓDULO TEMÁTICO DA QUALIFICAÇÃO PROFISSIONAL ARMAZENAGEM');
    expect(cert).not.toContain('QUALIFICAÇÃO PROFISSIONAL TÉCNICA');
    expect(cert).toContain('conforme Portaria nº 14.500, de 20 de agosto de 2025'); // texto padrão geral usa o ato completo
    const decl = await (await c.req(`/admin/documentos/declaracao_conclusao_modulo/10/${mod}/previa`)).text();
    expect(decl).toContain('que confere a QUALIFICAÇÃO PROFISSIONAL de AUXILIAR DE ARMAZENAGEM');
    expect(decl).toContain('autorizado pela Portaria nº 14.500');
    expect(decl).toContain('Qualificação Profissional — Auxiliar de Armazenagem'); // subtítulo sem "Técnica de Nível Médio"
    // emitido: o rótulo fica congelado no snapshot e aparece na validação pública
    await c.post(`/admin/certificados/emitir/10/${mod}`, {
      data_emissao: '2026-12-05', registro_numero: '1', folha: '1', livro: '1', data_registro: '2026-12-05', sistec_codigo: 'S-FIC', sistec_data: '2026-12-04',
    });
    const s = JSON.parse((sqlite.prepare('SELECT snapshot_json FROM certificados').get() as any).snapshot_json);
    expect(s.curso.rotuloQualificacao).toBe('Qualificação Profissional');
    expect(await (await c.req('/v/INV-2026-00001')).text()).toContain('Qualificação Profissional — <b>Auxiliar de Armazenagem</b>');
  }, 30_000);

  it('atos cadastrados são considerados publicados: sem pendência de DOE em nenhuma tela', async () => {
    const { c } = await admin();
    const curso = await (await c.req('/admin/cursos/1')).text();
    expect(curso).toContain('<span class="tag ok">publicado</span>');
    expect(curso).not.toContain('>pendente<');
    const inst = await (await c.req('/admin/instituicao')).text();
    expect(inst).not.toContain('>pendente<');
    expect(await (await c.req('/admin')).text()).not.toContain('DOE');
    expect(await (await c.req('/admin/previa/1/1')).text()).not.toContain('DOE');
  });

  it('secretaria não acessa o cadastro de cursos', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('s@iect.test', 'secretaria');
    const c = amb.cliente();
    await c.entrar('s@iect.test');
    expect((await c.req('/admin/cursos/novo')).status).toBe(403);
    expect((await c.req('/admin/cursos/1')).status).toBe(403);
  });
});

describe('texto "Autorização" do curso (cabeçalho dos documentos)', () => {
  const PADRAO = 'Curso Técnico em Inovação e Desenvolvimento Corporativo: Deliberação CEE/MS nº 13.111, de 18/12/2024';

  /** Reenvia o formulário completo do curso 1, como o navegador faz. */
  function formCurso(sqlite: any, mudancas: Record<string, string>) {
    const cu = sqlite.prepare('SELECT * FROM cursos WHERE id = 1').get() as Record<string, any>;
    const f: Record<string, string> = {};
    for (const k of ['nome', 'tipo', 'nivel', 'area_tecnologica', 'forma_oferta', 'modalidade', 'escolaridade_minima', 'requisitos_acesso',
      'perfil_profissional_conclusao', 'itinerario_formativo', 'texto_autorizacao', 'eixo_id', 'carga_horaria_total', 'prazo_integralizacao_anos']) {
      if (cu[k] != null) f[k] = String(cu[k]);
    }
    if (cu.oferta_experimental) f.oferta_experimental = '1';
    if (cu.ativo) f.ativo = '1';
    return { ...f, ...mudancas };
  }

  it('migração preenche a partir do ato de autorização; sai na prévia do certificado e na declaração', async () => {
    const { c, sqlite } = await admin();
    expect((sqlite.prepare('SELECT texto_autorizacao FROM cursos WHERE id = 1').get() as any).texto_autorizacao).toBe(PADRAO);
    const cert = await (await c.req('/admin/previa/1/1')).text();
    expect(cert).toMatch(/Atos autorizativos vigentes<\/p><p class="cab2">Curso Técnico em Inovação e Desenvolvimento Corporativo: Deliberação CEE\/MS nº 13.111, de 18\/12\/2024<\/p>/);
    const decl = await (await c.req('/admin/documentos/declaracao_conclusao_modulo/1/1/previa')).text();
    expect(decl).toContain(PADRAO);
  });

  it('o que for digitado na tela é o que sai (uma linha por linha); vazio só gera aviso', async () => {
    const { c, sqlite } = await admin();
    const tela = await (await c.req('/admin/cursos/1')).text();
    expect(tela).toContain('name="texto_autorizacao"');
    expect(tela).toContain(PADRAO);

    const texto = 'Curso Técnico em Inovação e Desenvolvimento Corporativo: Deliberação CEE/MS n. 13111, de 18/12/2024\r\nReconhecimento: Deliberação CEE/MS n. 99999, de 01/12/2026';
    expect((await c.post('/admin/cursos/1', formCurso(sqlite, { texto_autorizacao: texto }))).status).toBe(302);
    const cert = await (await c.req('/admin/previa/1/1')).text();
    expect(cert).toContain('<p class="cab2">Curso Técnico em Inovação e Desenvolvimento Corporativo: Deliberação CEE/MS n. 13111, de 18/12/2024</p>');
    expect(cert).toContain('<p class="cab2">Reconhecimento: Deliberação CEE/MS n. 99999, de 01/12/2026</p>');
    // duas linhas a mais no cabeçalho: os respiros em volta do título diminuem para caber na folha
    expect(cert).toContain('margin-top:4pt;margin-bottom:8pt');

    await c.post('/admin/cursos/1', formCurso(sqlite, { texto_autorizacao: '' }));
    const vazio = await (await c.req('/admin/previa/1/1')).text();
    expect(vazio).toContain('Texto de autorização do curso não preenchido');
    expect(vazio).not.toContain('Reconhecimento: Deliberação');
  });
});
