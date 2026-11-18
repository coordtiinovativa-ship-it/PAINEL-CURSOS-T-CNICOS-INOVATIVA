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
import { rotasCursosGestao } from './rotas/cursos-gestao';
import { rotasAlunos } from './rotas/alunos';
import { rotasTurmas } from './rotas/turmas';
import { rotasPrevia } from './rotas/previa';
import { rotasCertificados } from './rotas/certificados';
import { rotasModelo } from './rotas/modelo';
import { rotasPendentes } from './rotas/pendentes';
import { rotasPublico } from './rotas/publico';
import { limitarPorIP } from './lib/limite';
import { rotasDocumentos } from './rotas/documentos';
import { rotasImportacao } from './rotas/importacao';
import { rotasRelatorios } from './rotas/relatorios';
import { rotasFaltasTotal, rotasNotasProfessor, rotasNotasSecretaria } from './rotas/lancamentos';
import { rotasNovidades } from './rotas/novidades';
import { rotasFuncionarios } from './rotas/funcionarios';
import { rotasCalendario } from './rotas/calendario';
import { rotasLotacao } from './rotas/lotacao';
import { rotasHorario } from './rotas/horario';
import { rotasChamada, rotasFaltasSecretaria } from './rotas/chamada';

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
app.route('/admin/cursos', rotasCursosGestao);
app.route('/admin/cursos', rotasCursos);
app.route('/admin/alunos', rotasAlunos);
app.route('/admin/turmas', rotasTurmas);
app.route('/admin/previa', rotasPrevia);
app.route('/admin/certificados/pendentes', rotasPendentes);
app.route('/admin/certificados', rotasCertificados);
app.route('/admin/modelo', rotasModelo);
app.route('/admin/documentos', rotasDocumentos);
app.route('/admin/importacao', rotasImportacao);
app.route('/admin/relatorios', rotasRelatorios);
// Secretaria → Notas / Faltas (a antiga "Notas e Faltas" foi desmembrada em 18/11/2026)
app.route('/admin/notas', rotasNotasSecretaria);
app.route('/admin/faltas/total', rotasFaltasTotal);
app.route('/admin/faltas', rotasFaltasSecretaria);
app.get('/admin/diario', (c) => c.redirect('/admin/notas'));
app.get('/admin/diario/:turma{[0-9]+}/:modulo{[0-9]+}/:comp{[0-9]+}?', (c) =>
  c.redirect(`/admin/notas?turma=${c.req.param('turma')}&modulo=${c.req.param('modulo')}&disciplina=${c.req.param('comp') ?? ''}`));
app.route('/admin/novidades', rotasNovidades);
// Gestão Pedagógica
app.route('/admin/pedagogico/funcionarios', rotasFuncionarios);
app.route('/admin/pedagogico/lotacao', rotasLotacao);
app.route('/admin/pedagogico/horario', rotasHorario);
app.route('/admin/pedagogico/faltas', rotasChamada);
app.route('/admin/pedagogico/notas', rotasNotasProfessor);
app.route('/admin/pedagogico', rotasCalendario); // /anos e /calendario

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
