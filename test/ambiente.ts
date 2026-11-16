/**
 * Ambiente de teste: D1 e R2 simulados sobre node:sqlite / Map, com as migrações reais aplicadas.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import app from '../src/index';
import { gerarHashSenha } from '../src/auth/senha';

const RAIZ = join(import.meta.dirname, '..');

type Valor = string | number | null | bigint | Uint8Array;
const conv = (p: unknown[]): Valor[] =>
  p.map((v) => {
    if (v === undefined) throw new Error('D1_TYPE_ERROR: undefined não é aceito');
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v as Valor;
  });

class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private params: unknown[] = []) {}
  bind(...p: unknown[]) { return new Stmt(this.db, this.sql, p); }
  async first<T>(col?: string): Promise<T | null> {
    const r = this.db.prepare(this.sql).get(...conv(this.params)) as Record<string, unknown> | undefined;
    if (!r) return null;
    return (col ? r[col] : { ...r }) as T;
  }
  async all<T>() {
    const rows = this.db.prepare(this.sql).all(...conv(this.params)).map((r) => ({ ...r }));
    return { results: rows as T[], success: true, meta: {} };
  }
  async run() {
    const s = this.db.prepare(this.sql);
    const r = s.run(...conv(this.params));
    return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) }, results: [] };
  }
  executarSync() { this.db.prepare(this.sql).run(...conv(this.params)); }
}

export function criarD1(): { d1: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const dir = join(RAIZ, 'migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(join(dir, f), 'utf8'));
  const d1 = {
    prepare: (sql: string) => new Stmt(sqlite, sql),
    async batch(stmts: Stmt[]) {
      sqlite.exec('BEGIN');
      try {
        for (const s of stmts) s.executarSync();
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
      return stmts.map(() => ({ success: true, results: [], meta: {} }));
    },
    async exec(sql: string) { sqlite.exec(sql); return { count: 0, duration: 0 }; },
  } as unknown as D1Database;
  return { d1, sqlite };
}

export function criarR2(): R2Bucket {
  const m = new Map<string, { bytes: Uint8Array; tipo?: string }>();
  return {
    async put(k: string, v: Uint8Array, o?: { httpMetadata?: { contentType?: string } }) { m.set(k, { bytes: v, tipo: o?.httpMetadata?.contentType }); },
    async get(k: string) {
      const o = m.get(k);
      return o
        ? { body: o.bytes, httpMetadata: { contentType: o.tipo }, arrayBuffer: async () => o.bytes.slice().buffer }
        : null;
    },
  } as unknown as R2Bucket;
}

export const ORIGEM = 'http://localhost';

export async function criarAmbiente(opcoes: { ficticios?: boolean } = {}) {
  const { d1, sqlite } = criarD1();
  if (opcoes.ficticios) sqlite.exec(readFileSync(join(RAIZ, 'seed', 'dev_alunos_ficticios.sql'), 'utf8'));
  const ASSETS = {
    async fetch(req: Request) {
      const caminho = join(RAIZ, 'public', decodeURIComponent(new URL(req.url).pathname));
      try {
        return new Response(readFileSync(caminho));
      } catch {
        return new Response('não encontrado', { status: 404 });
      }
    },
  } as unknown as Fetcher;
  const env = { DB: d1, ARQUIVOS: criarR2(), ASSETS, AMBIENTE: 'dev', URL_PUBLICA: 'https://certificadostecnicos.inovativa.com.br' };

  async function criarUsuario(email: string, perfil: string, senha = 'SenhaForte123', trocar = 0) {
    sqlite.prepare('INSERT INTO usuarios (nome, email, perfil, senha_hash, trocar_senha) VALUES (?, ?, ?, ?, ?)')
      .run(email.split('@')[0], email, perfil, await gerarHashSenha(senha), trocar);
  }

  /** Cliente HTTP com cookie de sessão. */
  function cliente() {
    let cookie = '';
    async function req(caminho: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (cookie) headers.set('Cookie', cookie);
      if (init.method === 'POST' && !headers.has('Origin')) headers.set('Origin', ORIGEM);
      const r = await app.request(ORIGEM + caminho, { ...init, headers, redirect: 'manual' }, env);
      const sc = r.headers.get('Set-Cookie');
      if (sc) {
        const m = /sessao=([^;]*)/.exec(sc);
        if (m) cookie = m[1] ? `sessao=${m[1]}` : '';
      }
      return r;
    }
    const post = (caminho: string, campos: Record<string, string>) =>
      req(caminho, { method: 'POST', body: new URLSearchParams(campos), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const entrar = (email: string, senha = 'SenhaForte123') => post('/login', { email, senha });
    return { req, post, entrar };
  }

  const auditoria = () =>
    sqlite.prepare('SELECT usuario_email, acao, entidade, entidade_id, depois_json FROM auditoria ORDER BY id').all() as {
      usuario_email: string; acao: string; entidade: string; entidade_id: number | null; depois_json: string | null;
    }[];

  return { env, sqlite, criarUsuario, cliente, auditoria };
}
