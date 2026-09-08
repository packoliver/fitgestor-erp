import { createFileRoute } from "@tanstack/react-router";
import { SimpleCrud } from "@/components/simple-crud";
import { RequirePermission } from "@/components/require-permission";

export const Route = createFileRoute("/_authenticated/categorias")({
  component: () => (
    <RequirePermission code="category.manage">
      <SimpleCrud title="Categorias" description="Organize os produtos em categorias." table="categories" />
    </RequirePermission>
  ),
});
