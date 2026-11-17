/**
 * Gestão Pedagógica → Ano Letivo e Calendário Escolar.
 * O ano letivo limita as datas de aula; o calendário tira feriados, recessos e pontos facultativos da chamada.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Icone, Pagina, Selecao } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, inteiro, lerCorpo, texto } from '../lib/form';
import { dataBR } from '../lib/datas';
import { contarDiasLetivos, diaDaSemana, diasEntre, feriadosNacionais, ROTULO_EVENTO, TIPOS_EVENTO, TIPOS_NAO_LETIVOS, type AnoLetivo } from '../lib/pedagogico';

export const rotasCalendario = new Hono<Env>();
// montado em /admin/pedagogico junto com outras telas: a permissão vale só para os caminhos deste arquivo
for (const p of ['/anos', '/anos/*', '/calendario', '/calendario/*']) rotasCalendario.use(p, exigir('pedagogico.gerenciar'));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const CSS = `
.meses{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.8rem}
.mes{background:var(--superficie);border:1px solid var(--borda);border-radius:12px;padding:.6rem .7rem;box-shadow:var(--sombra)}
.mes h3{margin:0 0 .4rem;font-size:.9rem;color:var(--titulo)}
.mes table{box-shadow:none;border:0;font-size:.76rem}
.mes th,.mes td{padding:.18rem 0;text-align:center;border:0}
.mes th{background:none}
.mes td.fora{color:transparent}
.mes td.fds{color:var(--texto-2);opacity:.6}
.mes td.nao{background:var(--erro-bg);color:var(--erro);font-weight:700;border-radius:6px}
.mes td.extra{background:var(--ok-bg);color:var(--ok);font-weight:700;border-radius:6px}
.mes td.evento{outline:1px dashed var(--ciano);border-radius:6px}
.mes td.fora-ano{opacity:.25}
.legenda{display:flex;gap:.8rem;flex-wrap:wrap;font-size:.8rem;color:var(--texto-2);margin:.4rem 0 .8rem}
.legenda span{display:inline-flex;align-items:center;gap:.3rem}
.legenda i{width:12px;height:12px;border-radius:3px;display:inline-block}
`;

// ------------------------------------------------------------------ ano letivo
const lerAno = (corpo: Record<string, any>) => {
  const d = {
    ano: inteiro(corpo, 'ano', 'Ano'),
    data_inicio: texto(corpo, 'data_inicio'),
    data_fim: texto(corpo, 'data_fim'),
    situacao: texto(corpo, 'situacao') === 'encerrado' ? 'encerrado' : 'aberto',
    observacao: texto(corpo, 'observacao'),
  };
  if (!d.ano || d.ano < 2000 || d.ano > 2100) throw new ErroValidacao('Informe o ano (ex.: 2026).');
  if (!d.data_inicio || !ISO.test(d.data_inicio) || !d.data_fim || !ISO.test(d.data_fim)) throw new ErroValidacao('Informe o início e o término do ano letivo.');
  if (d.data_fim <= d.data_inicio) throw new ErroValidacao('O término deve ser depois do início.');
  return d;
};

rotasCalendario.get('/anos', async (c) => {
  const db = c.env.DB;
  const anos = (await db.prepare(
    `SELECT a.*, (SELECT count(*) FROM turmas t WHERE t.ano_letivo = a.ano) AS turmas,
            (SELECT count(*) FROM calendario_eventos e WHERE e.ano_letivo_id = a.id) AS eventos
       FROM anos_letivos a ORDER BY a.ano DESC`,
  ).all<AnoLetivo & { turmas: number; eventos: number }>()).results;
  const dias = await Promise.all(anos.map((a) => contarDiasLetivos(db, a)));
  const editar = anos.find((a) => a.id === Number(c.req.query('editar')));
  return c.html(
    <Pagina titulo="Ano letivo" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <h1>Ano letivo</h1>
      <table>
        <tr><th>Ano</th><th>Período</th><th class="n">Dias letivos</th><th class="n">Turmas</th><th class="n">Eventos no calendário</th><th>Situação</th><th></th></tr>
        {anos.map((a, i) => (
          <tr>
            <td><b>{a.ano}</b></td>
            <td>{dataBR(a.data_inicio)} a {dataBR(a.data_fim)}</td>
            <td class="n">{dias[i]}</td>
            <td class="n">{a.turmas}</td>
            <td class="n">{a.eventos}</td>
            <td><span class={`tag ${a.situacao === 'aberto' ? 'ok' : ''}`}>{a.situacao}</span></td>
            <td style="white-space:nowrap"><a href={`/admin/pedagogico/calendario?ano=${a.ano}`}>calendário</a> · <a href={`/admin/pedagogico/anos?editar=${a.id}`}>editar</a></td>
          </tr>
        ))}
      </table>
      {!anos.length && <p class="muted">Nenhum ano letivo cadastrado.</p>}
      <p class="muted">Dias letivos = segunda a sexta dentro do período, mais os dias letivos extras, menos feriados, recessos e pontos facultativos do calendário.</p>

      <h2>{editar ? `Editar ${editar.ano}` : 'Novo ano letivo'}</h2>
      <div class="cartao">
        <form method="post" action={editar ? `/admin/pedagogico/anos/${editar.id}` : '/admin/pedagogico/anos'} class="grade">
          <Campo nome="ano" rotulo="Ano" tipo="number" valor={editar?.ano ?? new Date().getFullYear() + (anos.length ? 1 : 0)} obrigatorio />
          <Campo nome="data_inicio" rotulo="Início" tipo="date" valor={editar?.data_inicio} obrigatorio />
          <Campo nome="data_fim" rotulo="Término" tipo="date" valor={editar?.data_fim} obrigatorio />
          <Selecao nome="situacao" rotulo="Situação" valor={editar?.situacao ?? 'aberto'} opcoes={[['aberto', 'Aberto'], ['encerrado', 'Encerrado']]} />
          <Campo nome="observacao" rotulo="Observação" valor={editar?.observacao} classe="largo" />
          <div class="largo acoes"><button><Icone nome="salvar" />Salvar</button>{editar && <a class="botao sec" href="/admin/pedagogico/anos">Cancelar</a>}</div>
        </form>
      </div>
    </Pagina>,
  );
});

rotasCalendario.post('/anos', async (c) => {
  let d;
  try {
    d = lerAno(await lerCorpo(c));
    if (await c.env.DB.prepare('SELECT 1 FROM anos_letivos WHERE ano = ?').bind(d.ano).first()) throw new ErroValidacao(`O ano letivo ${d.ano} já existe.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect('/admin/pedagogico/anos?erro=' + encodeURIComponent(e.message));
    throw e;
  }
  const r = await c.env.DB.prepare('INSERT INTO anos_letivos (ano, data_inicio, data_fim, situacao, observacao) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(d.ano, d.data_inicio, d.data_fim, d.situacao, d.observacao).first<{ id: number }>();
  await auditar(c, 'criar', 'ano_letivo', r!.id, null, d);
  return c.redirect('/admin/pedagogico/anos?ok=' + encodeURIComponent(`Ano letivo ${d.ano} cadastrado. Inclua os feriados e recessos no calendário.`));
});

rotasCalendario.post('/anos/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const antes = await c.env.DB.prepare('SELECT * FROM anos_letivos WHERE id = ?').bind(id).first<AnoLetivo>();
  if (!antes) return c.notFound();
  let d;
  try {
    d = lerAno(await lerCorpo(c));
    if (d.ano !== antes.ano && (await c.env.DB.prepare('SELECT 1 FROM turmas WHERE ano_letivo = ?').bind(antes.ano).first())) {
      throw new ErroValidacao(`Há turmas no ano letivo ${antes.ano}: o ano não pode ser trocado (ajuste só as datas).`);
    }
    if (d.ano !== antes.ano && (await c.env.DB.prepare('SELECT 1 FROM anos_letivos WHERE ano = ? AND id <> ?').bind(d.ano, id).first())) {
      throw new ErroValidacao(`O ano letivo ${d.ano} já existe.`);
    }
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect(`/admin/pedagogico/anos?editar=${id}&erro=` + encodeURIComponent(e.message));
    throw e;
  }
  await c.env.DB.prepare('UPDATE anos_letivos SET ano = ?, data_inicio = ?, data_fim = ?, situacao = ?, observacao = ? WHERE id = ?')
    .bind(d.ano, d.data_inicio, d.data_fim, d.situacao, d.observacao, id).run();
  await auditar(c, 'atualizar', 'ano_letivo', id, antes, d);
  return c.redirect('/admin/pedagogico/anos?ok=' + encodeURIComponent(`Ano letivo ${d.ano} salvo.`));
});

// ------------------------------------------------------------------ calendário
async function anoDaConsulta(db: D1Database, ano: string | undefined): Promise<{ anos: AnoLetivo[]; atual: AnoLetivo | null }> {
  const anos = (await db.prepare('SELECT * FROM anos_letivos ORDER BY ano DESC').all<AnoLetivo>()).results;
  const pedido = Number(ano);
  const atual = anos.find((a) => a.ano === pedido) ?? anos.find((a) => a.ano === new Date().getFullYear()) ?? anos[0] ?? null;
  return { anos, atual };
}

rotasCalendario.get('/calendario', async (c) => {
  const db = c.env.DB;
  const { anos, atual } = await anoDaConsulta(db, c.req.query('ano'));
  if (!atual) {
    return c.html(
      <Pagina titulo="Calendário escolar" usuario={c.get('usuario')} caminho={c.req.path}>
        <h1>Calendário escolar</h1>
        <p class="muted">Cadastre primeiro o <a href="/admin/pedagogico/anos">ano letivo</a>.</p>
      </Pagina>,
    );
  }
  const eventos = (await db.prepare('SELECT * FROM calendario_eventos WHERE ano_letivo_id = ? ORDER BY data_inicio, id').bind(atual.id)
    .all<{ id: number; data_inicio: string; data_fim: string; tipo: string; descricao: string }>()).results;
  const porDia = new Map<string, { tipo: string; descricao: string }[]>();
  for (const e of eventos) for (const d of diasEntre(e.data_inicio, e.data_fim)) porDia.set(d, [...(porDia.get(d) ?? []), e]);
  const diasLetivos = await contarDiasLetivos(db, atual);
  const anoNum = atual.ano;

  const Mes = ({ m }: { m: number }) => {
    const primeiro = `${anoNum}-${String(m + 1).padStart(2, '0')}-01`;
    const ultimo = new Date(Date.UTC(anoNum, m + 1, 0)).toISOString().slice(0, 10);
    const dias = [...diasEntre(primeiro, ultimo)];
    const vazios = diaDaSemana(primeiro) - 1; // semana começando na segunda
    const celulas = [...Array(vazios).fill(null), ...dias];
    const semanas: (string | null)[][] = [];
    for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
    return (
      <div class="mes">
        <h3>{MESES[m]}</h3>
        <table>
          <tr>{['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d) => <th>{d}</th>)}</tr>
          {semanas.map((s) => (
            <tr>{[...s, ...Array(7 - s.length).fill(null)].map((d) => {
              if (!d) return <td class="fora">·</td>;
              const evs = porDia.get(d) ?? [];
              const nao = evs.some((e) => TIPOS_NAO_LETIVOS.includes(e.tipo));
              const extra = evs.some((e) => e.tipo === 'dia_letivo_extra');
              const classe = [
                d < atual.data_inicio || d > atual.data_fim ? 'fora-ano' : '',
                nao ? 'nao' : extra ? 'extra' : diaDaSemana(d) >= 6 ? 'fds' : '',
                evs.some((e) => e.tipo === 'evento') ? 'evento' : '',
              ].filter(Boolean).join(' ');
              return <td class={classe} title={evs.map((e) => `${ROTULO_EVENTO[e.tipo]}: ${e.descricao}`).join('\n') || undefined}>{Number(d.slice(8))}</td>;
            })}</tr>
          ))}
        </table>
      </div>
    );
  };

  return c.html(
    <Pagina titulo={`Calendário ${anoNum}`} usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Calendário escolar {anoNum}</h1>
      <div class="acoes" style="margin-top:0">
        <form method="get" class="acoes" style="margin:0">
          <select name="ano" onchange="this.form.submit()">{anos.map((a) => <option value={a.ano} selected={a.id === atual.id}>{a.ano}</option>)}</select>
        </form>
        <span class="muted">{dataBR(atual.data_inicio)} a {dataBR(atual.data_fim)} · <b>{diasLetivos}</b> dias letivos</span>
        <form method="post" action={`/admin/pedagogico/calendario/${atual.id}/feriados`} style="margin:0"
          onsubmit="return confirm('Incluir os feriados nacionais (e Carnaval/Corpus Christi como ponto facultativo) deste ano? Datas já cadastradas não se repetem.')">
          <button class="sec"><Icone nome="incluir" />Incluir feriados nacionais</button>
        </form>
      </div>
      <div class="legenda">
        <span><i style="background:var(--erro-bg);outline:1px solid var(--erro)" />Não letivo (feriado, recesso, ponto facultativo)</span>
        <span><i style="background:var(--ok-bg);outline:1px solid var(--ok)" />Dia letivo extra</span>
        <span><i style="outline:1px dashed var(--ciano)" />Evento</span>
      </div>
      <div class="meses">{MESES.map((_, m) => <Mes m={m} />)}</div>

      <h2>Incluir no calendário</h2>
      <div class="cartao">
        <form method="post" action={`/admin/pedagogico/calendario/${atual.id}/eventos`} class="grade">
          <Selecao nome="tipo" rotulo="Tipo" valor="feriado" opcoes={TIPOS_EVENTO.map(([t, r]) => [t, r] as [string, string])} obrigatorio />
          <Campo nome="data_inicio" rotulo="Data (ou início)" tipo="date" obrigatorio extra={{ min: atual.data_inicio.slice(0, 4) + '-01-01', max: atual.data_fim.slice(0, 4) + '-12-31' }} />
          <Campo nome="data_fim" rotulo="Término (para recesso/período)" tipo="date" dica="Deixe em branco para um dia só." />
          <Campo nome="descricao" rotulo="Descrição" obrigatorio classe="largo" extra={{ placeholder: 'Ex.: Aniversário de Campo Grande, Recesso escolar de julho' }} />
          <div class="largo acoes"><button><Icone nome="incluir" />Incluir</button></div>
        </form>
      </div>

      <h2>Eventos do ano</h2>
      <table>
        <tr><th>Data</th><th>Tipo</th><th>Descrição</th><th></th></tr>
        {eventos.map((e) => (
          <tr>
            <td style="white-space:nowrap">{dataBR(e.data_inicio)}{e.data_fim !== e.data_inicio && <> a {dataBR(e.data_fim)}</>}</td>
            <td><span class={`tag ${TIPOS_NAO_LETIVOS.includes(e.tipo) ? 'erro' : e.tipo === 'dia_letivo_extra' ? 'ok' : ''}`}>{ROTULO_EVENTO[e.tipo]}</span></td>
            <td>{e.descricao}</td>
            <td><form method="post" action={`/admin/pedagogico/calendario/eventos/${e.id}/excluir`} onsubmit="return confirm('Excluir este evento do calendário?')">
              <button class="sec" style="padding:.2rem .5rem;color:var(--erro)">excluir</button></form></td>
          </tr>
        ))}
      </table>
      {!eventos.length && <p class="muted">Nenhum evento cadastrado. Use "Incluir feriados nacionais" e cadastre os feriados municipais/estaduais e recessos.</p>}
    </Pagina>,
  );
});

async function chamadasEmDatas(db: D1Database, inicio: string, fim: string): Promise<number> {
  return (await db.prepare('SELECT count(*) AS n FROM aulas WHERE data BETWEEN ? AND ?').bind(inicio, fim).first<{ n: number }>())?.n ?? 0;
}

rotasCalendario.post('/calendario/:ano{[0-9]+}/eventos', async (c) => {
  const db = c.env.DB;
  const a = await db.prepare('SELECT * FROM anos_letivos WHERE id = ?').bind(Number(c.req.param('ano'))).first<AnoLetivo>();
  if (!a) return c.notFound();
  const corpo = await lerCorpo(c);
  const volta = `/admin/pedagogico/calendario?ano=${a.ano}`;
  let d;
  try {
    d = { tipo: texto(corpo, 'tipo') ?? '', data_inicio: texto(corpo, 'data_inicio') ?? '', data_fim: texto(corpo, 'data_fim'), descricao: texto(corpo, 'descricao') };
    if (!TIPOS_EVENTO.some(([t]) => t === d!.tipo)) throw new ErroValidacao('Selecione o tipo.');
    if (!ISO.test(d.data_inicio)) throw new ErroValidacao('Informe a data.');
    d.data_fim = d.data_fim ?? d.data_inicio;
    if (!ISO.test(d.data_fim) || d.data_fim < d.data_inicio) throw new ErroValidacao('O término deve ser igual ou depois do início.');
    if (!d.descricao) throw new ErroValidacao('Informe a descrição.');
    if (d.data_inicio.slice(0, 4) !== String(a.ano) && d.data_fim.slice(0, 4) !== String(a.ano)) throw new ErroValidacao(`A data deve ser do ano ${a.ano}.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect(`${volta}&erro=` + encodeURIComponent(e.message));
    throw e;
  }
  const r = await db.prepare('INSERT INTO calendario_eventos (ano_letivo_id, data_inicio, data_fim, tipo, descricao) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(a.id, d.data_inicio, d.data_fim, d.tipo, d.descricao).first<{ id: number }>();
  await auditar(c, 'criar', 'calendario_evento', r!.id, null, d);
  const chamadas = TIPOS_NAO_LETIVOS.includes(d.tipo) ? await chamadasEmDatas(db, d.data_inicio, d.data_fim) : 0;
  const msg = chamadas
    ? `Incluído. Atenção: já há ${chamadas} aula(s) com chamada registrada nessas datas — confira em Faltas do Aluno.`
    : 'Incluído no calendário.';
  return c.redirect(`${volta}&ok=` + encodeURIComponent(msg));
});

rotasCalendario.post('/calendario/:ano{[0-9]+}/feriados', async (c) => {
  const db = c.env.DB;
  const a = await db.prepare('SELECT * FROM anos_letivos WHERE id = ?').bind(Number(c.req.param('ano'))).first<AnoLetivo>();
  if (!a) return c.notFound();
  const existentes = new Set((await db.prepare('SELECT data_inicio FROM calendario_eventos WHERE ano_letivo_id = ?').bind(a.id).all<{ data_inicio: string }>()).results.map((e) => e.data_inicio));
  const novos = feriadosNacionais(a.ano).filter((f) => !existentes.has(f.data));
  if (novos.length) {
    await db.batch(novos.map((f) => db.prepare('INSERT INTO calendario_eventos (ano_letivo_id, data_inicio, data_fim, tipo, descricao) VALUES (?, ?, ?, ?, ?)')
      .bind(a.id, f.data, f.data, f.tipo, f.descricao)));
    await auditar(c, 'incluir_feriados_nacionais', 'ano_letivo', a.id, null, { incluidos: novos });
  }
  return c.redirect(`/admin/pedagogico/calendario?ano=${a.ano}&ok=` + encodeURIComponent(`${novos.length} feriado(s) nacional(is) incluído(s). Cadastre também os municipais e estaduais.`));
});

rotasCalendario.post('/calendario/eventos/:id{[0-9]+}/excluir', async (c) => {
  const e = await c.env.DB.prepare('SELECT e.*, a.ano FROM calendario_eventos e JOIN anos_letivos a ON a.id = e.ano_letivo_id WHERE e.id = ?')
    .bind(Number(c.req.param('id'))).first<Record<string, any>>();
  if (!e) return c.notFound();
  await c.env.DB.prepare('DELETE FROM calendario_eventos WHERE id = ?').bind(e.id).run();
  await auditar(c, 'excluir', 'calendario_evento', e.id, e, null);
  return c.redirect(`/admin/pedagogico/calendario?ano=${e.ano}&ok=` + encodeURIComponent('Evento excluído.'));
});
