-- Harden employee authentication, authorization and POS PIN handling.
-- Applied to production after the rollback test passed.

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.organization_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.status = 'ativo';
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.user_roles ur
      ON ur.user_id = pr.id
     AND ur.organization_id = pr.organization_id
    JOIN public.roles r
      ON r.id = ur.role_id
     AND r.organization_id = pr.organization_id
    JOIN public.role_permissions rp
      ON rp.role_id = r.id
     AND rp.allowed = true
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE pr.id = auth.uid()
      AND pr.status = 'ativo'
      AND pr.organization_id IS NOT NULL
      AND p.code = _code
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(_role_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.user_roles ur
      ON ur.user_id = pr.id
     AND ur.organization_id = pr.organization_id
    JOIN public.roles r
      ON r.id = ur.role_id
     AND r.organization_id = pr.organization_id
    WHERE pr.id = auth.uid()
      AND pr.status = 'ativo'
      AND pr.organization_id IS NOT NULL
      AND r.name = _role_name
  );
$$;

-- A conta autenticada pode editar somente dados pessoais não privilegiados.
-- Organização, e-mail, status e hash do PIN passam exclusivamente por fluxos
-- administrativos/RPCs validados no servidor.
DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.profiles FROM authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name, phone, avatar_url, updated_at)
  ON TABLE public.profiles TO authenticated;
REVOKE ALL ON TABLE public.profiles FROM anon;

-- Reduz privilégios de tabela ao mínimo necessário para as telas de cargos.
REVOKE ALL ON TABLE public.permissions, public.roles, public.role_permissions,
  public.user_roles, public.audit_logs FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.permissions,
  public.roles, public.role_permissions, public.user_roles, public.audit_logs
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.permissions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_roles FROM authenticated;
REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM authenticated;

CREATE OR REPLACE FUNCTION public.accept_employee_invite()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid;
  v_status public.user_status;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT p.organization_id, p.status
    INTO v_org, v_status
    FROM public.profiles p
   WHERE p.id = v_user
   FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Convite sem organização.';
  END IF;
  IF v_status = 'ativo' THEN
    RETURN;
  END IF;
  IF v_status NOT IN ('convite_pendente', 'pendente') THEN
    RAISE EXCEPTION 'Este acesso está bloqueado ou removido. Fale com o administrador.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r
        ON r.id = ur.role_id
       AND r.organization_id = v_org
     WHERE ur.user_id = v_user
       AND ur.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Convite sem cargo atribuído.';
  END IF;

  UPDATE public.profiles
     SET status = 'ativo', updated_at = now()
   WHERE id = v_user;

  INSERT INTO public.audit_logs(
    organization_id, user_id, action, module, entity_type, entity_id, new_data
  ) VALUES (
    v_org, v_user, 'employee.invite_accepted', 'admin', 'profile', v_user,
    jsonb_build_object('status', 'ativo')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_employee_invite() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_employee_invite() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_employee_invite(
  _user_id uuid, _email text, _full_name text, _phone text, _role_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_existing_org uuid;
  v_role_org uuid;
  v_existing_status public.user_status;
BEGIN
  -- Convites são exclusivos de uma conta ativa com o cargo Administrador.
  IF NOT public.has_role('Administrador') THEN
    RAISE EXCEPTION 'Somente um Administrador pode convidar funcionários.';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Organização inválida.';
  END IF;

  SELECT r.organization_id INTO v_role_org
    FROM public.roles r WHERE r.id = _role_id;
  IF v_role_org IS NULL OR v_role_org <> v_org THEN
    RAISE EXCEPTION 'Cargo fora da organização.';
  END IF;

  SELECT p.organization_id, p.status
    INTO v_existing_org, v_existing_status
    FROM public.profiles p
   WHERE p.id = _user_id
   FOR UPDATE;

  IF v_existing_org IS NOT NULL AND v_existing_org <> v_org THEN
    RAISE EXCEPTION 'E-mail já vinculado a outra organização.';
  END IF;
  IF v_existing_org = v_org AND v_existing_status = 'ativo' THEN
    RAISE EXCEPTION 'Este funcionário já possui acesso ativo.';
  END IF;
  IF v_existing_org = v_org
     AND v_existing_status IN ('bloqueado', 'inativo', 'acesso_removido') THEN
    RAISE EXCEPTION 'Este funcionário possui acesso bloqueado ou removido. Reative-o na tela de funcionários.';
  END IF;

  INSERT INTO public.profiles(
    id, organization_id, email, full_name, phone, status
  ) VALUES (
    _user_id, v_org, lower(btrim(_email)), btrim(_full_name),
    nullif(btrim(_phone), ''), 'convite_pendente'
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    status = 'convite_pendente',
    updated_at = now();

  INSERT INTO public.user_roles(user_id, role_id, organization_id)
  VALUES (_user_id, _role_id, v_org)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_logs(
    organization_id, user_id, action, module, entity_type, entity_id, new_data
  ) VALUES (
    v_org, auth.uid(), 'employee.invited', 'admin', 'profile', _user_id,
    jsonb_build_object('email', lower(btrim(_email)), 'role_id', _role_id)
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.pos_pin_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  attempted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('operator', 'manager')),
  successful boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_pin_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos_pin_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pos_pin_attempts TO service_role;
CREATE INDEX IF NOT EXISTS pos_pin_attempts_rate_limit_idx
  ON public.pos_pin_attempts (organization_id, attempted_by, purpose, attempted_at DESC)
  WHERE successful = false;

CREATE OR REPLACE FUNCTION public.pos_set_operator_pin(_pin text, _user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_target uuid := COALESCE(_user_id, v_caller);
BEGIN
  IF v_caller IS NULL OR NOT public.is_active() THEN
    RAISE EXCEPTION 'Usuário não autenticado ou inativo.';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Organização não encontrada.';
  END IF;
  IF _pin IS NULL OR _pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'O PIN deve ter exatamente 4 dígitos numéricos.';
  END IF;
  IF v_target <> v_caller AND NOT public.has_permission('user.manage') THEN
    RAISE EXCEPTION 'Sem permissão para definir o PIN de outro usuário.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = v_target
       AND p.organization_id = v_org
       AND p.status IN ('ativo', 'convite_pendente', 'pendente')
  ) THEN
    RAISE EXCEPTION 'Usuário não encontrado ou sem acesso nesta organização.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.organization_id = v_org
       AND p.id <> v_target
       AND p.pos_pin_hash IS NOT NULL
       AND p.status IN ('ativo', 'convite_pendente', 'pendente')
       AND extensions.crypt(_pin, p.pos_pin_hash) = p.pos_pin_hash
  ) THEN
    RAISE EXCEPTION 'Este PIN já pertence a outro funcionário.';
  END IF;

  UPDATE public.profiles
     SET pos_pin_hash = extensions.crypt(_pin, extensions.gen_salt('bf')), updated_at = now()
   WHERE id = v_target AND organization_id = v_org;

  INSERT INTO public.audit_logs(
    organization_id, user_id, action, module, entity_type, entity_id, new_data
  ) VALUES (
    v_org, v_caller, 'employee.pos_pin_changed', 'admin', 'profile', v_target,
    jsonb_build_object('changed_by', v_caller)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pos_verify_operator_pin(_pin text)
RETURNS TABLE(id uuid, full_name text, is_manager boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_match_id uuid;
  v_match_name text;
  v_is_manager boolean;
BEGIN
  IF v_caller IS NULL OR NOT public.is_active() OR v_org IS NULL
     OR _pin IS NULL OR _pin !~ '^[0-9]{4}$' THEN
    RETURN;
  END IF;

  DELETE FROM public.pos_pin_attempts
   WHERE attempted_at < now() - interval '30 days';
  IF (
    SELECT count(*) FROM public.pos_pin_attempts a
     WHERE a.organization_id = v_org
       AND a.attempted_by = v_caller
       AND a.purpose = 'operator'
       AND NOT a.successful
       AND a.attempted_at >= now() - interval '10 minutes'
  ) >= 10 THEN
    RETURN;
  END IF;

  SELECT p.id, p.full_name,
         EXISTS (
           SELECT 1
             FROM public.user_roles ur
             JOIN public.roles r
               ON r.id = ur.role_id AND r.organization_id = v_org
             JOIN public.role_permissions rp
               ON rp.role_id = r.id AND rp.allowed
             JOIN public.permissions perm ON perm.id = rp.permission_id
            WHERE ur.user_id = p.id
              AND ur.organization_id = v_org
              AND perm.code = 'pos.manager_override'
         )
    INTO v_match_id, v_match_name, v_is_manager
    FROM public.profiles p
   WHERE p.organization_id = v_org
     AND p.status = 'ativo'
     AND p.pos_pin_hash IS NOT NULL
     AND extensions.crypt(_pin, p.pos_pin_hash) = p.pos_pin_hash
   LIMIT 1;

  INSERT INTO public.pos_pin_attempts(
    organization_id, attempted_by, purpose, successful
  ) VALUES (v_org, v_caller, 'operator', v_match_id IS NOT NULL);

  IF v_match_id IS NOT NULL THEN
    RETURN QUERY SELECT v_match_id, v_match_name, COALESCE(v_is_manager, false);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.pos_verify_manager_pin(_pin text)
RETURNS TABLE(id uuid, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_match_id uuid;
  v_match_name text;
BEGIN
  IF v_caller IS NULL OR NOT public.is_active() OR v_org IS NULL
     OR _pin IS NULL OR _pin !~ '^[0-9]{4}$' THEN
    RETURN;
  END IF;

  DELETE FROM public.pos_pin_attempts
   WHERE attempted_at < now() - interval '30 days';
  IF (
    SELECT count(*) FROM public.pos_pin_attempts a
     WHERE a.organization_id = v_org
       AND a.attempted_by = v_caller
       AND a.purpose = 'manager'
       AND NOT a.successful
       AND a.attempted_at >= now() - interval '10 minutes'
  ) >= 10 THEN
    RETURN;
  END IF;

  SELECT p.id, p.full_name
    INTO v_match_id, v_match_name
    FROM public.profiles p
   WHERE p.organization_id = v_org
     AND p.status = 'ativo'
     AND p.pos_pin_hash IS NOT NULL
     AND extensions.crypt(_pin, p.pos_pin_hash) = p.pos_pin_hash
     AND EXISTS (
       SELECT 1
         FROM public.user_roles ur
         JOIN public.roles r
           ON r.id = ur.role_id AND r.organization_id = v_org
         JOIN public.role_permissions rp
           ON rp.role_id = r.id AND rp.allowed
         JOIN public.permissions perm ON perm.id = rp.permission_id
        WHERE ur.user_id = p.id
          AND ur.organization_id = v_org
          AND perm.code = 'pos.manager_override'
     )
   LIMIT 1;

  INSERT INTO public.pos_pin_attempts(
    organization_id, attempted_by, purpose, successful
  ) VALUES (v_org, v_caller, 'manager', v_match_id IS NOT NULL);

  IF v_match_id IS NOT NULL THEN
    RETURN QUERY SELECT v_match_id, v_match_name;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_set_operator_pin(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pos_verify_operator_pin(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pos_verify_manager_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_set_operator_pin(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_verify_operator_pin(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_verify_manager_pin(text) TO authenticated, service_role;
