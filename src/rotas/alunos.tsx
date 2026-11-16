import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Pagina, Selecao, UFS } from '../views/layout';
import { exigir } from '../auth/sessao';
import { pode } from '../auth/permissoes';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, lerCorpo, texto, type Corpo } from '../lib/form';
import { formatarCPF, somenteDigitos, validarCPF } from '../lib/cpf';
import { CAMPOS_ALUNO, OBRIGATORIOS_ALUNO, type Aluno } from '../certificado/dados';

export const rotasAlunos = new Hono<Env>();
rotasAlunos.use('*', exigir('alunos.editar'));

const SEXOS: [string, string][] = [['F', 'Feminino'], ['M', 'Masculino']];
const CORES: [string, string][] = ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não declarada'].map((c) => [c, c]);

export function faltantesAluno(a: Partial<Aluno>): string[] {
  return OBRIGATORIOS_ALUNO.filter(([k]) => a[k] == null || String(a[k]).trim() === '').map(([, r]) => r);
}

/** Lê e valida o formulário do aluno. Com `parcial`, não lança erro (usado na prévia ao vivo). */
export function lerAluno(corpo: Corpo, parcial = false): Record<(typeof CAMPOS_ALUNO)[number], string | null> {
  const d = Object.fromEntries(CAMPOS_ALUNO.map((k) => [k, texto(corpo, k)])) as Record<(typeof CAMPOS_ALUNO)[number], string | null>;
  if (d.cpf) d.cpf = somenteDigitos(d.cpf);
  if (d.rg_orgao_expedidor) d.rg_orgao_expedidor = d.rg_orgao_expedidor.toUpperCase();
  if (parcial) return d;
  if (!d.nome_civil) throw new ErroValidacao('Informe o nome civil.');
  if (!d.cpf || !validarCPF(d.cpf)) throw new ErroValidacao('CPF inválido.');
  if (d.data_nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(d.data_nascimento)) throw new ErroValidacao('Data de nascimento inválida.');
  if (d.ensino_medio_ano_conclusao) {
    const ano = Number(d.ensino_medio_ano_conclusao);
    if (!Number.isInteger(ano) || ano < 1950 || ano > new Date().getFullYear() + 1) {
      throw new ErroValidacao('Ano de conclusão do ensino médio inválido.');
    }
  }
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) throw new ErroValidacao('E-mail inválido.');
  return d;
}

rotasAlunos.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const digitos = somenteDigitos(q);
  const lista = (
    await c.env.DB.prepare(
      `SELECT a.*, (SELECT group_concat(t.codigo, ', ') FROM matriculas m JOIN turmas t ON t.id = m.turma_id WHERE m.aluno_id = a.id) AS turmas
         FROM alunos a
        WHERE ? = '' OR a.nome_civil LIKE ? OR a.nome_social LIKE ? OR a.ra = ? OR (? <> '' AND a.cpf LIKE ?)
        ORDER BY coalesce(a.nome_social, a.nome_civil) LIMIT 200`,
    )
      .bind(q, `%${q}%`, `%${q}%`, q, digitos, `${digitos}%`)
      .all<Aluno & { turmas: string | null }>()
  ).results;
  return c.html(
    <Pagina titulo="Alunos" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Alunos</h1>
      <div class="acoes">
        <form method="get" class="acoes" style="margin:0">
          <input name="q" value={q} placeholder="Nome, CPF ou RA" />
          <button class="sec">Buscar</button>
        </form>
        <a class="botao" href="/admin/alunos/novo">+ Novo aluno</a>
      </div>
      <table>
        <tr><th>Nome</th><th>CPF</th><th>RA</th><th>Turmas</th><th>Dados p/ certificado</th><th></th></tr>
        {lista.map((a) => {
          const f = faltantesAluno(a);
          return (
            <tr>
              <td>{a.nome_social ?? a.nome_civil}{a.nome_social && <div class="muted">civil: {a.nome_civil}</div>}</td>
              <td>{a.cpf ? formatarCPF(a.cpf) : ''}</td>
              <td>{a.ra ?? ''}</td>
              <td>{a.turmas ?? '—'}</td>
              <td>{f.length ? <span class="tag aviso" title={f.join(', ')}>{f.length} campo(s) faltando</span> : <span class="tag ok">completos</span>}</td>
              <td><a href={`/admin/alunos/${a.id}`}>editar</a></td>
            </tr>
          );
        })}
      </table>
      {!lista.length && <p class="muted">Nenhum aluno encontrado.</p>}
    </Pagina>,
  );
});

interface PreviaOpcao { matricula_id: number; modulo_id: number; rotulo: string }

const JS_PREVIA = `
(function(){
  var form=document.getElementById('form-aluno'), sel=document.getElementById('previa-alvo'), fr=document.getElementById('previa');
  if(!form||!sel||!fr) return;
  var t, ctrl;
  function atualizar(){
    var alvo=sel.value; if(!alvo) return;
    if(ctrl) ctrl.abort(); ctrl=new AbortController();
    fetch('/admin/previa/'+alvo+'/rascunho',{method:'POST',body:new FormData(form),signal:ctrl.signal})
      .then(function(r){return r.text()}).then(function(h){fr.srcdoc=h}).catch(function(){});
  }
  form.addEventListener('input',function(){clearTimeout(t);t=setTimeout(atualizar,500)});
  sel.addEventListener('change',atualizar);
  atualizar();
})();`;

const FormAluno = ({ c, a, erro, previas }: { c: any; a?: Partial<Aluno>; erro?: string; previas?: PreviaOpcao[] }) => {
  const falt = a ? faltantesAluno(a) : [];
  return (
    <Pagina titulo={a?.id ? 'Editar aluno' : 'Novo aluno'} usuario={c.get('usuario')} caminho={c.req.path} erro={erro} ok={c.req.query('ok')}>
      <h1>{a?.id ? `Aluno: ${a.nome_social ?? a.nome_civil}` : 'Novo aluno'}</h1>
      {a?.id && falt.length > 0 && (
        <div class="msg aviso">Faltam para o certificado: {falt.join(', ')}.</div>
      )}
      <div class="cartao">
        <form method="post" class="grade" id="form-aluno">
          <h2 class="largo" style="margin-top:0">Identificação</h2>
          <Campo nome="nome_civil" rotulo="Nome civil" valor={a?.nome_civil} obrigatorio classe="largo" />
          <Campo nome="nome_social" rotulo="Nome social" valor={a?.nome_social} classe="largo" dica="Se preenchido, é o nome impresso no certificado." />
          <Campo nome="cpf" rotulo="CPF" valor={a?.cpf ? formatarCPF(a.cpf) : ''} obrigatorio />
          <Campo nome="ra" rotulo="RA (registro acadêmico)" valor={a?.ra} />
          <Campo nome="rg" rotulo="RG" valor={a?.rg} />
          <Campo nome="rg_orgao_expedidor" rotulo="Órgão expedidor" valor={a?.rg_orgao_expedidor} dica="Ex.: SEJUSP, SSP" />
          <Selecao nome="rg_uf" rotulo="UF do RG" valor={a?.rg_uf} opcoes={UFS} vazio="" />
          <Campo nome="data_nascimento" rotulo="Data de nascimento" tipo="date" valor={a?.data_nascimento} />
          <Selecao nome="sexo" rotulo="Sexo" valor={a?.sexo} opcoes={SEXOS} vazio="" />
          <Selecao nome="cor_raca" rotulo="Cor/raça" valor={a?.cor_raca} opcoes={CORES} vazio="" />
          <Campo nome="nacionalidade" rotulo="Nacionalidade" valor={a?.nacionalidade ?? 'brasileira'} />
          <Campo nome="naturalidade_municipio" rotulo="Naturalidade (município)" valor={a?.naturalidade_municipio} />
          <Selecao nome="naturalidade_uf" rotulo="Naturalidade (UF)" valor={a?.naturalidade_uf} opcoes={UFS} vazio="" />
          <Campo nome="nome_pai" rotulo="Nome do pai" valor={a?.nome_pai} classe="largo" />
          <Campo nome="nome_mae" rotulo="Nome da mãe" valor={a?.nome_mae} classe="largo" />

          <h2 class="largo">Ensino médio (verso do certificado)</h2>
          <Campo nome="ensino_medio_instituicao" rotulo="Instituição" valor={a?.ensino_medio_instituicao} classe="largo" />
          <Campo nome="ensino_medio_municipio" rotulo="Município" valor={a?.ensino_medio_municipio} />
          <Selecao nome="ensino_medio_uf" rotulo="UF" valor={a?.ensino_medio_uf} opcoes={UFS} vazio="" />
          <Campo nome="ensino_medio_ano_conclusao" rotulo="Ano de conclusão" tipo="number" valor={a?.ensino_medio_ano_conclusao} />
          <Campo nome="escolaridade" rotulo="Escolaridade" valor={a?.escolaridade} />

          <h2 class="largo">Contato</h2>
          <Campo nome="email" rotulo="E-mail" tipo="email" valor={a?.email} />
          <Campo nome="telefone" rotulo="Telefone" valor={a?.telefone} />
          <div class="largo acoes">
            <button>Salvar</button>
            <a class="botao sec" href="/admin/alunos">Voltar</a>
          </div>
        </form>
        {a?.id && pode(c.get('usuario').perfil, 'alunos.excluir') && (
          <form method="post" action={`/admin/alunos/${a.id}/excluir`} onsubmit="return confirm('Excluir este aluno? Só é possível se ele não tiver matrícula.')">
            <button class="perigo">Excluir aluno</button>
          </form>
        )}
      </div>

      {previas && previas.length > 0 && (
        <div class="cartao">
          <h2 style="margin-top:0">Prévia do certificado</h2>
          <p class="muted">A prévia acompanha o que você digita acima (sem salvar). Campos faltantes aparecem destacados em amarelo.</p>
          <div class="acoes">
            <select id="previa-alvo">
              {previas.map((p) => <option value={`${p.matricula_id}/${p.modulo_id}`}>{p.rotulo}</option>)}
            </select>
            <a class="botao sec" href="#" onclick="var v=document.getElementById('previa-alvo').value;window.open('/admin/previa/'+v);return false">Abrir em tela cheia</a>
          </div>
          <iframe id="previa" style="width:100%;height:1500px;border:1px solid var(--borda);border-radius:8px;background:#e9edf2" />
          <script dangerouslySetInnerHTML={{ __html: JS_PREVIA }} />
        </div>
      )}
    </Pagina>
  );
};

async function opcoesPrevia(db: D1Database, alunoId: number): Promise<PreviaOpcao[]> {
  return (
    await db
      .prepare(
        `SELECT m.id AS matricula_id, mt.id AS modulo_id, t.codigo || ' — Módulo ' || mt.ordem || ': ' || mt.nome AS rotulo
           FROM matriculas m JOIN turmas t ON t.id = m.turma_id
           JOIN modulos_tematicos mt ON mt.matriz_id = t.matriz_id AND mt.tem_terminalidade = 1
          WHERE m.aluno_id = ? ORDER BY t.data_inicio DESC, mt.ordem`,
      )
      .bind(alunoId)
      .all<PreviaOpcao>()
  ).results;
}

async function cpfDuplicado(db: D1Database, cpf: string, id = 0) {
  return db.prepare('SELECT nome_civil FROM alunos WHERE cpf = ? AND id <> ?').bind(cpf, id).first<{ nome_civil: string }>();
}

rotasAlunos.get('/novo', (c) => c.html(<FormAluno c={c} />));

rotasAlunos.post('/novo', async (c) => {
  const corpo = await lerCorpo(c);
  let d;
  try {
    d = lerAluno(corpo);
    const dup = await cpfDuplicado(c.env.DB, d.cpf!);
    if (dup) throw new ErroValidacao(`CPF já cadastrado para ${dup.nome_civil}.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return c.html(<FormAluno c={c} a={lerAluno(corpo, true) as any} erro={e.message} />, 400);
    throw e;
  }
  const cols = CAMPOS_ALUNO;
  const r = await c.env.DB.prepare(`INSERT INTO alunos (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`)
    .bind(...cols.map((k) => d[k]))
    .first<{ id: number }>();
  await auditar(c, 'criar', 'aluno', r!.id, null, d);
  return c.redirect(`/admin/alunos/${r!.id}?ok=` + encodeURIComponent('Aluno cadastrado.'));
});

rotasAlunos.get('/:id{[0-9]+}', async (c) => {
  const a = await c.env.DB.prepare('SELECT * FROM alunos WHERE id = ?').bind(Number(c.req.param('id'))).first<Aluno>();
  if (!a) return c.notFound();
  const previas = pode(c.get('usuario').perfil, 'relatorios.emitir') ? await opcoesPrevia(c.env.DB, a.id) : [];
  return c.html(<FormAluno c={c} a={a} previas={previas} />);
});

rotasAlunos.post('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const antes = await c.env.DB.prepare('SELECT * FROM alunos WHERE id = ?').bind(id).first<Aluno>();
  if (!antes) return c.notFound();
  const corpo = await lerCorpo(c);
  let d;
  try {
    d = lerAluno(corpo);
    const dup = await cpfDuplicado(c.env.DB, d.cpf!, id);
    if (dup) throw new ErroValidacao(`CPF já cadastrado para ${dup.nome_civil}.`);
  } catch (e) {
    if (e instanceof ErroValidacao) {
      return c.html(<FormAluno c={c} a={{ ...antes, ...(lerAluno(corpo, true) as any) }} erro={e.message} previas={await opcoesPrevia(c.env.DB, id)} />, 400);
    }
    throw e;
  }
  const cols = CAMPOS_ALUNO;
  await c.env.DB.prepare(`UPDATE alunos SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .bind(...cols.map((k) => d[k]), id)
    .run();
  const mudou = Object.fromEntries(cols.filter((k) => String(antes[k] ?? '') !== String(d[k] ?? '')).map((k) => [k, d[k]]));
  const era = Object.fromEntries(Object.keys(mudou).map((k) => [k, antes[k as keyof Aluno]]));
  if (Object.keys(mudou).length) await auditar(c, 'atualizar', 'aluno', id, era, mudou);
  return c.redirect(`/admin/alunos/${id}?ok=` + encodeURIComponent('Dados salvos.'));
});

rotasAlunos.post('/:id{[0-9]+}/excluir', exigir('alunos.excluir'), async (c) => {
  const id = Number(c.req.param('id'));
  const a = await c.env.DB.prepare('SELECT * FROM alunos WHERE id = ?').bind(id).first<Aluno>();
  if (!a) return c.notFound();
  const tem = await c.env.DB.prepare('SELECT 1 FROM matriculas WHERE aluno_id = ?').bind(id).first();
  if (tem) return c.redirect(`/admin/alunos/${id}?ok=` + encodeURIComponent('Não excluído: o aluno possui matrícula.'));
  await c.env.DB.prepare('DELETE FROM alunos WHERE id = ?').bind(id).run();
  await auditar(c, 'excluir', 'aluno', id, a, null);
  return c.redirect('/admin/alunos?ok=' + encodeURIComponent('Aluno excluído.'));
});
