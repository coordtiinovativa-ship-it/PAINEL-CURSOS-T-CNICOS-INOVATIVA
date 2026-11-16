/**
 * Importação de alunos (cadastro + matrícula opcional na turma). Duas etapas:
 * analisar (nada é gravado) → aplicar (em lote, atômico). Chave do aluno: CPF.
 */
import { CAMPOS_ALUNO, OBRIGATORIOS_ALUNO, type CampoAluno } from '../certificado/dados';
import { validarCPF, formatarCPF } from '../lib/cpf';
import { ErroValidacao } from '../lib/form';
import { chave, gerarCSV, normalizarCPF, normalizarData, normalizarUF, type Tabela } from './planilha';

/** Apelidos aceitos no cabeçalho (já normalizados por `chave`). */
const APELIDOS: Record<CampoAluno, string[]> = {
  nome_civil: ['nome_civil', 'nome', 'nome_completo', 'nome_do_aluno', 'nome_do_estudante', 'aluno', 'estudante', 'nome_de_registro'],
  nome_social: ['nome_social'],
  cpf: ['cpf', 'cpf_do_aluno', 'n_cpf', 'numero_do_cpf'],
  ra: ['ra', 'registro_academico', 'matricula', 'n_matricula', 'numero_de_matricula', 'codigo_do_aluno'],
  rg: ['rg', 'identidade', 'n_rg', 'numero_do_rg', 'documento_de_identidade'],
  rg_orgao_expedidor: ['rg_orgao_expedidor', 'orgao_expedidor', 'orgao_emissor', 'orgao_emissor_rg', 'orgao_expedidor_rg', 'emissor'],
  rg_uf: ['rg_uf', 'uf_rg', 'uf_do_rg', 'uf_expedidor', 'uf_emissor', 'uf_orgao_expedidor'],
  data_nascimento: ['data_nascimento', 'data_de_nascimento', 'nascimento', 'dt_nascimento', 'data_nasc', 'dt_nasc'],
  sexo: ['sexo', 'genero'],
  cor_raca: ['cor_raca', 'cor', 'raca', 'cor_ou_raca', 'raca_cor'],
  naturalidade_municipio: ['naturalidade_municipio', 'naturalidade', 'municipio_de_nascimento', 'cidade_natal', 'natural_de', 'cidade_de_nascimento'],
  naturalidade_uf: ['naturalidade_uf', 'uf_naturalidade', 'uf_de_nascimento', 'estado_de_nascimento', 'uf_natural'],
  nacionalidade: ['nacionalidade'],
  nome_pai: ['nome_pai', 'nome_do_pai', 'pai', 'filiacao_pai', 'filiacao_1'],
  nome_mae: ['nome_mae', 'nome_da_mae', 'mae', 'filiacao_mae', 'filiacao_2'],
  escolaridade: ['escolaridade', 'grau_de_instrucao', 'nivel_de_escolaridade'],
  ensino_medio_instituicao: ['ensino_medio_instituicao', 'escola_ensino_medio', 'instituicao_ensino_medio', 'escola_de_origem', 'escola_do_ensino_medio', 'instituicao_do_ensino_medio'],
  ensino_medio_municipio: ['ensino_medio_municipio', 'municipio_ensino_medio', 'cidade_ensino_medio', 'municipio_da_escola'],
  ensino_medio_uf: ['ensino_medio_uf', 'uf_ensino_medio', 'uf_da_escola'],
  ensino_medio_ano_conclusao: ['ensino_medio_ano_conclusao', 'ano_conclusao_ensino_medio', 'ano_de_conclusao', 'ano_conclusao', 'conclusao_ensino_medio', 'ano_de_conclusao_do_ensino_medio'],
  email: ['email', 'e_mail', 'correio_eletronico'],
  telefone: ['telefone', 'fone', 'telefone_fixo', 'telefone_residencial'],
  celular: ['celular', 'whatsapp', 'telefone_celular', 'cel'],
  usar_nome_social: ['usar_nome_social', 'usa_nome_social'],
  estado_civil: ['estado_civil'],
  necessidades_especificas: ['necessidades_especificas', 'necessidades_educacionais_especificas', 'necessidade_especial', 'deficiencia', 'nee'],
  rg_data_expedicao: ['rg_data_expedicao', 'data_expedicao', 'data_de_expedicao', 'data_expedicao_rg', 'expedicao_rg'],
  cep: ['cep'],
  endereco: ['endereco', 'logradouro', 'rua', 'endereco_residencial'],
  bairro: ['bairro'],
  complemento: ['complemento'],
  endereco_municipio: ['endereco_municipio', 'municipio', 'cidade', 'municipio_de_residencia', 'cidade_de_residencia'],
  endereco_uf: ['endereco_uf', 'uf', 'estado', 'uf_de_residencia'],
};

export const ROTULOS_MODELO: [CampoAluno, string][] = [
  ['nome_civil', 'Nome civil'], ['nome_social', 'Nome social'], ['cpf', 'CPF'], ['ra', 'RA'], ['rg', 'RG'],
  ['rg_orgao_expedidor', 'Órgão expedidor'], ['rg_uf', 'UF do RG'], ['data_nascimento', 'Data de nascimento'], ['sexo', 'Sexo'],
  ['cor_raca', 'Cor/raça'], ['nacionalidade', 'Nacionalidade'], ['naturalidade_municipio', 'Naturalidade (município)'],
  ['naturalidade_uf', 'Naturalidade (UF)'], ['nome_pai', 'Nome do pai'], ['nome_mae', 'Nome da mãe'], ['escolaridade', 'Escolaridade'],
  ['ensino_medio_instituicao', 'Ensino médio - instituição'], ['ensino_medio_municipio', 'Ensino médio - município'],
  ['ensino_medio_uf', 'Ensino médio - UF'], ['ensino_medio_ano_conclusao', 'Ensino médio - ano de conclusão'],
  ['email', 'E-mail'], ['telefone', 'Telefone'], ['celular', 'Celular'], ['estado_civil', 'Estado civil'],
  ['necessidades_especificas', 'Necessidades educacionais específicas'], ['rg_data_expedicao', 'Data de expedição do RG'],
  ['cep', 'CEP'], ['endereco', 'Endereço'], ['bairro', 'Bairro'], ['complemento', 'Complemento'],
  ['endereco_municipio', 'Município (residência)'], ['endereco_uf', 'UF (residência)'], ['usar_nome_social', 'Usar nome social'],
];

// cabeçalhos do próprio modelo também são reconhecidos
for (const [campo, rotulo] of ROTULOS_MODELO) if (!APELIDOS[campo].includes(chave(rotulo))) APELIDOS[campo].push(chave(rotulo));
const POR_APELIDO = new Map<string, CampoAluno>();
for (const [campo, lista] of Object.entries(APELIDOS) as [CampoAluno, string[]][]) for (const a of lista) POR_APELIDO.set(a, campo);

export function modeloAlunosCSV(): string {
  return gerarCSV([
    ROTULOS_MODELO.map(([, r]) => r),
    ['Maria Exemplo da Silva', '', '529.982.247-25', '2026010', '1234567', 'SEJUSP', 'MS', '15/01/2000', 'F', 'Parda', 'brasileira', 'Campo Grande', 'MS',
      'João Exemplo da Silva', 'Ana Exemplo da Silva', 'Ensino médio completo', 'Escola Estadual Exemplo', 'Campo Grande', 'MS', '2018', 'maria@exemplo.com', '(67) 3333-0000',
      '(67) 99999-0000', 'Solteiro(a)', '', '10/02/2015', '79010-310', 'Rua Exemplo, 100', 'Centro', 'Apto 1', 'Campo Grande', 'MS', 'não'],
  ]);
}

export type Modo = 'preencher' | 'sobrescrever';
type Dados = Partial<Record<CampoAluno, string | null>>;

export interface LinhaAluno {
  linha: number;
  nome: string;
  cpf: string | null;
  acao: 'novo' | 'atualizar' | 'sem_alteracao' | 'erro';
  erros: string[];
  faltantes: string[];
  mudancas: string[];
  matricular: boolean;
  dados: Dados;
  alunoId: number | null;
}

export interface AnaliseAlunos {
  linhas: LinhaAluno[];
  colunas: { reconhecidas: [string, CampoAluno][]; ignoradas: string[] };
  totais: Record<LinhaAluno['acao'] | 'matricular' | 'com_faltantes', number>;
}

function normalizarValor(campo: CampoAluno, bruto: string): string | null {
  const v = bruto.trim();
  if (!v) return null;
  switch (campo) {
    case 'cpf': return normalizarCPF(v);
    case 'data_nascimento': case 'rg_data_expedicao': return normalizarData(v);
    case 'usar_nome_social': {
      const s = chave(v);
      if (['1', 's', 'sim', 'x', 'verdadeiro', 'true'].includes(s)) return '1';
      if (['0', 'n', 'nao', 'falso', 'false'].includes(s)) return '0';
      throw new ErroValidacao(`valor inválido "${v}" (use sim ou não)`);
    }
    case 'cep': {
      const d = v.replace(/\.0+$/, '').replace(/\D/g, '').padStart(8, '0');
      if (d.length !== 8) throw new ErroValidacao(`CEP inválido "${v}"`);
      return `${d.slice(0, 5)}-${d.slice(5)}`;
    }
    case 'rg_uf': case 'naturalidade_uf': case 'ensino_medio_uf': case 'endereco_uf': {
      const uf = normalizarUF(v);
      if (!uf) throw new ErroValidacao(`UF inválida "${v}"`);
      return uf;
    }
    case 'sexo': {
      const s = chave(v);
      if (['f', 'fem', 'feminino'].includes(s)) return 'F';
      if (['m', 'masc', 'masculino'].includes(s)) return 'M';
      throw new ErroValidacao(`sexo inválido "${v}" (use F ou M)`);
    }
    case 'ensino_medio_ano_conclusao': {
      const ano = Number(v.replace(/\.0+$/, ''));
      if (!Number.isInteger(ano) || ano < 1950 || ano > new Date().getFullYear() + 1) throw new ErroValidacao(`ano de conclusão inválido "${v}"`);
      return String(ano);
    }
    case 'rg_orgao_expedidor': return v.toUpperCase();
    case 'rg': return v.replace(/\.0+$/, '');
    case 'email': return v.toLowerCase();
    default: return v.replace(/\s+/g, ' ');
  }
}

export async function analisarAlunos(db: D1Database, tabela: Tabela, opcoes: { turmaId: number | null; modo: Modo }): Promise<AnaliseAlunos> {
  if (tabela.length < 2) throw new ErroValidacao('A planilha está vazia ou só tem o cabeçalho.');
  const cab = tabela[0];
  const mapa: (CampoAluno | null)[] = cab.map((h) => POR_APELIDO.get(chave(h)) ?? null);
  const reconhecidas = cab.map((h, i) => [h, mapa[i]] as [string, CampoAluno | null]).filter((x): x is [string, CampoAluno] => !!x[1]);
  const ignoradas = cab.filter((_, i) => !mapa[i] && cab[i]);
  if (!mapa.includes('nome_civil') || !mapa.includes('cpf')) {
    throw new ErroValidacao('A planilha precisa ter ao menos as colunas de nome e CPF. Baixe o modelo para ver os cabeçalhos aceitos.');
  }
  const repetidas = reconhecidas.map((x) => x[1]).filter((c, i, arr) => arr.indexOf(c) !== i);
  if (repetidas.length) throw new ErroValidacao(`Colunas repetidas para o mesmo campo: ${[...new Set(repetidas)].join(', ')}.`);

  const existentes = new Map(
    (await db.prepare('SELECT * FROM alunos').all<Record<string, any>>()).results.map((a) => [a.cpf as string, a]),
  );
  const matriculados = new Set(
    opcoes.turmaId
      ? (await db.prepare('SELECT aluno_id FROM matriculas WHERE turma_id = ?').bind(opcoes.turmaId).all<{ aluno_id: number }>()).results.map((m) => m.aluno_id)
      : [],
  );

  const vistos = new Map<string, number>();
  const linhas: LinhaAluno[] = tabela.slice(1).map((bruta, i) => {
    const n = i + 2; // número da linha na planilha
    const erros: string[] = [];
    const dados: Dados = {};
    mapa.forEach((campo, col) => {
      if (!campo) return;
      try {
        dados[campo] = normalizarValor(campo, bruta[col] ?? '');
      } catch (e) {
        erros.push(`${ROTULOS_MODELO.find(([c]) => c === campo)![1]}: ${(e as Error).message}`);
      }
    });
    const cpf = dados.cpf ?? null;
    if (!dados.nome_civil) erros.push('Nome não informado');
    if (!cpf) erros.push('CPF não informado');
    else if (!validarCPF(cpf)) erros.push(`CPF inválido (${bruta[mapa.indexOf('cpf')]})`);
    else if (vistos.has(cpf)) erros.push(`CPF repetido na planilha (também na linha ${vistos.get(cpf)})`);
    if (cpf && !vistos.has(cpf)) vistos.set(cpf, n);

    const atual = cpf ? existentes.get(cpf) : undefined;
    const mudancas: string[] = [];
    let final: Dados = { ...dados };
    if (atual) {
      final = {};
      for (const [campo, valor] of Object.entries(dados) as [CampoAluno, string | null][]) {
        if (valor == null) continue;
        const antes = atual[campo] == null ? null : String(atual[campo]);
        if (antes === valor) continue;
        if (opcoes.modo === 'preencher' && antes != null && antes !== '') continue;
        final[campo] = valor;
        mudancas.push(`${ROTULOS_MODELO.find(([c]) => c === campo)![1]}: ${antes ?? '(vazio)'} → ${valor}`);
      }
    }
    const resultante = { ...(atual ?? {}), ...final } as Record<string, unknown>;
    if (!atual && resultante.nacionalidade == null) resultante.nacionalidade = 'brasileira'; // padrão do banco
    const faltantes = OBRIGATORIOS_ALUNO.filter(([k]) => resultante[k] == null || String(resultante[k]).trim() === '').map(([, r]) => r);
    const matricular = !!opcoes.turmaId && (!atual || !matriculados.has(atual.id));
    const acao: LinhaAluno['acao'] = erros.length ? 'erro' : !atual ? 'novo' : mudancas.length ? 'atualizar' : 'sem_alteracao';
    return {
      linha: n, nome: dados.nome_civil ?? atual?.nome_civil ?? '(sem nome)', cpf, acao, erros, faltantes, mudancas,
      matricular: matricular && !erros.length, dados: final, alunoId: atual?.id ?? null,
    };
  });

  const totais = { novo: 0, atualizar: 0, sem_alteracao: 0, erro: 0, matricular: 0, com_faltantes: 0 };
  for (const l of linhas) {
    totais[l.acao]++;
    if (l.matricular) totais.matricular++;
    if (l.acao !== 'erro' && l.faltantes.length) totais.com_faltantes++;
  }
  return { linhas, colunas: { reconhecidas, ignoradas }, totais };
}

/** Grava as linhas válidas em um único lote atômico. */
export async function aplicarAlunos(db: D1Database, analise: AnaliseAlunos, turmaId: number | null) {
  const cmds: D1PreparedStatement[] = [];
  for (const l of analise.linhas) {
    if (l.acao === 'erro') continue;
    const campos = (Object.keys(l.dados) as CampoAluno[]).filter((k) => CAMPOS_ALUNO.includes(k));
    if (l.acao === 'novo') {
      const preenchidos = campos.filter((k) => l.dados[k] != null); // vazios ficam com o padrão do banco
      cmds.push(db.prepare(`INSERT INTO alunos (${preenchidos.join(', ')}) VALUES (${preenchidos.map(() => '?').join(', ')})`).bind(...preenchidos.map((k) => l.dados[k])));
    } else if (l.acao === 'atualizar' && campos.length) {
      cmds.push(
        db.prepare(`UPDATE alunos SET ${campos.map((k) => `${k} = ?`).join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE cpf = ?`)
          .bind(...campos.map((k) => l.dados[k] ?? null), l.cpf),
      );
    }
    if (l.matricular && turmaId) {
      cmds.push(db.prepare('INSERT INTO matriculas (aluno_id, turma_id) SELECT id, ? FROM alunos WHERE cpf = ? ON CONFLICT DO NOTHING').bind(turmaId, l.cpf));
    }
  }
  if (cmds.length) await db.batch(cmds);
  return { comandos: cmds.length };
}

export function pendenciasAlunosCSV(analise: AnaliseAlunos): string {
  return gerarCSV([
    ['Linha', 'Nome', 'CPF', 'Situação', 'Erros', 'Campos faltantes para o certificado'],
    ...analise.linhas
      .filter((l) => l.erros.length || l.faltantes.length)
      .map((l) => [l.linha, l.nome, l.cpf && l.cpf.length === 11 ? formatarCPF(l.cpf) : l.cpf ?? '', l.acao, l.erros.join(' | '), l.faltantes.join(', ')]),
  ]);
}
