/**
 * Aplica as migrações reais num SQLite em memória (node:sqlite) e confere
 * o seed do PPC e as regras de integridade do banco.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { validarCPF } from '../src/lib/cpf';

const RAIZ = join(import.meta.dirname, '..');
let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = join(RAIZ, 'migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  db.exec(readFileSync(join(RAIZ, 'seed', 'dev_alunos_ficticios.sql'), 'utf8'));
});

describe('seed do PPC', () => {
  it('cada módulo temático soma 400 h', () => {
    const linhas = db
      .prepare(
        `SELECT m.nome, m.carga_horaria AS declarada, sum(c.carga_horaria_total) AS soma
           FROM modulos_tematicos m JOIN componentes_curriculares c ON c.modulo_id = m.id
          WHERE m.matriz_id = 1 GROUP BY m.id ORDER BY m.ordem`,
      )
      .all() as { nome: string; declarada: number; soma: number }[];
    expect(linhas.map((l) => l.nome)).toEqual(['Qualidade', 'Empreendedorismo', 'Ambiente Organizacional']);
    for (const l of linhas) {
      expect(l.soma, l.nome).toBe(400);
      expect(l.declarada, l.nome).toBe(400);
    }
  });

  it('TCC tem 100 h e fica fora dos módulos', () => {
    const tcc = db
      .prepare(`SELECT * FROM componentes_curriculares WHERE tipo = 'tcc'`)
      .all() as { modulo_id: number | null; carga_horaria_total: number }[];
    expect(tcc).toHaveLength(1);
    expect(tcc[0].modulo_id).toBeNull();
    expect(tcc[0].carga_horaria_total).toBe(100);
  });

  it('o curso soma 1300 h e bate com a carga horária cadastrada', () => {
    const { soma } = db
      .prepare('SELECT sum(carga_horaria_total) AS soma FROM componentes_curriculares WHERE matriz_id = 1')
      .get() as { soma: number };
    const { carga_horaria_total } = db
      .prepare('SELECT carga_horaria_total FROM cursos WHERE id = 1')
      .get() as { carga_horaria_total: number };
    expect(soma).toBe(1300);
    expect(carga_horaria_total).toBe(1300);
  });

  it('cada módulo tem 6 disciplinas', () => {
    const r = db
      .prepare('SELECT modulo_id, count(*) AS n FROM componentes_curriculares WHERE modulo_id IS NOT NULL GROUP BY modulo_id')
      .all() as { n: number }[];
    expect(r.map((x) => x.n)).toEqual([6, 6, 6]);
  });

  it('atos: credenciamento 10.994/2017 e autorização 13.111/2024', () => {
    const cred = db
      .prepare(`SELECT numero, data FROM atos_regulatorios WHERE finalidade = 'credenciamento'`)
      .get();
    expect(cred).toEqual({ numero: '10.994', data: '2017-02-06' });
    const aut = db
      .prepare(`SELECT numero, data, processo FROM atos_regulatorios WHERE finalidade = 'autorizacao_curso' AND curso_id = 1`)
      .get();
    expect(aut).toEqual({ numero: '13.111', data: '2024-12-18', processo: 'NUP 29.092.431-2024' });
  });

  it('CPFs fictícios são válidos', () => {
    const cpfs = db.prepare('SELECT cpf FROM alunos').all() as { cpf: string }[];
    for (const { cpf } of cpfs) expect(validarCPF(cpf), cpf).toBe(true);
  });
});

describe('integridade', () => {
  it('ato precisa ter exatamente um dono (instituição ou curso)', () => {
    expect(() =>
      db.exec(
        `INSERT INTO atos_regulatorios (instituicao_id, curso_id, finalidade, tipo, numero, data, orgao_emissor)
         VALUES (1, 1, 'credenciamento', 'Deliberação', 'x', '2020-01-01', 'x')`,
      ),
    ).toThrow();
  });

  it('matriz usada por turma não pode ser alterada', () => {
    expect(() => db.exec('UPDATE componentes_curriculares SET carga_horaria_total = 60 WHERE id = 1')).toThrow(
      /nova versão/,
    );
  });

  it('sequência de código só avança e certificado não pode ser apagado', () => {
    const reservar = db.prepare(
      `INSERT INTO sequencias_certificado (ano, ultimo) VALUES (?, 1)
       ON CONFLICT(ano) DO UPDATE SET ultimo = ultimo + 1 RETURNING ultimo`,
    );
    expect((reservar.get(2026) as { ultimo: number }).ultimo).toBe(1);
    expect((reservar.get(2026) as { ultimo: number }).ultimo).toBe(2);
    expect((reservar.get(2027) as { ultimo: number }).ultimo).toBe(1);

    db.exec(
      `INSERT INTO certificados (id, tipo, codigo_validacao, token, matricula_id, modulo_id, data_emissao,
         local_emissao, hash_sha256, snapshot_json, codigo_autenticacao_sistec)
       VALUES (1, 'qualificacao_intermediaria', 'INV-2026-00001', 'ABCDEFGHJK', 1, 1, '2026-12-05',
         'Campo Grande/MS', 'h', '{}', 'SIS-1')`,
    );
    expect(() => db.exec('DELETE FROM certificados WHERE id = 1')).toThrow(/revogação/);
    expect(() => db.exec(`UPDATE certificados SET snapshot_json = '{"x":1}' WHERE id = 1`)).toThrow(/imutáveis/);
    expect(() => db.exec(`UPDATE certificados SET status = 'revogado' WHERE id = 1`)).toThrow(); // sem motivo
    expect(() => db.exec(`UPDATE certificados SET folha = '9' WHERE id = 1`)).toThrow(/imutáveis/);
    expect(() =>
      db.exec(
        `INSERT INTO certificados (tipo, codigo_validacao, token, matricula_id, modulo_id, data_emissao,
           local_emissao, hash_sha256, snapshot_json)
         VALUES ('qualificacao_intermediaria', 'INV-2026-00009', 'YYYYYYYYYY', 2, 1, '2026-12-05', 'x', 'h', '{}')`,
      ),
    ).toThrow(/SISTEC/);
    db.exec(`UPDATE certificados SET status = 'revogado', motivo_revogacao = 'teste' WHERE id = 1`);
    expect(() =>
      db.exec(
        `INSERT INTO certificados (tipo, codigo_validacao, token, matricula_id, modulo_id, data_emissao,
           local_emissao, hash_sha256, snapshot_json, codigo_autenticacao_sistec)
         VALUES ('qualificacao_intermediaria', 'INV-2026-00001', 'ZZZZZZZZZZ', 1, 1, '2026-12-05', 'x', 'h', '{}', 'SIS-2')`,
      ),
    ).toThrow(/UNIQUE/);
  });
});
