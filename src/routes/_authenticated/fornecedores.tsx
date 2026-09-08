import { createFileRoute } from "@tanstack/react-router";
import { SimpleCrud } from "@/components/simple-crud";
import { RequirePermission } from "@/components/require-permission";

export const Route = createFileRoute("/_authenticated/fornecedores")({
  component: () => (
    <RequirePermission code="supplier.manage">
      <SimpleCrud
        title="Fornecedores"
        description="Cadastro de fornecedores da loja."
        table="suppliers"
        extraFields={[
          { key: "document", label: "CNPJ" },
          { key: "phone", label: "Telefone" },
          { key: "email", label: "E-mail", type: "email" },
          { key: "instagram", label: "Instagram" },
          { key: "city", label: "Cidade" },
          { key: "state", label: "UF" },
        ]}
      />
    </RequirePermission>
  ),
});
