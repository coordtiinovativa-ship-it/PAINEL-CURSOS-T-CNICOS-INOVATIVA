import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { criarAmbiente } from './ambiente';
import { decodificarTexto, lerCSV, lerPlanilha, normalizarCPF, normalizarData, normalizarNumero, normalizarUF } from '../src/importacao/planilha';

/** Codifica texto em Windows-1252 (como o Excel brasileiro salva CSV). */
function cp1252(s: string): Uint8Array {
  return new Uint8Array([...s].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c < 256) return c;
    throw new Error('caractere fora do cp1252 no teste');
  }));
}

/** XLSX mínimo e válido (workbook, rels, sharedStrings, uma aba) com células texto, número e inlineStr. */
function xlsx(linhas: (string | number)[][]): Uint8Array {
  const compart: string[] = [];
  const idx = (s: string) => (compart.includes(s) ? compart.indexOf(s) : compart.push(s) - 1);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const col = (i: number) => String.fromCharCode(65 + i);
  const rows = linhas.map((l, r) =>
    `<row r="${r + 1}">${l.map((v, i) =>
      typeof v === 'number' ? `<c r="${col(i)}${r + 1}"><v>${v}</v></c>`
        : i === 1 && r > 0 ? `<c r="${col(i)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
          : `<c r="${col(i)}${r + 1}" t="s"><v>${idx(v)}</v></c>`).join('')}</row>`).join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Alunos" sheetId="1" r:id="rId7"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId7" Type="ws" Target="worksheets/planilha.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${compart.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`),
    'xl/worksheets/planilha.xml': strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
  });
}

describe('leitura de planilhas', () => {
  it('CSV com ; aspas e quebra de linha dentro de campo', () => {
    expect(lerCSV('a;b;c\r\n"x;1";"di""z";"li\nnha"\n')).toEqual([['a', 'b', 'c'], ['x;1', 'di"z', 'li\nnha']]);
    expect(lerCSV('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('decodifica UTF-8 com BOM e Windows-1252', () => {
    expect(decodificarTexto(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Mãe')]))).toBe('Mãe');
    expect(decodificarTexto(cp1252('Órgão Expedidor;Mãe'))).toBe('Órgão Expedidor;Mãe');
  });
  it('lê XLSX (texto compartilhado, inlineStr e número) a partir da aba indicada no workbook', () => {
    const t = lerPlanilha(xlsx([['Nome', 'CPF', 'Nascimento'], ['Zé & Cia', '52998224725', 36600]]));
    expect(t).toEqual([['Nome', 'CPF', 'Nascimento'], ['Zé & Cia', '52998224725', '36600']]);
  });
  it('normaliza datas, CPF, UF e números do Excel', () => {
    expect(normalizarData('14/03/1998')).toBe('1998-03-14');
    expect(normalizarData('1/2/05')).toBe('2005-02-01');
    expect(normalizarData('2025-01-01')).toBe('2025-01-01');
    expect(normalizarData('45658')).toBe('2025-01-01'); // série do Excel
    expect(() => normalizarData('31/02/2020')).toThrow(/inexistente/);
    expect(normalizarCPF('1122233396')).toBe('01122233396'); // zero à esquerda perdido no Excel
    expect(normalizarCPF('111.222.333-96')).toBe('11122233396');
    expect(normalizarUF('Mato Grosso do Sul')).toBe('MS');
    expect(normalizarUF('ms')).toBe('MS');
    expect(normalizarNumero('7,5', 'x')).toBe(7.5);
    expect(normalizarNumero('95%', 'x')).toBe(95);
    expect(() => normalizarNumero('abc', 'x')).toThrow();
  });
});

async function ambiente(perfil = 'secretaria') {
  const amb = await criarAmbiente({ ficticios: true });
  await amb.criarUsuario('u@iect.test', perfil);
  const c = amb.cliente();
  await c.entrar('u@iect.test');
  const enviar = (rota: string, bytes: Uint8Array, nome: string, campos: Record<string, string>) => {
    const fd = new FormData();
    fd.set('arquivo', new File([bytes], nome));
    for (const [k, v] of Object.entries(campos)) fd.set(k, v);
    return c.req(rota, { method: 'POST', body: fd });
  };
  return { ...amb, c, enviar };
}
const idDe = (r: Response) => Number(/\/admin\/importacao\/(\d+)/.exec(r.headers.get('Location') ?? '')?.[1]);

describe('importação de alunos', () => {
  const CSV_ALUNOS = [
    'Nome do Aluno;CPF;Data de Nascimento;Nome da Mãe;Órgão Expedidor;UF do RG;Naturalidade;Estado de nascimento;Coluna estranha',
    'Carla Nova Exemplo;529.982.247-25;05/06/2001;Mãe da Carla;sejusp;MS;Corumbá;Mato Grosso do Sul;x',
    'Ana Beatriz Fictícia Souza;111.222.333-96;14/03/1998;Outra Mãe;;;;;',
    'Pessoa Errada;123.456.789-00;01/01/2000;;;;;;',
    'Repetida;52998224725;;;;;;;',
  ].join('\r\n');

  it('conferência não grava nada; aplicar cria, completa e matricula', async () => {
    const { sqlite, enviar, c, auditoria } = await ambiente();
    const r = await enviar('/admin/importacao/alunos', cp1252(CSV_ALUNOS), 'alunos.csv', { turma_id: '1', modo: 'preencher' });
    const id = idDe(r);
    expect(id).toBeGreaterThan(0);
    expect((sqlite.prepare('SELECT count(*) AS n FROM alunos').get() as any).n).toBe(3); // nada gravado ainda

    const html = await (await c.req(`/admin/importacao/${id}`)).text();
    expect(html).toContain('Carla Nova Exemplo');
    expect(html).toMatch(/CPF inválido/);
    expect(html).toContain('CPF repetido na planilha (também na linha 2)');
    expect(html).toContain('Ignoradas:</b> Coluna estranha');
    expect(html).toContain('Faltam para o certificado'); // Carla sem RG, ensino médio...
    // Ana já existe e no modo "preencher" a mãe não é trocada
    expect(html).toMatch(/Ana Beatriz Fictícia Souza[\s\S]*?sem alteração/);

    const ap = await c.post(`/admin/importacao/${id}/aplicar`, {});
    expect(ap.status).toBe(302);
    const carla = sqlite.prepare(`SELECT * FROM alunos WHERE cpf = '52998224725'`).get() as any;
    expect(carla).toMatchObject({ nome_civil: 'Carla Nova Exemplo', data_nascimento: '2001-06-05', nome_mae: 'Mãe da Carla', rg_orgao_expedidor: 'SEJUSP', naturalidade_uf: 'MS', nacionalidade: 'brasileira' });
    expect(sqlite.prepare('SELECT count(*) AS n FROM matriculas WHERE aluno_id = ? AND turma_id = 1').get(carla.id)).toEqual({ n: 1 });
    expect((sqlite.prepare(`SELECT nome_mae FROM alunos WHERE cpf = '11122233396'`).get() as any).nome_mae).toBe('Maria Fictícia Souza');
    expect(sqlite.prepare('SELECT status FROM importacoes WHERE id = ?').get(id)).toEqual({ status: 'aplicada' });
    expect(auditoria().at(-1)).toMatchObject({ acao: 'importar_aplicar', entidade: 'importacao' });
    // não aplica duas vezes
    await c.post(`/admin/importacao/${id}/aplicar`, {});
    expect((sqlite.prepare('SELECT count(*) AS n FROM alunos').get() as any).n).toBe(4);
  }, 30_000);

  it('modo "substituir" troca os dados existentes; XLSX também funciona', async () => {
    const { sqlite, enviar, c } = await ambiente('coordenador');
    const arq = xlsx([['Nome', 'CPF', 'Nome da mãe', 'Data de nascimento'], ['Ana Beatriz Fictícia Souza', '11122233396', 'Mãe Corrigida', 35868]]);
    const id = idDe(await enviar('/admin/importacao/alunos', arq, 'alunos.xlsx', { modo: 'sobrescrever' }));
    expect(await (await c.req(`/admin/importacao/${id}`)).text()).toContain('Nome da mãe: Maria Fictícia Souza → Mãe Corrigida');
    await c.post(`/admin/importacao/${id}/aplicar`, {});
    expect(sqlite.prepare(`SELECT nome_mae, data_nascimento FROM alunos WHERE cpf = '11122233396'`).get()).toEqual({ nome_mae: 'Mãe Corrigida', data_nascimento: '1998-03-14' });
  }, 30_000);

  it('planilha sem coluna de CPF é recusada com mensagem clara', async () => {
    const { enviar } = await ambiente();
    const r = await enviar('/admin/importacao/alunos', new TextEncoder().encode('Nome;Telefone\nFulano;123'), 'x.csv', {});
    expect(decodeURIComponent(r.headers.get('Location')!)).toContain('precisa ter ao menos as colunas de nome e CPF');
  });

  it('descartar não grava nada', async () => {
    const { enviar, c, sqlite } = await ambiente();
    const id = idDe(await enviar('/admin/importacao/alunos', cp1252(CSV_ALUNOS), 'alunos.csv', {}));
    await c.post(`/admin/importacao/${id}/descartar`, {});
    expect((sqlite.prepare('SELECT count(*) AS n FROM alunos').get() as any).n).toBe(3);
    expect(sqlite.prepare('SELECT status FROM importacoes').get()).toEqual({ status: 'descartada' });
  });
});

describe('importação de notas e frequência', () => {
  it('modelo da turma vem preenchido; reenvio editado mostra conferência de aprovação e grava AP/RP', async () => {
    const { c, enviar, sqlite } = await ambiente();
    const modelo = await (await c.req('/admin/importacao/modelo-notas.csv?alvo=1:2')).text();
    const linhas = modelo.replace(/^﻿/, '').trim().split('\r\n');
    expect(linhas[0]).toContain('Design Thinking | Média;Design Thinking | Exame;Design Thinking | Frequência (%)');
    expect(linhas).toHaveLength(4); // cabeçalho + 3 alunos
    // preenche: Ana aprovada em tudo; João reprovado por frequência em Marketing Digital; Renata fica sem notas
    const n = linhas[0].split(';').length;
    const preencher = (l: string, freqMarketing: string) => {
      const cel = l.split(';');
      for (let i = 3; i < n; i += 3) { cel[i] = '8,0'; cel[i + 2] = '90'; }
      cel[3 + 2 * 3 + 2] = freqMarketing; // 3ª disciplina (Marketing Digital), frequência
      return cel.join(';');
    };
    const editado = [linhas[0], ...linhas.slice(1).map((l) => (l.includes('Ana') ? preencher(l, '95') : l.includes('João') ? preencher(l, '60') : l))].join('\r\n');
    const id = idDe(await enviar('/admin/importacao/notas', new TextEncoder().encode(editado), 'notas.csv', { alvo: '1:2' }));
    const html = await (await c.req(`/admin/importacao/${id}`)).text();
    expect(html).toMatch(/<b>1<\/b>ficarão aprovados/);
    expect(html).toMatch(/<b>1<\/b>ficarão reprovados/);
    expect(html).toContain('Marketing Digital: frequência 60% abaixo de 75%');
    expect((sqlite.prepare('SELECT count(*) AS n FROM resultados WHERE componente_id BETWEEN 7 AND 12').get() as any).n).toBe(0);

    await c.post(`/admin/importacao/${id}/aplicar`, {});
    const res = sqlite.prepare('SELECT matricula_id, componente_id, nota, frequencia, resultado FROM resultados WHERE componente_id BETWEEN 7 AND 12 ORDER BY matricula_id, componente_id').all() as any[];
    expect(res).toHaveLength(12);
    expect(res.filter((r) => r.resultado === 'RP')).toEqual([{ matricula_id: 2, componente_id: 9, nota: 8, frequencia: 60, resultado: 'RP' }]);
    const pagina = await (await c.req('/admin/turmas/1/modulos/2')).text();
    expect(pagina).toMatch(/Ana Beatriz Fictícia Souza[\s\S]*?Aprovado/);
  }, 30_000);

  it('formato "uma linha por disciplina", erros de valor e aluno de fora da turma', async () => {
    const { c, enviar, sqlite } = await ambiente();
    const planilha = [
      'CPF;Disciplina;Média;Exame;Frequência',
      '111.222.333-96;Design Thinking;9,5;;100',
      '111.222.333-96;Educação Financeira;11;;100',
      '529.982.247-25;Design Thinking;7;;80',
      '222.333.444-05;Disciplina Inexistente;7;;80',
    ].join('\n');
    const id = idDe(await enviar('/admin/importacao/notas', new TextEncoder().encode(planilha), 'longo.csv', { alvo: '1:2' }));
    const html = await (await c.req(`/admin/importacao/${id}`)).text();
    expect(html).toContain('11 fora do intervalo 0–10');
    expect(html).toContain('CPF 529.982.247-25: aluno não está matriculado nesta turma');
    expect(html).toMatch(/disciplina (&quot;|")Disciplina Inexistente(&quot;|") não pertence a este módulo/);
    await c.post(`/admin/importacao/${id}/aplicar`, {});
    // linhas de Ana têm erro (nota 11) → nada dela é gravado; João também tem erro → nada gravado
    expect((sqlite.prepare('SELECT count(*) AS n FROM resultados WHERE componente_id BETWEEN 7 AND 12').get() as any).n).toBe(0);
  }, 30_000);
});
