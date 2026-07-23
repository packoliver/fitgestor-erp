import { ReactNode } from "react";
import { usePermissions } from "@/hooks/use-permissions";
import { Card } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

/**
 * Wraps a page or fragment and only renders its children when the current
 * user has at least one of the required permission codes. Renders an
 * explanatory card otherwise. Backend RPCs / triggers still enforce the
 * same permissions independently — this component is UX-only.
 */
export function RequirePermission({
  code,
  anyOf,
  children,
  fallback,
}: {
  code?: string;
  anyOf?: string[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { has, hasAny, isLoading } = usePermissions();
  if (isLoading) return null;
  const ok = code ? has(code) : anyOf ? hasAny(...anyOf) : true;
  if (ok) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  return (
    <Card className="p-8 max-w-lg mx-auto mt-8 text-center space-y-3">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <ShieldAlert className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">Acesso restrito</h2>
      <p className="text-sm text-muted-foreground">
        Você não tem permissão para acessar esta área. Fale com um administrador se acredita que deveria ter acesso.
      </p>
    </Card>
  );
}
