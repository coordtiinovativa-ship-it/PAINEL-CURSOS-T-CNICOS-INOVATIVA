#!/usr/bin/env node
/**
 * Ambiente de TESTE na Cloudflare (https://teste-certificados.institutoinovativa.org) — para a direção conhecer
 * e testar o sistema com dados fictícios. Worker, banco D1 e R2 PRÓPRIOS (certificados-iect-teste): nunca toca a produção.
 *
 *   npm run deploy:teste     publica o sistema no ambiente de teste
 *   npm run teste:dados      aplica as migrações, carrega os dados fictícios (se o banco estiver vazio)
 *                            e cria/atualiza os usuários de teste
 *
 * Todos os comandos daqui usam  --env teste --remote  (nunca --env production).
 */
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..');
const ALVO = ['--env', 'teste', '--remote'];
const SENHA = 'IectTeste2026';
const USUARIOS = [
  ['Direção Pedagógica (teste)', 'direcao@teste.iect', 'admin_master'],
  ['Administrador (teste)', 'administrador@teste.iect', 'administrador'],
  ['Coordenação (teste)', 'coordenacao@teste.iect', 'coordenador'],
  ['Secretaria (teste)', 'secretaria@teste.iect', 'secretaria'],
];

const env = { ...process.env, CI: 'true' };
const wrangler = (args, opcoes = {}) =>
  execFileSync('npx', ['wrangler', ...args], { cwd: RAIZ, shell: process.platform === 'win32', encoding: 'utf8', env, ...opcoes });
const sql = (arquivo) => wrangler(['d1', 'execute', 'DB', ...ALVO, `--file="${arquivo}"`], { stdio: ['ignore', 'ignore', 'inherit'] });
const consulta = (q) => JSON.parse(wrangler(['d1', 'execute', 'DB', ...ALVO, '--json', '--command', `"${q}"`], { stdio: ['ignore', 'pipe', 'inherit'] }))[0]?.results ?? [];

console.log('• Aplicando migrações no banco de TESTE...');
wrangler(['d1', 'migrations', 'apply', 'DB', ...ALVO], { stdio: ['ignore', 'ignore', 'inherit'] });

const seeds = readdirSync(join(RAIZ, 'seed')).filter((f) => /^dev_.*\.sql$/.test(f)).sort();
for (const s of seeds) {
  const primeira = readFileSync(join(RAIZ, 'seed', s), 'utf8').split(/\r?\n/, 1)[0];
  const tabela = /^--\s*se-vazio:\s*(\w+)/.exec(primeira)?.[1] ?? 'alunos';
  const n = consulta(`SELECT count(*) AS n FROM ${tabela}`)[0]?.n ?? 0;
  if (n) { console.log(`• seed/${s}: mantido (${tabela} já tem ${n} registro(s))`); continue; }
  console.log(`• Carregando dados fictícios: seed/${s}`);
  sql(join(RAIZ, 'seed', s));
}

async function hashSenha(senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, chave, 256));
  return `pbkdf2$100000$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`;
}

let texto = `-- signatários fictícios (só no ambiente de teste), para permitir emitir documentos de teste
UPDATE signatarios SET nome = 'Diretora Pedagógica Fictícia' WHERE nome LIKE '%A DEFINIR%' AND cargo LIKE 'Diretor%';
UPDATE signatarios SET nome = 'Secretária Escolar Fictícia' WHERE nome LIKE '%A DEFINIR%' AND cargo LIKE 'Secret%';
`;
for (const [nome, email, perfil] of USUARIOS) {
  texto += `INSERT INTO usuarios (nome, email, perfil, senha_hash, trocar_senha) VALUES ('${nome}', '${email}', '${perfil}', '${await hashSenha(SENHA)}', 0)
  ON CONFLICT(email) DO UPDATE SET nome = excluded.nome, perfil = excluded.perfil, senha_hash = excluded.senha_hash, trocar_senha = 0,
  ativo = 1, tentativas_falhas = 0, bloqueado_ate = NULL;\n`;
}
const dir = mkdtempSync(join(tmpdir(), 'iect-teste-'));
const arq = join(dir, 'usuarios.sql');
writeFileSync(arq, texto, 'utf8');
try { sql(arq); } finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`
  AMBIENTE DE TESTE (não afeta a produção) — https://teste-certificados.institutoinovativa.org
  Senha de todos: ${SENHA}
${USUARIOS.map(([, e, p]) => `    ${e.padEnd(28)} ${p}`).join('\n')}
`);
