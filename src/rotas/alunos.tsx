/**
 * Cadastro de Alunos no estilo SysGEP: barra de ferramentas (Incluir, Alterar, Salvar, Excluir, Atualizar,
 * Atalhos, Sair), abas (Cadastro, Matrículas, Prévia do certificado, Localizar), ficha em grade com
 * obrigatórios marcados, chave "usar nome social", endereço com busca de CEP e documentos do aluno.
 */
import { Hono } from 'hono';
import type { Child, FC } from 'hono/jsx';
import type { Env } from '../tipos';
import { Icone, Pagina, UFS } from '../views/layout';
import { exigir } from '../auth/sessao';
import { pode } from '../auth/permissoes';
import { auditar } from '../lib/auditoria';
import { arquivo, ErroValidacao, lerCorpo, texto, type Corpo } from '../lib/form';
import { ajustarRgUnificado, formatarCPF, somenteDigitos, validarCPF } from '../lib/cpf';
import { salvarArquivo, TIPOS_IMAGEM, TIPOS_PDF, urlArquivo } from '../lib/arquivos';
import { dataBR } from '../lib/datas';
import { classeStatus, ROTULO_STATUS } from '../lib/matricula';
import { CAMPOS_ALUNO, CAMPOS_ALUNO_SIM_NAO, nomeDoAluno, OBRIGATORIOS_ALUNO, type Aluno, type CampoAluno } from '../certificado/dados';

export const rotasAlunos = new Hono<Env>();
rotasAlunos.use('*', exigir('alunos.editar'));

const SEXOS: [string, string][] = [['F', 'Feminino'], ['M', 'Masculino']];
const CORES: [string, string][] = ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não declarada'].map((c) => [c, c]);
const ESTADOS_CIVIS: [string, string][] = ['Solteiro(a)', 'Casado(a)', 'União estável', 'Separado(a)', 'Divorciado(a)', 'Viúvo(a)'].map((c) => [c, c]);
const DESCRICOES_DOC = [
  'RG', 'CPF', 'Certidão de nascimento ou casamento', 'Histórico escolar do ensino médio', 'Certificado de conclusão do ensino médio',
  'Comprovante de residência', 'Foto 3x4', 'Termo de matrícula', 'Laudo / necessidades específicas',
];

/** Campos obrigatórios para o certificado (marcados com bolinha vermelha) + identificação mínima. */
const OBRIGATORIOS = new Set<string>(['nome_civil', 'cpf', ...OBRIGATORIOS_ALUNO.map(([k]) => k)]);

export function faltantesAluno(a: Partial<Aluno>): string[] {
  return OBRIGATORIOS_ALUNO.filter(([k]) => a[k] == null || String(a[k]).trim() === '').map(([, r]) => r);
}

/** Lê e valida o formulário do aluno. Com `parcial`, não lança erro (usado na prévia ao vivo). */
export function lerAluno(corpo: Corpo, parcial = false): Record<CampoAluno, string | null> {
  const d = Object.fromEntries(CAMPOS_ALUNO.map((k) => [k, texto(corpo, k)])) as Record<CampoAluno, string | null>;
  d.usar_nome_social = corpo.usar_nome_social === '1' ? '1' : '0';
  d.rg_unificado_cpf = corpo.rg_unificado_cpf === '1' ? '1' : '0';
  if (d.cpf) d.cpf = somenteDigitos(d.cpf);
  ajustarRgUnificado(d);
  if (d.rg_orgao_expedidor) d.rg_orgao_expedidor = d.rg_orgao_expedidor.toUpperCase();
  if (d.email) d.email = d.email.toLowerCase();
  if (d.cep) {
    const c = somenteDigitos(d.cep);
    d.cep = c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : d.cep;
  }
  if (parcial) return d;
  if (!d.nome_civil) throw new ErroValidacao('Informe o nome do aluno.');
  if (!d.cpf || !validarCPF(d.cpf)) throw new ErroValidacao('CPF inválido.');
  for (const [k, r] of [['data_nascimento', 'Data de nascimento'], ['rg_data_expedicao', 'Data de expedição do RG']] as const) {
    if (d[k] && !/^\d{4}-\d{2}-\d{2}$/.test(d[k]!)) throw new ErroValidacao(`${r} inválida.`);
  }
  if (d.ensino_medio_ano_conclusao) {
    const ano = Number(d.ensino_medio_ano_conclusao);
    if (!Number.isInteger(ano) || ano < 1950 || ano > new Date().getFullYear() + 1) throw new ErroValidacao('Ano de conclusão do ensino médio inválido.');
  }
  if (d.cep && !/^\d{5}-\d{3}$/.test(d.cep)) throw new ErroValidacao('CEP inválido (use 00000-000).');
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) throw new ErroValidacao('E-mail inválido.');
  if (d.usar_nome_social === '1' && !d.nome_social) d.usar_nome_social = '0';
  return d;
}

// ------------------------------------------------------------------ estilo
const CSS = `
.ficha-titulo{display:flex;align-items:center;gap:.6rem;font-size:1.05rem;font-weight:650;color:var(--titulo);border-left:4px solid var(--ciano);padding-left:.6rem;margin:0 0 .4rem}
.ficha-titulo small{font-weight:400;color:var(--texto-2);font-size:.85rem}
.ferramentas{display:flex;gap:2px;flex-wrap:wrap;margin:.2rem 0 .7rem;padding-bottom:.6rem;border-bottom:1px solid var(--borda)}
.ferramentas .fb{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:64px;padding:.35rem .5rem;border-radius:8px;
  background:transparent;border:1px solid transparent;color:var(--texto-2);font-size:.76rem;font-weight:550;text-decoration:none;cursor:pointer}
.ferramentas .fb svg{width:24px;height:24px}
.ferramentas .fb:hover:not(:disabled){background:var(--superficie-2);border-color:var(--borda)}
.ferramentas .fb:disabled{opacity:.35;cursor:default}
.fb.verde{color:#16a34a} .fb.ambar{color:#d97706} .fb.vermelho{color:#dc2626} .fb.azul{color:var(--link)}
.ferramentas form{margin:0;display:contents}
[data-modo="ver"] .so-editar,[data-modo="editar"] .so-ver,[data-modo="novo"] .so-ver,[data-modo="novo"] .so-existente{display:none !important}
.abas{display:flex;gap:3px;flex-wrap:wrap;border-bottom:1px solid var(--borda);margin-bottom:.9rem}
.abas a{display:flex;align-items:center;gap:.35rem;padding:.4rem .85rem;border:1px solid var(--borda);border-bottom:0;border-radius:8px 8px 0 0;
  background:var(--superficie-2);color:var(--texto-2);text-decoration:none;font-size:.86rem;margin-bottom:-1px}
.abas a svg{width:15px;height:15px}
.abas a.ativa{background:var(--superficie);color:var(--titulo);font-weight:650;border-bottom:1px solid var(--superficie)}
.abas a.inativa{opacity:.45;pointer-events:none}
.painel{display:none} .painel.ativo{display:block}
fieldset.ficha{border:0;margin:0;padding:0;min-width:0;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:.45rem .7rem}
.ficha .f{display:flex;flex-direction:column;gap:2px;font-size:.74rem;color:var(--link);font-weight:550}
.ficha .f input,.ficha .f select,.ficha .f textarea{font-size:.92rem;padding:.38rem .5rem}
.ficha .f.obr > span::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#e5484d;margin-left:4px;vertical-align:2px}
.ficha input:disabled,.ficha select:disabled,.ficha textarea:disabled{background:var(--superficie-2);color:var(--texto);opacity:1;border-color:var(--borda)}
.ficha .grupo-ficha{grid-column:1/-1;font-size:.78rem;font-weight:700;color:var(--texto-2);text-transform:uppercase;letter-spacing:.06em;
  border-bottom:1px solid var(--borda);padding:.5rem 0 .2rem;margin-top:.3rem}
.ficha .com-botao{display:flex;gap:4px} .ficha .com-botao input{flex:1;min-width:0}
.ficha .com-botao button{padding:.3rem .55rem}
${[...Array(12)].map((_, i) => `.s${i + 1}{grid-column:span ${i + 1}}`).join('')}
.chave{display:flex;align-items:center;gap:.5rem;font-size:.74rem;color:var(--link);font-weight:550;flex-direction:column;align-items:flex-start}
.chave input{appearance:none;width:42px;height:22px;border-radius:999px;background:#e5484d;position:relative;cursor:pointer;border:0;padding:0;transition:background .15s}
.chave input::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
.chave input:checked{background:#16a34a} .chave input:checked::after{left:23px}
.chave input:disabled{opacity:.7;cursor:default}
.docs{margin-top:1.1rem} .docs .cab-docs{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.4rem}
.docs h3{margin:0;font-size:.9rem;color:var(--texto-2);text-transform:uppercase;letter-spacing:.06em}
.docs form.envio{display:grid;grid-template-columns:2fr 2fr auto;gap:.5rem;align-items:end;margin:.4rem 0 .6rem}
dialog.atalhos{border:1px solid var(--borda);border-radius:12px;background:var(--superficie);color:var(--texto);padding:1.2rem 1.4rem;box-shadow:var(--sombra)}
dialog.atalhos kbd{background:var(--superficie-2);border:1px solid var(--borda-forte);border-radius:4px;padding:0 .35rem;font-size:.82rem}
@media (max-width:900px){fieldset.ficha{grid-template-columns:repeat(2,minmax(0,1fr))} .ficha [class*=" s"],.ficha [class^="s"]{grid-column:span 2}
  .docs form.envio{grid-template-columns:1fr}}
`;

const JS = `
(function(){
  var raiz=document.getElementById('cadastro-aluno'); if(!raiz) return;
  var form=document.getElementById('form-aluno'), fs=form&&form.querySelector('fieldset');
  function modo(m){ raiz.setAttribute('data-modo',m); if(fs) fs.disabled=(m==='ver'); }
  window.alterarAluno=function(){ modo('editar'); var p=fs&&fs.querySelector('input:not([type=hidden])'); if(p) p.focus(); abrir('cadastro'); };
  window.cancelarAluno=function(){ location.reload(); };
  // abas
  function abrir(id){ document.querySelectorAll('.abas a[data-aba]').forEach(function(a){a.classList.toggle('ativa',a.dataset.aba===id)});
    document.querySelectorAll('.painel').forEach(function(p){p.classList.toggle('ativo',p.id==='aba-'+id)});
    if(id==='previa') atualizarPrevia(); history.replaceState(null,'','#'+id); }
  document.querySelectorAll('.abas a[data-aba]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();abrir(a.dataset.aba)})});
  var h=location.hash.slice(1); if(h&&document.getElementById('aba-'+h)) abrir(h);
  // atalhos de teclado
  document.addEventListener('keydown',function(e){
    var m=raiz.getAttribute('data-modo');
    if(e.key==='Escape'&&m==='editar'){ e.preventDefault(); cancelarAluno(); return; }
    if(!e.altKey) return; var k=e.key.toLowerCase();
    if(k==='i'){e.preventDefault();location.href='/admin/alunos/novo';}
    else if(k==='a'&&m==='ver'){e.preventDefault();alterarAluno();}
    else if(k==='s'&&m!=='ver'&&form){e.preventDefault();form.requestSubmit();}
    else if(k==='l'){e.preventDefault();location.href='/admin/alunos';}
    else if(k==='k'){e.preventDefault();document.getElementById('dlg-atalhos').showModal();}
  });
  // CEP (ViaCEP): envia só o CEP digitado
  var bcep=document.getElementById('buscar-cep');
  if(bcep) bcep.addEventListener('click',function(){
    var c=(form.cep.value||'').replace(/\\D/g,''); if(c.length!==8){alert('Informe um CEP com 8 dígitos.');return;}
    bcep.disabled=true;
    fetch('https://viacep.com.br/ws/'+c+'/json/').then(function(r){return r.json()}).then(function(j){
      if(j.erro){alert('CEP não encontrado.');return;}
      form.cep.value=c.slice(0,5)+'-'+c.slice(5);
      if(j.logradouro&&!form.endereco.value) form.endereco.value=j.logradouro;
      if(j.bairro) form.bairro.value=j.bairro;
      if(j.localidade) form.endereco_municipio.value=j.localidade;
      if(j.uf) form.endereco_uf.value=j.uf;
    }).catch(function(){alert('Não foi possível consultar o CEP agora.');}).finally(function(){bcep.disabled=false;});
  });
  // máscaras simples
  function mascara(nome,fn){ var el=form&&form[nome]; if(el) el.addEventListener('blur',function(){ el.value=fn(el.value); }); }
  mascara('cpf',function(v){var d=v.replace(/\\D/g,'');return d.length===11?d.replace(/(\\d{3})(\\d{3})(\\d{3})(\\d{2})/,'$1.$2.$3-$4'):v;});
  mascara('cep',function(v){var d=v.replace(/\\D/g,'');return d.length===8?d.slice(0,5)+'-'+d.slice(5):v;});
  // RG unificado ao CPF (CIN): o RG acompanha o CPF e fica só para leitura
  var cin=form&&form.rg_unificado_cpf;
  function sincronizarRg(){ if(!cin) return; var rg=form.rg, tag=form.querySelector('.rg-cin');
    rg.readOnly=cin.checked; if(tag) tag.hidden=!cin.checked;
    if(cin.checked){ var d=(form.cpf.value||'').replace(/\\D/g,''); rg.value=d.length===11?d.replace(/(\\d{3})(\\d{3})(\\d{3})(\\d{2})/,'$1.$2.$3-$4'):''; } }
  if(cin){ cin.addEventListener('change',function(){ if(!cin.checked) form.rg.value=''; sincronizarRg(); if(!cin.checked) form.rg.focus(); });
    form.cpf.addEventListener('input',sincronizarRg); sincronizarRg(); }
  ['telefone','celular'].forEach(function(n){ mascara(n,function(v){var d=v.replace(/\\D/g,'');
    return d.length===11?'('+d.slice(0,2)+') '+d.slice(2,7)+'-'+d.slice(7):d.length===10?'('+d.slice(0,2)+') '+d.slice(2,6)+'-'+d.slice(6):v;}); });
  // prévia do certificado: dados salvos (modo ver) ou rascunho do formulário (modo editar)
  var sel=document.getElementById('previa-alvo'), fr=document.getElementById('previa'), t, ctrl;
  function atualizarPrevia(){
    if(!sel||!fr||!sel.value) return;
    if(raiz.getAttribute('data-modo')==='ver'){ fr.removeAttribute('srcdoc'); fr.src='/admin/previa/'+sel.value; return; }
    if(ctrl) ctrl.abort(); ctrl=new AbortController();
    fetch('/admin/previa/'+sel.value+'/rascunho',{method:'POST',body:new FormData(form),signal:ctrl.signal})
      .then(function(r){return r.text()}).then(function(h){fr.srcdoc=h}).catch(function(){});
  }
  if(sel){ sel.addEventListener('change',atualizarPrevia); }
  if(form) form.addEventListener('input',function(){ clearTimeout(t); t=setTimeout(function(){ if(document.getElementById('aba-previa').classList.contains('ativo')) atualizarPrevia(); },500); });
})();`;

// ------------------------------------------------------------------ componentes
const F: FC<{ n: CampoAluno; r: string; s: number; a: Partial<Aluno>; tipo?: string; extra?: Record<string, string | number> }> = ({ n, r, s, a, tipo = 'text', extra }) => (
  <label class={`f s${s} ${OBRIGATORIOS.has(n) ? 'obr' : ''}`}>
    <span>{r}</span>
    <input name={n} type={tipo} value={n === 'cpf' && a.cpf ? formatarCPF(a.cpf) : a[n] ?? ''} {...(extra ?? {})} />
  </label>
);

const S: FC<{ n: CampoAluno; r: string; s: number; a: Partial<Aluno>; opcoes: [string, string][] }> = ({ n, r, s, a, opcoes }) => (
  <label class={`f s${s} ${OBRIGATORIOS.has(n) ? 'obr' : ''}`}>
    <span>{r}</span>
    <select name={n}>
      <option value="">Selecione</option>
      {opcoes.map(([v, t]) => <option value={v} selected={a[n] != null && String(a[n]) === v}>{t}</option>)}
    </select>
  </label>
);

type Aba = 'cadastro' | 'matriculas' | 'previa' | 'localizar';

const Moldura: FC<{
  c: any; titulo: string; aba: Aba; modo: 'ver' | 'editar' | 'novo' | 'lista'; aluno?: Partial<Aluno>;
  erro?: string | null; ok?: string | null; children: Child;
}> = ({ c, titulo, aba, modo, aluno, erro, ok, children }) => {
  const u = c.get('usuario');
  const id = aluno?.id;
  const podeExcluir = !!id && pode(u, 'alunos.excluir');
  const lista = modo === 'lista';
  return (
    <Pagina titulo={titulo} usuario={u} caminho="/admin/alunos" erro={erro} ok={ok} voltar={lista ? '/admin' : '/admin/alunos'}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div id="cadastro-aluno" data-modo={lista ? 'ver' : modo}>
        <div class="ficha-titulo">Cadastro de Alunos {id ? <small>· {nomeDoAluno(aluno!)}</small> : modo === 'novo' ? <small>· novo aluno</small> : null}</div>
        <div class="ferramentas">
          <a class="fb verde" href="/admin/alunos/novo" title="Incluir (Alt+I)"><Icone nome="incluir" />Incluir</a>
          <button type="button" class="fb ambar so-ver" disabled={!id} onclick="alterarAluno()" title="Alterar (Alt+A)"><Icone nome="alterar" />Alterar</button>
          <button type="submit" form="form-aluno" class="fb verde so-editar" title="Salvar (Alt+S)"><Icone nome="salvar" />Salvar</button>
          <button type="button" class="fb so-editar" onclick={id ? 'cancelarAluno()' : "location.href='/admin/alunos'"} title="Cancelar (Esc)"><Icone nome="cancelar" />Cancelar</button>
          {podeExcluir ? (
            <form method="post" action={`/admin/alunos/${id}/excluir`} onsubmit="return confirm('Excluir este aluno? Só é possível se ele não tiver matrícula.')">
              <button class="fb vermelho so-ver" title="Excluir"><Icone nome="excluir" />Excluir</button>
            </form>
          ) : (
            <button type="button" class="fb vermelho so-ver" disabled title="Excluir"><Icone nome="excluir" />Excluir</button>
          )}
          <a class="fb azul so-ver" href={id ? `/admin/alunos/${id}` : '/admin/alunos'} title="Atualizar"><Icone nome="atualizar" />Atualizar</a>
          <button type="button" class="fb" onclick="document.getElementById('dlg-atalhos').showModal()" title="Atalhos (Alt+K)"><Icone nome="atalhos" />Atalhos</button>
          <a class="fb vermelho" href="/admin" title="Sair"><Icone nome="sair" />Sair</a>
        </div>
        <nav class="abas">
          {lista
            ? <a href={'/admin/alunos/novo'} class="inativa"><Icone nome="documento" />Cadastro</a>
            : <a href="#cadastro" data-aba="cadastro" class={aba === 'cadastro' ? 'ativa' : ''}><Icone nome="documento" />Cadastro</a>}
          {lista || !id
            ? <a href="#" class="inativa"><Icone nome="turmas" />Matrículas</a>
            : <a href="#matriculas" data-aba="matriculas"><Icone nome="turmas" />Matrículas</a>}
          {lista || !id
            ? <a href="#" class="inativa"><Icone nome="certificados" />Prévia do certificado</a>
            : <a href="#previa" data-aba="previa"><Icone nome="certificados" />Prévia do certificado</a>}
          <a href="/admin/alunos" class={lista ? 'ativa' : ''}><Icone nome="buscar" />Localizar</a>
        </nav>
        {children}
        <dialog id="dlg-atalhos" class="atalhos">
          <h3 style="margin-top:0">Atalhos de teclado</h3>
          <p><kbd>Alt</kbd>+<kbd>I</kbd> Incluir novo aluno</p>
          <p><kbd>Alt</kbd>+<kbd>A</kbd> Alterar o cadastro aberto</p>
          <p><kbd>Alt</kbd>+<kbd>S</kbd> Salvar</p>
          <p><kbd>Esc</kbd> Cancelar a alteração</p>
          <p><kbd>Alt</kbd>+<kbd>L</kbd> Localizar aluno</p>
          <p><kbd>Alt</kbd>+<kbd>K</kbd> Mostrar estes atalhos</p>
          <form method="dialog"><button>Fechar</button></form>
        </dialog>
      </div>
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </Pagina>
  );
};

interface PreviaOpcao { matricula_id: number; modulo_id: number; rotulo: string }
interface MatriculaAluno { id: number; turma_id: number; turma: string; curso: string; situacao: string; status: string; ultimo_status: string | null; data_inicio: string | null; data_fim: string | null }
interface DocumentoAluno { id: number; descricao: string; nome_arquivo: string; r2_key: string; tipo: string; tamanho: number; enviado_por: string; criado_em: string }

const tamanho = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

function Ficha({ a, modo }: { a: Partial<Aluno>; modo: 'ver' | 'editar' | 'novo' }) {
  const usarSocial = !!a.nome_social?.trim() && (a.usar_nome_social == null || String(a.usar_nome_social) === '1');
  return (
    <form method="post" id="form-aluno" action={a.id ? `/admin/alunos/${a.id}` : '/admin/alunos/novo'}>
      <fieldset class="ficha" disabled={modo === 'ver'}>
        <label class="f s1"><span>ID</span><input value={a.id ?? ''} disabled /></label>
        <F n="ra" r="RA (matrícula)" s={3} a={a} />
        <S n="sexo" r="Sexo" s={3} a={a} opcoes={SEXOS} />
        <F n="cpf" r="CPF" s={5} a={a} extra={{ inputmode: 'numeric', placeholder: '000.000.000-00' }} />

        <F n="nome_civil" r="Nome do aluno (nome civil)" s={12} a={a} />
        <label class="f s10"><span>Nome social <small style="color:var(--texto-2)">(usado nos documentos quando a chave ao lado estiver ligada)</small></span>
          <input name="nome_social" value={a.nome_social ?? ''} /></label>
        <label class="chave s2">Usar nome social<input type="checkbox" name="usar_nome_social" value="1" checked={usarSocial} role="switch" /></label>

        <F n="nome_mae" r="Nome filiação 1 (mãe — 2º nome na filiação do certificado)" s={6} a={a} />
        <F n="nome_pai" r="Nome filiação 2 (pai — 1º nome na filiação do certificado)" s={6} a={a} />

        <F n="data_nascimento" r="Data de nascimento" s={2} a={a} tipo="date" />
        <S n="estado_civil" r="Estado civil" s={2} a={a} opcoes={ESTADOS_CIVIS} />
        <F n="naturalidade_municipio" r="Naturalidade (município)" s={4} a={a} />
        <S n="naturalidade_uf" r="UF de naturalidade" s={2} a={a} opcoes={UFS} />
        <F n="nacionalidade" r="Nacionalidade" s={2} a={{ ...a, nacionalidade: a.nacionalidade ?? (a.id ? null : 'brasileira') }} />

        <S n="cor_raca" r="Cor/raça" s={3} a={a} opcoes={CORES} />
        <F n="necessidades_especificas" r="Necessidades educacionais específicas" s={9} a={a} />

        <label class="chave s2" title="Carteira de Identidade Nacional (CIN): o número do RG é o próprio CPF">
          RG unificado ao CPF<input type="checkbox" name="rg_unificado_cpf" value="1" checked={String(a.rg_unificado_cpf ?? '0') === '1'} role="switch" />
        </label>
        <label class={`f s3 obr`}>
          <span>RG <small class="rg-cin" style="color:var(--texto-2)" hidden={String(a.rg_unificado_cpf ?? '0') !== '1'}>(= CPF)</small></span>
          <input name="rg" value={a.rg ?? ''} />
        </label>
        <F n="rg_orgao_expedidor" r="Órgão expedidor" s={3} a={a} extra={{ placeholder: 'SEJUSP' }} />
        <S n="rg_uf" r="UF do RG" s={1} a={a} opcoes={UFS} />
        <F n="rg_data_expedicao" r="Data de expedição" s={3} a={a} tipo="date" />

        <div class="grupo-ficha">Endereço e contato</div>
        <label class="f s2"><span>CEP</span>
          <span class="com-botao"><input name="cep" value={a.cep ?? ''} inputmode="numeric" placeholder="00000-000" />
            <button type="button" class="sec" id="buscar-cep" title="Buscar endereço pelo CEP"><Icone nome="buscar" /></button></span>
        </label>
        <F n="endereco" r="Endereço" s={6} a={a} />
        <F n="bairro" r="Bairro" s={4} a={a} />
        <F n="complemento" r="Complemento" s={5} a={a} />
        <F n="endereco_municipio" r="Município" s={5} a={a} />
        <S n="endereco_uf" r="UF" s={2} a={a} opcoes={UFS} />
        <F n="telefone" r="Telefone" s={3} a={a} extra={{ placeholder: '(00) 0000-0000' }} />
        <F n="celular" r="Celular" s={3} a={a} extra={{ placeholder: '(00) 00000-0000' }} />
        <F n="email" r="E-mail" s={6} a={a} tipo="email" extra={{ placeholder: 'exemplo@dominio.com' }} />

        <div class="grupo-ficha">Ensino médio (verso do certificado)</div>
        <F n="ensino_medio_instituicao" r="Instituição" s={6} a={a} />
        <F n="ensino_medio_municipio" r="Município" s={3} a={a} />
        <S n="ensino_medio_uf" r="UF" s={1} a={a} opcoes={UFS} />
        <F n="ensino_medio_ano_conclusao" r="Ano de conclusão" s={2} a={a} tipo="number" />
        <F n="escolaridade" r="Escolaridade" s={12} a={a} />
      </fieldset>
    </form>
  );
}

function Documentos({ a, docs }: { a: Partial<Aluno>; docs: DocumentoAluno[] }) {
  return (
    <div class="docs cartao so-existente">
      <div class="cab-docs"><h3>Documentos</h3><span class="muted">PDF, JPG ou PNG até 10 MB</span></div>
      <form method="post" action={`/admin/alunos/${a.id}/documentos`} enctype="multipart/form-data" class="envio">
        <label>Descrição<input name="descricao" list="descricoes-doc" required placeholder="Ex.: RG, histórico do ensino médio" /></label>
        <label>Arquivo<input type="file" name="arquivo" accept="application/pdf,image/png,image/jpeg" required /></label>
        <button><Icone nome="incluir" />Anexar</button>
        <datalist id="descricoes-doc">{DESCRICOES_DOC.map((d) => <option value={d} />)}</datalist>
      </form>
      <table>
        <tr><th class="n" style="width:2.5rem">#</th><th style="width:6rem">Ações</th><th>Descrição</th><th>Arquivo</th><th class="n">Tamanho</th><th>Data</th></tr>
        {docs.map((d, i) => (
          <tr>
            <td class="n">{i + 1}</td>
            <td style="white-space:nowrap">
              <a href={urlArquivo(d.r2_key)!} target="_blank" title="Abrir">abrir</a>
              <form method="post" action={`/admin/alunos/${a.id}/documentos/${d.id}/excluir`} style="display:inline" onsubmit="return confirm('Excluir este documento da lista? O arquivo continua guardado no histórico.')">
                {' · '}<button class="sec" style="padding:0 .3rem;font-size:.8rem;border:0;color:var(--erro)" title="Excluir">excluir</button>
              </form>
            </td>
            <td>{d.descricao}</td>
            <td>{d.nome_arquivo}<div class="muted">{d.enviado_por}</div></td>
            <td class="n">{tamanho(d.tamanho)}</td>
            <td>{dataBR(d.criado_em)}</td>
          </tr>
        ))}
      </table>
      {!docs.length && <p class="muted" style="text-align:center;margin:.8rem 0 0">Não existem documentos anexados.</p>}
    </div>
  );
}

async function dadosDoAluno(db: D1Database, id: number) {
  const [aluno, previas, matriculas, docs, turmas] = await Promise.all([
    db.prepare('SELECT * FROM alunos WHERE id = ?').bind(id).first<Aluno>(),
    db.prepare(
      `SELECT m.id AS matricula_id, mt.id AS modulo_id, t.codigo || ' — Módulo ' || mt.ordem || ': ' || mt.nome AS rotulo
         FROM matriculas m JOIN turmas t ON t.id = m.turma_id
         JOIN modulos_tematicos mt ON mt.matriz_id = t.matriz_id AND mt.tem_terminalidade = 1
        WHERE m.aluno_id = ? ORDER BY t.data_inicio DESC, mt.ordem`,
    ).bind(id).all<PreviaOpcao>(),
    db.prepare(
      `SELECT m.id, m.turma_id, t.codigo AS turma, cu.nome AS curso, m.situacao, m.status, t.data_inicio, t.data_fim,
              (SELECT h.data || ' · ' || coalesce(h.motivo, '') FROM matricula_status_historico h WHERE h.matricula_id = m.id ORDER BY h.id DESC LIMIT 1) AS ultimo_status
         FROM matriculas m JOIN turmas t ON t.id = m.turma_id JOIN cursos cu ON cu.id = t.curso_id WHERE m.aluno_id = ? ORDER BY t.data_inicio DESC`,
    ).bind(id).all<MatriculaAluno>(),
    db.prepare('SELECT * FROM aluno_documentos WHERE aluno_id = ? AND excluido_em IS NULL ORDER BY id').bind(id).all<DocumentoAluno>(),
    db.prepare('SELECT id, codigo FROM turmas WHERE id NOT IN (SELECT turma_id FROM matriculas WHERE aluno_id = ?) ORDER BY data_inicio DESC').bind(id).all<{ id: number; codigo: string }>(),
  ]);
  return { aluno, previas: previas.results, matriculas: matriculas.results, docs: docs.results, turmas: turmas.results };
}

async function telaAluno(c: any, id: number, opcoes: { erro?: string; rascunho?: Partial<Aluno> } = {}) {
  const d = await dadosDoAluno(c.env.DB, id);
  if (!d.aluno) return null;
  const a = { ...d.aluno, ...(opcoes.rascunho ?? {}) };
  const modo = opcoes.erro ? 'editar' : 'ver';
  const falt = faltantesAluno(a);
  const podePrevia = pode(c.get('usuario'), 'relatorios.emitir');
  return (
    <Moldura c={c} titulo={`Aluno: ${nomeDoAluno(a)}`} aba="cadastro" modo={modo} aluno={a} erro={opcoes.erro} ok={c.req.query('ok')}>
      <section class="painel ativo" id="aba-cadastro">
        {falt.length > 0 && <div class="msg aviso">Faltam para o certificado: {falt.join(', ')}.</div>}
        <Ficha a={a} modo={modo} />
        <Documentos a={a} docs={d.docs} />
      </section>
      <section class="painel" id="aba-matriculas">
        <table>
          <tr><th>Turma</th><th>Curso</th><th>Período</th><th>Status</th><th>Situação</th><th></th></tr>
          {d.matriculas.map((m) => (
            <tr>
              <td><a href={`/admin/turmas/${m.turma_id}`}>{m.turma}</a></td>
              <td>{m.curso}</td>
              <td>{m.data_inicio ? dataBR(m.data_inicio) : '?'} a {m.data_fim ? dataBR(m.data_fim) : '?'}</td>
              <td><span class={`tag ${classeStatus(m.status)}`}>{ROTULO_STATUS[m.status] ?? m.status}</span>
                {m.ultimo_status && <div class="muted" style="font-size:.74rem">desde {dataBR(m.ultimo_status.slice(0, 10))}{m.ultimo_status.slice(13) ? ` — ${m.ultimo_status.slice(13)}` : ''}</div>}</td>
              <td><span class="tag">{m.situacao}</span></td>
              <td><a href={`/admin/turmas/${m.turma_id}`}>resultados</a></td>
            </tr>
          ))}
        </table>
        {!d.matriculas.length && <p class="muted">Este aluno ainda não está matriculado em nenhuma turma.</p>}
        {d.turmas.length > 0 && (
          <form method="post" action={`/admin/alunos/${id}/matriculas`} class="acoes">
            <select name="turma_id" required><option value="">Matricular na turma…</option>{d.turmas.map((t) => <option value={t.id}>{t.codigo}</option>)}</select>
            <button>Matricular</button>
          </form>
        )}
      </section>
      <section class="painel" id="aba-previa">
        {podePrevia && d.previas.length ? (
          <>
            <div class="acoes">
              <select id="previa-alvo">{d.previas.map((p) => <option value={`${p.matricula_id}/${p.modulo_id}`}>{p.rotulo}</option>)}</select>
              <a class="botao sec" href="#" onclick="var v=document.getElementById('previa-alvo').value;window.open('/admin/previa/'+v);return false">Abrir em tela cheia</a>
              <span class="muted">Em "Alterar", a prévia acompanha o que você digita (sem salvar).</span>
            </div>
            <iframe id="previa" title="Prévia do certificado" style="width:100%;height:1500px;border:1px solid var(--borda);border-radius:8px;background:var(--superficie-2)" />
          </>
        ) : (
          <p class="muted">A prévia aparece quando o aluno estiver matriculado em uma turma.</p>
        )}
      </section>
    </Moldura>
  );
}

// ------------------------------------------------------------------ rotas
rotasAlunos.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const digitos = somenteDigitos(q);
  const lista = (
    await c.env.DB.prepare(
      `SELECT a.*, (SELECT group_concat(t.codigo, ', ') FROM matriculas m JOIN turmas t ON t.id = m.turma_id WHERE m.aluno_id = a.id) AS turmas
         FROM alunos a
        WHERE ? = '' OR a.nome_civil LIKE ? OR a.nome_social LIKE ? OR a.ra = ? OR (? <> '' AND a.cpf LIKE ?)
        ORDER BY a.nome_civil LIMIT 300`,
    ).bind(q, `%${q}%`, `%${q}%`, q, digitos, `${digitos}%`).all<Aluno & { turmas: string | null }>()
  ).results;
  return c.html(
    <Moldura c={c} titulo="Alunos" aba="localizar" modo="lista" ok={c.req.query('ok')}>
      <form method="get" class="acoes" style="margin-top:0">
        <input name="q" value={q} placeholder="Nome, CPF ou RA" autofocus style="min-width:280px" />
        <button class="sec"><Icone nome="buscar" />Localizar</button>
        <span class="muted">{lista.length} aluno(s){q ? ` para "${q}"` : ''}</span>
      </form>
      <table>
        <tr><th>Nome</th><th>CPF</th><th>RA</th><th>Turmas</th><th>Dados p/ certificado</th><th></th></tr>
        {lista.map((a) => {
          const f = faltantesAluno(a);
          return (
            <tr>
              <td><a href={`/admin/alunos/${a.id}`}>{nomeDoAluno(a)}</a>{nomeDoAluno(a) !== a.nome_civil && <div class="muted">civil: {a.nome_civil}</div>}</td>
              <td style="white-space:nowrap">{a.cpf ? formatarCPF(a.cpf) : ''}</td>
              <td>{a.ra ?? ''}</td>
              <td>{a.turmas ?? '—'}</td>
              <td>{f.length ? <span class="tag aviso" title={f.join(', ')}>{f.length} campo(s) faltando</span> : <span class="tag ok">completos</span>}</td>
              <td><a href={`/admin/alunos/${a.id}`}>abrir</a></td>
            </tr>
          );
        })}
      </table>
      {!lista.length && <p class="muted">Nenhum aluno encontrado.</p>}
    </Moldura>,
  );
});

const telaNovo = (c: any, a: Partial<Aluno> = {}, erro?: string) => (
  <Moldura c={c} titulo="Novo aluno" aba="cadastro" modo="novo" aluno={a} erro={erro}>
    <section class="painel ativo" id="aba-cadastro"><Ficha a={a} modo="novo" /></section>
  </Moldura>
);

async function cpfDuplicado(db: D1Database, cpf: string, id = 0) {
  return db.prepare('SELECT nome_civil FROM alunos WHERE cpf = ? AND id <> ?').bind(cpf, id).first<{ nome_civil: string }>();
}

rotasAlunos.get('/novo', (c) => c.html(telaNovo(c)));

rotasAlunos.post('/novo', async (c) => {
  const corpo = await lerCorpo(c);
  let d;
  try {
    d = lerAluno(corpo);
    const dup = await cpfDuplicado(c.env.DB, d.cpf!);
    if (dup) throw new ErroValidacao(`CPF já cadastrado para ${dup.nome_civil}.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return c.html(telaNovo(c, lerAluno(corpo, true) as Partial<Aluno>, e.message), 400);
    throw e;
  }
  const cols = CAMPOS_ALUNO.filter((k) => d[k] != null); // vazios ficam com o padrão do banco
  const r = await c.env.DB.prepare(`INSERT INTO alunos (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`)
    .bind(...cols.map((k) => (CAMPOS_ALUNO_SIM_NAO.has(k) ? Number(d[k]) : d[k])))
    .first<{ id: number }>();
  await auditar(c, 'criar', 'aluno', r!.id, null, d);
  return c.redirect(`/admin/alunos/${r!.id}?ok=` + encodeURIComponent('Aluno cadastrado.'));
});

rotasAlunos.get('/:id{[0-9]+}', async (c) => {
  const tela = await telaAluno(c, Number(c.req.param('id')));
  return tela ? c.html(tela) : c.notFound();
});

rotasAlunos.post('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const antes = await c.env.DB.prepare('SELECT * FROM alunos WHERE id = ?').bind(id).first<Aluno>();
  if (!antes) return c.notFound();
  const corpo = await lerCorpo(c);
  let d;
  try {
    d = lerAluno(corpo);
    const dup = await cpfDuplicado(c.env.DB, d.cpf!, id);
    if (dup) throw new ErroValidacao(`CPF já cadastrado para ${dup.nome_civil}.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return c.html((await telaAluno(c, id, { erro: e.message, rascunho: lerAluno(corpo, true) as Partial<Aluno> }))!, 400);
    throw e;
  }
  const cols = CAMPOS_ALUNO;
  await c.env.DB.prepare(`UPDATE alunos SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .bind(...cols.map((k) => (CAMPOS_ALUNO_SIM_NAO.has(k) ? Number(d[k]) : d[k])), id)
    .run();
  const mudou = Object.fromEntries(cols.filter((k) => String(antes[k] ?? '') !== String(d[k] ?? '')).map((k) => [k, d[k]]));
  const era = Object.fromEntries(Object.keys(mudou).map((k) => [k, antes[k as keyof Aluno]]));
  if (Object.keys(mudou).length) await auditar(c, 'atualizar', 'aluno', id, era, mudou);
  return c.redirect(`/admin/alunos/${id}?ok=` + encodeURIComponent('Dados salvos.'));
});

rotasAlunos.post('/:id{[0-9]+}/excluir', exigir('alunos.excluir'), async (c) => {
  const id = Number(c.req.param('id'));
  const a = await c.env.DB.prepare('SELECT * FROM alunos WHERE id = ?').bind(id).first<Aluno>();
  if (!a) return c.notFound();
  const tem = await c.env.DB.prepare('SELECT 1 FROM matriculas WHERE aluno_id = ?1 UNION ALL SELECT 1 FROM aluno_documentos WHERE aluno_id = ?1 UNION ALL SELECT 1 FROM documentos WHERE aluno_id = ?1 LIMIT 1').bind(id).first();
  if (tem) return c.redirect(`/admin/alunos/${id}?ok=` + encodeURIComponent('Não excluído: o aluno possui matrícula, documentos anexados ou documentos emitidos.'));
  await c.env.DB.prepare('DELETE FROM alunos WHERE id = ?').bind(id).run();
  await auditar(c, 'excluir', 'aluno', id, a, null);
  return c.redirect('/admin/alunos?ok=' + encodeURIComponent('Aluno excluído.'));
});

rotasAlunos.post('/:id{[0-9]+}/matriculas', exigir('turmas.editar'), async (c) => {
  const id = Number(c.req.param('id'));
  const turmaId = Number(texto(await lerCorpo(c), 'turma_id'));
  const ok = await c.env.DB.prepare('SELECT (SELECT 1 FROM alunos WHERE id = ?) AS a, (SELECT 1 FROM turmas WHERE id = ?) AS t').bind(id, turmaId).first<{ a: number | null; t: number | null }>();
  if (!ok?.a || !ok?.t) return c.notFound();
  const r = await c.env.DB.prepare('INSERT INTO matriculas (aluno_id, turma_id) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING id').bind(id, turmaId).first<{ id: number }>();
  if (r) await auditar(c, 'criar', 'matricula', r.id, null, { aluno_id: id, turma_id: turmaId });
  return c.redirect(`/admin/alunos/${id}?ok=` + encodeURIComponent('Aluno matriculado.') + '#matriculas');
});

rotasAlunos.post('/:id{[0-9]+}/documentos', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await c.env.DB.prepare('SELECT 1 FROM alunos WHERE id = ?').bind(id).first())) return c.notFound();
  const corpo = await lerCorpo(c);
  const descricao = texto(corpo, 'descricao');
  const arq = arquivo(corpo, 'arquivo');
  try {
    if (!descricao) throw new ErroValidacao('Informe a descrição do documento.');
    if (!arq) throw new ErroValidacao('Selecione o arquivo.');
    const chave = await salvarArquivo(c.env.ARQUIVOS, `alunos/${id}`, arq, [...TIPOS_PDF, ...TIPOS_IMAGEM], 10, 'Documento');
    const tipo = chave.endsWith('.pdf') ? 'application/pdf' : chave.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const r = await c.env.DB.prepare(
      'INSERT INTO aluno_documentos (aluno_id, descricao, nome_arquivo, r2_key, tipo, tamanho, enviado_por) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    ).bind(id, descricao.slice(0, 150), arq.name.slice(0, 200), chave, tipo, arq.size, c.get('usuario').email).first<{ id: number }>();
    await auditar(c, 'anexar_documento', 'aluno', id, null, { documento_id: r!.id, descricao, arquivo: arq.name, tamanho: arq.size });
  } catch (e) {
    if (e instanceof ErroValidacao) return c.html((await telaAluno(c, id, { erro: e.message }))!, 400);
    throw e;
  }
  return c.redirect(`/admin/alunos/${id}?ok=` + encodeURIComponent('Documento anexado.'));
});

rotasAlunos.post('/:id{[0-9]+}/documentos/:doc{[0-9]+}/excluir', async (c) => {
  const id = Number(c.req.param('id'));
  const docId = Number(c.req.param('doc'));
  const d = await c.env.DB.prepare('SELECT * FROM aluno_documentos WHERE id = ? AND aluno_id = ? AND excluido_em IS NULL').bind(docId, id).first<DocumentoAluno>();
  if (!d) return c.notFound();
  await c.env.DB.prepare(`UPDATE aluno_documentos SET excluido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), excluido_por = ? WHERE id = ?`).bind(c.get('usuario').email, docId).run();
  await auditar(c, 'excluir_documento', 'aluno', id, { documento_id: docId, descricao: d.descricao, arquivo: d.nome_arquivo, r2_key: d.r2_key }, null);
  return c.redirect(`/admin/alunos/${id}?ok=` + encodeURIComponent('Documento excluído da lista (o arquivo continua no histórico).'));
});
