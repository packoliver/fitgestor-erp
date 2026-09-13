-- ============================================================================
-- Integridade de saldo: toda variação nasce com linha de saldo no local padrão
-- ============================================================================
--
-- PROBLEMA
-- Criar uma variação nunca criou a linha correspondente em inventory_balances.
-- Não havia gatilho, e o formulário de cadastro só chamava apply_stock_movement
-- quando o estoque inicial era > 0. Resultado medido em produção: 3.399 das
-- 3.722 variações ativas (91%) sem nenhuma linha de saldo — invisíveis na tela
-- de Estoque, no Inventário e em qualquer relatório que parta de saldo.
--
-- Isso criava um ciclo que não se resolvia sozinho: sem achar o produto, não se
-- dava entrada; sem entrada, a linha de saldo nunca nascia.
--
-- POR QUE SÓ NO LOCAL PADRÃO, E NÃO EM TODO LOCAL ATIVO
-- Existem 4 locais ativos, mas 3 deles são destinos de exceção
-- (quarentena_avariado, quarentena_defeituoso, perda) e têm zero saldos hoje.
-- Criar linha zerada nos quatro geraria 14.888 linhas em vez de 3.722 e faria
-- cada produto aparecer 4x na tela de Estoque, sendo 3 delas puro ruído.
-- Esses locais continuam ganhando linha sob demanda, como sempre: tanto
-- apply_stock_movement quanto complete_pos_sale/complete_exchange já fazem
-- INSERT ... ON CONFLICT DO NOTHING antes de mexer no saldo.
--
-- ============================================================================


-- ─── 1. Eleger o local padrão ───────────────────────────────────────────────
-- Os 4 locais estão com is_default = false E created_at IDÊNTICO
-- (2026-07-16 21:05:02.787083+00). O código usa `order("created_at").limit(1)`
-- para achar "o local padrão", o que com timestamps empatados é
-- NÃO-DETERMINÍSTICO: o Postgres pode devolver qualquer um dos quatro. Na
-- prática um recebimento podia cair em "Perda / Baixa". Nunca mordeu porque os
-- 324 saldos existentes estão todos na Loja Principal, mas é sorte, não regra.
--
-- DISTINCT ON com desempate por id torna a escolha determinística.
WITH escolhido AS (
  SELECT DISTINCT ON (organization_id) id, organization_id
    FROM public.stock_locations
   WHERE status = 'ativo'
     AND type = 'loja'
   ORDER BY organization_id, created_at, id
)
UPDATE public.stock_locations sl
   SET is_default = true
  FROM escolhido e
 WHERE sl.id = e.id
   AND NOT EXISTS (
     SELECT 1 FROM public.stock_locations d
      WHERE d.organization_id = sl.organization_id
        AND d.is_default
   );

-- Trava para o futuro: no máximo um padrão por organização.
CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_one_default_per_org
  ON public.stock_locations (organization_id)
  WHERE is_default;


-- ─── 2. Função de leitura do local padrão ───────────────────────────────────
-- Fonte única da verdade, para substituir os `order("created_at").limit(1)`
-- espalhados pela aplicação.
CREATE OR REPLACE FUNCTION public.default_stock_location(_org uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id
    FROM public.stock_locations
   WHERE organization_id = _org
     AND status = 'ativo'
     AND is_default
   ORDER BY id
   LIMIT 1;
$$;


-- ─── 3. Gatilho: variação nova nasce com saldo zerado ───────────────────────
CREATE OR REPLACE FUNCTION public.ensure_variant_balance_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_loc uuid;
BEGIN
  v_loc := public.default_stock_location(NEW.organization_id);

  -- Organização sem local padrão definido: não inventa um. A variação é criada
  -- normalmente e ganha saldo no primeiro movimento, como antes.
  IF v_loc IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.inventory_balances (
    organization_id, variant_id, location_id, physical_quantity
  ) VALUES (
    NEW.organization_id, NEW.id, v_loc, 0
  )
  ON CONFLICT (variant_id, location_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_variant_ensure_balance ON public.product_variants;
CREATE TRIGGER trg_variant_ensure_balance
AFTER INSERT ON public.product_variants
FOR EACH ROW
EXECUTE FUNCTION public.ensure_variant_balance_row();


-- ─── 4. Backfill das variações órfãs ────────────────────────────────────────
-- ATENÇÃO: inventory_balances tem o gatilho trg_queue_shopify_inventory_insert_delete,
-- que enfileira sincronização da Shopify a cada INSERT. Sem desligá-lo, este
-- backfill enfileiraria ~1.200 jobs (deduplicados por produto) para produtos
-- cujo estoque NÃO mudou — são linhas zeradas representando "continua zero".
-- Com o erro 404 da Shopify ainda em aberto, isso encheria a fila de falhas e
-- poluiria shopify_last_sync_error no catálogo inteiro.
--
-- O DISABLE vale para todas as sessões enquanto durar a transação. A janela é
-- de segundos e a loja ainda não abriu, então o risco de perder um enfileiramento
-- concorrente é desprezível.
ALTER TABLE public.inventory_balances
  DISABLE TRIGGER trg_queue_shopify_inventory_insert_delete;

INSERT INTO public.inventory_balances (
  organization_id, variant_id, location_id, physical_quantity
)
SELECT v.organization_id, v.id, public.default_stock_location(v.organization_id), 0
  FROM public.product_variants v
 WHERE v.deleted_at IS NULL
   AND public.default_stock_location(v.organization_id) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.inventory_balances b
      WHERE b.variant_id = v.id
        AND b.location_id = public.default_stock_location(v.organization_id)
   )
ON CONFLICT (variant_id, location_id) DO NOTHING;

ALTER TABLE public.inventory_balances
  ENABLE TRIGGER trg_queue_shopify_inventory_insert_delete;
