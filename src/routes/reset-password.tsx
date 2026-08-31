import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { BrandLockup } from "@/components/brand-logo";
import { SignInFlow } from "@/components/ui/sign-in-flow-1";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Redefinir senha | FitGestor" },
      { name: "description", content: "Defina uma nova senha para acessar o FitGestor." },
      { property: "og:title", content: "Redefinir senha | FitGestor" },
      { property: "og:description", content: "Defina uma nova senha para acessar o FitGestor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

const passwordSchema = z
  .object({
    password: z.string().min(8, "A senha deve ter no mínimo 8 caracteres").max(72, "Máximo de 72 caracteres"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "As senhas não conferem", path: ["confirm"] });

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) setStatus("ready");
    });

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setStatus(data.session ? "ready" : "invalid");
    })();

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(values);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível alterar a senha", { description: error.message });
      return;
    }
    toast.success("Senha atualizada com sucesso!");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <SignInFlow
      brand={<BrandLockup align="center" size="lg" onDark />}
      title="Definir nova senha"
      description="Escolha uma nova senha para acessar sua conta."
      footer={
        <>
          Desenvolvido pela Quero Ser Fit<sup className="text-[0.6em]">®</sup>
        </>
      }
    >
      {status === "checking" && (
        <div className="flex items-center justify-center py-8 text-white/70">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Validando link...
        </div>
      )}

      {status === "invalid" && (
        <div className="space-y-4 text-center">
          <p className="text-sm text-white/70">
            Este link de recuperação é inválido ou expirou. Solicite um novo e-mail de redefinição de senha.
          </p>
          <Button
            asChild
            className="w-full bg-gradient-to-r from-blue-800 to-blue-500 hover:from-blue-700 hover:to-blue-400 text-white"
          >
            <Link to="/auth">Voltar ao login</Link>
          </Button>
        </div>
      )}

      {status === "ready" && (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rp-pass" className="text-white/80">Nova senha</Label>
            <Input
              id="rp-pass"
              type="password"
              autoComplete="new-password"
              value={values.password}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
              required
              className="bg-white/5 border-white/10 text-white placeholder:text-white/40"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rp-confirm" className="text-white/80">Confirmar nova senha</Label>
            <Input
              id="rp-confirm"
              type="password"
              autoComplete="new-password"
              value={values.confirm}
              onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))}
              required
              className="bg-white/5 border-white/10 text-white placeholder:text-white/40"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-blue-800 to-blue-500 hover:from-blue-700 hover:to-blue-400 text-white shadow-lg shadow-blue-800/20"
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar nova senha
          </Button>
          <div className="text-center">
            <Link to="/auth" className="text-[12px] text-blue-300 hover:text-blue-200 hover:underline">
              Voltar ao login
            </Link>
          </div>
        </form>
      )}
    </SignInFlow>
  );
}
