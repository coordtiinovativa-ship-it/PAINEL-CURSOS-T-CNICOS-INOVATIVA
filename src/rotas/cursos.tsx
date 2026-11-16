import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Pagina, Selecao } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, lerCorpo, numBR, numero, texto } from '../lib/form';
import { calcularMediaFinal, criteriosDoCurso, ROTULO_METODO, type MetodoExame } from '../lib/aprovacao';

export const rotasCursos = new Hono<Env>();
rotasCursos.use('*', exigir('cursos.editar'));

rotasCursos.get('/', async (c) => {
  const cursos = (
    await c.env.DB.prepare(
      `SELECT cu.*, e.nome AS eixo FROM cursos cu LEFT JOIN eixos_tecnologicos e ON e.id = cu.eixo_id ORDER BY cu.nome`,
    ).all<Record<string, any>>()
  ).results;
  return c.html(
    <Pagina titulo="Cursos" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Cursos</h1>
      <table>
        <tr><th>Curso</th><th>Eixo</th><th class="n">CH</th><th>Aprovação</th><th></th></tr>
        {cursos.map((cu) => {
          const cr = criteriosDoCurso(cu as any);
          return (
            <tr>
              <td>{cu.nome}<div class="muted">{cu.nivel}</div></td>
              <td>{cu.eixo}</td>
              <td class="n">{cu.carga_horaria_total} h</td>
              <td class="muted">
                freq. ≥ {numBR(cr.frequenciaMinima)}% · média ≥ {numBR(cr.notaMinima)} · após exame ≥ {numBR(cr.notaMinimaExame)}
                <br />{ROTULO_METODO[cr.metodoExame]}
                {cr.metodoExame === 'media_ponderada' ? ` (pesos ${numBR(cr.pesoMedia)} e ${numBR(cr.pesoExame)})` : ''}
              </td>
              <td><a href={`/admin/cursos/${cu.id}/parametros`}>parâmetros de aprovação</a></td>
            </tr>
          );
        })}
      </table>
    </Pagina>,
  );
});

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
          <div class="largo acoes"><button>Salvar parâmetros</button><a class="botao sec" href="/admin/cursos">Voltar</a></div>
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
  return c.redirect('/admin/cursos?ok=' + encodeURIComponent('Parâmetros de aprovação salvos.'));
});
