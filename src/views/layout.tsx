import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import { raw } from 'hono/html';
import { pode, ROTULO_PERFIL, type Permissao } from '../auth/permissoes';
import type { UsuarioSessao } from '../tipos';
import { VERSAO_ATUAL } from '../novidades';

export type Tema = 'sistema' | 'claro' | 'escuro';
export const TEMAS: Tema[] = ['claro', 'sistema', 'escuro'];

/*
 * Identidade visual a partir do logo do Instituto Inovativa:
 *   marinho #003C80 · azul #2D7BB9 · ciano #25A0DC · verde-água #00A890 · verde #6EBE8B
 */
const CLARO = `
  --fundo:#F2F5F9; --superficie:#FFFFFF; --superficie-2:#F6F8FB; --borda:#DCE3EC; --borda-forte:#B9C5D4;
  --texto:#12233D; --texto-2:#55667E; --titulo:#003C80;
  --primaria:#003C80; --primaria-hover:#00316A; --primaria-texto:#FFFFFF;
  --link:#1F6FB0; --destaque:#00A890; --foco:rgba(37,160,220,.35);
  --th:#EDF2F8; --linha-hover:#F5F8FC;
  --ok:#0B7A5E; --ok-bg:#E5F6F0; --ok-borda:#B3E2D3;
  --erro:#B42318; --erro-bg:#FDECEC; --erro-borda:#F5C2BD;
  --aviso:#8A5A00; --aviso-bg:#FFF6DC; --aviso-borda:#F1D78A;
  --sombra:0 1px 2px rgba(16,35,61,.06),0 4px 16px rgba(16,35,61,.06);
  --xadrez:#E9EEF4; color-scheme: light;`;

const ESCURO = `
  --fundo:#0A1422; --superficie:#111F33; --superficie-2:#16283F; --borda:#24395A; --borda-forte:#34507A;
  --texto:#E3EBF6; --texto-2:#98A9C2; --titulo:#E3EBF6;
  --primaria:#25A0DC; --primaria-hover:#4CB4E6; --primaria-texto:#04121F;
  --link:#6CC3F0; --destaque:#2CC4A6; --foco:rgba(37,160,220,.45);
  --th:#18304D; --linha-hover:#152841;
  --ok:#4FD1A8; --ok-bg:#0E3A30; --ok-borda:#1D5E4D;
  --erro:#FF8A80; --erro-bg:#3D1418; --erro-borda:#6B252B;
  --aviso:#F2C14E; --aviso-bg:#3A2E0C; --aviso-borda:#6A5418;
  --sombra:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.25);
  --xadrez:#1B2E48; color-scheme: dark;`;

export const CSS_TEMAS = `
:root{${CLARO}}
html[data-tema="escuro"]{${ESCURO}}
@media (prefers-color-scheme: dark){ html[data-tema="sistema"]{${ESCURO}} }
`;

const CSS = `${CSS_TEMAS}
:root{--marinho:#003C80;--marinho-escuro:#00224F;--azul:#2D7BB9;--ciano:#25A0DC;--verde-agua:#00A890;--verde:#6EBE8B;
  --degrade:linear-gradient(90deg,#003C80 0%,#2D7BB9 35%,#25A0DC 60%,#00A890 82%,#6EBE8B 100%)}
*{box-sizing:border-box}
html,body{margin:0}
body{font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:var(--texto);background:var(--fundo);font-size:15px;line-height:1.45}
a{color:var(--link)}
.app{display:grid;grid-template-columns:248px 1fr;min-height:100vh}
.lateral{background:linear-gradient(180deg,var(--marinho-escuro) 0%,#012C61 100%);color:#CFE0F5;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow:auto}
.lateral::before{content:"";display:block;height:4px;background:var(--degrade)}
.marca{padding:18px 16px 10px}
.marca .chip{background:#fff;border-radius:12px;padding:10px 12px;display:flex;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.25)}
.marca .chip img{width:100%;max-width:190px;height:auto;display:block}
.marca small{display:block;margin-top:10px;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#8FB3D9;text-align:center}
.menu{padding:4px 0 10px;flex:1}
.menu .item-raiz,.menu summary{display:flex;align-items:center;gap:11px;padding:10px 16px;color:#E3EDF9;text-decoration:none;
  font-size:.86rem;font-weight:650;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;list-style:none;user-select:none;position:relative}
.menu summary::-webkit-details-marker{display:none}
.menu .item-raiz svg,.menu summary svg{width:19px;height:19px;flex:none;opacity:.9}
.menu summary .seta{margin-left:auto;width:16px;height:16px;transition:transform .15s ease;opacity:.75}
.menu details[open]>summary .seta{transform:rotate(90deg)}
.menu .item-raiz:hover,.menu summary:hover{background:rgba(255,255,255,.07);color:#fff}
.menu details{border-top:1px solid rgba(255,255,255,.06)}
.menu details[open]{background:rgba(0,0,0,.18)}
.menu details[open]>summary{color:#fff}
.menu .sub{padding:2px 0 8px}
.menu .sub a{display:flex;align-items:center;gap:10px;padding:7px 16px 7px 30px;color:#C9D9EC;text-decoration:none;font-size:.9rem;position:relative}
.menu .sub a::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.7;flex:none}
.menu .sub a svg{width:13px;height:13px;margin-left:auto;opacity:.6}
.menu .sub a:hover{color:#fff;background:rgba(255,255,255,.05)}
.menu a.ativo{color:#5CC6F2;font-weight:650;background:rgba(37,160,220,.10)}
.menu a.ativo::after{content:"";position:absolute;left:0;top:4px;bottom:4px;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,var(--ciano),var(--verde-agua))}
.menu .item-raiz.ativo{color:#5CC6F2}
.menu .sep{height:1px;background:rgba(255,255,255,.12);margin:6px 16px 6px 30px}
.usuario{margin:10px;padding:12px;border-radius:10px;background:rgba(255,255,255,.06);font-size:.85rem}
.usuario b{color:#fff;display:block}
.usuario .perfil{color:#8FB3D9;font-size:.78rem}
.usuario .links{display:flex;gap:12px;margin-top:8px}
.usuario .links a{color:#CFE0F5;text-decoration:none;display:flex;align-items:center;gap:5px;font-size:.82rem}
.usuario .links a:hover{color:#fff} .usuario .links svg{width:15px;height:15px}
.usuario a.versao{display:flex;align-items:center;gap:6px;margin-top:9px;color:#8FB3D9;text-decoration:none;font-size:.76rem}
.usuario a.versao:hover{color:#fff}
.selo-novo{background:var(--verde-agua);color:#fff;border-radius:999px;padding:0 .45rem;font-size:.66rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.msg.novidade{display:flex;align-items:center;gap:.4rem .8rem;flex-wrap:wrap;background:var(--superficie);color:var(--texto);border-color:var(--ciano);border-left-width:4px}
.msg.novidade b{color:var(--titulo)} .msg.novidade .acoes{margin:0 0 0 auto}
[hidden]{display:none!important}
.tema{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;margin-top:10px;background:rgba(0,0,0,.25);border-radius:8px;padding:3px}
.tema button{background:transparent;color:#A9C2DE;border:0;border-radius:6px;padding:5px 2px;font-size:.74rem;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer}
.tema button svg{width:15px;height:15px}
.tema button[aria-pressed="true"]{background:#fff;color:var(--marinho);box-shadow:0 1px 3px rgba(0,0,0,.3)}
.tema button:hover:not([aria-pressed="true"]){color:#fff}
.principal{min-width:0}
.voltar{display:inline-flex;align-items:center;gap:.35rem;margin:0 0 .9rem;padding:.32rem .8rem .32rem .55rem;border:1px solid var(--borda);
  border-radius:999px;background:var(--superficie);color:var(--texto-2);font-size:.85rem;font-weight:550;text-decoration:none;box-shadow:var(--sombra)}
.voltar svg{width:16px;height:16px}
.voltar:hover{color:var(--titulo);border-color:var(--ciano)}
main{max-width:1200px;margin:0 auto;padding:26px 28px 60px}
h1{color:var(--titulo);margin:.1rem 0 1.1rem;font-size:1.6rem;font-weight:650;letter-spacing:-.01em}
h2{color:var(--titulo);font-size:1.12rem;margin:1.7rem 0 .7rem;font-weight:620}
.cartao{background:var(--superficie);border:1px solid var(--borda);border-radius:12px;padding:1.1rem 1.25rem;margin-bottom:1rem;box-shadow:var(--sombra)}
/* rede de segurança: ícone sem regra específica fica do tamanho do texto (nunca gigante) */
:where(svg.ic){width:1.15em;height:1.15em;flex:none;vertical-align:-.2em}
main{min-width:0}
input,select,textarea{max-width:100%;min-width:0}
label.check{flex-wrap:wrap}
img{max-width:100%}
table{border-collapse:separate;border-spacing:0;width:100%;background:var(--superficie);border:1px solid var(--borda);border-radius:10px;overflow:hidden;box-shadow:var(--sombra)}
/* tabela só com cabeçalho (lista vazia): some, e a mensagem logo abaixo vira um aviso de "vazio" */
table:has(> tbody > tr:only-child > th){display:none}
table:has(> tbody > tr:only-child > th) + p.muted{background:var(--superficie);border:1px dashed var(--borda-forte);border-radius:12px;padding:1.4rem 1rem;text-align:center;font-size:.9rem}
th,td{border-bottom:1px solid var(--borda);padding:.5rem .7rem;text-align:left;vertical-align:top}
tr:last-child>td{border-bottom:0}
th{background:var(--th);font-weight:600;font-size:.85rem;color:var(--texto-2)}
tr:hover>td{background:var(--linha-hover)}
td.n,th.n{text-align:right} td.c,th.c{text-align:center}
form.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.8rem 1rem}
form.grade .largo,.largo{grid-column:1/-1}
label{display:flex;flex-direction:column;gap:.25rem;font-size:.84rem;color:var(--texto-2);font-weight:550}
label.check{flex-direction:row;align-items:center;gap:.45rem}
input,select,textarea{font:inherit;font-size:.92rem;font-weight:400;padding:.48rem .6rem;border:1px solid var(--borda-forte);border-radius:8px;background:var(--superficie);color:var(--texto)}
input[type=file]{padding:.35rem;background:var(--superficie-2)}
input[type=color]{padding:.15rem;height:2.3rem}
input:focus,select:focus,textarea:focus{outline:3px solid var(--foco);border-color:var(--ciano)}
input.mini{width:5.4rem;text-align:right}
button,.botao{font:inherit;font-weight:560;background:var(--primaria);color:var(--primaria-texto);border:1px solid transparent;border-radius:8px;padding:.5rem 1.05rem;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
button:hover,.botao:hover{background:var(--primaria-hover)}
button:disabled{opacity:.5;cursor:not-allowed}
button svg,.botao svg{width:18px;height:18px;flex:none}
button.sec,.botao.sec{background:transparent;color:var(--link);border-color:var(--borda-forte)}
button.sec:hover,.botao.sec:hover{background:var(--superficie-2);border-color:var(--link)}
button.perigo{background:var(--erro);color:#fff}
.acoes{display:flex;gap:.55rem;flex-wrap:wrap;align-items:center;margin:.7rem 0}
.acoes form{margin:0}
.msg{padding:.7rem 1rem;border-radius:10px;margin-bottom:1rem;border:1px solid}
.msg ul{margin:.3rem 0 0 1.1rem;padding:0}
.msg.ok{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-borda)}
.msg.erro{background:var(--erro-bg);color:var(--erro);border-color:var(--erro-borda)}
.msg.aviso{background:var(--aviso-bg);color:var(--aviso);border-color:var(--aviso-borda)}
.tag{display:inline-block;padding:.08rem .55rem;border-radius:999px;font-size:.76rem;font-weight:650;background:var(--th);color:var(--texto-2)}
.tag.AP,.tag.ok{background:var(--ok-bg);color:var(--ok)} .tag.RP,.tag.erro{background:var(--erro-bg);color:var(--erro)}
.tag.PENDENTE,.tag.aviso{background:var(--aviso-bg);color:var(--aviso)}
.muted{color:var(--texto-2);font-size:.85rem}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:.9rem}
.kpis .cartao{margin:0;position:relative;overflow:hidden;color:var(--texto-2);text-decoration:none}
.kpis .cartao::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--degrade)}
.kpis b{font-size:1.9rem;color:var(--titulo);display:block;font-weight:700}
.thumb{max-height:64px;max-width:230px;border:1px dashed var(--borda-forte);background:#fff;padding:2px;border-radius:6px}
pre.json{white-space:pre-wrap;font-size:.78rem;background:var(--superficie-2);padding:.5rem;margin:.2rem 0;max-height:240px;overflow:auto;border-radius:6px}
code{font-size:.92em}
/* login */
.tela-login{min-height:100vh;display:grid;place-items:center;padding:24px;
  background:radial-gradient(1200px 600px at -10% -20%,rgba(37,160,220,.22),transparent 60%),radial-gradient(900px 500px at 110% 120%,rgba(0,168,144,.22),transparent 60%),var(--fundo)}
.login{width:100%;max-width:400px;padding:0;overflow:hidden}
.login .topo{background:#fff;padding:26px 28px 18px;text-align:center;border-bottom:1px solid var(--borda)}
.login .topo img{max-width:230px;width:100%}
.login .topo::after{content:"";display:block;height:4px;margin:18px -28px -18px;background:var(--degrade)}
.login .corpo{padding:22px 28px 26px}
.login h1{font-size:1.2rem;margin:0 0 .2rem}
.login form{display:flex;flex-direction:column;gap:.85rem;margin-top:1rem}
.login button{justify-content:center;padding:.65rem}
.tema-login{display:flex;justify-content:center;gap:6px;margin-top:16px}
.tema-login button{background:transparent;color:var(--texto-2);border:1px solid var(--borda);padding:.25rem .6rem;font-size:.78rem}
.tema-login button[aria-pressed="true"]{color:var(--titulo);border-color:var(--ciano)}
@media (max-width:900px){
  .app{grid-template-columns:1fr}
  .lateral{position:static;height:auto}
  .marca{display:flex;align-items:center;gap:12px;padding:12px}
  .marca .chip{padding:6px 10px} .marca .chip img{max-width:140px} .marca small{display:none}
  .menu details:not([open]) .sub{display:none}
  main{padding:18px 14px 40px}
  table{font-size:.85rem;display:block;overflow-x:auto;-webkit-overflow-scrolling:touch} th,td{padding:.35rem .4rem}
}
`;

/* Ícones (traço 1.8, 24×24) */
const ICONES: Record<string, string> = {
  secretaria: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3h6v3H9z"/><path d="M9 11h6M9 15h4"/>',
  cadastros: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  pedagogico: '<path d="M2 9 12 4l10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/>',
  sistema: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  seta: '<path d="m9 6 6 6-6 6"/>',
  incluir: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v9M7.5 12h9"/>',
  alterar: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/><path d="m14.5 5.5 3 3"/>',
  excluir: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  atualizar: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 21v-5h-5"/>',
  atalhos: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/>',
  salvar: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><path d="M8 21v-7h8v7"/>',
  cancelar: '<circle cx="12" cy="12" r="9.5"/><path d="m8.5 8.5 7 7M15.5 8.5l-7 7"/>',
  buscar: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  documento: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  valido: '<circle cx="12" cy="12" r="9.5"/><path d="m7.5 12.5 3 3 6-6.5"/>',
  revogado: '<circle cx="12" cy="12" r="9.5"/><path d="m8.5 8.5 7 7M15.5 8.5l-7 7"/>',
  alerta: '<path d="M12 3 2 20.5h20z"/><path d="M12 10v4.5M12 17.5v.5"/>',
  baixar: '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 20h14"/>',
  externo: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  inicio: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  alunos: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14c2.2.6 3.5 2.8 3.5 6"/>',
  turmas: '<path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="m2 13 10 5 10-5"/><path d="m2 17.5 10 5 10-5"/>',
  certificados: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>',
  instituicao: '<path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6"/>',
  modelo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  signatarios: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/><path d="M14 21h7"/>',
  cursos: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  usuarios: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  auditoria: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  claro: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  escuro: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  senha: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  voltar: '<path d="M15 18 9 12l6-6"/><path d="M9 12h11"/>',
  sair: '<path d="M9 4H5v16h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
};

export const Icone: FC<{ nome: string }> = ({ nome }) =>
  raw(
    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONES[nome] ?? '') +
      '</svg>',
  );

type ItemMenu = { href: string; rotulo: string; perm?: Permissao; externo?: boolean } | { separador: true };
interface SecaoMenu { id: string; rotulo: string; icone: string; itens: ItemMenu[] }

/** Menu lateral no estilo SysGEP: seções recolhíveis com subitens. */
export const SECOES_MENU: SecaoMenu[] = [
  {
    id: 'secretaria', rotulo: 'Secretaria', icone: 'secretaria',
    itens: [
      { href: '/admin/alunos', rotulo: 'Alunos', perm: 'alunos.editar' },
      { href: '/admin/turmas', rotulo: 'Turmas e resultados', perm: 'turmas.editar' },
      { href: '/admin/diario', rotulo: 'Notas e Faltas', perm: 'resultados.lancar' },
      { href: '/admin/importacao', rotulo: 'Importar Planilhas', perm: 'alunos.editar' },
      { separador: true },
      { href: '/admin/certificados/pendentes', rotulo: 'Emissão de Certificados', perm: 'certificados.emitir' },
      { href: '/admin/certificados', rotulo: 'Certificados Emitidos', perm: 'relatorios.emitir' },
      { href: '/admin/documentos', rotulo: 'Declarações e Históricos', perm: 'relatorios.emitir' },
      { href: '/admin/relatorios', rotulo: 'Relatórios', perm: 'relatorios.emitir' },
      { href: '/v', rotulo: 'Validação Pública', perm: 'relatorios.emitir', externo: true },
    ],
  },
  {
    id: 'pedagogico', rotulo: 'Gestão Pedagógica', icone: 'pedagogico',
    itens: [
      { href: '/admin/pedagogico/funcionarios', rotulo: 'Funcionários', perm: 'pedagogico.gerenciar' },
      { href: '/admin/pedagogico/lotacao', rotulo: 'Lotação de Professores', perm: 'pedagogico.gerenciar' },
      { href: '/admin/pedagogico/horario', rotulo: 'Horário do Professor', perm: 'pedagogico.gerenciar' },
      { href: '/admin/pedagogico/faltas', rotulo: 'Faltas do Aluno', perm: 'resultados.lancar' },
      { separador: true },
      { href: '/admin/pedagogico/anos', rotulo: 'Ano Letivo', perm: 'pedagogico.gerenciar' },
      { href: '/admin/pedagogico/calendario', rotulo: 'Calendário Escolar', perm: 'pedagogico.gerenciar' },
    ],
  },
  {
    id: 'cadastros', rotulo: 'Cadastros', icone: 'cadastros',
    itens: [
      { href: '/admin/instituicao', rotulo: 'Instituição e Atos', perm: 'instituicao.editar' },
      { href: '/admin/cursos', rotulo: 'Cursos e Matrizes', perm: 'cursos.editar' },
      { separador: true },
      { href: '/admin/modelo', rotulo: 'Modelo do Certificado', perm: 'instituicao.editar' },
      { href: '/admin/signatarios', rotulo: 'Signatários', perm: 'signatarios.editar' },
    ],
  },
  {
    id: 'sistema', rotulo: 'Sistema', icone: 'sistema',
    itens: [
      { href: '/admin/usuarios', rotulo: 'Usuários e Perfis', perm: 'usuarios.gerenciar' },
      { href: '/admin/auditoria', rotulo: 'Auditoria', perm: 'auditoria.ver' },
      { separador: true },
      { href: '/admin/novidades', rotulo: 'Novidades do Sistema' },
      { href: '/admin/conta/senha', rotulo: 'Alterar Minha Senha' },
    ],
  },
];

/** Item ativo = link interno mais longo que é prefixo do caminho atual. */
function hrefAtivo(caminho: string): string | null {
  let melhor: string | null = null;
  for (const sec of SECOES_MENU)
    for (const it of sec.itens) {
      if ('separador' in it || it.externo) continue;
      if ((caminho === it.href || caminho.startsWith(it.href + '/')) && (!melhor || it.href.length > melhor.length)) melhor = it.href;
    }
  return melhor;
}

/** Remove itens sem permissão e separadores sobrando (início, fim ou repetidos). */
function itensVisiveis(sec: SecaoMenu, u: UsuarioSessao): ItemMenu[] {
  const lista = sec.itens.filter((it) => 'separador' in it || !it.perm || pode(u.perfil, it.perm));
  return lista.filter((it, i) => {
    if (!('separador' in it)) return true;
    const antes = lista.slice(0, i).some((x) => !('separador' in x));
    const depois = lista[i + 1] && !('separador' in lista[i + 1]);
    return antes && depois;
  });
}

const Menu: FC<{ usuario: UsuarioSessao; caminho: string }> = ({ usuario, caminho }) => {
  const ativo = hrefAtivo(caminho);
  return (
    <nav class="menu" aria-label="Menu principal">
      <a href="/admin" class={`item-raiz ${caminho === '/admin' ? 'ativo' : ''}`}>
        <Icone nome="inicio" />Início
      </a>
      {SECOES_MENU.map((sec) => {
        const itens = itensVisiveis(sec, usuario);
        if (!itens.length) return null;
        const aberta = itens.some((it) => !('separador' in it) && it.href === ativo);
        return (
          <details open={aberta} data-secao={sec.id}>
            <summary><Icone nome={sec.icone} />{sec.rotulo}<span class="seta"><Icone nome="seta" /></span></summary>
            <div class="sub">
              {itens.map((it) =>
                'separador' in it ? (
                  <div class="sep" />
                ) : (
                  <a href={it.href} class={it.href === ativo ? 'ativo' : ''} {...(it.externo ? { target: '_blank', rel: 'noopener' } : {})}>
                    {it.rotulo}
                    {it.externo && <Icone nome="externo" />}
                  </a>
                ),
              )}
            </div>
          </details>
        );
      })}
    </nav>
  );
};

const ROTULO_TEMA: Record<Tema, string> = { claro: 'Claro', sistema: 'Auto', escuro: 'Escuro' };

/** Troca o tema na hora (sem recarregar) e salva a preferência; sem JS, o formulário funciona sozinho. */
const JS_MENU = `
document.addEventListener('DOMContentLoaded',function(){
  var k='menu-secoes',m={};try{m=JSON.parse(localStorage.getItem(k)||'{}')}catch(e){}
  document.querySelectorAll('.menu details').forEach(function(d){
    var id=d.dataset.secao; if(!d.open&&m[id]) d.open=true;
    d.addEventListener('toggle',function(){m[id]=d.open;try{localStorage.setItem(k,JSON.stringify(m))}catch(e){}});
  });
});`;

/**
 * Versão vista (por navegador): enquanto a versão atual não foi vista, mostra o selo "novo" no menu
 * e o aviso no Início. Abrir Novidades do Sistema ou dispensar o aviso marca como vista.
 */
const JS_VERSAO = `
document.addEventListener('DOMContentLoaded',function(){
  var k='versao-vista',v=${JSON.stringify(VERSAO_ATUAL.versao)},visto=null;
  try{visto=localStorage.getItem(k)}catch(e){}
  function marcar(){try{localStorage.setItem(k,v)}catch(e){} document.querySelectorAll('[data-aviso-versao]').forEach(function(x){x.hidden=true})}
  if(document.querySelector('[data-marcar-versao]')){marcar();return}
  if(visto!==v) document.querySelectorAll('[data-aviso-versao]').forEach(function(x){x.hidden=false});
  document.querySelectorAll('[data-dispensar-versao]').forEach(function(b){b.addEventListener('click',marcar)});
});`;

const JS_TEMA = `
document.addEventListener('submit',function(e){
  var f=e.target; if(!f.classList||!f.classList.contains('form-tema')) return;
  var b=e.submitter; if(!b) return; e.preventDefault();
  document.documentElement.setAttribute('data-tema',b.value);
  f.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
  var d=new FormData(f); d.set('tema',b.value);
  fetch(f.action,{method:'POST',body:d,headers:{'X-Requested-With':'fetch'}});
});`;

export const SeletorTema: FC<{ tema: Tema; acao: string; classe: string; icones?: boolean }> = ({ tema, acao, classe, icones }) => (
  <form method="post" action={acao} class={`form-tema ${classe}`} aria-label="Aparência">
    {TEMAS.map((t) => (
      <button type="submit" name="tema" value={t} aria-pressed={String(t === tema)} title={`Tema ${ROTULO_TEMA[t].toLowerCase()}`}>
        {icones && <Icone nome={t === 'sistema' ? 'monitor' : t} />}
        {ROTULO_TEMA[t]}
      </button>
    ))}
  </form>
);

const Head: FC<{ titulo: string }> = ({ titulo }) => (
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>{titulo} — Certificados IECT</title>
    <style dangerouslySetInnerHTML={{ __html: CSS }} />
    <script dangerouslySetInnerHTML={{ __html: JS_TEMA + JS_MENU + JS_VERSAO }} />
  </head>
);

/** Telas que existem (para o "Voltar" automático subir até uma tela válida). */
const TELAS = [
  /^\/admin$/, /^\/admin\/(alunos|turmas|certificados|documentos|importacao|modelo|signatarios|instituicao|cursos|usuarios|auditoria|relatorios|diario|novidades)$/,
  /^\/admin\/(alunos|turmas|certificados|documentos|importacao|signatarios|cursos|usuarios)\/\d+$/,
  /^\/admin\/pedagogico\/(funcionarios|lotacao|horario|faltas|anos|calendario)$/, /^\/admin\/pedagogico\/funcionarios\/\d+$/,
  /^\/admin\/turmas\/\d+\/modulos\/\d+$/, /^\/admin\/diario\/\d+\/\d+$/, /^\/admin\/cursos\/\d+\/matrizes\/\d+$/, /^\/admin\/certificados\/pendentes$/,
];
/** Destino padrão do "Voltar": o nível acima que seja uma tela existente. */
export function caminhoPai(caminho: string): string {
  const partes = caminho.replace(/\/+$/, '').split('/');
  while (partes.length > 2) {
    partes.pop();
    const c = partes.join('/');
    if (TELAS.some((re) => re.test(c))) return c;
  }
  return '/admin';
}

export const Pagina: FC<
  PropsWithChildren<{ titulo: string; usuario?: UsuarioSessao; caminho?: string; ok?: string | null; erro?: string | null; tema?: Tema;
    /** destino do botão Voltar; false esconde; omitido = nível acima do endereço */ voltar?: string | false }>
> = ({ titulo, usuario, caminho = '', ok, erro, tema, voltar, children }) => {
  const t: Tema = (usuario?.tema as Tema) ?? tema ?? 'sistema';
  const destinoVoltar = voltar === false || caminho === '/admin' || !usuario ? null : voltar ?? caminhoPai(caminho);
  const conteudo = (
    <>
      {destinoVoltar && <a class="voltar" href={destinoVoltar}><Icone nome="voltar" />Voltar</a>}
      {usuario && caminho === '/admin' && (
        <div class="msg novidade" data-aviso-versao hidden>
          <span>O sistema foi atualizado para a <b>versão {VERSAO_ATUAL.versao}</b>. Veja o que mudou.</span>
          <span class="acoes">
            <a class="botao" href="/admin/novidades">Ver novidades</a>
            <button type="button" class="sec" data-dispensar-versao>Dispensar</button>
          </span>
        </div>
      )}
      {ok && <div class="msg ok">{ok}</div>}
      {erro && <div class="msg erro">{erro}</div>}
      {children}
    </>
  );
  if (!usuario) {
    return (
      <html lang="pt-BR" data-tema={t}>
        <Head titulo={titulo} />
        <body><main>{conteudo}</main></body>
      </html>
    );
  }
  return (
    <html lang="pt-BR" data-tema={t}>
      <Head titulo={titulo} />
      <body>
        <div class="app">
          <aside class="lateral">
            <div class="marca">
              <a class="chip" href="/admin" title="Início"><img src="/modelo/logo.png" alt="Instituto Inovativa" /></a>
              <small>Certificados técnicos</small>
            </div>
            <Menu usuario={usuario} caminho={caminho} />
            <div class="usuario">
              <b>{usuario.nome}</b>
              <span class="perfil">{ROTULO_PERFIL[usuario.perfil]}</span>
              <div class="links">
                <a href="/admin/conta/senha"><Icone nome="senha" />Senha</a>
                <a href="/admin/sair"><Icone nome="sair" />Sair</a>
              </div>
              <SeletorTema tema={t} acao="/admin/conta/tema" classe="tema" icones />
              <a class="versao" href="/admin/novidades" title="Novidades do Sistema">
                Versão {VERSAO_ATUAL.versao}
                <span class="selo-novo" data-aviso-versao hidden>novo</span>
              </a>
            </div>
          </aside>
          <div class="principal">
            <main>{conteudo}</main>
          </div>
        </div>
      </body>
    </html>
  );
};

const CSS_PUBLICO = `
.publico{min-height:100vh;display:flex;flex-direction:column;
  background:radial-gradient(1100px 520px at -10% -20%,rgba(37,160,220,.16),transparent 60%),radial-gradient(900px 480px at 110% 110%,rgba(0,168,144,.16),transparent 60%),var(--fundo)}
.publico header{background:#fff;border-bottom:1px solid #DCE3EC}
.publico header::after{content:"";display:block;height:4px;background:var(--degrade)}
.publico header .faixa{max-width:860px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:16px;justify-content:space-between;flex-wrap:wrap}
.publico header img{height:46px;width:auto}
.publico header span{color:#003C80;font-weight:650;font-size:.95rem}
.publico main{max-width:860px;width:100%;padding:28px 20px 40px;flex:1}
.publico footer{text-align:center;color:var(--texto-2);font-size:.8rem;padding:18px 20px 28px;line-height:1.6}
.selo{display:flex;align-items:center;gap:14px;padding:18px 20px;border-radius:14px;margin-bottom:18px;border:1px solid}
.selo svg{width:40px;height:40px;flex:none}
.selo b{display:block;font-size:1.25rem;letter-spacing:.01em}
.selo.ok{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-borda)}
.selo.erro{background:var(--erro-bg);color:var(--erro);border-color:var(--erro-borda)}
.selo.erro b{font-size:1.6rem;text-transform:uppercase;letter-spacing:.06em}
.selo.aviso{background:var(--aviso-bg);color:var(--aviso);border-color:var(--aviso-borda)}
dl.dados{display:grid;grid-template-columns:minmax(150px,220px) 1fr;margin:0;background:var(--superficie);border:1px solid var(--borda);border-radius:12px;overflow:hidden;box-shadow:var(--sombra)}
dl.dados dt,dl.dados dd{margin:0;padding:.65rem 1rem;border-bottom:1px solid var(--borda)}
dl.dados dt{background:var(--th);color:var(--texto-2);font-size:.85rem;font-weight:600}
dl.dados dd{font-size:.97rem}
dl.dados dt:nth-last-of-type(1),dl.dados dd:last-of-type{border-bottom:0}
.consulta{display:flex;gap:.5rem;flex-wrap:wrap}
.consulta input{flex:1;min-width:200px;text-transform:uppercase;font-size:1.05rem;letter-spacing:.05em}
@media (max-width:600px){dl.dados{grid-template-columns:1fr} dl.dados dt{border-bottom:0;padding-bottom:.2rem} .publico header img{height:38px}}
`;

/** Páginas públicas (validação): cabeçalho com o logo, sem menu. */
export const PaginaPublica: FC<PropsWithChildren<{ titulo: string; tema: Tema; rodape?: Child }>> = ({ titulo, tema, rodape, children }) => (
  <html lang="pt-BR" data-tema={tema}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <meta name="robots" content="noindex, nofollow" />
      <title>{titulo} — Instituto Inovativa</title>
      <style dangerouslySetInnerHTML={{ __html: CSS + CSS_PUBLICO }} />
      <script dangerouslySetInnerHTML={{ __html: JS_TEMA }} />
    </head>
    <body>
      <div class="publico">
        <header>
          <div class="faixa">
            <a href="/v"><img src="/modelo/logo.png" alt="Instituto Inovativa" /></a>
            <span>Validação de Certificados</span>
          </div>
        </header>
        <main>{children}</main>
        <footer>
          {rodape}
          <SeletorTema tema={tema} acao="/tema" classe="tema-login" />
        </footer>
      </div>
    </body>
  </html>
);

/** Página de login: cartão central com o logo e o degradê da marca. */
export const PaginaLogin: FC<PropsWithChildren<{ titulo: string; tema: Tema; erro?: string | null }>> = ({ titulo, tema, erro, children }) => (
  <html lang="pt-BR" data-tema={tema}>
    <Head titulo={titulo} />
    <body>
      <div class="tela-login">
        <div>
          <div class="cartao login">
            <div class="topo"><img src="/modelo/logo.png" alt="Instituto Inovativa" /></div>
            <div class="corpo">
              {erro && <div class="msg erro">{erro}</div>}
              {children}
            </div>
          </div>
          <SeletorTema tema={tema} acao="/tema" classe="tema-login" />
        </div>
      </div>
    </body>
  </html>
);

export const Campo: FC<{
  nome: string;
  rotulo: string;
  valor?: string | number | null;
  tipo?: string;
  obrigatorio?: boolean;
  classe?: string;
  extra?: Record<string, string | number | boolean>;
  dica?: Child;
}> = ({ nome, rotulo, valor, tipo = 'text', obrigatorio, classe, extra, dica }) => (
  <label class={classe}>
    {rotulo}
    {obrigatorio ? ' *' : ''}
    <input name={nome} type={tipo} value={valor ?? ''} required={obrigatorio} {...(extra ?? {})} />
    {dica && <span class="muted">{dica}</span>}
  </label>
);

export const Selecao: FC<{
  nome: string;
  rotulo: string;
  valor?: string | number | null;
  opcoes: [string | number, string][];
  obrigatorio?: boolean;
  vazio?: string;
  classe?: string;
}> = ({ nome, rotulo, valor, opcoes, obrigatorio, vazio, classe }) => (
  <label class={classe}>
    {rotulo}
    {obrigatorio ? ' *' : ''}
    <select name={nome} required={obrigatorio}>
      {vazio != null && <option value="">{vazio}</option>}
      {opcoes.map(([v, r]) => (
        <option value={String(v)} selected={valor != null && String(valor) === String(v)}>
          {r}
        </option>
      ))}
    </select>
  </label>
);

export const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'
  .split(' ')
  .map((u) => [u, u] as [string, string]);
