#!/usr/bin/env node
/**
 * Cria (ou redefine a senha de) um usuário diretamente no D1. Uso típico: criar o primeiro admin master.
 *
 *   node scripts/criar-usuario.mjs --email fulano@institutoinovativa.org --nome "Fulano de Tal"            (D1 local)
 *   node scripts/criar-usuario.mjs --email ... --nome ... --perfil administrador
 *   node scripts/criar-usuario.mjs --email ... --nome ... --producao                                  (D1 de produção)
 *
 * Gera uma senha temporária (exibida uma única vez); o usuário é obrigado a trocá-la no primeiro acesso.
 * Se o e-mail já existir, redefine a senha temporária e reativa o usuário (perfil mantido).
 */
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = arg('email')?.toLowerCase();
const nome = arg('nome');
const perfil = arg('perfil') ?? 'admin_master';
const producao = args.includes('--producao');

const PERFIS = ['admin_master', 'administrador', 'coordenador', 'secretaria'];
if (!email || !nome || !PERFIS.includes(perfil)) {
  console.error('Uso: node scripts/criar-usuario.mjs --email <email> --nome "<nome>" [--perfil admin_master|administrador|coordenador|secretaria] [--producao]');
  process.exit(1);
}

// Mesmo algoritmo de src/auth/senha.ts
const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const nums = '23456789';
const b = crypto.getRandomValues(new Uint8Array(12));
let senha = letras[b[0] % letras.length] + nums[b[1] % nums.length];
for (let i = 2; i < 12; i++) senha += (letras + nums)[b[i] % (letras + nums).length];

const salt = crypto.getRandomValues(new Uint8Array(16));
const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, chave, 256));
const hash = `pbkdf2$100000$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql =
  `INSERT INTO usuarios (nome, email, perfil, senha_hash, trocar_senha) VALUES (${q(nome)}, ${q(email)}, ${q(perfil)}, ${q(hash)}, 1) ` +
  `ON CONFLICT(email) DO UPDATE SET senha_hash = excluded.senha_hash, trocar_senha = 1, ativo = 1, tentativas_falhas = 0, bloqueado_ate = NULL; ` +
  `INSERT INTO auditoria (usuario_email, acao, entidade, depois_json) VALUES ('script', 'criar_usuario_script', 'usuario', ${q(JSON.stringify({ email, perfil }))});`;

const destino = producao ? ['--env', 'production', '--remote'] : ['--local'];
const dir = mkdtempSync(join(tmpdir(), 'iect-'));
const arquivo = join(dir, 'usuario.sql');
writeFileSync(arquivo, sql, 'utf8');
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', ...destino, `--file="${arquivo}"`], {
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  });
} finally {
  rmSync(dir, { recursive: true, force: true }); // o arquivo contém o hash da senha
}

console.log(`\nUsuário pronto (${producao ? 'PRODUÇÃO' : 'local'}):`);
console.log(`  E-mail: ${email}`);
console.log(`  Perfil: ${perfil}`);
console.log(`  Senha temporária: ${senha}`);
console.log('  (será exigida a troca no primeiro acesso)\n');
