import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ProductForm } from "@/components/product-form";
import { ArrowLeft, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/produtos/$id")({
  component: ProdutoDetalhe,
});

function ProdutoDetalhe() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const [{ data: product }, { data: variants }, { data: images }] = await Promise.all([
        supabase.from("products").select("*").eq("id", id).maybeSingle(),
        supabase.from("product_variants").select("*").eq("product_id", id).is("deleted_at", null).order("size"),
        supabase.from("product_images").select("*").eq("product_id", id).order("position"),
      ]);
      return { product, variants: variants ?? [], images: images ?? [] };
    },
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data?.product) return <div className="text-muted-foreground">Produto não encontrado.</div>;

  return (
    <div>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/produtos"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link>
        </Button>
      </div>
      <PageHeader title={data.product.name} description={data.product.color ?? undefined} />
      <ProductForm
        productId={id}
        initial={data.product as any}
        initialVariants={data.variants as any}
        initialImages={data.images as any}
      />
    </div>
  );
}
