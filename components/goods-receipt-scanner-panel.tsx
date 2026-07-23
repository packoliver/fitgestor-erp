import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ScanLine, Undo2, AlertTriangle, CheckCircle2, PackageX, Save } from "lucide-react";
import { toast } from "sonner";

/**
 * Resultado interno de uma leitura resolvida.
 * A busca acontece EXATA em product_variants.sku e product_variants.barcode,
 * respeitando RLS (organização atual) e filtros de ativo/não excluído.
 */
export type ScannedVariant = {
  id: string;
  size: string;
  sku: string | null;
  barcode: string | null;
  product: { id: string; name: string; color: string | null };
};

type Resolution =
  | { kind: "ok"; variant: ScannedVariant }
  | { kind: "not_found" }
  | { kind: "inactive"; product_name: string }
  | { kind: "conflict"; matches: ScannedVariant[] };

type SessionEntry = {
  id: string;
  at: string;
  code: string;
  status: "ok" | "undone" | "error" | "conflict" | "not_found" | "inactive" | "mode_conflict";
  variant?: ScannedVariant;
  message?: string;
};

export type IncrementResult =
  | { kind: "ok"; product_name: string; color: string | null; size: string; sku: string | null; new_quantity: number }
  | { kind: "mode_conflict"; product_name: string; existing_mode: "new_variant" | "new_product" };

export function ReceiptScannerPanel({
  disabled,
  onIncrement,
  onDecrement,
  onSaveDraft,
  saving,
  dirty,
  totalPieces,
  distinctVariantsCount,
}: {
  disabled?: boolean;
  onIncrement: (variant: ScannedVariant) => IncrementResult;
  onDecrement: (variant: ScannedVariant) => { new_quantity: number } | null;
  onSaveDraft: () => void;
  saving: boolean;
  dirty: boolean;
  totalPieces: number;
  distinctVariantsCount: number;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<SessionEntry[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Cache por sessão: código -> Resolution
  const cacheRef = useRef<Map<string, Resolution>>(new Map());

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const scanCount = session.filter((s) => s.status === "ok").length;
  const undoneCount = session.filter((s) => s.status === "undone").length;
  const netScans = scanCount - undoneCount;
  const lastOk = [...session].reverse().find((s) => s.status === "ok");

  const canUndo = useMemo(() => {
    // Última leitura "ok" que ainda não foi desfeita.
    for (let i = session.length - 1; i >= 0; i--) {
      if (session[i].status === "ok") return true;
      if (session[i].status === "undone") continue;
    }
    return false;
  }, [session]);

  async function resolveCode(rawCode: string): Promise<Resolution> {
    const cached = cacheRef.current.get(rawCode);
    if (cached) return cached;

    // Chamada única ao RPC backend. Toda a lógica de igualdade exata,
    // organização, ativo/inativo e ambiguidade é decidida no servidor;
    // nada da entrada do leitor é interpolado em filtros PostgREST.
    const { data, error } = await supabase.rpc("resolve_goods_receipt_scan", { _code: rawCode });
    if (error) {
      // Erros de rede/permissão não devem ser cacheados como "not_found".
      throw new Error(error.message);
    }

    const payload = (data ?? {}) as {
      status: "found" | "ambiguous" | "inactive" | "not_found";
      variant?: {
        variant_id: string;
        product_id: string;
        product_name: string;
        color: string | null;
        size: string;
        sku: string | null;
        barcode: string | null;
      };
      matches?: Array<{
        variant_id: string;
        product_id: string;
        product_name: string;
        color: string | null;
        size: string;
        sku: string | null;
        barcode: string | null;
      }>;
    };

    if (payload.status === "not_found") {
      // Não cachear "not_found" para permitir que um cadastro criado
      // durante a mesma sessão seja localizado sem reiniciar o cache.
      return { kind: "not_found" };
    }
    if (payload.status === "inactive") {
      const first = payload.matches?.[0];
      const r: Resolution = { kind: "inactive", product_name: first?.product_name ?? "Produto" };
      cacheRef.current.set(rawCode, r);
      return r;
    }
    if (payload.status === "ambiguous") {
      const matches = (payload.matches ?? []).map((m) => ({
        id: m.variant_id,
        size: m.size,
        sku: m.sku,
        barcode: m.barcode,
        product: { id: m.product_id, name: m.product_name, color: m.color },
      }));
      const r: Resolution = { kind: "conflict", matches };
      cacheRef.current.set(rawCode, r);
      return r;
    }
    // found
    const v = payload.variant!;
    const r: Resolution = {
      kind: "ok",
      variant: {
        id: v.variant_id,
        size: v.size,
        sku: v.sku,
        barcode: v.barcode,
        product: { id: v.product_id, name: v.product_name, color: v.color },
      },
    };
    cacheRef.current.set(rawCode, r);
    return r;
  }


  function pushEntry(entry: Omit<SessionEntry, "id" | "at">) {
    setSession((prev) => [
      ...prev.slice(-40),
      { ...entry, id: Math.random().toString(36).slice(2, 10), at: new Date().toISOString() },
    ]);
  }

  async function handleSubmit() {
    if (disabled || busy) return;
    const raw = code.trim();
    if (!raw) return;
    setBusy(true);
    setLastError(null);
    try {
      const res = await resolveCode(raw);
      if (res.kind === "not_found") {
        setLastError(`Código "${raw}" não encontrado nos produtos cadastrados.`);
        pushEntry({ code: raw, status: "not_found", message: "Não encontrado" });
        return;
      }
      if (res.kind === "inactive") {
        setLastError(`Cadastro inativo ou excluído (${res.product_name}). Não adicionado ao recebimento.`);
        pushEntry({ code: raw, status: "inactive", message: `Inativo: ${res.product_name}` });
        return;
      }
      if (res.kind === "conflict") {
        const label = res.matches
          .map((m) => `${m.product.name} · ${m.size} (${m.sku ?? m.barcode ?? "?"})`)
          .join(" | ");
        setLastError(
          `Este código está vinculado a mais de uma variação. Corrija o cadastro antes de continuar. → ${label}`,
        );
        pushEntry({ code: raw, status: "conflict", message: label });
        return;
      }
      // ok
      const inc = onIncrement(res.variant);
      if (inc.kind === "mode_conflict") {
        const modo = inc.existing_mode === "new_variant" ? "nova variação" : "produto novo";
        setLastError(
          `O produto "${inc.product_name}" já está no rascunho em modo ${modo}. Ajuste manualmente pela grade antes de escanear.`,
        );
        pushEntry({
          code: raw,
          status: "mode_conflict",
          variant: res.variant,
          message: `Conflito de modo (${modo})`,
        });
        return;
      }
      pushEntry({ code: raw, status: "ok", variant: res.variant, message: `→ qtd ${inc.new_quantity}` });
      setCode("");
      setFlashKey((k) => k + 1);
    } catch (e: any) {
      setLastError(e.message ?? "Erro na leitura.");
      pushEntry({ code: raw, status: "error", message: e.message ?? "Erro" });
      toast.error(e.message ?? "Erro na leitura.");
    } finally {
      setBusy(false);
      // Devolver foco sempre
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function handleUndo() {
    if (disabled || !canUndo) return;
    // encontra o último "ok"
    let targetIdx = -1;
    for (let i = session.length - 1; i >= 0; i--) {
      if (session[i].status === "ok") {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx < 0) return;
    const target = session[targetIdx];
    if (!target.variant) return;
    const res = onDecrement(target.variant);
    if (!res) {
      toast.error("Nada a desfazer nessa variação.");
      return;
    }
    setSession((prev) =>
      prev.map((s, i) => (i === targetIdx ? { ...s, status: "undone", message: `desfeita · qtd ${res.new_quantity}` } : s)),
    );
    inputRef.current?.focus();
  }

  return (
    <Card className={disabled ? "opacity-70" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ScanLine className="h-4 w-4" /> Recebimento por leitor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] items-end">
          <div className="space-y-1">
            <Label htmlFor="scanner-input" className="text-xs">
              Escaneie ou digite SKU / código de barras
            </Label>
            <Input
              id="scanner-input"
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Aguardando leitura…"
              className="h-12 text-lg font-mono"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled || busy}
            />
          </div>
          <Button size="lg" onClick={handleSubmit} disabled={disabled || busy || !code.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
            Confirmar
          </Button>
          <Button size="lg" variant="outline" onClick={handleUndo} disabled={disabled || !canUndo}>
            <Undo2 className="mr-2 h-4 w-4" /> Desfazer
          </Button>
        </div>

        {lastError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>{lastError}</div>
          </div>
        )}

        {lastOk && (
          <div
            key={flashKey}
            className="rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm flex items-start gap-2 animate-in fade-in"
          >
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-700" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                {lastOk.variant?.product.name}
                {lastOk.variant?.product.color && (
                  <span className="text-muted-foreground"> · {lastOk.variant.product.color}</span>
                )}
                <span className="text-muted-foreground"> · {lastOk.variant?.size}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                SKU {lastOk.variant?.sku ?? "—"} · Barcode {lastOk.variant?.barcode ?? "—"} · {lastOk.message}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <StatBox label="Leituras" value={netScans} />
          <StatBox label="Variações distintas" value={distinctVariantsCount} />
          <StatBox label="Total do rascunho" value={totalPieces} />
          <StatBox label="Desfeitas" value={undoneCount} />
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {dirty ? (
              <span className="text-amber-600">Alterações não salvas</span>
            ) : (
              <span>Sem alterações pendentes</span>
            )}
          </div>
          <Button variant="secondary" onClick={onSaveDraft} disabled={disabled || saving || !dirty}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar e continuar lendo
          </Button>
        </div>

        <div>
          <div className="text-xs font-medium mb-2 text-muted-foreground">Últimas leituras</div>
          {session.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground text-center">
              Nenhuma leitura nesta sessão.
            </div>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {[...session]
                .slice(-20)
                .reverse()
                .map((e) => (
                  <li key={e.id} className="flex items-start gap-2 text-xs border-b last:border-0 py-1.5">
                    <span className="tabular-nums text-muted-foreground shrink-0 w-14">
                      {new Date(e.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <StatusIcon status={e.status} />
                    <div className="flex-1 min-w-0">
                      {e.variant ? (
                        <div className="truncate">
                          <span className="font-medium">{e.variant.product.name}</span>
                          {e.variant.product.color && <span className="text-muted-foreground"> · {e.variant.product.color}</span>}
                          <span className="text-muted-foreground"> · {e.variant.size}</span>
                          <span className="text-muted-foreground"> · {e.variant.sku ?? e.variant.barcode ?? "—"}</span>
                        </div>
                      ) : (
                        <div className="truncate font-mono">{e.code}</div>
                      )}
                      {e.message && <div className="text-muted-foreground truncate">{e.message}</div>}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StatusIcon({ status }: { status: SessionEntry["status"] }) {
  if (status === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />;
  if (status === "undone") return <Undo2 className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />;
  if (status === "not_found" || status === "inactive") return <PackageX className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />;
}

export { type Resolution };
