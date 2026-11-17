/**
 * Gestão Pedagógica → Funcionários: cadastro (dados pessoais, documentos, formação, contato, endereço), categorias
 * (professor, coordenador...), observação e documentos anexos. Professores ativos aparecem na Lotação.
 * Dados bancários, família e CNH do sysGEP ficaram de fora de propósito: o sistema não os usa (LGPD — mínimo necessário).
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Icone, Pagina, Selecao, UFS } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { arquivo, ErroValidacao, lerCorpo, texto, type Corpo } from '../lib/form';
import { formatarCPF, somenteDigitos, validarCPF } from '../lib/cpf';
import { salvarArquivo, TIPOS_IMAGEM, TIPOS_PDF, urlArquivo } from '../lib/arquivos';
import { dataBR } from '../lib/datas';
import { CATEGORIAS_FUNCIONARIO } from '../lib/pedagogico';

export const rotasFuncionarios = new Hono<Env>();
rotasFuncionarios.use('*', exigir('pedagogico.gerenciar'));

const CAMPOS = [
  'nome', 'cpf', 'rg', 'rg_orgao_expedidor', 'rg_uf', 'rg_data_expedicao', 'data_nascimento', 'sexo', 'cor_raca', 'estado_civil',
  'nacionalidade', 'naturalidade_municipio', 'naturalidade_uf', 'escolaridade', 'formacao', 'registro_profissional',
  'email', 'telefone', 'celular', 'cep', 'endereco', 'bairro', 'complemento', 'endereco_municipio', 'endereco_uf', 'observacao',
] as const;
type CampoF = (typeof CAMPOS)[number];
type Funcionario = { id: number; ativo: number } & Record<CampoF, string | null>;

const SEXOS: [string, string][] = [['F', 'Feminino'], ['M', 'Masculino']];
const CORES: [string, string][] = ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não declarada'].map((c) => [c, c]);
const ESTADOS_CIVIS: [string, string][] = ['Solteiro(a)', 'Casado(a)', 'União estável', 'Separado(a)', 'Divorciado(a)', 'Viúvo(a)'].map((c) => [c, c]);
const ESCOLARIDADES: [string, string][] = [
  'Ensino médio completo', 'Técnico de nível médio', 'Superior incompleto', 'Superior completo', 'Especialização', 'Mestrado', 'Doutorado',
].map((c) => [c, c]);
const rotuloCategoria = Object.fromEntries(CATEGORIAS_FUNCIONARIO);

const CSS = `
.secao-ficha{grid-column:1/-1;font-size:.78rem;font-weight:700;color:var(--texto-2);text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--borda);padding:.6rem 0 .2rem;margin-top:.2rem}
.categorias{display:flex;gap:.4rem;flex-wrap:wrap}
.categorias label{flex-direction:row;align-items:center;gap:.3rem;padding:.35rem .6rem;border:1px solid var(--borda-forte);border-radius:8px;cursor:pointer;font-weight:500}
`;

function ler(corpo: Corpo) {
  const d = Object.fromEntries(CAMPOS.map((k) => [k, texto(corpo, k)])) as Record<CampoF, string | null>;
  if (d.cpf) d.cpf = somenteDigitos(d.cpf);
  if (d.rg_orgao_expedidor) d.rg_orgao_expedidor = d.rg_orgao_expedidor.toUpperCase();
  if (d.email) d.email = d.email.toLowerCase();
  if (d.cep) { const c = somenteDigitos(d.cep); d.cep = c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : d.cep; }
  const categorias = ([] as unknown[]).concat(corpo.categorias ?? []).map(String).filter((c) => CATEGORIAS_FUNCIONARIO.some(([k]) => k === c));
  const ativo = corpo.ativo === '1' ? 1 : 0;
  return { d, categorias, ativo };
}

function validar(d: Record<CampoF, string | null>, categorias: string[]) {
  if (!d.nome) throw new ErroValidacao('Informe o nome completo.');
  if (!d.cpf || !validarCPF(d.cpf)) throw new ErroValidacao('CPF inválido.');
  if (!categorias.length) throw new ErroValidacao('Marque ao menos uma categoria (ex.: Professor).');
  for (const [k, r] of [['data_nascimento', 'Data de nascimento'], ['rg_data_expedicao', 'Data de expedição do RG']] as const) {
    if (d[k] && !/^\d{4}-\d{2}-\d{2}$/.test(d[k]!)) throw new ErroValidacao(`${r} inválida.`);
  }
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) throw new ErroValidacao('E-mail inválido.');
  if (d.cep && !/^\d{5}-\d{3}$/.test(d.cep)) throw new ErroValidacao('CEP inválido (use 00000-000).');
}

const Formulario = ({ f, categorias, acao }: { f: Partial<Funcionario>; categorias: string[]; acao: string }) => (
  <form method="post" action={acao} class="grade">
    <div class="secao-ficha">Dados pessoais</div>
    <Campo nome="nome" rotulo="Nome completo" valor={f.nome} obrigatorio classe="largo" />
    <Campo nome="data_nascimento" rotulo="Data de nascimento" tipo="date" valor={f.data_nascimento} />
    <Selecao nome="sexo" rotulo="Sexo" valor={f.sexo} opcoes={SEXOS} vazio="Selecione" />
    <Selecao nome="estado_civil" rotulo="Estado civil" valor={f.estado_civil} opcoes={ESTADOS_CIVIS} vazio="Selecione" />
    <Selecao nome="cor_raca" rotulo="Cor/raça" valor={f.cor_raca} opcoes={CORES} vazio="Selecione" />
    <Campo nome="nacionalidade" rotulo="Nacionalidade" valor={f.nacionalidade ?? (f.id ? null : 'brasileira')} />
    <Campo nome="naturalidade_municipio" rotulo="Naturalidade (município)" valor={f.naturalidade_municipio} />
    <Selecao nome="naturalidade_uf" rotulo="Naturalidade (UF)" valor={f.naturalidade_uf} opcoes={UFS} vazio="" />

    <div class="secao-ficha">Documentos</div>
    <Campo nome="cpf" rotulo="CPF" valor={f.cpf ? formatarCPF(f.cpf) : ''} obrigatorio extra={{ inputmode: 'numeric', placeholder: '000.000.000-00' }} />
    <Campo nome="rg" rotulo="RG" valor={f.rg} />
    <Campo nome="rg_orgao_expedidor" rotulo="Órgão expedidor" valor={f.rg_orgao_expedidor} extra={{ placeholder: 'SEJUSP' }} />
    <Selecao nome="rg_uf" rotulo="UF do RG" valor={f.rg_uf} opcoes={UFS} vazio="" />
    <Campo nome="rg_data_expedicao" rotulo="Expedição do RG" tipo="date" valor={f.rg_data_expedicao} />

    <div class="secao-ficha">Formação</div>
    <Selecao nome="escolaridade" rotulo="Grau de instrução" valor={f.escolaridade} opcoes={ESCOLARIDADES} vazio="Selecione" />
    <Campo nome="formacao" rotulo="Formação / habilitação" valor={f.formacao} extra={{ placeholder: 'Ex.: Administração — Especialização em Gestão' }} />
    <Campo nome="registro_profissional" rotulo="Registro profissional" valor={f.registro_profissional} extra={{ placeholder: 'Ex.: CRA-MS 0000' }} />

    <div class="secao-ficha">Contato e endereço</div>
    <Campo nome="email" rotulo="E-mail" tipo="email" valor={f.email} />
    <Campo nome="telefone" rotulo="Telefone" valor={f.telefone} extra={{ placeholder: '(00) 0000-0000' }} />
    <Campo nome="celular" rotulo="Celular" valor={f.celular} extra={{ placeholder: '(00) 00000-0000' }} />
    <Campo nome="cep" rotulo="CEP" valor={f.cep} extra={{ placeholder: '00000-000' }} />
    <Campo nome="endereco" rotulo="Endereço" valor={f.endereco} />
    <Campo nome="bairro" rotulo="Bairro" valor={f.bairro} />
    <Campo nome="complemento" rotulo="Complemento" valor={f.complemento} />
    <Campo nome="endereco_municipio" rotulo="Município" valor={f.endereco_municipio} />
    <Selecao nome="endereco_uf" rotulo="UF" valor={f.endereco_uf} opcoes={UFS} vazio="" />

    <div class="secao-ficha">Categorias e situação</div>
    <div class="largo categorias">
      {CATEGORIAS_FUNCIONARIO.map(([k, r]) => <label><input type="checkbox" name="categorias" value={k} checked={categorias.includes(k)} />{r}</label>)}
    </div>
    <label class="check"><input type="checkbox" name="ativo" value="1" checked={f.ativo == null ? true : !!f.ativo} /> Ativo (aparece na lotação e no horário)</label>
    <label class="largo">Observação<textarea name="observacao" rows={3}>{f.observacao ?? ''}</textarea></label>
    <div class="largo acoes"><button><Icone nome="salvar" />Salvar</button><a class="botao sec" href="/admin/pedagogico/funcionarios">Cancelar</a></div>
  </form>
);

// ------------------------------------------------------------------ lista
rotasFuncionarios.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const dig = somenteDigitos(q);
  const lista = (await c.env.DB.prepare(
    `SELECT f.id, f.nome, f.cpf, f.email, f.celular, f.ativo, (SELECT group_concat(categoria, ',') FROM funcionario_categorias WHERE funcionario_id = f.id) AS categorias,
            (SELECT count(*) FROM lotacoes l WHERE l.funcionario_id = f.id AND l.data_fim IS NULL) AS lotacoes
       FROM funcionarios f WHERE ? = '' OR f.nome LIKE ? OR (? <> '' AND f.cpf LIKE ?) ORDER BY f.ativo DESC, f.nome LIMIT 300`,
  ).bind(q, `%${q}%`, dig, `${dig}%`).all<Record<string, any>>()).results;
  return c.html(
    <Pagina titulo="Funcionários" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Funcionários</h1>
      <div class="acoes" style="margin-top:0">
        <a class="botao" href="/admin/pedagogico/funcionarios/novo"><Icone nome="incluir" />Incluir funcionário</a>
        <form method="get" class="acoes" style="margin:0"><input name="q" value={q} placeholder="Nome ou CPF" /><button class="sec"><Icone nome="buscar" />Localizar</button></form>
      </div>
      <table>
        <tr><th>Nome</th><th>CPF</th><th>Categorias</th><th>Contato</th><th class="c">Lotações ativas</th><th>Situação</th><th></th></tr>
        {lista.map((f) => (
          <tr>
            <td><a href={`/admin/pedagogico/funcionarios/${f.id}`}>{f.nome}</a></td>
            <td style="white-space:nowrap">{formatarCPF(f.cpf)}</td>
            <td>{String(f.categorias ?? '').split(',').filter(Boolean).map((k) => <span class="tag" style="margin-right:.2rem">{rotuloCategoria[k] ?? k}</span>)}</td>
            <td>{f.email ?? ''}<div class="muted">{f.celular ?? ''}</div></td>
            <td class="c">{f.lotacoes}</td>
            <td><span class={`tag ${f.ativo ? 'ok' : ''}`}>{f.ativo ? 'ativo' : 'inativo'}</span></td>
            <td><a href={`/admin/pedagogico/funcionarios/${f.id}`}>abrir</a></td>
          </tr>
        ))}
      </table>
      {!lista.length && <p class="muted">{q ? 'Nenhum funcionário encontrado.' : 'Nenhum funcionário cadastrado. Comece pelos professores: eles são usados na Lotação e no Horário.'}</p>}
    </Pagina>,
  );
});

// ------------------------------------------------------------------ incluir
const telaNovo = (c: any, f: Partial<Funcionario> = {}, categorias: string[] = ['professor'], erro?: string) => (
  <Pagina titulo="Novo funcionário" usuario={c.get('usuario')} caminho="/admin/pedagogico/funcionarios" erro={erro} voltar="/admin/pedagogico/funcionarios">
    <style dangerouslySetInnerHTML={{ __html: CSS }} />
    <h1>Novo funcionário</h1>
    <div class="cartao"><Formulario f={f} categorias={categorias} acao="/admin/pedagogico/funcionarios/novo" /></div>
  </Pagina>
);

rotasFuncionarios.get('/novo', (c) => c.html(telaNovo(c)));

rotasFuncionarios.post('/novo', async (c) => {
  const { d, categorias, ativo } = ler(await lerCorpo(c));
  try {
    validar(d, categorias);
    const dup = await c.env.DB.prepare('SELECT nome FROM funcionarios WHERE cpf = ?').bind(d.cpf).first<{ nome: string }>();
    if (dup) throw new ErroValidacao(`CPF já cadastrado para ${dup.nome}.`);
  } catch (e) {
    if (e instanceof ErroValidacao) return c.html(telaNovo(c, { ...d, ativo }, categorias, e.message), 400);
    throw e;
  }
  const r = await c.env.DB.prepare(`INSERT INTO funcionarios (${CAMPOS.join(', ')}, ativo) VALUES (${CAMPOS.map(() => '?').join(', ')}, ?) RETURNING id`)
    .bind(...CAMPOS.map((k) => d[k]), ativo).first<{ id: number }>();
  await c.env.DB.batch(categorias.map((k) => c.env.DB.prepare('INSERT INTO funcionario_categorias (funcionario_id, categoria) VALUES (?, ?)').bind(r!.id, k)));
  await auditar(c, 'criar', 'funcionario', r!.id, null, { ...d, ativo, categorias });
  return c.redirect(`/admin/pedagogico/funcionarios/${r!.id}?ok=` + encodeURIComponent('Funcionário cadastrado.'));
});

// ------------------------------------------------------------------ ficha
async function telaFicha(c: any, id: number, opcoes: { erro?: string; rascunho?: Partial<Funcionario>; categorias?: string[] } = {}) {
  const db = c.env.DB as D1Database;
  const [f, cats, docs, lotacoes] = await Promise.all([
    db.prepare('SELECT * FROM funcionarios WHERE id = ?').bind(id).first<Funcionario>(),
    db.prepare('SELECT categoria FROM funcionario_categorias WHERE funcionario_id = ?').bind(id).all<{ categoria: string }>(),
    db.prepare('SELECT * FROM funcionario_documentos WHERE funcionario_id = ? AND excluido_em IS NULL ORDER BY id').bind(id).all<Record<string, any>>(),
    db.prepare(
      `SELECT l.*, t.codigo AS turma, cc.nome AS componente FROM lotacoes l JOIN turmas t ON t.id = l.turma_id
         JOIN componentes_curriculares cc ON cc.id = l.componente_id WHERE l.funcionario_id = ? ORDER BY l.data_fim IS NOT NULL, l.data_inicio DESC`,
    ).bind(id).all<Record<string, any>>(),
  ]);
  if (!f) return null;
  const dados = { ...f, ...(opcoes.rascunho ?? {}) };
  return (
    <Pagina titulo={f.nome!} usuario={c.get('usuario')} caminho="/admin/pedagogico/funcionarios" ok={c.req.query('ok')} erro={opcoes.erro} voltar="/admin/pedagogico/funcionarios">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>{f.nome} {!f.ativo && <span class="tag">inativo</span>}</h1>
      <div class="cartao"><Formulario f={dados} categorias={opcoes.categorias ?? cats.results.map((x) => x.categoria)} acao={`/admin/pedagogico/funcionarios/${id}`} /></div>

      <h2>Lotações</h2>
      <table>
        <tr><th>Turma</th><th>Disciplina</th><th>Período</th><th>Situação</th></tr>
        {lotacoes.results.map((l) => (
          <tr>
            <td>{l.turma}</td><td>{l.componente}</td>
            <td>{dataBR(l.data_inicio)} a {l.data_fim ? dataBR(l.data_fim) : 'atual'}</td>
            <td>{l.data_fim ? <span class="tag">encerrada</span> : <span class="tag ok">ativa</span>}{l.motivo_fim && <div class="muted">{l.motivo_fim}</div>}</td>
          </tr>
        ))}
      </table>
      {!lotacoes.results.length && <p class="muted">Sem lotações. Vincule o professor às disciplinas em <a href="/admin/pedagogico/lotacao">Lotação de Professores</a>.</p>}

      <h2>Documentos</h2>
      <form method="post" action={`/admin/pedagogico/funcionarios/${id}/documentos`} enctype="multipart/form-data" class="acoes">
        <input name="descricao" required placeholder="Descrição (ex.: diploma, portaria)" />
        <input type="file" name="arquivo" accept="application/pdf,image/png,image/jpeg" required />
        <button class="sec"><Icone nome="incluir" />Anexar</button>
        <span class="muted">PDF, JPG ou PNG até 10 MB</span>
      </form>
      <table>
        <tr><th>Descrição</th><th>Arquivo</th><th>Data</th><th></th></tr>
        {docs.results.map((d) => (
          <tr>
            <td>{d.descricao}</td><td><a href={urlArquivo(d.r2_key)!} target="_blank">{d.nome_arquivo}</a><div class="muted">{d.enviado_por}</div></td><td>{dataBR(d.criado_em)}</td>
            <td><form method="post" action={`/admin/pedagogico/funcionarios/${id}/documentos/${d.id}/excluir`} onsubmit="return confirm('Excluir este documento da lista? O arquivo continua no histórico.')">
              <button class="sec" style="padding:.2rem .5rem;color:var(--erro)">excluir</button></form></td>
          </tr>
        ))}
      </table>
      {!docs.results.length && <p class="muted">Não existem documentos anexados.</p>}
    </Pagina>
  );
}

rotasFuncionarios.get('/:id{[0-9]+}', async (c) => {
  const t = await telaFicha(c, Number(c.req.param('id')));
  return t ? c.html(t) : c.notFound();
});

rotasFuncionarios.post('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const antes = await db.prepare('SELECT * FROM funcionarios WHERE id = ?').bind(id).first<Funcionario>();
  if (!antes) return c.notFound();
  const { d, categorias, ativo } = ler(await lerCorpo(c));
  try {
    validar(d, categorias);
    const dup = await db.prepare('SELECT nome FROM funcionarios WHERE cpf = ? AND id <> ?').bind(d.cpf, id).first<{ nome: string }>();
    if (dup) throw new ErroValidacao(`CPF já cadastrado para ${dup.nome}.`);
    if (!ativo || !categorias.includes('professor')) {
      const lot = await db.prepare('SELECT count(*) AS n FROM lotacoes WHERE funcionario_id = ? AND data_fim IS NULL').bind(id).first<{ n: number }>();
      if (lot?.n) throw new ErroValidacao(`Este funcionário tem ${lot.n} lotação(ões) ativa(s): encerre-as em Lotação de Professores antes de inativá-lo ou de tirar a categoria Professor.`);
    }
  } catch (e) {
    if (e instanceof ErroValidacao) return c.html((await telaFicha(c, id, { erro: e.message, rascunho: { ...d, ativo }, categorias }))!, 400);
    throw e;
  }
  const catsAntes = (await db.prepare('SELECT categoria FROM funcionario_categorias WHERE funcionario_id = ?').bind(id).all<{ categoria: string }>()).results.map((x) => x.categoria);
  await db.batch([
    db.prepare(`UPDATE funcionarios SET ${CAMPOS.map((k) => `${k} = ?`).join(', ')}, ativo = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(...CAMPOS.map((k) => d[k]), ativo, id),
    db.prepare('DELETE FROM funcionario_categorias WHERE funcionario_id = ?').bind(id),
    ...categorias.map((k) => db.prepare('INSERT INTO funcionario_categorias (funcionario_id, categoria) VALUES (?, ?)').bind(id, k)),
  ]);
  const mudou = Object.fromEntries(CAMPOS.filter((k) => String(antes[k] ?? '') !== String(d[k] ?? '')).map((k) => [k, d[k]]));
  if (antes.ativo !== ativo) mudou.ativo = String(ativo);
  if (catsAntes.sort().join() !== [...categorias].sort().join()) mudou.categorias = categorias.join(',');
  if (Object.keys(mudou).length) await auditar(c, 'atualizar', 'funcionario', id, { ...Object.fromEntries(Object.keys(mudou).map((k) => [k, (antes as any)[k]])), categorias: catsAntes.join(',') }, mudou);
  return c.redirect(`/admin/pedagogico/funcionarios/${id}?ok=` + encodeURIComponent('Dados salvos.'));
});

rotasFuncionarios.post('/:id{[0-9]+}/documentos', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await c.env.DB.prepare('SELECT 1 FROM funcionarios WHERE id = ?').bind(id).first())) return c.notFound();
  const corpo = await lerCorpo(c);
  const descricao = texto(corpo, 'descricao');
  const arq = arquivo(corpo, 'arquivo');
  try {
    if (!descricao) throw new ErroValidacao('Informe a descrição do documento.');
    if (!arq) throw new ErroValidacao('Selecione o arquivo.');
    const chave = await salvarArquivo(c.env.ARQUIVOS, `funcionarios/${id}`, arq, [...TIPOS_PDF, ...TIPOS_IMAGEM], 10, 'Documento');
    const tipo = chave.endsWith('.pdf') ? 'application/pdf' : chave.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const r = await c.env.DB.prepare(
      'INSERT INTO funcionario_documentos (funcionario_id, descricao, nome_arquivo, r2_key, tipo, tamanho, enviado_por) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    ).bind(id, descricao.slice(0, 150), arq.name.slice(0, 200), chave, tipo, arq.size, c.get('usuario').email).first<{ id: number }>();
    await auditar(c, 'anexar_documento', 'funcionario', id, null, { documento_id: r!.id, descricao, arquivo: arq.name });
  } catch (e) {
    if (e instanceof ErroValidacao) return c.html((await telaFicha(c, id, { erro: e.message }))!, 400);
    throw e;
  }
  return c.redirect(`/admin/pedagogico/funcionarios/${id}?ok=` + encodeURIComponent('Documento anexado.'));
});

rotasFuncionarios.post('/:id{[0-9]+}/documentos/:doc{[0-9]+}/excluir', async (c) => {
  const id = Number(c.req.param('id'));
  const docId = Number(c.req.param('doc'));
  const d = await c.env.DB.prepare('SELECT * FROM funcionario_documentos WHERE id = ? AND funcionario_id = ? AND excluido_em IS NULL').bind(docId, id).first<Record<string, any>>();
  if (!d) return c.notFound();
  await c.env.DB.prepare(`UPDATE funcionario_documentos SET excluido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), excluido_por = ? WHERE id = ?`).bind(c.get('usuario').email, docId).run();
  await auditar(c, 'excluir_documento', 'funcionario', id, { documento_id: docId, descricao: d.descricao, r2_key: d.r2_key }, null);
  return c.redirect(`/admin/pedagogico/funcionarios/${id}?ok=` + encodeURIComponent('Documento excluído da lista (o arquivo continua no histórico).'));
});
