## Objetivo

Padronizar a impressão de etiquetas do ERP (`/etiquetas`) para replicar o layout físico da Quero Ser Fit, tornando esse modelo o padrão do sistema.

## Referência (etiqueta física)

- Tamanho: **75 × 50 mm** (retrato)
- Topo: logo/marca "QUERO SER FIT" (nome da organização, bold, centralizado)
- Linha do produto: `NOME DO PRODUTO - COR` + `TAM: X` (uppercase, compacto)
- Código de barras CODE128 centralizado (SKU numérico curto)
- Bloco de política de troca em fonte muito pequena (3 linhas, configurável)
- Rodapé: **preço em destaque** (bold, grande, centralizado, formato `R$ 39,99`)

## Mudanças

### 1. `src/lib/label-pdf.ts`
Adicionar um novo layout `"qsf-standard"` ao gerador:
- Recebe `orgName`, `policyText` opcional.
- Ordem vertical fixa: marca → produto+cor+tam → barcode → política → preço grande.
- Preço com fonte ~18pt bold, alinhado ao rodapé.
- Marca em bold ~9pt centralizada; produto em ~7pt uppercase; política em ~4.5pt.
- Trunca nome para caber em 2 linhas em vez de 1 (permite nome longo tipo "CONJUNTO LEGGING AVELUDADO COMPRESSÃO").
- Mantém `SIZE_SINGLE_LABEL` para tamanho único.

### 2. `src/routes/_authenticated/etiquetas.tsx`
- Definir preset padrão **75×50 mm** com o layout QSF (substituindo o default atual 50×30).
- Adicionar seletor de modelo: "Padrão Quero Ser Fit" | "Simples (compacto)".
- Campo opcional "Texto de política de troca" com valor default:
  `"TROCA: 7 DIAS CORRIDOS, APENAS NA LOJA FÍSICA, COM ETIQUETA. NÃO TROCAMOS: ITENS PROMOCIONAIS, ITENS CLAROS, SEM ETIQUETA OU APÓS O PRAZO."`
- Persistir última configuração escolhida em `localStorage` (`fg:labels:preset`).
- Preview passa a renderizar uma miniatura do layout completo (não só o barcode).

### 3. `src/routes/_authenticated/estoque.recebimentos.$id.tsx` e `etiquetas.lotes.$id.tsx`
- Ambos já usam `generateLabelPdf`; passar `layout: "qsf-standard"` e o `policyText` da organização como default para uniformizar toda impressão em lote (recebimento + etiquetas.lotes) com o novo padrão.

### 4. Nenhuma migração de banco
A política de troca fica no cliente (default fixo + override por impressão). Sem novos campos no Supabase por agora — se depois quiser salvar por organização, criamos `organization_settings.exchange_policy_text`.

## Detalhes técnicos

- Ajustar `LabelTemplate` para incluir `layout?: "compact" | "qsf-standard"` e `policy_text?: string`.
- Em `qsf-standard`, ignorar flags individuais (`show_name`, `show_price` etc.) — o layout é fixo por design.
- Fonte: `helvetica` (jsPDF built-in). Preço usa `helvetica bold` ~16pt.
- Barcode: altura fixa 10 mm, largura `innerW`, sem `displayValue` (o número curto abaixo é desenhado por texto separado, como na etiqueta física — ex.: `1 1 4 0 7`).
- Validar QA gerando 2 etiquetas de exemplo (nome curto + nome longo) via `pdftoppm` e inspecionando as imagens antes de finalizar.

## Fora do escopo

- Salvar política por organização no banco (fica para depois se pedir).
- Impressora térmica / ESC-POS direto (mantém geração PDF).
- Cadastro visual de múltiplos templates por usuário.