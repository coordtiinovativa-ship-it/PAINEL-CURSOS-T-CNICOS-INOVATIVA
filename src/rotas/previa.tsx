import { Hono } from 'hono';
import type { Env } from '../tipos';
import { exigir } from '../auth/sessao';
import { auditar } from '../lib/auditoria';
import { lerCorpo } from '../lib/form';
import { urlArquivo } from '../lib/arquivos';
import { montarDadosCertificado, NaoEncontrado, type DadosCertificado } from '../certificado/dados';
import { DocumentoPrevia, imagensPadrao } from '../certificado/previa';
import { lerAluno } from './alunos';
import { gerarPdfPrevia } from '../certificado/emissao';
import { pode } from '../auth/permissoes';

export const rotasPrevia = new Hono<Env>();
rotasPrevia.use('*', exigir('relatorios.emitir'));

const BARRA_CSS = `
.barra{font-family:system-ui,sans-serif;font-size:14px;background:#1F3A5F;color:#fff;padding:.6rem 1rem;position:sticky;top:0;z-index:5;display:flex;gap:1rem;flex-wrap:wrap;align-items:center}
.barra a{color:#fff}.barra select,.barra button{font:inherit;padding:.25rem .5rem;border-radius:5px;border:0}
.barra .st{padding:.1rem .5rem;border-radius:99px;font-weight:600}.st.ok{background:#d3f3df;color:#17703a}.st.erro{background:#fde2df;color:#b42318}
.pend{font-family:system-ui,sans-serif;font-size:13px;max-width:297mm;margin:8px auto 0;background:#fff;border:1px solid #f1d78a;border-radius:8px;padding:.5rem 1rem}
.pend ul{margin:.2rem 0 .4rem 1rem;padding:0}.pend .e{color:#b42318}.pend .a{color:#9a6700}`;

const Barra = ({ d, outros, podeEmitir }: { d: DadosCertificado; outros: { modulo_id: number; rotulo: string }[]; podeEmitir: boolean }) => {
  const apto = d.faltantes.length === 0;
  return (
    <div class="nao-imprimir">
      <style dangerouslySetInnerHTML={{ __html: BARRA_CSS }} />
      <div class="barra">
        <a href={`/admin/turmas/${d.turma.turma_id}/modulos/${d.modulo.id}`}>← Turma {d.turma.turma_codigo}</a>
        <b>{d.nomeExibido}</b>
        <select onchange={`location.href='/admin/previa/${d.matriculaId}/'+this.value`}>
          {outros.map((o) => <option value={o.modulo_id} selected={o.modulo_id === d.modulo.id}>{o.rotulo}</option>)}
        </select>
        <span class={`st ${apto ? 'ok' : 'erro'}`}>{apto ? 'Apto para emissão' : `${d.faltantes.length} pendência(s)`}</span>
        <a href={`/admin/alunos/${d.aluno.id}`}>editar dados do aluno</a>
        <a href={`/admin/previa/${d.matriculaId}/${d.modulo.id}/pdf`} target="_blank">PDF da prévia</a>
        {podeEmitir && apto && <a href={`/admin/certificados/emitir/${d.matriculaId}/${d.modulo.id}`}><b>Emitir certificado →</b></a>}
        <button onclick="print()">Imprimir prévia</button>
        <span style="opacity:.8">PRÉVIA — sem validade</span>
      </div>
      {(d.faltantes.length > 0 || d.avisos.length > 0) && (
        <div class="pend">
          {d.faltantes.length > 0 && (<><b class="e">Impedem a emissão:</b><ul>{d.faltantes.map((f) => <li class="e">{f}</li>)}</ul></>)}
          {d.avaliacao.motivos.length > 0 && (<><b class="e">Aprovação no módulo:</b><ul>{d.avaliacao.motivos.map((f) => <li class="e">{f}</li>)}</ul></>)}
          {d.avisos.length > 0 && (<><b class="a">Conferir:</b><ul>{d.avisos.map((f) => <li class="a">{f}</li>)}</ul></>)}
        </div>
      )}
    </div>
  );
};

function ids(c: any) {
  return { mat: Number(c.req.param('mat')), mod: Number(c.req.param('mod')) };
}

rotasPrevia.get('/:mat{[0-9]+}/:mod{[0-9]+}', async (c) => {
  const { mat, mod } = ids(c);
  let d: DadosCertificado;
  try {
    d = await montarDadosCertificado(c.env.DB, mat, mod);
  } catch (e) {
    if (e instanceof NaoEncontrado) return c.notFound();
    throw e;
  }
  const outros = (
    await c.env.DB.prepare(
      `SELECT id AS modulo_id, 'Módulo ' || ordem || ': ' || nome AS rotulo FROM modulos_tematicos
        WHERE matriz_id = (SELECT t.matriz_id FROM matriculas m JOIN turmas t ON t.id = m.turma_id WHERE m.id = ?) ORDER BY ordem`,
    ).bind(mat).all<{ modulo_id: number; rotulo: string }>()
  ).results;
  await auditar(c, 'visualizar_previa', 'matricula', mat, null, { modulo_id: mod, aluno: d.nomeExibido, apto: d.faltantes.length === 0 });
  return c.html('<!doctype html>' + (<DocumentoPrevia d={d} tema={c.get('usuario').tema} img={imagensPadrao(d, urlArquivo)} barra={<Barra d={d} outros={outros} podeEmitir={pode(c.get('usuario').perfil, 'certificados.emitir')} />} />));
});

/** Prévia com os dados do formulário de aluno ainda não salvos (edição ao vivo). */
rotasPrevia.post('/:mat{[0-9]+}/:mod{[0-9]+}/rascunho', exigir('alunos.editar'), async (c) => {
  const { mat, mod } = ids(c);
  const corpo = await lerCorpo(c);
  try {
    const d = await montarDadosCertificado(c.env.DB, mat, mod, lerAluno(corpo, true));
    return c.html('<!doctype html>' + (<DocumentoPrevia d={d} tema={c.get('usuario').tema} img={imagensPadrao(d, urlArquivo)} />));
  } catch (e) {
    if (e instanceof NaoEncontrado) return c.notFound();
    throw e;
  }
});

/** PDF de prévia (marca d'água, sem QR). Aceita os dados de registro/SISTEC pela query para conferência. */
rotasPrevia.get('/:mat{[0-9]+}/:mod{[0-9]+}/pdf', async (c) => {
  const { mat, mod } = ids(c);
  const q = c.req.query();
  const v = (k: string) => (q[k] && q[k].trim() ? q[k].trim() : null);
  try {
    const d = await montarDadosCertificado(c.env.DB, mat, mod);
    const pdf = await gerarPdfPrevia(c.env, d, {
      dataEmissao: v('data_emissao') ?? undefined,
      registroNumero: v('registro_numero'), folha: v('folha'), livro: v('livro'), dataRegistro: v('data_registro'),
      sistecCodigo: v('sistec_codigo'), sistecData: v('sistec_data'),
    });
    await auditar(c, 'visualizar_previa_pdf', 'matricula', mat, null, { modulo_id: mod, aluno: d.nomeExibido });
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="previa-${mat}-${mod}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof NaoEncontrado) return c.notFound();
    throw e;
  }
});
