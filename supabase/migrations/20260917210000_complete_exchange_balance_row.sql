-- complete_exchange uses inventory_balances%ROWTYPE so the whole row must be
-- assigned when more than one balance field is selected.
DO $$
DECLARE
  v_definition text;
  v_old text := 'SELECT physical_quantity, reserved_quantity INTO v_bal';
BEGIN
  SELECT pg_get_functiondef('public.complete_exchange(jsonb)'::regprocedure::oid)
    INTO v_definition;

  IF strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Expected complete_exchange balance assignment not found';
  END IF;

  v_definition := replace(v_definition, v_old, 'SELECT * INTO v_bal');
  EXECUTE v_definition;
END;
$$;
