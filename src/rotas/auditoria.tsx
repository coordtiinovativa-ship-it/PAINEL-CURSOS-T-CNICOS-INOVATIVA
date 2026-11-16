import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { dataBR } from '../lib/datas';

export const rotasAuditoria = new Hono<Env>();
rotasAuditoria.use('*', exigir('auditoria.ver'));

const POR_PAGINA = 50;

interface Linha {
  id: number;
  quando: string;
  usuario_email: string;
  acao: string;
  entidade: string;
  entidade_id: number | null;
  antes_json: string | null;
  depois_json: string | null;
  ip: string | null;
}

/** Converte timestamp UTC para horário de Campo Grande (UTC−4) para exibição. */
function quandoMS(iso: string): string {
  const d = new Date(Date.parse(iso) - 4 * 3600_000).toISOString();
  return `${dataBR(d)} ${d.slice(11, 19)}`;
}

const json = (s: string | null) => {
  if (!s) return '';
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
};

rotasAuditoria.get('/', async (c) => {
  const q = c.req.query();
  const pagina = Math.max(1, Number(q.pagina) || 1);
  const filtros: string[] = [];
  const params: (string | number)[] = [];
  if (q.usuario) { filtros.push('usuario_id = ?'); params.push(Number(q.usuario)); }
  if (q.entidade) { filtros.push('entidade = ?'); params.push(q.entidade); }
  if (q.acao) { filtros.push('acao = ?'); params.push(q.acao); }
  if (q.de) { filtros.push('quando >= ?'); params.push(`${q.de}T04:00:00Z`); }
  if (q.ate) { filtros.push('quando < ?'); params.push(new Date(Date.parse(`${q.ate}T04:00:00Z`) + 86400_000).toISOString()); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const db = c.env.DB;
  const linhas = (
    await db
      .prepare(`SELECT * FROM auditoria ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .bind(...params, POR_PAGINA + 1, (pagina - 1) * POR_PAGINA)
      .all<Linha>()
  ).results;
  const temMais = linhas.length > POR_PAGINA;
  const usuarios = (await db.prepare('SELECT id, nome FROM usuarios ORDER BY nome').all<{ id: number; nome: string }>()).results;
  const entidades = (await db.prepare('SELECT DISTINCT entidade FROM auditoria ORDER BY 1').all<{ entidade: string }>()).results;
  const acoes = (await db.prepare('SELECT DISTINCT acao FROM auditoria ORDER BY 1').all<{ acao: string }>()).results;
  const qs = (p: number) => '?' + new URLSearchParams({ ...q, pagina: String(p) }).toString();

  return c.html(
    <Pagina titulo="Auditoria" usuario={c.get('usuario')} caminho={c.req.path}>
      <h1>Auditoria</h1>
      <div class="cartao">
        <form method="get" class="grade">
          <label>Usuário
            <select name="usuario"><option value="">Todos</option>
              {usuarios.map((u) => <option value={u.id} selected={String(u.id) === q.usuario}>{u.nome}</option>)}
            </select>
          </label>
          <label>Entidade
            <select name="entidade"><option value="">Todas</option>
              {entidades.map((e) => <option selected={e.entidade === q.entidade}>{e.entidade}</option>)}
            </select>
          </label>
          <label>Ação
            <select name="acao"><option value="">Todas</option>
              {acoes.map((a) => <option selected={a.acao === q.acao}>{a.acao}</option>)}
            </select>
          </label>
          <label>De<input type="date" name="de" value={q.de ?? ''} /></label>
          <label>Até<input type="date" name="ate" value={q.ate ?? ''} /></label>
          <div class="acoes"><button>Filtrar</button><a class="botao sec" href="/admin/auditoria">Limpar</a></div>
        </form>
      </div>
      <p class="muted">Horários de Mato Grosso do Sul (UTC−4). Registros de auditoria não podem ser alterados nem apagados.</p>
      <table>
        <tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhes</th><th>IP</th></tr>
        {linhas.slice(0, POR_PAGINA).map((l) => (
          <tr>
            <td style="white-space:nowrap">{quandoMS(l.quando)}</td>
            <td>{l.usuario_email}</td>
            <td><span class={`tag ${l.acao.includes('falha') || l.acao.includes('bloq') ? 'erro' : ''}`}>{l.acao}</span></td>
            <td>{l.entidade}{l.entidade_id != null ? ` #${l.entidade_id}` : ''}</td>
            <td>
              {(l.antes_json || l.depois_json) && (
                <details>
                  <summary>ver</summary>
                  {l.antes_json && <><b>Antes</b><pre class="json">{json(l.antes_json)}</pre></>}
                  {l.depois_json && <><b>Depois</b><pre class="json">{json(l.depois_json)}</pre></>}
                </details>
              )}
            </td>
            <td class="muted">{l.ip ?? ''}</td>
          </tr>
        ))}
      </table>
      <div class="acoes">
        {pagina > 1 && <a class="botao sec" href={qs(pagina - 1)}>← Anteriores</a>}
        {temMais && <a class="botao sec" href={qs(pagina + 1)}>Mais antigos →</a>}
      </div>
    </Pagina>,
  );
});
