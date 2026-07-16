import { QRImage, StoreHeader, KV, Divider, money, dt } from "./receipt-common";
import { PAYMENT_LABELS } from "@/lib/pos";

/**
 * Cada pagamento pode ser enriquecido com o snapshot histórico:
 *   - voucherCode / voucherBalanceAfter (via exchange_voucher_transactions)
 *   - creditBalanceAfter                (via store_credit_transactions)
 * Esses valores são LIDOS do backend (balance_after gravado na transação),
 * nunca recalculados aqui.
 */
export interface EnrichedPayment {
  id: string;
  payment_method: string;
  amount: number | string;
  installments?: number | null;
  voucherCode?: string | null;
  voucherBalanceAfter?: number | null;
  creditBalanceAfter?: number | null;
}

export interface SaleReceiptData {
  org: any;
  sale: any;
  client: any | null;
  location: any | null;
  operator: { full_name?: string | null } | null;
  items: any[];
  payments: EnrichedPayment[];
  consultUrl: string;
  settings: any | null;
}

export function SaleReceipt({ data }: { data: SaleReceiptData }) {
  const s = data.sale;
  return (
    <div>
      <StoreHeader org={data.org} />
      <div className="receipt-title" style={{ textAlign: "center", fontWeight: 700 }}>
        CUPOM DE VENDA #{s.sale_number}
      </div>
      <Divider />

      <KV k="Data" v={dt(s.completed_at ?? s.created_at)} />
      <KV k="Loja / local" v={data.location?.name ?? "—"} />
      <KV k="Cliente" v={data.client?.full_name ?? "Não identificado"} />
      {data.client?.cpf && <KV k="CPF" v={data.client.cpf} />}
      <KV k="Operador" v={data.operator?.full_name ?? "—"} />

      <Divider />
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Itens</div>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Produto</th>
            <th className="a4-only">SKU</th>
            <th style={{ textAlign: "right" }}>Qtd</th>
            <th style={{ textAlign: "right" }}>Preço</th>
            <th style={{ textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it) => (
            <tr key={it.id} className="item-row">
              <td>
                {it.product_name_snapshot}
                <div className="thermal-only" style={{ fontSize: "0.9em", color: "#555" }}>
                  {[it.color_snapshot, it.size_snapshot, it.sku_snapshot].filter(Boolean).join(" · ")}
                </div>
              </td>
              <td className="a4-only">{it.sku_snapshot ?? "—"}</td>
              <td style={{ textAlign: "right" }}>{it.quantity}</td>
              <td style={{ textAlign: "right" }}>{money(it.unit_price)}</td>
              <td style={{ textAlign: "right" }}>{money(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Divider />
      <KV k="Subtotal" v={money(s.subtotal)} />
      {Number(s.item_discount_total) + Number(s.order_discount_total) > 0 && (
        <KV k="Descontos" v={`- ${money(Number(s.item_discount_total) + Number(s.order_discount_total))}`} />
      )}
      <KV k="Total" v={<b>{money(s.total)}</b>} />
      <KV k="Pago" v={money(s.amount_paid)} />
      {Number(s.change_amount) > 0 && <KV k="Troco" v={money(s.change_amount)} />}

      <Divider />
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Pagamentos</div>
      {data.payments.map((p) => {
        const label = PAYMENT_LABELS[p.payment_method] ?? p.payment_method;
        const isVoucher = p.payment_method === "exchange_voucher" || p.payment_method === "gift_voucher";
        const isCredit = p.payment_method === "store_credit";
        return (
          <div key={p.id} style={{ marginBottom: 4 }}>
            <KV
              k={`${label}${p.installments && p.installments > 1 ? ` ${p.installments}x` : ""}`}
              v={money(p.amount)}
            />
            {isVoucher && p.voucherCode && (
              <div style={{ fontSize: "0.85em", color: "#555", paddingLeft: 8 }}>
                Vale <span style={{ fontFamily: "ui-monospace, monospace" }}>{p.voucherCode}</span>
                {p.voucherBalanceAfter != null && (
                  <> · saldo após esta venda: <b>{money(p.voucherBalanceAfter)}</b></>
                )}
              </div>
            )}
            {isCredit && p.creditBalanceAfter != null && (
              <div style={{ fontSize: "0.85em", color: "#555", paddingLeft: 8 }}>
                Saldo do crédito após esta venda: <b>{money(p.creditBalanceAfter)}</b>
              </div>
            )}
          </div>
        );
      })}

      <Divider />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, margin: "8px 0" }}>
        <QRImage value={data.consultUrl} size={96} />
        <div style={{ fontSize: "0.85em" }}>#{s.sale_number}</div>
      </div>

      <div style={{ textAlign: "center", fontSize: "0.8em", color: "#555" }}>
        {data.settings?.receipt_footer_text ?? "Comprovante não fiscal."}
      </div>
    </div>
  );
}
