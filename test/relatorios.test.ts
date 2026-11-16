import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { criarAmbiente } from './ambiente';
import { caminhoPai } from '../src/views/layout';

async function logado(perfil: string) {
  const amb = await criarAmbiente({ ficticios: true });
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  return { ...amb, c };
}

describe('relatório de alunos por situação de matrícula', () => {
  it('coordenador, secretaria e administrador emitem; aparece quem emitiu, com data e hora', async () => {
    for (const perfil of ['coordenador', 'secretaria', 'administrador', 'admin_master']) {
      const { c } = await logado(perfil);
      const pagina = await (await c.req('/admin/relatorios')).text();
      expect(pagina, perfil).toContain('Alunos por situação de matrícula');
      const html = await (await c.req('/admin/relatorios/alunos-situacao')).text();
      expect(html, perfil).toMatch(/Emitido por u \(u@iect\.test\) em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}\./);
    }
  });

  it('filtra pela situação e mostra os totais', async () => {
    const { c, sqlite } = await logado('secretaria');
    sqlite.exec(`UPDATE matriculas SET situacao = 'desistente' WHERE id = 3`);
    const todos = await (await c.req('/admin/relatorios/alunos-situacao')).text();
    expect(todos).toContain('Situação: todas · Curso: todos · Turma: todas');
    expect(todos).toContain('Total: 3 aluno(s)');
    const desist = await (await c.req('/admin/relatorios/alunos-situacao?situacao=desistente&turma=1')).text();
    expect(desist).toContain('Situação: Desistente · Curso: todos · Turma: TIDC-2026-1');
    expect(desist).toContain('Renata Fictícia Alves');
    expect(desist).not.toContain('Ana Beatriz Fictícia Souza');
    expect(desist).toContain('Total: 1 aluno(s)');
    const vazio = await (await c.req('/admin/relatorios/alunos-situacao?situacao=reprovado')).text();
    expect(vazio).toContain('Nenhum aluno encontrado');
  });

  it('PDF com rodapé de quem emitiu e numeração; CSV; auditoria', async () => {
    const { c, auditoria } = await logado('coordenador');
    const r = await c.req('/admin/relatorios/alunos-situacao.pdf?situacao=cursando');
    expect(r.headers.get('Content-Type')).toBe('application/pdf');
    const pdf = await PDFDocument.load(new Uint8Array(await r.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(1);
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(595);
    const csv = await (await c.req('/admin/relatorios/alunos-situacao.csv')).text();
    expect(csv).toContain('Emitido por u (u@iect.test) em');
    expect(csv).toContain('Ana Beatriz Fictícia Souza');
    const regs = auditoria().filter((a) => a.acao === 'emitir_relatorio');
    expect(regs).toHaveLength(2);
    expect(JSON.parse(regs[0].depois_json!)).toMatchObject({ relatorio: 'alunos_por_situacao', formato: 'pdf', filtros: { situacao: 'cursando' }, total: 3 });
  }, 30_000);
});

describe('botão Voltar e tela da turma', () => {
  it('Voltar sobe para a tela anterior válida', () => {
    expect(caminhoPai('/admin/turmas/5')).toBe('/admin/turmas');
    expect(caminhoPai('/admin/turmas/5/modulos/2')).toBe('/admin/turmas/5');
    expect(caminhoPai('/admin/turmas/5/modulos/2/disciplinas/7')).toBe('/admin/turmas/5/modulos/2');
    expect(caminhoPai('/admin/cursos/1/matrizes/3')).toBe('/admin/cursos/1');
    expect(caminhoPai('/admin/instituicao/atos/4')).toBe('/admin/instituicao');
    expect(caminhoPai('/admin/conta/senha')).toBe('/admin');
  });

  it('telas internas mostram o Voltar; o início não', async () => {
    const { c } = await logado('admin_master');
    expect(await (await c.req('/admin/turmas/1/modulos/1')).text()).toContain('<a class="voltar" href="/admin/turmas/1">');
    expect(await (await c.req('/admin/turmas/1')).text()).toContain('<a class="voltar" href="/admin/turmas">');
    expect(await (await c.req('/admin/relatorios')).text()).toContain('<a class="voltar" href="/admin">');
    expect(await (await c.req('/admin')).text()).not.toContain('class="voltar"');
  });

  it('tela da turma: etapas dos módulos, resumo e estado vazio', async () => {
    const { c, sqlite } = await logado('secretaria');
    let html = await (await c.req('/admin/turmas/1')).text();
    expect(html).toContain('class="etapa concluido"');
    expect(html).toContain('class="etapa em_andamento"');
    expect(html).toContain('Resultados e certificados');
    expect(html).toContain('Lançar resultados');
    expect(html).toContain('Aguardando o módulo anterior');
    expect(html).toMatch(/Módulos concluídos<\/span><b>1 de 3<\/b>/);
    sqlite.exec(`INSERT INTO turmas (id, curso_id, matriz_id, codigo) VALUES (9, 1, 1, 'VAZIA-1')`);
    html = await (await c.req('/admin/turmas/9')).text();
    expect(html).toContain('Nenhum aluno matriculado ainda');
  });
});
