import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileCode, UploadCloud, CheckCircle2, ArrowRight, PackagePlus, AlertCircle, RefreshCw } from "lucide-react";
import { parseNFeXML, ParsedNFe, NFeItem } from "@/lib/nfe-parser";
import { generateSimpleSKU } from "@/lib/sku-generator";
import { shopifyService } from "@/services/shopify-service";
import { currentOrgId, formatBRL } from "@/lib/erp";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/estoque/entrada-xml" as any)({
  component: EntradaNFeXMLPage,
});

function EntradaNFeXMLPage() {
  const navigate = useNavigate();
  const [parsedNFe, setParsedNFe] = useState<ParsedNFe | null>(null);
  const [items, setItems] = useState<NFeItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Buscar produtos/variações existentes para conciliação De/Para
  const existingVariants = useQuery({
    queryKey: ["variants-for-nfe-matching"],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_variants")
        .select("id, sku, barcode, size, sale_price, cost_price, product:products!inner(name, color)")
        .is("deleted_at", null)
        .limit(1000);
      return data ?? [];
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const nfe = parseNFeXML(content);
        setParsedNFe(nfe);

        // Tentar vincular automaticamente por código/SKU equivalente
        const matchedItems = nfe.items.map((item) => {
          const found = existingVariants.data?.find(
            (v) => v.sku?.toLowerCase() === item.code.toLowerCase() || v.barcode === item.code
          );
          if (found) {
            return {
              ...item,
              action: "link" as const,
              matchedVariantId: found.id,
              matchedSku: found.sku,
              calculatedPrice: Number(found.sale_price ?? item.calculatedPrice),
            };
          }
          return item;
        });

        setItems(matchedItems);
        toast.success(`NF-e nº ${nfe.header.nNF} importada com ${nfe.items.length} itens!`);
      } catch (err: any) {
        toast.error(err.message || "Erro ao ler o arquivo XML.");
      }
    };

    reader.readAsText(file);
  };

  const updateItemAction = (index: number, action: "link" | "create_new", variantId?: string) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const selectedVar = existingVariants.data?.find((v) => v.id === variantId);
        return {
          ...item,
          action,
          matchedVariantId: variantId,
          matchedSku: selectedVar?.sku,
          calculatedPrice: selectedVar ? Number(selectedVar.sale_price) : item.calculatedPrice,
        };
      })
    );
  };

  const updateMargin = (index: number, margin: number) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const calcPrice = Number((item.unitCost * (1 + margin / 100)).toFixed(2));
        return { ...item, suggestedMarginPercent: margin, calculatedPrice: calcPrice };
      })
    );
  };

  const handleSaveStockEntry = async () => {
    if (!parsedNFe || items.length === 0) return;
    setIsProcessing(true);

    try {
      const orgId = await currentOrgId();
      if (!orgId) throw new Error("Organização não encontrada.");

      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("Usuário não autenticado.");

      // Buscar local de estoque padrão
      const { data: defaultLocation } = await supabase.from("stock_locations").select("id").limit(1).maybeSingle();
      const locationId = defaultLocation?.id || "00000000-0000-0000-0000-000000000000";

      const updatedSkus: { sku: string; newQty: number }[] = [];

      for (const item of items) {
        let targetVariantId = item.matchedVariantId;
        let targetSku = item.matchedSku;

        // Se a opção for Criar Novo Produto
        if (item.action === "create_new" || !targetVariantId) {
          const skuGenerated = generateSimpleSKU(item.description, "PADRAO", "U");

          // 1. Criar Produto
          const { data: newProd, error: pErr } = await supabase
            .from("products")
            .insert({
              organization_id: orgId,
              name: item.description,
              status: "ativo",
              cost_price: item.unitCost,
              sale_price: item.calculatedPrice,
            })
            .select("id")
            .single();

          if (pErr || !newProd) throw pErr || new Error("Erro ao criar produto a partir da NF-e.");

          // 2. Criar Variação
          const { data: newVar, error: vErr } = await supabase
            .from("product_variants")
            .insert({
              organization_id: orgId,
              product_id: newProd.id,
              size: "U",
              sku: skuGenerated,
              barcode: item.code,
              cost_price: item.unitCost,
              sale_price: item.calculatedPrice,
            })
            .select("id, sku")
            .single();

          if (vErr || !newVar) throw vErr || new Error("Erro ao criar variação.");

          targetVariantId = newVar.id;
          targetSku = newVar.sku;
        } else {
          // Atualizar preço de custo (CMV) na variação existente
          await supabase
            .from("product_variants")
            .update({ cost_price: item.unitCost, sale_price: item.calculatedPrice })
            .eq("id", targetVariantId);
        }

        // 3. Atualizar / Incrementar Estoque
        const { data: existingBalance } = await supabase
          .from("inventory_balances")
          .select("id, physical_quantity, available_quantity")
          .eq("variant_id", targetVariantId)
          .maybeSingle();

        let currentQty = Number(existingBalance?.physical_quantity ?? 0);
        let newQty = currentQty + item.quantity;

        if (existingBalance) {
          await supabase
            .from("inventory_balances")
            .update({
              physical_quantity: newQty,
              available_quantity: Number(existingBalance.available_quantity ?? 0) + item.quantity,
            })
            .eq("id", existingBalance.id);
        } else {
          await supabase.from("inventory_balances").insert({
            organization_id: orgId,
            location_id: locationId,
            variant_id: targetVariantId,
            physical_quantity: item.quantity,
            available_quantity: item.quantity,
          });
        }

        // Registrar Histórico na Auditoria de Logs
        await (supabase as any).from("stock_movements").insert({
          organization_id: orgId,
          variant_id: targetVariantId,
          movement_type: "entry",
          quantity: item.quantity,
          reference_type: "nfe_import",
          notes: `Entrada via NF-e nº ${parsedNFe.header.nNF} (${parsedNFe.header.supplierName})`,
          created_by: user.id,
        }).catch(() => null);

        if (targetSku) {
          updatedSkus.push({ sku: targetSku, newQty });
        }
      }

      // 4. Disparar Sincronização Shopify em Segundo Plano
      for (const itemSync of updatedSkus) {
        shopifyService.syncInventoryToShopify(itemSync.sku, itemSync.newQty).catch((err: any) => {
          console.warn("Erro no sync em segundo plano com Shopify:", err);
        });
      }

      toast.success("Entrada de nota fiscal concluída e estoque atualizado!");
      setParsedNFe(null);
      setItems([]);
      navigate({ to: "/estoque" });
    } catch (err: any) {
      toast.error(err.message || "Falha ao gravar entrada no estoque.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Entrada de Estoque via NF-e (XML)"
        description="Importação automatizada de Notas Fiscais Eletrônicas com conciliação De/Para e recálculo de estoque."
      />

      {/* Upload de Arquivo */}
      {!parsedNFe ? (
        <Card className="border-dashed border-2 border-slate-300 bg-slate-50/50 hover:bg-slate-100/50 transition-colors">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <UploadCloud className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Selecione o arquivo .XML da Nota Fiscal</h3>
              <p className="text-sm text-slate-500 max-w-md mt-1">
                Arraste o arquivo XML fornecido pelo fornecedor ou clique no botão abaixo para buscar no seu dispositivo.
              </p>
            </div>
            <div className="relative">
              <input
                type="file"
                accept=".xml"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Button className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
                <FileCode className="mr-2 h-4 w-4" />
                Buscar Arquivo XML
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Cabeçalho da Nota */}
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="bg-slate-50 border-b border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <FileCode className="h-5 w-5 text-indigo-600" />
                    NF-e nº {parsedNFe.header.nNF} (Série {parsedNFe.header.serie})
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 mt-0.5">
                    Fornecedor: <strong>{parsedNFe.header.supplierName}</strong> | CNPJ: {parsedNFe.header.cnpj}
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setParsedNFe(null)}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Trocar XML
                </Button>
              </div>
            </CardHeader>
          </Card>

          {/* Tabela De/Para de Itens */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold text-slate-800">
                Conciliação de Itens (De / Para)
              </CardTitle>
              <CardDescription>
                Vincule os itens da NF-e a produtos já existentes no ERP ou marque para cadastrar automaticamente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <Table>
                  <TableHeader className="bg-slate-100">
                    <TableRow>
                      <TableHead>Item do XML (Fornecedor)</TableHead>
                      <TableHead>Ação De/Para</TableHead>
                      <TableHead className="text-right">Custo XML</TableHead>
                      <TableHead className="w-28 text-right">Margem %</TableHead>
                      <TableHead className="text-right">Preço Venda</TableHead>
                      <TableHead className="text-right">Qtd Entrar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-semibold text-xs text-slate-900">{item.description}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            Cód: {item.code} | NCM: {item.ncm || "—"}
                          </div>
                        </TableCell>

                        <TableCell className="min-w-[240px]">
                          <div className="space-y-1.5">
                            <Select
                              value={item.action}
                              onValueChange={(val) => updateItemAction(index, val as any, item.matchedVariantId)}
                            >
                              <SelectTrigger className="h-8 text-xs bg-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="create_new">✨ Cadastrar Novo Produto</SelectItem>
                                <SelectItem value="link">🔗 Vincular a Produto Existente</SelectItem>
                              </SelectContent>
                            </Select>

                            {item.action === "link" && (
                              <Select
                                value={item.matchedVariantId || ""}
                                onValueChange={(val) => updateItemAction(index, "link", val)}
                              >
                                <SelectTrigger className="h-8 text-xs bg-indigo-50/50 border-indigo-200">
                                  <SelectValue placeholder="Selecione a variação..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {(existingVariants.data ?? []).map((v) => (
                                    <SelectItem key={v.id} value={v.id} className="text-xs">
                                      {v.product.name} ({v.size}) — {v.sku}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="text-right text-xs font-medium text-slate-800">
                          {formatBRL(item.unitCost)}
                        </TableCell>

                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={item.suggestedMarginPercent}
                            onChange={(e) => updateMargin(index, Number(e.target.value))}
                            className="h-8 w-20 text-xs text-right ml-auto bg-white"
                          />
                        </TableCell>

                        <TableCell className="text-right text-xs font-bold text-emerald-700">
                          {formatBRL(item.calculatedPrice)}
                        </TableCell>

                        <TableCell className="text-right font-bold text-slate-900 text-xs">
                          +{item.quantity} {item.unit}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <Button variant="outline" onClick={() => setParsedNFe(null)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleSaveStockEntry}
                  disabled={isProcessing}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >

                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Confirmar Entrada de Estoque ({items.length} Itens)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
