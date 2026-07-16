import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import { SIZE_SINGLE, SIZE_SINGLE_LABEL } from "@/lib/erp";

// Etiqueta física por página do PDF. Dimensões em mm (padrão do label_templates).
export type LabelTemplate = {
  width: number;
  height: number;
  margin_top: number;
  margin_right: number;
  margin_bottom: number;
  margin_left: number;
  font_family: string;
  font_size: number;
  show_name: boolean;
  show_color: boolean;
  show_size: boolean;
  show_sku: boolean;
  show_barcode: boolean;
  show_price: boolean;
};

export type LabelPayload = {
  print_item_id: string;
  requested_quantity: number;
  product_name_snapshot: string;
  color_snapshot: string | null;
  size_snapshot: string | null;
  sku_snapshot: string | null;
  price_snapshot: number | null;
};

// Limite de segurança operacional: também validado no RPC.
export const MAX_LABELS_PER_ATTEMPT = 500;

function makeBarcodeDataUrl(sku: string, targetWidthMm: number, targetHeightMm: number) {
  // 1 mm ≈ 3.78 px @96dpi. Geramos com boa resolução para não borrar.
  const scale = 6;
  const c = document.createElement("canvas");
  try {
    JsBarcode(c, sku, {
      format: "CODE128",
      displayValue: false,
      margin: 0,
      height: Math.max(20, Math.round(targetHeightMm * scale)),
      width: Math.max(1, Math.round((targetWidthMm * scale) / (sku.length * 11))),
    });
    return c.toDataURL("image/png");
  } catch {
    return null;
  }
}

function truncateForWidth(pdf: jsPDF, text: string, maxWidthMm: number): string {
  if (pdf.getTextWidth(text) <= maxWidthMm) return text;
  let s = text;
  while (s.length > 3 && pdf.getTextWidth(s + "…") > maxWidthMm) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

export function generateLabelPdf(
  items: LabelPayload[],
  template: LabelTemplate,
  orgName: string,
): Blob {
  const w = Number(template.width);
  const h = Number(template.height);
  const ml = Number(template.margin_left);
  const mr = Number(template.margin_right);
  const mt = Number(template.margin_top);
  const mb = Number(template.margin_bottom);
  const innerW = Math.max(1, w - ml - mr);
  const innerH = Math.max(1, h - mt - mb);

  const pdf = new jsPDF({
    unit: "mm",
    format: [w, h],
    orientation: w >= h ? "landscape" : "portrait",
  });

  // Contamos todas as páginas (uma por etiqueta física).
  const pages: LabelPayload[] = [];
  for (const it of items) {
    for (let i = 0; i < it.requested_quantity; i++) pages.push(it);
  }
  if (pages.length === 0) {
    pdf.setFontSize(8);
    pdf.text("Sem etiquetas.", ml, mt + 4);
    return pdf.output("blob");
  }

  pages.forEach((it, idx) => {
    if (idx > 0) pdf.addPage([w, h], w >= h ? "landscape" : "portrait");

    let y = mt;
    pdf.setFont(template.font_family || "helvetica", "normal");

    // Cabeçalho: nome da loja
    if (orgName) {
      pdf.setFontSize(Math.max(5, Number(template.font_size) - 2));
      pdf.text(truncateForWidth(pdf, orgName, innerW), ml, y + 2.5);
      y += 3.2;
    }

    // Nome do produto
    if (template.show_name && it.product_name_snapshot) {
      pdf.setFontSize(Number(template.font_size));
      pdf.setFont(template.font_family || "helvetica", "bold");
      pdf.text(truncateForWidth(pdf, it.product_name_snapshot, innerW), ml, y + 3);
      pdf.setFont(template.font_family || "helvetica", "normal");
      y += 3.8;
    }

    // Cor / tamanho
    const meta: string[] = [];
    if (template.show_color && it.color_snapshot) meta.push(it.color_snapshot);
    if (template.show_size && it.size_snapshot) {
      meta.push(it.size_snapshot === SIZE_SINGLE ? SIZE_SINGLE_LABEL : it.size_snapshot);
    }
    if (meta.length) {
      pdf.setFontSize(Math.max(5, Number(template.font_size) - 2));
      pdf.text(truncateForWidth(pdf, meta.join(" · "), innerW), ml, y + 2.5);
      y += 3;
    }

    // Preço (quando template permite)
    if (template.show_price && it.price_snapshot != null) {
      pdf.setFont(template.font_family || "helvetica", "bold");
      pdf.setFontSize(Number(template.font_size) + 1);
      const priceTxt = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(Number(it.price_snapshot));
      pdf.text(priceTxt, ml + innerW, y + 3, { align: "right" });
      pdf.setFont(template.font_family || "helvetica", "normal");
    }

    // Barcode + SKU no rodapé da área útil
    const sku = (it.sku_snapshot ?? "").trim();
    if (template.show_barcode && sku) {
      const barcodeH = Math.max(4, Math.min(innerH * 0.45, innerH - (y - mt) - 4));
      const barcodeY = mt + innerH - barcodeH - (template.show_sku ? 3 : 0.5);
      const dataUrl = makeBarcodeDataUrl(sku, innerW, barcodeH);
      if (dataUrl) {
        pdf.addImage(dataUrl, "PNG", ml, barcodeY, innerW, barcodeH);
      }
    }
    if (template.show_sku && sku) {
      pdf.setFontSize(Math.max(5, Number(template.font_size) - 2));
      pdf.text(sku, ml + innerW / 2, mt + innerH - 0.5, { align: "center" });
    }
  });

  return pdf.output("blob");
}
