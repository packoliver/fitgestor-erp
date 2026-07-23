import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Printer } from "lucide-react";
import { toast } from "sonner";
import {
  generateLabelPdf,
  QSF_DEFAULT_TEMPLATE,
  DEFAULT_EXCHANGE_POLICY,
  type LabelPayload,
  type LabelTemplate,
} from "@/lib/label-pdf";

export const Route = createFileRoute("/_authenticated/etiquetas")({
  component: EtiquetasPage,
});

type Row = {
  variant_id: string;
  product_name: string;
  color: string | null;
  size: string | null;
  sku: string;
  price: number | null;
  qty: string;
};

type PresetKey = "qsf-standard" | "compact";

const PRESETS: Record<PresetKey, { label: string; template: LabelTemplate }> = {
  "qsf-standard": {
    label: "Padrão Quero Ser Fit (50 × 75 mm)",
    template: QSF_DEFAULT_TEMPLATE,
  },
  compact: {
    label: "Compacto (50 × 30 mm)",
    template: {
      width: 50,
      height: 30,
      margin_top: 2,
      margin_right: 2,
      margin_bottom: 2,
      margin_left: 2,
      font_family: "helvetica",
      font_size: 7,
      show_name: true,
      show_color: true,
      show_size: true,
      show_sku: true,
      show_barcode: true,
      show_price: true,
      layout: "compact",
    },
  },
};

const STORAGE_KEY = "fg:labels:preset";

function EtiquetasPage() {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [preset, setPreset] = useState<PresetKey>(() => {
    if (typeof window === "undefined") return "qsf-standard";
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "compact" ? "compact" : "qsf-standard";
  });
  const [labelWidth, setLabelWidth] = useState(String(PRESETS[preset].template.width));
  const [labelHeight, setLabelHeight] = useState(String(PRESETS[preset].template.height));
  const [policyText, setPolicyText] = useState(DEFAULT_EXCHANGE_POLICY);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, preset);
    setLabelWidth(String(PRESETS[preset].template.width));
    setLabelHeight(String(PRESETS[preset].template.height));
  }, [preset]);

  const org = useQuery({
    queryKey: ["labels-org-name"],
    queryFn: async () => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return "";
      const prof = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
      const orgId = prof.data?.organization_id;
      if (!orgId) return "";
      const o = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
      return o.data?.name ?? "";
    },
  });

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

  const previewBlobUrl = useMemo(() => {
    const first = rows[0];
    if (!first) return null;
    const template: LabelTemplate = {
      ...PRESETS[preset].template,
      width: Number(labelWidth) || PRESETS[preset].template.width,
      height: Number(labelHeight) || PRESETS[preset].template.height,
      policy_text: policyText,
    };
    const sample: LabelPayload = {
      print_item_id: first.variant_id,
      requested_quantity: 1,
      product_name_snapshot: first.product_name,
      color_snapshot: first.color,
      size_snapshot: first.size,
      sku_snapshot: first.sku,
      price_snapshot: first.price,
    };
    try {
      const blob = generateLabelPdf([sample], template, org.data ?? "");
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [rows, preset, labelWidth, labelHeight, policyText, org.data]);

  useEffect(() => {
    return () => {
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    };
  }, [previewBlobUrl]);

  function addRow(v: any) {
    if (rows.find((r) => r.variant_id === v.id)) return;
    const price = v.product.promotional_price ?? v.product.sale_price ?? v.sale_price;
    setRows([
      ...rows,
      {
        variant_id: v.id,
        product_name: v.product.name,
        color: v.product.color ?? null,
        size: v.size ?? null,
        sku: v.sku ?? v.barcode ?? "",
        price: price ? Number(price) : null,
        qty: "1",
      },
    ]);
    setSearch("");
  }

  async function generatePdf() {
    const w = Number(labelWidth);
    const h = Number(labelHeight);
    if (!w || !h) {
      toast.error("Dimensões inválidas");
      return;
    }
    if (rows.length === 0) return;

    const template: LabelTemplate = {
      ...PRESETS[preset].template,
      width: w,
      height: h,
      policy_text: policyText,
    };

    const items: LabelPayload[] = rows.map((r) => ({
      print_item_id: r.variant_id,
      requested_quantity: Math.max(1, Number(r.qty) || 1),
      product_name_snapshot: r.product_name,
      color_snapshot: r.color,
      size_snapshot: r.size,
      sku_snapshot: r.sku,
      price_snapshot: r.price,
    }));

    const blob = generateLabelPdf(items, template, org.data ?? "");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");

    // registrar auditoria
    const total = items.reduce((acc, r) => acc + r.requested_quantity, 0);
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;
    const orgId = (await supabase.from("profiles").select("organization_id").eq("id", userId).maybeSingle()).data?.organization_id;
    if (!orgId) return;
    await supabase.from("audit_logs").insert({
      module: "etiquetas",
      action: "print",
      entity_type: "labels",
      new_data: { count: total, items: rows.length, preset } as any,
      user_id: userId,
      organization_id: orgId,
    });
  }

  return (
    <div>
      <PageHeader
        title="Etiquetas"
        description="Modelo padrão Quero Ser Fit com marca, código de barras, política de troca e preço em destaque."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Adicionar variações</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Input
                  placeholder="Buscar por SKU / código de barras..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {found.data && found.data.length > 0 && search && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg">
                    {found.data.map((v: any) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => addRow(v)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                      >
                        {v.product.name} · {v.product.color} · {v.size} — {v.sku ?? "sem SKU"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Etiquetas a gerar</CardTitle>
            </CardHeader>
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
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                        Nenhuma etiqueta.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r, i) => (
                      <TableRow key={r.variant_id}>
                        <TableCell className="text-sm">
                          {r.product_name}
                          {r.color ? ` · ${r.color}` : ""}
                          {r.size ? ` · ${r.size}` : ""}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                        <TableCell>
                          <Input
                            value={r.qty}
                            onChange={(e) =>
                              setRows(rows.map((x, idx) => (idx === i ? { ...x, qty: e.target.value } : x)))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Modelo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Preset</Label>
                <Select value={preset} onValueChange={(v) => setPreset(v as PresetKey)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {PRESETS[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Largura (mm)</Label>
                  <Input value={labelWidth} onChange={(e) => setLabelWidth(e.target.value)} />
                </div>
                <div>
                  <Label>Altura (mm)</Label>
                  <Input value={labelHeight} onChange={(e) => setLabelHeight(e.target.value)} />
                </div>
              </div>
              {preset === "qsf-standard" && (
                <div className="space-y-1">
                  <Label>Política de troca</Label>
                  <Textarea
                    rows={4}
                    value={policyText}
                    onChange={(e) => setPolicyText(e.target.value)}
                    className="text-xs"
                  />
                </div>
              )}
              <div className="rounded-md border p-2 text-center bg-muted/40">
                {previewBlobUrl ? (
                  <iframe
                    key={previewBlobUrl}
                    src={previewBlobUrl}
                    title="Pré-visualização da etiqueta"
                    className="w-full h-72 bg-white rounded"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground py-16">
                    Adicione uma variação para pré-visualizar.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Button size="lg" className="w-full" onClick={generatePdf} disabled={rows.length === 0}>
            <Printer className="mr-2 h-4 w-4" />
            Gerar PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
