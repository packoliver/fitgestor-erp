import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useServerFn } from "@tanstack/react-router";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { ArrowLeft, Upload, CheckCircle2, XCircle, Loader2, FileSpreadsheet, Info } from "lucide-react";
import { runImport, listStockLocations } from "@/lib/imports.functions";
import { useQuery as useRQ, useMutation as useRM } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/configuracoes/importar")({
  component: () => (
    <RequirePermission code="settings.manage">
      <ImportPage />
    </RequirePermission>
  ),
});

type Kind = "products" | "clients" | "suppliers" | "stock";
type Source = "bling" | "tiny" | "olist" | "generic";

const KIND_LABEL: Record<Kind, string> = {
  products: "Produtos e variantes",
  clients: "Clientes",
  suppliers: "Fornecedores",
  stock: "Saldos de estoque",
};

// Campos internos + rótulos por tipo
const FIELDS: Record<Kind, { key: string; label: string; required?: boolean; hint?: string }[]> = {
  products: [
    { key: "sku", label: "SKU / Código", hint: "Se preenchido, atualiza a variante existente" },
    { key: "name", label: "Nome do produto", required: true },
    { key: "color", label: "Cor" },
    { key: "size", label: "Tamanho", hint: "PP, P, M, G, GG, ÚNICO..." },
    { key: "barcode", label: "Código de barras (EAN)" },
    { key: "sale_price", label: "Preço de venda" },
    { key: "cost_price", label: "Preço de custo" },
    { key: "brand", label: "Marca" },
    { key: "category", label: "Categoria" },
  ],
  clients: [
    { key: "full_name", label: "Nome completo", required: true },
    { key: "cpf", label: "CPF" },
    { key: "phone", label: "Telefone" },
    { key: "email", label: "E-mail" },
    { key: "birth_date", label: "Data de nascimento" },
    { key: "zip_code", label: "CEP" },
    { key: "address", label: "Endereço (logradouro)" },
    { key: "address_number", label: "Número" },
    { key: "address_complement", label: "Complemento" },
    { key: "neighborhood", label: "Bairro" },
    { key: "city", label: "Cidade" },
    { key: "state", label: "UF" },
    { key: "notes", label: "Observações" },
  ],
  suppliers: [
    { key: "name", label: "Nome / Razão social", required: true },
    { key: "document", label: "CNPJ" },
    { key: "phone", label: "Telefone" },
    { key: "email", label: "E-mail" },
    { key: "city", label: "Cidade" },
    { key: "state", label: "UF" },
    { key: "notes", label: "Observações" },
  ],
  stock: [
    { key: "sku", label: "SKU (ou preencha o EAN)" },
    { key: "barcode", label: "Código de barras (EAN)" },
    { key: "quantity", label: "Saldo atual (contado)", required: true },
  ],
};

// Sinônimos de cabeçalho (minúsculos, sem acento) → campo interno
const SYNONYMS: Record<Kind, Record<string, string>> = {
  products: {
    "sku": "sku", "codigo": "sku", "código": "sku", "cod": "sku", "code": "sku", "referencia": "sku", "ref": "sku",
    "nome": "name", "descricao": "name", "descrição": "name", "produto": "name", "titulo": "name", "title": "name",
    "cor": "color", "color": "color",
    "tamanho": "size", "size": "size", "grade": "size",
    "ean": "barcode", "gtin": "barcode", "codigo de barras": "barcode", "codigobarras": "barcode", "barcode": "barcode",
    "preco": "sale_price", "preço": "sale_price", "preco de venda": "sale_price", "preço de venda": "sale_price", "preco venda": "sale_price", "valor": "sale_price", "price": "sale_price",
    "preco de custo": "cost_price", "preço de custo": "cost_price", "custo": "cost_price", "cost": "cost_price",
    "marca": "brand", "brand": "brand", "fabricante": "brand",
    "categoria": "category", "category": "category", "grupo": "category",
  },
  clients: {
    "nome": "full_name", "nome completo": "full_name", "cliente": "full_name", "name": "full_name",
    "cpf": "cpf", "documento": "cpf",
    "telefone": "phone", "celular": "phone", "fone": "phone", "phone": "phone", "whatsapp": "phone",
    "email": "email", "e-mail": "email",
    "nascimento": "birth_date", "data de nascimento": "birth_date", "aniversario": "birth_date", "birthday": "birth_date",
    "cep": "zip_code", "zip": "zip_code",
    "endereco": "address", "endereço": "address", "logradouro": "address", "rua": "address",
    "numero": "address_number", "número": "address_number", "nro": "address_number",
    "complemento": "address_complement", "compl": "address_complement",
    "bairro": "neighborhood",
    "cidade": "city", "municipio": "city",
    "uf": "state", "estado": "state",
    "observacoes": "notes", "observações": "notes", "obs": "notes",
  },
  suppliers: {
    "nome": "name", "razao social": "name", "razão social": "name", "fornecedor": "name",
    "cnpj": "document", "documento": "document",
    "telefone": "phone", "fone": "phone", "celular": "phone",
    "email": "email", "e-mail": "email",
    "cidade": "city", "uf": "state", "estado": "state",
    "obs": "notes", "observacoes": "notes",
  },
  stock: {
    "sku": "sku", "codigo": "sku", "código": "sku", "cod": "sku",
    "ean": "barcode", "gtin": "barcode", "codigo de barras": "barcode", "barcode": "barcode",
    "saldo": "quantity", "quantidade": "quantity", "qtd": "quantity", "estoque": "quantity", "quantity": "quantity",
  },
};

function normalize(h: string) {
  return h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function autoMap(kind: Kind, headers: string[]): Record<string, string> {
  const syn = SYNONYMS[kind];
  const map: Record<string, string> = {};
  for (const h of headers) {
    const n = normalize(h);
    if (syn[n]) map[h] = syn[n];
    else map[h] = "__ignore__";
  }
  return map;
}

function ImportPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [kind, setKind] = useState<Kind>("products");
  const [source, setSource] = useState<Source>("generic");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [locationId, setLocationId] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof callImport>> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const runImportFn = useServerFn(runImport);
  const listLocFn = useServerFn(listStockLocations);
  const locs = useRQ({ queryKey: ["import-stock-locations"], queryFn: () => listLocFn(), enabled: kind === "stock" });

  const callImport = async (payload: any) => runImportFn({ data: payload });

  const submit = useRM({
    mutationFn: async () => {
      const mapped = rows.map((r) => {
        const out: Record<string, any> = {};
        for (const [orig, target] of Object.entries(mapping)) {
          if (target && target !== "__ignore__") out[target] = r[orig];
        }
        return out;
      });
      return callImport({
        kind,
        rows: mapped,
        options: { updateExisting, locationId: kind === "stock" && locationId ? locationId : null },
      });
    },
    onSuccess: (res) => { setResult(res); setStep(4); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao importar"),
  });

  async function handleFile(f: File) {
    setFileName(f.name);
    const ext = f.name.toLowerCase().split(".").pop() ?? "";
    try {
      let parsed: { headers: string[]; rows: Record<string, any>[] };
      if (ext === "csv" || ext === "txt") {
        parsed = await parseCsv(f);
      } else if (ext === "xlsx" || ext === "xls") {
        parsed = await parseXlsx(f);
      } else {
        toast.error("Formato não suportado. Use CSV ou XLSX.");
        return;
      }
      if (!parsed.rows.length) {
        toast.error("Arquivo sem linhas de dados.");
        return;
      }
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(autoMap(kind, parsed.headers));
      setStep(3);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao ler o arquivo");
    }
  }

  const requiredMissing = useMemo(() => {
    const targets = new Set(Object.values(mapping));
    return FIELDS[kind].filter((f) => f.required && !targets.has(f.key));
  }, [mapping, kind]);

  const preview = rows.slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Importar dados de outro ERP"
        description="Traga produtos, clientes, fornecedores e saldos de estoque de Bling, Tiny, Olist ou outra planilha."
        actions={<Button asChild variant="ghost"><Link to="/configuracoes"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>}
      />

      <Stepper step={step} />

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>1. O que você quer importar?</CardTitle>
            <CardDescription>Cada tipo tem seu próprio conjunto de colunas.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <Button key={k} variant={kind === k ? "default" : "outline"} size="lg"
                className="h-auto justify-start py-4" onClick={() => setKind(k)}>
                <FileSpreadsheet className="mr-3 h-5 w-5" />
                <div className="text-left">
                  <div className="font-medium">{KIND_LABEL[k]}</div>
                  <div className="text-xs opacity-70">
                    {k === "products" && "Cadastro de produtos, cores, tamanhos, preços e códigos"}
                    {k === "clients" && "Nome, CPF, telefone, e-mail, endereço"}
                    {k === "suppliers" && "Nome, CNPJ, contato"}
                    {k === "stock" && "Saldo atual por SKU — aplica como balanço"}
                  </div>
                </div>
              </Button>
            ))}
            <div className="md:col-span-2 flex justify-end">
              <Button size="lg" onClick={() => setStep(2)}>Continuar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Origem e arquivo</CardTitle>
            <CardDescription>Selecione o ERP de origem (só para pré-selecionar o mapeamento) e envie o arquivo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {(["bling", "tiny", "olist", "generic"] as Source[]).map((s) => (
                <Button key={s} variant={source === s ? "default" : "outline"} onClick={() => setSource(s)}>
                  {s === "generic" ? "Outro / Genérico" : s[0].toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Como exportar</AlertTitle>
              <AlertDescription className="text-xs">
                {source === "bling" && "No Bling: Cadastros → Produtos → Exportar → Excel/CSV. Para clientes: Cadastros → Contatos → Exportar."}
                {source === "tiny" && "No Tiny: Cadastros → Produtos → Exportar planilha. Para clientes: Cadastros → Contatos → Exportar."}
                {source === "olist" && "No Olist: Produtos → mais opções → Exportar produtos (XLSX)."}
                {source === "generic" && "Envie qualquer CSV ou XLSX. Na próxima etapa você mapeia as colunas."}
                {" "}O sistema detecta as colunas automaticamente e você pode ajustar antes de confirmar.
              </AlertDescription>
            </Alert>

            <div>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <Button size="lg" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />Escolher arquivo (CSV ou XLSX)
              </Button>
              {fileName && <span className="ml-3 text-sm text-muted-foreground">{fileName}</span>}
            </div>

            <div className="text-xs text-muted-foreground">
              PDF / DANFE não é aceito — exporte em CSV/XLSX pelo ERP de origem. Suporte a XML de NF-e virá em breve.
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Voltar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Confira o mapeamento e revise o preview</CardTitle>
            <CardDescription>
              {rows.length.toLocaleString("pt-BR")} linha(s) detectada(s). Ajuste as colunas se algo estiver errado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-2">
                  <div className="w-1/2 text-sm truncate" title={h}>
                    <span className="text-muted-foreground text-xs">Coluna: </span>{h}
                  </div>
                  <Select value={mapping[h] ?? "__ignore__"} onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v }))}>
                    <SelectTrigger className="w-1/2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__ignore__">— Ignorar —</SelectItem>
                      {FIELDS[kind].map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}{f.required ? " *" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {requiredMissing.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Campos obrigatórios faltando</AlertTitle>
                <AlertDescription>
                  Mapeie: {requiredMissing.map((f) => f.label).join(", ")}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Preview (10 primeiras linhas)</Label>
              <div className="border rounded overflow-auto max-h-72">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((h) => (
                        <TableHead key={h} className="text-xs">
                          {h}
                          {mapping[h] && mapping[h] !== "__ignore__" && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              → {FIELDS[kind].find((f) => f.key === mapping[h])?.label}
                            </Badge>
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((r, i) => (
                      <TableRow key={i}>
                        {headers.map((h) => <TableCell key={h} className="text-xs">{String(r[h] ?? "")}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Atualizar registros existentes</Label>
                  <p className="text-xs text-muted-foreground">Casa por SKU (produtos), CPF (clientes), CNPJ (fornecedores).</p>
                </div>
                <Switch checked={updateExisting} onCheckedChange={setUpdateExisting} />
              </div>
              {kind === "stock" && (
                <div className="space-y-1">
                  <Label>Local de estoque destino</Label>
                  <Select value={locationId} onValueChange={setLocationId}>
                    <SelectTrigger><SelectValue placeholder="Selecione um local" /></SelectTrigger>
                    <SelectContent>
                      {(locs.data ?? []).map((l: any) => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>Voltar</Button>
              <Button size="lg" onClick={() => submit.mutate()}
                disabled={submit.isPending || requiredMissing.length > 0 || (kind === "stock" && !locationId)}>
                {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Importar {rows.length.toLocaleString("pt-BR")} linha(s)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.failed === 0 ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-amber-600" />}
              Importação concluída
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Total" value={result.total} />
              <Stat label="Novos" value={result.inserted} />
              <Stat label="Atualizados" value={result.updated} />
              <Stat label="Com erro" value={result.failed} tone={result.failed ? "danger" : "muted"} />
            </div>
            {result.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Linhas com erro</Label>
                  <Button size="sm" variant="outline" onClick={() => downloadErrors(result.errors, fileName)}>Baixar CSV de erros</Button>
                </div>
                <div className="border rounded max-h-72 overflow-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead>Mensagem</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {result.errors.slice(0, 100).map((e, i) => (
                        <TableRow key={i}><TableCell>{e.row}</TableCell><TableCell className="text-xs">{e.message}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setStep(1); setResult(null); setRows([]); setHeaders([]); setFileName(""); }}>
                Nova importação
              </Button>
              {kind === "products" && <Button asChild><Link to="/produtos">Ver produtos</Link></Button>}
              {kind === "clients" && <Button asChild><Link to="/clientes">Ver clientes</Link></Button>}
              {kind === "suppliers" && <Button asChild><Link to="/fornecedores">Ver fornecedores</Link></Button>}
              {kind === "stock" && <Button asChild><Link to="/estoque">Ver estoque</Link></Button>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const items = ["Tipo", "Arquivo", "Mapeamento", "Resultado"];
  return (
    <div className="flex gap-2 text-xs">
      {items.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={label} className={`flex-1 rounded border px-3 py-2 ${active ? "border-primary bg-primary/5" : done ? "border-green-500/40 bg-green-500/5" : "opacity-60"}`}>
            <span className="font-medium">{n}. {label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "muted" }) {
  return (
    <Card><CardContent className="py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${tone === "danger" ? "text-amber-600" : ""}`}>{value.toLocaleString("pt-BR")}</div>
    </CardContent></Card>
  );
}

async function parseCsv(file: File): Promise<{ headers: string[]; rows: Record<string, any>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, dynamicTyping: false,
      complete: (res) => {
        const rows = (res.data as Record<string, any>[]).filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));
        const headers = res.meta.fields ?? [];
        resolve({ headers, rows });
      },
      error: (err) => reject(err),
    });
  });
}

async function parseXlsx(file: File): Promise<{ headers: string[]; rows: Record<string, any>[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "", raw: false });
  const headers = json.length ? Object.keys(json[0]) : [];
  const rows = json.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));
  return { headers, rows };
}

function downloadErrors(errors: { row: number; message: string }[], baseName: string) {
  const csv = "linha,mensagem\n" + errors.map((e) => `${e.row},"${e.message.replace(/"/g, '""')}"`).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `erros-importacao-${baseName || "arquivo"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
