import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Loads the set of permission codes granted to the currently authenticated user
 * (via user_roles → role_permissions → permissions). Cached per session.
 *
 * Frontend gating using this hook is UX-only — every sensitive action is
 * additionally validated inside the RPC / trigger it invokes on the backend.
 */
export function usePermissions() {
  const q = useQuery({
    queryKey: ["current-user-permissions"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return { codes: new Set<string>(), isSystemAdmin: false };

      const { data } = await supabase
        .from("user_roles")
        .select("role:roles(name,is_system_role,role_permissions(allowed,permission:permissions(code)))")
        .eq("user_id", uid);

      const codes = new Set<string>();
      let isSystemAdmin = false;
      for (const ur of (data ?? []) as any[]) {
        const role = ur.role;
        if (!role) continue;
        if (role.is_system_role && role.name === "Administrador") isSystemAdmin = true;
        for (const rp of role.role_permissions ?? []) {
          if (rp.allowed && rp.permission?.code) codes.add(rp.permission.code);
        }
      }
      return { codes, isSystemAdmin };
    },
  });

  const codes = q.data?.codes ?? new Set<string>();
  const isSystemAdmin = q.data?.isSystemAdmin ?? false;

  const has = (code: string) => isSystemAdmin || codes.has(code);
  const hasAny = (...list: string[]) => isSystemAdmin || list.some((c) => codes.has(c));

  return { has, hasAny, isSystemAdmin, isLoading: q.isLoading, codes };
}
