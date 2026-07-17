## O que vamos entregar

Uma nova área **Configurações → Importar dados** onde o dono/gestor sobe arquivos exportados de outro ERP (Bling, Tiny, Olist, ou genérico) e o sistema traz produtos, variantes, estoque, clientes e fornecedores. Também aceita **XML de NF-e** para entrada de mercadoria.

### Fluxo do usuário

1. Escolhe **tipo de dado**: Produtos, Estoque, Clientes, Fornecedores, ou NF-e (XML).
2. Escolhe **origem**: Bling, Tiny, Olist ou Genérico.
3. Faz upload do arquivo (CSV, XLSX ou XML). Limite 20 MB.
4. Sistema mostra **preview das 20 primeiras linhas** + **mapeamento de colunas** (auto‑detectado por origem, editável no modo Genérico).
5. Marca opções: “atualizar existentes por SKU/CPF/CNPJ” ou “apenas novos”, e local de estoque destino (quando aplicável).
6. Clica em **Importar** — job assíncrono processa em lotes de 500 linhas.
7. Ao final: relatório com **X importados / Y atualizados / Z com erro**, botão para baixar CSV dos erros.

### Escopo por tipo

**Produtos e variantes** (CSV/XLSX)
- Campos: SKU pai, nome, marca, categoria, NCM, cor, tamanho, EAN, preço venda, preço custo, peso.
- Cria `products` + `product_variants`; agrupa linhas com mesmo SKU pai em grade.
- Marca/categoria criadas automaticamente se não existirem.
- **Fotos**: se o CSV tiver coluna `imagem_url`, baixamos e subimos no bucket `product-images`; se vier ZIP com imagens nomeadas por SKU, também suportamos.

**Estoque** (CSV/XLSX)
- Campos: SKU, saldo, local (opcional).
- Aplica como **balanço** via `apply_stock_movement` (movement_type `inventario`), preservando histórico.

**Clientes** (CSV/XLSX)
- Campos: nome, CPF, telefone, e‑mail, CEP, endereço, cidade, UF, data nasc.
- Deduplicação por CPF; sem CPF, por nome+telefone.

**Fornecedores** (CSV/XLSX)
- Campos: nome, CNPJ, telefone, e‑mail, endereço.
- Deduplicação por CNPJ.

**NF-e (XML)** — entrada de mercadoria
- Parse do XML padrão SEFAZ; cria um **rascunho de recebimento** (`goods_receipt_drafts`) já preenchido com fornecedor (por CNPJ), número da nota e itens (SKU/EAN → variante, quantidade, preço custo).
- Usuário revisa no editor existente `/estoque/recebimentos/$id` e confirma.

**PDF** — não suportado nesta primeira versão. Vou avisar no modal que PDF de ERP normalmente é layout de relatório, difícil de parsear com precisão; se o usuário tiver o PDF, oriento a exportar em CSV/XLSX no ERP de origem. Se for **DANFE (PDF de NF-e)**, pedimos o XML da nota — todo ERP fornece.

### Presets de mapeamento por origem

Cada ERP tem colunas diferentes. Sistema já vem com mapeamentos prontos para Bling, Tiny e Olist (nomes de coluna → campo interno). No modo Genérico o usuário escolhe manualmente.

## Detalhes técnicos

- **UI**: nova rota `src/routes/_authenticated/configuracoes.importar.tsx` com wizard (etapas: tipo → origem → upload → mapeamento → confirmação → progresso).
- **Parsers client-side**: `papaparse` (CSV), `xlsx` (SheetJS) para XLSX, `fast-xml-parser` para NF-e. Parse no browser para mostrar preview sem round-trip.
- **Import backend**: server function `runImport` (`src/lib/imports.functions.ts`) com `requireSupabaseAuth` + verificação de papel admin. Recebe payload `{ kind, source, rows, mapping, options }` já parseado; processa em lotes com `supabaseAdmin` (carregado dentro do handler, padrão do projeto).
- **Persistência do job**: tabela `import_jobs` (id, kind, source, status, total, ok, errors, error_report_url, created_by, org_id, timestamps) + `import_job_errors` (job_id, row_index, payload, message). RLS: admin da org lê/escreve.
- **Fotos**: helper que baixa URL server-side e sobe no bucket `product-images`; erros de foto não abortam o produto.
- **NF-e**: reaproveita fluxo existente de recebimento; server fn `createReceiptFromNfe` cria o draft e devolve id para redirecionar.
- **Navegação**: link "Importar dados" em `src/config/navigation.tsx` dentro do grupo Configurações; permissão `settings.manage`.

## O que NÃO faz nesta versão

- Importar histórico de vendas / financeiro (fora de escopo típico de migração inicial).
- Sincronização contínua com o ERP antigo (é importação pontual, não integração).
- OCR de PDF.