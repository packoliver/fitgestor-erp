import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Printer } from "lucide-react";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import { formatBRL } from "@/lib/erp";

export const Route = createFileRoute("/_authenticated/etiquetas")({
  component: EtiquetasPage,
});

type Row = { variant_id: string; label: string; sku: string; barcode: string; price: number | null; qty: string };

function EtiquetasPage() {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [showPrice, setShowPrice] = useState(true);
  const [showSku, setShowSku] = useState(true);
  const [showName, setShowName] = useState(true);
  const [labelWidth, setLabelWidth] = useState("50");
  const [labelHeight, setLabelHeight] = useState("30");

  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const found = useQuery({
    queryKey: ["label-search", search],
    enabled: search.length > 1,
    queryFn: async () => {
      const { data } = await supabase
        .from("product_variants")
        .select("id, size, sku, barcode, sale_price, product:products!inner(name, color, sale_price, promotional_price)")
        .is("deleted_at", null)
        .or(`sku.ilike.%${search}%,barcode.ilike.%${search}%`)
        .limit(10);
      return data ?? [];
    },
  });

  useEffect(() => {
    const first = rows[0];
    if (previewRef.current && first?.barcode) {
      try {
        JsBarcode(previewRef.current, first.barcode, { format: "CODE128", height: 40, displayValue: true, fontSize: 12 });
      } catch {}
    }
  }, [rows]);

  function addRow(v: any) {
    if (rows.find((r) => r.variant_id === v.id)) return;
    const price = v.product.promotional_price ?? v.product.sale_price ?? v.sale_price;
    setRows([...rows, {
      variant_id: v.id,
      label: `${v.product.name} · ${v.product.color ?? ""} · ${v.size}`,
      sku: v.sku ?? "",
      barcode: v.barcode || v.sku || "",
      price: price ? Number(price) : null,
      qty: "1",
    }]);
    setSearch("");
  }

  async function generatePdf() {
    const w = Number(labelWidth);
    const h = Number(labelHeight);
    if (!w || !h) { toast.error("Dimensões inválidas"); return; }
    const pdf = new jsPDF({ unit: "mm", format: [w, h], orientation: w > h ? "landscape" : "portrait" });

    let first = true;
    for (const r of rows) {
      const qty = Math.max(1, Number(r.qty));
      for (let i = 0; i < qty; i++) {
        if (!first) pdf.addPage([w, h], w > h ? "landscape" : "portrait");
        first = false;

        let y = 3;
        pdf.setFontSize(7);
        if (showName) { pdf.text(r.label.slice(0, 40), 2, y); y += 3; }
        if (showPrice && r.price != null) { pdf.setFontSize(9); pdf.text(formatBRL(r.price), 2, y); y += 3.5; }

        // barcode
        if (r.barcode) {
          const canvas = document.createElement("canvas");
          try {
            JsBarcode(canvas, r.barcode, { format: "CODE128", height: 30, displayValue: showSku, fontSize: 10, margin: 0 });
            const dataUrl = canvas.toDataURL("image/png");
            const bcH = Math.min(h - y - 1, 12);
            pdf.addImage(dataUrl, "PNG", 2, y, w - 4, bcH);
          } catch (e) {
            pdf.setFontSize(7);
            pdf.text(`SKU: ${r.sku}`, 2, y + 4);
          }
        }
      }
    }
    pdf.save("etiquetas.pdf");

    // registrar auditoria
    const total = rows.reduce((acc, r) => acc + Number(r.qty), 0);
    await supabase.from("audit_logs").insert({
      module: "etiquetas",
      action: "print",
      entity_type: "labels",
      new_data: { count: total, items: rows.length } as any,
      user_id: (await supabase.auth.getUser()).data.user?.id,
      organization_id: (await supabase.from("profiles").select("organization_id").eq("id", (await supabase.auth.getUser()).data.user?.id ?? "").maybeSingle()).data?.organization_id,
    });
  }

  return (
    <div>
      <PageHeader title="Etiquetas" description="Gere etiquetas CODE128 usando o SKU ou código de barras." />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle>Adicionar variações</CardTitle></CardHeader>
            <CardContent>
              <div className="relative">
                <Input placeholder="Buscar por SKU / código de barras..." value={search} onChange={(e) => setSearch(e.target.value)} />
                {found.data && found.data.length > 0 && search && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg">
                    {found.data.map((v: any) => (
                      <button key={v.id} type="button" onClick={() => addRow(v)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
                        {v.product.name} · {v.product.color} · {v.size} — {v.sku ?? "sem SKU"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Etiquetas a gerar</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>SKU / código</TableHead>
                    <TableHead className="w-24">Qtd</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Nenhuma etiqueta.</TableCell></TableRow>
                  ) : rows.map((r, i) => (
                    <TableRow key={r.variant_id}>
                      <TableCell className="text-sm">{r.label}</TableCell>
                      <TableCell className="font-mono text-xs">{r.barcode}</TableCell>
                      <TableCell><Input value={r.qty} onChange={(e) => setRows(rows.map((x, idx) => idx === i ? { ...x, qty: e.target.value } : x))} /></TableCell>
                      <TableCell><Button variant="ghost" size="icon" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Modelo</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Largura (mm)</Label><Input value={labelWidth} onChange={(e) => setLabelWidth(e.target.value)} /></div>
                <div><Label>Altura (mm)</Label><Input value={labelHeight} onChange={(e) => setLabelHeight(e.target.value)} /></div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={showName} onCheckedChange={(v) => setShowName(!!v)} />Mostrar nome</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={showPrice} onCheckedChange={(v) => setShowPrice(!!v)} />Mostrar preço</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={showSku} onCheckedChange={(v) => setShowSku(!!v)} />Mostrar SKU sob o código</label>
              </div>
              <div className="rounded-md border p-2 text-center">
                <canvas ref={previewRef} className="mx-auto max-w-full" />
                {rows.length === 0 && <p className="text-xs text-muted-foreground py-6">Adicione uma variação para pré-visualizar.</p>}
              </div>
            </CardContent>
          </Card>
          <Button size="lg" className="w-full" onClick={generatePdf} disabled={rows.length === 0}>
            <Printer className="mr-2 h-4 w-4" />Gerar PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
