-- Peso é armazenado em public.products, em quilogramas. A Shopify replica o
-- mesmo peso para cada variação do produto.
--
-- Escopo:
--   * somente produtos ativos já vinculados à Shopify;
--   * somente produtos com pelo menos uma variação ativa vinculada;
--   * peso padrão de 0,250 kg apenas quando peso líquido E bruto não existem;
--   * produtos com peso líquido válido e peso bruto zero preservam seu peso.
--
-- A lista de alvos é congelada no início da transação. Todos são colocados na
-- outbox em lotes de 20 produtos a cada 5 minutos, evitando uma rajada na API.
-- O rollback exato está em:
--   supabase/rollbacks/20260914184110_backfill_missing_product_weights.sql

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.product_weight_backfill_20260914_backup (
  product_id uuid PRIMARY KEY
    REFERENCES public.products(id) ON DELETE RESTRICT,
  previous_weight numeric,
  previous_gross_weight numeric,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.product_weight_backfill_20260914_backup
  FROM PUBLIC, anon, authenticated;

CREATE TEMPORARY TABLE weight_sync_targets
ON COMMIT DROP
AS
SELECT
  p.id AS product_id,
  row_number() OVER (ORDER BY p.id) AS queue_position,
  coalesce(p.gross_weight, p.weight, 0) AS previous_payload_weight
FROM public.products p
WHERE p.deleted_at IS NULL
  AND p.status = 'ativo'
  AND p.shopify_product_id IS NOT NULL
  -- É exatamente o conjunto que o payload antigo enviava sem peso.
  AND coalesce(p.gross_weight, p.weight, 0) <= 0
  AND EXISTS (
    SELECT 1
    FROM public.product_variants pv
    WHERE pv.product_id = p.id
      AND pv.deleted_at IS NULL
      AND pv.status = 'ativo'
      AND pv.shopify_variant_id IS NOT NULL
  );

INSERT INTO private.product_weight_backfill_20260914_backup (
  product_id,
  previous_weight,
  previous_gross_weight
)
SELECT
  p.id,
  p.weight,
  p.gross_weight
FROM public.products p
JOIN weight_sync_targets target ON target.product_id = p.id
WHERE coalesce(p.weight, 0) <= 0
  AND coalesce(p.gross_weight, 0) <= 0
ON CONFLICT (product_id) DO NOTHING;

-- Não substitui nenhum peso real: só preenche produtos sem peso líquido e
-- sem peso bruto. O trigger existente também cria/atualiza a outbox.
UPDATE public.products p
SET
  weight = 0.250,
  updated_at = now()
FROM private.product_weight_backfill_20260914_backup backup
WHERE p.id = backup.product_id
  AND coalesce(p.weight, 0) <= 0
  AND coalesce(p.gross_weight, 0) <= 0;

-- Também reenfileira os produtos que já tinham peso líquido válido, mas cujo
-- gross_weight=0 ocultava esse valor no payload antigo. A restrição UNIQUE por
-- product_id mantém uma única tarefa por produto.
SELECT public.enqueue_shopify_product_sync(target.product_id, 15)
FROM weight_sync_targets target;

-- Libera 20 produtos por janela de 5 minutos. O worker só reivindica tarefas
-- cujo available_at já venceu, portanto as janelas futuras não são drenadas
-- de uma vez mesmo que o endpoint seja chamado repetidamente.
WITH schedule AS (
  SELECT
    target.product_id,
    floor((target.queue_position - 1) / 20)::integer AS batch_number
  FROM weight_sync_targets target
)
UPDATE public.shopify_product_sync_jobs job
SET
  status = 'pending',
  attempt_count = 0,
  requested_at = now(),
  available_at = now() + interval '30 seconds'
    + schedule.batch_number * interval '5 minutes',
  locked_at = NULL,
  locked_by = NULL,
  completed_at = NULL,
  last_error = NULL,
  updated_at = now()
FROM schedule
WHERE job.product_id = schedule.product_id;
