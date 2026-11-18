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
import {
  classificarDia, CODIGOS_DIA, contarDiasLetivos, diaDaSemana, diasEntre, ehLetivo, eventosPorDia, feriadosNacionais, ROTULO_EVENTO, TIPOS_EVENTO,
  TIPOS_NAO_LETIVOS, type AnoLetivo, type CodigoDia,
} from '../lib/pedagogico';

export const rotasCalendario = new Hono<Env>();
// montado em /admin/pedagogico junto com outras telas: a permissão vale só para os caminhos deste arquivo
for (const p of ['/anos', '/anos/*', '/calendario', '/calendario/*']) rotasCalendario.use(p, exigir('pedagogico.gerenciar'));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/* Calendário no padrão do sysGEP: cada dia é um bloco colorido com o código (L, D, S, SL, F, NL) */
const CSS = `
.acoes-cal{display:flex;gap:.7rem;flex-wrap:wrap;align-items:flex-end}
.resumo-cal{display:flex;gap:.5rem;flex-wrap:wrap;margin-left:auto}
.resumo-cal .chip{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .8rem;border-radius:999px;font-size:.84rem;border:1px solid}
.resumo-cal .chip svg{width:16px;height:16px}
.resumo-cal .periodo{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-borda)}
.resumo-cal .letivos{background:rgba(37,99,235,.12);color:#2563eb;border-color:rgba(37,99,235,.35)}
html[data-tema="escuro"] .resumo-cal .letivos{color:#93b4ff}
.resumo-cal .nao{background:var(--superficie-2);color:var(--texto-2);border-color:var(--borda)}
.titulo-cal{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:1.2rem 0 .7rem}
.titulo-cal h2{margin:0;font-size:1.5rem;background:linear-gradient(90deg,#2d7bb9,#7c5cf0);-webkit-background-clip:text;background-clip:text;color:transparent}
.vistas{display:flex;background:var(--superficie);border:1px solid var(--borda);border-radius:10px;padding:3px}
.vistas a{padding:.35rem .9rem;border-radius:8px;text-decoration:none;color:var(--texto-2);font-weight:600;font-size:.88rem}
.vistas a.ativa{background:var(--primaria);color:var(--primaria-texto)}
.grade-meses{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:1rem;align-items:start}
.mes-cal{background:var(--superficie);border:1px solid var(--borda);border-radius:14px;box-shadow:var(--sombra);overflow:hidden}
.mes-cal header{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.45rem .6rem;background:linear-gradient(90deg,#2563eb,#6d4fe6)}
.mes-cal header a{color:#fff;font-weight:700;text-decoration:none;font-size:.92rem}
.mes-cal header a:hover{text-decoration:underline}
.pilula{font-size:.78rem;font-weight:800;padding:.12rem .6rem;border-radius:999px;background:rgba(255,255,255,.92)}
.pilula.l{color:#1d4ed8} .pilula.nl{color:#9d174d}
.semana{display:grid;grid-template-columns:repeat(7,1fr);padding:.35rem .4rem 0;font-size:.66rem;font-weight:700;color:var(--texto-2);text-align:center}
.semana .dom{color:#e11d48}
.dias{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:.4rem}
.dia{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:space-between;min-height:46px;padding:.25rem 0 .15rem;
  border-radius:7px;border:0;font:inherit;font-size:.8rem;line-height:1.1;cursor:pointer;box-shadow:inset 0 -2px 0 rgba(0,0,0,.08)}
.dia b{font-weight:600} .dia small{font-size:.68rem;font-weight:800}
.dia:hover{filter:brightness(1.06);outline:2px solid var(--ciano);outline-offset:1px}
.dia.vazio{background:repeating-linear-gradient(135deg,var(--superficie-2) 0 6px,transparent 6px 12px);cursor:default;box-shadow:none;min-height:46px}
.dia.fora{background:var(--superficie-2);color:var(--texto-2);opacity:.45;cursor:default;justify-content:center}
.dia.tem-evento::after{content:"";position:absolute;top:4px;right:5px;width:6px;height:6px;border-radius:50%;background:#2563eb}
.c-L{background:#86efac;color:#14532d} .c-D{background:#fda4af;color:#881337} .c-S{background:#fde047;color:#713f12}
.c-SL{background:#5eead4;color:#134e4a} .c-DL{background:#99f6e4;color:#134e4a} .c-F{background:#fb923c;color:#431407} .c-NL{background:#f472b6;color:#500724}
details.legendas{border-top:1px solid var(--borda)}
details.legendas summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:.45rem;padding:.55rem .8rem;font-size:.84rem;font-weight:650;background:var(--th)}
details.legendas summary::-webkit-details-marker{display:none}
details.legendas summary::after{content:"⌄";margin-left:auto;transition:transform .15s}
details.legendas[open] summary::after{transform:rotate(180deg)}
details.legendas summary svg{width:16px;height:16px}
details.legendas ul{list-style:none;margin:0;padding:.3rem .8rem .5rem}
details.legendas li{display:flex;align-items:center;gap:.55rem;padding:.3rem 0;font-size:.82rem;border-bottom:1px solid var(--borda)}
details.legendas li:last-child{border-bottom:0}
details.legendas li i{width:13px;height:13px;border-radius:3px;flex:none}
details.legendas .qtd{min-width:1.8rem;text-align:center;font-size:.72rem;font-weight:800;padding:.05rem .4rem;border-radius:999px;background:#2563eb;color:#fff}
details.legendas li b{min-width:1.6rem}
details.legendas .nome{flex:1;color:var(--texto-2);font-size:.78rem}
details.legendas .tipo{font-size:.66rem;font-weight:800;padding:.1rem .45rem;border-radius:6px}
details.legendas .tipo.sim{background:var(--ok-bg);color:var(--ok)} details.legendas .tipo.nao{background:var(--erro-bg);color:var(--erro)}
details.legendas ul.eventos-mes{border-top:1px dashed var(--borda)} details.legendas ul.eventos-mes li{display:block}
.vista-mes{max-width:760px}
.vista-mes .nav-mes{display:flex;justify-content:space-between;margin-bottom:.6rem}
.mes-cal.grande .dia{min-height:74px;font-size:1rem} .mes-cal.grande .dia small{font-size:.8rem}
@media (max-width:600px){.grade-meses{grid-template-columns:1fr} .resumo-cal{margin-left:0}}
`;

/** Clicar num dia preenche a data no formulário de inclusão. */
const JS = `
document.addEventListener('click',function(e){
  var d=e.target.closest('.dia[data-data]'); if(!d) return;
  var f=document.getElementById('form-evento'); if(!f) return;
  f.data_inicio.value=d.dataset.data; f.data_fim.value='';
  document.getElementById('incluir').scrollIntoView({behavior:'smooth'}); setTimeout(function(){f.descricao.focus()},350);
});`;

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
  const porDia = await eventosPorDia(db, atual.id);
  const anoNum = atual.ano;

  // meses do período do ano letivo, com cada dia classificado
  const mesIni = Number(atual.data_inicio.slice(5, 7)) - 1;
  const mesFim = atual.data_fim.slice(0, 4) === String(anoNum) ? Number(atual.data_fim.slice(5, 7)) - 1 : 11;
  const meses = Array.from({ length: mesFim - mesIni + 1 }, (_, i) => mesIni + i).map((m) => {
    const primeiro = `${anoNum}-${String(m + 1).padStart(2, '0')}-01`;
    const ultimo = new Date(Date.UTC(anoNum, m + 1, 0)).toISOString().slice(0, 10);
    const dias = [...diasEntre(primeiro, ultimo)].map((d) => ({ d, codigo: classificarDia(d, atual, porDia.get(d)), eventos: porDia.get(d) ?? [] }));
    const cont = new Map<CodigoDia, number>();
    for (const x of dias) if (x.codigo) cont.set(x.codigo, (cont.get(x.codigo) ?? 0) + 1);
    const letivos = dias.filter((x) => ehLetivo(x.codigo)).length;
    const naoLetivos = dias.filter((x) => x.codigo && !ehLetivo(x.codigo)).length;
    const evMes = eventos.filter((e) => e.data_inicio <= ultimo && e.data_fim >= primeiro);
    return { m, primeiro, dias, cont, letivos, naoLetivos, evMes };
  });
  const totalDias = [...diasEntre(atual.data_inicio, atual.data_fim)].length;
  const letivos = meses.reduce((s, x) => s + x.letivos, 0);
  const naoLetivos = meses.reduce((s, x) => s + x.naoLetivos, 0);
  const vista = c.req.query('vista') === 'mes' ? 'mes' : 'ano';
  const mesSel = meses.find((x) => x.m === Number(c.req.query('mes')) - 1)
    ?? meses.find((x) => x.primeiro.slice(0, 7) === new Date().toISOString().slice(0, 7)) ?? meses[0];
  const base = `/admin/pedagogico/calendario?ano=${anoNum}`;
  const nomeCodigo = Object.fromEntries(CODIGOS_DIA.map(([cod, nome]) => [cod, nome]));

  const CartaoMes = ({ x, grande }: { x: (typeof meses)[number]; grande?: boolean }) => {
    const vazios = diaDaSemana(x.primeiro) % 7; // semana começa no domingo
    const celulas: (typeof x.dias[number] | null)[] = [...Array(vazios).fill(null), ...x.dias];
    while (celulas.length % 7) celulas.push(null);
    const legendas = CODIGOS_DIA.filter(([cod]) => x.cont.get(cod));
    return (
      <section class={`mes-cal ${grande ? 'grande' : ''}`}>
        <header>
          <span class="pilula l" title="dias letivos">L: {x.letivos}</span>
          <a href={`${base}&vista=mes&mes=${x.m + 1}`} title="Ver o mês">{MESES[x.m]}/{anoNum}</a>
          <span class="pilula nl" title="dias não letivos">NL: {x.naoLetivos}</span>
        </header>
        <div class="semana">{['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'].map((d, i) => <span class={i === 0 ? 'dom' : ''}>{d}</span>)}</div>
        <div class="dias">
          {celulas.map((x2) => !x2 ? <span class="dia vazio" />
            : !x2.codigo ? <span class="dia fora" title="fora do ano letivo">{Number(x2.d.slice(8))}</span>
            : (
              <button type="button" class={`dia c-${x2.codigo}${x2.eventos.some((e) => e.tipo === 'evento') ? ' tem-evento' : ''}`} data-data={x2.d}
                title={[`${dataBR(x2.d)} — ${nomeCodigo[x2.codigo]}`, ...x2.eventos.map((e) => `${ROTULO_EVENTO[e.tipo]}: ${e.descricao}`)].join('\n')}>
                <b>{Number(x2.d.slice(8))}</b><small>{x2.codigo}</small>
              </button>
            ))}
        </div>
        <details class="legendas" open={grande}>
          <summary><Icone nome="documento" />Ver legendas do mês <span class="muted">({legendas.length})</span></summary>
          <ul>
            {legendas.map(([cod, nome, letivo]) => (
              <li><i class={`c-${cod}`} /><span class="qtd">{x.cont.get(cod)}</span><b>{cod}</b><span class="nome">{nome.toUpperCase()}</span>
                <span class={`tipo ${letivo ? 'sim' : 'nao'}`}>{letivo ? 'LETIVO' : 'NÃO LETIVO'}</span></li>
            ))}
          </ul>
          {x.evMes.length > 0 && (
            <ul class="eventos-mes">
              {x.evMes.map((e) => <li><b>{dataBR(e.data_inicio).slice(0, 5)}{e.data_fim !== e.data_inicio && <>–{dataBR(e.data_fim).slice(0, 5)}</>}</b> {e.descricao} <span class="muted">({ROTULO_EVENTO[e.tipo].toLowerCase()})</span></li>)}
            </ul>
          )}
        </details>
      </section>
    );
  };

  return c.html(
    <Pagina titulo={`Calendário ${anoNum}`} usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Calendário escolar</h1>
      <div class="cartao acoes-cal">
        <form method="get" style="margin:0">
          <label>Ano letivo<select name="ano" onchange="this.form.submit()">{anos.map((a) => <option value={a.ano} selected={a.id === atual.id}>{a.ano}</option>)}</select></label>
        </form>
        <form method="post" action={`/admin/pedagogico/calendario/${atual.id}/feriados`} style="margin:0"
          onsubmit="return confirm('Incluir os feriados nacionais (e Carnaval/Corpus Christi como ponto facultativo) deste ano? Datas já cadastradas não se repetem.')">
          <button class="sec"><Icone nome="incluir" />Incluir feriados nacionais</button>
        </form>
        <a class="botao sec" href="#incluir"><Icone nome="incluir" />Incluir evento</a>
        <div class="resumo-cal">
          <span class="chip periodo"><Icone nome="valido" />Período: <b>{dataBR(atual.data_inicio)}</b> a <b>{dataBR(atual.data_fim)}</b> · <b>{totalDias}</b> dias</span>
          <span class="chip letivos"><Icone nome="pedagogico" />Letivos: <b>{letivos}</b></span>
          <span class="chip nao"><Icone nome="cancelar" />Não letivos: <b>{naoLetivos}</b></span>
        </div>
      </div>

      <div class="titulo-cal">
        <h2>Calendário {anoNum}</h2>
        <div class="vistas">
          <a href={base} class={vista === 'ano' ? 'ativa' : ''}>Ano</a>
          <a href={`${base}&vista=mes&mes=${mesSel.m + 1}`} class={vista === 'mes' ? 'ativa' : ''}>Mês</a>
        </div>
      </div>
      {vista === 'ano'
        ? <div class="grade-meses">{meses.map((x) => <CartaoMes x={x} />)}</div>
        : (
          <div class="vista-mes">
            <div class="nav-mes">
              {meses.find((x) => x.m === mesSel.m - 1) ? <a class="botao sec" href={`${base}&vista=mes&mes=${mesSel.m}`}>‹ {MESES[mesSel.m - 1]}</a> : <span />}
              {meses.find((x) => x.m === mesSel.m + 1) ? <a class="botao sec" href={`${base}&vista=mes&mes=${mesSel.m + 2}`}>{MESES[mesSel.m + 1]} ›</a> : <span />}
            </div>
            <CartaoMes x={mesSel} grande />
          </div>
        )}
      <p class="muted">Clique em um dia para preenchê-lo no formulário abaixo. Fora do período do ano letivo os dias ficam apagados.</p>

      <h2 id="incluir">Incluir no calendário</h2>
      <div class="cartao">
        <form method="post" action={`/admin/pedagogico/calendario/${atual.id}/eventos`} class="grade" id="form-evento">
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
      <script dangerouslySetInnerHTML={{ __html: JS }} />
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
