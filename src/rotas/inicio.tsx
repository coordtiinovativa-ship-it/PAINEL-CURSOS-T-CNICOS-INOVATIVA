import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Pagina } from '../views/layout';
import { pode } from '../auth/permissoes';
import { dataBR } from '../lib/datas';
import { OBRIGATORIOS_ALUNO } from '../certificado/dados';

export const rotasInicio = new Hono<Env>();

/** Logo vertical centralizado no espaço livre da tela (como na tela inicial do sysGEP). */
const CSS_INICIO = `
.inicio{min-height:calc(100vh - 130px);display:flex;flex-direction:column}
.inicio-logo{flex:1;display:grid;place-items:center;padding:2.5rem 0 1rem}
.inicio-logo img{width:min(400px,70vw);height:auto;display:block}
html[data-tema="escuro"] .inicio-logo img{background:#fff;border-radius:18px;padding:22px 26px;box-shadow:var(--sombra)}
@media (prefers-color-scheme: dark){ html[data-tema="sistema"] .inicio-logo img{background:#fff;border-radius:18px;padding:22px 26px;box-shadow:var(--sombra)} }
@media (max-width:900px){ .inicio{min-height:0} .inicio-logo img{width:min(260px,70vw)} }
`;

rotasInicio.get('/', async (c) => {
  const db = c.env.DB;
  const u = c.get('usuario');
  const condFaltante = OBRIGATORIOS_ALUNO.map(([k]) => `coalesce(trim(${k}), '') = ''`).join(' OR ');
  const [contagens, alunosIncompletos, signatarios, inst] = await Promise.all([
    db.prepare(
      `SELECT (SELECT count(*) FROM alunos) AS alunos, (SELECT count(*) FROM turmas) AS turmas,
              (SELECT count(*) FROM matriculas WHERE situacao = 'cursando') AS cursando,
              (SELECT count(*) FROM certificados WHERE status = 'válido') AS certificados`,
    ).first<Record<string, number>>(),
    db.prepare(`SELECT count(*) AS n FROM alunos WHERE ${condFaltante}`).first<{ n: number }>(),
    db.prepare(`SELECT nome, cargo, assinatura_r2_key FROM signatarios WHERE ativo = 1 AND funcao IN ('diretor_pedagogico','secretario')`).all<Record<string, any>>(),
    db.prepare('SELECT validade_credenciamento FROM instituicoes WHERE id = 1').first<{ validade_credenciamento: string | null }>(),
  ]);

  const alertas: { tipo: 'erro' | 'aviso'; texto: string; link?: string }[] = [];
  const podeSig = pode(u.perfil, 'signatarios.editar');
  if (signatarios.results.length < 2) alertas.push({ tipo: 'erro', texto: 'Faltam signatários ativos (Diretora Pedagógica e Secretário(a)).', link: podeSig ? '/admin/signatarios' : undefined });
  for (const s of signatarios.results) {
    if (s.nome.includes('A DEFINIR')) alertas.push({ tipo: 'erro', texto: `Signatário "${s.cargo}" sem nome cadastrado.`, link: podeSig ? '/admin/signatarios' : undefined });
    else if (!s.assinatura_r2_key) alertas.push({ tipo: 'aviso', texto: `Assinatura digitalizada de ${s.nome} não enviada.`, link: podeSig ? '/admin/modelo' : undefined });
  }
  if (alunosIncompletos?.n) alertas.push({ tipo: 'aviso', texto: `${alunosIncompletos.n} aluno(s) com dados obrigatórios do certificado faltando.`, link: '/admin/alunos' });
  const validade = inst?.validade_credenciamento;
  if (validade) {
    const dias = Math.floor((Date.parse(validade) - Date.now()) / 86400_000);
    if (dias < 180) alertas.push({ tipo: dias < 0 ? 'erro' : 'aviso', texto: `Credenciamento ${dias < 0 ? 'vencido' : 'vence'} em ${dataBR(validade)}.`, link: '/admin/instituicao' });
  }

  return c.html(
    <Pagina titulo="Início" usuario={u} caminho={c.req.path} ok={c.req.query('ok')}>
      <style dangerouslySetInnerHTML={{ __html: CSS_INICIO }} />
      <div class="inicio">
      <h1>Olá, {u.nome.split(' ')[0]}</h1>
      <div class="kpis">
        <a class="cartao" href="/admin/alunos" style="text-decoration:none"><b>{contagens?.alunos ?? 0}</b>alunos</a>
        <a class="cartao" href="/admin/turmas" style="text-decoration:none"><b>{contagens?.turmas ?? 0}</b>turmas</a>
        <div class="cartao"><b>{contagens?.cursando ?? 0}</b>matrículas em curso</div>
        <div class="cartao"><b>{contagens?.certificados ?? 0}</b>certificados válidos</div>
      </div>
      <h2>Pendências</h2>
      {alertas.length ? (
        alertas.map((a) => (
          <div class={`msg ${a.tipo}`}>{a.texto} {a.link && <a href={a.link}>resolver</a>}</div>
        ))
      ) : (
        <div class="msg ok">Nenhuma pendência.</div>
      )}
      <div class="inicio-logo">
        <img src="/modelo/logo-vertical.png" alt="Instituto Inovativa — Soluções em Educação" width="829" height="698" />
      </div>
      </div>
    </Pagina>,
  );
});
