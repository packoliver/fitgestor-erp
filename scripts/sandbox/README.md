# Fatia 2.1b — Sandbox de homologação do módulo de trocas

**NÃO EXECUTAR EM PRODUÇÃO.** Destinos válidos: projeto Supabase de staging separado, branch de preview isolada ou Supabase local (`supabase start`). O ref de produção deste app é `crlgixvekzgeizckzxgg` e é bloqueado em qualquer script.

---

## Árvore de scripts (10 arquivos)

```
scripts/sandbox/
├── README.md                     ← este arquivo
├── _guards.ts                    ← guardas (allowlist ref, bloqueio prod, extração DB URL, tipos)
├── setup-sandbox.ts              ← ORQUESTRADOR — cria tudo na ordem correta, escreve manifesto+creds
├── seed-sandbox.ts               ← stub deprecado; redireciona para setup-sandbox.ts
├── seed-data.sql                 ← FASE 1: dados independentes de usuários (orgs, clientes, produtos, estoque, créditos, vouchers)
├── cleanup-sandbox.ts            ← remove somente IDs presentes no manifesto E ainda com marcador [SANDBOX]
├── cleanup-test-triggers.sql     ← remove qualquer trigger _sbx_* residual (rodar antes e depois de rollback-tests)
├── rls-tests.sql                 ← testes RLS cross-org com JWT completo (sub, role, organization_id)
├── permission-tests.sql          ← autorização por papel via RPCs (reverse_exchange, complete_pos_sale, apply_stock_movement…)
├── rollback-tests.sql            ← triggers temporários com run_id + cleanup em EXCEPTION + pré/pós-check
└── idempotency-tests.ts          ← 2 conexões independentes (storageKey único), logs por chamada, IDs, saldos
```

Artefatos gerados em runtime (NÃO versionar):

```
scripts/sandbox/.sandbox-manifest.json     ← IDs criados (source of truth do cleanup)
scripts/sandbox/.sandbox-credentials.json  ← emails/senhas geradas, chmod 0600
```

Ambos estão no `.gitignore`.

---

## Guardas obrigatórias (todas verificadas em `_guards.ts`)

| Variável | Papel |
|---|---|
| `APP_ENV=staging` (ou `test`) | Qualquer outro valor aborta |
| `ALLOW_SANDBOX_SEED=true` | Confirmação explícita |
| `EXPECTED_SANDBOX_PROJECT_REF` | **Allowlist principal.** Deve ser exatamente o ref de destino (20 chars) ou `local` |
| `SANDBOX_SUPABASE_URL` | Ref extraído deve bater com o allowlist e ≠ produção |
| `SANDBOX_DB_URL` | Idem — ref extraído deve bater com o allowlist |
| `SANDBOX_SUPABASE_SERVICE_ROLE_KEY` | Só usada pelos scripts Node (nunca importada pelo frontend) |
| `SANDBOX_SUPABASE_PUBLISHABLE_KEY` | Requerido pelos testes de idempotência (login real como cada usuário) |

O SQL `seed-data.sql` também checa `cluster_name` como camada COMPLEMENTAR (nunca como garantia principal).

---

## Ordem exata de execução

```bash
# 0) Guardas — exportar antes de qualquer script
export APP_ENV=staging
export ALLOW_SANDBOX_SEED=true
export EXPECTED_SANDBOX_PROJECT_REF=<ref-staging-ou-"local">
export SANDBOX_SUPABASE_URL=https://<ref>.supabase.co
export SANDBOX_DB_URL=postgresql://postgres:...@<host>:5432/postgres
export SANDBOX_SUPABASE_SERVICE_ROLE_KEY=eyJ...
export SANDBOX_SUPABASE_PUBLISHABLE_KEY=eyJ...        # anon key do MESMO projeto

# (opcional) fixar senhas — recomendado. Se omitido, o script gera e grava em .sandbox-credentials.json
export SANDBOX_PASSWORD_ADMIN_A=...
export SANDBOX_PASSWORD_GERENTE_A=...
export SANDBOX_PASSWORD_CAIXA_A=...
export SANDBOX_PASSWORD_VENDEDOR_A=...
export SANDBOX_PASSWORD_ESTOQUISTA_A=...
export SANDBOX_PASSWORD_ADMIN_B=...

# 1) Provisionar (idempotente, escreve manifesto)
bun scripts/sandbox/setup-sandbox.ts

# 2) Testes SQL — extrair UUIDs do manifesto para os JWTs
UID_ADMIN_A=$(jq -r '.auth_users[] | select(.key=="admin_a") | .user_id' scripts/sandbox/.sandbox-manifest.json)
UID_ADMIN_B=$(jq -r '.auth_users[] | select(.key=="admin_b") | .user_id' scripts/sandbox/.sandbox-manifest.json)
UID_CAIXA_A=$(jq -r '.auth_users[] | select(.key=="caixa_a") | .user_id' scripts/sandbox/.sandbox-manifest.json)
UID_VENDEDOR_A=$(jq -r '.auth_users[] | select(.key=="vendedor_a") | .user_id' scripts/sandbox/.sandbox-manifest.json)
UID_ESTOQUISTA_A=$(jq -r '.auth_users[] | select(.key=="estoquista_a") | .user_id' scripts/sandbox/.sandbox-manifest.json)

psql "$SANDBOX_DB_URL" -v uid_admin_a=$UID_ADMIN_A -v uid_admin_b=$UID_ADMIN_B \
     -f scripts/sandbox/rls-tests.sql

psql "$SANDBOX_DB_URL" \
     -v uid_admin_a=$UID_ADMIN_A -v uid_caixa_a=$UID_CAIXA_A \
     -v uid_vendedor_a=$UID_VENDEDOR_A -v uid_estoquista_a=$UID_ESTOQUISTA_A \
     -f scripts/sandbox/permission-tests.sql

# 3) Rollback — pré-check + testes + pós-check obrigatórios
psql "$SANDBOX_DB_URL" -f scripts/sandbox/cleanup-test-triggers.sql
psql "$SANDBOX_DB_URL" -f scripts/sandbox/rollback-tests.sql
psql "$SANDBOX_DB_URL" -f scripts/sandbox/cleanup-test-triggers.sql

# 4) Concorrência (2 conexões independentes com login real)
export SANDBOX_UID_ADMIN_A=$UID_ADMIN_A
bun scripts/sandbox/idempotency-tests.ts

# 5) Cleanup completo (apaga somente IDs do manifesto + remove .sandbox-*.json)
bun scripts/sandbox/cleanup-sandbox.ts
```

---

## Executando em Supabase LOCAL

Nenhum comando abaixo é executado por este trabalho — são instruções para o operador.

```bash
# 1. Instalar CLI
npm i -g supabase              # ou brew install supabase/tap/supabase

# 2. Iniciar (a partir da raiz do projeto, onde já existe supabase/)
supabase start                 # sobe Postgres, Auth, Kong, Studio local
# Se supabase/ ainda não existisse:  supabase init

# 3. Aplicar migrations do projeto
supabase db reset              # limpa e reaplica TODAS as migrations em supabase/migrations/

# 4. Coletar credenciais locais
supabase status                # mostra API URL, anon key, service_role, DB URL

# Exporte, usando os valores do "supabase status":
export APP_ENV=staging
export ALLOW_SANDBOX_SEED=true
export EXPECTED_SANDBOX_PROJECT_REF=local
export SANDBOX_SUPABASE_URL=http://127.0.0.1:54321
export SANDBOX_SUPABASE_SERVICE_ROLE_KEY=<service_role local>
export SANDBOX_SUPABASE_PUBLISHABLE_KEY=<anon local>
export SANDBOX_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# 5. Rodar setup + testes (mesmo bloco da seção anterior, a partir do passo 1)

# 6. Encerrar
supabase stop
```

Um `EXPECTED_SANDBOX_PROJECT_REF=local` combinado com URLs `127.0.0.1`/`localhost` é a única forma dos guards aceitarem o destino sem ref real.

---

## Manifesto e credenciais

**`.sandbox-manifest.json`** registra todos os IDs criados por cada run: `run_id`, `organizations`, `auth_users` (key/email/user_id/org_id), `profiles`, `user_roles`, `clients`, `products`, `variants`, `stock_locations`, `cash_sessions`, `sales`, `store_credit_accounts`, `exchange_vouchers`, `exchanges`. **O cleanup só remove registros presentes aqui** — e ainda valida o marcador `[SANDBOX]` no banco antes de apagar (proteção dupla; nunca apaga por nome/email/prefixo isolado).

**`.sandbox-credentials.json`** é escrito com `chmod 0600` quando o setup precisa gerar senhas (nenhuma senha é impressa em stdout). Está no `.gitignore` e é removido pelo cleanup. Quando `SANDBOX_PASSWORD_*` já vem do ambiente, o arquivo apenas registra `"password": "(from env)"`.

---

## Confirmações de segurança

- Nenhum arquivo em `scripts/sandbox/` é importado pelo frontend (não é referenciado por rotas nem componentes). São scripts standalone rodados por `bun`/`psql`.
- Nenhum segredo é versionado: os arquivos `.sandbox-*.json` estão em `.gitignore`.
- `SANDBOX_SUPABASE_SERVICE_ROLE_KEY` só é usada dentro dos scripts Node (setup/cleanup) e nunca é enviada ao navegador; os testes de idempotência autenticam com a `PUBLISHABLE_KEY` (login real como cada usuário).
- Os testes RLS/permissão usam `SET LOCAL role authenticated` + `request.jwt.claims` com `sub`, `role`, `aud`, `organization_id`, `email` — nunca `service_role`.

---

## Riscos ainda existentes

1. **Smoke E2E Playwright real ainda pendente (Fatia 2.1c).** Os testes SQL provam RLS, atomicidade e autorização de backend, mas não substituem uma sessão real navegando pela UI.
2. `EXPECTED_SANDBOX_PROJECT_REF` depende do operador exportar o valor correto. A allowlist bloqueia URL/DB divergentes, mas não substitui revisão humana.
3. Extração de ref por regex cobre os formatos comuns (`<ref>.supabase.co`, `db.<ref>.supabase.co`, pooler `?options=project%3D<ref>`). Formatos exóticos podem falhar; nesse caso o script aborta pedindo variáveis explícitas.
4. Se a `bootstrap_organization()` do projeto mudar (ex.: não criar mais "Loja Principal" automaticamente), `phase4` do setup falha e dispara o cleanup parcial — comportamento intencional.
5. `cluster_name` continua sendo apenas defesa complementar; a garantia principal é a allowlist + bloqueio do ref de produção.

---

## O que NÃO está aqui

- Smoke E2E Playwright com sessões autenticadas reais (Fatia 2.1c).
- Cenários visuais/UX.
- Aprovação final de homologação — só após os itens acima passarem em staging.
