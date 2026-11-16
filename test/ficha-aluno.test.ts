import { describe, expect, it } from 'vitest';
import { criarAmbiente } from './ambiente';


async function logado(perfil = 'secretaria') {
  const amb = await criarAmbiente({ ficticios: true });
  amb.sqlite.exec(`UPDATE signatarios SET nome = 'Maria Diretora' WHERE id = 1; UPDATE signatarios SET nome = 'José Secretário' WHERE id = 2;`);
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  return { ...amb, c };
}

/** Lê todos os campos atuais do aluno (para reenviar o formulário completo, como o navegador faz). */
function formularioDe(sqlite: any, id: number, mudancas: Record<string, string>) {
  const a = sqlite.prepare('SELECT * FROM alunos WHERE id = ?').get(id) as Record<string, unknown>;
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) if (v != null && !['id', 'criado_em', 'atualizado_em'].includes(k)) f[k] = String(v);
  if (f.usar_nome_social === '0') delete f.usar_nome_social; // checkbox desmarcado não é enviado
  return { ...f, ...mudancas };
}

describe('ficha do aluno (estilo SysGEP)', () => {
  it('mostra barra de ferramentas, abas, obrigatórios e abre em modo de visualização', async () => {
    const { c } = await logado();
    const html = await (await c.req('/admin/alunos/1')).text();
    for (const t of ['Incluir', 'Alterar', 'Salvar', 'Excluir', 'Atualizar', 'Atalhos', 'Sair', 'Matrículas', 'Prévia do certificado', 'Localizar', 'Documentos', 'Usar nome social', 'Endereço e contato']) {
      expect(html, t).toContain(t);
    }
    expect(html).toContain('data-modo="ver"');
    expect(html).toMatch(/<fieldset class="ficha" disabled/);
    expect(html).toMatch(/class="f s12 obr"><span>Nome do aluno/); // obrigatório marcado
    expect(html).toContain('Alt</kbd>+<kbd>S</kbd> Salvar');
    // lista (Localizar) e novo
    expect(await (await c.req('/admin/alunos?q=Ana')).text()).toContain('Ana Beatriz Fictícia Souza');
    const novo = await (await c.req('/admin/alunos/novo')).text();
    expect(novo).toContain('data-modo="novo"');
    expect(novo).not.toMatch(/<fieldset class="ficha" disabled/);
  });

  it('salva os campos novos (endereço, celular, estado civil, expedição do RG)', async () => {
    const { c, sqlite, auditoria } = await logado();
    const r = await c.post('/admin/alunos/1', formularioDe(sqlite, 1, {
      cep: '79010310', endereco: 'Rua do Exemplo, 10', bairro: 'Centro', endereco_municipio: 'Campo Grande', endereco_uf: 'MS',
      celular: '(67) 99999-0000', estado_civil: 'Solteiro(a)', rg_data_expedicao: '2015-02-10', necessidades_especificas: 'Baixa visão',
    }));
    expect(r.status).toBe(302);
    expect(sqlite.prepare('SELECT cep, endereco_uf, celular, estado_civil, rg_data_expedicao FROM alunos WHERE id = 1').get())
      .toEqual({ cep: '79010-310', endereco_uf: 'MS', celular: '(67) 99999-0000', estado_civil: 'Solteiro(a)', rg_data_expedicao: '2015-02-10' });
    expect(auditoria().at(-1)).toMatchObject({ acao: 'atualizar', entidade: 'aluno' });
    // CEP inválido
    const ruim = await c.post('/admin/alunos/1', formularioDe(sqlite, 1, { cep: '123' }));
    expect(ruim.status).toBe(400);
    expect(await ruim.text()).toContain('CEP inválido');
  });

  it('chave "usar nome social": desligada, o certificado usa o nome civil', async () => {
    const { c, sqlite } = await logado();
    // aluno 3 tem nome social; por padrão a chave vem ligada
    expect(await (await c.req('/admin/previa/3/1')).text()).toContain('RENATA FICTÍCIA ALVES');
    await c.post('/admin/alunos/3', formularioDe(sqlite, 3, { usar_nome_social: '' }));
    expect((sqlite.prepare('SELECT usar_nome_social FROM alunos WHERE id = 3').get() as any).usar_nome_social).toBe(0);
    const previa = await (await c.req('/admin/previa/3/1')).text();
    expect(previa).toContain('ROBERTO FICTÍCIO ALVES');
    expect(previa).not.toContain('RENATA FICTÍCIA ALVES');
    // e a lista de alunos também passa a mostrar o nome civil
    expect(await (await c.req('/admin/alunos?q=Alves')).text()).toContain('>Roberto Fictício Alves</a>');
  });

  it('anexa documento, exclui só da lista (arquivo fica no histórico) e bloqueia exclusão do aluno', async () => {
    const { c, sqlite, auditoria } = await logado('admin_master');
    const fd = new FormData();
    fd.set('descricao', 'RG');
    fd.set('arquivo', new File([new TextEncoder().encode('%PDF-1.4 teste')], 'rg.pdf'));
    // aluno sem matrícula, para testar o bloqueio por documento
    sqlite.exec(`INSERT INTO alunos (id, nome_civil, cpf) VALUES (50, 'Sem Matrícula', '52998224725')`);
    expect((await c.req('/admin/alunos/50/documentos', { method: 'POST', body: fd })).status).toBe(302);
    const doc = sqlite.prepare('SELECT * FROM aluno_documentos').get() as any;
    expect(doc).toMatchObject({ aluno_id: 50, descricao: 'RG', nome_arquivo: 'rg.pdf', tipo: 'application/pdf', enviado_por: 'u@iect.test' });
    expect(await (await c.req('/admin/alunos/50')).text()).toContain('rg.pdf');
    // arquivo que não é PDF/imagem
    const ruim = new FormData();
    ruim.set('descricao', 'X');
    ruim.set('arquivo', new File([new TextEncoder().encode('MZ executável')], 'x.pdf'));
    expect((await c.req('/admin/alunos/50/documentos', { method: 'POST', body: ruim })).status).toBe(400);
    // aluno com documento não pode ser excluído
    const ex = await c.post('/admin/alunos/50/excluir', {});
    expect(decodeURIComponent(ex.headers.get('Location')!)).toContain('possui matrícula ou documentos');
    // excluir documento: some da lista, registro continua
    await c.post(`/admin/alunos/50/documentos/${doc.id}/excluir`, {});
    expect(await (await c.req('/admin/alunos/50')).text()).not.toContain('rg.pdf');
    expect((sqlite.prepare('SELECT excluido_por FROM aluno_documentos').get() as any).excluido_por).toBe('u@iect.test');
    expect(() => sqlite.exec('DELETE FROM aluno_documentos')).toThrow(/não são apagados/);
    expect(auditoria().map((a) => a.acao)).toEqual(expect.arrayContaining(['anexar_documento', 'excluir_documento']));
  });

  it('matricula o aluno numa turma pela aba Matrículas', async () => {
    const { c, sqlite } = await logado();
    sqlite.exec(`INSERT INTO turmas (id, curso_id, matriz_id, codigo) VALUES (2, 1, 1, 'TIDC-2027-1')`);
    const r = await c.post('/admin/alunos/1/matriculas', { turma_id: '2' });
    expect(r.headers.get('Location')).toContain('#matriculas');
    expect(sqlite.prepare('SELECT count(*) AS n FROM matriculas WHERE aluno_id = 1').get()).toEqual({ n: 2 });
    expect(await (await c.req('/admin/alunos/1')).text()).toContain('TIDC-2027-1');
  });
});
