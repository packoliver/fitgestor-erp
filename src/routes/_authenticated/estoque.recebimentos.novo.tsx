import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { ReceiptEditor } from "@/components/goods-receipt-editor";

export const Route = createFileRoute("/_authenticated/estoque/recebimentos/novo")({
  component: () => (
    <RequirePermission code="goods_receipt.create">
      <div>
        <PageHeader title="Novo recebimento" description="Preencha a grade por tamanho e salve como rascunho. Nenhum estoque é alterado nesta etapa." />
        <ReceiptEditor />
      </div>
    </RequirePermission>
  ),
});
