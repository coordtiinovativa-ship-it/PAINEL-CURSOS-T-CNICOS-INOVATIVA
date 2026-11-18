/**
 * Emissão de Certificados: todos os módulos concluídos com aprovação que ainda não têm certificado,
 * com indicação de quem está pronto e de quem tem dados pendentes. Poucas consultas no total
 * (não uma por aluno), para continuar rápido com turmas grandes.
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { avaliarModulo, criteriosDoCurso } from '../lib/aprovacao';
import { formatarCPF } from '../lib/cpf';
import { nomeDoAluno, OBRIGATORIOS_ALUNO, type Aluno } from '../certificado/dados';

export const rotasPendentes = new Hono<Env>();
rotasPendentes.use('*', exigir('certificados.emitir'));

interface Linha {
  matricula_id: number;
  turma_id: number;
  turma: string;
  modulo_id: number;
  modulo_ordem: number;
  modulo: string;
  qualificacao: string;
  aluno: Aluno;
  situacao: 'apto' | 'dados' | 'reprovado' | 'pendente' | 'andamento' | 'ordem';
  detalhes: string[];
}

export async function listarPendentes(db: D1Database, turmaId?: number): Promise<Linha[]> {
  const filtroTurma = turmaId ? 'AND t.id = ?' : '';
  const binds = turmaId ? [turmaId] : [];
  const [base, comps, res, emitidos, sigs] = await Promise.all([
    db.prepare(
      `SELECT m.id AS matricula_id, t.id AS turma_id, t.codigo AS turma, mt.id AS modulo_id, mt.ordem AS modulo_ordem,
              mt.nome AS modulo, mt.qualificacao_conferida AS qualificacao, tm.situacao AS situacao_modulo, cu.frequencia_minima, cu.nota_minima,
              cu.nota_minima_exame, cu.metodo_exame, cu.peso_media, cu.peso_exame, a.*
         FROM matriculas m JOIN turmas t ON t.id = m.turma_id JOIN cursos cu ON cu.id = t.curso_id
         JOIN alunos a ON a.id = m.aluno_id
         JOIN modulos_tematicos mt ON mt.matriz_id = t.matriz_id AND mt.tem_terminalidade = 1
         JOIN turma_modulos tm ON tm.turma_id = t.id AND tm.modulo_id = mt.id AND tm.situacao <> 'planejado'
        WHERE m.status <> 'cancelada' ${filtroTurma}
        ORDER BY t.codigo, mt.ordem, CASE WHEN a.usar_nome_social = 1 AND trim(coalesce(a.nome_social, '')) <> '' THEN a.nome_social ELSE a.nome_civil END`,
    ).bind(...binds).all<Record<string, any>>(),
    db.prepare('SELECT id, modulo_id, nome FROM componentes_curriculares WHERE modulo_id IS NOT NULL ORDER BY ordem').all<{ id: number; modulo_id: number; nome: string }>(),
    db.prepare(
      `SELECT r.* FROM resultados r JOIN matriculas m ON m.id = r.matricula_id JOIN turmas t ON t.id = m.turma_id WHERE 1 = 1 ${filtroTurma}`,
    ).bind(...binds).all<Record<string, any>>(),
    db.prepare(`SELECT matricula_id, modulo_id FROM certificados WHERE status = 'válido'`).all<{ matricula_id: number; modulo_id: number }>(),
    db.prepare(`SELECT nome FROM signatarios WHERE ativo = 1 AND funcao IN ('diretor_pedagogico','secretario')`).all<{ nome: string }>(),
  ]);

  const compsPorModulo = new Map<number, { id: number; nome: string }[]>();
  for (const c of comps.results) compsPorModulo.set(c.modulo_id, [...(compsPorModulo.get(c.modulo_id) ?? []), c]);
  const resPorChave = new Map(res.results.map((r) => [`${r.matricula_id}:${r.componente_id}`, r]));
  const jaEmitido = new Set(emitidos.results.map((e) => `${e.matricula_id}:${e.modulo_id}`));
  const signatariosOk = sigs.results.length >= 2 && sigs.results.every((s) => !s.nome.includes('A DEFINIR'));

  // aprovação de cada matrícula em cada módulo (para a regra de ordem)
  const aprovadoEm = new Map<string, boolean>();
  const avaliar = (b: Record<string, any>) => {
    const cs = compsPorModulo.get(b.modulo_id) ?? [];
    return avaliarModulo(
      cs.map((c) => c.nome),
      cs.map((c) => {
        const r = resPorChave.get(`${b.matricula_id}:${c.id}`);
        return { componente: c.nome, nota: r?.nota ?? null, notaExameFinal: r?.nota_exame_final ?? null, frequencia: r?.frequencia ?? null, aproveitada: !!r?.aproveitado_de_resultado_id };
      }),
      criteriosDoCurso(b as any),
    );
  };
  for (const b of base.results) aprovadoEm.set(`${b.matricula_id}:${b.modulo_ordem}`, avaliar(b).aprovado);

  const linhas: Linha[] = [];
  for (const b of base.results) {
    if (jaEmitido.has(`${b.matricula_id}:${b.modulo_id}`)) continue;
    const cs = compsPorModulo.get(b.modulo_id) ?? [];
    const av = avaliarModulo(
      cs.map((c) => c.nome),
      cs.map((c) => {
        const r = resPorChave.get(`${b.matricula_id}:${c.id}`);
        return { componente: c.nome, nota: r?.nota ?? null, notaExameFinal: r?.nota_exame_final ?? null, frequencia: r?.frequencia ?? null, aproveitada: !!r?.aproveitado_de_resultado_id };
      }),
      criteriosDoCurso(b as any),
    );
    const aluno = { ...b, id: b.id } as Aluno;
    const faltam = OBRIGATORIOS_ALUNO.filter(([k]) => aluno[k] == null || String(aluno[k]).trim() === '').map(([, r]) => r);
    if (!signatariosOk) faltam.push('signatários não cadastrados');
    let situacao: Linha['situacao'];
    let detalhes: string[];
    const anteriorPendente = base.results.find((x) => x.matricula_id === b.matricula_id && x.modulo_ordem < b.modulo_ordem && !aprovadoEm.get(`${x.matricula_id}:${x.modulo_ordem}`));
    if (b.situacao_modulo !== 'concluido') [situacao, detalhes] = ['andamento', ['O módulo ainda não foi concluído na turma']];
    else if (av.aprovado && anteriorPendente) [situacao, detalhes] = ['ordem', [`Precisa estar aprovado no Módulo ${anteriorPendente.modulo_ordem} — ${anteriorPendente.modulo}`]];
    else if (av.aprovado) [situacao, detalhes] = faltam.length ? ['dados', faltam] : ['apto', []];
    else if (av.pendente && !av.disciplinas.some((d) => d.resultado === 'RP')) [situacao, detalhes] = ['pendente', av.motivos];
    else [situacao, detalhes] = ['reprovado', av.motivos];
    linhas.push({
      matricula_id: b.matricula_id, turma_id: b.turma_id, turma: b.turma, modulo_id: b.modulo_id, modulo_ordem: b.modulo_ordem,
      modulo: b.modulo, qualificacao: b.qualificacao, aluno, situacao, detalhes,
    });
  }
  return linhas;
}

const ROTULO: Record<Linha['situacao'], [string, string]> = {
  apto: ['Pronto para emitir', 'ok'],
  dados: ['Aprovado — faltam dados', 'aviso'],
  pendente: ['Notas incompletas', ''],
  reprovado: ['Não aprovado', 'erro'],
  andamento: ['Módulo em andamento', ''],
  ordem: ['Aguardando aprovação no módulo anterior', 'aviso'],
};

rotasPendentes.get('/', async (c) => {
  const turmaId = Number(c.req.query('turma')) || undefined;
  const todos = c.req.query('todos') === '1';
  const db = c.env.DB;
  const turmas = (await db.prepare('SELECT id, codigo FROM turmas ORDER BY data_inicio DESC, codigo').all<{ id: number; codigo: string }>()).results;
  const linhas = await listarPendentes(db, turmaId);
  const visiveis = todos ? linhas : linhas.filter((l) => l.situacao === 'apto' || l.situacao === 'dados' || l.situacao === 'ordem');
  const n = (s: Linha['situacao']) => linhas.filter((l) => l.situacao === s).length;

  return c.html(
    <Pagina titulo="Emissão de Certificados" usuario={c.get('usuario')} caminho={c.req.path}>
      <h1>Emissão de Certificados</h1>
      <div class="kpis" style="margin-bottom:1rem">
        <div class="cartao"><b>{n('apto')}</b>prontos para emitir</div>
        <div class="cartao"><b>{n('dados')}</b>aprovados com dados faltando</div>
        <div class="cartao"><b>{n('pendente')}</b>com notas incompletas</div>
        <div class="cartao"><b>{n('andamento')}</b>em módulos ainda em andamento</div>
      </div>
      <form method="get" class="acoes">
        <select name="turma">
          <option value="">Todas as turmas</option>
          {turmas.map((t) => <option value={t.id} selected={t.id === turmaId}>{t.codigo}</option>)}
        </select>
        <label class="check"><input type="checkbox" name="todos" value="1" checked={todos} /> mostrar também módulos em andamento, não aprovados e notas incompletas</label>
        <button class="sec">Filtrar</button>
      </form>
      <table>
        <tr><th>Aluno</th><th>Turma</th><th>Qualificação (módulo)</th><th>Situação</th><th></th></tr>
        {visiveis.map((l) => (
          <tr>
            <td>
              <a href={`/admin/alunos/${l.aluno.id}`}>{nomeDoAluno(l.aluno)}</a>
              <div class="muted">CPF {l.aluno.cpf ? formatarCPF(l.aluno.cpf) : '—'}</div>
            </td>
            <td style="white-space:nowrap"><a href={`/admin/turmas/${l.turma_id}/modulos/${l.modulo_id}`}>{l.turma}</a></td>
            <td>{l.qualificacao}<div class="muted">Módulo {l.modulo_ordem}: {l.modulo}</div></td>
            <td>
              <span class={`tag ${ROTULO[l.situacao][1]}`}>{ROTULO[l.situacao][0]}</span>
              {l.detalhes.length > 0 && <div class="muted" title={l.detalhes.join('\n')}>{l.detalhes.slice(0, 3).join(' · ')}{l.detalhes.length > 3 ? ' …' : ''}</div>}
            </td>
            <td style="white-space:nowrap">
              {l.situacao === 'apto' && <a class="botao" href={`/admin/certificados/emitir/${l.matricula_id}/${l.modulo_id}`}>Emitir</a>}
              {l.situacao === 'dados' && <a href={`/admin/alunos/${l.aluno.id}`}>completar cadastro</a>}
              {' '}<a href={`/admin/previa/${l.matricula_id}/${l.modulo_id}`} target="_blank">prévia</a>
            </td>
          </tr>
        ))}
      </table>
      {!visiveis.length && <p class="muted">Nenhum certificado aguardando emissão{turmaId ? ' nesta turma' : ''}.</p>}
    </Pagina>,
  );
});
