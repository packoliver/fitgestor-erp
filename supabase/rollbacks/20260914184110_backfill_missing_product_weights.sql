-- Rollback manual de 20260914184110_backfill_missing_product_weights.sql.
-- Execute como uma única transação. A trava abaixo aborta tudo se alguém tiver
-- corrigido manualmente algum peso depois do backfill, evitando sobrescrever
-- um dado novo com o valor antigo.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'private'
      AND table_name = 'product_weight_backfill_20260914_backup'
  ) THEN
    RAISE EXCEPTION 'weight_backfill_backup_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.product_weight_backfill_20260914_backup backup
    JOIN public.products p ON p.id = backup.product_id
    WHERE p.weight IS DISTINCT FROM 0.250::numeric
       OR p.gross_weight IS DISTINCT FROM backup.previous_gross_weight
  ) THEN
    RAISE EXCEPTION
      'weight_backfill_rollback_aborted_manual_weight_change_detected';
  END IF;
END;
$$;

CREATE TEMPORARY TABLE weight_rollback_targets
ON COMMIT DROP
AS
SELECT
  backup.product_id,
  row_number() OVER (ORDER BY backup.product_id) AS queue_position
FROM private.product_weight_backfill_20260914_backup backup;

UPDATE public.products p
SET
  weight = backup.previous_weight,
  gross_weight = backup.previous_gross_weight,
  updated_at = now()
FROM private.product_weight_backfill_20260914_backup backup
WHERE p.id = backup.product_id;

SELECT public.enqueue_shopify_product_sync(target.product_id, 15)
FROM weight_rollback_targets target;

WITH schedule AS (
  SELECT
    target.product_id,
    floor((target.queue_position - 1) / 20)::integer AS batch_number
  FROM weight_rollback_targets target
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

DROP TABLE private.product_weight_backfill_20260914_backup;

COMMIT;
