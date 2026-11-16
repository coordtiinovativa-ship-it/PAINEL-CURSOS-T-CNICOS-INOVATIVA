import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import type { Env } from './tipos';
import { Pagina } from './views/layout';
import { exigirLogin } from './auth/sessao';
import { rotasAuth, rotasConta } from './rotas/auth';
import { rotasInicio } from './rotas/inicio';
import { rotasUsuarios } from './rotas/usuarios';
import { rotasAuditoria } from './rotas/auditoria';
import { rotasInstituicao } from './rotas/instituicao';
import { rotasSignatarios } from './rotas/signatarios';
import { rotasCursos } from './rotas/cursos';
import { rotasAlunos } from './rotas/alunos';
import { rotasTurmas } from './rotas/turmas';
import { rotasPrevia } from './rotas/previa';
import { rotasCertificados } from './rotas/certificados';
import { rotasModelo } from './rotas/modelo';
import { rotasPendentes } from './rotas/pendentes';
import { rotasPublico } from './rotas/publico';
import { limitarPorIP } from './lib/limite';

export type { Env } from './tipos';

const app = new Hono<Env>();

app.use('*', secureHeaders({ xFrameOptions: 'SAMEORIGIN', crossOriginResourcePolicy: 'same-origin' }));
// Bloqueia envio de formulário a partir de outro site (proteção CSRF por Origin)
app.use('*', csrf());

app.get('/', (c) => c.redirect('/admin'));
app.get('/saude', async (c) => {
  const r = await c.env.DB.prepare('SELECT count(*) AS n FROM cursos').first<{ n: number }>();
  return c.json({ ok: true, ambiente: c.env.AMBIENTE, cursos: r?.n ?? 0 });
});

// Limites por IP (Rate Limiting nativo do Cloudflare Workers — ver wrangler.toml)
const limiteValidacao = limitarPorIP('LIMITE_VALIDACAO', {
  mensagem: 'Foram feitas muitas consultas de certificados a partir da sua conexão.',
});
app.use('/v', limiteValidacao);
app.use('/v/*', limiteValidacao);
app.use('/login', limitarPorIP('LIMITE_LOGIN', {
  apenasMetodo: 'POST',
  mensagem: 'Foram feitas muitas tentativas de entrar a partir da sua conexão.',
}));

app.route('/', rotasAuth); // /login
app.route('/v', rotasPublico); // validação pública (sem login)

// ---------------- Painel (login obrigatório) ----------------
app.use('/admin', exigirLogin);
app.use('/admin/*', exigirLogin);
app.route('/admin', rotasConta); // /admin/sair, /admin/conta/senha
app.route('/admin', rotasInicio);
app.route('/admin/usuarios', rotasUsuarios);
app.route('/admin/auditoria', rotasAuditoria);
app.route('/admin/instituicao', rotasInstituicao);
app.route('/admin/signatarios', rotasSignatarios);
app.route('/admin/cursos', rotasCursos);
app.route('/admin/alunos', rotasAlunos);
app.route('/admin/turmas', rotasTurmas);
app.route('/admin/previa', rotasPrevia);
app.route('/admin/certificados/pendentes', rotasPendentes);
app.route('/admin/certificados', rotasCertificados);
app.route('/admin/modelo', rotasModelo);

// Arquivos privados do R2 (logos, assinaturas, portarias) — somente usuários logados
app.get('/admin/arquivos/*', async (c) => {
  const chave = decodeURIComponent(c.req.path.replace('/admin/arquivos/', ''));
  if (chave.includes('..')) return c.notFound();
  const obj = await c.env.ARQUIVOS.get(chave);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

app.notFound((c) => c.html(<Pagina titulo="Não encontrado" usuario={c.get('usuario')}><h1>Página não encontrada</h1><p><a href="/admin">Voltar ao início</a></p></Pagina>, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    if (err.status === 403) {
      return c.html(<Pagina titulo="Sem permissão" usuario={c.get('usuario')}><h1>Sem permissão</h1><p>{err.message}</p><p><a href="/admin">Voltar ao início</a></p></Pagina>, 403);
    }
    return err.getResponse();
  }
  console.error(err);
  return c.html(<Pagina titulo="Erro" usuario={c.get('usuario')}><h1>Ocorreu um erro</h1><p>Tente novamente. Se persistir, informe o administrador.</p></Pagina>, 500);
});

export default app;
