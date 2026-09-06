import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const folder = path.resolve(process.argv[2]);
const report = JSON.parse(await readFile(path.join(folder, 'comparison.json'), 'utf8'));
const snapshot = JSON.parse(await readFile(path.join(folder, 'catalog-snapshot.json'), 'utf8'));
const summary = report.summary;
const products = new Map(snapshot.shopify.products.map(p => [p.id, p]));
const fmt = x => String(x ?? 'não informado').replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('<', '&lt;');
const money = x => x === null ? 'não informado' : Number(x).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const table = (headers, rows) => ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.map(fmt).join(' | ') + ' |')].join('\n');
const name = v => products.get(v.shopifyProductId)?.title;
const date = v => new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba' });
const text = `# Shopify × FitGestor — auditoria de catálogo

Coleta em **${date(snapshot.start)} a ${date(snapshot.end)}**, horário de Cuiabá. Somente leitura.

## Conclusão

A autenticação do app FitGestor funcionou em servidor isolado na Vercel. O catálogo Shopify foi percorrido integralmente, com contagens exatas conferidas antes e depois: **381 produtos e 1.001 variações**. A coleta ERP incluiu **1.098 produtos, 3.702 variações, 324 registros de imagens e 306 registros de saldo**.

**Ainda não é seguro substituir a Olist pelo ERP como controlador do estoque.** Existem pendências de identificação, saldo, preço, opções e imagens. Nenhum cadastro, estoque, preço, foto, pedido ou vínculo de integração foi alterado nesta auditoria.

Todos os **975 SKUs preenchidos da Shopify** tiveram uma correspondência única no ERP. As outras **26 variações** estão sem SKU na Shopify: foram coletadas e listadas, não ignoradas. Há 371 pares de produtos identificados pelos SKUs, sem conflito de agrupamento encontrado. Isso é uma proposta de correspondência, não mapeamentos gravados.

## Principais números

${table(['Verificação', 'Resultado'], [
  ['Variações Shopify sem SKU', summary.shopifyWithoutSku],
  ['SKUs preenchidos Shopify não encontrados no ERP', summary.shopifySkuNotFoundInErp],
  ['Variações com saldo físico explícito nos dois lados', summary.variantsWithComparablePhysicalBalances],
  ['Saldos físicos diferentes entre esses registros', summary.physicalStockDifferences],
  ['Saldo positivo Shopify sem registro de saldo no ERP', summary.shopifyPositiveWithoutErpBalance],
  ['Saldo positivo ERP sem nível de estoque na localização Shopify', summary.erpPositiveWithoutShopifyLocation],
  ['Preços diferentes entre variações identificadas', summary.priceDifferences],
  ['Opções chamadas TAM/tamanho diferentes', summary.sizeDifferences],
  ['Pares de produtos com contagens de fotos diferentes', summary.productImageCountDifferences],
  ['Variações Shopify com vender sem estoque ativado', summary.shopifyContinueSellingWhenOutOfStock],
  ['Variações Shopify sem controle de estoque', summary.shopifyUntrackedVariants],
  ['Variações Shopify com peso igual a zero', summary.shopifyZeroWeightVariants],
])}

Não some os totais como se fossem itens exclusivos: uma variação pode ter mais de uma pendência. Ausência de registro de saldo não foi silenciosamente convertida em zero. As 2.727 variações ERP sem correspondência única incluem itens que podem não fazer parte do catálogo do site — não se recomenda publicá-los automaticamente.

## Identificação: 26 variações sem SKU na Shopify

${table(['Produto', 'Variação', 'ID Shopify'], report.withoutSku.map(v => [v.name, v.title, v.shopifyVariantId.split('/').pop()]))}

Não foi feita correspondência automática por nome. É preciso confirmar o código da peça e preservar os identificadores já usados pelo site.

## Preços: 6 divergências

${table(['Produto', 'SKU', 'Opção', 'Shopify', 'ERP', 'Status Shopify'], report.variantComparisons.filter(v => v.priceDiffers).map(v => [name(v), v.sku, v.shopifySize, money(v.shopifyPrice), money(v.erpEffectivePrice), products.get(v.shopifyProductId)?.status]))}

**Atenção:** as três variações do CONJUNTO LEGGING CONF BOLSOS - VERDE MILITAR estão com preço zero em um produto de status ACTIVE na Shopify. ACTIVE não prova publicação em um canal nem disponibilidade para compra; esses pontos devem ser verificados antes de qualquer alteração. O preço correto precisa ser definido pela loja, não escolhido automaticamente entre os sistemas.

## Opções: 11 divergências

${table(['Produto', 'SKU', 'Valor em TAM/tamanho na Shopify', 'Tamanho no ERP'], report.variantComparisons.filter(v => v.sizeDiffers).map(v => [name(v), v.sku, v.shopifySize, v.erpSize]))}

Os casos acima são acessórios: a Shopify usa cores em uma opção chamada TAM/tamanho, enquanto o ERP contém códigos numéricos em tamanho. Todos esses produtos estavam UNLISTED na coleta. A correção exige modelar cor/tamanho separadamente, não copiar cegamente o conteúdo de um campo para outro.

## Fotos: diferenças nos pares identificados

${table(['Produto', 'Fotos Shopify', 'Fotos ERP'], report.productComparisons.filter(p => p.imageCountDiffers).map(p => [p.shopifyName, p.shopifyImages, p.erpImages]))}

Há **311 registros de imagem na Shopify** e **324 no ERP**, considerando catálogos de tamanhos diferentes. O BLUSÃO DE TULE - CREME tem duas imagens na Shopify e nenhuma no ERP. As três blusas da tabela têm quatro imagens cada no ERP e nenhuma na Shopify.

As conexões de mídia foram paginadas integralmente. **Não foi realizada comparação binária/visual de cada imagem, teste de decodificação ou prova de que fotografias com contagens iguais são as mesmas.** URLs, posições e metadados estão no arquivo detalhado. Este relatório não certifica que a importação original da Olist trouxe todas as fotos; isso requer comparar a fonte Olist atual também.

## Estoque: divergências explícitas

Comparação somente entre **Loja Principal (ERP)** e **Loja Quero Ser Fit® (Shopify)**. Estoques de quarentena, avarias e perda não foram somados ao disponível para venda.

${table(['Produto', 'SKU', 'Opção', 'Físico Shopify', 'Físico ERP', 'Disponível Shopify', 'Disponível ERP'], report.variantComparisons.filter(v => v.physicalStockDiffers).map(v => [name(v), v.sku, v.shopifySize, v.shopifyQuantities.on_hand, v.erpBalance.physical_quantity, v.shopifyQuantities.available, v.erpBalance.available_quantity]))}

Além dessas diferenças, há ${summary.shopifyPositiveWithoutErpBalance} variações com saldo positivo na Shopify sem registro de saldo ERP e ${summary.erpPositiveWithoutShopifyLocation} com saldo positivo ERP sem nível de estoque na localização Shopify. A lista de todas as variações, com saldos ausentes explicitamente marcados, está em **comparison.json**. Não sobrescrever estoque antes de conciliar esses casos e a contagem física.

## Segurança e limites

- App autorizado apenas com read_products, read_inventory e read_locations; nenhuma permissão de escrita.
- Credencial secreta mantida na Vercel; não foi incluída no código público ou nos relatórios.
- Versão de auditoria publicada isoladamente; domínio principal continuou na versão anterior.
- Autorizações temporárias da proteção da Vercel revogadas ao fim; o endpoint adicional exige chave própria e expira em 03/09/2026 00:28:25 UTC.
- 18 testes locais passaram; build local e da Vercel passaram. A checagem TypeScript global ainda aponta erros preexistentes em app-shell.tsx (604/609), fora do código desta auditoria.
- A coleta é paginada, não uma transação simultânea entre duas plataformas. Alterações durante ou após a janela exigem nova conciliação.
- Não foram auditados todos os metacampos, publicações por canal, fretes, pagamentos ou a integridade binária das imagens.
- Peso zero em ${summary.shopifyZeroWeightVariants} variações exige revisar como o frete usa peso de produto/embalagem, sem presumir que todos os fretes estejam errados.

## Próximo passo proposto

1. Revisar e aprovar correspondências das 26 variações sem SKU, sem duplicar produtos.
2. Confirmar os preços corretos, em especial o produto ativo com valores zero.
3. Conciliar estoque da loja principal: diferenças explícitas, registros ausentes e quantidades reservadas/comprometidas.
4. Corrigir o modelo de opções dos acessórios e preservar as fotos presentes em apenas um dos lados.
5. Só depois implementar o mapeamento persistente, fila de sincronização confiável e testes de venda simultânea/última peça, cancelamento e troca. Desligar a Olist somente no corte aprovado.

## Evidências

- [Snapshot completo](./catalog-snapshot.json): todos os registros coletados nesta janela.
- [Comparação por item](./comparison.json): correspondências, divergências e itens não identificados.
`;
await writeFile(path.join(folder, 'RELATORIO.md'), text);
console.log(path.join(folder, 'RELATORIO.md'));
