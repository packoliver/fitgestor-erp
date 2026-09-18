-- Harden operational RPCs found by plpgsql_check before launch.
-- These changes only replace function definitions; they do not modify business data.

CREATE OR REPLACE FUNCTION pg_temp.patch_function_definition(
  _function regprocedure,
  _old text,
  _new text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_definition text;
  v_patched text;
BEGIN
  SELECT pg_get_functiondef(_function::oid) INTO v_definition;

  IF v_definition IS NULL OR strpos(v_definition, _old) = 0 THEN
    RAISE EXCEPTION 'Expected fragment not found while patching %', _function;
  END IF;

  v_patched := replace(v_definition, _old, _new);
  EXECUTE v_patched;
END;
$$;

-- A RECORD variable cannot receive one field before its tuple shape is known.
SELECT pg_temp.patch_function_definition(
  'public.complete_exchange(jsonb)'::regprocedure,
  'v_bal record;',
  'v_bal public.inventory_balances%ROWTYPE;'
);

-- pgcrypto is installed in Supabase's extensions schema.
SELECT pg_temp.patch_function_definition(
  'public.complete_exchange(jsonb)'::regprocedure,
  'gen_random_bytes(',
  'extensions.gen_random_bytes('
);

SELECT pg_temp.patch_function_definition(
  'public.issue_exchange_receipt(uuid,jsonb)'::regprocedure,
  'gen_random_bytes(',
  'extensions.gen_random_bytes('
);

-- RETURNS TABLE exposes an output variable named id, so qualify the client column.
SELECT pg_temp.patch_function_definition(
  'public.issue_quick_exchange_voucher(numeric,uuid)'::regprocedure,
  'FROM public.clients WHERE id = _client_id',
  'FROM public.clients c WHERE c.id = _client_id'
);

SELECT pg_temp.patch_function_definition(
  'public.issue_quick_exchange_voucher(numeric,uuid)'::regprocedure,
  'gen_random_bytes(',
  'extensions.gen_random_bytes('
);

-- RETURNS TABLE also exposes id here; qualify the route column.
SELECT pg_temp.patch_function_definition(
  'public.list_available_shipments_for_route(uuid)'::regprocedure,
  'FROM public.routes WHERE id = _route_id',
  'FROM public.routes r WHERE r.id = _route_id'
);

-- CASE text literals must be explicitly typed when assigned to an enum column.
SELECT pg_temp.patch_function_definition(
  'public.create_post_sale_task(uuid,public.post_sale_type,uuid,timestamptz,uuid,text,uuid,public.post_sale_source,boolean)'::regprocedure,
  $$CASE WHEN v_phone IS NULL THEN 'invalid_phone' ELSE 'scheduled' END$$,
  $$CASE
      WHEN v_phone IS NULL THEN 'invalid_phone'::public.post_sale_status
      ELSE 'scheduled'::public.post_sale_status
    END$$
);

SELECT pg_temp.patch_function_definition(
  'public.post_sale_review_approve(uuid,text)'::regprocedure,
  $$CASE WHEN scheduled_at <= now() THEN 'pending' ELSE 'scheduled' END$$,
  $$CASE
           WHEN scheduled_at <= now() THEN 'pending'::public.post_sale_status
           ELSE 'scheduled'::public.post_sale_status
         END$$
);

-- Functions that create or truncate temporary tables must be VOLATILE.
ALTER FUNCTION public.report_exchanges(jsonb) VOLATILE;
ALTER FUNCTION public.export_exchanges_report(jsonb) VOLATILE;
ALTER FUNCTION public.list_goods_receipts(jsonb) VOLATILE;

-- These routines call expressions classified as stable by PostgreSQL.
ALTER FUNCTION public.post_sale_validate_placeholders(text) STABLE;
ALTER FUNCTION public._post_sale_calc_scheduled(timestamptz,integer,public.post_sale_delay_unit) STABLE;

-- Two obsolete service-role overloads predate the canonical apply_stock_movement RPC.
-- Both target columns or enum values that do not exist and have no callers in the app.
DROP FUNCTION IF EXISTS public.apply_stock_movement_system(
  uuid, uuid, uuid, text, numeric, text, text, text, uuid, text, uuid
);
DROP FUNCTION IF EXISTS public.apply_stock_movement_system(
  uuid, uuid, uuid, text, numeric, text, text, uuid, numeric, jsonb
);
