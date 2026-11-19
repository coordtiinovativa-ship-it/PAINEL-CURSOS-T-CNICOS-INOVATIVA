/**
 * Peças comuns dos documentos acadêmicos (modelos da pasta MODELOS DOCUMENTOS): identificação do estudante e do curso,
 * descrição do curso por extenso, assinaturas, local e data, registro de aproveitamento de estudos e o layout com o
 * cabeçalho da instituição. Usadas pelo histórico da qualificação (montar.ts) e pelos documentos da Secretaria.
 */
import { formatarCPF } from '../lib/cpf';
import { dataBR, dataExtenso } from '../lib/datas';
import { linhaEndereco, type Signatario } from '../certificado/dados';
import type { Bloco, DocumentoLayout } from './tipos';

export const LINHA = '______________________________';

const v = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim());

/** "a", "a e b", "a, b e c" */
export function juntarLista(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`;
}

/** "Curso Técnico em X – Eixo Tecnológico: Y – Área Tecnológica: Z – Educação Profissional Técnica de nível médio" (texto dos modelos). */
export function descricaoCurso(curso: Record<string, any>): string {
  return [
    curso.nome,
    v(curso.eixo) && `Eixo Tecnológico: ${curso.eixo}`,
    v(curso.area_tecnologica) && `Área Tecnológica: ${curso.area_tecnologica}`,
    v(curso.nivel),
  ].filter(Boolean).join(' – ');
}

/** "Técnico em Inovação ..." a partir de "Curso Técnico em Inovação ..." (título do perfil profissional). */
export const tituloProfissional = (nomeCurso: string) => nomeCurso.replace(/^Curso\s+/i, '');

export const rotuloSexo = (s: unknown) => (s === 'F' ? 'Feminino' : s === 'M' ? 'Masculino' : null);

/** Identificação do estudante, como nos modelos (nome, sexo, RG, nascimento, naturalidade, filiação, ID e RA). */
export function camposIdentificacao(a: Record<string, any>, nome: string, compacta = false): Bloco {
  const rg = v(a.rg) ? `${a.rg}${v(a.rg_orgao_expedidor) ? ` ${a.rg_orgao_expedidor}` : ''}${v(a.rg_uf) ? `-${a.rg_uf}` : ''}` : null;
  return {
    tipo: 'campos',
    itens: [
      { rotulo: 'Nome do estudante', valor: nome.toUpperCase(), span: 3 },
      { rotulo: 'Sexo', valor: rotuloSexo(a.sexo) },
      { rotulo: 'RG', valor: rg },
      { rotulo: 'Data de nascimento', valor: v(a.data_nascimento) ? dataBR(a.data_nascimento) : null },
      { rotulo: 'Local', valor: v(a.naturalidade_municipio) },
      { rotulo: 'UF', valor: v(a.naturalidade_uf) },
      { rotulo: 'Pai', valor: v(a.nome_pai), span: 2 },
      { rotulo: 'Mãe', valor: v(a.nome_mae), span: 2 },
      { rotulo: 'CPF', valor: v(a.cpf) ? formatarCPF(a.cpf) : null },
      { rotulo: 'ID do estudante', valor: a.id ? String(a.id) : null },
      { rotulo: 'Registro do estudante (RA)', valor: v(a.ra), span: 2 },
    ],
    compacta,
  };
}

/** Curso, eixo e área ("Resultado dos estudos realizados"). */
export function camposCurso(curso: Record<string, any>, compacta = false): Bloco {
  return {
    tipo: 'campos',
    itens: [
      { rotulo: 'Curso', valor: String(curso.nome).replace(/^Curso\s+/i, '').toUpperCase(), span: 2 },
      { rotulo: 'Eixo tecnológico', valor: v(curso.eixo)?.toUpperCase() ?? null },
      { rotulo: 'Área tecnológica', valor: v(curso.area_tecnologica)?.toUpperCase() ?? null },
    ],
    compacta,
  };
}

/** Diretor(a) Pedagógico(a) e Secretário(a), nesta ordem (modelos), com a assinatura digitalizada e a portaria de nomeação. */
export function assinaturasOficiais(diretor: Signatario | null, secretario: Signatario | null, comImagem = true): Bloco {
  const it = (s: Signatario | null, cargo: string) => ({
    legenda: s?.cargo ?? cargo, nome: s?.nome ?? null, assinatura_r2_key: comImagem ? s?.assinatura_r2_key ?? null : null, detalhe: s?.portaria ?? null,
  });
  return { tipo: 'assinaturas', itens: [it(diretor, 'Diretora Pedagógica'), it(secretario, 'Secretário(a)')] };
}

/** "Campo Grande/MS, 19 de novembro de 2026." — sem data: lacunas para preencher à mão. */
export function localEData(local: string, iso: string | null, alinhar: 'direita' | 'esquerda' = 'direita'): Bloco {
  let t = `${local}, ____ de ______________ de ______.`;
  try { if (iso) t = `${local}, ${dataExtenso(iso)}.`; } catch { /* data inválida: lacunas */ }
  return { tipo: 'paragrafo', texto: t, alinhar, tamanho: 10.5 };
}

/** Portarias de aproveitamento válidas do estudante no curso, para "Registro de Aproveitamento de Estudos". */
export async function registrosAproveitamento(db: D1Database, alunoId: number, cursoId: number): Promise<string[]> {
  const r = await db.prepare(
    `SELECT snapshot_json FROM documentos WHERE aluno_id = ? AND (curso_id = ? OR curso_id IS NULL) AND status = 'válido'
        AND tipo LIKE 'portaria_%' ORDER BY data_emissao, id`,
  ).bind(alunoId, cursoId).all<{ snapshot_json: string }>();
  return r.results.map((x) => (JSON.parse(x.snapshot_json).resumo?.registro as string | undefined) ?? '').filter(Boolean);
}

export function paragrafoAproveitamento(registros: string[]): Bloco {
  return {
    tipo: 'paragrafo', tamanho: 9.5, alinhar: 'esquerda', entrelinha: 1.35,
    texto: `Registro de Aproveitamento de Estudos: ${registros.length ? registros.join('; ') + '.' : 'não houve.'}`,
  };
}

/** Layout com o cabeçalho da instituição (logo, nome, endereço, atos) — igual em todos os documentos. */
export function layoutComCabecalho(
  instituicao: Record<string, any>,
  cabecalho: { credenciamento: string | null; atos: string[] },
  titulo: string,
  paginas: DocumentoLayout['paginas'],
  validacao: DocumentoLayout['validacao'],
  rodape?: string[],
): DocumentoLayout {
  return {
    versao: 1,
    titulo,
    instituicao: {
      nome: String(instituicao.razao_social).toUpperCase(),
      enderecoLinha: linhaEndereco(instituicao),
      credenciamento: cabecalho.credenciamento ?? '',
      atos: cabecalho.atos,
      logo_r2_key: instituicao.logo_r2_key ?? null,
    },
    paginas,
    validacao,
    ...(rodape ? { rodape } : {}),
  };
}
