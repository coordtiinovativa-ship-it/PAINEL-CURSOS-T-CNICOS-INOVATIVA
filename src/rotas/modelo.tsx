/**
 * Modelo do certificado: fundo da frente, fundo do verso, logo e assinaturas, com prévia ao vivo
 * (aluno fictício) em tela e em PDF. Imagens antigas ficam guardadas no R2 (histórico/auditoria).
 */
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { Icone, Pagina } from '../views/layout';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { arquivo, ErroValidacao, lerCorpo } from '../lib/form';
import { dimensoesImagem, salvarArquivo, TIPOS_IMAGEM, urlArquivo } from '../lib/arquivos';
import { montarDadosExemplo, NaoEncontrado } from '../certificado/dados';
import { DocumentoPrevia, imagensPadrao } from '../certificado/previa';
import { gerarPdfPrevia } from '../certificado/emissao';
import { TEXTO_DECLARACAO_PADRAO, VARIAVEIS_DECLARACAO } from '../documentos/montar';
import { variaveisDoModelo } from '../lib/modelo';

export const rotasModelo = new Hono<Env>();
rotasModelo.use('*', exigir('instituicao.editar'));

type TipoImagem = 'frente' | 'verso' | 'logo';
const IMAGENS: Record<TipoImagem, { coluna: string; titulo: string; dica: string; padrao: string; maxMB: number; a4: boolean }> = {
  frente: {
    coluna: 'fundo_r2_key', titulo: 'Fundo da frente', padrao: '/modelo/fundo.jpg', maxMB: 5, a4: true,
    dica: 'Imagem de página inteira, A4 paisagem (proporção 297 × 210, ex.: 3508 × 2480 px). Os textos são impressos por cima.',
  },
  verso: {
    coluna: 'fundo_verso_r2_key', titulo: 'Fundo do verso', padrao: '/modelo/fundo.jpg', maxMB: 5, a4: true,
    dica: 'Se não for enviado, o verso usa o mesmo fundo da frente.',
  },
  logo: {
    coluna: 'logo_r2_key', titulo: 'Logo do cabeçalho', padrao: '/modelo/logo.png', maxMB: 2, a4: false,
    dica: 'PNG com fundo transparente de preferência. Impresso centralizado com 6 cm de largura.',
  },
};
const FUNCOES = { diretor_pedagogico: 'Diretora Pedagógica', secretario: 'Secretário(a)' } as const;
type Funcao = keyof typeof FUNCOES;

const CSS_MODELO = `
.modelo-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem}
.modelo-card{background:var(--superficie);border:1px solid var(--borda);border-radius:12px;box-shadow:var(--sombra);overflow:hidden;display:flex;flex-direction:column}
.modelo-card .vista{background-color:var(--superficie-2);aspect-ratio:297/210;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--borda);
  background-image:linear-gradient(45deg,var(--xadrez) 25%,transparent 25%),linear-gradient(-45deg,var(--xadrez) 25%,transparent 25%),
  linear-gradient(45deg,transparent 75%,var(--xadrez) 75%),linear-gradient(-45deg,transparent 75%,var(--xadrez) 75%);
  background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
.modelo-card .vista img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.modelo-card .vista.pagina img{width:100%;height:100%;object-fit:fill}
.modelo-card .vista.assin{aspect-ratio:3/1}
.modelo-card .info{padding:.9rem 1rem 1rem;display:flex;flex-direction:column;gap:.55rem;flex:1}
.modelo-card h3{margin:0;font-size:1rem;color:var(--titulo);display:flex;justify-content:space-between;align-items:center;gap:.5rem}
.modelo-card form{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.modelo-card input[type=file]{flex:1 1 100%;min-width:0;width:100%}
.previa-quadro{width:100%;height:1480px;border:1px solid var(--borda);border-radius:12px;background:var(--superficie-2)}
`;

rotasModelo.get('/', async (c) => {
  const db = c.env.DB;
  const inst = await db.prepare('SELECT logo_r2_key, fundo_r2_key, fundo_verso_r2_key FROM instituicoes WHERE id = 1').first<Record<string, string | null>>();
  const sigs = (
    await db.prepare(`SELECT id, nome, cargo, funcao, assinatura_r2_key FROM signatarios WHERE ativo = 1 AND funcao IN ('diretor_pedagogico','secretario')`)
      .all<{ id: number; nome: string; cargo: string; funcao: Funcao; assinatura_r2_key: string | null }>()
  ).results;

  const decl = await db
    .prepare(`SELECT texto, criado_em FROM modelos_texto WHERE documento = 'declaracao_conclusao_modulo' AND ativo = 1 AND curso_id IS NULL ORDER BY id DESC LIMIT 1`)
    .first<{ texto: string; criado_em: string }>();

  const cartaoImagem = (tipo: TipoImagem) => {
    const cfg = IMAGENS[tipo];
    const chave = inst?.[cfg.coluna] ?? null;
    const herdado = tipo === 'verso' && !chave && inst?.fundo_r2_key;
    const src = urlArquivo(chave) ?? (herdado ? urlArquivo(inst!.fundo_r2_key)! : cfg.padrao);
    return (
      <div class="modelo-card">
        <div class={`vista ${cfg.a4 ? 'pagina' : ''}`}><img src={src} alt={cfg.titulo} /></div>
        <div class="info">
          <h3>
            {cfg.titulo}
            {chave ? <span class="tag ok">personalizado</span> : herdado ? <span class="tag">igual à frente</span> : <span class="tag">padrão do PPC</span>}
          </h3>
          <span class="muted">{cfg.dica}</span>
          <form method="post" action={`/admin/modelo/imagem/${tipo}`} enctype="multipart/form-data">
            <input type="file" name="arquivo" accept="image/png,image/jpeg" required />
            <button>Enviar</button>
          </form>
          {chave && (
            <form method="post" action={`/admin/modelo/imagem/${tipo}/restaurar`}
              onsubmit={`return confirm('Voltar ${cfg.titulo.toLowerCase()} para ${tipo === 'verso' ? 'o fundo da frente' : 'o padrão do PPC'}?')`}>
              <button class="sec">{tipo === 'verso' ? 'Usar o fundo da frente' : 'Restaurar padrão'}</button>
            </form>
          )}
        </div>
      </div>
    );
  };

  const cartaoAssinatura = (funcao: Funcao) => {
    const s = sigs.find((x) => x.funcao === funcao);
    const semNome = !s || s.nome.includes('A DEFINIR');
    return (
      <div class="modelo-card">
        <div class="vista assin">
          {s?.assinatura_r2_key ? <img src={urlArquivo(s.assinatura_r2_key)!} alt={`Assinatura — ${FUNCOES[funcao]}`} /> : <span class="muted">sem assinatura digitalizada</span>}
        </div>
        <div class="info">
          <h3>{FUNCOES[funcao]} {s?.assinatura_r2_key ? <span class="tag ok">enviada</span> : <span class="tag aviso">pendente</span>}</h3>
          <span class="muted">
            {semNome ? <b>Nome do signatário ainda não cadastrado.</b> : s!.nome} · PNG com fundo transparente, até 2 MB.
          </span>
          {s ? (
            <form method="post" action={`/admin/modelo/assinatura/${funcao}`} enctype="multipart/form-data">
              <input type="file" name="arquivo" accept="image/png,image/jpeg" required />
              <button>Enviar</button>
            </form>
          ) : null}
          <a href={s ? `/admin/signatarios/${s.id}` : '/admin/signatarios/novo'}>{s ? 'Editar nome, cargo e portaria' : 'Cadastrar signatário'}</a>
        </div>
      </div>
    );
  };

  return c.html(
    <Pagina titulo="Modelo do certificado" usuario={c.get('usuario')} caminho={c.req.path} ok={c.req.query('ok')} erro={c.req.query('erro')}>
      <style dangerouslySetInnerHTML={{ __html: CSS_MODELO }} />
      <h1>Modelo do certificado</h1>
      <p class="muted" style="margin-top:-.6rem">
        Envie o fundo da frente e do verso, o logo e as assinaturas. O texto aprovado no PPC é impresso por cima, nas mesmas posições.
        Certificados já emitidos não mudam: eles guardam as imagens usadas na emissão.
      </p>

      <h2>Páginas e logo</h2>
      <div class="modelo-grade">{cartaoImagem('frente')}{cartaoImagem('verso')}{cartaoImagem('logo')}</div>

      <h2>Assinaturas</h2>
      <div class="modelo-grade">{cartaoAssinatura('diretor_pedagogico')}{cartaoAssinatura('secretario')}</div>

      <h2>Texto da declaração de conclusão de módulo</h2>
      <div class="cartao">
        <p class="muted" style="margin-top:0">
          A declaração não tem modelo no PPC: este é o texto proposto, editável. Use as variáveis entre chaves; elas são
          preenchidas com os dados do aluno e do módulo. O texto aprovado da frente do certificado não é editável aqui.
        </p>
        <form method="post" action="/admin/modelo/texto-declaracao">
          <textarea name="texto" rows={8} style="width:100%" required>{decl?.texto ?? TEXTO_DECLARACAO_PADRAO}</textarea>
          <p class="muted">Variáveis: {VARIAVEIS_DECLARACAO.map((v, i) => <>{i ? ', ' : ''}<code>{`{${v}}`}</code></>)}</p>
          <div class="acoes">
            <button>Salvar texto</button>
            <button class="sec" name="restaurar" value="1" formnovalidate>Restaurar texto padrão</button>
          </div>
        </form>
      </div>

      <h2>Prévia com aluno fictício</h2>
      <div class="acoes">
        <a class="botao" href="/admin/modelo/previa.pdf" target="_blank"><Icone nome="certificados" />Abrir PDF de exemplo</a>
        <a class="botao sec" href="/admin/modelo/previa" target="_blank">Abrir prévia em tela cheia</a>
      </div>
      <iframe class="previa-quadro" src="/admin/modelo/previa" title="Prévia do certificado" />
    </Pagina>,
  );
});

const voltar = (c: any, tipo: 'ok' | 'erro', msg: string) => c.redirect(`/admin/modelo?${tipo}=` + encodeURIComponent(msg));

rotasModelo.post('/imagem/:tipo/restaurar', async (c) => {
  const tipo = c.req.param('tipo') as TipoImagem;
  if (!(tipo in IMAGENS)) return c.notFound();
  const cfg = IMAGENS[tipo];
  const antes = await c.env.DB.prepare(`SELECT ${cfg.coluna} AS chave FROM instituicoes WHERE id = 1`).first<{ chave: string | null }>();
  await c.env.DB.prepare(`UPDATE instituicoes SET ${cfg.coluna} = NULL, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 1`).run();
  await auditar(c, 'restaurar_modelo', 'instituicao', 1, { [cfg.coluna]: antes?.chave ?? null }, { [cfg.coluna]: null });
  return voltar(c, 'ok', `${cfg.titulo}: ${tipo === 'verso' ? 'passa a usar o fundo da frente' : 'padrão do PPC restaurado'}.`);
});

rotasModelo.post('/imagem/:tipo', async (c) => {
  const tipo = c.req.param('tipo') as TipoImagem;
  if (!(tipo in IMAGENS)) return c.notFound();
  const cfg = IMAGENS[tipo];
  const arq = arquivo(await lerCorpo(c), 'arquivo');
  if (!arq) return voltar(c, 'erro', 'Selecione um arquivo.');
  let chave: string;
  try {
    chave = await salvarArquivo(c.env.ARQUIVOS, `modelo/${tipo}`, arq, TIPOS_IMAGEM, cfg.maxMB, cfg.titulo);
  } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, 'erro', e.message);
    throw e;
  }
  const antes = await c.env.DB.prepare(`SELECT ${cfg.coluna} AS chave FROM instituicoes WHERE id = 1`).first<{ chave: string | null }>();
  await c.env.DB.prepare(`UPDATE instituicoes SET ${cfg.coluna} = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 1`).bind(chave).run();
  const dim = dimensoesImagem(new Uint8Array(await arq.arrayBuffer()));
  await auditar(c, 'enviar_modelo', 'instituicao', 1, { [cfg.coluna]: antes?.chave ?? null }, { [cfg.coluna]: chave, arquivo: arq.name, dimensoes: dim });

  let msg = `${cfg.titulo} atualizado.`;
  if (cfg.a4 && dim) {
    const prop = dim.largura / dim.altura;
    if (Math.abs(prop - 297 / 210) > 0.03) {
      msg += ` Atenção: a imagem tem ${dim.largura} × ${dim.altura} px; o ideal é proporção A4 paisagem (297 × 210). Ela será esticada para preencher a página.`;
    } else if (dim.largura < 2000) {
      msg += ` Atenção: ${dim.largura} × ${dim.altura} px pode ficar com baixa nitidez na impressão (ideal: 3508 × 2480 px).`;
    }
  }
  return voltar(c, 'ok', msg);
});

rotasModelo.post('/assinatura/:funcao', exigir('signatarios.editar'), async (c) => {
  const funcao = c.req.param('funcao') as Funcao;
  if (!(funcao in FUNCOES)) return c.notFound();
  const s = await c.env.DB.prepare('SELECT id, assinatura_r2_key FROM signatarios WHERE ativo = 1 AND funcao = ?').bind(funcao).first<{ id: number; assinatura_r2_key: string | null }>();
  if (!s) return voltar(c, 'erro', `Cadastre primeiro o signatário (${FUNCOES[funcao]}).`);
  const arq = arquivo(await lerCorpo(c), 'arquivo');
  if (!arq) return voltar(c, 'erro', 'Selecione um arquivo.');
  let chave: string;
  try {
    chave = await salvarArquivo(c.env.ARQUIVOS, 'assinaturas', arq, TIPOS_IMAGEM, 2, 'Assinatura');
  } catch (e) {
    if (e instanceof ErroValidacao) return voltar(c, 'erro', e.message);
    throw e;
  }
  await c.env.DB.prepare(`UPDATE signatarios SET assinatura_r2_key = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).bind(chave, s.id).run();
  await auditar(c, 'enviar_assinatura', 'signatario', s.id, { assinatura_r2_key: s.assinatura_r2_key }, { assinatura_r2_key: chave, arquivo: arq.name });
  return voltar(c, 'ok', `Assinatura (${FUNCOES[funcao]}) atualizada.`);
});

rotasModelo.post('/texto-declaracao', async (c) => {
  const corpo = await lerCorpo(c);
  const restaurar = corpo.restaurar === '1';
  const texto = restaurar ? TEXTO_DECLARACAO_PADRAO : String(corpo.texto ?? '').replace(/\r\n/g, '\n').trim();
  if (texto.length < 40) return voltar(c, 'erro', 'Texto da declaração muito curto.');
  const desconhecidas = variaveisDoModelo(texto).filter((v) => !VARIAVEIS_DECLARACAO.includes(v));
  if (desconhecidas.length) return voltar(c, 'erro', `Variáveis desconhecidas no texto: ${desconhecidas.map((v) => `{${v}}`).join(', ')}.`);
  if (/\{[^}]*$|^[^{]*\}/.test(texto)) return voltar(c, 'erro', 'Há chaves { } abertas ou fechadas sem par no texto.');
  const db = c.env.DB;
  const atual = await db.prepare(`SELECT id, texto FROM modelos_texto WHERE documento = 'declaracao_conclusao_modulo' AND ativo = 1 AND curso_id IS NULL ORDER BY id DESC LIMIT 1`).first<{ id: number; texto: string }>();
  if (atual?.texto === texto) return voltar(c, 'ok', 'Texto da declaração sem alterações.');
  // nova versão; a anterior fica guardada (inativa) para histórico
  await db.batch([
    db.prepare(`UPDATE modelos_texto SET ativo = 0 WHERE documento = 'declaracao_conclusao_modulo' AND curso_id IS NULL`),
    db.prepare(`INSERT INTO modelos_texto (documento, curso_id, texto) VALUES ('declaracao_conclusao_modulo', NULL, ?)`).bind(texto),
  ]);
  await auditar(c, restaurar ? 'restaurar_texto' : 'atualizar_texto', 'modelo_texto', atual?.id ?? null, { texto: atual?.texto ?? null }, { texto });
  return voltar(c, 'ok', restaurar ? 'Texto padrão da declaração restaurado.' : 'Texto da declaração salvo.');
});

rotasModelo.get('/previa', async (c) => {
  try {
    const d = await montarDadosExemplo(c.env.DB);
    return c.html('<!doctype html>' + (<DocumentoPrevia d={d} tema={c.get('usuario').tema} img={imagensPadrao(d, urlArquivo)} />));
  } catch (e) {
    if (e instanceof NaoEncontrado) return c.text(e.message, 404);
    throw e;
  }
});

rotasModelo.get('/previa.pdf', async (c) => {
  try {
    const d = await montarDadosExemplo(c.env.DB);
    const pdf = await gerarPdfPrevia(c.env, d, {
      registroNumero: '0000', folha: '000', livro: '00', dataRegistro: d.dataEmissao, sistecCodigo: '000000000', sistecData: d.dataEmissao,
    });
    return new Response(pdf, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="modelo-exemplo.pdf"', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    if (e instanceof NaoEncontrado) return c.text(e.message, 404);
    throw e;
  }
});
