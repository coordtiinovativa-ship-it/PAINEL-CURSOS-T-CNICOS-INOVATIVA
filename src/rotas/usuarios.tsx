import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Icone, Pagina, Selecao } from '../views/layout';
import { exigir, encerrarSessoesDoUsuario } from '../auth/sessao';
import {
  GRUPOS_PERMISSAO, PERFIS, PERMISSOES, ROTULO_PERFIL, padraoDoPerfil, pode, podeAjustarPermissao, podeAjustarUsuario,
  type AjustePermissao, type Perfil,
} from '../auth/permissoes';
import { gerarHashSenha, gerarSenhaTemporaria } from '../auth/senha';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, lerCorpo, marcado, texto } from '../lib/form';
import { dataBR } from '../lib/datas';

interface Usuario {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: number;
  trocar_senha: number;
  ultimo_acesso: string | null;
  bloqueado_ate: string | null;
}

export const rotasUsuarios = new Hono<Env>();
// Lista e permissões: admin master e administrador; criar/editar/senha: só quem gerencia usuários (admin master).
const gerenciar = exigir('usuarios.gerenciar');

const OPCOES_PERFIL = PERFIS.map((p) => [p, ROTULO_PERFIL[p]] as [string, string]);

rotasUsuarios.get('/', exigir('usuarios.permissoes'), async (c) => {
  const eu = c.get('usuario');
  const gerencia = pode(eu, 'usuarios.gerenciar');
  const lista = (await c.env.DB.prepare(
    `SELECT u.*, (SELECT count(*) FROM usuario_permissoes p WHERE p.usuario_id = u.id) AS ajustes
       FROM usuarios u ORDER BY u.ativo DESC, u.nome`).all<Usuario & { ajustes: number }>()).results;
  return c.html(
    <Pagina titulo="Usuários" usuario={eu} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS_PERM }} />
      <h1>Usuários e Permissões</h1>
      <p class="muted">Cada usuário segue o padrão do perfil (tabela abaixo). Em <b>permissões</b> você libera ou bloqueia funções só para
        aquela pessoa. O admin master sempre pode tudo.</p>
      {gerencia && (
        <div class="acoes">
          <a class="botao" href="/admin/usuarios/novo">+ Novo usuário</a>
        </div>
      )}
      <table>
        <tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr>
        {lista.map((u) => (
          <tr>
            <td>{u.nome}</td>
            <td>{u.email}</td>
            <td>{ROTULO_PERFIL[u.perfil]}{u.ajustes ? <> <span class="tag aviso" title="Tem funções liberadas ou bloqueadas só para este usuário">personalizado</span></> : null}</td>
            <td>
              {u.ativo ? <span class="tag ok">ativo</span> : <span class="tag erro">inativo</span>}{' '}
              {u.trocar_senha ? <span class="tag aviso">senha temporária</span> : null}
              {u.bloqueado_ate && u.bloqueado_ate > new Date().toISOString() ? <span class="tag erro">bloqueado</span> : null}
            </td>
            <td>{u.ultimo_acesso ? `${dataBR(u.ultimo_acesso)} ${u.ultimo_acesso.slice(11, 16)} UTC` : '—'}</td>
            <td>
              {[
                gerencia && <a href={`/admin/usuarios/${u.id}`}>editar</a>,
                podeAjustarUsuario(eu, u) && <a href={`/admin/usuarios/${u.id}/permissoes`}>permissões</a>,
                pode(eu, 'auditoria.ver') && <a href={`/admin/auditoria?usuario=${u.id}`}>atividade</a>,
              ].filter(Boolean).map((l, i) => <>{i ? ' · ' : ''}{l}</>)}
            </td>
          </tr>
        ))}
      </table>

      <h2>O que cada perfil pode fazer (padrão)</h2>
      <table>
        <tr>
          <th>Permissão</th>
          {PERFIS.map((p) => <th class="c">{ROTULO_PERFIL[p]}</th>)}
        </tr>
        {GRUPOS_PERMISSAO.map((g) => (
          <>
            <tr><th colspan={PERFIS.length + 1} class="grupo-perm">{g.rotulo}</th></tr>
            {g.permissoes.map((k) => (
              <tr>
                <td>{PERMISSOES[k].rotulo}</td>
                {PERFIS.map((p) => <td class="c">{padraoDoPerfil(p, k) ? '✓' : '—'}</td>)}
              </tr>
            ))}
          </>
        ))}
      </table>
    </Pagina>,
  );
});

const FormUsuario = ({ u, c, erro }: { u?: Partial<Usuario>; c: any; erro?: string }) => (
  <Pagina titulo={u?.id ? 'Editar usuário' : 'Novo usuário'} usuario={c.get('usuario')} caminho={c.req.path} erro={erro}>
    <h1>{u?.id ? `Editar usuário: ${u.nome}` : 'Novo usuário'}</h1>
    <div class="cartao">
      <form method="post" class="grade">
        <Campo nome="nome" rotulo="Nome" valor={u?.nome} obrigatorio />
        <Campo nome="email" rotulo="E-mail" tipo="email" valor={u?.email} obrigatorio />
        <Selecao nome="perfil" rotulo="Perfil" valor={u?.perfil} opcoes={OPCOES_PERFIL} obrigatorio />
        {u?.id && (
          <label class="check">
            <input type="checkbox" name="ativo" value="1" checked={!!u.ativo} /> Ativo
          </label>
        )}
        <div class="largo acoes">
          <button>Salvar</button>
          <a class="botao sec" href="/admin/usuarios">Cancelar</a>
          {u?.id && u.perfil && podeAjustarUsuario(c.get('usuario'), { id: u.id, perfil: u.perfil }) &&
            <a class="botao sec" href={`/admin/usuarios/${u.id}/permissoes`}>Permissões deste usuário</a>}
        </div>
      </form>
    </div>
    {u?.id && (
      <div class="cartao">
        <h2>Redefinir senha</h2>
        <p class="muted">Gera uma senha temporária, encerra as sessões abertas e obriga a troca no próximo acesso.</p>
        <form method="post" action={`/admin/usuarios/${u.id}/resetar-senha`}>
          <button class="sec">Gerar senha temporária</button>
        </form>
      </div>
    )}
  </Pagina>
);

const TelaSenhaTemporaria = ({ c, nome, email, senha }: { c: any; nome: string; email: string; senha: string }) => (
  <Pagina titulo="Senha temporária" usuario={c.get('usuario')} caminho={c.req.path}>
    <h1>Senha temporária</h1>
    <div class="cartao">
      <p>Repasse estes dados a <strong>{nome}</strong> por um canal seguro. A senha <strong>não será exibida novamente</strong> e
        deverá ser trocada no primeiro acesso.</p>
      <table style="max-width:520px">
        <tr><th>E-mail</th><td>{email}</td></tr>
        <tr><th>Senha temporária</th><td><code style="font-size:1.2rem">{senha}</code></td></tr>
      </table>
      <div class="acoes"><a class="botao" href="/admin/usuarios">Voltar para usuários</a></div>
    </div>
  </Pagina>
);

function lerUsuario(corpo: Awaited<ReturnType<typeof lerCorpo>>) {
  const nome = texto(corpo, 'nome');
  const email = texto(corpo, 'email')?.toLowerCase() ?? null;
  const perfil = texto(corpo, 'perfil') as Perfil | null;
  if (!nome) throw new ErroValidacao('Informe o nome.');
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErroValidacao('E-mail inválido.');
  if (!perfil || !PERFIS.includes(perfil)) throw new ErroValidacao('Perfil inválido.');
  return { nome, email, perfil };
}

rotasUsuarios.get('/novo', gerenciar, (c) => c.html(<FormUsuario c={c} />));

rotasUsuarios.post('/novo', gerenciar, async (c) => {
  const corpo = await lerCorpo(c);
  let dados;
  try {
    dados = lerUsuario(corpo);
  } catch (e) {
    return c.html(<FormUsuario c={c} u={{ nome: texto(corpo, 'nome') ?? '', email: texto(corpo, 'email') ?? '' }} erro={(e as Error).message} />, 400);
  }
  const existe = await c.env.DB.prepare('SELECT 1 FROM usuarios WHERE email = ?').bind(dados.email).first();
  if (existe) return c.html(<FormUsuario c={c} u={dados} erro="Já existe um usuário com este e-mail." />, 400);
  const senha = gerarSenhaTemporaria();
  const r = await c.env.DB.prepare(
    'INSERT INTO usuarios (nome, email, perfil, senha_hash, trocar_senha) VALUES (?, ?, ?, ?, 1) RETURNING id',
  )
    .bind(dados.nome, dados.email, dados.perfil, await gerarHashSenha(senha))
    .first<{ id: number }>();
  await auditar(c, 'criar', 'usuario', r!.id, null, dados);
  return c.html(<TelaSenhaTemporaria c={c} nome={dados.nome} email={dados.email} senha={senha} />);
});

async function carregar(c: any): Promise<Usuario | null> {
  return c.env.DB.prepare('SELECT * FROM usuarios WHERE id = ?').bind(Number(c.req.param('id'))).first();
}

async function mastersAtivos(db: D1Database): Promise<number> {
  const r = await db.prepare(`SELECT count(*) AS n FROM usuarios WHERE perfil = 'admin_master' AND ativo = 1`).first<{ n: number }>();
  return r?.n ?? 0;
}

rotasUsuarios.get('/:id{[0-9]+}', gerenciar, async (c) => {
  const u = await carregar(c);
  if (!u) return c.notFound();
  return c.html(<FormUsuario c={c} u={u} />);
});

rotasUsuarios.post('/:id{[0-9]+}', gerenciar, async (c) => {
  const antes = await carregar(c);
  if (!antes) return c.notFound();
  const corpo = await lerCorpo(c);
  let dados;
  try {
    dados = { ...lerUsuario(corpo), ativo: marcado(corpo, 'ativo') };
    const eu = c.get('usuario');
    if (antes.id === eu.id && (dados.perfil !== antes.perfil || !dados.ativo)) {
      throw new ErroValidacao('Você não pode alterar o próprio perfil nem se desativar.');
    }
    const deixaDeSerMaster = antes.perfil === 'admin_master' && antes.ativo && (dados.perfil !== 'admin_master' || !dados.ativo);
    if (deixaDeSerMaster && (await mastersAtivos(c.env.DB)) <= 1) {
      throw new ErroValidacao('É preciso manter pelo menos um admin master ativo.');
    }
    const dup = await c.env.DB.prepare('SELECT 1 FROM usuarios WHERE email = ? AND id <> ?').bind(dados.email, antes.id).first();
    if (dup) throw new ErroValidacao('Já existe um usuário com este e-mail.');
  } catch (e) {
    return c.html(<FormUsuario c={c} u={antes} erro={(e as Error).message} />, 400);
  }
  await c.env.DB.prepare(
    `UPDATE usuarios SET nome = ?, email = ?, perfil = ?, ativo = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
  )
    .bind(dados.nome, dados.email, dados.perfil, dados.ativo, antes.id)
    .run();
  if (!dados.ativo || dados.perfil !== antes.perfil) await encerrarSessoesDoUsuario(c.env.DB, antes.id);
  const { nome, email, perfil, ativo } = antes;
  await auditar(c, 'atualizar', 'usuario', antes.id, { nome, email, perfil, ativo }, dados);
  return c.redirect('/admin/usuarios?ok=' + encodeURIComponent('Usuário atualizado.'));
});

rotasUsuarios.post('/:id{[0-9]+}/resetar-senha', gerenciar, async (c) => {
  const u = await carregar(c);
  if (!u) return c.notFound();
  const senha = gerarSenhaTemporaria();
  await c.env.DB.prepare(
    'UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ?',
  )
    .bind(await gerarHashSenha(senha), u.id)
    .run();
  await encerrarSessoesDoUsuario(c.env.DB, u.id);
  await auditar(c, 'resetar_senha', 'usuario', u.id);
  return c.html(<TelaSenhaTemporaria c={c} nome={u.nome} email={u.email} senha={senha} />);
});

// ------------------------------------------------------------------ permissões por usuário
type Escolha = 'padrao' | 'liberar' | 'bloquear';

async function ajustesDe(db: D1Database, id: number): Promise<Map<string, boolean>> {
  const r = await db.prepare('SELECT permissao, concedida FROM usuario_permissoes WHERE usuario_id = ?').bind(id).all<AjustePermissao>();
  return new Map(r.results.map((a) => [a.permissao, !!a.concedida]));
}

const CSS_PERM = `
.perm td{vertical-align:middle}
.perm .esc{display:inline-flex;border:1px solid var(--borda-forte);border-radius:8px;overflow:hidden}
.perm .esc label{flex-direction:row;align-items:center;gap:0;margin:0;cursor:pointer;font-weight:550;position:relative}
.perm .esc input{position:absolute;opacity:0;width:1px;height:1px}
.perm .esc span{padding:.28rem .65rem;font-size:.8rem;color:var(--texto-2);border-left:1px solid var(--borda)}
.perm .esc label:first-child span{border-left:0}
.perm .esc input:checked+span{background:var(--primaria);color:var(--primaria-texto)}
.perm .esc input[value=liberar]:checked+span{background:var(--ok);color:#fff}
.perm .esc input[value=bloquear]:checked+span{background:var(--erro);color:#fff}
.perm .esc input:focus-visible+span{outline:3px solid var(--foco)}
.perm tr.ajustado td:first-child{box-shadow:inset 3px 0 0 var(--ciano)}
.perm .final{white-space:nowrap}
th.grupo-perm{background:var(--superficie-2);color:var(--titulo);text-transform:uppercase;letter-spacing:.06em;font-size:.76rem}
`;

const JS_PERM = `
document.querySelectorAll('.perm tr[data-padrao]').forEach(function(tr){
  function atualizar(){
    var e=(tr.querySelector('input:checked')||{}).value||'padrao', pad=tr.dataset.padrao==='1';
    var sim=e==='liberar'?true:e==='bloquear'?false:pad;
    tr.querySelector('.final').innerHTML=sim?'<span class="tag ok">pode</span>':'<span class="tag erro">não pode</span>';
    tr.classList.toggle('ajustado',e!=='padrao');
  }
  tr.querySelectorAll('input').forEach(function(i){i.addEventListener('change',atualizar)});
});`;

const ROTULO_ESCOLHA: Record<Escolha, string> = { padrao: 'Padrão', liberar: 'Liberar', bloquear: 'Bloquear' };

rotasUsuarios.get('/:id{[0-9]+}/permissoes', exigir('usuarios.permissoes'), async (c) => {
  const u = await carregar(c);
  if (!u) return c.notFound();
  const eu = c.get('usuario');
  if (!podeAjustarUsuario(eu, u)) {
    return c.redirect('/admin/usuarios?erro=' + encodeURIComponent(
      u.perfil === 'admin_master' ? 'O admin master sempre pode tudo: não há permissões para ajustar.'
        : u.id === eu.id ? 'Você não pode ajustar as suas próprias permissões.'
        : 'O administrador ajusta só usuários de perfil Coordenador ou Secretaria.'));
  }
  const aj = await ajustesDe(c.env.DB, u.id);
  return c.html(
    <Pagina titulo={`Permissões: ${u.nome}`} usuario={eu} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')} voltar="/admin/usuarios">
      <style dangerouslySetInnerHTML={{ __html: CSS_PERM }} />
      <h1>Permissões: {u.nome}</h1>
      <p>Perfil <b>{ROTULO_PERFIL[u.perfil]}</b> · {u.email}{u.ativo ? '' : ' · inativo'}</p>
      <p class="muted">
        <b>Padrão</b> = o que o perfil pode (coluna “Perfil”). <b>Liberar</b> dá a função a esta pessoa mesmo que o perfil não tenha;
        <b> Bloquear</b> tira a função só dela. Vale a partir da próxima tela que ela abrir e fica registrado na auditoria.
        {eu.perfil !== 'admin_master' && ' Você só pode liberar funções que você mesmo tem; a gerência de usuários fica com o admin master.'}
      </p>
      <form method="post" class="perm">
        <table>
          <tr><th>Função</th><th class="c">Perfil</th><th>Para este usuário</th><th>Resultado</th></tr>
          {GRUPOS_PERMISSAO.map((g) => (
            <>
              <tr><th colspan={4} class="grupo-perm">{g.rotulo}</th></tr>
              {g.permissoes.map((k) => {
                const pad = padraoDoPerfil(u.perfil, k);
                const esc: Escolha = aj.has(k) ? (aj.get(k) ? 'liberar' : 'bloquear') : 'padrao';
                const final = aj.has(k) ? aj.get(k)! : pad;
                return (
                  <tr data-padrao={pad ? '1' : '0'} class={esc !== 'padrao' ? 'ajustado' : ''}>
                    <td>{PERMISSOES[k].rotulo}</td>
                    <td class="c">{pad ? '✓' : '—'}</td>
                    <td>
                      {podeAjustarPermissao(eu, k)
                        ? <span class="esc" role="radiogroup" aria-label={PERMISSOES[k].rotulo}>
                            {(['padrao', 'liberar', 'bloquear'] as Escolha[]).map((e) => (
                              <label><input type="radio" name={`p_${k}`} value={e} checked={esc === e} /><span>{ROTULO_ESCOLHA[e]}</span></label>
                            ))}
                          </span>
                        : <span class="muted">{ROTULO_ESCOLHA[esc]} (só o admin master altera)</span>}
                    </td>
                    <td class="final">{final ? <span class="tag ok">pode</span> : <span class="tag erro">não pode</span>}</td>
                  </tr>
                );
              })}
            </>
          ))}
        </table>
        <div class="acoes">
          <button><Icone nome="salvar" />Salvar permissões</button>
          <button class="sec" name="acao" value="padrao" onclick="return confirm('Voltar todas as funções ao padrão do perfil?')">Voltar tudo ao padrão do perfil</button>
          <a class="botao sec" href="/admin/usuarios">Cancelar</a>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: JS_PERM }} />
    </Pagina>,
  );
});

rotasUsuarios.post('/:id{[0-9]+}/permissoes', exigir('usuarios.permissoes'), async (c) => {
  const u = await carregar(c);
  if (!u) return c.notFound();
  const eu = c.get('usuario');
  if (!podeAjustarUsuario(eu, u)) return c.text('Você não pode ajustar as permissões deste usuário.', 403);
  const corpo = await lerCorpo(c);
  const db = c.env.DB;
  const antes = await ajustesDe(db, u.id);
  const depois = new Map(antes);
  const todas = GRUPOS_PERMISSAO.flatMap((g) => g.permissoes);
  const tudoPadrao = texto(corpo, 'acao') === 'padrao';
  for (const k of todas) {
    if (!podeAjustarPermissao(eu, k)) continue; // o que o editor não pode ajustar fica como está
    const e = (tudoPadrao ? 'padrao' : texto(corpo, `p_${k}`) ?? 'padrao') as Escolha;
    // escolha igual ao padrão do perfil não precisa de ajuste
    if (e === 'padrao' || (e === 'liberar') === padraoDoPerfil(u.perfil, k)) depois.delete(k);
    else depois.set(k, e === 'liberar');
  }
  const mudou = todas.filter((k) => antes.get(k) !== depois.get(k));
  const volta = `/admin/usuarios/${u.id}/permissoes?ok=`;
  if (!mudou.length) return c.redirect(volta + encodeURIComponent('Nada foi alterado.'));
  await db.batch(mudou.map((k) => depois.has(k)
    ? db.prepare(`INSERT INTO usuario_permissoes (usuario_id, permissao, concedida, atualizado_por) VALUES (?, ?, ?, ?)
        ON CONFLICT (usuario_id, permissao) DO UPDATE SET concedida = excluded.concedida, atualizado_por = excluded.atualizado_por,
        atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')`).bind(u.id, k, depois.get(k) ? 1 : 0, eu.email)
    : db.prepare('DELETE FROM usuario_permissoes WHERE usuario_id = ? AND permissao = ?').bind(u.id, k)));
  const rot = (m: Map<string, boolean>, k: string) => (m.has(k) ? (m.get(k) ? 'liberada' : 'bloqueada') : 'padrão do perfil');
  await auditar(c, 'permissoes', 'usuario', u.id,
    Object.fromEntries(mudou.map((k) => [k, rot(antes, k)])), Object.fromEntries(mudou.map((k) => [k, rot(depois, k)])));
  return c.redirect(volta + encodeURIComponent(`Permissões de ${u.nome} salvas (${mudou.length} alteração(ões)).`));
});
