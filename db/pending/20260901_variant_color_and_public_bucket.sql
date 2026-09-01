-- ============================================================================
-- PENDENTE — NÃO APLICADO AINDA.
-- Este arquivo é apenas o rascunho da migration. Aplique depois, revisando.
--
-- 1) Cor por variação (product_variants.color)
-- 2) Troca do índice único (product_id + size) por (product_id + cor + tamanho)
-- 3) Bucket product-images passa a ser público
-- ============================================================================

-- 1) Coluna de cor por variação
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS color text;

-- Semente: usa a cor do produto como cor padrão das variações existentes
UPDATE public.product_variants v
   SET color = p.color
  FROM public.products p
 WHERE p.id = v.product_id
   AND v.color IS NULL
   AND p.color IS NOT NULL;

-- 2) Índice único: mesmo produto pode ter mesmo tamanho em cores diferentes
DROP INDEX IF EXISTS public.product_variants_product_size_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_color_size_uniq
  ON public.product_variants (
    product_id,
    lower(coalesce(color, '')),
    lower(size)
  )
  WHERE deleted_at IS NULL;

-- 3) Bucket de imagens público
-- ATENÇÃO: no Lovable, use a ferramenta de storage (storage_update_bucket)
-- em vez de UPDATE direto em storage.buckets. Comando equivalente:
--   storage_update_bucket(name => 'product-images', public => true)
