# Fatia 2.1b — Sandbox de homologação do módulo de trocas

**NÃO EXECUTAR EM PRODUÇÃO.** Estes artefatos assumem um dos destinos abaixo:

- Projeto Supabase de staging separado (recomendado)
- Supabase Branch de preview isolada
- Supabase local (`supabase start`)

O projeto Supabase de produção deste app tem o `project ref` = `crlgixvekzgeizckzxgg`.
Qualquer script abortará se detectar essa URL/ref.

---

## Arquivos entregues

| Arquivo | Papel |
|---|---|
| `scripts/sandbox/seed-sandbox.ts` | Provisiona usuários auth + dados de negócio marcados `[SANDBOX]` |
| `scripts/sandbox/cleanup-sandbox.ts` | Remove somente os dados sandbox, respeitando FKs |
| `scripts/sandbox/seed-data.sql` | Dados de negócio (idempotente, UUIDs fixos, prefixo `[SANDBOX]`) |
| `scripts/sandbox/rls-tests.sql` | Testes RLS cross-org via `SET LOCAL role authenticated` + `request.jwt.claims` |
| `scripts/sandbox/permission-tests.sql` | Executa `complete_exchange`, `reverse_exchange`, `complete_pos_sale` etc. como cada papel |
| `scripts/sandbox/idempotency-tests.ts` | Duas conexões paralelas (client_request_id repetido, voucher/crédito concorrente) |
| `scripts/sandbox/rollback-tests.sql` | Triggers temporários que injetam falha; valida ausência de registros parciais |

---

## Variáveis de ambiente obrigatórias

```bash
export APP_ENV=staging            # ou "test"; QUALQUER outro valor aborta
export ALLOW_SANDBOX_SEED=true    # confirmação explícita
export SANDBOX_SUPABASE_URL=https://<staging-ref>.supabase.co
export SANDBOX_SUPABASE_SERVICE_ROLE_KEY=eyJ...    # apenas server-side, nunca no frontend
export SANDBOX_DB_URL=postgresql://postgres:...@<host>:5432/postgres   # para psql

# Senhas de teste (não versionar). Se ausentes, o script gera aleatórias e imprime.
export SANDBOX_PASSWORD_ADMIN_A=...
export SANDBOX_PASSWORD_GERENTE_A=...
export SANDBOX_PASSWORD_CAIXA_A=...
export SANDBOX_PASSWORD_VENDEDOR_A=...
export SANDBOX_PASSWORD_ESTOQUISTA_A=...
export SANDBOX_PASSWORD_ADMIN_B=...
```

Guardas ativas em todos os scripts:
1. `APP_ENV` deve ser `staging` ou `test`.
2. `ALLOW_SANDBOX_SEED` deve ser `true`.
3. `SANDBOX_SUPABASE_URL` não pode conter `crlgixvekzgeizckzxgg` (ref de produção deste projeto).
4. `service_role` só é lido pelos scripts Node/psql, nunca importado por código do app.

---

## Ordem de execução

```bash
# 1) Provisionar
bun scripts/sandbox/seed-sandbox.ts

# 2) Rodar testes SQL (RLS, permissão, rollback) — psql com service_role só para SETUP;
#    os testes em si usam SET LOCAL ROLE authenticated para não bypassar RLS.
psql "$SANDBOX_DB_URL" -f scripts/sandbox/rls-tests.sql
psql "$SANDBOX_DB_URL" -f scripts/sandbox/permission-tests.sql
psql "$SANDBOX_DB_URL" -f scripts/sandbox/rollback-tests.sql

# 3) Testes de idempotência/concorrência (duas conexões paralelas)
bun scripts/sandbox/idempotency-tests.ts

# 4) Limpeza
bun scripts/sandbox/cleanup-sandbox.ts
```

Cada script imprime uma tabela `check | expected | actual | status` para preencher o relatório final da Fatia 2.1.

---

## UUIDs fixos (sandbox)

| Entidade | UUID |
|---|---|
| Org A | `aaaa0000-0000-0000-0000-000000000001` |
| Org B | `bbbb0000-0000-0000-0000-000000000001` |
| Cliente A1 | `aaaa0000-0000-0000-0001-000000000001` |
| Cliente A2 | `aaaa0000-0000-0000-0001-000000000002` |
| Cliente B1 | `bbbb0000-0000-0000-0001-000000000001` |
| Cliente B2 | `bbbb0000-0000-0000-0001-000000000002` |

Os UUIDs de produtos, variantes, locais, vendas e vouchers seguem o mesmo padrão prefixado (`aaaa`/`bbbb`) e estão no `seed-data.sql`.

---

## O que NÃO está aqui (pendente da próxima fatia)

- Smoke E2E Playwright com sessões autenticadas reais (Fatia 2.1c).
- Cenários visuais/UX.
- Aprovação final de homologação — só após os itens acima passarem em staging.
