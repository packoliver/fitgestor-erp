import { QRImage, StoreHeader, KV, Divider, money, dt } from "./receipt-common";
import { PAYMENT_LABELS } from "@/lib/pos";

export interface ExchangeReceiptData {
  org: any;
  exchange: any;
  client: any;
  originalSale: any;
  location: any;
  operator: { full_name?: string | null } | null;
  returnItems: any[];
  newItems: any[];
  payments: any[];
  voucher: any | null;
  storeCredit: { balance_after: number | null } | null;
  settings: any | null;
  consultUrl: string;
}

export function ExchangeReceipt({ data }: { data: ExchangeReceiptData }) {
  const ex = data.exchange;
  return (
    <div>
      <StoreHeader org={data.org} />
      <div className="receipt-title" style={{ textAlign: "center", fontWeight: 700 }}>
        COMPROVANTE DE TROCA #{ex.exchange_number}
      </div>
      <Divider />

      <KV k="Data" v={dt(ex.completed_at ?? ex.created_at)} />
      <KV k="Venda original" v={data.originalSale?.sale_number ? `#${data.originalSale.sale_number}` : "—"} />
      <KV k="Cliente" v={data.client?.full_name ?? "Não identificado"} />
      {data.client?.cpf && <KV k="CPF" v={data.client.cpf} />}
      <KV k="Loja / local" v={data.location?.name ?? "—"} />
      <KV k="Operador" v={data.operator?.full_name ?? "—"} />
      <KV k="Tipo" v={ex.type} />
      {ex.reason && <KV k="Motivo" v={ex.reason} />}

      <Divider />
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Itens devolvidos</div>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Produto</th>
            <th className="a4-only">Cor / Tam</th>
            <th style={{ textAlign: "right" }}>Qtd</th>
            <th style={{ textAlign: "right" }}>Valor</th>
            <th className="a4-only">Cond.</th>
            <th className="a4-only">Destino</th>
          </tr>
        </thead>
        <tbody>
          {data.returnItems.map((r) => (
            <tr key={r.id} className="item-row">
              <td>
                {r.product_name_snapshot}
                <div className="thermal-only" style={{ fontSize: "0.9em", color: "#555" }}>
                  {[r.color_snapshot, r.size_snapshot].filter(Boolean).join(" · ")} · {r.condition} · {r.restock_destination}
                </div>
              </td>
              <td className="a4-only">{[r.color_snapshot, r.size_snapshot].filter(Boolean).join(" / ")}</td>
              <td style={{ textAlign: "right" }}>{r.quantity}</td>
              <td style={{ textAlign: "right" }}>{money(r.total_value)}</td>
              <td className="a4-only">{r.condition}</td>
              <td className="a4-only">{r.restock_destination}{r.return_to_available_stock ? " ✓" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.newItems.length > 0 && (
        <>
          <Divider />
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Novos produtos</div>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Produto</th>
                <th className="a4-only">Cor / Tam</th>
                <th style={{ textAlign: "right" }}>Qtd</th>
                <th style={{ textAlign: "right" }}>Preço</th>
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.newItems.map((n) => (
                <tr key={n.id} className="item-row">
                  <td>
                    {n.product_name_snapshot}
                    <div className="thermal-only" style={{ fontSize: "0.9em", color: "#555" }}>
                      {[n.color_snapshot, n.size_snapshot].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="a4-only">{[n.color_snapshot, n.size_snapshot].filter(Boolean).join(" / ")}</td>
                  <td style={{ textAlign: "right" }}>{n.quantity}</td>
                  <td style={{ textAlign: "right" }}>{money(n.unit_price)}</td>
                  <td style={{ textAlign: "right" }}>{money(n.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <Divider />
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Resumo financeiro</div>
      <KV k="Devolvido" v={money(ex.subtotal_returned)} />
      <KV k="Novos" v={money(ex.subtotal_new_items)} />
      <KV k="Diferença" v={money(ex.difference_amount)} />
      {Number(ex.additional_payment_amount) > 0 && <KV k="Recebido do cliente" v={money(ex.additional_payment_amount)} />}
      {Number(ex.refund_amount) > 0 && <KV k="Devolvido em dinheiro" v={money(ex.refund_amount)} />}
      {Number(ex.store_credit_amount) > 0 && <KV k="Crédito emitido" v={money(ex.store_credit_amount)} />}
      {Number(ex.voucher_amount) > 0 && <KV k="Vale emitido" v={money(ex.voucher_amount)} />}

      {data.payments.length > 0 && (
        <>
          <Divider />
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Pagamentos</div>
          {data.payments.map((p) => (
            <KV
              key={p.id}
              k={`${p.direction === "incoming" ? "Entrada" : "Saída"} · ${PAYMENT_LABELS[p.payment_method] ?? p.payment_method}`}
              v={money(p.amount)}
            />
          ))}
        </>
      )}

      {data.voucher && (
        <>
          <Divider />
          <div style={{ fontWeight: 700 }}>Vale-troca gerado</div>
          <KV k="Código" v={<span style={{ fontFamily: "ui-monospace, monospace" }}>{data.voucher.code}</span>} />
          <KV k="Saldo" v={money(data.voucher.current_balance)} />
          {data.voucher.expires_at && <KV k="Validade" v={dt(data.voucher.expires_at)} />}
        </>
      )}

      {ex.notes && (
        <>
          <Divider />
          <div><b>Observações:</b> {ex.notes}</div>
        </>
      )}

      <Divider />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, margin: "8px 0" }}>
        <QRImage value={data.consultUrl} size={96} />
        <div style={{ fontSize: "0.85em", textAlign: "center" }}>
          Consulte esta troca:<br />
          <span style={{ fontFamily: "ui-monospace, monospace" }}>#{ex.exchange_number}</span>
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: "0.8em", color: "#555", marginTop: 8 }}>
        {data.settings?.receipt_footer_text ?? "Comprovante não fiscal."}
      </div>
    </div>
  );
}
