import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Pagina, Selecao, UFS } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { ErroValidacao, lerCorpo, texto } from '../lib/form';
import { dataBR } from '../lib/datas';

export const rotasInstituicao = new Hono<Env>();
rotasInstituicao.use('*', exigir('instituicao.editar'));

const CAMPOS = [
  'razao_social', 'nome_fantasia', 'sigla', 'cnpj', 'mantenedora_razao_social', 'mantenedora_cnpj',
  'endereco', 'bairro', 'municipio', 'uf', 'cep', 'telefone', 'email', 'site', 'validade_credenciamento', 'cor_principal',
  'texto_atos',
] as const;

const FINALIDADES: [string, string][] = [
  ['criacao_instituicao', 'Criação da instituição'],
  ['credenciamento', 'Credenciamento'],
  ['criacao_curso', 'Criação do curso'],
  ['autorizacao_curso', 'Autorização do curso / aprovação do PPC'],
  ['reconhecimento', 'Reconhecimento'],
  ['renovacao_reconhecimento', 'Renovação de reconhecimento'],
];
const TIPOS_ATO: [string, string][] = ['Ata', 'Portaria', 'Resolução', 'Parecer', 'Deliberação', 'Reconhecimento'].map((t) => [t, t]);
const rotuloFinalidade = Object.fromEntries(FINALIDADES);

rotasInstituicao.get('/', async (c) => {
  const db = c.env.DB;
  const inst = await db.prepare('SELECT * FROM instituicoes WHERE id = 1').first<Record<string, any>>();
  const atos = (
    await db
      .prepare(`SELECT a.*, cu.nome AS curso FROM atos_regulatorios a LEFT JOIN cursos cu ON cu.id = a.curso_id ORDER BY a.data`)
      .all<Record<string, any>>()
  ).results;
  return c.html(
    <Pagina titulo="Instituição" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <h1>Instituição</h1>
      <div class="cartao">
        <form method="post" class="grade">
          <Campo nome="razao_social" rotulo="Nome / razão social" valor={inst?.razao_social} obrigatorio classe="largo" />
          <Campo nome="nome_fantasia" rotulo="Nome fantasia" valor={inst?.nome_fantasia} />
          <Campo nome="sigla" rotulo="Sigla" valor={inst?.sigla} />
          <Campo nome="cnpj" rotulo="CNPJ" valor={inst?.cnpj} />
          <Campo nome="mantenedora_razao_social" rotulo="Mantenedora" valor={inst?.mantenedora_razao_social} classe="largo" />
          <Campo nome="mantenedora_cnpj" rotulo="CNPJ da mantenedora" valor={inst?.mantenedora_cnpj} />
          <Campo nome="endereco" rotulo="Endereço" valor={inst?.endereco} />
          <Campo nome="bairro" rotulo="Bairro" valor={inst?.bairro} />
          <Campo nome="municipio" rotulo="Município" valor={inst?.municipio} />
          <Selecao nome="uf" rotulo="UF" valor={inst?.uf} opcoes={UFS} vazio="" />
          <Campo nome="cep" rotulo="CEP" valor={inst?.cep} />
          <Campo nome="telefone" rotulo="Telefone" valor={inst?.telefone} />
          <Campo nome="email" rotulo="E-mail" tipo="email" valor={inst?.email} />
          <Campo nome="site" rotulo="Site" valor={inst?.site} />
          <Campo nome="validade_credenciamento" rotulo="Validade do credenciamento" tipo="date" valor={inst?.validade_credenciamento} />
          <Campo nome="cor_principal" rotulo="Cor principal" tipo="color" valor={inst?.cor_principal} />
          <Campo nome="registros_por_folha" rotulo="Livro de registro: registros por folha" tipo="number" valor={inst?.registros_por_folha} obrigatorio extra={{ min: 1 }} />
          <Campo nome="folhas_por_livro" rotulo="Livro de registro: folhas por livro" tipo="number" valor={inst?.folhas_por_livro} obrigatorio extra={{ min: 1 }} />
          <label class="largo">Atos da instituição — impressos no cabeçalho dos documentos de todos os cursos
            <textarea name="texto_atos" rows={3} placeholder={'Criação: ata n. 01, de 23/02/2010.\nEducação Profissional Técnica de Nível Médio credenciamento: Deliberação CEE/MS n. 10994, de 06/02/2017.'}>{inst?.texto_atos ?? ''}</textarea>
            <span class="muted">Linhas fixas, iguais para todos os cursos. Logo abaixo delas saem as linhas do curso da turma
              (Cursos e Matrizes → Dados do curso → Autorização). O que for digitado sai exatamente assim, uma linha por linha.</span>
          </label>
          <div class="largo acoes"><button>Salvar dados</button></div>
        </form>
      </div>

      <div class="msg aviso" style="background:var(--superficie-2);color:var(--texto-2);border-color:var(--borda)">
        Logo, fundos da frente e do verso e assinaturas ficam em <a href="/admin/modelo">Modelo do certificado</a>.
      </div>

      <h2>Atos regulatórios</h2>
      <table>
        <tr><th>Referente a</th><th>Finalidade</th><th>Ato</th><th>Data</th><th>Órgão</th><th>Publicação</th><th></th></tr>
        {atos.map((a) => (
          <tr>
            <td>{a.curso ?? 'Instituição'}</td>
            <td>{rotuloFinalidade[a.finalidade]}</td>
            <td>{a.tipo} nº {a.numero}{a.processo ? <div class="muted">{a.processo}</div> : null}</td>
            <td>{dataBR(a.data)}</td>
            <td>{a.orgao_emissor}</td>
            <td><span class="tag ok">publicado</span>{a.publicacao_doe_numero && <div class="muted">DOE/MS nº {a.publicacao_doe_numero}{a.publicacao_doe_data ? `, ${dataBR(a.publicacao_doe_data)}` : ''}</div>}</td>
            <td><a href={`/admin/instituicao/atos/${a.id}`}>editar</a></td>
          </tr>
        ))}
      </table>
      <div class="acoes"><a class="botao sec" href="/admin/instituicao/atos/novo">+ Novo ato</a></div>
    </Pagina>,
  );
});

rotasInstituicao.post('/', async (c) => {
  const corpo = await lerCorpo(c);
  const antes = await c.env.DB.prepare('SELECT * FROM instituicoes WHERE id = 1').first<Record<string, unknown>>();
  const dados: Record<string, string | number | null> = Object.fromEntries(CAMPOS.map((k) => [k, texto(corpo, k)]));
  for (const k of ['registros_por_folha', 'folhas_por_livro']) {
    const n = Number(texto(corpo, k));
    if (!Number.isInteger(n) || n < 1) return c.redirect('/admin/instituicao?erro=' + encodeURIComponent('Registros por folha e folhas por livro devem ser inteiros positivos.'));
    dados[k] = n;
  }
  if (!dados.razao_social) return c.redirect('/admin/instituicao?erro=' + encodeURIComponent('Informe o nome da instituição.'));
  await c.env.DB.prepare(
    `UPDATE instituicoes SET ${CAMPOS.map((k) => `${k} = ?`).join(', ')}, registros_por_folha = ?, folhas_por_livro = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 1`,
  )
    .bind(...CAMPOS.map((k) => dados[k]), dados.registros_por_folha, dados.folhas_por_livro)
    .run();
  await auditar(c, 'atualizar', 'instituicao', 1, antes, dados);
  return c.redirect('/admin/instituicao?ok=' + encodeURIComponent('Dados da instituição salvos.'));
});

// ------------------------------ Atos ------------------------------
const CAMPOS_ATO = [
  'finalidade', 'tipo', 'numero', 'data', 'orgao_emissor', 'descricao', 'processo',
  'publicacao_doe_numero', 'publicacao_doe_data', 'veiculo_publicacao',
] as const;

const FormAto = async ({ c, ato, erro }: { c: any; ato?: Record<string, any>; erro?: string }) => {
  const cursos = (await c.env.DB.prepare('SELECT id, nome FROM cursos ORDER BY nome').all()).results as { id: number; nome: string }[];
  const cursoQuery = Number(c.req.query('curso')) || null;
  const dono = ato?.curso_id ? `curso:${ato.curso_id}` : cursoQuery ? `curso:${cursoQuery}` : 'instituicao:1';
  return (
    <Pagina titulo="Ato regulatório" usuario={c.get('usuario')} caminho={c.req.path} erro={erro}>
      <h1>{ato?.id ? 'Editar ato regulatório' : 'Novo ato regulatório'}</h1>
      <div class="cartao">
        <form method="post" class="grade">
          <Selecao nome="dono" rotulo="Referente a" valor={dono} obrigatorio
            opcoes={[['instituicao:1', 'Instituição'], ...cursos.map((cu) => [`curso:${cu.id}`, cu.nome] as [string, string])]} />
          <Selecao nome="finalidade" rotulo="Finalidade" valor={ato?.finalidade} opcoes={FINALIDADES} obrigatorio />
          <Selecao nome="tipo" rotulo="Tipo" valor={ato?.tipo} opcoes={TIPOS_ATO} obrigatorio />
          <Campo nome="numero" rotulo="Número" valor={ato?.numero} obrigatorio />
          <Campo nome="data" rotulo="Data" tipo="date" valor={ato?.data} obrigatorio />
          <Campo nome="orgao_emissor" rotulo="Órgão emissor" valor={ato?.orgao_emissor} obrigatorio classe="largo" />
          <Campo nome="descricao" rotulo="Descrição" valor={ato?.descricao} classe="largo" />
          <Campo nome="processo" rotulo="Processo" valor={ato?.processo} />
          <Campo nome="publicacao_doe_numero" rotulo="DOE/MS nº (opcional)" valor={ato?.publicacao_doe_numero} dica="Todo ato cadastrado é considerado publicado; informe o DOE só se quiser registrar." />
          <Campo nome="publicacao_doe_data" rotulo="Data da publicação (opcional)" tipo="date" valor={ato?.publicacao_doe_data} />
          <Campo nome="veiculo_publicacao" rotulo="Veículo" valor={ato?.veiculo_publicacao ?? 'DOE/MS'} />
          <div class="largo acoes"><button>Salvar</button><a class="botao sec" href={ato?.curso_id || cursoQuery ? `/admin/cursos/${ato?.curso_id ?? cursoQuery}#atos` : '/admin/instituicao'}>Cancelar</a></div>
        </form>
      </div>
    </Pagina>
  );
};

function lerAto(corpo: Awaited<ReturnType<typeof lerCorpo>>) {
  const d = Object.fromEntries(CAMPOS_ATO.map((k) => [k, texto(corpo, k)]));
  for (const k of ['finalidade', 'tipo', 'numero', 'data', 'orgao_emissor'] as const) {
    if (!d[k]) throw new ErroValidacao('Preencha finalidade, tipo, número, data e órgão emissor.');
  }
  const [tipoDono, idDono] = (texto(corpo, 'dono') ?? 'instituicao:1').split(':');
  return {
    ...d,
    instituicao_id: tipoDono === 'instituicao' ? Number(idDono) : null,
    curso_id: tipoDono === 'curso' ? Number(idDono) : null,
  };
}

rotasInstituicao.get('/atos/novo', async (c) => c.html(await FormAto({ c })));
rotasInstituicao.get('/atos/:id{[0-9]+}', async (c) => {
  const ato = await c.env.DB.prepare('SELECT * FROM atos_regulatorios WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!ato) return c.notFound();
  return c.html(await FormAto({ c, ato }));
});

rotasInstituicao.post('/atos/:id', async (c) => {
  if (!/^(novo|\d+)$/.test(c.req.param('id'))) return c.notFound();
  const corpo = await lerCorpo(c);
  const id = c.req.param('id');
  let d;
  try {
    d = lerAto(corpo);
  } catch (e) {
    return c.html(await FormAto({ c, erro: (e as Error).message }), 400);
  }
  const cols = [...CAMPOS_ATO, 'instituicao_id', 'curso_id'] as const;
  const valores = cols.map((k) => (d as Record<string, unknown>)[k] ?? null);
  if (id === 'novo') {
    const r = await c.env.DB.prepare(
      `INSERT INTO atos_regulatorios (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`,
    ).bind(...valores).first<{ id: number }>();
    await auditar(c, 'criar', 'ato_regulatorio', r!.id, null, d);
  } else {
    const antes = await c.env.DB.prepare('SELECT * FROM atos_regulatorios WHERE id = ?').bind(Number(id)).first();
    if (!antes) return c.notFound();
    await c.env.DB.prepare(`UPDATE atos_regulatorios SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .bind(...valores, Number(id))
      .run();
    await auditar(c, 'atualizar', 'ato_regulatorio', Number(id), antes, d);
  }
  if (d.curso_id) return c.redirect(`/admin/cursos/${d.curso_id}?ok=` + encodeURIComponent('Ato do curso salvo.') + '#atos');
  return c.redirect('/admin/instituicao?ok=' + encodeURIComponent('Ato regulatório salvo.'));
});
