import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { currentOrgId } from "@/lib/erp";
import { Plus, Trash2, ArrowUp, ArrowDown, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/configuracoes/tamanhos")({
  component: () => (
    <RequirePermission code="settings.manage">
      <Page />
    </RequirePermission>
  ),
});

type Row = {
  id: string;
  organization_id: string;
  label: string;
  position: number;
  is_active: boolean;
};

function Page() {
  const qc = useQueryClient();
  const [newLabel, setNewLabel] = useState("");

  const list = useQuery({
    queryKey: ["org-size-presets-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_size_presets")
        .select("id, organization_id, label, position, is_active")
        .order("position")
        .order("label");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const label = newLabel.trim().toUpperCase();
      if (!label) throw new Error("Informe o rótulo do tamanho.");
      const orgId = await currentOrgId();
      if (!orgId) throw new Error("Organização não encontrada.");
      const nextPos = ((list.data ?? []).reduce((m, r) => Math.max(m, r.position), 0)) + 10;
      const { error } = await supabase.from("org_size_presets").insert({
        organization_id: orgId,
        label,
        position: nextPos,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewLabel("");
      toast.success("Tamanho adicionado.");
      qc.invalidateQueries({ queryKey: ["org-size-presets-admin"] });
      qc.invalidateQueries({ queryKey: ["org-size-presets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("org_size_presets").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-size-presets-admin"] });
      qc.invalidateQueries({ queryKey: ["org-size-presets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const move = useMutation({
    mutationFn: async ({ id, dir }: { id: string; dir: "up" | "down" }) => {
      const rows = [...(list.data ?? [])].sort((a, b) => a.position - b.position);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return;
      const swapIdx = dir === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= rows.length) return;
      const a = rows[idx], b = rows[swapIdx];
      const { error: e1 } = await supabase.from("org_size_presets").update({ position: b.position }).eq("id", a.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("org_size_presets").update({ position: a.position }).eq("id", b.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-size-presets-admin"] });
      qc.invalidateQueries({ queryKey: ["org-size-presets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!window.confirm("Remover este tamanho da lista padrão?")) return;
      const { error } = await supabase.from("org_size_presets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tamanho removido.");
      qc.invalidateQueries({ queryKey: ["org-size-presets-admin"] });
      qc.invalidateQueries({ queryKey: ["org-size-presets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = [...(list.data ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tamanhos padrão"
        description="Grade de tamanhos usada na contagem manual do módulo de Entrada de mercadoria. Cada loja mantém sua própria lista."
      />
      <Card>
        <CardContent className="py-4 space-y-4">
          <div className="flex gap-2 items-end max-w-md">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Novo tamanho</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value.toUpperCase())}
                placeholder="Ex.: G1, G2, G3, INFANTIL"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add.mutate(); } }}
              />
            </div>
            <Button onClick={() => add.mutate()} disabled={add.isPending}>
              {add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Adicionar
            </Button>
          </div>

          {list.isLoading ? (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhum tamanho cadastrado ainda.</div>
          ) : (
            <div className="divide-y border rounded-md">
              {rows.map((r, idx) => (
                <div key={r.id} className="flex items-center gap-3 p-3">
                  <div className="flex flex-col">
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      disabled={idx === 0 || move.isPending}
                      onClick={() => move.mutate({ id: r.id, dir: "up" })}
                      aria-label="Subir"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      disabled={idx === rows.length - 1 || move.isPending}
                      onClick={() => move.mutate({ id: r.id, dir: "down" })}
                      aria-label="Descer"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <span className="font-mono font-medium">{r.label}</span>
                    {!r.is_active && <Badge variant="outline">Oculto</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Ativo</span>
                    <Switch
                      checked={r.is_active}
                      onCheckedChange={(v) => toggle.mutate({ id: r.id, is_active: v })}
                    />
                  </div>
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => remove.mutate(r.id)}
                    aria-label="Remover"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
