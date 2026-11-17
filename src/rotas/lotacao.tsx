/**
 * Gestão Pedagógica → Lotação de Professores: professor de cada disciplina da turma (por módulo).
 * Atribuir · Trocar (encerra a atual com motivo, abre a nova e passa a grade de horário) · Encerrar. Histórico preservado.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, inteiro, lerCorpo, texto } from '../lib/form';
import { dataBR } from '../lib/datas';
import { hojeMS } from '../certificado/dados';
import { modulosDaTurma, ROTULO_SITUACAO } from '../lib/turmaModulos';
import { DIAS_GRADE, validarAulaGrade } from '../lib/pedagogico';

export const rotasLotacao = new Hono<Env>();
rotasLotacao.use('*', exigir('pedagogico.gerenciar'));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BASE = '/admin/pedagogico/lotacao';
const diaAnterior = (iso: string) => new Date(Date.parse(iso + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
const nomeDia = Object.fromEntries(DIAS_GRADE.map(([d, s]) => [d, s]));

const CSS = `
.filtros{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.6rem 1rem;align-items:end}
details.acao-lot{display:inline-block}
details.acao-lot summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:.3rem;padding:.2rem .6rem;border:1px solid var(--borda-forte);border-radius:999px;font-size:.8rem;color:var(--link)}
details.acao-lot summary::-webkit-details-marker{display:none}
details.acao-lot[open] summary{border-color:var(--ciano)}
details.acao-lot form{display:flex;gap:.4rem;flex-wrap:wrap;align-items:flex-end;margin-top:.4rem;padding:.6rem;border:1px solid var(--borda);border-radius:10px;background:var(--superficie-2)}
td .grade-chip{display:inline-block;margin:.1rem .2rem 0 0;padding:0 .4rem;border-radius:6px;background:var(--th);font-size:.75rem;color:var(--texto-2)}
`;

async function professores(db: D1Database) {
  return (await db.prepare(
    `SELECT f.id, f.nome FROM funcionarios f JOIN funcionario_categorias fc ON fc.funcionario_id = f.id AND fc.categoria = 'professor'
      WHERE f.ativo = 1 ORDER BY f.nome`,
  ).all<{ id: number; nome: string }>()).results;
}

const SelProfessor = ({ lista, nome = 'funcionario_id', excluir }: { lista: { id: number; nome: string }[]; nome?: string; excluir?: number }) => (
  <label>Professor(a)
    <select name={nome} required>
      <option value="">Selecione</option>
      {lista.filter((p) => p.id !== excluir).map((p) => <option value={p.id}>{p.nome}</option>)}
    </select>
  </label>
);

rotasLotacao.get('/', async (c) => {
  const db = c.env.DB;
  const anos = (await db.prepare('SELECT DISTINCT ano_letivo AS ano FROM turmas WHERE ano_letivo IS NOT NULL ORDER BY ano DESC').all<{ ano: number }>()).results.map((x) => x.ano);
  const ano = Number(c.req.query('ano')) || anos[0] || new Date().getFullYear();
  const turmas = (await db.prepare('SELECT t.id, t.codigo, t.turno, cu.nome AS curso FROM turmas t JOIN cursos cu ON cu.id = t.curso_id WHERE t.ano_letivo = ? ORDER BY t.codigo')
    .bind(ano).all<{ id: number; codigo: string; turno: string | null; curso: string }>()).results;
  const turma = turmas.find((t) => t.id === Number(c.req.query('turma'))) ?? (turmas.length === 1 ? turmas[0] : null);
  const modulos = turma ? await modulosDaTurma(db, turma.id) : [];
  const modulo = modulos.find((m) => m.modulo_id === Number(c.req.query('modulo')))
    ?? modulos.find((m) => m.situacao === 'em_andamento') ?? modulos[0] ?? null;
  const profs = await professores(db);

  let disciplinas: Record<string, any>[] = [];
  let historico: Record<string, any>[] = [];
  let grade = new Map<number, string>();
  if (turma && modulo) {
    disciplinas = (await db.prepare(
      `SELECT cc.id, cc.nome, cc.carga_horaria_total AS ch, l.id AS lotacao_id, l.data_inicio, f.id AS funcionario_id, f.nome AS professor
         FROM componentes_curriculares cc
         LEFT JOIN lotacoes l ON l.componente_id = cc.id AND l.turma_id = ? AND l.data_fim IS NULL
         LEFT JOIN funcionarios f ON f.id = l.funcionario_id
        WHERE cc.modulo_id = ? ORDER BY cc.ordem`,
    ).bind(turma.id, modulo.modulo_id).all<Record<string, any>>()).results;
    historico = (await db.prepare(
      `SELECT l.*, cc.nome AS componente, f.nome AS professor FROM lotacoes l JOIN componentes_curriculares cc ON cc.id = l.componente_id
         JOIN funcionarios f ON f.id = l.funcionario_id WHERE l.turma_id = ? AND cc.modulo_id = ? AND l.data_fim IS NOT NULL ORDER BY l.data_fim DESC, l.id DESC`,
    ).bind(turma.id, modulo.modulo_id).all<Record<string, any>>()).results;
    const aulas = (await db.prepare(
      `SELECT ha.lotacao_id, ha.dia_semana, ha.tempo FROM horario_aulas ha JOIN lotacoes l ON l.id = ha.lotacao_id
        WHERE l.turma_id = ? AND l.data_fim IS NULL ORDER BY ha.dia_semana, ha.tempo`,
    ).bind(turma.id).all<{ lotacao_id: number; dia_semana: number; tempo: number }>()).results;
    grade = new Map();
    for (const a of aulas) grade.set(a.lotacao_id, `${grade.get(a.lotacao_id) ?? ''}|${nomeDia[a.dia_semana]} T${a.tempo}`);
  }
  const voltaQS = turma && modulo ? `?ano=${ano}&turma=${turma.id}&modulo=${modulo.modulo_id}` : `?ano=${ano}`;
  const inicioPadrao = modulo?.data_inicio && modulo.data_inicio > hojeMS() ? modulo.data_inicio : modulo?.data_inicio ?? hojeMS();

  return c.html(
    <Pagina titulo="Lotação de professores" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Lotação de professores</h1>
      <div class="cartao">
        <form method="get" class="filtros">
          <label>Ano letivo<select name="ano" onchange="this.form.turma.value='';this.form.submit()">{(anos.length ? anos : [ano]).map((a) => <option selected={a === ano}>{a}</option>)}</select></label>
          <label>Turma<select name="turma" onchange="this.form.modulo.value='';this.form.submit()"><option value="">Selecione</option>
            {turmas.map((t) => <option value={t.id} selected={t.id === turma?.id}>{t.codigo} — {t.curso}</option>)}</select></label>
          <label>Módulo (qualificação)<select name="modulo" onchange="this.form.submit()">
            {modulos.map((m) => <option value={m.modulo_id} selected={m.modulo_id === modulo?.modulo_id}>
              {m.ordem}. {m.nome}{m.qualificacao_conferida ? ` — ${m.qualificacao_conferida}` : ''} ({ROTULO_SITUACAO[m.situacao].toLowerCase()})</option>)}</select></label>
          <noscript><button class="sec">Filtrar</button></noscript>
        </form>
      </div>
      {!profs.length && <div class="msg aviso">Nenhum professor ativo cadastrado. Cadastre em <a href="/admin/pedagogico/funcionarios/novo">Funcionários</a> (categoria Professor).</div>}
      {turma && !turma.turno && <div class="msg aviso">A turma {turma.codigo} está sem turno: informe o turno na <a href={`/admin/turmas/${turma.id}`}>tela da turma</a> para montar o horário.</div>}
      {!turmas.length && <p class="muted">Nenhuma turma no ano letivo {ano}.</p>}

      {turma && modulo && (
        <>
          <h2>Atribuições ativas — {turma.codigo} · Módulo {modulo.ordem}: {modulo.nome}</h2>
          <table>
            <tr><th>Disciplina</th><th class="n">CH</th><th>Professor</th><th>Desde</th><th>Horário</th><th>Ações</th></tr>
            {disciplinas.map((d) => (
              <tr>
                <td><b>{d.nome}</b></td>
                <td class="n">{d.ch} h</td>
                <td>{d.professor ?? <span class="tag aviso">sem professor</span>}</td>
                <td>{d.data_inicio ? dataBR(d.data_inicio) : '—'}</td>
                <td>{d.lotacao_id
                  ? (grade.get(d.lotacao_id) ?? '').split('|').filter(Boolean).map((g) => <span class="grade-chip">{g}</span>)
                  : null}
                  {d.lotacao_id && !grade.get(d.lotacao_id) && <a href={`/admin/pedagogico/horario?ano=${ano}&prof=${d.funcionario_id}`}>montar horário</a>}</td>
                <td>
                  {!d.lotacao_id ? (
                    <details class="acao-lot"><summary><Icone nome="incluir" />Atribuir</summary>
                      <form method="post" action={`${BASE}/atribuir${voltaQS}`}>
                        <input type="hidden" name="turma_id" value={turma.id} /><input type="hidden" name="componente_id" value={d.id} />
                        <SelProfessor lista={profs} />
                        <label>Início<input type="date" name="data_inicio" value={inicioPadrao} required /></label>
                        <button>Atribuir</button>
                      </form>
                    </details>
                  ) : (
                    <>
                      <details class="acao-lot"><summary><Icone nome="atualizar" />Trocar</summary>
                        <form method="post" action={`${BASE}/${d.lotacao_id}/trocar${voltaQS}`}>
                          <SelProfessor lista={profs} excluir={d.funcionario_id} />
                          <label>Novo professor a partir de<input type="date" name="data" value={hojeMS()} required /></label>
                          <label>Motivo<input name="motivo" required placeholder="Ex.: licença, substituição" /></label>
                          <button>Trocar</button>
                        </form>
                      </details>{' '}
                      <details class="acao-lot"><summary><Icone nome="cancelar" />Encerrar</summary>
                        <form method="post" action={`${BASE}/${d.lotacao_id}/encerrar${voltaQS}`} onsubmit="return confirm('Encerrar a lotação? A disciplina ficará sem professor e o horário dela sai da grade.')">
                          <label>Último dia<input type="date" name="data_fim" value={hojeMS()} required /></label>
                          <label>Motivo<input name="motivo" required placeholder="Ex.: disciplina concluída" /></label>
                          <button class="perigo">Encerrar</button>
                        </form>
                      </details>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </table>
          {!disciplinas.length && <p class="muted">Este módulo não tem disciplinas na matriz.</p>}

          <h2>Histórico de atribuições (encerradas)</h2>
          <table>
            <tr><th>Disciplina</th><th>Professor</th><th>Período</th><th>Motivo</th><th>Encerrada por</th></tr>
            {historico.map((h) => (
              <tr>
                <td>{h.componente}</td><td>{h.professor}</td><td>{dataBR(h.data_inicio)} a {dataBR(h.data_fim)}</td>
                <td>{h.motivo_fim ?? ''}</td><td>{h.encerrada_por ?? ''}<div class="muted">{h.encerrada_em ? dataBR(h.encerrada_em) : ''}</div></td>
              </tr>
            ))}
          </table>
          {!historico.length && <p class="muted">Sem histórico de atribuições encerradas.</p>}
        </>
      )}
    </Pagina>,
  );
});

const voltar = (c: any, tipo: 'ok' | 'erro', msg: string) => {
  const qs = new URL(c.req.url).search;
  return c.redirect(`${BASE}${qs}${qs ? '&' : '?'}${tipo}=` + encodeURIComponent(msg));
};

async function validarProfessor(db: D1Database, id: number | null) {
  const p = id ? await db.prepare(
    `SELECT f.id, f.nome FROM funcionarios f JOIN funcionario_categorias fc ON fc.funcionario_id = f.id AND fc.categoria = 'professor' WHERE f.id = ? AND f.ativo = 1`,
  ).bind(id).first<{ id: number; nome: string }>() : null;
  if (!p) throw new ErroValidacao('Selecione um professor ativo.');
  return p;
}

async function validarDataNoAno(db: D1Database, turmaId: number, data: string | null, rotulo: string) {
  if (!data || !ISO.test(data)) throw new ErroValidacao(`Informe ${rotulo}.`);
  const a = await db.prepare('SELECT a.* FROM turmas t JOIN anos_letivos a ON a.ano = t.ano_letivo WHERE t.id = ?').bind(turmaId).first<{ data_inicio: string; data_fim: string; ano: number }>();
  if (a && (data < a.data_inicio || data > a.data_fim)) throw new ErroValidacao(`${rotulo[0].toUpperCase() + rotulo.slice(1)} fora do ano letivo ${a.ano} (${dataBR(a.data_inicio)} a ${dataBR(a.data_fim)}).`);
}

rotasLotacao.post('/atribuir', async (c) => {
  const db = c.env.DB;
  const corpo = await lerCorpo(c);
  try {
    const turmaId = inteiro(corpo, 'turma_id') ?? 0;
    const compId = inteiro(corpo, 'componente_id') ?? 0;
    const data = texto(corpo, 'data_inicio');
    const ok = await db.prepare('SELECT t.codigo, cc.nome FROM turmas t JOIN componentes_curriculares cc ON cc.matriz_id = t.matriz_id WHERE t.id = ? AND cc.id = ?')
      .bind(turmaId, compId).first<{ codigo: string; nome: string }>();
    if (!ok) throw new ErroValidacao('Disciplina não pertence à matriz da turma.');
    const prof = await validarProfessor(db, inteiro(corpo, 'funcionario_id'));
    await validarDataNoAno(db, turmaId, data, 'a data de início');
    if (await db.prepare('SELECT 1 FROM lotacoes WHERE turma_id = ? AND componente_id = ? AND data_fim IS NULL').bind(turmaId, compId).first()) {
      throw new ErroValidacao('Esta disciplina já tem professor: use "Trocar".');
    }
    const r = await db.prepare('INSERT INTO lotacoes (turma_id, componente_id, funcionario_id, data_inicio, criado_por) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(turmaId, compId, prof.id, data, c.get('usuario').email).first<{ id: number }>();
    await auditar(c, 'atribuir', 'lotacao', r!.id, null, { turma: ok.codigo, disciplina: ok.nome, professor: prof.nome, data_inicio: data });
    return voltar(c, 'ok', `${prof.nome} atribuído(a) a ${ok.nome}. Agora monte o horário.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, 'erro', e.message);
    throw e;
  }
});

async function lotacaoAtiva(db: D1Database, id: number) {
  return db.prepare(
    `SELECT l.*, t.codigo AS turma, cc.nome AS componente, f.nome AS professor FROM lotacoes l JOIN turmas t ON t.id = l.turma_id
       JOIN componentes_curriculares cc ON cc.id = l.componente_id JOIN funcionarios f ON f.id = l.funcionario_id WHERE l.id = ? AND l.data_fim IS NULL`,
  ).bind(id).first<Record<string, any>>();
}

rotasLotacao.post('/:id{[0-9]+}/trocar', async (c) => {
  const db = c.env.DB;
  const l = await lotacaoAtiva(db, Number(c.req.param('id')));
  if (!l) return voltar(c, 'erro', 'Lotação não encontrada ou já encerrada.');
  const corpo = await lerCorpo(c);
  try {
    const prof = await validarProfessor(db, inteiro(corpo, 'funcionario_id'));
    if (prof.id === l.funcionario_id) throw new ErroValidacao('Escolha um professor diferente do atual.');
    const data = texto(corpo, 'data');
    const motivo = texto(corpo, 'motivo');
    await validarDataNoAno(db, l.turma_id, data, 'a data da troca');
    if (data! < l.data_inicio) throw new ErroValidacao(`A troca não pode ser antes do início da lotação atual (${dataBR(l.data_inicio)}).`);
    if (!motivo) throw new ErroValidacao('Informe o motivo da troca.');
    const fimAnterior = data! > l.data_inicio ? diaAnterior(data!) : l.data_inicio;
    const aulas = (await db.prepare('SELECT dia_semana, tempo FROM horario_aulas WHERE lotacao_id = ?').bind(l.id).all<{ dia_semana: number; tempo: number }>()).results;
    // encerra a atual e abre a nova; a grade passa para a nova lotação (se o novo professor não tiver choque)
    await db.batch([
      db.prepare(`UPDATE lotacoes SET data_fim = ?, motivo_fim = ?, encerrada_por = ?, encerrada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
        .bind(fimAnterior, `Troca: ${motivo}`, c.get('usuario').email, l.id),
      db.prepare('INSERT INTO lotacoes (turma_id, componente_id, funcionario_id, data_inicio, criado_por) VALUES (?, ?, ?, ?, ?)')
        .bind(l.turma_id, l.componente_id, prof.id, data, c.get('usuario').email),
    ]);
    const nova = (await db.prepare('SELECT id FROM lotacoes WHERE turma_id = ? AND componente_id = ? AND data_fim IS NULL').bind(l.turma_id, l.componente_id).first<{ id: number }>())!;
    const passou: string[] = [];
    const choques: string[] = [];
    for (const a of aulas) {
      try {
        await validarAulaGrade(db, nova.id, a.dia_semana, a.tempo);
        await db.prepare('INSERT INTO horario_aulas (lotacao_id, dia_semana, tempo) VALUES (?, ?, ?)').bind(nova.id, a.dia_semana, a.tempo).run();
        passou.push(`${nomeDia[a.dia_semana]} T${a.tempo}`);
      } catch (e) {
        if (e instanceof ErroValidacao) choques.push(`${nomeDia[a.dia_semana]} T${a.tempo}`);
        else throw e;
      }
    }
    await auditar(c, 'trocar', 'lotacao', l.id, { professor: l.professor, data_inicio: l.data_inicio },
      { turma: l.turma, disciplina: l.componente, novo_professor: prof.nome, a_partir_de: data, motivo, horario_transferido: passou, horario_com_choque: choques });
    const msg = `${l.componente}: ${prof.nome} a partir de ${dataBR(data!)}.` +
      (choques.length ? ` Atenção: ${choques.join(', ')} não passaram para o novo professor por choque de horário — ajuste em Horário do Professor.` : '');
    return voltar(c, choques.length ? 'erro' : 'ok', msg);
  } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, 'erro', e.message);
    throw e;
  }
});

rotasLotacao.post('/:id{[0-9]+}/encerrar', async (c) => {
  const db = c.env.DB;
  const l = await lotacaoAtiva(db, Number(c.req.param('id')));
  if (!l) return voltar(c, 'erro', 'Lotação não encontrada ou já encerrada.');
  const corpo = await lerCorpo(c);
  try {
    const data = texto(corpo, 'data_fim');
    const motivo = texto(corpo, 'motivo');
    await validarDataNoAno(db, l.turma_id, data, 'o último dia');
    if (data! < l.data_inicio) throw new ErroValidacao(`O último dia não pode ser antes do início (${dataBR(l.data_inicio)}).`);
    if (!motivo) throw new ErroValidacao('Informe o motivo.');
    await db.prepare(`UPDATE lotacoes SET data_fim = ?, motivo_fim = ?, encerrada_por = ?, encerrada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(data, motivo, c.get('usuario').email, l.id).run();
    await auditar(c, 'encerrar', 'lotacao', l.id, { professor: l.professor, data_inicio: l.data_inicio }, { turma: l.turma, disciplina: l.componente, data_fim: data, motivo });
    return voltar(c, 'ok', `Lotação de ${l.professor} em ${l.componente} encerrada em ${dataBR(data!)}.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, 'erro', e.message);
    throw e;
  }
});
