import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { DEFAULT_EXCHANGE_POLICY, type LabelTemplate } from "@/lib/label-pdf";
import {
  createLabelTemplate,
  updateLabelTemplate,
  type CustomLabelTemplate,
  type LabelTemplateInput,
} from "@/lib/label-templates-repo";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Modelo sendo editado (undefined = criar um novo). */
  editing?: CustomLabelTemplate;
  /** Valores iniciais ao criar um novo modelo (ex: duplicar o modelo selecionado). */
  startFrom?: { name: string; template: LabelTemplate };
  onSaved: (id: string) => void;
};

type FormState = {
  name: string;
  layout: LabelTemplate["layout"];
  width: string;
  height: string;
  columns: string;
  column_spacing: string;
  margin_top: string;
  margin_right: string;
  margin_bottom: string;
  margin_left: string;
  font_size: string;
  show_name: boolean;
  show_color: boolean;
  show_size: boolean;
  show_sku: boolean;
  show_barcode: boolean;
  show_price: boolean;
  policy_text: string;
};

function toForm(name: string, t: LabelTemplate): FormState {
  return {
    name,
    layout: t.layout ?? "qsf-standard",
    width: String(t.width),
    height: String(t.height),
    columns: String(t.columns ?? 1),
    column_spacing: String(t.column_spacing ?? ""),
    margin_top: String(t.margin_top),
    margin_right: String(t.margin_right),
    margin_bottom: String(t.margin_bottom),
    margin_left: String(t.margin_left),
    font_size: String(t.font_size),
    show_name: t.show_name,
    show_color: t.show_color,
    show_size: t.show_size,
    show_sku: t.show_sku,
    show_barcode: t.show_barcode,
    show_price: t.show_price,
    policy_text: t.policy_text ?? DEFAULT_EXCHANGE_POLICY,
  };
}

const BLANK: FormState = toForm("", {
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
  layout: "qsf-standard",
});

export function LabelTemplateEditorDialog({ open, onOpenChange, editing, startFrom, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm(toForm(editing.name, editing.template));
    } else if (startFrom) {
      setForm(toForm(`${startFrom.name} (cópia)`, startFrom.template));
    } else {
      setForm(BLANK);
    }
  }, [open, editing, startFrom]);

  const columnsNum = Math.max(1, Math.floor(Number(form.columns) || 1));

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Dê um nome para o modelo.");
      return;
    }
    const width = Number(form.width);
    const height = Number(form.height);
    if (!width || !height) {
      toast.error("Largura e altura precisam ser números válidos.");
      return;
    }

    const template: LabelTemplate = {
      width,
      height,
      margin_top: Number(form.margin_top) || 0,
      margin_right: Number(form.margin_right) || 0,
      margin_bottom: Number(form.margin_bottom) || 0,
      margin_left: Number(form.margin_left) || 0,
      font_family: "helvetica",
      font_size: Number(form.font_size) || 7,
      show_name: form.show_name,
      show_color: form.show_color,
      show_size: form.show_size,
      show_sku: form.show_sku,
      show_barcode: form.show_barcode,
      show_price: form.show_price,
      layout: form.layout,
      policy_text: form.policy_text,
      columns: columnsNum,
      column_spacing: columnsNum > 1 ? Number(form.column_spacing) || width : undefined,
    };

    const input: LabelTemplateInput = { name: form.name.trim(), template };

    setSaving(true);
    try {
      const id = editing ? editing.id : await createLabelTemplate(input);
      if (editing) await updateLabelTemplate(editing.id, input);
      toast.success(editing ? "Modelo atualizado." : "Modelo criado.");
      onSaved(id);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar o modelo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar modelo de etiqueta" : "Novo modelo de etiqueta"}</DialogTitle>
          <DialogDescription>
            Configure as dimensões, colunas e conteúdo da etiqueta — como na tela de etiquetas da Olist.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-4">
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nome do modelo</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex: Etiqueta bobina 2 colunas" />
            </div>

            <div className="space-y-1">
              <Label>Estilo visual</Label>
              <Select value={form.layout} onValueChange={(v) => set("layout", v as LabelTemplate["layout"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qsf-standard">Padrão QSF (marca, política, preço em destaque)</SelectItem>
                  <SelectItem value="thermal">Térmica compacta (nome, tamanho, preço, código)</SelectItem>
                  <SelectItem value="compact">Compacto (linhas simples)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Largura (mm)</Label>
                <Input value={form.width} onChange={(e) => set("width", e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-1">
                <Label>Altura (mm)</Label>
                <Input value={form.height} onChange={(e) => set("height", e.target.value)} inputMode="decimal" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Colunas por linha</Label>
                <Input value={form.columns} onChange={(e) => set("columns", e.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1">
                <Label>Espaçamento horizontal (mm)</Label>
                <Input
                  value={form.column_spacing}
                  onChange={(e) => set("column_spacing", e.target.value)}
                  inputMode="decimal"
                  disabled={columnsNum <= 1}
                  placeholder={columnsNum <= 1 ? "só com 2+ colunas" : "ex: 75"}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Margens da página (mm)</Label>
              <div className="grid grid-cols-4 gap-2">
                <Input value={form.margin_top} onChange={(e) => set("margin_top", e.target.value)} placeholder="topo" inputMode="decimal" />
                <Input value={form.margin_right} onChange={(e) => set("margin_right", e.target.value)} placeholder="direita" inputMode="decimal" />
                <Input value={form.margin_bottom} onChange={(e) => set("margin_bottom", e.target.value)} placeholder="baixo" inputMode="decimal" />
                <Input value={form.margin_left} onChange={(e) => set("margin_left", e.target.value)} placeholder="esquerda" inputMode="decimal" />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Tamanho da fonte (pt)</Label>
              <Input value={form.font_size} onChange={(e) => set("font_size", e.target.value)} inputMode="decimal" className="w-32" />
            </div>

            <div className="space-y-2">
              <Label>Conteúdo da etiqueta</Label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {(
                  [
                    ["show_name", "Nome do produto"],
                    ["show_color", "Cor"],
                    ["show_size", "Tamanho"],
                    ["show_sku", "SKU / código"],
                    ["show_barcode", "Código de barras"],
                    ["show_price", "Preço"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-sm">{label}</span>
                    <Switch checked={form[key]} onCheckedChange={(v) => set(key, v)} />
                  </div>
                ))}
              </div>
            </div>

            {form.layout === "qsf-standard" && (
              <div className="space-y-1">
                <Label>Texto de política (rodapé)</Label>
                <Textarea rows={3} value={form.policy_text} onChange={(e) => set("policy_text", e.target.value)} className="text-xs" />
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar modelo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
