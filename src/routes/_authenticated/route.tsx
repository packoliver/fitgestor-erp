import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

const HOME_TARGETS: Record<string, string> = {
  admin: "/dashboard",
  operational: "/trabalho",
  motoboy: "/motoboy",
};

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data: userData, error } = await supabase.auth.getUser();
    if (error || !userData.user) throw redirect({ to: "/auth" });

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, status")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (!profile || !profile.organization_id) throw redirect({ to: "/setup" });
    if (profile.status !== "ativo") throw redirect({ to: "/auth" });

    // Post-login redirection: hitting "/" routes to the workspace best matching the user's permissions.
    if (location.pathname === "/" || location.pathname === "") {
      const { data: workspace } = await supabase.rpc("default_workspace_for_current_user");
      const target = HOME_TARGETS[workspace as string] ?? "/dashboard";
      throw redirect({ to: target });
    }

    return { userId: userData.user.id, email: userData.user.email, organizationId: profile.organization_id };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const ctx = Route.useRouteContext();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  // Motoboy area is mobile-first and skips the desktop shell chrome.
  if (pathname.startsWith("/motoboy")) return <Outlet />;
  return (
    <AppShell userEmail={ctx.email ?? ""}>
      <Outlet />
    </AppShell>
  );
}
