import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { getAuthenticatedUser } from "@/lib/auth";


export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const user = await getAuthenticatedUser();
    if (!user) {
      throw redirect({
        to: "/auth",
        search: { redirect: location.href },
        replace: true,
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, status")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || !profile.organization_id) throw redirect({ to: "/setup" });

    // Bloqueia usuários banidos ou com acesso removido. Convites pendentes são
    // ativados por uma RPC restrita, sem permitir que o cliente altere o próprio status.
    if (profile.status === "bloqueado" || profile.status === "acesso_removido" || profile.status === "inativo") {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    if (profile.status === "convite_pendente" || profile.status === "pendente") {
      const { error } = await supabase.rpc("accept_employee_invite" as any);
      if (error) {
        await supabase.auth.signOut();
        throw redirect({ to: "/auth" });
      }
    } else if (profile.status !== "ativo") {
      throw redirect({ to: "/auth" });
    }

    return { userId: user.id, email: user.email, organizationId: profile.organization_id };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const ctx = Route.useRouteContext();
  return (
    <AppShell userEmail={ctx.email ?? ""}>
      <Outlet />
    </AppShell>
  );
}
