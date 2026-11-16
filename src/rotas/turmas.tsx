import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Pagina, Selecao } from '../views/layout';
import { exigir } from '../auth/sessao';
import { pode } from '../auth/permissoes';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, inteiro, lerCorpo, numBR, numero, texto } from '../lib/form';
import { dataBR } from '../lib/datas';
import { formatarCPF } from '../lib/cpf';
import { avaliarDisciplina, criteriosDoCurso, ROTULO_METODO } from '../lib/aprovacao';

export const rotasTurmas = new Hono<Env>();
rotasTurmas.use('*', exigir('turmas.editar'));

const TURNOS: [string, string][] = [['matutino', 'Matutino'], ['vespertino', 'Vespertino'], ['noturno', 'Noturno'], ['integral', 'Integral']];
const SITUACOES: [string, string][] = [['cursando', 'Cursando'], ['concluído', 'Concluído'], ['reprovado', 'Reprovado'], ['desistente', 'Desistente']];

rotasTurmas.get('/', async (c) => {
  const turmas = (
    await c.env.DB.prepare(
      `SELECT t.*, cu.nome AS curso, (SELECT count(*) FROM matriculas m WHERE m.turma_id = t.id) AS alunos
         FROM turmas t JOIN cursos cu ON cu.id = t.curso_id ORDER BY t.data_inicio DESC, t.codigo`,
    ).all<Record<string, any>>()
  ).results;
  return c.html(
    <Pagina titulo="Turmas" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Turmas</h1>
      <div class="acoes"><a class="botao" href="/admin/turmas/nova">+ Nova turma</a></div>
      <table>
        <tr><th>Código</th><th>Curso</th><th>Período</th><th>Turno</th><th>Ano letivo</th><th class="n">Alunos</th><th></th></tr>
        {turmas.map((t) => (
          <tr>
            <td><a href={`/admin/turmas/${t.id}`}>{t.codigo}</a></td>
            <td>{t.curso}</td>
            <td>{t.data_inicio ? dataBR(t.data_inicio) : '?'} a {t.data_fim ? dataBR(t.data_fim) : '?'}</td>
            <td>{t.turno ?? ''}</td>
            <td>{t.ano_letivo ?? ''}</td>
            <td class="n">{t.alunos}</td>
            <td><a href={`/admin/turmas/${t.id}`}>abrir</a></td>
          </tr>
        ))}
      </table>
    </Pagina>,
  );
});

const CAMPOS_TURMA = ['codigo', 'polo', 'data_inicio', 'data_fim', 'turno'] as const;

function lerTurma(corpo: Awaited<ReturnType<typeof lerCorpo>>) {
  const d: Record<string, string | number | null> = Object.fromEntries(CAMPOS_TURMA.map((k) => [k, texto(corpo, k)]));
  d.ano_letivo = inteiro(corpo, 'ano_letivo', 'Ano letivo');
  if (!d.codigo) throw new ErroValidacao('Informe o código da turma.');
  if (d.data_inicio && d.data_fim && String(d.data_fim) < String(d.data_inicio)) throw new ErroValidacao('Data de término anterior ao início.');
  return d;
}

const FormTurma = async ({ c, t, erro }: { c: any; t?: Record<string, any>; erro?: string }) => {
  const matrizes = (
    await c.env.DB.prepare(
      `SELECT mc.id, cu.nome || ' — matriz v' || mc.versao AS rotulo FROM matrizes_curriculares mc
         JOIN cursos cu ON cu.id = mc.curso_id WHERE cu.ativo = 1 ORDER BY cu.nome, mc.versao DESC`,
    ).all()
  ).results as { id: number; rotulo: string }[];
  return (
    <form method="post" class="grade">
      {!t?.id && (
        <Selecao nome="matriz_id" rotulo="Curso / matriz curricular" valor={t?.matriz_id} obrigatorio classe="largo"
          opcoes={matrizes.map((m) => [m.id, m.rotulo] as [number, string])} />
      )}
      <Campo nome="codigo" rotulo="Código" valor={t?.codigo} obrigatorio dica="Ex.: TIDC-2026-1" />
      <Campo nome="polo" rotulo="Polo / local" valor={t?.polo} />
      <Campo nome="data_inicio" rotulo="Início" tipo="date" valor={t?.data_inicio} />
      <Campo nome="data_fim" rotulo="Término" tipo="date" valor={t?.data_fim} />
      <Selecao nome="turno" rotulo="Turno" valor={t?.turno} opcoes={TURNOS} vazio="" />
      <Campo nome="ano_letivo" rotulo="Ano letivo" tipo="number" valor={t?.ano_letivo ?? new Date().getFullYear()} />
      <div class="largo acoes"><button>Salvar turma</button>{erro && <span class="tag erro">{erro}</span>}</div>
    </form>
  );
};

rotasTurmas.get('/nova', async (c) =>
  c.html(
    <Pagina titulo="Nova turma" usuario={c.get('usuario')} caminho={c.req.path}>
      <h1>Nova turma</h1>
      <div class="cartao">{await FormTurma({ c })}</div>
    </Pagina>,
  ),
);

rotasTurmas.post('/nova', async (c) => {
  const corpo = await lerCorpo(c);
  try {
    const d = lerTurma(corpo);
    const matrizId = inteiro(corpo, 'matriz_id');
    const matriz = await c.env.DB.prepare('SELECT id, curso_id FROM matrizes_curriculares WHERE id = ?').bind(matrizId).first<{ id: number; curso_id: number }>();
    if (!matriz) throw new ErroValidacao('Selecione a matriz curricular.');
    if (await c.env.DB.prepare('SELECT 1 FROM turmas WHERE codigo = ?').bind(d.codigo).first()) throw new ErroValidacao('Já existe turma com este código.');
    const cols = [...CAMPOS_TURMA, 'ano_letivo'];
    const r = await c.env.DB.prepare(
      `INSERT INTO turmas (curso_id, matriz_id, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')}) RETURNING id`,
    ).bind(matriz.curso_id, matriz.id, ...cols.map((k) => d[k])).first<{ id: number }>();
    await auditar(c, 'criar', 'turma', r!.id, null, { ...d, matriz_id: matriz.id });
    return c.redirect(`/admin/turmas/${r!.id}?ok=` + encodeURIComponent('Turma criada.'));
  } catch (e) {
    if (!(e instanceof ErroValidacao)) throw e;
    return c.html(
      <Pagina titulo="Nova turma" usuario={c.get('usuario')} caminho={c.req.path} erro={e.message}>
        <h1>Nova turma</h1>
        <div class="cartao">{await FormTurma({ c, t: Object.fromEntries(Object.entries(corpo).map(([k, v]) => [k, String(v)])) })}</div>
      </Pagina>,
      400,
    );
  }
});

async function carregarTurma(c: any): Promise<Record<string, any> | null> {
  return (c.env.DB as D1Database).prepare(
    `SELECT t.*, cu.nome AS curso, mc.versao FROM turmas t JOIN cursos cu ON cu.id = t.curso_id
       JOIN matrizes_curriculares mc ON mc.id = t.matriz_id WHERE t.id = ?`,
  ).bind(Number(c.req.param('id'))).first<Record<string, any>>();
}

rotasTurmas.get('/:id{[0-9]+}', async (c) => {
  const t = await carregarTurma(c);
  if (!t) return c.notFound();
  const db = c.env.DB;
  const matriculas = (
    await db.prepare(
      `SELECT m.*, a.nome_civil, a.nome_social, a.cpf, a.ra FROM matriculas m JOIN alunos a ON a.id = m.aluno_id
        WHERE m.turma_id = ? ORDER BY coalesce(a.nome_social, a.nome_civil)`,
    ).bind(t.id).all<Record<string, any>>()
  ).results;
  const disponiveis = (
    await db.prepare(
      `SELECT id, coalesce(nome_social, nome_civil) AS nome, cpf FROM alunos
        WHERE id NOT IN (SELECT aluno_id FROM matriculas WHERE turma_id = ?) ORDER BY 2`,
    ).bind(t.id).all<{ id: number; nome: string; cpf: string }>()
  ).results;
  const modulos = (
    await db.prepare(
      `SELECT mt.*, (SELECT count(*) FROM componentes_curriculares cc WHERE cc.modulo_id = mt.id) AS disciplinas
         FROM modulos_tematicos mt WHERE mt.matriz_id = ? ORDER BY mt.ordem`,
    ).bind(t.matriz_id).all<Record<string, any>>()
  ).results;
  const u = c.get('usuario');

  return c.html(
    <Pagina titulo={`Turma ${t.codigo}`} usuario={u} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <h1>Turma {t.codigo}</h1>
      <p>{t.curso} · matriz v{t.versao}</p>

      <h2>Módulos temáticos</h2>
      <table>
        <tr><th>Módulo</th><th>Qualificação</th><th class="n">CH</th><th class="n">Disciplinas</th><th></th></tr>
        {modulos.map((m) => (
          <tr>
            <td>{m.ordem}. {m.nome}</td>
            <td>{m.qualificacao_conferida}</td>
            <td class="n">{m.carga_horaria} h</td>
            <td class="n">{m.disciplinas}</td>
            <td><a href={`/admin/turmas/${t.id}/modulos/${m.id}`}>resultados e prévias</a></td>
          </tr>
        ))}
      </table>

      <h2>Alunos matriculados ({matriculas.length})</h2>
      <table>
        <tr><th>Aluno</th><th>CPF</th><th>RA</th><th>Situação</th><th></th></tr>
        {matriculas.map((m) => (
          <tr>
            <td><a href={`/admin/alunos/${m.aluno_id}`}>{m.nome_social ?? m.nome_civil}</a></td>
            <td>{formatarCPF(m.cpf)}</td>
            <td>{m.ra ?? ''}</td>
            <td>
              <form method="post" action={`/admin/turmas/${t.id}/matriculas/${m.id}`} class="acoes" style="margin:0">
                <select name="situacao">{SITUACOES.map(([v, r]) => <option value={v} selected={m.situacao === v}>{r}</option>)}</select>
                <button class="sec">salvar</button>
              </form>
            </td>
            <td>
              <form method="post" action={`/admin/turmas/${t.id}/matriculas/${m.id}/remover`} onsubmit="return confirm('Remover a matrícula? Só é possível se não houver resultados lançados.')">
                <button class="sec">remover</button>
              </form>
            </td>
          </tr>
        ))}
      </table>
      {disponiveis.length > 0 && (
        <form method="post" action={`/admin/turmas/${t.id}/matriculas`} class="acoes">
          <select name="aluno_id" required>
            <option value="">Selecione o aluno…</option>
            {disponiveis.map((a) => <option value={a.id}>{a.nome} — {formatarCPF(a.cpf)}</option>)}
          </select>
          <button>Matricular</button>
          <a href="/admin/alunos/novo">cadastrar novo aluno</a>
        </form>
      )}

      <h2>Dados da turma</h2>
      <div class="cartao">{await FormTurma({ c, t })}</div>
    </Pagina>,
  );
});

rotasTurmas.post('/:id{[0-9]+}', async (c) => {
  const t = await carregarTurma(c);
  if (!t) return c.notFound();
  const corpo = await lerCorpo(c);
  let d;
  try {
    d = lerTurma(corpo);
    if (await c.env.DB.prepare('SELECT 1 FROM turmas WHERE codigo = ? AND id <> ?').bind(d.codigo, t.id).first()) {
      throw new ErroValidacao('Já existe turma com este código.');
    }
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect(`/admin/turmas/${t.id}?erro=` + encodeURIComponent(e.message));
    throw e;
  }
  const cols = Object.keys(d);
  await c.env.DB.prepare(`UPDATE turmas SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((k) => d[k]), t.id).run();
  await auditar(c, 'atualizar', 'turma', t.id, Object.fromEntries(cols.map((k) => [k, t[k]])), d);
  return c.redirect(`/admin/turmas/${t.id}?ok=` + encodeURIComponent('Turma salva.'));
});

rotasTurmas.post('/:id{[0-9]+}/matriculas', async (c) => {
  const t = await carregarTurma(c);
  if (!t) return c.notFound();
  const alunoId = inteiro(await lerCorpo(c), 'aluno_id');
  const aluno = alunoId ? await c.env.DB.prepare('SELECT id FROM alunos WHERE id = ?').bind(alunoId).first() : null;
  if (!aluno) return c.redirect(`/admin/turmas/${t.id}?erro=` + encodeURIComponent('Aluno inválido.'));
  const r = await c.env.DB.prepare('INSERT INTO matriculas (aluno_id, turma_id) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING id')
    .bind(alunoId, t.id).first<{ id: number }>();
  if (r) await auditar(c, 'criar', 'matricula', r.id, null, { aluno_id: alunoId, turma_id: t.id });
  return c.redirect(`/admin/turmas/${t.id}?ok=` + encodeURIComponent('Aluno matriculado.'));
});

rotasTurmas.post('/:id{[0-9]+}/matriculas/:mid{[0-9]+}', async (c) => {
  const mid = Number(c.req.param('mid'));
  const tid = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM matriculas WHERE id = ? AND turma_id = ?').bind(mid, tid).first<Record<string, any>>();
  if (!m) return c.notFound();
  const situacao = texto(await lerCorpo(c), 'situacao');
  if (!SITUACOES.some(([v]) => v === situacao)) return c.redirect(`/admin/turmas/${tid}?erro=` + encodeURIComponent('Situação inválida.'));
  await c.env.DB.prepare('UPDATE matriculas SET situacao = ? WHERE id = ?').bind(situacao, mid).run();
  await auditar(c, 'atualizar', 'matricula', mid, { situacao: m.situacao }, { situacao });
  return c.redirect(`/admin/turmas/${tid}?ok=` + encodeURIComponent('Situação atualizada.'));
});

rotasTurmas.post('/:id{[0-9]+}/matriculas/:mid{[0-9]+}/remover', async (c) => {
  const mid = Number(c.req.param('mid'));
  const tid = Number(c.req.param('id'));
  const db = c.env.DB;
  const m = await db.prepare('SELECT * FROM matriculas WHERE id = ? AND turma_id = ?').bind(mid, tid).first();
  if (!m) return c.notFound();
  const temDados = await db.prepare(
    `SELECT 1 FROM resultados WHERE matricula_id = ?1 UNION ALL SELECT 1 FROM certificados WHERE matricula_id = ?1 LIMIT 1`,
  ).bind(mid).first();
  if (temDados) {
    return c.redirect(`/admin/turmas/${tid}?erro=` + encodeURIComponent('Matrícula com resultados lançados: altere a situação para "desistente" em vez de remover.'));
  }
  await db.prepare('DELETE FROM matriculas WHERE id = ?').bind(mid).run();
  await auditar(c, 'excluir', 'matricula', mid, m, null);
  return c.redirect(`/admin/turmas/${tid}?ok=` + encodeURIComponent('Matrícula removida.'));
});

// ---------------------------------------------------------------------
// Resultados do módulo (visão geral) e lançamento por disciplina
// ---------------------------------------------------------------------
async function contextoModulo(c: any) {
  const t = await carregarTurma(c);
  if (!t) return null;
  const db = c.env.DB as D1Database;
  const modulo = await db.prepare('SELECT * FROM modulos_tematicos WHERE id = ? AND matriz_id = ?')
    .bind(Number(c.req.param('mod')), t.matriz_id).first<Record<string, any>>();
  if (!modulo) return null;
  const curso = await db.prepare('SELECT * FROM cursos WHERE id = ?').bind(t.curso_id).first<any>();
  const componentes = (await db.prepare('SELECT * FROM componentes_curriculares WHERE modulo_id = ? ORDER BY ordem').bind(modulo.id).all<Record<string, any>>()).results;
  const matriculas = (
    await db.prepare(
      `SELECT m.id, m.situacao, coalesce(a.nome_social, a.nome_civil) AS nome, a.id AS aluno_id
         FROM matriculas m JOIN alunos a ON a.id = m.aluno_id WHERE m.turma_id = ? ORDER BY 3`,
    ).bind(t.id).all<Record<string, any>>()
  ).results;
  const resultados = (
    await db.prepare(
      `SELECT r.* FROM resultados r JOIN matriculas m ON m.id = r.matricula_id
        WHERE m.turma_id = ? AND r.componente_id IN (SELECT id FROM componentes_curriculares WHERE modulo_id = ?)`,
    ).bind(t.id, modulo.id).all<Record<string, any>>()
  ).results;
  const chave = (m: number, cc: number) => `${m}:${cc}`;
  const porChave = new Map(resultados.map((r) => [chave(r.matricula_id, r.componente_id), r]));
  return { t, modulo, curso, criterios: criteriosDoCurso(curso), componentes, matriculas, porChave, chave };
}

rotasTurmas.get('/:id{[0-9]+}/modulos/:mod{[0-9]+}', async (c) => {
  const ctx = await contextoModulo(c);
  if (!ctx) return c.notFound();
  const { t, modulo, componentes, matriculas, porChave, chave, criterios } = ctx;
  const u = c.get('usuario');
  const podePrevia = pode(u.perfil, 'relatorios.emitir');
  const podeEmitir = pode(u.perfil, 'certificados.emitir');
  const emitidos = new Map(
    (await (c.env.DB as D1Database).prepare(
      `SELECT ce.matricula_id, ce.id, ce.codigo_validacao FROM certificados ce JOIN matriculas m ON m.id = ce.matricula_id
        WHERE m.turma_id = ? AND ce.modulo_id = ? AND ce.status = 'válido'`,
    ).bind(t.id, modulo.id).all<{ matricula_id: number; id: number; codigo_validacao: string }>()).results.map((x) => [x.matricula_id, x]),
  );
  return c.html(
    <Pagina titulo={`${t.codigo} — ${modulo.nome}`} usuario={u} caminho={c.req.path} ok={c.req.query('ok')}>
      <p><a href={`/admin/turmas/${t.id}`}>← Turma {t.codigo}</a></p>
      <h1>Módulo {modulo.ordem}: {modulo.nome}</h1>
      <p class="muted">
        Qualificação: <b>{modulo.qualificacao_conferida}</b> · {modulo.carga_horaria} h ·
        Aprovação: freq. ≥ {numBR(criterios.frequenciaMinima)}% e média ≥ {numBR(criterios.notaMinima)}
        (ou ≥ {numBR(criterios.notaMinimaExame)} após exame — {ROTULO_METODO[criterios.metodoExame].toLowerCase()})
      </p>
      <div style="overflow-x:auto">
        <table>
          <tr>
            <th>Aluno</th>
            {componentes.map((cc) => (
              <th class="c" style="min-width:90px">
                <a href={`/admin/turmas/${t.id}/modulos/${modulo.id}/disciplinas/${cc.id}`} title="Lançar notas e frequência">{cc.nome}</a>
                <div class="muted">{cc.carga_horaria_total} h</div>
              </th>
            ))}
            <th class="c">Módulo</th>
            {podePrevia && <th>Certificado</th>}
            {podePrevia && <th>Documentos</th>}
          </tr>
          {matriculas.map((m) => {
            const av = componentes.map((cc) => {
              const r = porChave.get(chave(m.id, cc.id));
              return avaliarDisciplina(
                { componente: cc.nome, nota: r?.nota ?? null, notaExameFinal: r?.nota_exame_final ?? null, frequencia: r?.frequencia ?? null, aproveitada: !!r?.aproveitado_de_resultado_id },
                criterios,
              );
            });
            const status = av.some((a) => a.resultado === 'RP') ? 'RP' : av.some((a) => a.resultado === 'PENDENTE') ? 'PENDENTE' : 'AP';
            return (
              <tr>
                <td>{m.nome}{m.situacao !== 'cursando' && <div class="muted">{m.situacao}</div>}</td>
                {av.map((a) => (
                  <td class="c" title={a.motivos.join('\n')}>
                    <span class={`tag ${a.resultado}`}>{a.resultado === 'PENDENTE' ? '—' : a.resultado}</span>
                    {a.mediaFinal != null && <div class="muted">{numBR(a.mediaFinal, 2)}</div>}
                  </td>
                ))}
                <td class="c"><span class={`tag ${status}`}>{status === 'PENDENTE' ? 'pendente' : status === 'AP' ? 'Aprovado' : 'Reprovado'}</span></td>
                {podePrevia && (
                  <td style="white-space:nowrap">
                    {emitidos.get(m.id) ? (
                      <a href={`/admin/certificados/${emitidos.get(m.id)!.id}`}><span class="tag ok">{emitidos.get(m.id)!.codigo_validacao}</span></a>
                    ) : (
                      <>
                        <a href={`/admin/previa/${m.id}/${modulo.id}`} target="_blank">prévia</a>
                        {podeEmitir && status === 'AP' && <> · <a href={`/admin/certificados/emitir/${m.id}/${modulo.id}`}><b>emitir</b></a></>}
                      </>
                    )}
                  </td>
                )}
                {podePrevia && (
                  <td style="white-space:nowrap">
                    {status === 'AP' && <><a href={`/admin/documentos/declaracao_conclusao_modulo/${m.id}/${modulo.id}`}>declaração</a> · </>}
                    <a href={`/admin/documentos/historico_escolar/${m.id}/${modulo.id}`}>histórico</a>
                  </td>
                )}
              </tr>
            );
          })}
        </table>
      </div>
      <p class="muted">Clique no nome de uma disciplina para lançar notas e frequência. Passe o mouse sobre um resultado para ver o motivo.</p>
    </Pagina>,
  );
});

rotasTurmas.get('/:id{[0-9]+}/modulos/:mod{[0-9]+}/disciplinas/:comp{[0-9]+}', exigir('resultados.lancar'), async (c) => {
  const ctx = await contextoModulo(c);
  if (!ctx) return c.notFound();
  const { t, modulo, componentes, matriculas, porChave, chave, criterios } = ctx;
  const cc = componentes.find((x) => x.id === Number(c.req.param('comp')));
  if (!cc) return c.notFound();
  return c.html(
    <Pagina titulo={`${cc.nome} — ${t.codigo}`} usuario={c.get('usuario')} caminho={c.req.path} erro={c.req.query('erro')}>
      <p><a href={`/admin/turmas/${t.id}/modulos/${modulo.id}`}>← Módulo {modulo.nome}</a></p>
      <h1>{cc.nome}</h1>
      <p class="muted">Turma {t.codigo} · {cc.carga_horaria_total} h · notas de 0 a 10 (use vírgula ou ponto) · frequência em %</p>
      <form method="post">
        <table>
          <tr><th>Aluno</th><th class="n">Média</th><th class="n">Exame final</th><th class="n">Frequência (%)</th><th class="c">Resultado atual</th></tr>
          {matriculas.map((m) => {
            const r = porChave.get(chave(m.id, cc.id));
            const av = avaliarDisciplina({ componente: cc.nome, nota: r?.nota ?? null, notaExameFinal: r?.nota_exame_final ?? null, frequencia: r?.frequencia ?? null }, criterios);
            return (
              <tr>
                <td>{m.nome}</td>
                <td class="n"><input class="mini" name={`nota_${m.id}`} value={numBR(r?.nota, 2)} inputmode="decimal" /></td>
                <td class="n"><input class="mini" name={`exame_${m.id}`} value={numBR(r?.nota_exame_final, 2)} inputmode="decimal" /></td>
                <td class="n"><input class="mini" name={`freq_${m.id}`} value={numBR(r?.frequencia, 2)} inputmode="decimal" /></td>
                <td class="c" title={av.motivos.join('\n')}><span class={`tag ${av.resultado}`}>{av.resultado === 'PENDENTE' ? '—' : av.resultado}</span></td>
              </tr>
            );
          })}
        </table>
        <div class="acoes"><button>Salvar lançamentos</button></div>
      </form>
    </Pagina>,
  );
});

rotasTurmas.post('/:id{[0-9]+}/modulos/:mod{[0-9]+}/disciplinas/:comp{[0-9]+}', exigir('resultados.lancar'), async (c) => {
  const ctx = await contextoModulo(c);
  if (!ctx) return c.notFound();
  const { t, modulo, componentes, matriculas, porChave, chave, criterios } = ctx;
  const cc = componentes.find((x) => x.id === Number(c.req.param('comp')));
  if (!cc) return c.notFound();
  const corpo = await lerCorpo(c);
  const url = `/admin/turmas/${t.id}/modulos/${modulo.id}/disciplinas/${cc.id}`;
  const comandos: D1PreparedStatement[] = [];
  const alteracoes: Record<string, unknown>[] = [];
  try {
    for (const m of matriculas) {
      const nota = numero(corpo, `nota_${m.id}`, `Média de ${m.nome}`);
      const exame = numero(corpo, `exame_${m.id}`, `Exame de ${m.nome}`);
      const freq = numero(corpo, `freq_${m.id}`, `Frequência de ${m.nome}`);
      for (const [v, r, max] of [[nota, 'Média', 10], [exame, 'Exame', 10], [freq, 'Frequência', 100]] as const) {
        if (v != null && (v < 0 || v > max)) throw new ErroValidacao(`${r} de ${m.nome} fora do intervalo 0–${max}.`);
      }
      const antes = porChave.get(chave(m.id, cc.id));
      const igual = (antes?.nota ?? null) === nota && (antes?.nota_exame_final ?? null) === exame && (antes?.frequencia ?? null) === freq;
      if (igual || (!antes && nota == null && exame == null && freq == null)) continue;
      const av = avaliarDisciplina({ componente: cc.nome, nota, notaExameFinal: exame, frequencia: freq }, criterios);
      const resultado = av.resultado === 'PENDENTE' ? null : av.resultado;
      comandos.push(
        c.env.DB.prepare(
          `INSERT INTO resultados (matricula_id, componente_id, nota, nota_exame_final, frequencia, resultado)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (matricula_id, componente_id) DO UPDATE SET nota = excluded.nota, nota_exame_final = excluded.nota_exame_final,
             frequencia = excluded.frequencia, resultado = excluded.resultado, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
        ).bind(m.id, cc.id, nota, exame, freq, resultado),
      );
      alteracoes.push({
        matricula_id: m.id, aluno: m.nome,
        antes: antes ? { nota: antes.nota, exame: antes.nota_exame_final, frequencia: antes.frequencia } : null,
        depois: { nota, exame, frequencia: freq, resultado },
      });
    }
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect(`${url}?erro=` + encodeURIComponent(e.message));
    throw e;
  }
  if (comandos.length) {
    await c.env.DB.batch(comandos);
    await auditar(c, 'lancar_resultados', 'componente_curricular', cc.id, null, { turma: t.codigo, disciplina: cc.nome, alteracoes });
  }
  return c.redirect(`/admin/turmas/${t.id}/modulos/${modulo.id}?ok=` + encodeURIComponent(`${cc.nome}: ${comandos.length} lançamento(s) salvo(s).`));
});
