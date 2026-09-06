/**
 * Utilitários para geração e validação de códigos de barra (EAN-13) e SKUs automáticos.
 */

/**
 * Calcula o dígito verificador para uma string numérica de 12 dígitos de acordo com a especificação EAN-13.
 */
export function calculateEAN13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.exec(first12)) {
    throw new Error("A base para EAN-13 deve possuir exatamente 12 dígitos numéricos.");
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(first12[i], 10);
    // Posições ímpares (0, 2, 4...) peso 1; Posições pares (1, 3, 5...) peso 3 (1-indexed: ímpar=1, par=3)
    sum += i % 2 === 0 ? digit * 1 : digit * 3;
  }
  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

/**
 * Gera um código de barras EAN-13 válido (13 dígitos numéricos com prefixo 789 do Brasil).
 */
export function generateEAN13(prefix: string = "789"): string {
  // Prefixo de 3 dígitos (padrão Brasil 789 se não especificado)
  const cleanPrefix = prefix.replace(/\D/g, "").slice(0, 3).padEnd(3, "7");
  // 9 dígitos numéricos aleatórios
  let randomBody = "";
  for (let i = 0; i < 9; i++) {
    randomBody += Math.floor(Math.random() * 10).toString();
  }
  const first12 = cleanPrefix + randomBody;
  const checkDigit = calculateEAN13CheckDigit(first12);
  return first12 + checkDigit.toString();
}

/**
 * Normaliza um texto para uso em SKU (remove acentos, caracteres especiais e limita tamanho).
 */
export function sanitizeForSKU(text: string, maxLen: number = 4): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, maxLen);
}

/**
 * Gera um SKU automático baseado no nome do produto, cor e tamanho.
 * Exemplo: PRD-PRE-M-482
 */
export function generateSKU(productName: string, color?: string, size?: string): string {
  const namePart = sanitizeForSKU(productName, 3) || "PRD";
  const colorPart = sanitizeForSKU(color || "", 3) || "UNI";
  const sizePart = sanitizeForSKU(size || "", 3) || "U";
  const randomSuffix = Math.floor(100 + Math.random() * 900).toString(); // 3 dígitos

  return `${namePart}-${colorPart}-${sizePart}-${randomSuffix}`;
}
