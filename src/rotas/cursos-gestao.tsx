/**
 * Gestão de vários cursos: cadastro do curso (dados do PPC), atos regulatórios do curso, matriz curricular
 * versionada (módulos e componentes) e textos dos documentos por curso. Os documentos de cada turma usam
 * automaticamente os atos e textos do seu curso + os dados fixos da instituição (cabeçalho, credenciamento,
 * logo, fundos e assinaturas).
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Icone, Pagina, Selecao } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, inteiro, lerCorpo, marcado, texto, type Corpo } from '../lib/form';
import { dataBR } from '../lib/datas';
import { variaveisDoModelo } from '../lib/modelo';
import { descreverAto, hojeMS, VARIAVEIS_CERTIFICADO } from '../certificado/dados';
import { TEXTO_DECLARACAO_PADRAO, VARIAVEIS_DECLARACAO } from '../documentos/montar';

export const rotasCursosGestao = new Hono<Env>();
rotasCursosGestao.use('*', exigir('cursos.editar'));

const TIPOS: [string, string][] = ['Curso Técnico', 'Qualificação Profissional / FIC', 'Curso Livre', 'Aperfeiçoamento', 'Especialização Técnica'].map((t) => [t, t]);
const MODALIDADES: [string, string][] = [['presencial', 'Presencial'], ['EAD', 'EAD'], ['híbrido', 'Híbrido']];
const FINALIDADES_CURSO: Record<string, string> = {
  autorizacao_curso: 'Autorização / aprovação do PPC', criacao_curso: 'Criação', reconhecimento: 'Reconhecimento', renovacao_reconhecimento: 'Renovação de reconhecimento',
};
const DOCS: Record<'certificado_qualificacao' | 'declaracao_conclusao_modulo', { rotulo: string; vars: string[] }> = {
  certificado_qualificacao: { rotulo: 'Certificado (texto da frente)', vars: VARIAVEIS_CERTIFICADO.map(([v]) => v) },
  declaracao_conclusao_modulo: { rotulo: 'Declaração de conclusão de módulo', vars: VARIAVEIS_DECLARACAO },
};
type Doc = keyof typeof DOCS;

const CSS = `
.secao-curso{scroll-margin-top:1rem}
.indice{display:flex;gap:.4rem;flex-wrap:wrap;margin:-.4rem 0 1rem}
.indice a{font-size:.85rem;padding:.25rem .65rem;border:1px solid var(--borda);border-radius:999px;text-decoration:none;background:var(--superficie)}
.modulo-bloco{border:1px solid var(--borda);border-radius:10px;margin-bottom:.9rem;background:var(--superficie);overflow:hidden}
.modulo-cab{background:var(--th);padding:.55rem .8rem}
.linha-form{display:grid;gap:.4rem .6rem;align-items:end}
.linha-modulo{grid-template-columns:4.5rem 3fr 6rem 2.5fr auto auto auto}
.linha-comp{grid-template-columns:4.5rem 4fr 6rem 6rem 6rem 7rem auto auto;padding:.35rem .8rem;border-top:1px solid var(--borda)}
.linha-comp.nova{background:var(--superficie-2)}
.linha-form label{font-size:.72rem}
.linha-form input,.linha-form select{padding:.3rem .45rem;font-size:.88rem;width:100%}
.linha-form button{padding:.35rem .6rem;font-size:.82rem}
.soma{font-size:.82rem;padding:.4rem .8rem;border-top:1px solid var(--borda);display:flex;justify-content:space-between}
textarea.texto-doc{width:100%;font-family:inherit;font-size:.92rem;line-height:1.45}
@media (max-width:900px){.linha-modulo,.linha-comp{grid-template-columns:1fr 1fr}}
`;

const voltar = (c: any, url: string, tipo: 'ok' | 'erro', msg: string, ancora = '') => c.redirect(`${url}?${tipo}=${encodeURIComponent(msg)}${ancora}`);
const ir = (id: number | string) => `/admin/cursos/${id}`;

async function eixos(db: D1Database) {
  return (await db.prepare('SELECT id, nome FROM eixos_tecnologicos WHERE ativo = 1 ORDER BY nome').all<{ id: number; nome: string }>()).results;
}

async function turmasDaMatriz(db: D1Database, matrizId: number) {
  return (await db.prepare('SELECT codigo FROM turmas WHERE matriz_id = ? ORDER BY codigo').bind(matrizId).all<{ codigo: string }>()).results.map((t) => t.codigo);
}

// ------------------------------------------------------------------ lista
rotasCursosGestao.get('/', async (c) => {
  const cursos = (
    await c.env.DB.prepare(
      `SELECT cu.*, e.nome AS eixo,
              (SELECT count(*) FROM turmas t WHERE t.curso_id = cu.id) AS turmas,
              (SELECT max(versao) FROM matrizes_curriculares mc WHERE mc.curso_id = cu.id) AS versao,
              (SELECT sum(cc.carga_horaria_total) FROM componentes_curriculares cc
                 WHERE cc.matriz_id = (SELECT id FROM matrizes_curriculares WHERE curso_id = cu.id ORDER BY versao DESC LIMIT 1)) AS ch_matriz,
              (SELECT a.tipo || ' nº ' || a.numero FROM atos_regulatorios a WHERE a.curso_id = cu.id AND a.finalidade = 'autorizacao_curso' AND a.ativo = 1 ORDER BY a.data DESC LIMIT 1) AS autorizacao
         FROM cursos cu LEFT JOIN eixos_tecnologicos e ON e.id = cu.eixo_id ORDER BY cu.ativo DESC, cu.nome`,
    ).all<Record<string, any>>()
  ).results;
  return c.html(
    <Pagina titulo="Cursos" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Cursos</h1>
      <p class="muted" style="margin-top:-.6rem">Cada curso tem seus atos (deliberação de autorização/PPC, reconhecimento), sua matriz e seus textos.
        Os documentos de cada turma usam automaticamente os dados do curso + os dados fixos da instituição.</p>
      <div class="acoes"><a class="botao" href="/admin/cursos/novo"><Icone nome="incluir" />Novo curso</a></div>
      <table>
        <tr><th>Curso</th><th>Eixo</th><th class="n">CH</th><th>Matriz vigente</th><th>Autorização</th><th class="n">Turmas</th><th></th></tr>
        {cursos.map((cu) => (
          <tr>
            <td><a href={ir(cu.id)}><b>{cu.nome}</b></a><div class="muted">{cu.tipo}{cu.nivel ? ` · ${cu.nivel}` : ''}</div>
              {!cu.ativo && <span class="tag">inativo</span>}</td>
            <td>{cu.eixo ?? '—'}</td>
            <td class="n">{cu.carga_horaria_total} h</td>
            <td>{cu.versao ? <>v{cu.versao} · {cu.ch_matriz ?? 0} h {cu.ch_matriz === cu.carga_horaria_total ? <span class="tag ok">confere</span> : <span class="tag aviso">≠ CH do curso</span>}</> : <span class="tag aviso">sem matriz</span>}</td>
            <td>{cu.autorizacao ?? <span class="tag erro">pendente</span>}</td>
            <td class="n">{cu.turmas}</td>
            <td><a href={ir(cu.id)}>abrir</a></td>
          </tr>
        ))}
      </table>
    </Pagina>,
  );
});

// ------------------------------------------------------------------ dados do curso
const CAMPOS_CURSO = ['nome', 'tipo', 'nivel', 'area_tecnologica', 'forma_oferta', 'modalidade', 'escolaridade_minima', 'requisitos_acesso', 'perfil_profissional_conclusao', 'itinerario_formativo'] as const;

function lerCurso(corpo: Corpo) {
  const d: Record<string, string | number | null> = Object.fromEntries(CAMPOS_CURSO.map((k) => [k, texto(corpo, k)]));
  d.eixo_id = inteiro(corpo, 'eixo_id', 'Eixo');
  d.carga_horaria_total = inteiro(corpo, 'carga_horaria_total', 'Carga horária total');
  d.prazo_integralizacao_anos = inteiro(corpo, 'prazo_integralizacao_anos', 'Prazo de integralização');
  d.oferta_experimental = marcado(corpo, 'oferta_experimental');
  d.ativo = marcado(corpo, 'ativo');
  if (!d.nome) throw new ErroValidacao('Informe o nome do curso.');
  if (!TIPOS.some(([t]) => t === d.tipo)) throw new ErroValidacao('Selecione o tipo do curso.');
  if (!d.eixo_id) throw new ErroValidacao('Selecione o eixo tecnológico.');
  if (!d.carga_horaria_total || Number(d.carga_horaria_total) <= 0) throw new ErroValidacao('Informe a carga horária total (em horas).');
  if (!MODALIDADES.some(([m]) => m === d.modalidade)) d.modalidade = 'presencial';
  const cbos = (texto(corpo, 'cbos') ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(\d{4}-?\d{2})\s*[-–:]?\s*(.*)$/.exec(l);
    if (!m) throw new ErroValidacao(`CBO inválido: "${l}" (use 0000-00 - descrição)`);
    const cod = m[1].includes('-') ? m[1] : `${m[1].slice(0, 4)}-${m[1].slice(4)}`;
    return { codigo: cod, descricao: m[2] || null };
  });
  return { d, cbos };
}

const FormCurso = ({ cu, eixosLista, cbos, acao }: { cu: Record<string, any>; eixosLista: { id: number; nome: string }[]; cbos: string; acao: string }) => (
  <form method="post" action={acao} class="grade">
    <Campo nome="nome" rotulo="Nome do curso" valor={cu.nome} obrigatorio classe="largo" dica="Ex.: Curso Técnico em Inovação e Desenvolvimento Corporativo" />
    <Selecao nome="tipo" rotulo="Tipo" valor={cu.tipo ?? 'Curso Técnico'} opcoes={TIPOS} obrigatorio />
    <Campo nome="nivel" rotulo="Nível" valor={cu.nivel ?? 'Educação Profissional Técnica de nível médio'} />
    <Selecao nome="eixo_id" rotulo="Eixo tecnológico" valor={cu.eixo_id} opcoes={eixosLista.map((e) => [e.id, e.nome] as [number, string])} obrigatorio vazio="Selecione" />
    <Campo nome="area_tecnologica" rotulo="Área tecnológica" valor={cu.area_tecnologica} />
    <Campo nome="forma_oferta" rotulo="Forma de oferta" valor={cu.forma_oferta} dica="Ex.: Concomitante/Subsequente" />
    <Selecao nome="modalidade" rotulo="Modalidade" valor={cu.modalidade ?? 'presencial'} opcoes={MODALIDADES} />
    <Campo nome="carga_horaria_total" rotulo="Carga horária total (h)" tipo="number" valor={cu.carga_horaria_total} obrigatorio dica="Inclui TCC e estágio, se houver" />
    <Campo nome="prazo_integralizacao_anos" rotulo="Prazo de integralização (anos)" tipo="number" valor={cu.prazo_integralizacao_anos} />
    <Campo nome="escolaridade_minima" rotulo="Escolaridade mínima" valor={cu.escolaridade_minima} />
    <label class="check"><input type="checkbox" name="oferta_experimental" value="1" checked={!!cu.oferta_experimental} /> Oferta experimental</label>
    <label class="check"><input type="checkbox" name="ativo" value="1" checked={cu.ativo == null ? true : !!cu.ativo} /> Curso ativo (disponível para novas turmas)</label>
    <label class="largo">Requisitos de acesso<textarea name="requisitos_acesso" rows={2}>{cu.requisitos_acesso ?? ''}</textarea></label>
    <label class="largo">Perfil profissional de conclusão do curso<textarea name="perfil_profissional_conclusao" rows={4}>{cu.perfil_profissional_conclusao ?? ''}</textarea></label>
    <label class="largo">Itinerário formativo<textarea name="itinerario_formativo" rows={2}>{cu.itinerario_formativo ?? ''}</textarea></label>
    <label class="largo">Ocupações CBO — uma por linha, no formato <code>0000-00 - descrição</code><textarea name="cbos" rows={2}>{cbos}</textarea></label>
    <div class="largo acoes"><button><Icone nome="salvar" />Salvar dados do curso</button></div>
  </form>
);

rotasCursosGestao.get('/novo', async (c) =>
  c.html(
    <Pagina titulo="Novo curso" usuario={c.get('usuario')} caminho="/admin/cursos" erro={c.req.query('erro')}>
      <p><a href="/admin/cursos">← Cursos</a></p>
      <h1>Novo curso</h1>
      <div class="cartao"><FormCurso cu={{}} eixosLista={await eixos(c.env.DB)} cbos="" acao="/admin/cursos/novo" /></div>
      <p class="muted">Depois de salvar, cadastre os atos do curso (deliberação de autorização), a matriz curricular e, se o PPC tiver texto próprio, o texto do certificado.</p>
    </Pagina>,
  ),
);

rotasCursosGestao.post('/novo', async (c) => {
  const corpo = await lerCorpo(c);
  let dados;
  try { dados = lerCurso(corpo); } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, '/admin/cursos/novo', 'erro', e.message);
    throw e;
  }
  const { d, cbos } = dados;
  const cols = Object.keys(d);
  const r = await c.env.DB.prepare(`INSERT INTO cursos (instituicao_id, ${cols.join(', ')}) VALUES (1, ${cols.map(() => '?').join(', ')}) RETURNING id`)
    .bind(...cols.map((k) => d[k])).first<{ id: number }>();
  if (cbos.length) await c.env.DB.batch(cbos.map((x) => c.env.DB.prepare('INSERT INTO curso_cbos (curso_id, codigo, descricao) VALUES (?, ?, ?)').bind(r!.id, x.codigo, x.descricao)));
  await auditar(c, 'criar', 'curso', r!.id, null, { ...d, cbos });
  return voltar(c, ir(r!.id), 'ok', 'Curso cadastrado. Agora cadastre o ato de autorização e a matriz curricular.');
});

// ------------------------------------------------------------------ página do curso
rotasCursosGestao.get('/:id{[0-9]+}', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const cu = await db.prepare('SELECT * FROM cursos WHERE id = ?').bind(id).first<Record<string, any>>();
  if (!cu) return c.notFound();
  const [eixosLista, cbos, atos, matrizes, textos, credenciamento] = await Promise.all([
    eixos(db),
    db.prepare('SELECT codigo, descricao FROM curso_cbos WHERE curso_id = ? ORDER BY codigo').bind(id).all<{ codigo: string; descricao: string | null }>(),
    db.prepare('SELECT * FROM atos_regulatorios WHERE curso_id = ? ORDER BY ativo DESC, data DESC').bind(id).all<Record<string, any>>(),
    db.prepare(
      `SELECT mc.*, (SELECT count(*) FROM turmas t WHERE t.matriz_id = mc.id) AS turmas,
              (SELECT count(*) FROM modulos_tematicos mt WHERE mt.matriz_id = mc.id) AS modulos,
              (SELECT coalesce(sum(carga_horaria_total), 0) FROM componentes_curriculares cc WHERE cc.matriz_id = mc.id) AS ch
         FROM matrizes_curriculares mc WHERE mc.curso_id = ? ORDER BY mc.versao DESC`,
    ).bind(id).all<Record<string, any>>(),
    db.prepare(`SELECT documento, curso_id, texto, criado_em FROM modelos_texto WHERE ativo = 1 AND (curso_id = ? OR curso_id IS NULL) ORDER BY curso_id IS NULL, id DESC`).bind(id).all<Record<string, any>>(),
    db.prepare(`SELECT * FROM atos_regulatorios WHERE finalidade = 'credenciamento' AND instituicao_id = ? AND ativo = 1 ORDER BY data DESC LIMIT 1`).bind(cu.instituicao_id).first<Record<string, any>>(),
  ]);
  const temAutorizacao = atos.results.some((a) => a.finalidade === 'autorizacao_curso' && a.ativo);
  const textoEfetivo = (doc: Doc) => {
    const proprio = textos.results.find((t) => t.documento === doc && t.curso_id === id);
    const geral = textos.results.find((t) => t.documento === doc && t.curso_id == null);
    return { proprio, texto: proprio?.texto ?? geral?.texto ?? (doc === 'declaracao_conclusao_modulo' ? TEXTO_DECLARACAO_PADRAO : '') };
  };

  return c.html(
    <Pagina titulo={cu.nome} usuario={c.get('usuario')} caminho="/admin/cursos" ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <p><a href="/admin/cursos">← Cursos</a></p>
      <h1>{cu.nome} {!cu.ativo && <span class="tag">inativo</span>}</h1>
      <nav class="indice">
        <a href="#dados">Dados do curso</a><a href="#atos">Atos do curso</a><a href="#matriz">Matriz curricular</a>
        <a href="#textos">Textos dos documentos</a><a href={`${ir(id)}/parametros`}>Parâmetros de aprovação</a><a href={`${ir(id)}/modulos`}>Perfil e competências</a>
      </nav>
      {!temAutorizacao && <div class="msg erro">Este curso ainda não tem o <b>ato de autorização / aprovação do PPC</b>: a emissão de certificados fica bloqueada até ele ser cadastrado.</div>}

      <h2 id="dados" class="secao-curso">Dados do curso</h2>
      <div class="cartao"><FormCurso cu={cu} eixosLista={eixosLista} cbos={cbos.results.map((x) => `${x.codigo}${x.descricao ? ` - ${x.descricao}` : ''}`).join('\n')} acao={ir(id)} /></div>

      <h2 id="atos" class="secao-curso">Atos do curso</h2>
      <p class="muted" style="margin-top:-.4rem">Citados nos documentos deste curso. Fixos da instituição (valem para todos os cursos):
        {credenciamento ? <> <b>{descreverAto(credenciamento)}</b> (credenciamento, no cabeçalho)</> : <span class="tag erro">credenciamento não cadastrado</span>}.</p>
      <table>
        <tr><th>Finalidade</th><th>Ato</th><th>Processo</th><th>Publicação</th><th></th></tr>
        {atos.results.map((a) => (
          <tr>
            <td>{FINALIDADES_CURSO[a.finalidade] ?? a.finalidade}{!a.ativo && <> <span class="tag">inativo</span></>}</td>
            <td>{descreverAto(a)}</td>
            <td>{a.processo ?? '—'}</td>
            <td>{a.publicacao_doe_numero ? `DOE/MS nº ${a.publicacao_doe_numero}${a.publicacao_doe_data ? `, ${dataBR(a.publicacao_doe_data)}` : ''}` : <span class="tag aviso">pendente</span>}</td>
            <td><a href={`/admin/instituicao/atos/${a.id}`}>editar</a></td>
          </tr>
        ))}
      </table>
      {!atos.results.length && <p class="muted">Nenhum ato cadastrado para este curso.</p>}
      <div class="acoes"><a class="botao sec" href={`/admin/instituicao/atos/novo?curso=${id}`}><Icone nome="incluir" />Novo ato do curso</a></div>

      <h2 id="matriz" class="secao-curso">Matriz curricular</h2>
      <table>
        <tr><th>Versão</th><th>Vigente desde</th><th class="n">Módulos</th><th class="n">CH</th><th>Uso</th><th></th></tr>
        {matrizes.results.map((m) => (
          <tr>
            <td>v{m.versao}{m.descricao && <div class="muted">{m.descricao}</div>}</td>
            <td>{dataBR(m.vigente_desde)}</td>
            <td class="n">{m.modulos}</td>
            <td class="n">{m.ch} h {m.ch === cu.carga_horaria_total ? <span class="tag ok">confere</span> : <span class="tag aviso">curso: {cu.carga_horaria_total} h</span>}</td>
            <td>{m.turmas ? <span class="tag">em uso por {m.turmas} turma(s) — travada</span> : <span class="tag ok">editável</span>}</td>
            <td><a href={`${ir(id)}/matrizes/${m.id}`}>{m.turmas ? 'ver' : 'editar'}</a></td>
          </tr>
        ))}
      </table>
      <form method="post" action={`${ir(id)}/matrizes`} class="acoes">
        {matrizes.results.length ? (
          <>
            <select name="copiar_de">{matrizes.results.map((m) => <option value={m.id}>copiar da v{m.versao}</option>)}<option value="">matriz vazia</option></select>
            <button class="sec"><Icone nome="incluir" />Nova versão da matriz</button>
            <span class="muted">Use quando o PPC mudar: turmas antigas continuam na versão delas.</span>
          </>
        ) : (
          <button><Icone nome="incluir" />Criar matriz curricular (v1)</button>
        )}
      </form>

      <h2 id="textos" class="secao-curso">Textos dos documentos</h2>
      <p class="muted" style="margin-top:-.4rem">Cada curso pode ter o texto aprovado no seu PPC. Sem texto próprio, usa o texto padrão geral.
        Variáveis entre chaves são preenchidas com os dados do aluno, do curso e da instituição.</p>
      {(Object.keys(DOCS) as Doc[]).map((doc) => {
        const ef = textoEfetivo(doc);
        return (
          <div class="cartao">
            <h3 style="margin:0 0 .4rem;color:var(--titulo)">{DOCS[doc].rotulo} {ef.proprio ? <span class="tag ok">texto próprio do curso</span> : <span class="tag">usando o texto padrão geral</span>}</h3>
            <form method="post" action={`${ir(id)}/textos/${doc}`}>
              <textarea name="texto" class="texto-doc" rows={8} required>{ef.texto}</textarea>
              <details><summary class="muted">Variáveis disponíveis</summary>
                <p class="muted">{(doc === 'certificado_qualificacao' ? VARIAVEIS_CERTIFICADO : VARIAVEIS_DECLARACAO.map((v) => [v, ''] as [string, string])).map(([v, r], i) => <>{i ? ' · ' : ''}<code>{`{${v}}`}</code>{r ? ` ${r}` : ''}</>)}</p>
              </details>
              <div class="acoes">
                <button>Salvar como texto deste curso</button>
                {ef.proprio && <button class="sec" name="usar_padrao" value="1" formnovalidate>Voltar a usar o texto padrão geral</button>}
              </div>
            </form>
          </div>
        );
      })}
    </Pagina>,
  );
});

rotasCursosGestao.post('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const antes = await c.env.DB.prepare('SELECT * FROM cursos WHERE id = ?').bind(id).first<Record<string, any>>();
  if (!antes) return c.notFound();
  let dados;
  try { dados = lerCurso(await lerCorpo(c)); } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, ir(id), 'erro', e.message, '#dados');
    throw e;
  }
  const { d, cbos } = dados;
  const cols = Object.keys(d);
  const db = c.env.DB;
  await db.batch([
    db.prepare(`UPDATE cursos SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).bind(...cols.map((k) => d[k]), id),
    db.prepare('DELETE FROM curso_cbos WHERE curso_id = ?').bind(id),
    ...cbos.map((x) => db.prepare('INSERT INTO curso_cbos (curso_id, codigo, descricao) VALUES (?, ?, ?)').bind(id, x.codigo, x.descricao)),
  ]);
  const mudou = Object.fromEntries(cols.filter((k) => String(antes[k] ?? '') !== String(d[k] ?? '')).map((k) => [k, d[k]]));
  await auditar(c, 'atualizar', 'curso', id, Object.fromEntries(Object.keys(mudou).map((k) => [k, antes[k]])), { ...mudou, cbos });
  return voltar(c, ir(id), 'ok', 'Dados do curso salvos.', '#dados');
});

// ------------------------------------------------------------------ textos por curso
rotasCursosGestao.post('/:id{[0-9]+}/textos/:doc', async (c) => {
  const id = Number(c.req.param('id'));
  const doc = c.req.param('doc') as Doc;
  if (!(doc in DOCS)) return c.notFound();
  if (!(await c.env.DB.prepare('SELECT 1 FROM cursos WHERE id = ?').bind(id).first())) return c.notFound();
  const corpo = await lerCorpo(c);
  const db = c.env.DB;
  const atual = await db.prepare('SELECT id, texto FROM modelos_texto WHERE documento = ? AND curso_id = ? AND ativo = 1 ORDER BY id DESC LIMIT 1').bind(doc, id).first<{ id: number; texto: string }>();
  if (corpo.usar_padrao === '1') {
    await db.prepare('UPDATE modelos_texto SET ativo = 0 WHERE documento = ? AND curso_id = ?').bind(doc, id).run();
    await auditar(c, 'usar_texto_padrao', 'curso', id, { documento: doc, texto: atual?.texto ?? null }, null);
    return voltar(c, ir(id), 'ok', `${DOCS[doc].rotulo}: voltou a usar o texto padrão geral.`, '#textos');
  }
  const txt = String(corpo.texto ?? '').replace(/\r\n/g, '\n').trim();
  if (txt.length < 40) return voltar(c, ir(id), 'erro', 'Texto muito curto.', '#textos');
  const desconhecidas = variaveisDoModelo(txt).filter((v) => !DOCS[doc].vars.includes(v));
  if (desconhecidas.length) return voltar(c, ir(id), 'erro', `Variáveis desconhecidas: ${desconhecidas.map((v) => `{${v}}`).join(', ')}.`, '#textos');
  if (atual?.texto === txt) return voltar(c, ir(id), 'ok', 'Texto sem alterações.', '#textos');
  await db.batch([
    db.prepare('UPDATE modelos_texto SET ativo = 0 WHERE documento = ? AND curso_id = ?').bind(doc, id),
    db.prepare('INSERT INTO modelos_texto (documento, curso_id, texto) VALUES (?, ?, ?)').bind(doc, id, txt),
  ]);
  await auditar(c, 'atualizar_texto', 'curso', id, { documento: doc, texto: atual?.texto ?? null }, { documento: doc, texto: txt });
  return voltar(c, ir(id), 'ok', `${DOCS[doc].rotulo}: texto do curso salvo.`, '#textos');
});

// ------------------------------------------------------------------ matriz curricular
rotasCursosGestao.post('/:id{[0-9]+}/matrizes', async (c) => {
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  if (!(await db.prepare('SELECT 1 FROM cursos WHERE id = ?').bind(id).first())) return c.notFound();
  const copiarDe = Number(texto(await lerCorpo(c), 'copiar_de')) || null;
  const prox = await db.prepare('SELECT coalesce(max(versao), 0) + 1 AS v FROM matrizes_curriculares WHERE curso_id = ?').bind(id).first<{ v: number }>();
  const nova = await db.prepare('INSERT INTO matrizes_curriculares (curso_id, versao, vigente_desde, descricao) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(id, prox!.v, hojeMS(), copiarDe ? `Cópia da versão anterior (editar conforme o PPC)` : null).first<{ id: number }>();
  if (copiarDe) {
    const origem = await db.prepare('SELECT id FROM matrizes_curriculares WHERE id = ? AND curso_id = ?').bind(copiarDe, id).first();
    if (origem) {
      const mods = (await db.prepare('SELECT * FROM modulos_tematicos WHERE matriz_id = ? ORDER BY ordem').bind(copiarDe).all<Record<string, any>>()).results;
      const mapa = new Map<number, number>();
      for (const m of mods) {
        const r = await db.prepare(
          'INSERT INTO modulos_tematicos (matriz_id, ordem, nome, carga_horaria, tem_terminalidade, qualificacao_conferida, perfil_profissional, competencias) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        ).bind(nova!.id, m.ordem, m.nome, m.carga_horaria, m.tem_terminalidade, m.qualificacao_conferida, m.perfil_profissional, m.competencias).first<{ id: number }>();
        mapa.set(m.id, r!.id);
      }
      const comps = (await db.prepare('SELECT * FROM componentes_curriculares WHERE matriz_id = ?').bind(copiarDe).all<Record<string, any>>()).results;
      if (comps.length) {
        await db.batch(comps.map((x) => db.prepare(
          'INSERT INTO componentes_curriculares (matriz_id, modulo_id, tipo, ordem, nome, carga_horaria_teorica, carga_horaria_pratica, carga_horaria_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(nova!.id, x.modulo_id ? mapa.get(x.modulo_id) ?? null : null, x.tipo, x.ordem, x.nome, x.carga_horaria_teorica, x.carga_horaria_pratica, x.carga_horaria_total)));
      }
    }
  }
  await auditar(c, 'criar', 'matriz_curricular', nova!.id, null, { curso_id: id, versao: prox!.v, copiada_de: copiarDe });
  return voltar(c, `${ir(id)}/matrizes/${nova!.id}`, 'ok', `Matriz v${prox!.v} criada.`);
});

async function contextoMatriz(c: any) {
  const db = c.env.DB as D1Database;
  const id = Number(c.req.param('id'));
  const mid = Number(c.req.param('mid'));
  const m = await db.prepare('SELECT mc.*, cu.nome AS curso, cu.carga_horaria_total AS ch_curso FROM matrizes_curriculares mc JOIN cursos cu ON cu.id = mc.curso_id WHERE mc.id = ? AND mc.curso_id = ?')
    .bind(mid, id).first<Record<string, any>>();
  if (!m) return null;
  const turmas = await turmasDaMatriz(db, mid);
  return { db, id, mid, m, turmas, travada: turmas.length > 0, base: `${ir(id)}/matrizes/${mid}` };
}

rotasCursosGestao.get('/:id{[0-9]+}/matrizes/:mid{[0-9]+}', async (c) => {
  const ctx = await contextoMatriz(c);
  if (!ctx) return c.notFound();
  const { db, m, mid, travada, turmas, base } = ctx;
  const [mods, comps] = await Promise.all([
    db.prepare('SELECT * FROM modulos_tematicos WHERE matriz_id = ? ORDER BY ordem').bind(mid).all<Record<string, any>>(),
    db.prepare('SELECT * FROM componentes_curriculares WHERE matriz_id = ? ORDER BY modulo_id IS NULL, ordem').bind(mid).all<Record<string, any>>(),
  ]);
  const total = comps.results.reduce((s, x) => s + x.carga_horaria_total, 0);
  const dis = travada ? { disabled: true } : {};

  const LinhaComp = ({ x }: { x: Record<string, any> }) => (
    <form method="post" action={`${base}/componentes/${x.id}`} class="linha-form linha-comp">
      <label>Ordem<input name="ordem" type="number" value={x.ordem} {...dis} /></label>
      <label>Componente curricular<input name="nome" value={x.nome} required {...dis} /></label>
      <label>CH teórica<input name="carga_horaria_teorica" type="number" value={x.carga_horaria_teorica ?? ''} {...dis} /></label>
      <label>CH prática<input name="carga_horaria_pratica" type="number" value={x.carga_horaria_pratica ?? ''} {...dis} /></label>
      <label>CH total<input name="carga_horaria_total" type="number" value={x.carga_horaria_total} required {...dis} /></label>
      <label>Tipo<select name="tipo" {...dis}>{(x.modulo_id ? ['disciplina'] : ['tcc', 'estagio']).map((t) => <option value={t} selected={x.tipo === t}>{t === 'tcc' ? 'TCC' : t === 'estagio' ? 'Estágio' : 'Disciplina'}</option>)}</select></label>
      {!travada && <button class="sec">salvar</button>}
      {!travada && <button class="sec" formaction={`${base}/componentes/${x.id}/excluir`} onclick="return confirm('Excluir este componente?')" style="color:var(--erro)">excluir</button>}
    </form>
  );
  const NovaComp = ({ moduloId }: { moduloId: number | null }) => travada ? null : (
    <form method="post" action={`${base}/componentes`} class="linha-form linha-comp nova">
      <input type="hidden" name="modulo_id" value={moduloId ?? ''} />
      <label>Ordem<input name="ordem" type="number" /></label>
      <label>{moduloId ? 'Nova disciplina' : 'Novo componente fora de módulo'}<input name="nome" required placeholder="Nome conforme o PPC" /></label>
      <label>CH teórica<input name="carga_horaria_teorica" type="number" /></label>
      <label>CH prática<input name="carga_horaria_pratica" type="number" /></label>
      <label>CH total<input name="carga_horaria_total" type="number" placeholder="soma" /></label>
      <label>Tipo<select name="tipo">{(moduloId ? ['disciplina'] : ['tcc', 'estagio']).map((t) => <option value={t}>{t === 'tcc' ? 'TCC' : t === 'estagio' ? 'Estágio' : 'Disciplina'}</option>)}</select></label>
      <button><Icone nome="incluir" />adicionar</button>
    </form>
  );

  return c.html(
    <Pagina titulo={`Matriz v${m.versao}`} usuario={c.get('usuario')} caminho="/admin/cursos" ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <p><a href={`${ir(ctx.id)}#matriz`}>← {m.curso}</a></p>
      <h1>Matriz curricular v{m.versao}</h1>
      <p class="muted" style="margin-top:-.6rem">Vigente desde {dataBR(m.vigente_desde)} ·
        Total: <b>{total} h</b> {total === m.ch_curso ? <span class="tag ok">confere com o curso</span> : <span class="tag aviso">curso: {m.ch_curso} h</span>}</p>
      {travada && <div class="msg aviso">Matriz em uso pelas turmas {turmas.join(', ')}: estrutura travada para não alterar documentos dessas turmas.
        Para mudar, crie uma <b>nova versão</b> na página do curso. Perfil profissional e competências continuam editáveis em "Perfil e competências".</div>}

      {mods.results.map((mo) => {
        const cs = comps.results.filter((x) => x.modulo_id === mo.id);
        const soma = cs.reduce((s, x) => s + x.carga_horaria_total, 0);
        return (
          <div class="modulo-bloco">
            <form method="post" action={`${base}/modulos/${mo.id}`} class="linha-form linha-modulo modulo-cab">
              <label>Ordem<input name="ordem" type="number" value={mo.ordem} required {...dis} /></label>
              <label>Módulo<input name="nome" value={mo.nome} required {...dis} /></label>
              <label>CH (h)<input name="carga_horaria" type="number" value={mo.carga_horaria} required {...dis} /></label>
              <label>Qualificação conferida (impressa no certificado)<input name="qualificacao_conferida" value={mo.qualificacao_conferida ?? ''} {...dis} /></label>
              <label class="check" style="font-size:.78rem"><input type="checkbox" name="tem_terminalidade" value="1" checked={!!mo.tem_terminalidade} {...dis} />certifica</label>
              {!travada && <button class="sec">salvar</button>}
              {!travada && <button class="sec" formaction={`${base}/modulos/${mo.id}/excluir`} onclick="return confirm('Excluir o módulo e suas disciplinas?')" style="color:var(--erro)">excluir</button>}
            </form>
            {cs.map((x) => <LinhaComp x={x} />)}
            <NovaComp moduloId={mo.id} />
            <div class="soma"><span>Soma das disciplinas: <b>{soma} h</b></span>
              {soma === mo.carga_horaria ? <span class="tag ok">confere com o módulo</span> : <span class="tag erro">módulo declara {mo.carga_horaria} h — a emissão fica bloqueada até conferir</span>}</div>
          </div>
        );
      })}

      {!travada && (
        <div class="modulo-bloco">
          <form method="post" action={`${base}/modulos`} class="linha-form linha-modulo modulo-cab">
            <label>Ordem<input name="ordem" type="number" value={(mods.results.at(-1)?.ordem ?? 0) + 1} required /></label>
            <label>Novo módulo<input name="nome" required placeholder="Ex.: Qualidade" /></label>
            <label>CH (h)<input name="carga_horaria" type="number" required /></label>
            <label>Qualificação conferida<input name="qualificacao_conferida" placeholder="Ex.: Inspetor de Qualidade" /></label>
            <label class="check" style="font-size:.78rem"><input type="checkbox" name="tem_terminalidade" value="1" checked />certifica</label>
            <button><Icone nome="incluir" />adicionar módulo</button>
          </form>
        </div>
      )}

      <h2>Componentes fora dos módulos (TCC, estágio)</h2>
      <div class="modulo-bloco">
        {comps.results.filter((x) => !x.modulo_id).map((x) => <LinhaComp x={x} />)}
        <NovaComp moduloId={null} />
        {!comps.results.some((x) => !x.modulo_id) && travada && <p class="muted" style="padding:.6rem .8rem;margin:0">Nenhum.</p>}
      </div>
    </Pagina>,
  );
});

function lerComponente(corpo: Corpo) {
  const t = inteiro(corpo, 'carga_horaria_teorica', 'CH teórica');
  const p = inteiro(corpo, 'carga_horaria_pratica', 'CH prática');
  let total = inteiro(corpo, 'carga_horaria_total', 'CH total');
  if (total == null && (t != null || p != null)) total = (t ?? 0) + (p ?? 0);
  const nome = texto(corpo, 'nome');
  if (!nome) throw new ErroValidacao('Informe o nome do componente.');
  if (!total || total <= 0) throw new ErroValidacao('Informe a carga horária total do componente.');
  if (t != null && p != null && t + p !== total) throw new ErroValidacao(`CH teórica (${t}) + prática (${p}) não soma a CH total (${total}).`);
  return { nome, carga_horaria_teorica: t, carga_horaria_pratica: p, carga_horaria_total: total, ordem: inteiro(corpo, 'ordem', 'Ordem') };
}

function lerModulo(corpo: Corpo) {
  const nome = texto(corpo, 'nome');
  const ch = inteiro(corpo, 'carga_horaria', 'CH do módulo');
  const ordem = inteiro(corpo, 'ordem', 'Ordem');
  if (!nome) throw new ErroValidacao('Informe o nome do módulo.');
  if (!ch || ch <= 0) throw new ErroValidacao('Informe a carga horária do módulo.');
  if (!ordem || ordem <= 0) throw new ErroValidacao('Informe a ordem do módulo.');
  return { nome, carga_horaria: ch, ordem, qualificacao_conferida: texto(corpo, 'qualificacao_conferida'), tem_terminalidade: marcado(corpo, 'tem_terminalidade') };
}

/** Executa uma alteração estrutural da matriz (bloqueada se em uso), com auditoria e mensagens. */
function alteracaoMatriz(acao: (ctx: NonNullable<Awaited<ReturnType<typeof contextoMatriz>>>, corpo: Corpo, c: any) => Promise<{ msg: string; auditoria: [string, string, number | null, unknown, unknown] }>) {
  return async (c: any) => {
    const ctx = await contextoMatriz(c);
    if (!ctx) return c.notFound();
    if (ctx.travada) return voltar(c, ctx.base, 'erro', `Matriz em uso pelas turmas ${ctx.turmas.join(', ')}: crie uma nova versão.`);
    try {
      const r = await acao(ctx, await lerCorpo(c), c);
      await auditar(c, ...r.auditoria);
      return voltar(c, ctx.base, 'ok', r.msg);
    } catch (e) {
      if (e instanceof ErroValidacao) return voltar(c, ctx.base, 'erro', e.message);
      if (String(e).includes('UNIQUE')) return voltar(c, ctx.base, 'erro', 'Já existe um módulo com essa ordem nesta matriz.');
      throw e;
    }
  };
}

rotasCursosGestao.post('/:id{[0-9]+}/matrizes/:mid{[0-9]+}/modulos', alteracaoMatriz(async ({ db, mid }, corpo) => {
  const d = lerModulo(corpo);
  const r = await db.prepare('INSERT INTO modulos_tematicos (matriz_id, ordem, nome, carga_horaria, tem_terminalidade, qualificacao_conferida) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(mid, d.ordem, d.nome, d.carga_horaria, d.tem_terminalidade, d.qualificacao_conferida).first<{ id: number }>();
  return { msg: `Módulo ${d.nome} adicionado.`, auditoria: ['criar', 'modulo_tematico', r!.id, null, { matriz_id: mid, ...d }] };
}));

rotasCursosGestao.post('/:id{[0-9]+}/matrizes/:mid{[0-9]+}/modulos/:mod{[0-9]+}', alteracaoMatriz(async ({ db, mid }, corpo, c) => {
  const modId = Number(c.req.param('mod'));
  const antes = await db.prepare('SELECT * FROM modulos_tematicos WHERE id = ? AND matriz_id = ?').bind(modId, mid).first();
  if (!antes) throw new ErroValidacao('Módulo não encontrado.');
  const d = lerModulo(corpo);
  await db.prepare('UPDATE modulos_tematicos SET ordem = ?, nome = ?, carga_horaria = ?, tem_terminalidade = ?, qualificacao_conferida = ? WHERE id = ?')
    .bind(d.ordem, d.nome, d.carga_horaria, d.tem_terminalidade, d.qualificacao_conferida, modId).run();
  return { msg: `Módulo ${d.nome} salvo.`, auditoria: ['atualizar', 'modulo_tematico', modId, antes, d] };
}));

rotasCursosGestao.post('/:id{[0-9]+}/matrizes/:mid{[0-9]+}/modulos/:mod{[0-9]+}/excluir', alteracaoMatriz(async ({ db, mid }, _corpo, c) => {
  const modId = Number(c.req.param('mod'));
  const antes = await db.prepare('SELECT * FROM modulos_tematicos WHERE id = ? AND matriz_id = ?').bind(modId, mid).first<Record<string, any>>();
  if (!antes) throw new ErroValidacao('Módulo não encontrado.');
  await db.batch([
    db.prepare('DELETE FROM componentes_curriculares WHERE modulo_id = ?').bind(modId),
    db.prepare('DELETE FROM modulos_tematicos WHERE id = ?').bind(modId),
  ]);
  return { msg: `Módulo ${antes.nome} excluído.`, auditoria: ['excluir', 'modulo_tematico', modId, antes, null] };
}));

rotasCursosGestao.post('/:id{[0-9]+}/matrizes/:mid{[0-9]+}/componentes', alteracaoMatriz(async ({ db, mid }, corpo) => {
  const d = lerComponente(corpo);
  const moduloId = Number(texto(corpo, 'modulo_id')) || null;
  if (moduloId && !(await db.prepare('SELECT 1 FROM modulos_tematicos WHERE id = ? AND matriz_id = ?').bind(moduloId, mid).first())) throw new ErroValidacao('Módulo inválido.');
  const tipo = moduloId ? 'disciplina' : texto(corpo, 'tipo') === 'estagio' ? 'estagio' : 'tcc';
  const ordem = d.ordem ?? ((await db.prepare('SELECT coalesce(max(ordem), 0) + 1 AS o FROM componentes_curriculares WHERE matriz_id = ? AND modulo_id IS ?').bind(mid, moduloId).first<{ o: number }>())!.o);
  const r = await db.prepare(
    'INSERT INTO componentes_curriculares (matriz_id, modulo_id, tipo, ordem, nome, carga_horaria_teorica, carga_horaria_pratica, carga_horaria_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  ).bind(mid, moduloId, tipo, ordem, d.nome, d.carga_horaria_teorica, d.carga_horaria_pratica, d.carga_horaria_total).first<{ id: number }>();
  return { msg: `${d.nome} adicionado.`, auditoria: ['criar', 'componente_curricular', r!.id, null, { matriz_id: mid, modulo_id: moduloId, tipo, ...d, ordem }] };
}));

rotasCursosGestao.post('/:id{[0-9]+}/matrizes/:mid{[0-9]+}/componentes/:cid{[0-9]+}', alteracaoMatriz(async ({ db, mid }, corpo, c) => {
  const cid = Number(c.req.param('cid'));
  const antes = await db.prepare('SELECT * FROM componentes_curriculares WHERE id = ? AND matriz_id = ?').bind(cid, mid).first<Record<string, any>>();
  if (!antes) throw new ErroValidacao('Componente não encontrado.');
  const d = lerComponente(corpo);
  const tipo = antes.modulo_id ? 'disciplina' : texto(corpo, 'tipo') === 'estagio' ? 'estagio' : 'tcc';
  await db.prepare('UPDATE componentes_curriculares SET ordem = ?, nome = ?, tipo = ?, carga_horaria_teorica = ?, carga_horaria_pratica = ?, carga_horaria_total = ? WHERE id = ?')
    .bind(d.ordem ?? antes.ordem, d.nome, tipo, d.carga_horaria_teorica, d.carga_horaria_pratica, d.carga_horaria_total, cid).run();
  return { msg: `${d.nome} salvo.`, auditoria: ['atualizar', 'componente_curricular', cid, antes, { ...d, tipo }] };
}));

rotasCursosGestao.post('/:id{[0-9]+}/matrizes/:mid{[0-9]+}/componentes/:cid{[0-9]+}/excluir', alteracaoMatriz(async ({ db, mid }, _corpo, c) => {
  const cid = Number(c.req.param('cid'));
  const antes = await db.prepare('SELECT * FROM componentes_curriculares WHERE id = ? AND matriz_id = ?').bind(cid, mid).first<Record<string, any>>();
  if (!antes) throw new ErroValidacao('Componente não encontrado.');
  await db.prepare('DELETE FROM componentes_curriculares WHERE id = ?').bind(cid).run();
  return { msg: `${antes.nome} excluído.`, auditoria: ['excluir', 'componente_curricular', cid, antes, null] };
}));
