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
  /** Layout preset. "qsf-standard" = padrão Quero Ser Fit; "compact" = layout genérico legado. */
  layout?: "compact" | "qsf-standard";
  /** Texto de política impresso no rodapé (apenas no layout QSF). */
  policy_text?: string;
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

export const DEFAULT_EXCHANGE_POLICY =
  "TROCA: 7 DIAS CORRIDOS, APENAS NA LOJA FÍSICA, COM ETIQUETA. NÃO TROCAMOS: ITENS PROMOCIONAIS, ITENS CLAROS, SEM ETIQUETA OU APÓS O PRAZO.";

/** Template padrão QSF: 50 × 75 mm retrato. */
export const QSF_DEFAULT_TEMPLATE: LabelTemplate = {
  width: 50,
  height: 75,
  margin_top: 3,
  margin_right: 3,
  margin_bottom: 3,
  margin_left: 3,
  font_family: "helvetica",
  font_size: 7,
  show_name: true,
  show_color: true,
  show_size: true,
  show_sku: true,
  show_barcode: true,
  show_price: true,
  layout: "qsf-standard",
  policy_text: DEFAULT_EXCHANGE_POLICY,
};

function makeBarcodeDataUrl(sku: string, targetWidthMm: number, targetHeightMm: number) {
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

function formatBRLPrice(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function drawQsfLabel(
  pdf: jsPDF,
  it: LabelPayload,
  template: LabelTemplate,
  orgName: string,
) {
  const w = Number(template.width);
  const h = Number(template.height);
  const ml = Number(template.margin_left);
  const mr = Number(template.margin_right);
  const mt = Number(template.margin_top);
  const mb = Number(template.margin_bottom);
  const innerW = Math.max(1, w - ml - mr);
  const innerH = Math.max(1, h - mt - mb);
  const cx = ml + innerW / 2;
  const font = template.font_family || "helvetica";
  const policy = (template.policy_text ?? DEFAULT_EXCHANGE_POLICY).toUpperCase();

  // 1) Marca no topo (nome da loja em maiúsculas, bold)
  let y = mt + 3;
  if (orgName) {
    pdf.setFont(font, "bold");
    pdf.setFontSize(11);
    pdf.text(truncateForWidth(pdf, orgName.toUpperCase(), innerW), cx, y, { align: "center" });
    y += 3.5;
  }

  // 2) Produto + cor (até 2 linhas) + tamanho
  const parts: string[] = [];
  if (it.product_name_snapshot) parts.push(it.product_name_snapshot);
  if (it.color_snapshot) parts.push(it.color_snapshot);
  const productLine = parts.join(" - ").toUpperCase();

  pdf.setFont(font, "normal");
  pdf.setFontSize(7);
  const prodLines = pdf.splitTextToSize(productLine, innerW).slice(0, 2);
  for (const line of prodLines) {
    pdf.text(line, cx, y + 2.2, { align: "center" });
    y += 2.8;
  }

  if (it.size_snapshot) {
    const sizeText = it.size_snapshot === SIZE_SINGLE ? SIZE_SINGLE_LABEL : it.size_snapshot;
    pdf.setFont(font, "bold");
    pdf.text(`TAM: ${sizeText.toUpperCase()}`, cx, y + 2.4, { align: "center" });
    pdf.setFont(font, "normal");
    y += 3;
  }

  // Reservar altura fixa para preço + política + barcode a partir do rodapé
  const priceBoxH = 10;
  const policyBoxH = 9;
  const barcodeH = 11;
  const barcodeNumH = 3;

  // 3) Barcode + número curto abaixo
  const barcodeY = y + 2;
  const sku = (it.sku_snapshot ?? "").trim();
  if (sku) {
    const dataUrl = makeBarcodeDataUrl(sku, innerW, barcodeH);
    if (dataUrl) {
      pdf.addImage(dataUrl, "PNG", ml, barcodeY, innerW, barcodeH);
    }
    // Número curto (últimos 4-5 dígitos) espaçados, imitando a etiqueta física
    const digits = sku.replace(/\D+/g, "");
    const shortNum = digits.length >= 4 ? digits.slice(-Math.min(5, digits.length)) : sku.slice(-5);
    pdf.setFont(font, "normal");
    pdf.setFontSize(7);
    pdf.text(shortNum.split("").join(" "), cx, barcodeY + barcodeH + barcodeNumH, { align: "center" });
  }
  y = barcodeY + barcodeH + barcodeNumH + 1;

  // 4) Política (fonte muito pequena, até 3 linhas)
  const policyY = mt + innerH - priceBoxH - policyBoxH;
  pdf.setFont(font, "normal");
  pdf.setFontSize(4.4);
  const policyLines = pdf.splitTextToSize(policy, innerW).slice(0, 3);
  policyLines.forEach((line, i) => {
    pdf.text(line, cx, policyY + 1.8 + i * 2.1, { align: "center" });
  });

  // 5) Preço grande no rodapé
  if (it.price_snapshot != null) {
    pdf.setFont(font, "bold");
    pdf.setFontSize(18);
    pdf.text(formatBRLPrice(Number(it.price_snapshot)), cx, mt + innerH - 1, { align: "center" });
  }
}

function drawCompactLabel(
  pdf: jsPDF,
  it: LabelPayload,
  template: LabelTemplate,
  orgName: string,
) {
  const w = Number(template.width);
  const h = Number(template.height);
  const ml = Number(template.margin_left);
  const mr = Number(template.margin_right);
  const mt = Number(template.margin_top);
  const mb = Number(template.margin_bottom);
  const innerW = Math.max(1, w - ml - mr);
  const innerH = Math.max(1, h - mt - mb);

  let y = mt;
  pdf.setFont(template.font_family || "helvetica", "normal");

  if (orgName) {
    pdf.setFontSize(Math.max(5, Number(template.font_size) - 2));
    pdf.text(truncateForWidth(pdf, orgName, innerW), ml, y + 2.5);
    y += 3.2;
  }

  if (template.show_name && it.product_name_snapshot) {
    pdf.setFontSize(Number(template.font_size));
    pdf.setFont(template.font_family || "helvetica", "bold");
    pdf.text(truncateForWidth(pdf, it.product_name_snapshot, innerW), ml, y + 3);
    pdf.setFont(template.font_family || "helvetica", "normal");
    y += 3.8;
  }

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

  if (template.show_price && it.price_snapshot != null) {
    pdf.setFont(template.font_family || "helvetica", "bold");
    pdf.setFontSize(Number(template.font_size) + 1);
    pdf.text(formatBRLPrice(Number(it.price_snapshot)), ml + innerW, y + 3, { align: "right" });
    pdf.setFont(template.font_family || "helvetica", "normal");
  }

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
}

export function generateLabelPdf(
  items: LabelPayload[],
  template: LabelTemplate,
  orgName: string,
): Blob {
  const w = Number(template.width);
  const h = Number(template.height);

  const pdf = new jsPDF({
    unit: "mm",
    format: [w, h],
    orientation: w >= h ? "landscape" : "portrait",
  });

  const pages: LabelPayload[] = [];
  for (const it of items) {
    for (let i = 0; i < it.requested_quantity; i++) pages.push(it);
  }
  if (pages.length === 0) {
    pdf.setFontSize(8);
    pdf.text("Sem etiquetas.", template.margin_left, template.margin_top + 4);
    return pdf.output("blob");
  }

  const layout = template.layout ?? "qsf-standard";

  pages.forEach((it, idx) => {
    if (idx > 0) pdf.addPage([w, h], w >= h ? "landscape" : "portrait");
    if (layout === "qsf-standard") {
      drawQsfLabel(pdf, it, template, orgName);
    } else {
      drawCompactLabel(pdf, it, template, orgName);
    }
  });

  return pdf.output("blob");
}
