import { timingSafeEqual } from "node:crypto";

/** Temporary audit access, closed by default and after the configured deadline. */
export function canReadShopifyAudit(request: Request, env = process.env, now = Date.now()) {
  const key = env.SHOPIFY_AUDIT_RUN_KEY;
  const expires = Date.parse(env.SHOPIFY_AUDIT_EXPIRES_AT ?? "");
  const supplied = request.headers.get("x-shopify-audit-key");
  if (!key || key.length < 32 || !supplied || !Number.isFinite(expires) || now >= expires) return false;
  const a = Buffer.from(key), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
