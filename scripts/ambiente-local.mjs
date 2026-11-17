#!/usr/bin/env node
/**
 * Ambiente de TESTES no próprio computador (http://localhost:8787) — nunca toca a produção.
 *
 *   npm run local            prepara o banco local (se preciso) e sobe o sistema
 *   npm run local:zerar      apaga o banco/arquivos locais e recria do zero (dados reais do PPC + fictícios)
 *
 * O que faz:
 *  1. aplica as migrações no D1 LOCAL (.wrangler/state) — schema + dados reais da instituição, curso e matriz;
 *  2. na primeira vez, carrega os dados fictícios (seed/dev_*.sql): alunos, turma, funcionários, ano letivo...;
 *  3. cria/atualiza o usuário de teste  teste@local.test  /  TesteLocal2026  (admin master, sem troca de senha);
 *  4. sobe o `wrangler dev` (bindings locais: D1, R2 e limites ficam só na sua máquina).
 *
 * Tudo usa --local: os comandos de produção exigem --env production --remote e não aparecem aqui.
 */
import { execFileSync, spawn } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..');
const ESTADO = join(RAIZ, '.wrangler', 'state');
const zerar = process.argv.includes('--zerar');
const soPreparar = process.argv.includes('--sem-servidor');
const EMAIL = 'teste@local.test';
const SENHA = 'TesteLocal2026';

const wrangler = (args, opcoes = {}) =>
  execFileSync('npx', ['wrangler', ...args], { cwd: RAIZ, shell: process.platform === 'win32', encoding: 'utf8', ...opcoes });
const sqlLocal = (arquivo) => wrangler(['d1', 'execute', 'DB', '--local', `--file="${arquivo}"`], { stdio: ['ignore', 'ignore', 'inherit'] });
const consultaLocal = (sql) => {
  const saida = wrangler(['d1', 'execute', 'DB', '--local', '--json', '--command', `"${sql}"`], { stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(saida)[0]?.results ?? [];
};

if (zerar && existsSync(ESTADO)) {
  console.log('• Apagando banco e arquivos locais (.wrangler/state)...');
  rmSync(ESTADO, { recursive: true, force: true });
}

console.log('• Aplicando migrações no banco LOCAL...');
wrangler(['d1', 'migrations', 'apply', 'DB', '--local'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: 'true' } });

// Cada seed/dev_*.sql é carregado se a tabela indicada na 1ª linha ("-- se-vazio: tabela") estiver vazia
// (sem a marcação: "alunos"). Assim um banco local antigo recebe os dados fictícios de módulos novos.
const seeds = readdirSync(join(RAIZ, 'seed')).filter((f) => /^dev_.*\.sql$/.test(f)).sort();
for (const s of seeds) {
  const primeira = readFileSync(join(RAIZ, 'seed', s), 'utf8').split(/\r?\n/, 1)[0];
  const tabela = /^--\s*se-vazio:\s*(\w+)/.exec(primeira)?.[1] ?? 'alunos';
  const n = consultaLocal(`SELECT count(*) AS n FROM ${tabela}`)[0]?.n ?? 0;
  if (n) { console.log(`• seed/${s}: mantido (${tabela} já tem ${n} registro(s); "npm run local:zerar" recomeça do zero)`); continue; }
  console.log(`• Carregando dados fictícios: seed/${s}`);
  sqlLocal(join(RAIZ, 'seed', s));
}

// usuário de teste: mesmo PBKDF2 de src/auth/senha.ts
const salt = crypto.getRandomValues(new Uint8Array(16));
const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(SENHA), 'PBKDF2', false, ['deriveBits']);
const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, chave, 256));
const hash = `pbkdf2$100000$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`;
const dir = mkdtempSync(join(tmpdir(), 'iect-local-'));
const arq = join(dir, 'usuario.sql');
writeFileSync(arq,
  `INSERT INTO usuarios (nome, email, perfil, senha_hash, trocar_senha) VALUES ('Usuário de Teste', '${EMAIL}', 'admin_master', '${hash}', 0)
   ON CONFLICT(email) DO UPDATE SET senha_hash = excluded.senha_hash, trocar_senha = 0, ativo = 1, tentativas_falhas = 0, bloqueado_ate = NULL;`, 'utf8');
try { sqlLocal(arq); } finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`
  ┌──────────────────────────────────────────────────────────┐
  │  AMBIENTE LOCAL DE TESTES (não afeta a produção)         │
  │  Endereço: http://localhost:8787/admin                   │
  │  E-mail:   ${EMAIL.padEnd(46)}│
  │  Senha:    ${SENHA.padEnd(46)}│
  └──────────────────────────────────────────────────────────┘
`);
if (soPreparar) process.exit(0);
console.log('• Subindo o sistema (Ctrl+C para parar)...\n');
// sem --remote, o wrangler dev usa só os bindings locais (padrão)
const dev = spawn('npx', ['wrangler', 'dev', '--port', '8787'], { cwd: RAIZ, stdio: 'inherit', shell: process.platform === 'win32' });
dev.on('exit', (code) => process.exit(code ?? 0));
