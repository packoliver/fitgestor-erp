import { createFileRoute } from "@tanstack/react-router";
import { SimpleCrud } from "@/components/simple-crud";

export const Route = createFileRoute("/_authenticated/categorias")({
  component: () => <SimpleCrud title="Categorias" description="Organize os produtos em categorias." table="categories" />,
});
