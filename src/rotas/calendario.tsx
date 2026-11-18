/**
 * Gestão Pedagógica → Ano Letivo e Calendário Escolar.
 * O ano letivo limita as datas de aula; o calendário tira feriados, recessos e pontos facultativos da chamada.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Icone, Pagina, Selecao } from '../views/layout';
import { exigir } from '../auth/sessao';
import { pode } from '../auth/permissoes';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, inteiro, lerCorpo, texto } from '../lib/form';
import { dataBR } from '../lib/datas';
import {
  classificarDia, CODIGOS_DIA, codigoParaExibir, codigosPermitidos, contarDiasLetivos, diaDaSemana, diasEntre, ehLetivo, eventosPorDia,
  agruparAulasAfetadas, aulasRegistradasNasDatas, feriadosNacionais, gerarCalendario, removerAulasDaChamada, ROTULO_EVENTO, TIPOS_EVENTO,
  TIPOS_NAO_LETIVOS, type AnoLetivo, type CodigoDia, type EventoDia,
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
.dia.fora-periodo{opacity:.45}
.dia.ajustado::before{content:"✎";position:absolute;top:2px;left:4px;font-size:.62rem;opacity:.75}
.aviso-gerar{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;border-left:4px solid var(--ciano)}
.aviso-gerar p{margin:0;flex:1;min-width:240px}
.descartar{flex-direction:row !important;align-items:center;gap:.35rem;font-size:.84rem;margin:0}
.gerado{font-size:.84rem;color:var(--texto-2);margin:.2rem 0 0}
dialog#editar-dia{border:1px solid var(--borda);border-radius:14px;padding:0;max-width:440px;width:calc(100% - 32px);background:var(--superficie);color:var(--texto);box-shadow:var(--sombra)}
dialog#editar-dia::backdrop{background:rgba(0,0,0,.45)}
dialog#editar-dia header{padding:.8rem 1rem;background:linear-gradient(90deg,#2563eb,#6d4fe6);color:#fff;font-weight:700}
dialog#editar-dia form{padding:1rem;display:grid;gap:.8rem}
.codigos{display:flex;flex-wrap:wrap;gap:.45rem}
.codigos .op-codigo{flex-direction:row;margin:0}
.op-codigo{display:flex;align-items:center;gap:.4rem;padding:.35rem .6rem;border-radius:9px;cursor:pointer;font-size:.85rem;font-weight:650;border:2px solid transparent}
.op-codigo input{margin:0}
.op-codigo:has(input:checked){border-color:var(--texto)}
.op-codigo[hidden]{display:none}
.aviso-chamada{margin:0;padding:.6rem .75rem;border-radius:9px;background:var(--erro-bg);color:var(--erro);font-size:.84rem;border:1px solid currentColor}
.aviso-chamada a{color:inherit;text-decoration:underline}
.auto-info{font-size:.82rem;color:var(--texto-2);margin:0}
dialog#editar-dia .acoes{display:flex;gap:.5rem;flex-wrap:wrap}
.vista-mes{max-width:760px}
.vista-mes .nav-mes{display:flex;justify-content:space-between;margin-bottom:.6rem}
.mes-cal.grande .dia{min-height:74px;font-size:1rem} .mes-cal.grande .dia small{font-size:.8rem}
@media (max-width:600px){.grade-meses{grid-template-columns:1fr} .resumo-cal{margin-left:0}}
`;

/** Clicar num dia abre a edição do dia; "Incluir período" leva a data para o formulário de evento. */
const JS = `
function paraPeriodo(data){
  var f=document.getElementById('form-evento'); if(!f) return;
  f.data_inicio.value=data; f.data_fim.value='';
  document.getElementById('incluir').scrollIntoView({behavior:'smooth'}); setTimeout(function(){f.descricao.focus()},350);
}
document.addEventListener('click',function(e){
  if(e.target.closest('[data-fechar]')){ e.target.closest('dialog').close(); return; }
  var p=e.target.closest('[data-periodo]');
  if(p){ var dlg0=p.closest('dialog'); var dt=dlg0.querySelector('form').data.value; dlg0.close(); paraPeriodo(dt); return; }
  var d=e.target.closest('.dia[data-data]'); if(!d) return;
  var dlg=document.getElementById('editar-dia');
  if(!dlg||!dlg.showModal){ paraPeriodo(d.dataset.data); return; }
  var f=dlg.querySelector('form'), ok=d.dataset.ok.split(',');
  f.data.value=d.dataset.data;
  dlg.querySelector('.titulo-dia').textContent=d.dataset.rotulo;
  dlg.querySelector('.auto-info').textContent=d.dataset.auto;
  f.querySelectorAll('.op-codigo').forEach(function(l){
    var i=l.querySelector('input'), v=ok.indexOf(i.value)>=0;
    l.hidden=!v; i.disabled=!v; i.checked=v&&i.value===d.dataset.codigo;
  });
  f.descricao.value=d.dataset.desc||'';
  var av=dlg.querySelector('.aviso-chamada'), n=+(d.dataset.chamada||0);
  av.hidden=!n; dlg.querySelector('.qtd-chamada').textContent=n;
  f.querySelector('button[value=automatico]').hidden=d.dataset.manual!=='1';
  dlg.showModal();
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
  const podeExcluir = pode(c.get('usuario').perfil, 'calendario.excluir');
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
      {editar && podeExcluir && (
        <details class="cartao" style="margin-top:1rem;border-left:4px solid var(--erro)">
          <summary style="cursor:pointer;font-weight:650;color:var(--erro)"><Icone nome="excluir" />Excluir o ano letivo {editar.ano}</summary>
          {editar.turmas
            ? <p>Este ano letivo não pode ser excluído: tem <b>{editar.turmas}</b> turma(s) cadastrada(s) em {editar.ano}. Exclua ou mude o ano letivo
                das turmas antes. Para só limpar feriados, eventos e ajustes, use "Excluir calendário" na tela do <a href={`/admin/pedagogico/calendario?ano=${editar.ano}`}>calendário</a>.</p>
            : <>
                <p>Apaga o ano letivo {editar.ano} e todo o calendário dele (<b>{editar.eventos}</b> evento(s)/feriado(s) e os dias ajustados à mão).
                  Tudo fica registrado na auditoria. <b>Não há como desfazer.</b></p>
                <form method="post" action={`/admin/pedagogico/anos/${editar.id}/excluir`} onsubmit="return confirm('Excluir definitivamente este ano letivo e o calendário?')">
                  <label>Para confirmar, digite o ano ({editar.ano})<input name="confirmacao" required autocomplete="off" placeholder={String(editar.ano)} /></label>
                  <div class="acoes" style="margin-top:.6rem"><button style="background:var(--erro);border-color:var(--erro)"><Icone nome="excluir" />Excluir ano letivo</button></div>
                </form>
              </>}
        </details>
      )}
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
  // o calendário já nasce gerado: o responsável só ajusta o que for diferente
  const g = await gerarCalendario(c.env.DB, { ...d, id: r!.id } as AnoLetivo, c.get('usuario').email);
  await auditar(c, 'gerar_calendario', 'ano_letivo', r!.id, null, { feriados_incluidos: g.feriados });
  return c.redirect(`/admin/pedagogico/calendario?ano=${d.ano}&ok=` + encodeURIComponent(
    `Ano letivo ${d.ano} cadastrado e calendário gerado (${g.feriados.length} feriado(s) nacional(is)). Inclua os feriados municipais/estaduais e recessos e clique num dia para ajustá-lo.`));
});

rotasCalendario.post('/anos/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const antes = await c.env.DB.prepare('SELECT * FROM anos_letivos WHERE id = ?').bind(id).first<AnoLetivo>();
  if (!antes) return c.notFound();
  let d;
  const corpo = await lerCorpo(c);
  try {
    d = lerAno(corpo);
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
  // dias que saem do período do ano letivo
  const ini = d.data_inicio!, fim = d.data_fim!;
  const saem = [...diasEntre(antes.data_inicio, antes.data_fim)].filter((x) => x < ini || x > fim);
  const conf = await conferirLancamentos(c, antes, saem, corpo, `/admin/pedagogico/anos/${id}`,
    `mudar o período do ano letivo para ${dataBR(ini)} a ${dataBR(fim)}`, `/admin/pedagogico/anos?editar=${id}`);
  if (conf.resposta) return conf.resposta;
  await c.env.DB.prepare('UPDATE anos_letivos SET ano = ?, data_inicio = ?, data_fim = ?, situacao = ?, observacao = ? WHERE id = ?')
    .bind(d.ano, d.data_inicio, d.data_fim, d.situacao, d.observacao, id).run();
  await auditar(c, 'atualizar', 'ano_letivo', id, antes, d);
  return c.redirect('/admin/pedagogico/anos?ok=' + encodeURIComponent(`Ano letivo ${d.ano} salvo.${conf.msg}`));
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
  const chamadas = await chamadasPorDia(db, atual.ano);
  const anoNum = atual.ano;

  // janeiro a dezembro, sempre; fora do período do ano letivo o dia aparece esmaecido (férias)
  const nomeCodigo = Object.fromEntries(CODIGOS_DIA.map(([cod, nome]) => [cod, nome])) as Record<CodigoDia, string>;
  const meses = Array.from({ length: 12 }, (_, m) => m).map((m) => {
    const primeiro = `${anoNum}-${String(m + 1).padStart(2, '0')}-01`;
    const ultimo = new Date(Date.UTC(anoNum, m + 1, 0)).toISOString().slice(0, 10);
    const dias = [...diasEntre(primeiro, ultimo)].map((d) => {
      const evs = porDia.get(d) ?? [];
      const ajuste = evs.find((e) => e.tipo === 'ajuste');
      const semAjuste = evs.filter((e) => e.tipo !== 'ajuste');
      return {
        d, evs, ajuste,
        codigo: codigoParaExibir(d, atual, evs),
        auto: codigoParaExibir(d, atual, semAjuste),
        noPeriodo: classificarDia(d, atual) !== null,
      };
    });
    const cont = new Map<CodigoDia, number>();
    for (const x of dias) cont.set(x.codigo, (cont.get(x.codigo) ?? 0) + 1);
    const letivos = dias.filter((x) => ehLetivo(x.codigo)).length;
    const evMes = eventos.filter((e) => e.data_inicio <= ultimo && e.data_fim >= primeiro);
    const ajustesMes = dias.filter((x) => x.ajuste);
    return { m, primeiro, dias, cont, letivos, naoLetivos: dias.length - letivos, evMes, ajustesMes };
  });
  const doPeriodo = meses.flatMap((x) => x.dias).filter((x) => x.noPeriodo);
  const totalDias = doPeriodo.length;
  const letivos = doPeriodo.filter((x) => ehLetivo(x.codigo)).length;
  const naoLetivos = totalDias - letivos;
  const totalAjustes = meses.reduce((s, x) => s + x.ajustesMes.length, 0);
  const vista = c.req.query('vista') === 'mes' ? 'mes' : 'ano';
  const mesSel = meses.find((x) => x.m === Number(c.req.query('mes')) - 1)
    ?? meses.find((x) => x.primeiro.slice(0, 7) === new Date().toISOString().slice(0, 7)) ?? meses[0];
  const base = `/admin/pedagogico/calendario?ano=${anoNum}`;
  const volta = vista === 'mes' ? `&vista=mes&mes=${mesSel.m + 1}` : '';
  const DIAS_LONGOS = ['', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];

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
          {celulas.map((x2) => !x2 ? <span class="dia vazio" /> : (
            <button type="button"
              class={`dia c-${x2.codigo}${x2.evs.some((e) => e.tipo === 'evento') ? ' tem-evento' : ''}${x2.ajuste ? ' ajustado' : ''}${x2.noPeriodo ? '' : ' fora-periodo'}`}
              data-data={x2.d} data-codigo={x2.codigo} data-ok={codigosPermitidos(x2.d, atual).join(',')}
              data-rotulo={`${dataBR(x2.d)} (${DIAS_LONGOS[diaDaSemana(x2.d)]})`}
              data-auto={`Automático: ${x2.auto} — ${nomeCodigo[x2.auto]}${x2.noPeriodo ? '' : ' (fora do período do ano letivo: férias)'}`}
              data-desc={x2.ajuste?.descricao ?? ''} data-manual={x2.ajuste ? '1' : '0'} data-chamada={chamadas.get(x2.d) ?? 0}
              title={[
                `${dataBR(x2.d)} — ${nomeCodigo[x2.codigo]}${x2.noPeriodo ? '' : ' (fora do período do ano letivo)'}`,
                ...x2.evs.map((e) => e.tipo === 'ajuste' ? `Ajustado à mão${e.descricao ? `: ${e.descricao}` : ''}` : `${ROTULO_EVENTO[e.tipo]}: ${e.descricao}`),
                ...(chamadas.get(x2.d) ? [`Chamada registrada em ${chamadas.get(x2.d)} aula(s)`] : []),
                'Clique para editar o dia',
              ].join('\n')}>
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
          {(x.evMes.length > 0 || x.ajustesMes.length > 0) && (
            <ul class="eventos-mes">
              {x.evMes.map((e) => <li><b>{dataBR(e.data_inicio).slice(0, 5)}{e.data_fim !== e.data_inicio && <>–{dataBR(e.data_fim).slice(0, 5)}</>}</b> {e.descricao} <span class="muted">({ROTULO_EVENTO[e.tipo].toLowerCase()})</span></li>)}
              {x.ajustesMes.map((a) => <li><b>{dataBR(a.d).slice(0, 5)}</b> {a.ajuste!.descricao ?? nomeCodigo[a.codigo]} <span class="muted">(ajuste: {a.codigo})</span></li>)}
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
        <form method="post" action={`/admin/pedagogico/calendario/${atual.id}/gerar`} style="margin:0;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap"
          onsubmit={`return confirm('${atual.calendario_gerado_em ? 'Gerar de novo' : 'Gerar'} o calendário de ${anoNum}? Segunda a sexta ficam letivos, sábado e domingo não, e os feriados nacionais que faltam são incluídos (Carnaval e Corpus Christi como ponto facultativo).')`}>
          <button class={atual.calendario_gerado_em ? 'sec' : ''}><Icone nome="incluir" />{atual.calendario_gerado_em ? 'Gerar novamente' : 'Gerar calendário automaticamente'}</button>
          {totalAjustes > 0 && <label class="descartar"><input type="checkbox" name="descartar" value="1" />descartar os {totalAjustes} ajuste(s) feitos à mão</label>}
        </form>
        <a class="botao sec" href="#incluir"><Icone nome="incluir" />Incluir período ou evento</a>
        <div class="resumo-cal">
          <span class="chip periodo"><Icone nome="valido" />Período: <b>{dataBR(atual.data_inicio)}</b> a <b>{dataBR(atual.data_fim)}</b> · <b>{totalDias}</b> dias</span>
          <span class="chip letivos"><Icone nome="pedagogico" />Letivos: <b>{letivos}</b></span>
          <span class="chip nao"><Icone nome="cancelar" />Não letivos: <b>{naoLetivos}</b></span>
        </div>
      </div>
      {atual.calendario_gerado_em
        ? <p class="gerado">Calendário gerado automaticamente em {dataBR(atual.calendario_gerado_em.slice(0, 10))}{atual.calendario_gerado_por ? ` por ${atual.calendario_gerado_por}` : ''}
          {totalAjustes > 0 ? ` · ${totalAjustes} dia(s) ajustado(s) à mão (✎)` : ''}. Clique em um dia para editá-lo.</p>
        : (
          <div class="cartao aviso-gerar">
            <p><b>O calendário de {anoNum} ainda não foi gerado.</b> Clique em "Gerar calendário automaticamente": o sistema monta janeiro a dezembro com
              os dias letivos e os feriados nacionais. Depois é só clicar nos dias que forem diferentes para ajustar.</p>
          </div>
        )}

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
      <p class="muted">Clique em um dia para trocar o código (✎ = ajustado à mão). Fora do período do ano letivo ({dataBR(atual.data_inicio)} a {dataBR(atual.data_fim)})
        os dias ficam esmaecidos e não têm aula; o período se altera em <a href="/admin/pedagogico/anos">Ano Letivo</a>.</p>

      <dialog id="editar-dia">
        <header>Editar dia — <span class="titulo-dia" /></header>
        <form method="post" action={`/admin/pedagogico/calendario/${atual.id}/dia`}>
          <input type="hidden" name="data" />
          <input type="hidden" name="volta" value={volta} />
          <p class="auto-info" />
          <p class="aviso-chamada" hidden>
            <b>Atenção: este dia já tem chamada registrada em <span class="qtd-chamada" /> aula(s).</b> Se ele deixar de ser letivo, esses lançamentos
            serão apagados e precisarão ser refeitos. Altere somente se tiver certeza e emita antes o relatório de faltas
            (<a href="/admin/relatorios#controle" target="_blank">Relatórios → Controle de Faltas</a>). O sistema pedirá confirmação.
          </p>
          <div class="codigos">
            {CODIGOS_DIA.map(([cod, nome, letivo]) => (
              <label class={`op-codigo c-${cod}`} title={letivo ? 'letivo' : 'não letivo'}><input type="radio" name="codigo" value={cod} required /><b>{cod}</b> {nome}</label>
            ))}
          </div>
          <label>Descrição<input name="descricao" maxlength={120} placeholder="Ex.: Aniversário de Campo Grande, Reunião pedagógica, Reposição" /></label>
          <div class="acoes">
            <button name="acao" value="salvar"><Icone nome="salvar" />Salvar</button>
            <button name="acao" value="automatico" class="sec" formnovalidate>Voltar ao automático</button>
            <button type="button" class="sec" data-periodo>Incluir período a partir deste dia</button>
            <button type="button" class="sec" data-fechar>Cancelar</button>
          </div>
        </form>
      </dialog>

      <h2 id="incluir">Incluir período ou evento</h2>
      <p class="muted" style="margin-top:-.4rem">Para vários dias de uma vez (recesso, férias) ou eventos informativos. Incluir aqui substitui os ajustes à mão feitos nesses dias.</p>
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
      {!eventos.length && <p class="muted">Nenhum evento cadastrado. Use "Gerar calendário automaticamente" e cadastre os feriados municipais/estaduais e recessos.</p>}
      {pode(c.get('usuario').perfil, 'calendario.excluir') && (
        <details class="cartao" style="margin-top:1.5rem;border-left:4px solid var(--erro)">
          <summary style="cursor:pointer;font-weight:650;color:var(--erro)"><Icone nome="excluir" />Excluir o calendário de {anoNum}</summary>
          <p>Apaga <b>todos</b> os feriados, recessos, eventos e dias ajustados à mão de {anoNum} ({eventos.length} evento(s), {totalAjustes} ajuste(s)).
            O ano letivo continua: os dias voltam ao padrão (segunda a sexta letivos) até o calendário ser gerado de novo.
            Se algum dia letivo com chamada deixar de ser letivo, o sistema avisa antes. Fica registrado na auditoria. <b>Não há como desfazer.</b></p>
          <form method="post" action={`/admin/pedagogico/calendario/${atual.id}/excluir`} onsubmit="return confirm('Excluir todo o calendário deste ano?')">
            <label>Para confirmar, digite o ano ({anoNum})<input name="confirmacao" required autocomplete="off" placeholder={String(anoNum)} /></label>
            <div class="acoes" style="margin-top:.6rem"><button style="background:var(--erro);border-color:var(--erro)"><Icone nome="excluir" />Excluir calendário</button></div>
          </form>
        </details>
      )}
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </Pagina>,
  );
});

/** Nº de aulas com chamada registrada por dia (turmas do ano letivo). */
async function chamadasPorDia(db: D1Database, ano: number): Promise<Map<string, number>> {
  const rs = (await db.prepare('SELECT au.data, count(*) AS n FROM aulas au JOIN turmas t ON t.id = au.turma_id WHERE t.ano_letivo = ? GROUP BY au.data')
    .bind(ano).all<{ data: string; n: number }>()).results;
  return new Map(rs.map((r) => [r.data, r.n]));
}

/**
 * Alteração do calendário que tira dias letivos com chamada já registrada: primeiro mostra o aviso (com links para emitir o
 * Controle de Faltas); confirmada, apaga esses lançamentos e recalcula faltas e frequência — precisarão ser refeitos.
 */
async function conferirLancamentos(
  c: any, a: AnoLetivo, datas: string[], corpo: Record<string, any>, acao: string, oQue: string, volta: string,
): Promise<{ resposta?: Response; msg: string }> {
  const db = c.env.DB as D1Database;
  const aulas = await aulasRegistradasNasDatas(db, a, datas);
  if (!aulas.length) return { msg: '' };
  if (texto(corpo, 'confirmar') === '1') {
    await removerAulasDaChamada(db, aulas, c.get('usuario').email);
    await auditar(c, 'apagar_chamada_calendario', 'ano_letivo', a.id, { alteracao: oQue, aulas }, null);
    return { msg: ` ${aulas.length} aula(s) com chamada foram apagadas: refaça esses lançamentos.` };
  }
  const grupos = agruparAulasAfetadas(aulas);
  const campos = Object.entries(corpo).filter(([k, v]) => k !== 'confirmar' && typeof v === 'string');
  return {
    msg: '',
    resposta: c.html(
      <Pagina titulo="Confirmar alteração do calendário" usuario={c.get('usuario')} caminho={c.req.path} voltar={volta}>
        <h1>Confirmar alteração do calendário</h1>
        <div class="cartao" style="border-left:4px solid var(--erro)">
          <p style="margin-top:0"><b>Atenção: já há lançamentos nessas datas.</b> A alteração <b>{oQue}</b> tira do calendário letivo {datas.length > 1 ? 'dias' : 'um dia'} em
            que já foi feita a chamada de <b>{aulas.length} aula(s)</b> ({aulas.reduce((s, x) => s + x.faltas, 0)} falta(s) lançada(s)).</p>
          <p>Se continuar, <b>esses lançamentos serão apagados e precisarão ser refeitos</b>; as faltas e a frequência das disciplinas abaixo serão recalculadas.
            Altere somente se tiver certeza e <b>emita antes o relatório de faltas</b> de cada disciplina.</p>
        </div>
        <table>
          <tr><th>Turma</th><th>Disciplina</th><th>Datas afetadas</th><th class="n">Aulas com chamada</th><th class="n">Faltas lançadas</th><th>Antes de continuar</th></tr>
          {grupos.map((g) => (
            <tr>
              <td>{g.turma}</td><td>{g.componente}</td>
              <td>{[...g.datas].sort().map((d) => dataBR(d).slice(0, 5)).join(', ')}</td>
              <td class="n">{g.aulas}</td><td class="n">{g.faltas}</td>
              <td><a href={`/admin/relatorios/controle-faltas.pdf?turma=${g.turma_id}&disc=c:${g.componente_id}`} target="_blank"><Icone nome="certificados" />Emitir Controle de Faltas</a></td>
            </tr>
          ))}
        </table>
        <form method="post" action={acao} class="cartao" style="margin-top:1rem">
          {campos.map(([k, v]) => <input type="hidden" name={k} value={v as string} />)}
          <label style="flex-direction:row;align-items:flex-start;gap:.5rem;display:flex">
            <input type="checkbox" name="confirmar" value="1" required style="margin-top:.2rem" />
            <span>Tenho certeza: emiti o relatório de faltas e entendo que esses lançamentos serão apagados e precisarão ser refeitos.</span>
          </label>
          <div class="acoes" style="margin-top:.8rem">
            <button style="background:var(--erro);border-color:var(--erro)">Continuar e apagar os lançamentos</button>
            <a class="botao sec" href={volta}>Cancelar</a>
          </div>
        </form>
      </Pagina>,
    ),
  };
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
  const saem = TIPOS_NAO_LETIVOS.includes(d.tipo) ? [...diasEntre(d.data_inicio, d.data_fim!)].filter((x) => classificarDia(x, a) !== null) : [];
  const conf = await conferirLancamentos(c, a, saem, corpo, `/admin/pedagogico/calendario/${a.id}/eventos`,
    `incluir "${d.descricao}" (${ROTULO_EVENTO[d.tipo].toLowerCase()}, ${dataBR(d.data_inicio)}${d.data_fim !== d.data_inicio ? ` a ${dataBR(d.data_fim!)}` : ''})`, volta);
  if (conf.resposta) return conf.resposta;
  // vale a última alteração: o evento novo substitui os ajustes à mão feitos nesses dias (exceto evento informativo)
  const ajustes = d.tipo === 'evento' ? [] : (await db.prepare('SELECT * FROM calendario_dias WHERE ano_letivo_id = ? AND data BETWEEN ? AND ?')
    .bind(a.id, d.data_inicio, d.data_fim).all<Record<string, any>>()).results;
  const id = (await db.prepare('INSERT INTO calendario_eventos (ano_letivo_id, data_inicio, data_fim, tipo, descricao) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(a.id, d.data_inicio, d.data_fim, d.tipo, d.descricao).first<{ id: number }>())!.id;
  if (ajustes.length) await db.prepare('DELETE FROM calendario_dias WHERE ano_letivo_id = ? AND data BETWEEN ? AND ?').bind(a.id, d.data_inicio, d.data_fim).run();
  await auditar(c, 'criar', 'calendario_evento', id, ajustes.length ? { ajustes_substituidos: ajustes } : null, d);
  const msg = 'Incluído no calendário.'
    + (ajustes.length ? ` ${ajustes.length} ajuste(s) à mão nesses dias foram substituídos.` : '') + conf.msg;
  return c.redirect(`${volta}&ok=` + encodeURIComponent(msg));
});

// gerar o calendário automaticamente (/feriados = endereço antigo do botão "Incluir feriados nacionais")
for (const caminho of ['/calendario/:ano{[0-9]+}/gerar', '/calendario/:ano{[0-9]+}/feriados']) {
  rotasCalendario.post(caminho, async (c) => {
    const db = c.env.DB;
    const a = await db.prepare('SELECT * FROM anos_letivos WHERE id = ?').bind(Number(c.req.param('ano'))).first<AnoLetivo>();
    if (!a) return c.notFound();
    const corpo = await lerCorpo(c);
    const descartar = texto(corpo, 'descartar') === '1';
    // dias que deixam de ser letivos: feriados nacionais que entram e (descartando) ajustes à mão que saem
    const porDia = await eventosPorDia(db, a.id);
    const existentes = new Set((await db.prepare('SELECT data_inicio FROM calendario_eventos WHERE ano_letivo_id = ?').bind(a.id)
      .all<{ data_inicio: string }>()).results.map((e) => e.data_inicio));
    const novos = new Map(feriadosNacionais(a.ano).filter((f) => !existentes.has(f.data)).map((f) => [f.data, f]));
    const candidatos = new Set([...novos.keys(), ...(descartar ? [...porDia].filter(([, evs]) => evs.some((x) => x.tipo === 'ajuste')).map(([d]) => d) : [])]);
    const saem = [...candidatos].filter((d) => {
      const evs = porDia.get(d) ?? [];
      const depois: EventoDia[] = [...evs.filter((x) => !descartar || x.tipo !== 'ajuste'), ...(novos.has(d) ? [{ tipo: novos.get(d)!.tipo, descricao: novos.get(d)!.descricao }] : [])];
      return ehLetivo(classificarDia(d, a, evs)) && !ehLetivo(classificarDia(d, a, depois));
    });
    const conf = await conferirLancamentos(c, a, saem, corpo, `/admin/pedagogico/calendario/${a.id}/gerar`,
      descartar ? 'gerar o calendário novamente descartando os ajustes à mão' : 'gerar o calendário novamente', `/admin/pedagogico/calendario?ano=${a.ano}`);
    if (conf.resposta) return conf.resposta;
    const g = await gerarCalendario(db, a, c.get('usuario').email, descartar);
    await auditar(c, 'gerar_calendario', 'ano_letivo', a.id, null, { feriados_incluidos: g.feriados, ajustes_descartados: g.ajustesDescartados });
    const msg = `Calendário de ${a.ano} gerado: ${g.feriados.length} feriado(s) nacional(is) incluído(s)`
      + (g.ajustesDescartados ? `, ${g.ajustesDescartados} ajuste(s) à mão descartado(s)` : '')
      + '. Inclua os feriados municipais/estaduais e recessos e clique num dia para ajustá-lo.' + conf.msg;
    return c.redirect(`/admin/pedagogico/calendario?ano=${a.ano}&ok=` + encodeURIComponent(msg));
  });
}

// editar um dia: troca o código (ajuste manual) ou volta ao automático
rotasCalendario.post('/calendario/:ano{[0-9]+}/dia', async (c) => {
  const db = c.env.DB;
  const a = await db.prepare('SELECT * FROM anos_letivos WHERE id = ?').bind(Number(c.req.param('ano'))).first<AnoLetivo>();
  if (!a) return c.notFound();
  const corpo = await lerCorpo(c);
  const voltaQs = /^&vista=mes&mes=\d{1,2}$/.test(texto(corpo, 'volta') ?? '') ? texto(corpo, 'volta')! : '';
  const volta = `/admin/pedagogico/calendario?ano=${a.ano}${voltaQs}`;
  const data = texto(corpo, 'data') ?? '';
  try {
    if (!ISO.test(data) || data.slice(0, 4) !== String(a.ano)) throw new ErroValidacao(`Escolha um dia de ${a.ano}.`);
    const antes = await db.prepare('SELECT * FROM calendario_dias WHERE ano_letivo_id = ? AND data = ?').bind(a.id, data).first<Record<string, any>>();
    const auto = codigoParaExibir(data, a, ((await eventosPorDia(db, a.id)).get(data) ?? []).filter((e) => e.tipo !== 'ajuste'));
    const nome = Object.fromEntries(CODIGOS_DIA.map(([cod, n]) => [cod, n])) as Record<CodigoDia, string>;
    const apagar = db.prepare('DELETE FROM calendario_dias WHERE ano_letivo_id = ? AND data = ?').bind(a.id, data);

    const noPeriodo = classificarDia(data, a) !== null;
    if (texto(corpo, 'acao') === 'automatico') {
      const conf = await conferirLancamentos(c, a, antes && noPeriodo && !ehLetivo(auto) ? [data] : [], corpo,
        `/admin/pedagogico/calendario/${a.id}/dia`, `voltar ${dataBR(data)} ao automático (${auto} — ${nome[auto]})`, volta);
      if (conf.resposta) return conf.resposta;
      if (antes) {
        await apagar.run();
        await auditar(c, 'ajustar_dia', 'calendario_dia', a.id, antes, { data, automatico: auto });
      }
      return c.redirect(`${volta}&ok=` + encodeURIComponent(`${dataBR(data)} voltou ao automático (${auto} — ${nome[auto]}).${conf.msg}`));
    }

    const codigo = (texto(corpo, 'codigo') ?? '') as CodigoDia;
    const permitidos = codigosPermitidos(data, a);
    if (!permitidos.includes(codigo)) {
      throw new ErroValidacao(nome[codigo] && classificarDia(data, a) === null
        ? `${dataBR(data)} está fora do período do ano letivo (${dataBR(a.data_inicio)} a ${dataBR(a.data_fim)}): não pode ser letivo. Ajuste o período em Ano Letivo.`
        : `Escolha um código válido para ${dataBR(data)}: ${permitidos.join(', ')}.`);
    }
    const descricao = texto(corpo, 'descricao');
    if (!descricao && codigo !== auto && !['L', 'S', 'D'].includes(codigo)) throw new ErroValidacao(`Informe a descrição de ${dataBR(data)} (ex.: Aniversário de Campo Grande, Reunião pedagógica).`);
    const conf = await conferirLancamentos(c, a, noPeriodo && !ehLetivo(codigo) ? [data] : [], corpo,
      `/admin/pedagogico/calendario/${a.id}/dia`, `${dataBR(data)} → ${codigo} — ${nome[codigo]}`, volta);
    if (conf.resposta) return conf.resposta;
    if (codigo === auto && !descricao) {
      // igual ao automático: não precisa de ajuste
      if (antes) await apagar.run();
      if (antes) await auditar(c, 'ajustar_dia', 'calendario_dia', a.id, antes, { data, automatico: auto });
      return c.redirect(`${volta}&ok=` + encodeURIComponent(`${dataBR(data)}: ${codigo} — ${nome[codigo]} (automático).${conf.msg}`));
    }
    const usuario = c.get('usuario').email;
    await db.prepare(
      `INSERT INTO calendario_dias (ano_letivo_id, data, codigo, descricao, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (ano_letivo_id, data) DO UPDATE SET codigo = excluded.codigo, descricao = excluded.descricao,
         atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em`,
    ).bind(a.id, data, codigo, descricao, usuario).run();
    await auditar(c, 'ajustar_dia', 'calendario_dia', a.id, antes, { data, codigo, descricao, automatico: auto });
    return c.redirect(`${volta}&ok=` + encodeURIComponent(`${dataBR(data)} agora é ${codigo} — ${nome[codigo]}.${conf.msg}`));
  } catch (e) {
    if (e instanceof ErroValidacao) return c.redirect(`${volta}&erro=` + encodeURIComponent(e.message));
    throw e;
  }
});

rotasCalendario.post('/calendario/eventos/:id{[0-9]+}/excluir', async (c) => {
  const e = await c.env.DB.prepare('SELECT e.*, a.ano FROM calendario_eventos e JOIN anos_letivos a ON a.id = e.ano_letivo_id WHERE e.id = ?')
    .bind(Number(c.req.param('id'))).first<Record<string, any>>();
  if (!e) return c.notFound();
  const a = (await c.env.DB.prepare('SELECT * FROM anos_letivos WHERE id = ?').bind(e.ano_letivo_id).first<AnoLetivo>())!;
  // dias que deixam de ser letivos sem este evento (ex.: excluir um "dia letivo extra" de sábado)
  const porDia = await eventosPorDia(c.env.DB, a.id);
  const saem = [...diasEntre(e.data_inicio, e.data_fim)].filter((d) => {
    const evs = porDia.get(d) ?? [];
    return ehLetivo(classificarDia(d, a, evs)) && !ehLetivo(classificarDia(d, a, evs.filter((x) => x.id !== e.id || x.tipo === 'ajuste')));
  });
  const volta = `/admin/pedagogico/calendario?ano=${e.ano}`;
  const conf = await conferirLancamentos(c, a, saem, await lerCorpo(c), `/admin/pedagogico/calendario/eventos/${e.id}/excluir`, `excluir "${e.descricao}"`, volta);
  if (conf.resposta) return conf.resposta;
  await c.env.DB.prepare('DELETE FROM calendario_eventos WHERE id = ?').bind(e.id).run();
  await auditar(c, 'excluir', 'calendario_evento', e.id, e, null);
  return c.redirect(`${volta}&ok=` + encodeURIComponent('Evento excluído.' + conf.msg));
});

// ------------------------------------------------------------------ exclusões (admin master e administrador)
rotasCalendario.post('/calendario/:ano{[0-9]+}/excluir', exigir('calendario.excluir'), async (c) => {
  const db = c.env.DB;
  const a = await db.prepare('SELECT * FROM anos_letivos WHERE id = ?').bind(Number(c.req.param('ano'))).first<AnoLetivo>();
  if (!a) return c.notFound();
  const corpo = await lerCorpo(c);
  const volta = `/admin/pedagogico/calendario?ano=${a.ano}`;
  if ((texto(corpo, 'confirmacao') ?? '').trim() !== String(a.ano)) {
    return c.redirect(`${volta}&erro=` + encodeURIComponent(`Calendário não excluído: digite o ano (${a.ano}) para confirmar.`));
  }
  // sem eventos nem ajustes, sábados/domingos letivos deixam de ser letivos
  const porDia = await eventosPorDia(db, a.id);
  const saem = [...porDia.keys()].filter((d) => ehLetivo(classificarDia(d, a, porDia.get(d))) && !ehLetivo(classificarDia(d, a, [])));
  const conf = await conferirLancamentos(c, a, saem, corpo, `/admin/pedagogico/calendario/${a.id}/excluir`, `excluir o calendário de ${a.ano}`, volta);
  if (conf.resposta) return conf.resposta;
  const [eventos, ajustes] = await Promise.all([
    db.prepare('SELECT * FROM calendario_eventos WHERE ano_letivo_id = ?').bind(a.id).all(),
    db.prepare('SELECT * FROM calendario_dias WHERE ano_letivo_id = ?').bind(a.id).all(),
  ]);
  await db.batch([
    db.prepare('DELETE FROM calendario_eventos WHERE ano_letivo_id = ?').bind(a.id),
    db.prepare('DELETE FROM calendario_dias WHERE ano_letivo_id = ?').bind(a.id),
    db.prepare('UPDATE anos_letivos SET calendario_gerado_em = NULL, calendario_gerado_por = NULL WHERE id = ?').bind(a.id),
  ]);
  await auditar(c, 'excluir_calendario', 'ano_letivo', a.id, { eventos: eventos.results, ajustes: ajustes.results }, null);
  return c.redirect(`${volta}&ok=` + encodeURIComponent(
    `Calendário de ${a.ano} excluído (${eventos.results.length} evento(s), ${ajustes.results.length} ajuste(s)). Use "Gerar calendário automaticamente" para montar de novo.${conf.msg}`));
});

rotasCalendario.post('/anos/:id{[0-9]+}/excluir', exigir('calendario.excluir'), async (c) => {
  const db = c.env.DB;
  const a = await db.prepare('SELECT * FROM anos_letivos WHERE id = ?').bind(Number(c.req.param('id'))).first<AnoLetivo>();
  if (!a) return c.notFound();
  const volta = (erro: string) => c.redirect(`/admin/pedagogico/anos?editar=${a.id}&erro=` + encodeURIComponent(erro));
  if ((texto(await lerCorpo(c), 'confirmacao') ?? '').trim() !== String(a.ano)) return volta(`Ano letivo não excluído: digite o ano (${a.ano}) para confirmar.`);
  const turmas = (await db.prepare('SELECT codigo FROM turmas WHERE ano_letivo = ? ORDER BY codigo').bind(a.ano).all<{ codigo: string }>()).results;
  if (turmas.length) return volta(`Ano letivo não excluído: tem ${turmas.length} turma(s) em ${a.ano} (${turmas.map((t) => t.codigo).join(', ')}).`);
  const [eventos, ajustes] = await Promise.all([
    db.prepare('SELECT * FROM calendario_eventos WHERE ano_letivo_id = ?').bind(a.id).all(),
    db.prepare('SELECT * FROM calendario_dias WHERE ano_letivo_id = ?').bind(a.id).all(),
  ]);
  await db.batch([
    db.prepare('DELETE FROM calendario_eventos WHERE ano_letivo_id = ?').bind(a.id),
    db.prepare('DELETE FROM calendario_dias WHERE ano_letivo_id = ?').bind(a.id),
    db.prepare('DELETE FROM anos_letivos WHERE id = ?').bind(a.id),
  ]);
  await auditar(c, 'excluir', 'ano_letivo', a.id, { ano_letivo: a, eventos: eventos.results, ajustes: ajustes.results }, null);
  return c.redirect('/admin/pedagogico/anos?ok=' + encodeURIComponent(`Ano letivo ${a.ano} e o calendário dele excluídos.`));
});
