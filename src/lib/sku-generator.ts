/**
 * Gerador e Padronizador de SKUs Simplificados para Vestuário / FitGestor ERP
 */

/**
 * Remove acentos e caracteres especiais e converte para UPPERCASE
 */
export function sanitizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

/**
 * Gera uma abreviação curta de 2 a 3 letras para um nome (ex: "Camiseta" -> "CAM", "Preto" -> "PR")
 */
export function getAbbreviation(text: string, length = 3): string {
  const clean = sanitizeText(text);
  if (!clean) return "XX";
  if (clean.length <= length) return clean;

  // Tenta pegar as consoantes ou primeiras letras
  if (length === 2) {
    return clean.slice(0, 2);
  }
  return clean.slice(0, length);
}

/**
 * Gera um SKU simples legível e curto.
 * Formato Padrão: [PRODUTO]-[COR]-[TAMANHO] (Ex: CAM-PR-M, LEG-AZ-G)
 */
export function generateSimpleSKU(
  productName: string,
  color?: string | null,
  size?: string | null,
  idOrSeq?: number | string
): string {
  const prodAbbr = getAbbreviation(productName || "PEC", 3);
  const colorAbbr = color ? getAbbreviation(color, 2) : "UN";
  const sizeAbbr = size ? sanitizeText(size) : "UN";

  let sku = `${prodAbbr}-${colorAbbr}-${sizeAbbr}`;

  if (idOrSeq) {
    const seqStr = String(idOrSeq).padStart(3, "0");
    sku = `${sku}-${seqStr}`;
  }

  return sku;
}

/**
 * Formato Numérico Simplificado: [ID_3_DIGITOS]-[TAMANHO] (Ex: 101-M, 105-G)
 */
export function generateNumericSKU(idOrSeq: number | string, size?: string | null): string {
  const seqStr = String(idOrSeq).padStart(3, "0");
  const sizeAbbr = size ? sanitizeText(size) : "UN";
  return `${seqStr}-${sizeAbbr}`;
}

/**
 * Garante que o SKU seja válido e normalizado para a Shopify e FitGestor
 */
export function ensureValidSKU(sku?: string | null, fallbackProductName = "PEC", fallbackSize = "M"): string {
  if (sku && sku.trim().length >= 2) {
    return sanitizeText(sku);
  }
  return generateSimpleSKU(fallbackProductName, null, fallbackSize, Math.floor(Math.random() * 899 + 100));
}
