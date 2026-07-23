import { QRImage, StoreHeader, KV, Divider, money, dt } from "./receipt-common";

export interface VoucherReceiptData {
  org: any;
  voucher: any;
  client: any | null;
  originalExchangeNumber: string | number | null;
  settings: any | null;
}

const DEFAULT_RULES = [
  "Não é convertido em dinheiro.",
  "Pode ser usado parcialmente até o saldo acabar.",
  "Válido apenas dentro da validade impressa.",
  "Apresente o código no momento do uso.",
];

export function VoucherReceipt({ data }: { data: VoucherReceiptData }) {
  const v = data.voucher;
  const rules = data.settings?.voucher_rules ?? DEFAULT_RULES;
  return (
    <div>
      <StoreHeader org={data.org} />
      <div className="receipt-title" style={{ textAlign: "center", fontWeight: 700 }}>
        VALE-TROCA
      </div>
      <Divider />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, margin: "6px 0" }}>
        <QRImage value={v.code} size={128} />
        <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: "1.2em", letterSpacing: 1 }}>
          {v.code}
        </div>
      </div>

      <Divider />
      <KV k="Titular" v={data.client?.full_name ?? "Ao portador"} />
      {data.client?.cpf && <KV k="CPF" v={data.client.cpf} />}
      <KV k="Emitido em" v={dt(v.created_at)} />
      <KV k="Validade" v={v.expires_at ? dt(v.expires_at) : "Sem validade"} />
      <KV k="Saldo inicial" v={money(v.initial_amount)} />
      <KV k="Saldo disponível" v={<b>{money(v.current_balance)}</b>} />
      {data.originalExchangeNumber && <KV k="Troca de origem" v={`#${data.originalExchangeNumber}`} />}
      <KV k="Status" v={v.status} />

      <Divider />
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Regras de utilização</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.9em" }}>
        {(Array.isArray(rules) ? rules : DEFAULT_RULES).map((r: string, i: number) => (
          <li key={i}>{r}</li>
        ))}
      </ul>

      <div style={{ textAlign: "center", fontSize: "0.8em", color: "#555", marginTop: 10 }}>
        {data.settings?.receipt_footer_text ?? "Documento não fiscal."}
      </div>
    </div>
  );
}
