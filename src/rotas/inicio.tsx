import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Pagina } from '../views/layout';
import { pode } from '../auth/permissoes';
import { dataBR } from '../lib/datas';
import { OBRIGATORIOS_ALUNO } from '../certificado/dados';

export const rotasInicio = new Hono<Env>();

rotasInicio.get('/', async (c) => {
  const db = c.env.DB;
  const u = c.get('usuario');
  const condFaltante = OBRIGATORIOS_ALUNO.map(([k]) => `coalesce(trim(${k}), '') = ''`).join(' OR ');
  const [contagens, alunosIncompletos, signatarios, inst, doe] = await Promise.all([
    db.prepare(
      `SELECT (SELECT count(*) FROM alunos) AS alunos, (SELECT count(*) FROM turmas) AS turmas,
              (SELECT count(*) FROM matriculas WHERE situacao = 'cursando') AS cursando,
              (SELECT count(*) FROM certificados WHERE status = 'válido') AS certificados`,
    ).first<Record<string, number>>(),
    db.prepare(`SELECT count(*) AS n FROM alunos WHERE ${condFaltante}`).first<{ n: number }>(),
    db.prepare(`SELECT nome, cargo, assinatura_r2_key FROM signatarios WHERE ativo = 1 AND funcao IN ('diretor_pedagogico','secretario')`).all<Record<string, any>>(),
    db.prepare('SELECT validade_credenciamento FROM instituicoes WHERE id = 1').first<{ validade_credenciamento: string | null }>(),
    db.prepare(`SELECT count(*) AS n FROM atos_regulatorios WHERE finalidade = 'autorizacao_curso' AND publicacao_doe_numero IS NULL`).first<{ n: number }>(),
  ]);

  const alertas: { tipo: 'erro' | 'aviso'; texto: string; link?: string }[] = [];
  const podeSig = pode(u.perfil, 'signatarios.editar');
  if (signatarios.results.length < 2) alertas.push({ tipo: 'erro', texto: 'Faltam signatários ativos (Diretora Pedagógica e Secretário(a)).', link: podeSig ? '/admin/signatarios' : undefined });
  for (const s of signatarios.results) {
    if (s.nome.includes('A DEFINIR')) alertas.push({ tipo: 'erro', texto: `Signatário "${s.cargo}" sem nome cadastrado.`, link: podeSig ? '/admin/signatarios' : undefined });
    else if (!s.assinatura_r2_key) alertas.push({ tipo: 'aviso', texto: `Assinatura digitalizada de ${s.nome} não enviada.`, link: podeSig ? '/admin/modelo' : undefined });
  }
  if (doe?.n) alertas.push({ tipo: 'aviso', texto: 'Publicação no DOE/MS do ato de autorização do curso ainda não informada.', link: pode(u.perfil, 'instituicao.editar') ? '/admin/instituicao' : undefined });
  if (alunosIncompletos?.n) alertas.push({ tipo: 'aviso', texto: `${alunosIncompletos.n} aluno(s) com dados obrigatórios do certificado faltando.`, link: '/admin/alunos' });
  const validade = inst?.validade_credenciamento;
  if (validade) {
    const dias = Math.floor((Date.parse(validade) - Date.now()) / 86400_000);
    if (dias < 180) alertas.push({ tipo: dias < 0 ? 'erro' : 'aviso', texto: `Credenciamento ${dias < 0 ? 'vencido' : 'vence'} em ${dataBR(validade)}.`, link: '/admin/instituicao' });
  }

  return c.html(
    <Pagina titulo="Início" usuario={u} caminho={c.req.path} ok={c.req.query('ok')}>
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
    </Pagina>,
  );
});
