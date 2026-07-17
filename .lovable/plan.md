## O que está acontecendo

Os 85 erros são todos da mesma constraint:

```
duplicate key value violates unique constraint "product_variants_org_sku_uniq"
```

Ou seja, a Olist está devolvendo variações cujo **SKU já existe** no banco para outra variante da mesma organização. Como a tabela `product_variants` tem índice único em `(organization_id, sku)`, o `INSERT` estala.

## Por que acontece

Na Olist é comum o mesmo item aparecer em dois lugares na listagem `produtos.pesquisa`:
1. como **variação filha** de um produto-pai com grade
2. como **produto avulso** com o mesmo `codigo` (SKU)

Cada aparição vem com um `id` diferente, então o lookup por `olist_variant_id` (`findLocalVariantByExternal`) não encontra e o código tenta inserir de novo — mas o SKU já foi gravado na primeira passada e a constraint bloqueia.

Resultado visível no painel: 110 produtos, 84 variações criadas, **85 erros** (justamente os duplicados), 0 fotos e 0 estoque porque cada `throw` corta o processamento do produto atual antes de chegar em fotos/estoque.

## O que corrigir em `src/lib/olist-sync.server.ts`

1. **Antes de inserir uma variante**, quando `findLocalVariantByExternal` retornar nulo E o item tiver SKU, procurar variante existente por `(organization_id, sku)`.
   - Se encontrar: reutilizar `variantId`, gravar o mapping `varExternalId → variantId` (assim a próxima sync já encontra pelo external), contar como `variants_updated` e seguir para estoque/fotos.
   - Se não encontrar: inserir normalmente.
2. Aplicar a mesma lógica nos dois caminhos do `syncOneProduct`: variação única (linha ~297) e loop de `variacoes` (linha ~322).
3. Tratar `sku` nulo/vazio como "sem SKU" (não faz lookup, insere direto — sem SKU não há colisão).
4. Depois do fix, rodar "Sincronizar agora" novamente. Os produtos que hoje falham vão passar, e fotos/estoque das linhas antes bloqueadas começam a popular.

Nenhuma mudança de schema é necessária — a constraint continua protegendo contra SKU duplicado real.

## Fora do escopo desta correção

- Fotos zeradas e estoque zerado em execuções passadas: parte é efeito colateral dos erros acima (o produto abortava antes). Se depois do fix ainda vier zerado, aí sim investigo separadamente (throttling da API de fotos e leitura de saldo).
