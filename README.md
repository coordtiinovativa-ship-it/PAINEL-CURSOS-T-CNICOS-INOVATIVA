# Certificados IECT

Requisitos e regras do sistema: ver [CLAUDE.md](CLAUDE.md).

## Rodar localmente

```bash
npm install
npm run db:migrate:local      # schema + dados reais (instituição, atos, curso, matriz)
npm run db:ficticios:local    # 3 alunos fictícios + turma (somente dev)
node scripts/criar-usuario.mjs --email voce@exemplo.com --nome "Seu Nome"   # 1º admin master (mostra senha temporária)
npm run dev                   # http://localhost:8787/admin
npm test                      # testes automatizados
```

Para recriar o banco local do zero: apagar `.wrangler/state` e repetir os dois comandos `db:`.

## Estrutura

- `migrations/` — migrações D1 versionadas (`0001_schema.sql`, `0002_seed_real.sql`)
- `seed/` — dados fictícios de desenvolvimento (nunca aplicar em produção)
- `src/index.tsx` — Worker Hono: monta as rotas, CSRF, cabeçalhos de segurança
- `src/auth/` — senha (PBKDF2), sessão, perfis e permissões
- `src/rotas/` — telas do painel (login, usuários, auditoria, instituição, signatários, cursos, alunos, turmas, prévia)
- `src/certificado/` — montagem dos dados e prévia (frente/verso) do certificado
- `public/modelo/` — logo e fundo do modelo aprovado (padrão até a direção enviar substitutos)
- `scripts/criar-usuario.mjs` — cria usuário ou redefine senha direto no D1
- `src/lib/` — regras puras: aprovação (PPC 11.1.1), código de validação, CPF, datas, modelos de texto
- `test/` — testes (Vitest); `banco.test.ts` aplica as migrações em SQLite em memória

## Produção (pendente — passo 7)

1. `npx wrangler d1 create certificados-iect` e `npx wrangler r2 bucket create certificados-iect`
2. Copiar o `database_id` para `[env.production]` em `wrangler.toml`
3. `npm run db:migrate:prod` e `npm run deploy`
4. `node scripts/criar-usuario.mjs --email ... --nome ... --producao` (primeiro admin master)
5. O domínio `certificadostecnicos.institutoinovativa.org` é criado automaticamente pelo deploy
   (`routes` com `custom_domain = true` no `wrangler.toml`; a zona institutoinovativa.org já está na Cloudflare).

### Regra de WAF (NECESSÁRIA — criada e testada em 16/11/2026)

Teste em produção (16/11/2026): o Rate Limiting nativo do Workers **não bloqueou** nesta conta (120 consultas do
mesmo IP em 74 s passaram). A proteção efetiva por IP é esta regra de WAF na zona. O token do wrangler não tem
permissão de firewall, por isso é criada no painel:

Cloudflare → institutoinovativa.org → **Security → WAF → Rate limiting rules → Create rule**

- Nome: `Certificados - validação e login`
- Expressão (Edit expression):
  `(http.host eq "certificadostecnicos.institutoinovativa.org" and (starts_with(http.request.uri.path, "/v") or (http.request.uri.path eq "/login" and http.request.method eq "POST")))`
- Contar por: **IP** · Quando exceder: **15 requisições** em **10 segundos**
- Ação: **Block** por **10 segundos** (no plano gratuito, período e bloqueio são de 10 s)
