import { money } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";

export type ReportRow = {
  id: string;
  exchange_number: number;
  created_at: string;
  completed_at: string | null;
  status: string;
  reversed: boolean;
  sale_number: number | null;
  client_name: string | null;
  operator_name: string | null;
  returned_items_count: number;
  new_items_count: number;
  subtotal_returned: number;
  difference_amount: number;
  additional_payment_amount: number;
  store_credit_amount: number;
  voucher_amount: number;
  payment_methods: string[];
};

export type ReportTotals = {
  total_exchanges: number;
  total_reversed: number;
  sum_returned: number;
  sum_additional: number;
  sum_refunded: number;
  sum_credit: number;
  sum_voucher: number;
  qty_available_stock: number;
  qty_quarantine: number;
  qty_loss: number;
};

/**
 * Layout de impressão A4 do relatório de trocas.
 * Usa o mesmo PrintDialog e o mesmo pipeline @media print dos comprovantes.
 */
export function ExchangesReportPrint({
  rows,
  totals,
  filtersSummary,
  storeName,
  emittedBy,
}: {
  rows: ReportRow[];
  totals: ReportTotals;
  filtersSummary: Array<{ label: string; value: string }>;
  storeName?: string | null;
  emittedBy?: string | null;
}) {
  return (
    <div className="a4-only">
      <div style={{ borderBottom: "1px solid #333", paddingBottom: 6, marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Relatório de trocas</div>
        <div style={{ fontSize: 11 }}>
          {storeName ?? ""} — emitido em {formatDateTime(new Date().toISOString())}
          {emittedBy ? ` por ${emittedBy}` : ""}
        </div>
      </div>

      {filtersSummary.length > 0 && (
        <div style={{ fontSize: 11, marginBottom: 10 }}>
          <b>Filtros:</b>{" "}
          {filtersSummary.map((f, i) => (
            <span key={i} style={{ marginRight: 8 }}>
              {f.label}: {f.value}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 10 }}>
        <Kpi label="Trocas" value={String(totals.total_exchanges)} />
        <Kpi label="Devolvido" value={money(totals.sum_returned)} />
        <Kpi label="Recebido a mais" value={money(totals.sum_additional)} />
        <Kpi label="Créditos" value={money(totals.sum_credit)} />
        <Kpi label="Vales" value={money(totals.sum_voucher)} />
        <Kpi label="Reembolsado" value={money(totals.sum_refunded)} />
        <Kpi label="Estornadas" value={String(totals.total_reversed)} />
        <Kpi label="Ao estoque" value={String(totals.qty_available_stock)} />
        <Kpi label="Quarentena" value={String(totals.qty_quarantine)} />
        <Kpi label="Perda" value={String(totals.qty_loss)} />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr>
            {["Nº", "Data", "Venda", "Cliente", "Operador", "Itens dev./novos", "Devolvido", "Diferença", "Crédito", "Vale", "Status"].map((h) => (
              <th key={h} style={{ borderBottom: "1px solid #333", textAlign: "left", padding: "3px 4px" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={cell}>#{r.exchange_number}</td>
              <td style={cell}>{formatDateTime(r.completed_at ?? r.created_at)}</td>
              <td style={cell}>{r.sale_number ? `#${r.sale_number}` : "—"}</td>
              <td style={cell}>{r.client_name ?? "—"}</td>
              <td style={cell}>{r.operator_name ?? "—"}</td>
              <td style={cell}>
                {r.returned_items_count} / {r.new_items_count}
              </td>
              <td style={cellR}>{money(r.subtotal_returned)}</td>
              <td style={cellR}>{money(r.difference_amount)}</td>
              <td style={cellR}>{money(r.store_credit_amount)}</td>
              <td style={cellR}>{money(r.voucher_amount)}</td>
              <td style={cell}>
                {r.status}
                {r.reversed ? " (estornada)" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cell: React.CSSProperties = { borderBottom: "1px solid #ddd", padding: "3px 4px", verticalAlign: "top" };
const cellR: React.CSSProperties = { ...cell, textAlign: "right" };

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #ccc", borderRadius: 4, padding: "4px 6px" }}>
      <div style={{ fontSize: 9, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
