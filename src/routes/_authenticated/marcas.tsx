import { createFileRoute } from "@tanstack/react-router";
import { SimpleCrud } from "@/components/simple-crud";
import { RequirePermission } from "@/components/require-permission";

export const Route = createFileRoute("/_authenticated/marcas")({
  component: () => (
    <RequirePermission code="brand.manage">
      <SimpleCrud title="Marcas" description="Marcas dos produtos." table="brands" />
    </RequirePermission>
  ),
});
