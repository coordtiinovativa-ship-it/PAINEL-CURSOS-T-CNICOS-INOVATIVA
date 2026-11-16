import { describe, expect, it } from 'vitest';
import { avaliarDisciplina, avaliarModulo, calcularMediaFinal } from '../src/lib/aprovacao';
import { analisarCodigo, formatarCodigo, gerarToken } from '../src/lib/codigo';
import { mascararCPF, validarCPF } from '../src/lib/cpf';
import { dataBR, dataExtenso, dataISO } from '../src/lib/datas';
import { preencherModelo, variaveisDoModelo } from '../src/lib/modelo';

const d = (componente: string, nota: number | null, frequencia: number | null, exame: number | null = null) => ({
  componente,
  nota,
  frequencia,
  notaExameFinal: exame,
});

describe('código de validação', () => {
  it('formata INV-AAAA-NNNNN', () => {
    expect(formatarCodigo(2026, 1)).toBe('INV-2026-00001');
    expect(formatarCodigo(2026, 12345)).toBe('INV-2026-12345');
  });
  it('rejeita sequencial/ano inválido', () => {
    expect(() => formatarCodigo(2026, 0)).toThrow();
    expect(() => formatarCodigo(2026, 100000)).toThrow();
    expect(() => formatarCodigo(26, 1)).toThrow();
  });
  it('analisa código digitado (ida e volta)', () => {
    expect(analisarCodigo(' inv-2026-00042 ')).toEqual({ ano: 2026, sequencial: 42 });
    expect(analisarCodigo('INV-2026-00000')).toBeNull();
    expect(analisarCodigo('INV-26-1')).toBeNull();
  });
  it('token tem 10 caracteres sem ambíguos e não repete', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => gerarToken()));
    expect(tokens.size).toBe(2000);
    for (const t of tokens) expect(t).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
  });
});

describe('aprovação (PPC 11.1.1)', () => {
  it('aprovado direto: média >= 6 e frequência >= 75', () => {
    expect(avaliarDisciplina(d('A', 6.0, 75)).resultado).toBe('AP');
  });
  it('reprovado por frequência mesmo com nota alta', () => {
    const r = avaliarDisciplina(d('A', 10, 74.9));
    expect(r.resultado).toBe('RP');
    expect(r.motivos[0]).toMatch(/frequência/);
  });
  it('média < 6 sem exame: reprovado', () => {
    expect(avaliarDisciplina(d('A', 5.9, 100)).resultado).toBe('RP');
  });
  it('média < 6 com exame: aprovado se média final >= 5', () => {
    expect(calcularMediaFinal(4.5, 5.5)).toBe(5);
    expect(avaliarDisciplina(d('A', 4.5, 80, 5.5)).resultado).toBe('AP');
    expect(avaliarDisciplina(d('A', 4.0, 80, 5.5)).resultado).toBe('RP');
  });
  it('métodos configuráveis de média final após exame', () => {
    const base = { frequenciaMinima: 75, notaMinima: 6, notaMinimaExame: 5, pesoMedia: 1, pesoExame: 1 };
    expect(calcularMediaFinal(4, 7, { ...base, metodoExame: 'media_ponderada' })).toBe(5.5);
    expect(calcularMediaFinal(4, 7, { ...base, metodoExame: 'media_ponderada', pesoMedia: 2, pesoExame: 3 })).toBe(5.8);
    expect(calcularMediaFinal(4, 7, { ...base, metodoExame: 'substitui' })).toBe(7);
    expect(calcularMediaFinal(4, 3, { ...base, metodoExame: 'maior' })).toBe(4);
    expect(() => calcularMediaFinal(4, 3, { ...base, metodoExame: 'media_ponderada', pesoMedia: 0, pesoExame: 0 })).toThrow();
    // mesma nota, resultados diferentes conforme o método
    expect(avaliarDisciplina(d('A', 3, 80, 6), { ...base, metodoExame: 'media_ponderada' }).resultado).toBe('RP'); // 4,5
    expect(avaliarDisciplina(d('A', 3, 80, 6), { ...base, metodoExame: 'substitui' }).resultado).toBe('AP'); // 6
  });
  it('lançamento faltando: pendente', () => {
    expect(avaliarDisciplina(d('A', null, 80)).resultado).toBe('PENDENTE');
  });
  it('disciplina aproveitada conta como AP', () => {
    expect(avaliarDisciplina({ ...d('A', 7, null), aproveitada: true }).resultado).toBe('AP');
  });
  it('módulo exige todas as disciplinas AP', () => {
    const nomes = ['A', 'B', 'C'];
    expect(avaliarModulo(nomes, [d('A', 7, 90), d('B', 8, 80), d('C', 6, 75)]).aprovado).toBe(true);
    const rep = avaliarModulo(nomes, [d('A', 7, 90), d('B', 8, 70), d('C', 6, 75)]);
    expect(rep.aprovado).toBe(false);
    expect(rep.motivos).toHaveLength(1);
    const pend = avaliarModulo(nomes, [d('A', 7, 90), d('B', 8, 80)]);
    expect(pend.aprovado).toBe(false);
    expect(pend.pendente).toBe(true);
  });
  it('módulo sem disciplinas não é aprovado', () => {
    expect(avaliarModulo([], []).aprovado).toBe(false);
  });
});

describe('CPF', () => {
  it('valida dígitos verificadores', () => {
    expect(validarCPF('529.982.247-25')).toBe(true);
    expect(validarCPF('529.982.247-26')).toBe(false);
    expect(validarCPF('111.111.111-11')).toBe(false);
  });
  it('mascara para a página pública', () => {
    expect(mascararCPF('123.456.789-09')).toBe('***.456.789-**');
  });
});

describe('datas', () => {
  it('formato brasileiro e por extenso', () => {
    expect(dataBR('2024-12-18')).toBe('18/12/2024');
    expect(dataExtenso('2024-12-18')).toBe('18 de dezembro de 2024');
    expect(dataExtenso('2017-02-06')).toBe('6 de fevereiro de 2017');
    expect(dataExtenso('2021-01-01')).toBe('1º de janeiro de 2021');
    expect(dataISO('6/2/2017')).toBe('2017-02-06');
    expect(() => dataBR('2026-02-30')).toThrow();
  });
});

describe('modelo de texto', () => {
  it('preenche variáveis e aponta faltantes', () => {
    const m = 'Curso {curso}, aluno {{aluno}}, eixo {eixo}.';
    expect(variaveisDoModelo(m)).toEqual(['curso', 'aluno', 'eixo']);
    const r = preencherModelo(m, { curso: 'X', aluno: 'Y' });
    expect(r.texto).toBe('Curso X, aluno Y, eixo [eixo].');
    expect(r.faltantes).toEqual(['eixo']);
  });
});
