import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Campo, Pagina, Selecao } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { arquivo, ErroValidacao, lerCorpo, marcado, texto } from '../lib/form';
import { salvarArquivo, TIPOS_IMAGEM, TIPOS_PDF, urlArquivo } from '../lib/arquivos';
import { dataBR } from '../lib/datas';

export const rotasSignatarios = new Hono<Env>();
rotasSignatarios.use('*', exigir('signatarios.editar'));

export const FUNCOES: [string, string][] = [
  ['diretor_pedagogico', 'Diretor(a) Pedagógico(a)'],
  ['secretario', 'Secretário(a) Escolar'],
  ['diretor_geral', 'Diretor(a) Geral'],
  ['outro', 'Outro'],
];
const rotuloFuncao = Object.fromEntries(FUNCOES);

interface Signatario {
  id: number;
  nome: string;
  cargo: string;
  funcao: string;
  assinatura_r2_key: string | null;
  portaria_tipo: string | null;
  portaria_numero: string | null;
  portaria_data: string | null;
  portaria_orgao: string | null;
  portaria_r2_key: string | null;
  ativo: number;
}

rotasSignatarios.get('/', async (c) => {
  const lista = (await c.env.DB.prepare('SELECT * FROM signatarios ORDER BY ativo DESC, funcao, nome').all<Signatario>()).results;
  return c.html(
    <Pagina titulo="Signatários" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')}>
      <h1>Signatários</h1>
      <p class="muted">
        Os signatários ativos com função <b>Diretor(a) Pedagógico(a)</b> e <b>Secretário(a)</b> assinam os certificados.
        Só pode haver um ativo por função; para trocar, desative o anterior.
      </p>
      <table>
        <tr><th>Nome</th><th>Cargo impresso</th><th>Função</th><th>Assinatura</th><th>Portaria de nomeação</th><th>Situação</th><th></th></tr>
        {lista.map((s) => (
          <tr>
            <td>{s.nome}</td>
            <td>{s.cargo}</td>
            <td>{rotuloFuncao[s.funcao]}</td>
            <td>{s.assinatura_r2_key ? <img class="thumb" src={urlArquivo(s.assinatura_r2_key)!} alt="assinatura" /> : <span class="tag aviso">não enviada</span>}</td>
            <td>
              {s.portaria_numero
                ? `${s.portaria_tipo ?? 'Portaria'} nº ${s.portaria_numero}${s.portaria_data ? `, ${dataBR(s.portaria_data)}` : ''}`
                : <span class="tag aviso">não informada</span>}
              {s.portaria_r2_key && <> · <a href={urlArquivo(s.portaria_r2_key)!} target="_blank">PDF</a></>}
            </td>
            <td>{s.ativo ? <span class="tag ok">ativo</span> : <span class="tag">inativo</span>}</td>
            <td><a href={`/admin/signatarios/${s.id}`}>editar</a></td>
          </tr>
        ))}
      </table>
      <div class="acoes"><a class="botao" href="/admin/signatarios/novo">+ Novo signatário</a></div>
    </Pagina>,
  );
});

const FormSignatario = ({ c, s, erro }: { c: any; s?: Partial<Signatario>; erro?: string }) => (
  <Pagina titulo="Signatário" usuario={c.get('usuario')} caminho={c.req.path} erro={erro}>
    <h1>{s?.id ? `Editar signatário: ${s.nome}` : 'Novo signatário'}</h1>
    <div class="cartao">
      <form method="post" enctype="multipart/form-data" class="grade">
        <Campo nome="nome" rotulo="Nome completo" valor={s?.nome} obrigatorio classe="largo" />
        <Campo nome="cargo" rotulo="Cargo impresso no documento" valor={s?.cargo} obrigatorio dica="Ex.: Diretora Pedagógica" />
        <Selecao nome="funcao" rotulo="Função no certificado" valor={s?.funcao} opcoes={FUNCOES} obrigatorio />
        <label class="check"><input type="checkbox" name="ativo" value="1" checked={s?.ativo !== 0} /> Ativo</label>

        <h2 class="largo">Assinatura digitalizada</h2>
        <label class="largo">
          Imagem da assinatura (PNG com fundo transparente de preferência, até 2 MB)
          {s?.assinatura_r2_key && <img class="thumb" src={urlArquivo(s.assinatura_r2_key)!} alt="assinatura atual" />}
          <input type="file" name="assinatura" accept="image/png,image/jpeg" />
        </label>

        <h2 class="largo">Portaria de nomeação</h2>
        <Campo nome="portaria_tipo" rotulo="Tipo do ato" valor={s?.portaria_tipo ?? 'Portaria'} />
        <Campo nome="portaria_numero" rotulo="Número" valor={s?.portaria_numero} />
        <Campo nome="portaria_data" rotulo="Data" tipo="date" valor={s?.portaria_data} />
        <Campo nome="portaria_orgao" rotulo="Órgão / emitente" valor={s?.portaria_orgao} />
        <label class="largo">
          Arquivo da portaria (PDF, até 10 MB)
          {s?.portaria_r2_key && <a href={urlArquivo(s.portaria_r2_key)!} target="_blank">ver PDF atual</a>}
          <input type="file" name="portaria" accept="application/pdf" />
        </label>
        <div class="largo acoes"><button>Salvar</button><a class="botao sec" href="/admin/signatarios">Cancelar</a></div>
      </form>
    </div>
  </Pagina>
);

rotasSignatarios.get('/novo', (c) => c.html(<FormSignatario c={c} />));
rotasSignatarios.get('/:id{[0-9]+}', async (c) => {
  const s = await c.env.DB.prepare('SELECT * FROM signatarios WHERE id = ?').bind(Number(c.req.param('id'))).first<Signatario>();
  if (!s) return c.notFound();
  return c.html(<FormSignatario c={c} s={s} />);
});

rotasSignatarios.post('/:id', async (c) => {
  if (!/^(novo|\d+)$/.test(c.req.param('id'))) return c.notFound();
  const corpo = await lerCorpo(c);
  const id = c.req.param('id');
  const db = c.env.DB;
  const antes = id === 'novo' ? null : await db.prepare('SELECT * FROM signatarios WHERE id = ?').bind(Number(id)).first<Signatario>();
  if (id !== 'novo' && !antes) return c.notFound();

  const d: Record<string, string | number | null> = {
    nome: texto(corpo, 'nome'),
    cargo: texto(corpo, 'cargo'),
    funcao: texto(corpo, 'funcao') ?? 'outro',
    ativo: marcado(corpo, 'ativo'),
    portaria_tipo: texto(corpo, 'portaria_tipo'),
    portaria_numero: texto(corpo, 'portaria_numero'),
    portaria_data: texto(corpo, 'portaria_data'),
    portaria_orgao: texto(corpo, 'portaria_orgao'),
  };
  try {
    if (!d.nome || !d.cargo) throw new ErroValidacao('Informe nome e cargo.');
    if (!FUNCOES.some(([f]) => f === d.funcao)) throw new ErroValidacao('Função inválida.');
    if (d.ativo && d.funcao !== 'outro') {
      const outro = await db
        .prepare('SELECT nome FROM signatarios WHERE funcao = ? AND ativo = 1 AND id <> ?')
        .bind(d.funcao, antes?.id ?? 0)
        .first<{ nome: string }>();
      if (outro) throw new ErroValidacao(`Já existe signatário ativo nesta função (${outro.nome}). Desative-o antes.`);
    }
    const ass = arquivo(corpo, 'assinatura');
    const port = arquivo(corpo, 'portaria');
    if (ass) d.assinatura_r2_key = await salvarArquivo(c.env.ARQUIVOS, 'assinaturas', ass, TIPOS_IMAGEM, 2, 'Assinatura');
    if (port) d.portaria_r2_key = await salvarArquivo(c.env.ARQUIVOS, 'portarias', port, TIPOS_PDF, 10, 'Portaria');
  } catch (e) {
    if (e instanceof ErroValidacao) return c.html(<FormSignatario c={c} s={{ ...antes, ...(d as any) }} erro={e.message} />, 400);
    throw e;
  }
  const cols = Object.keys(d);
  if (id === 'novo') {
    const r = await db
      .prepare(`INSERT INTO signatarios (instituicao_id, ${cols.join(', ')}) VALUES (1, ${cols.map(() => '?').join(', ')}) RETURNING id`)
      .bind(...cols.map((k) => d[k]))
      .first<{ id: number }>();
    await auditar(c, 'criar', 'signatario', r!.id, null, d);
  } else {
    await db
      .prepare(`UPDATE signatarios SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(...cols.map((k) => d[k]), Number(id))
      .run();
    await auditar(c, 'atualizar', 'signatario', Number(id), antes, d);
  }
  return c.redirect('/admin/signatarios?ok=' + encodeURIComponent('Signatário salvo.'));
});
