import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { ProductForm } from "@/components/product-form";

export const Route = createFileRoute("/_authenticated/produtos/novo")({
  component: NovoProduto,
});

function NovoProduto() {
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader title="Novo produto" description="Cadastre um novo produto e suas variações." />
      <ProductForm onSaved={(id) => navigate({ to: "/produtos/$id", params: { id } })} />
    </div>
  );
}
