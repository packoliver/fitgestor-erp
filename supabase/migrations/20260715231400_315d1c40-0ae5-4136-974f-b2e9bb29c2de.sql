
DO $$ BEGIN ALTER TYPE public.stock_location_type ADD VALUE IF NOT EXISTS 'quarentena_avariado'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE public.stock_location_type ADD VALUE IF NOT EXISTS 'quarentena_defeituoso'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE public.stock_location_type ADD VALUE IF NOT EXISTS 'perda'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.permissions(code, name, module, description)
  VALUES ('exchanges.reverse','Estornar troca','exchanges','Estornar (reverter) uma troca já concluída')
  ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions(role_id, permission_id, allowed)
SELECT r.id, p.id, true FROM public.roles r JOIN public.permissions p ON p.code = 'exchanges.reverse'
 WHERE r.name IN ('Administrador','Gerente')
ON CONFLICT DO NOTHING;
