# FitGestor — Etapa 1 (Base do ERP)

Sistema ERP web para loja de roupas fitness, multi-tenant desde o início, com foco em produtos, variações, estoque, funcionários e auditoria. Sem integrações externas nesta etapa.

## Stack
- TanStack Start (React 19 + TypeScript + Vite) já configurado
- Tailwind v4 + shadcn/ui
- Supabase (Auth, PostgreSQL, Storage, RLS)
- Zod para validação, React Hook Form
- TanStack Query para dados

## 1) Banco de dados (uma migration única)

Tabelas criadas exatamente conforme especificado:
`organizations, profiles, roles, permissions, role_permissions, categories, brands, suppliers, products, product_variants, product_images, stock_locations, inventory_balances, inventory_movements, audit_logs, integration_mappings, integration_events`.

Detalhes-chave:
- Todas as tabelas operacionais têm `organization_id` (multi-tenant pronto).
- `product_variants`: UNIQUE `(organization_id, sku)` e `(organization_id, barcode)` quando não nulos (índices parciais).
- Soft delete em `products` e `product_variants` (`deleted_at`).
- `available_quantity` como coluna gerada (`physical - reserved`).
- Índices em SKU, barcode, product_id, organization_id, IDs externos, `created_at` de movimentações, status.
- Enum de `movement_type` com todos os 16 tipos listados.
- Trigger `updated_at` em todas as tabelas relevantes.

## 2) Segurança (RLS)

- Função `security definer` `public.current_org_id()` lê `organization_id` do `profiles` do usuário logado (evita recursão).
- Função `public.has_permission(code text)` que resolve papel → permissões.
- Toda tabela: `ENABLE ROW LEVEL SECURITY` + policy `organization_id = current_org_id()`.
- `profiles`: só o próprio user pode ler/editar seus dados básicos; admins da mesma org podem gerenciar todos.
- `audit_logs`: insert livre para authenticated (via triggers), SELECT só para permissão `audit.view`.
- GRANTs explícitos para `authenticated` e `service_role` em todas as tabelas públicas.
- Seeds: permissões padrão (visualizar/criar/editar produto, alterar preço, ver custo, ajustar estoque, imprimir etiquetas, ver relatórios, administrar usuários, etc.) e 5 papéis-sistema (Administrador, Gerente, Caixa, Vendedor, Estoquista) com `is_system_role = true` — **por organização, criados via trigger quando organização é criada**.

## 3) Onboarding / bootstrap
- Trigger `handle_new_user` em `auth.users`: cria `profile` sem organização.
- Se `profile` sem `organization_id` → tela **/setup** para criar a organização (nome, documento). Ao criar, o usuário vira Administrador dessa org (trigger popula papéis padrão + vincula).
- Fluxo permite futura adição de outras lojas (SaaS).

## 4) Estrutura de rotas (TanStack)

```
/                          → landing simples com CTA para /auth
/auth                      → login + signup (email/senha)
/setup                     → criar organização (após signup)
/_authenticated/route.tsx  → gate gerenciado
/_authenticated/dashboard
/_authenticated/produtos                (lista + busca por barcode)
/_authenticated/produtos/novo
/_authenticated/produtos/$id            (detalhes + edição + variações + fotos)
/_authenticated/estoque
/_authenticated/estoque/movimentacoes
/_authenticated/estoque/entrada         (recebimento de mercadoria)
/_authenticated/estoque/inventario
/_authenticated/estoque/inventario/$id
/_authenticated/etiquetas
/_authenticated/fornecedores
/_authenticated/categorias
/_authenticated/marcas
/_authenticated/funcionarios
/_authenticated/cargos
/_authenticated/configuracoes
/_authenticated/auditoria
```

Sitemap.xml e robots.txt básicos.

## 5) Layout
- `AppSidebar` (shadcn) colapsável, com grupos: Operação, Cadastros, Administração.
- Header com trigger, nome da loja, avatar do usuário + menu (perfil, sair).
- Design: moderno, feminino sem infantil. Paleta escura/clara com um accent quente (rosa queimado / coral suave), tipografia limpa (Inter + acento em Fraunces para logotipo). Tokens semânticos em `src/styles.css`.

## 6) Módulos funcionais (Etapa 1)

**Produtos**
- Lista com busca (nome/SKU/barcode/cor/categoria/marca/fornecedor), filtros, paginação, campo de busca com autofocus que reconhece leitura de scanner (Enter → resolve variação).
- Cadastro: informações, preços (margem calculada), fotos (upload múltiplo, drag-reorder, principal), variações em massa com sugestões de tamanho.
- Validação client (Zod) + server (constraints).
- SKU/barcode nunca autogerados; validação de duplicidade antes de salvar.

**Estoque**
- Visão por variação com saldos por local.
- Movimentações: listagem com filtros, cada movimentação registra usuário, quantidades antes/depois, motivo.
- Bloquear negativo por padrão (função `apply_movement` em plpgsql, transacional; libera se usuário tem permissão `stock.allow_negative`).

**Entrada de mercadorias**
- Wizard: fornecedor → nº pedido/nota → adicionar variações + qtd + custo → conferência → confirmar (RPC transacional que grava movimentações e atualiza saldos).

**Inventário**
- Criar, contar por barcode/manual, salvar rascunho, mostrar esperado/contado/diferença, finalizar → RPC gera ajustes automaticamente.

**Etiquetas**
- Selecionar produtos/variações + quantidade → preview (JsBarcode CODE128) → gerar PDF (jsPDF) → registrar histórico em `audit_logs`.
- Configurações de modelo (largura, altura, margens, fonte, mostrar preço/SKU/nome).

**Funcionários & Cargos**
- CRUD de usuários da organização (admin cria via server function usando service role; envia convite ou define senha).
- CRUD de papéis personalizados + toggle de permissões por módulo.

**Fornecedores / Categorias / Marcas**
- CRUD simples com status ativo/inativo.

**Auditoria**
- Trigger genérico `audit_trigger()` em produtos, variações, preços, estoque, permissões, etiquetas.
- Tela com filtros por módulo, usuário, período.

**Dashboard**
- KPIs: produtos ativos, variações, unidades em estoque, baixo estoque, sem estoque.
- Listas: últimas movimentações, entradas recentes.
- Alertas: sem SKU, sem barcode, sem foto, SKUs/barcodes duplicados (queries dedicadas).
- Banner "Ambiente sem dados — comece cadastrando produtos".

## 7) Server-side (TanStack server functions)
- `createOrganization`, `inviteEmployee`, `applyStockMovement`, `receiveGoods`, `finalizeInventory`, `generateLabelsPdf` (na verdade PDF gerado no cliente; server só registra histórico).
- Todas usam `requireSupabaseAuth`; operações de admin importam `supabaseAdmin` dentro do handler.

## 8) Storage
- Bucket `product-images` (público para leitura). Uploads via cliente browser autenticado; caminho: `{organization_id}/{product_id}/{uuid}.{ext}`.

## 9) O que NÃO entra nesta etapa
Fiscal, financeiro, PDV completo, trocas/estornos completos, integrações reais Olist/Shopify, pagamentos, planos SaaS. A arquitetura (tabelas de mapping/events, IDs externos nas variações/produtos) já está pronta.

## Ordem de execução
1. Migration única (schema + RLS + seeds de permissões + triggers de bootstrap).
2. Bucket de storage + policies.
3. Design system (`src/styles.css`) e layout (root + sidebar).
4. Auth (/auth, /setup) + gate `_authenticated`.
5. CRUDs simples (fornecedores, categorias, marcas).
6. Produtos + variações + fotos.
7. Estoque + movimentações + entrada + inventário.
8. Etiquetas (preview + PDF).
9. Funcionários, cargos/permissões.
10. Dashboard + auditoria + configurações.

Peça grande — vou entregar em uma sequência longa de edits na próxima mensagem quando você aprovar.
