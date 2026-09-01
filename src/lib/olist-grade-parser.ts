/**
 * Parser robusto da "grade" de variações da Olist/Tiny (API v2).
 *
 * A grade vem como lista de pares atributo/valor em ordem arbitrária e com
 * nomes de chave inconsistentes entre contas:
 *   [{ chave: "Cor", valor: "Preto" }, { nome: "Tamanho", opcao: "M" }]
 *   { "Tam": "M", "Cor": "Preto" }               (objeto simples)
 *   [{ tipo: "numeração", descricao_valor: "38" }]
 *
 * Nunca assume posição fixa (grade[0] = tamanho) — identifica pelo nome do
 * atributo, ignorando acentos e caixa.
 */

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function norm(s: unknown): string {
  return stripAccents(String(s ?? "")).trim().toLowerCase();
}

const ATTR_KEYS = ["nome", "chave", "descricao", "descrição", "tipo", "atributo", "campo", "key"];
const VALUE_KEYS = ["valor", "value", "opcao", "opção", "descricao_valor", "descricaovalor", "conteudo", "conteúdo"];

const COLOR_NAMES = new Set(["cor", "color", "cores", "colors", "cor principal"]);
const SIZE_NAMES = new Set([
  "tam",
  "tamanho",
  "tamanhos",
  "size",
  "sizes",
  "numeracao",
  "numero",
  "num",
  "manequim",
]);

type Pair = { attr: string; value: string };

/** Extrai os pares atributo/valor de qualquer formato de grade conhecido. */
function extractPairs(grade: unknown): Pair[] {
  const pairs: Pair[] = [];
  const pushEntry = (entry: any) => {
    if (entry == null) return;
    const item = entry?.grade ?? entry?.item ?? entry;
    if (typeof item === "string") {
      // "Cor: Preto" ou "Tamanho=M"
      const m = item.split(/[:=]/);
      if (m.length >= 2) pairs.push({ attr: m[0]!, value: m.slice(1).join(":").trim() });
      else pairs.push({ attr: "", value: item.trim() });
      return;
    }
    if (typeof item !== "object") return;

    let attr = "";
    for (const k of ATTR_KEYS) {
      const v = (item as any)[k];
      if (typeof v === "string" && v.trim()) {
        attr = v.trim();
        break;
      }
    }
    let value = "";
    for (const k of VALUE_KEYS) {
      const v = (item as any)[k];
      if ((typeof v === "string" || typeof v === "number") && String(v).trim()) {
        value = String(v).trim();
        break;
      }
    }

    if (attr && value) {
      pairs.push({ attr, value });
      return;
    }

    // Objeto simples do tipo { Cor: "Preto", Tam: "M" }
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      if (ATTR_KEYS.includes(norm(k)) || VALUE_KEYS.includes(norm(k))) continue;
      if ((typeof v === "string" || typeof v === "number") && String(v).trim()) {
        pairs.push({ attr: k, value: String(v).trim() });
      }
    }
    if (!attr && value) pairs.push({ attr: "", value });
  };

  if (Array.isArray(grade)) grade.forEach(pushEntry);
  else if (grade && typeof grade === "object") pushEntry(grade);
  else if (typeof grade === "string" && grade.trim()) pushEntry(grade);

  return pairs;
}

function matches(attr: string, names: Set<string>): boolean {
  const n = norm(attr);
  if (!n) return false;
  if (names.has(n)) return true;
  return [...names].some((name) => name.length >= 3 && n.includes(name));
}

export type ParsedVariation = { color: string | null; size: string };

/**
 * Retorna cor e tamanho de uma variação da Olist, independentemente da ordem
 * da grade. Fallback: descrição da variação → código → "ÚNICO".
 */
export function parseOlistVariation(v: any): ParsedVariation {
  const pairs = extractPairs(v?.grade);

  let color: string | null = null;
  let size: string | null = null;
  const unnamed: string[] = [];

  for (const { attr, value } of pairs) {
    if (!value) continue;
    if (!color && matches(attr, COLOR_NAMES)) {
      color = value;
      continue;
    }
    if (!size && matches(attr, SIZE_NAMES)) {
      size = value;
      continue;
    }
    if (!attr) unnamed.push(value);
  }

  // Sem nomes reconhecíveis: usa os valores soltos com heurística leve
  if (!size && unnamed.length > 0) {
    const sizeLike = unnamed.find((u) => /^(pp|p|m|g|gg|xg|xgg|u|un|unico|único|\d{1,3})$/i.test(stripAccents(u)));
    size = sizeLike ?? unnamed[0]!;
    if (!color) {
      const rest = unnamed.filter((u) => u !== size);
      color = rest[0] ?? null;
    }
  }

  if (!size) {
    const desc = typeof v?.descricao === "string" ? v.descricao.trim() : "";
    const codigo = typeof v?.codigo === "string" ? v.codigo.trim() : "";
    size = desc || codigo || "ÚNICO";
  }

  return { color: color?.trim() || null, size: size.trim() || "ÚNICO" };
}

/** Hash curto e estável (FNV-1a) para IDs externos determinísticos. */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * ID externo determinístico para variações sem `id` na Olist — nunca aleatório,
 * para que reprocessar o mesmo produto não crie duplicatas.
 */
export function olistVariantExternalId(productExternalId: string, v: any, parsed: ParsedVariation): string {
  if (v?.id) return String(v.id);
  const codigo = typeof v?.codigo === "string" && v.codigo.trim() ? v.codigo.trim() : "";
  if (codigo) return `${productExternalId}:${codigo}`;
  const key = `${parsed.color ?? ""}|${parsed.size}`;
  return `${productExternalId}:${stableHash(key)}`;
}
