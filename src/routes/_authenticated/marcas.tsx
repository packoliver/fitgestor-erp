import { createFileRoute } from "@tanstack/react-router";
import { SimpleCrud } from "@/components/simple-crud";

export const Route = createFileRoute("/_authenticated/marcas")({
  component: () => <SimpleCrud title="Marcas" description="Marcas dos produtos." table="brands" />,
});
