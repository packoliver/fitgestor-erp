import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { ReceiptEditor } from "@/components/goods-receipt-editor";
import { GoodsReceiptTimeline } from "@/components/goods-receipt-timeline";

export const Route = createFileRoute("/_authenticated/estoque/recebimentos/$id")({
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return (
    <RequirePermission code="goods_receipt.create">
      <div className="space-y-4">
        <PageHeader title="Recebimento" description="Cabeçalho, produtos, etiquetas e histórico do recebimento." />
        <ReceiptEditor draftId={id} />
        <GoodsReceiptTimeline draftId={id} />
      </div>
    </RequirePermission>
  );
}
