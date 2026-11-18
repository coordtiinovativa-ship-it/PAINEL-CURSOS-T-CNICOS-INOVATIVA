import { Hono } from 'hono';
import type { FC } from 'hono/jsx';
import type { Env, UsuarioSessao } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { pode } from '../auth/permissoes';
import { dataBR } from '../lib/datas';
import { VERSAO_ATUAL, VERSOES, type ItemNovidade } from '../novidades';

/** Novidades do Sistema: o que mudou em cada versão (todos os perfis). */
export const rotasNovidades = new Hono<Env>();

const GRUPOS = [
  { campo: 'novidades', rotulo: 'Novidades', classe: 'nov' },
  { campo: 'melhorias', rotulo: 'Melhorias', classe: 'mel' },
  { campo: 'correcoes', rotulo: 'Correções', classe: 'cor' },
] as const;

/** Texto de busca sem acentos e em minúsculas (a mesma regra do filtro no navegador). */
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const CSS = `
.sobre{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;position:relative;overflow:hidden}
.sobre::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--degrade)}
.sobre .num{font-size:1.9rem;font-weight:700;color:var(--titulo);line-height:1.1}
.sobre .lado{text-align:right;font-size:.85rem;color:var(--texto-2)} .sobre .lado b{color:var(--texto);display:block}
.busca-nov{display:flex;flex-direction:row;align-items:center;gap:.5rem;background:var(--superficie);border:1px solid var(--borda-forte);border-radius:10px;padding:0 .7rem;margin:0 0 1rem}
.busca-nov:focus-within{outline:3px solid var(--foco);border-color:var(--ciano)}
.busca-nov svg{color:var(--texto-2)}
.busca-nov input{border:0;outline:0;flex:1;padding:.65rem 0;background:transparent}
.versao-nov{margin-bottom:1rem}
.versao-nov h2{margin:0 0 .3rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;font-size:1.15rem}
.versao-nov h2 .data{font-weight:500;color:var(--texto-2);font-size:.9rem}
.versao-nov .resumo{margin:.1rem 0 .4rem;color:var(--texto-2)}
.grupo-nov h3{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;margin:.9rem 0 .35rem;display:flex;align-items:center;gap:.4rem}
.grupo-nov h3::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.grupo-nov.nov h3{color:var(--destaque)} .grupo-nov.mel h3{color:var(--link)} .grupo-nov.cor h3{color:var(--aviso)}
.grupo-nov ul{margin:0;padding-left:1.2rem} .grupo-nov li{margin:.3rem 0}
.grupo-nov li a{font-weight:600}
.tag.atual{background:var(--ok-bg);color:var(--ok)}
`;

/** Filtra versões e itens enquanto digita (sem acento, sem diferenciar maiúsculas). */
const JS = `
document.addEventListener('DOMContentLoaded',function(){
  var n=function(s){return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase()};
  var campo=document.getElementById('busca-nov'),vazio=document.getElementById('nov-vazio');
  function filtrar(){
    var q=n(campo.value.trim()),algum=false;
    document.querySelectorAll('.versao-nov').forEach(function(v){
      var tudo=!q||n(v.dataset.cabecalho).indexOf(q)>=0,vis=0;
      v.querySelectorAll('.grupo-nov').forEach(function(g){
        var gv=0;
        g.querySelectorAll('li').forEach(function(li){var ok=tudo||li.dataset.busca.indexOf(q)>=0;li.hidden=!ok;if(ok)gv++});
        g.hidden=!gv; vis+=gv;
      });
      v.hidden=!vis&&!tudo; if(!v.hidden) algum=true;
    });
    vazio.hidden=algum;
  }
  campo.addEventListener('input',filtrar);
});`;

const Item: FC<{ item: ItemNovidade; usuario: UsuarioSessao }> = ({ item, usuario }) => {
  const comLink = item.href && (!item.perm || pode(usuario, item.perm));
  const titulo = item.texto ? `${item.titulo}:` : item.titulo;
  return (
    <li data-busca={normalizar(`${item.titulo} ${item.texto ?? ''}`)}>
      {comLink ? (
        <a href={item.href} {...(item.href!.startsWith('/v') ? { target: '_blank', rel: 'noopener' } : {})}>{titulo}</a>
      ) : (
        <b>{titulo}</b>
      )}
      {item.texto && <> {item.texto}</>}
    </li>
  );
};

rotasNovidades.get('/', (c) => {
  const u = c.get('usuario');
  return c.html(
    <Pagina titulo="Novidades do Sistema" usuario={u} caminho={c.req.path}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <script dangerouslySetInnerHTML={{ __html: JS }} />
      {/* abrir esta tela marca a versão atual como vista (some o selo "novo" e o aviso do Início) */}
      <span data-marcar-versao hidden />
      <h1>Novidades do Sistema</h1>
      <div class="cartao sobre">
        <div>
          <div class="num">Versão {VERSAO_ATUAL.versao}</div>
          <div class="muted">Atualizado em {dataBR(VERSAO_ATUAL.data)}</div>
        </div>
        <div class="lado">
          <b>Sistema de Certificados IECT</b>
          Instituto Inovativa de Educação, Ciência e Tecnologia
        </div>
      </div>

      <label class="busca-nov" aria-label="Pesquisar nas novidades">
        <Icone nome="buscar" />
        <input id="busca-nov" type="search" placeholder="Pesquisar nas novidades (ex.: faltas, QR code, relatório, 1.5)…" autocomplete="off" />
      </label>

      <p class="muted">
        Aqui você vê o que mudou em cada versão do sistema. As versões <b>0.x</b> foram a fase de desenvolvimento;
        a <b>1.0.0</b> marca a entrada em produção.
      </p>

      {VERSOES.map((v, i) => (
        <section class="cartao versao-nov" data-cabecalho={normalizar(`${v.versao} ${dataBR(v.data)} ${v.resumo ?? ''}`)}>
          <h2>
            {v.versao}
            <span class="data">— {dataBR(v.data)}</span>
            {i === 0 && <span class="tag atual">Versão atual</span>}
          </h2>
          {v.resumo && <p class="resumo">{v.resumo}</p>}
          {GRUPOS.map((g) => {
            const itens = v[g.campo];
            if (!itens?.length) return null;
            return (
              <div class={`grupo-nov ${g.classe}`}>
                <h3>{g.rotulo}</h3>
                <ul>{itens.map((it) => <Item item={it} usuario={u} />)}</ul>
              </div>
            );
          })}
        </section>
      ))}
      <p id="nov-vazio" class="msg aviso" hidden>Nenhuma novidade encontrada para essa pesquisa.</p>
    </Pagina>,
  );
});
