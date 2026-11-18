import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';
import { gerarHashSenha, problemaSenha, verificarSenha } from '../src/auth/senha';
import { GRUPOS_PERMISSAO, pode, PERMISSOES, permissoesEfetivas } from '../src/auth/permissoes';

describe('senha', () => {
  it('hash PBKDF2 confere e rejeita senha errada', async () => {
    const h = await gerarHashSenha('MinhaSenha2026');
    expect(h).toMatch(/^pbkdf2\$100000\$/);
    expect(await verificarSenha('MinhaSenha2026', h)).toBe(true);
    expect(await verificarSenha('minhasenha2026', h)).toBe(false);
    expect(await gerarHashSenha('MinhaSenha2026')).not.toBe(h); // salt aleatório
  });
  it('política mínima', () => {
    expect(problemaSenha('curta1')).toMatch(/10/);
    expect(problemaSenha('somenteletras')).toMatch(/números/);
    expect(problemaSenha('LetrasE123456')).toBeNull();
  });
});

describe('perfis', () => {
  it('admin master pode tudo', () => {
    for (const p of Object.keys(PERMISSOES) as (keyof typeof PERMISSOES)[]) expect(pode('admin_master', p)).toBe(true);
  });
  it('coordenador e secretaria: alunos, turmas, relatórios e emissão — sem usuários, auditoria ou instituição', () => {
    for (const perfil of ['coordenador', 'secretaria'] as const) {
      expect(pode(perfil, 'alunos.editar')).toBe(true);
      expect(pode(perfil, 'turmas.editar')).toBe(true);
      expect(pode(perfil, 'relatorios.emitir')).toBe(true);
      expect(pode(perfil, 'usuarios.gerenciar')).toBe(false);
      expect(pode(perfil, 'auditoria.ver')).toBe(false);
      expect(pode(perfil, 'instituicao.editar')).toBe(false);
      expect(pode(perfil, 'certificados.emitir')).toBe(true);
      expect(pode(perfil, 'certificados.revogar')).toBe(false);
    }
  });
  it('administrador vê quase tudo: não gerencia usuários nem revoga', () => {
    expect(pode('administrador', 'auditoria.ver')).toBe(true);
    expect(pode('administrador', 'certificados.emitir')).toBe(true);
    expect(pode('administrador', 'usuarios.gerenciar')).toBe(false);
    expect(pode('administrador', 'certificados.revogar')).toBe(false);
  });
});

describe('login e sessão', () => {
  it('sem sessão redireciona para o login', async () => {
    const { cliente } = await criarAmbiente();
    const r = await cliente().req('/admin/alunos');
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toMatch(/^\/login\?voltar=/);
  });

  it('login correto entra e registra auditoria; errado é recusado e auditado', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const c = amb.cliente();
    expect((await c.entrar('sec@iect.test', 'errada')).status).toBe(401);
    const ok = await c.entrar('sec@iect.test');
    expect(ok.status).toBe(302);
    expect(ok.headers.get('Location')).toBe('/admin');
    expect((await c.req('/admin')).status).toBe(200);
    expect(amb.auditoria().map((a) => a.acao)).toEqual(['login_falha', 'login']);
  });

  it('bloqueia após 5 tentativas erradas', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('x@iect.test', 'secretaria');
    const c = amb.cliente();
    for (let i = 0; i < 5; i++) await c.entrar('x@iect.test', 'errada');
    const r = await c.entrar('x@iect.test'); // senha certa, mas bloqueado
    expect(r.status).toBe(401);
    expect(await r.text()).toMatch(/bloqueado/);
  });

  it('senha temporária obriga a troca antes de usar o painel', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('novo@iect.test', 'coordenador', 'Temporaria99', 1);
    const c = amb.cliente();
    await c.entrar('novo@iect.test', 'Temporaria99');
    expect((await c.req('/admin/alunos')).headers.get('Location')).toBe('/admin/conta/senha');
    const r = await c.post('/admin/conta/senha', { senha_atual: 'Temporaria99', nova_senha: 'NovaSenha2026', confirmacao: 'NovaSenha2026' });
    expect(r.status).toBe(302);
    expect((await c.req('/admin/alunos')).status).toBe(200);
  });

  it('sair encerra a sessão', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('a@iect.test', 'administrador');
    const c = amb.cliente();
    await c.entrar('a@iect.test');
    await c.req('/admin/sair');
    expect((await c.req('/admin')).status).toBe(302);
  });

  it('POST vindo de outro site é bloqueado (CSRF)', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('a@iect.test', 'admin_master');
    const c = amb.cliente();
    await c.entrar('a@iect.test');
    const r = await c.req('/admin/alunos/novo', {
      method: 'POST',
      headers: { Origin: 'https://site-malicioso.example', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'nome_civil=X&cpf=52998224725',
    });
    expect(r.status).toBe(403);
  });
});

describe('permissões nas rotas', () => {
  it('secretaria acessa alunos e turmas, mas não usuários, auditoria, instituição ou signatários', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const c = amb.cliente();
    await c.entrar('sec@iect.test');
    for (const p of ['/admin/alunos', '/admin/turmas', '/admin/alunos/novo']) expect((await c.req(p)).status, p).toBe(200);
    for (const p of ['/admin/usuarios', '/admin/auditoria', '/admin/instituicao', '/admin/signatarios', '/admin/cursos'])
      expect((await c.req(p)).status, p).toBe(403);
  });

  it('administrador vê auditoria e a lista de usuários, mas não cria nem edita usuários', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('adm@iect.test', 'administrador');
    const c = amb.cliente();
    await c.entrar('adm@iect.test');
    expect((await c.req('/admin/auditoria')).status).toBe(200);
    expect((await c.req('/admin/usuarios')).status).toBe(200);
    expect((await c.req('/admin/usuarios/novo')).status).toBe(403);
  });

  it('master cria usuário com senha temporária e não pode remover o último master', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('master@iect.test', 'admin_master');
    const c = amb.cliente();
    await c.entrar('master@iect.test');
    const r = await c.post('/admin/usuarios/novo', { nome: 'Coord', email: 'coord@iect.test', perfil: 'coordenador' });
    expect(r.status).toBe(200);
    expect(await r.text()).toMatch(/Senha temporária/);
    const u = amb.sqlite.prepare(`SELECT trocar_senha, senha_hash FROM usuarios WHERE email = 'coord@iect.test'`).get() as any;
    expect(u.trocar_senha).toBe(1);
    // tentar rebaixar a si mesmo
    const eu = amb.sqlite.prepare(`SELECT id FROM usuarios WHERE email = 'master@iect.test'`).get() as any;
    const r2 = await c.post(`/admin/usuarios/${eu.id}`, { nome: 'M', email: 'master@iect.test', perfil: 'secretaria', ativo: '1' });
    expect(r2.status).toBe(400);
  });
});

describe('cadastros com auditoria', () => {
  it('cadastrar aluno valida CPF e grava auditoria com o usuário', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('coord@iect.test', 'coordenador');
    const c = amb.cliente();
    await c.entrar('coord@iect.test');
    expect((await c.post('/admin/alunos/novo', { nome_civil: 'Fulano', cpf: '123.456.789-00' })).status).toBe(400);
    const r = await c.post('/admin/alunos/novo', { nome_civil: 'Fulano de Tal', cpf: '529.982.247-25', rg_orgao_expedidor: 'sejusp' });
    expect(r.status).toBe(302);
    const a = amb.sqlite.prepare('SELECT cpf, rg_orgao_expedidor FROM alunos').get() as any;
    expect(a).toEqual({ cpf: '52998224725', rg_orgao_expedidor: 'SEJUSP' });
    const ultima = amb.auditoria().at(-1)!;
    expect(ultima).toMatchObject({ usuario_email: 'coord@iect.test', acao: 'criar', entidade: 'aluno' });
    // CPF duplicado
    expect((await c.post('/admin/alunos/novo', { nome_civil: 'Outro', cpf: '52998224725' })).status).toBe(400);
  });

  it('auditoria não pode ser apagada nem alterada', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('a@iect.test', 'admin_master');
    await amb.cliente().entrar('a@iect.test');
    expect(() => amb.sqlite.exec('DELETE FROM auditoria')).toThrow(/apagados/);
    expect(() => amb.sqlite.exec(`UPDATE auditoria SET acao = 'x'`)).toThrow(/alterados/);
  });

  it('parâmetros de aprovação editáveis mudam o resultado', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    await amb.criarUsuario('adm@iect.test', 'administrador');
    const c = amb.cliente();
    await c.entrar('adm@iect.test');
    // João: disciplina 2 com média 4,5 e exame 5,5 → AP com média ponderada (5,0)
    let html = await (await c.req('/admin/turmas/1/modulos/1')).text();
    expect(html).toMatch(/João Pedro Fictício Lima[\s\S]*?Aprovado/);
    // Exigir média final ≥ 5,5 com exame substituindo → 5,5 ainda aprova; com ponderada 1:1 → 5,0 reprova
    await c.post('/admin/cursos/1/parametros', {
      frequencia_minima: '75', nota_minima: '6', nota_minima_exame: '5,5', metodo_exame: 'media_ponderada', peso_media: '1', peso_exame: '1',
    });
    html = await (await c.req('/admin/turmas/1/modulos/1')).text();
    expect(html).toMatch(/João Pedro Fictício Lima[\s\S]*?Reprovado/);
    await c.post('/admin/cursos/1/parametros', {
      frequencia_minima: '75', nota_minima: '6', nota_minima_exame: '5,5', metodo_exame: 'substitui', peso_media: '1', peso_exame: '1',
    });
    html = await (await c.req('/admin/turmas/1/modulos/1')).text();
    expect(html).toMatch(/João Pedro Fictício Lima[\s\S]*?Aprovado/);
    expect(amb.auditoria().filter((a) => a.acao === 'atualizar_parametros')).toHaveLength(2);
  });

  it('lançar notas (Secretaria → Notas) grava resultado AP/RP, vincula o professor e audita as alterações', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    // professor lotado em Design Thinking (disciplina 7, módulo 2) e frequência já apurada
    amb.sqlite.exec(`INSERT INTO funcionarios (id, nome, cpf) VALUES (1, 'Prof. Fictício', '52998224725');
      INSERT INTO funcionario_categorias VALUES (1, 'professor');
      INSERT INTO lotacoes (turma_id, componente_id, funcionario_id, data_inicio) VALUES (1, 7, 1, '2026-08-03');
      INSERT INTO resultados (matricula_id, componente_id, frequencia) VALUES (1, 7, 90), (2, 7, 80);`);
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const c = amb.cliente();
    await c.entrar('sec@iect.test');
    // antes da antiga tela por disciplina: agora leva para Notas
    expect((await c.req('/admin/turmas/1/modulos/2/disciplinas/7')).headers.get('Location')).toBe('/admin/notas?turma=1&modulo=2&disciplina=7');
    const r = await c.post('/admin/notas?ano=2026&turma=1&modulo=2&disciplina=7', {
      o_nota_1: '', nota_1: '8,5', o_nota_2: '', nota_2: '5', o_exame_2: '', exame_2: '4', o_nota_3: '', nota_3: '',
    });
    expect(decodeURIComponent(r.headers.get('Location')!)).toContain('2 aluno(s) atualizado(s)');
    const res = amb.sqlite.prepare('SELECT matricula_id, nota, resultado, professor_id, origem, atualizado_por FROM resultados WHERE componente_id = 7 ORDER BY matricula_id').all();
    expect(res.map((x: any) => ({ ...x }))).toEqual([
      { matricula_id: 1, nota: 8.5, resultado: 'AP', professor_id: 1, origem: 'secretaria', atualizado_por: 'sec@iect.test' },
      { matricula_id: 2, nota: 5, resultado: 'RP', professor_id: 1, origem: 'secretaria', atualizado_por: 'sec@iect.test' },
    ]);
    const a = amb.auditoria().at(-1)!;
    expect(a.acao).toBe('lancar_notas');
    expect(JSON.parse(a.depois_json!).alteracoes).toHaveLength(2);
    // nota fora do intervalo
    const r2 = await c.post('/admin/notas?ano=2026&turma=1&modulo=2&disciplina=7', { o_nota_1: '8,5', nota_1: '11' });
    expect(decodeURIComponent(r2.headers.get('Location')!)).toContain('fora do intervalo 0–10');
  });
});

describe('prévia do certificado', () => {
  it('mostra o texto aprovado preenchido e marca o aluno como apto', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    amb.sqlite.exec(`UPDATE signatarios SET nome = 'Maria Diretora' WHERE id = 1; UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`);
    const c = amb.cliente();
    await c.entrar('sec@iect.test');
    const html = await (await c.req('/admin/previa/1/1')).text();
    expect(html).toContain('ANA BEATRIZ FICTÍCIA SOUZA');
    expect(html).toContain('conforme Deliberação CEE/MS nº 13.111, de 18 de dezembro de 2024');
    expect(html).toContain('natural de Campo Grande, Estado de Mato Grosso do Sul');
    expect(html).toContain('nascido(a) em 14 de março de 1998');
    expect(html).toContain('RG 1234567 Org. Expedidor SEJUSP-MS');
    expect(html.replace(/<\/?b>/g, '')).toContain('MÓDULO TEMÁTICO DA QUALIFICAÇÃO PROFISSIONAL TÉCNICA QUALIDADE, conferindo-lhe o título de Inspetor de Qualidade.');
    // negrito parcial, como no modelo aprovado
    expect(html).toContain('<b>CERTIFICADO por ter concluído com êxito o MÓDULO TEMÁTICO DA QUALIFICAÇÃO PROFISSIONAL TÉCNICA QUALIDADE</b>');
    expect(html).toContain('<b>Área Tecnológica:</b>');
    // cabeçalho: endereço com telefone e e-mail; atos fixos da instituição no lugar da antiga linha "Credenciamento ..."
    expect(html).toMatch(/79010-310( · Tel\.: \(\d\d\) [\d-]+)?( · E-mail: \S+)?<\/p>/);
    expect(html).toContain('Educação Profissional Técnica de Nível Médio credenciamento: Deliberação CEE/MS n. 10994, de 06/02/2017.');
    expect(html).not.toContain('Credenciamento Deliberação CEE/MS nº 10.994');
    expect(html).not.toContain('Verso do Certificado'); // o modelo atualizado não tem essa linha
    expect(html).toContain('Apto para emissão');
    expect(amb.auditoria().at(-1)!.acao).toBe('visualizar_previa');
  });

  it('usa o nome social e aponta reprovação', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const c = amb.cliente();
    await c.entrar('sec@iect.test');
    const html = await (await c.req('/admin/previa/3/1')).text();
    expect(html).toContain('RENATA FICTÍCIA ALVES');
    expect(html).not.toContain('ROBERTO');
    expect(html).toContain('Aluno não aprovado no módulo');
    expect(html).toMatch(/frequência 70% abaixo de 75%/);
  });

  it('rascunho reflete dados ainda não salvos e destaca campos faltantes', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const c = amb.cliente();
    await c.entrar('sec@iect.test');
    const r = await c.post('/admin/previa/1/1/rascunho', { nome_civil: 'Ana Editada', cpf: '11122233396', nome_mae: 'Mãe', rg: '' });
    const html = await r.text();
    expect(html).toContain('ANA EDITADA');
    expect(html).toMatch(/class="falta"[^>]*>\[rg\]/);
    expect(html).toContain('filho(a) de Mãe, o presente'); // sem nome do pai
    const aluno = amb.sqlite.prepare('SELECT nome_civil FROM alunos WHERE id = 1').get() as any;
    expect(aluno.nome_civil).toBe('Ana Beatriz Fictícia Souza'); // nada foi salvo
  });
});

describe('permissões por usuário', () => {
  it('todas as permissões aparecem uma vez nos grupos da tela; ajustes somam e tiram do perfil', () => {
    const nosGrupos = GRUPOS_PERMISSAO.flatMap((g) => g.permissoes);
    expect([...nosGrupos].sort()).toEqual(Object.keys(PERMISSOES).sort());
    const ef = permissoesEfetivas('secretaria', [{ permissao: 'auditoria.ver', concedida: 1 }, { permissao: 'alunos.editar', concedida: 0 }]);
    expect(pode({ perfil: 'secretaria', permissoes: ef }, 'auditoria.ver')).toBe(true);
    expect(pode({ perfil: 'secretaria', permissoes: ef }, 'alunos.editar')).toBe(false);
    expect(pode({ perfil: 'secretaria', permissoes: ef }, 'turmas.editar')).toBe(true);
    expect(pode({ perfil: 'admin_master', permissoes: [] }, 'usuarios.gerenciar')).toBe(true);
  });

  it('administrador libera e bloqueia funções da secretaria; vale na hora; não mexe em master nem em si', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('adm@iect.test', 'administrador');
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    await amb.criarUsuario('m@iect.test', 'admin_master');
    const id = (e: string) => (amb.sqlite.prepare('SELECT id FROM usuarios WHERE email = ?').get(e) as any).id;
    const adm = amb.cliente(); await adm.entrar('adm@iect.test');
    const sec = amb.cliente(); await sec.entrar('sec@iect.test');
    expect((await sec.req('/admin/auditoria')).status).toBe(403);
    expect((await sec.req('/admin/alunos')).status).toBe(200);

    const tela = await (await adm.req(`/admin/usuarios/${id('sec@iect.test')}/permissoes`)).text();
    expect(tela).toMatch(/Permissões: sec/);
    expect(tela).toMatch(/só o admin master altera/); // usuarios.gerenciar
    // libera auditoria, bloqueia alunos; tenta liberar gerência de usuários e revogação (ignoradas: o administrador não tem)
    const r = await adm.post(`/admin/usuarios/${id('sec@iect.test')}/permissoes`, {
      'p_auditoria.ver': 'liberar', 'p_alunos.editar': 'bloquear', 'p_usuarios.gerenciar': 'liberar', 'p_certificados.revogar': 'liberar',
      'p_turmas.editar': 'liberar', // igual ao padrão: não grava
    });
    expect(r.status).toBe(302);
    const linhas = amb.sqlite.prepare('SELECT permissao, concedida FROM usuario_permissoes ORDER BY permissao').all();
    expect(linhas).toEqual([{ permissao: 'alunos.editar', concedida: 0 }, { permissao: 'auditoria.ver', concedida: 1 }]);
    expect(amb.auditoria().at(-1)).toMatchObject({ acao: 'permissoes', entidade: 'usuario' });
    // vale na próxima requisição, sem novo login
    expect((await sec.req('/admin/auditoria')).status).toBe(200);
    expect((await sec.req('/admin/alunos')).status).toBe(403);
    expect(await (await sec.req('/admin')).text()).not.toMatch(/href="\/admin\/alunos"/);
    expect((await adm.req('/admin/usuarios')).status).toBe(200);
    expect(await (await adm.req('/admin/usuarios')).text()).toMatch(/personalizado/);

    // não ajusta admin master nem a si mesmo
    expect((await adm.req(`/admin/usuarios/${id('m@iect.test')}/permissoes`)).status).toBe(302);
    expect((await adm.post(`/admin/usuarios/${id('m@iect.test')}/permissoes`, { 'p_auditoria.ver': 'bloquear' })).status).toBe(403);
    expect((await adm.post(`/admin/usuarios/${id('adm@iect.test')}/permissoes`, { 'p_alunos.editar': 'bloquear' })).status).toBe(403);
    // secretaria não acessa a tela
    expect((await sec.req(`/admin/usuarios/${id('sec@iect.test')}/permissoes`)).status).toBe(403);

    // voltar tudo ao padrão
    await adm.post(`/admin/usuarios/${id('sec@iect.test')}/permissoes`, { acao: 'padrao' });
    expect(amb.sqlite.prepare('SELECT count(*) AS n FROM usuario_permissoes').get()).toEqual({ n: 0 });
    expect((await sec.req('/admin/alunos')).status).toBe(200);
  });

  it('admin master libera gerência de usuários a um administrador e pode tirar dele a tela de permissões', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('m@iect.test', 'admin_master');
    await amb.criarUsuario('adm@iect.test', 'administrador');
    const idAdm = (amb.sqlite.prepare(`SELECT id FROM usuarios WHERE email = 'adm@iect.test'`).get() as any).id;
    const m = amb.cliente(); await m.entrar('m@iect.test');
    const adm = amb.cliente(); await adm.entrar('adm@iect.test');
    await m.post(`/admin/usuarios/${idAdm}/permissoes`, { 'p_usuarios.gerenciar': 'liberar' });
    expect((await adm.req('/admin/usuarios/novo')).status).toBe(200);
    await m.post(`/admin/usuarios/${idAdm}/permissoes`, { 'p_usuarios.permissoes': 'bloquear' });
    expect((await adm.req('/admin/usuarios')).status).toBe(403);
  });
});
