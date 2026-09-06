import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QRImage({ value, size = 96 }: { value: string; size?: number }) {
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 0, width: size * 2 })
      .then((u) => alive && setUrl(u))
      .catch(() => {});
    return () => { alive = false; };
  }, [value, size]);
  if (!url) return <div style={{ width: size, height: size, border: "1px dashed #999" }} />;
  return <img src={url} alt="QR" width={size} height={size} style={{ display: "block" }} />;
}

export function StoreHeader({ org }: { org: any }) {
  if (!org) return null;
  return (
    <div style={{ textAlign: "center", marginBottom: 8 }}>
      {org.logo_url && (
        <img src={org.logo_url} alt="" style={{ maxHeight: 40, margin: "0 auto 4px" }} className="thermal-only" />
      )}
      <div style={{ fontWeight: 700, fontSize: "1.1em" }}>{org.name}</div>
      {org.document && <div style={{ fontSize: "0.85em" }}>CNPJ {org.document}</div>}
      {(org.phone || org.email) && (
        <div style={{ fontSize: "0.85em" }}>{[org.phone, org.email].filter(Boolean).join(" · ")}</div>
      )}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
      <span style={{ color: "#555" }}>{k}</span>
      <b style={{ marginLeft: 8 }}>{v}</b>
    </div>
  );
}

export function Divider() {
  return <hr style={{ border: 0, borderTop: "1px dashed #999", margin: "6px 0" }} />;
}

export function money(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

export function dt(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
}

export function d(v: string | Date | null | undefined) {
  if (!v) return "—";
  const dd = typeof v === "string" ? new Date(v) : v;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(dd);
}
