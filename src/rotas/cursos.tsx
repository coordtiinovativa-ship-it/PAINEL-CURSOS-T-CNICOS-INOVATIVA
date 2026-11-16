import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Pagina, Selecao } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, lerCorpo, numBR, numero, texto } from '../lib/form';
import { calcularMediaFinal, criteriosDoCurso, ROTULO_METODO, type MetodoExame } from '../lib/aprovacao';

export const rotasCursos = new Hono<Env>();
rotasCursos.use('*', exigir('cursos.editar'));

// A lista e o cadastro de cursos ficam em ./cursos-gestao.tsx

const FormParametros = ({ c, cu, erro }: { c: any; cu: Record<string, any>; erro?: string }) => {
  const cr = criteriosDoCurso(cu as any);
  const ex = (m: number, e: number) => numBR(calcularMediaFinal(m, e, cr), 2);
  return (
    <Pagina titulo="Parâmetros de aprovação" usuario={c.get('usuario')} caminho={c.req.path} erro={erro}>
      <h1>Parâmetros de aprovação</h1>
      <p><b>{cu.nome}</b></p>
      <div class="cartao">
        <p class="muted">
          Regra (PPC 11.1.1): a disciplina é aprovada (AP) se a frequência atingir o mínimo <b>e</b> a média atingir o mínimo,
          <b> ou</b>, quando houver exame final, se a média final após o exame atingir o mínimo do exame.
          O módulo é aprovado quando todas as suas disciplinas estão AP.
        </p>
        <form method="post" class="grade">
          <Campo nome="frequencia_minima" rotulo="Frequência mínima (%)" valor={numBR(cr.frequenciaMinima)} obrigatorio />
          <Campo nome="nota_minima" rotulo="Média mínima para aprovação direta" valor={numBR(cr.notaMinima)} obrigatorio />
          <Campo nome="nota_minima_exame" rotulo="Média final mínima após exame" valor={numBR(cr.notaMinimaExame)} obrigatorio />
          <Selecao nome="metodo_exame" rotulo="Como calcular a média final após exame" valor={cr.metodoExame} obrigatorio
            opcoes={Object.entries(ROTULO_METODO) as [string, string][]} />
          <Campo nome="peso_media" rotulo="Peso da média (só p/ média ponderada)" valor={numBR(cr.pesoMedia)} />
          <Campo nome="peso_exame" rotulo="Peso do exame (só p/ média ponderada)" valor={numBR(cr.pesoExame)} />
          <div class="largo acoes"><button>Salvar parâmetros</button><a class="botao sec" href={`/admin/cursos/${cu.id}`}>Voltar</a></div>
        </form>
      </div>
      <div class="cartao">
        <h2>Exemplos com os parâmetros salvos</h2>
        <table style="max-width:560px">
          <tr><th class="n">Média</th><th class="n">Exame</th><th class="n">Média final</th></tr>
          {[[4, 6], [4.5, 5.5], [5, 4], [3, 8]].map(([m, e]) => (
            <tr><td class="n">{numBR(m)}</td><td class="n">{numBR(e)}</td><td class="n">{ex(m, e)}</td></tr>
          ))}
        </table>
      </div>
    </Pagina>
  );
};

async function carregar(c: any) {
  return c.env.DB.prepare('SELECT * FROM cursos WHERE id = ?').bind(Number(c.req.param('id'))).first();
}

rotasCursos.get('/:id{[0-9]+}/parametros', async (c) => {
  const cu = await carregar(c);
  if (!cu) return c.notFound();
  return c.html(<FormParametros c={c} cu={cu} />);
});

rotasCursos.post('/:id{[0-9]+}/parametros', async (c) => {
  const cu = await carregar(c);
  if (!cu) return c.notFound();
  const corpo = await lerCorpo(c);
  let d;
  try {
    d = {
      frequencia_minima: numero(corpo, 'frequencia_minima', 'Frequência mínima'),
      nota_minima: numero(corpo, 'nota_minima', 'Média mínima'),
      nota_minima_exame: numero(corpo, 'nota_minima_exame', 'Média após exame'),
      metodo_exame: texto(corpo, 'metodo_exame') as MetodoExame,
      peso_media: numero(corpo, 'peso_media', 'Peso da média') ?? 1,
      peso_exame: numero(corpo, 'peso_exame', 'Peso do exame') ?? 1,
    };
    if (d.frequencia_minima == null || d.frequencia_minima < 0 || d.frequencia_minima > 100) throw new ErroValidacao('Frequência mínima deve estar entre 0 e 100.');
    for (const k of ['nota_minima', 'nota_minima_exame'] as const) {
      const v = d[k];
      if (v == null || v < 0 || v > 10) throw new ErroValidacao('Notas mínimas devem estar entre 0 e 10.');
    }
    if (!(d.metodo_exame in ROTULO_METODO)) throw new ErroValidacao('Método de cálculo inválido.');
    if (d.peso_media < 0 || d.peso_exame < 0 || d.peso_media + d.peso_exame <= 0) throw new ErroValidacao('Pesos inválidos.');
  } catch (e) {
    if (e instanceof ErroValidacao) return c.html(<FormParametros c={c} cu={cu} erro={e.message} />, 400);
    throw e;
  }
  const cols = Object.keys(d) as (keyof typeof d)[];
  await c.env.DB.prepare(`UPDATE cursos SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .bind(...cols.map((k) => d[k]), cu.id)
    .run();
  const antes = Object.fromEntries(cols.map((k) => [k, cu[k]]));
  await auditar(c, 'atualizar_parametros', 'curso', cu.id, antes, d);
  return c.redirect(`/admin/cursos/${cu.id}?ok=` + encodeURIComponent('Parâmetros de aprovação salvos.'));
});

// ---------------------------------------------------------------------
// Perfil profissional e competências (verso do histórico escolar)
// ---------------------------------------------------------------------
const linhasCompetencias = (t: string | null) => (t ?? '').split('\n').map((x) => x.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);

rotasCursos.get('/:id{[0-9]+}/modulos', async (c) => {
  const cu = await carregar(c);
  if (!cu) return c.notFound();
  const modulos = (
    await c.env.DB.prepare(
      `SELECT mt.*, mc.versao FROM modulos_tematicos mt JOIN matrizes_curriculares mc ON mc.id = mt.matriz_id
        WHERE mc.curso_id = ? ORDER BY mc.versao DESC, mt.ordem`,
    ).bind(cu.id).all<Record<string, any>>()
  ).results;
  return c.html(
    <Pagina voltar={`/admin/cursos/${cu.id}`} titulo="Perfil e competências" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Perfil profissional e competências</h1>
      <p class="muted" style="margin-top:-.6rem"><b>{cu.nome}</b> · textos do PPC impressos no verso do histórico escolar.
        Documentos já emitidos não mudam ao editar.</p>
      <div class="cartao">
        <h2 style="margin-top:0">Perfil profissional de conclusão do curso</h2>
        <form method="post" action={`/admin/cursos/${cu.id}/perfil`}>
          <textarea name="perfil_profissional_conclusao" rows={6} style="width:100%">{cu.perfil_profissional_conclusao ?? ''}</textarea>
          <p class="muted">Usado no histórico quando o módulo não tiver perfil próprio.</p>
          <button>Salvar perfil do curso</button>
        </form>
      </div>
      <table>
        <tr><th>Módulo</th><th>Qualificação</th><th>Perfil profissional</th><th class="c">Competências</th><th></th></tr>
        {modulos.map((m) => (
          <tr>
            <td>{m.ordem}. {m.nome}<div class="muted">matriz v{m.versao} · {m.carga_horaria} h</div></td>
            <td>{m.qualificacao_conferida}</td>
            <td>{m.perfil_profissional ? <span class="tag ok">cadastrado</span> : <span class="tag aviso">pendente</span>}</td>
            <td class="c">{linhasCompetencias(m.competencias).length || <span class="tag aviso">pendente</span>}</td>
            <td><a href={`/admin/cursos/${cu.id}/modulos/${m.id}`}>editar</a></td>
          </tr>
        ))}
      </table>
    </Pagina>,
  );
});

rotasCursos.post('/:id{[0-9]+}/perfil', async (c) => {
  const cu = await carregar(c);
  if (!cu) return c.notFound();
  const perfil = texto(await lerCorpo(c), 'perfil_profissional_conclusao');
  await c.env.DB.prepare(`UPDATE cursos SET perfil_profissional_conclusao = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).bind(perfil, cu.id).run();
  await auditar(c, 'atualizar_perfil', 'curso', cu.id, { perfil_profissional_conclusao: cu.perfil_profissional_conclusao }, { perfil_profissional_conclusao: perfil });
  return c.redirect(`/admin/cursos/${cu.id}/modulos?ok=` + encodeURIComponent('Perfil do curso salvo.'));
});

async function carregarModulo(c: any) {
  return (c.env.DB as D1Database).prepare(
    `SELECT mt.* FROM modulos_tematicos mt JOIN matrizes_curriculares mc ON mc.id = mt.matriz_id WHERE mt.id = ? AND mc.curso_id = ?`,
  ).bind(Number(c.req.param('mid')), Number(c.req.param('id'))).first<Record<string, any>>();
}

const FormModulo = ({ c, m, erro }: { c: any; m: Record<string, any>; erro?: string }) => (
  <Pagina voltar={`/admin/cursos/${c.req.param('id')}/modulos`} titulo={`Módulo ${m.nome}`} usuario={c.get('usuario')} caminho={c.req.path} erro={erro}>
    <h1>Módulo {m.ordem}: {m.nome}</h1>
    <div class="cartao">
      <form method="post" class="grade">
        <Campo nome="qualificacao_conferida" rotulo="Qualificação conferida (título impresso no certificado)" valor={m.qualificacao_conferida} obrigatorio classe="largo" />
        <label class="largo">Perfil profissional de conclusão do módulo
          <textarea name="perfil_profissional" rows={7}>{m.perfil_profissional ?? ''}</textarea>
        </label>
        <label class="largo">Competências do módulo — uma por linha
          <textarea name="competencias" rows={10}>{m.competencias ?? ''}</textarea>
          <span class="muted">Copie do PPC. Cada linha vira um item da lista no verso do histórico.</span>
        </label>
        <div class="largo acoes"><button>Salvar</button></div>
      </form>
    </div>
  </Pagina>
);

rotasCursos.get('/:id{[0-9]+}/modulos/:mid{[0-9]+}', async (c) => {
  const m = await carregarModulo(c);
  if (!m) return c.notFound();
  return c.html(<FormModulo c={c} m={m} />);
});

rotasCursos.post('/:id{[0-9]+}/modulos/:mid{[0-9]+}', async (c) => {
  const m = await carregarModulo(c);
  if (!m) return c.notFound();
  const corpo = await lerCorpo(c);
  const d = {
    qualificacao_conferida: texto(corpo, 'qualificacao_conferida'),
    perfil_profissional: texto(corpo, 'perfil_profissional'),
    competencias: linhasCompetencias(texto(corpo, 'competencias')).join('\n') || null,
  };
  if (!d.qualificacao_conferida) return c.html(<FormModulo c={c} m={{ ...m, ...d }} erro="Informe a qualificação conferida." />, 400);
  await c.env.DB.prepare('UPDATE modulos_tematicos SET qualificacao_conferida = ?, perfil_profissional = ?, competencias = ? WHERE id = ?')
    .bind(d.qualificacao_conferida, d.perfil_profissional, d.competencias, m.id).run();
  const antes = { qualificacao_conferida: m.qualificacao_conferida, perfil_profissional: m.perfil_profissional, competencias: m.competencias };
  await auditar(c, 'atualizar', 'modulo_tematico', m.id, antes, d);
  return c.redirect(`/admin/cursos/${c.req.param('id')}/modulos?ok=` + encodeURIComponent(`Módulo ${m.nome} salvo.`));
});
