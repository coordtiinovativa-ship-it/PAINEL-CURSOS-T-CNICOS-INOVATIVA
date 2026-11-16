import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';
import { gerarHashSenha, problemaSenha, verificarSenha } from '../src/auth/senha';
import { pode, PERMISSOES } from '../src/auth/permissoes';

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

  it('administrador vê auditoria mas não gerencia usuários', async () => {
    const amb = await criarAmbiente();
    await amb.criarUsuario('adm@iect.test', 'administrador');
    const c = amb.cliente();
    await c.entrar('adm@iect.test');
    expect((await c.req('/admin/auditoria')).status).toBe(200);
    expect((await c.req('/admin/usuarios')).status).toBe(403);
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

  it('lançar notas grava resultado AP/RP e audita as alterações', async () => {
    const amb = await criarAmbiente({ ficticios: true });
    await amb.criarUsuario('sec@iect.test', 'secretaria');
    const c = amb.cliente();
    await c.entrar('sec@iect.test');
    const r = await c.post('/admin/turmas/1/modulos/2/disciplinas/7', {
      nota_1: '8,5', freq_1: '90', nota_2: '5', exame_2: '4', freq_2: '80', nota_3: '', freq_3: '',
    });
    expect(r.status).toBe(302);
    const res = amb.sqlite.prepare('SELECT matricula_id, nota, resultado FROM resultados WHERE componente_id = 7 ORDER BY matricula_id').all();
    expect(res.map((x: any) => ({ ...x }))).toEqual([
      { matricula_id: 1, nota: 8.5, resultado: 'AP' },
      { matricula_id: 2, nota: 5, resultado: 'RP' },
    ]);
    const a = amb.auditoria().at(-1)!;
    expect(a.acao).toBe('lancar_resultados');
    expect(JSON.parse(a.depois_json!).alteracoes).toHaveLength(2);
    // nota fora do intervalo
    const r2 = await c.post('/admin/turmas/1/modulos/2/disciplinas/7', { nota_1: '11' });
    expect(r2.headers.get('Location')).toMatch(/erro=/);
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
    expect(html).toContain('MÓDULO TEMÁTICO DA QUALIFICAÇÃO PROFISSIONAL TÉCNICA QUALIDADE, conferindo-lhe o título de Inspetor de Qualidade.');
    expect(html).toContain('Credenciamento Deliberação CEE/MS nº 10.994, de 6 de fevereiro de 2017');
    expect(html).toContain('(Verso do Certificado da QUALIFICAÇÃO PROFISSIONAL TÉCNICA INSPETOR DE QUALIDADE)');
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
