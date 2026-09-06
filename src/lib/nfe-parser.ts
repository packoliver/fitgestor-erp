export interface NFeItem {
  id: string;
  code: string;           // cProd
  description: string;    // xProd
  ncm: string;            // NCM
  unit: string;           // uCom
  quantity: number;       // qCom
  unitCost: number;       // vUnCom
  totalValue: number;     // vProd
  // Campos de conciliação / De-Para
  matchedVariantId?: string;
  matchedSku?: string | null;
  suggestedMarginPercent: number;
  calculatedPrice: number;
  action: "link" | "create_new";
}

export interface NFeHeader {
  nNF: string;
  serie: string;
  issueDate: string;
  cnpj: string;
  supplierName: string;
}

export interface ParsedNFe {
  header: NFeHeader;
  items: NFeItem[];
}

export function parseNFeXML(xmlContent: string): ParsedNFe {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    throw new Error("Arquivo XML inválido ou corrompido.");
  }

  const ide = xmlDoc.querySelector("ide");
  const emit = xmlDoc.querySelector("emit");
  const dets = Array.from(xmlDoc.querySelectorAll("det"));

  if (!ide || !emit || dets.length === 0) {
    throw new Error("O XML fornecido não é uma NF-e (Nota Fiscal Eletrônica) válida.");
  }

  const nNF = ide.querySelector("nNF")?.textContent || "0";
  const serie = ide.querySelector("serie")?.textContent || "1";
  const dhEmi = ide.querySelector("dhEmi")?.textContent || ide.querySelector("dEmi")?.textContent || new Date().toISOString();
  const cnpj = emit.querySelector("CNPJ")?.textContent || emit.querySelector("CPF")?.textContent || "";
  const supplierName = emit.querySelector("xNome")?.textContent || "Fornecedor Desconhecido";

  const header: NFeHeader = {
    nNF,
    serie,
    issueDate: dhEmi,
    cnpj,
    supplierName,
  };

  const items: NFeItem[] = dets.map((det, index) => {
    const prod = det.querySelector("prod");
    const code = prod?.querySelector("cProd")?.textContent || `ITEM-${index + 1}`;
    const description = prod?.querySelector("xProd")?.textContent || `Produto ${index + 1}`;
    const ncm = prod?.querySelector("NCM")?.textContent || "";
    const unit = prod?.querySelector("uCom")?.textContent || "UN";
    const quantity = parseFloat(prod?.querySelector("qCom")?.textContent || "1");
    const unitCost = parseFloat(prod?.querySelector("vUnCom")?.textContent || "0");
    const totalValue = parseFloat(prod?.querySelector("vProd")?.textContent || "0");

    const defaultMargin = 100; // 100% de margem padrao
    const calculatedPrice = Number((unitCost * (1 + defaultMargin / 100)).toFixed(2));

    return {
      id: `nfe-item-${index}-${Date.now()}`,
      code,
      description,
      ncm,
      unit,
      quantity,
      unitCost,
      totalValue,
      suggestedMarginPercent: defaultMargin,
      calculatedPrice,
      action: "create_new",
    };
  });

  return { header, items };
}
