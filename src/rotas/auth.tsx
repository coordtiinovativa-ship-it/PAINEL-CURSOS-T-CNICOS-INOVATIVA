import { Hono } from 'hono';
import type { Env } from '../tipos';
import { getCookie, setCookie } from 'hono/cookie';
import { Pagina, PaginaLogin, TEMAS, type Tema } from '../views/layout';
import { gerarHashSenha, problemaSenha, verificarSenha } from '../auth/senha';
import {
  BLOQUEIO_MIN,
  criarSessao,
  encerrarSessao,
  encerrarSessoesDoUsuario,
  MAX_TENTATIVAS,
} from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { lerCorpo, texto } from '../lib/form';

// Hash de uma senha qualquer, usado para igualar o tempo de resposta quando o e-mail não existe.
const HASH_FICTICIO = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const destinoSeguro = (v: string | null | undefined) =>
  v && v.startsWith('/admin') && !v.startsWith('//') ? v : '/admin';

export const rotasAuth = new Hono<Env>();

export const COOKIE_TEMA = 'tema';
const temaValido = (t: unknown): Tema | null => (TEMAS.includes(t as Tema) ? (t as Tema) : null);
export const temaDoCookie = (c: any): Tema => temaValido(getCookie(c, COOKIE_TEMA)) ?? 'sistema';

function gravarCookieTema(c: any, tema: Tema) {
  setCookie(c, COOKIE_TEMA, tema, { path: '/', maxAge: 365 * 86400, sameSite: 'Lax', secure: c.env.AMBIENTE === 'production' });
}

/** Resposta após trocar o tema: 204 para o fetch do seletor; sem JS, volta à página anterior. */
function respostaTema(c: any, padrao: string) {
  if (c.req.header('X-Requested-With') === 'fetch') return c.body(null, 204);
  const ref = c.req.header('Referer');
  let destino = padrao;
  try {
    const u = ref ? new URL(ref) : null;
    if (u && u.origin === new URL(c.req.url).origin) destino = u.pathname + u.search;
  } catch { /* usa o padrão */ }
  return c.redirect(destino);
}

const TelaLogin = ({ c, erro, voltar, email }: { c: any; erro?: string; voltar?: string; email?: string }) => (
  <PaginaLogin titulo="Entrar" erro={erro} tema={temaDoCookie(c)}>
    <h1>Sistema de Certificados</h1>
    <p class="muted">Cursos técnicos presenciais · acesso restrito à equipe do Instituto Inovativa.</p>
    <form method="post" action="/login">
      <input type="hidden" name="voltar" value={voltar ?? ''} />
      <label>
        E-mail
        <input name="email" type="email" required autofocus autocomplete="username" value={email ?? ''} />
      </label>
      <label>
        Senha
        <input name="senha" type="password" required autocomplete="current-password" />
      </label>
        <button type="submit">Entrar</button>
    </form>
  </PaginaLogin>
);

rotasAuth.get('/login', (c) => c.html(<TelaLogin c={c} voltar={c.req.query('voltar')} />));

/** Tema na tela de login (sem usuário): só cookie. */
rotasAuth.post('/tema', async (c) => {
  const tema = temaValido(texto(await lerCorpo(c), 'tema'));
  if (tema) gravarCookieTema(c, tema);
  return respostaTema(c, '/login');
});

rotasAuth.post('/login', async (c) => {
  const corpo = await lerCorpo(c);
  const email = (texto(corpo, 'email') ?? '').toLowerCase();
  const senha = typeof corpo.senha === 'string' ? corpo.senha : '';
  const voltar = texto(corpo, 'voltar') ?? '';
  const db = c.env.DB;
  const agora = new Date();

  const u = await db
    .prepare('SELECT id, email, senha_hash, ativo, tentativas_falhas, bloqueado_ate FROM usuarios WHERE email = ?')
    .bind(email)
    .first<{ id: number; email: string; senha_hash: string; ativo: number; tentativas_falhas: number; bloqueado_ate: string | null }>();

  const falha = (msg = 'E-mail ou senha incorretos.') =>
    c.html(<TelaLogin c={c} erro={msg} voltar={voltar} email={email} />, 401);

  if (!u) {
    await verificarSenha(senha, HASH_FICTICIO);
    await auditar(c, 'login_falha', 'usuario', null, null, { motivo: 'e-mail não cadastrado' }, { id: null, email });
    return falha();
  }
  if (u.bloqueado_ate && u.bloqueado_ate > agora.toISOString()) {
    await auditar(c, 'login_bloqueado', 'usuario', u.id, null, null, u);
    const min = Math.ceil((Date.parse(u.bloqueado_ate) - agora.getTime()) / 60000);
    return falha(`Acesso bloqueado por excesso de tentativas. Tente novamente em ${min} min.`);
  }
  const ok = await verificarSenha(senha, u.senha_hash);
  if (!ok || !u.ativo) {
    const tentativas = u.tentativas_falhas + 1;
    const bloquear = tentativas >= MAX_TENTATIVAS;
    await db
      .prepare('UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?')
      .bind(bloquear ? 0 : tentativas, bloquear ? new Date(agora.getTime() + BLOQUEIO_MIN * 60000).toISOString() : null, u.id)
      .run();
    await auditar(c, 'login_falha', 'usuario', u.id, null, { motivo: ok ? 'usuário inativo' : 'senha incorreta', bloqueado: bloquear }, u);
    return falha();
  }

  await db
    .prepare('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_acesso = ? WHERE id = ?')
    .bind(agora.toISOString(), u.id)
    .run();
  await criarSessao(c, u.id);
  await auditar(c, 'login', 'usuario', u.id, null, null, u);
  return c.redirect(destinoSeguro(voltar));
});

// ---------------- Rotas autenticadas da própria conta ----------------
export const rotasConta = new Hono<Env>(); // montado sob /admin, que já exige login

/** Preferência de tema do usuário logado: salva no cadastro (vale em qualquer computador) e no cookie. */
rotasConta.post('/conta/tema', async (c) => {
  const tema = temaValido(texto(await lerCorpo(c), 'tema'));
  if (tema) {
    const u = c.get('usuario');
    if (tema !== u.tema) {
      await c.env.DB.prepare('UPDATE usuarios SET tema = ? WHERE id = ?').bind(tema, u.id).run();
      await auditar(c, 'alterar_tema', 'usuario', u.id, { tema: u.tema }, { tema });
    }
    gravarCookieTema(c, tema);
  }
  return respostaTema(c, '/admin');
});

rotasConta.get('/sair', async (c) => {
  await auditar(c, 'logout', 'usuario', c.get('usuario').id);
  await encerrarSessao(c);
  return c.redirect('/login');
});

const TelaSenha = ({ c, erro }: { c: any; erro?: string }) => {
  const u = c.get('usuario');
  return (
    <Pagina titulo="Alterar senha" usuario={u} caminho={c.req.path} erro={erro} ok={c.req.query('ok')}>
      <div class="cartao" style="max-width:460px">
        <h1>Alterar senha</h1>
        {u.trocar_senha ? (
          <div class="msg aviso">Você está usando uma senha temporária. Defina sua senha pessoal para continuar.</div>
        ) : null}
        <form method="post">
          <label>
            Senha atual
            <input name="senha_atual" type="password" required autocomplete="current-password" />
          </label>
          <label>
            Nova senha
            <input name="nova_senha" type="password" required minlength={10} autocomplete="new-password" />
            <span class="muted">Mínimo de 10 caracteres, com letras e números.</span>
          </label>
          <label>
            Confirme a nova senha
            <input name="confirmacao" type="password" required minlength={10} autocomplete="new-password" />
          </label>
          <button>Salvar nova senha</button>
        </form>
      </div>
    </Pagina>
  );
};

rotasConta.get('/conta/senha', (c) => c.html(<TelaSenha c={c} />));

rotasConta.post('/conta/senha', async (c) => {
  const corpo = await lerCorpo(c);
  const atual = String(corpo.senha_atual ?? '');
  const nova = String(corpo.nova_senha ?? '');
  const conf = String(corpo.confirmacao ?? '');
  const u = c.get('usuario');
  const reg = await c.env.DB.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').bind(u.id).first<{ senha_hash: string }>();
  if (!reg || !(await verificarSenha(atual, reg.senha_hash))) return c.html(<TelaSenha c={c} erro="Senha atual incorreta." />, 400);
  if (nova !== conf) return c.html(<TelaSenha c={c} erro="A confirmação não confere com a nova senha." />, 400);
  if (nova === atual) return c.html(<TelaSenha c={c} erro="A nova senha deve ser diferente da atual." />, 400);
  const problema = problemaSenha(nova);
  if (problema) return c.html(<TelaSenha c={c} erro={problema} />, 400);

  await c.env.DB.prepare(
    `UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
  )
    .bind(await gerarHashSenha(nova), u.id)
    .run();
  await encerrarSessoesDoUsuario(c.env.DB, u.id); // derruba sessões em outros dispositivos
  await criarSessao(c, u.id);
  await auditar(c, 'senha_alterada', 'usuario', u.id);
  return c.redirect('/admin?ok=' + encodeURIComponent('Senha alterada com sucesso.'));
});
