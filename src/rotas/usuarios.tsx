import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Pagina, Selecao } from '../views/layout';
import { exigir, encerrarSessoesDoUsuario } from '../auth/sessao';
import { PERFIS, PERMISSOES, ROTULO_PERFIL, type Perfil } from '../auth/permissoes';
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
rotasUsuarios.use('*', exigir('usuarios.gerenciar'));

const OPCOES_PERFIL = PERFIS.map((p) => [p, ROTULO_PERFIL[p]] as [string, string]);

rotasUsuarios.get('/', async (c) => {
  const lista = (await c.env.DB.prepare('SELECT * FROM usuarios ORDER BY ativo DESC, nome').all<Usuario>()).results;
  return c.html(
    <Pagina titulo="Usuários" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Usuários</h1>
      <div class="acoes">
        <a class="botao" href="/admin/usuarios/novo">+ Novo usuário</a>
      </div>
      <table>
        <tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr>
        {lista.map((u) => (
          <tr>
            <td>{u.nome}</td>
            <td>{u.email}</td>
            <td>{ROTULO_PERFIL[u.perfil]}</td>
            <td>
              {u.ativo ? <span class="tag ok">ativo</span> : <span class="tag erro">inativo</span>}{' '}
              {u.trocar_senha ? <span class="tag aviso">senha temporária</span> : null}
              {u.bloqueado_ate && u.bloqueado_ate > new Date().toISOString() ? <span class="tag erro">bloqueado</span> : null}
            </td>
            <td>{u.ultimo_acesso ? `${dataBR(u.ultimo_acesso)} ${u.ultimo_acesso.slice(11, 16)} UTC` : '—'}</td>
            <td><a href={`/admin/usuarios/${u.id}`}>editar</a> · <a href={`/admin/auditoria?usuario=${u.id}`}>atividade</a></td>
          </tr>
        ))}
      </table>

      <h2>O que cada perfil pode fazer</h2>
      <table>
        <tr>
          <th>Permissão</th>
          {PERFIS.map((p) => <th class="c">{ROTULO_PERFIL[p]}</th>)}
        </tr>
        {Object.values(PERMISSOES).map((perm) => (
          <tr>
            <td>{perm.rotulo}</td>
            {PERFIS.map((p) => <td class="c">{(perm.perfis as readonly string[]).includes(p) ? '✓' : '—'}</td>)}
          </tr>
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

rotasUsuarios.get('/novo', (c) => c.html(<FormUsuario c={c} />));

rotasUsuarios.post('/novo', async (c) => {
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

rotasUsuarios.get('/:id{[0-9]+}', async (c) => {
  const u = await carregar(c);
  if (!u) return c.notFound();
  return c.html(<FormUsuario c={c} u={u} />);
});

rotasUsuarios.post('/:id{[0-9]+}', async (c) => {
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

rotasUsuarios.post('/:id{[0-9]+}/resetar-senha', async (c) => {
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
