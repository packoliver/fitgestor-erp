import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BrandLockup } from "@/components/brand-logo";
import { SignInFlow } from "@/components/ui/sign-in-flow-1";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

const passwordSchema = z.string().min(8, "Use pelo menos 8 caracteres").max(72);

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    let mounted = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || session) setAuthorized(true);
      setChecking(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setAuthorized(Boolean(data.session));
      setChecking(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (password !== confirmation) {
      toast.error("As senhas não conferem");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível alterar a senha", { description: error.message });
      return;
    }

    toast.success("Senha alterada com sucesso.");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <SignInFlow
      brand={<BrandLockup align="center" size="lg" onDark />}
      title="Defina sua nova senha"
      description="Use uma senha exclusiva para acessar o FitGestor."
      footer={<>Desenvolvido pela Quero Ser Fit<sup className="text-[0.6em]">®</sup></>}
    >
      {checking ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-white/70" /></div>
      ) : authorized ? (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-white/80">Nova senha</Label>
            <Input id="new-password" type="password" autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required
              className="bg-white/5 border-white/10 text-white placeholder:text-white/40" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password" className="text-white/80">Confirmar nova senha</Label>
            <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)} required
              className="bg-white/5 border-white/10 text-white placeholder:text-white/40" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar nova senha
          </Button>
        </form>
      ) : (
        <div className="mt-6 space-y-4 text-center text-sm text-white/75">
          <p>Este link expirou ou não é válido. Solicite um novo link na tela de entrada.</p>
          <Button type="button" variant="secondary" className="w-full" onClick={() => navigate({ to: "/auth" })}>
            Voltar para o login
          </Button>
        </div>
      )}
    </SignInFlow>
  );
}
