import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { ReceiptEditor } from "@/components/goods-receipt-editor";

export const Route = createFileRoute("/_authenticated/estoque/recebimentos/novo")({
  component: () => (
    <RequirePermission code="goods_receipt.create">
      <div>
        <PageHeader title="Nova entrada de mercadoria" description="Substitua a anotação no papel: registre tamanhos, cores e quantidades antes de confirmar o estoque." />
        <ReceiptEditor />
      </div>
    </RequirePermission>
  ),
});
