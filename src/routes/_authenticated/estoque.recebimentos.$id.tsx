import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { ReceiptEditor } from "@/components/goods-receipt-editor";

export const Route = createFileRoute("/_authenticated/estoque/recebimentos/$id")({
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return (
    <RequirePermission code="goods_receipt.create">
      <div>
        <PageHeader title="Rascunho de recebimento" description="Continue preenchendo a grade e salve as alterações." />
        <ReceiptEditor draftId={id} />
      </div>
    </RequirePermission>
  );
}
