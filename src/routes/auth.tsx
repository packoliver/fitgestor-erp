import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { BrandLockup } from "@/components/brand-logo";
import { SignInFlow } from "@/components/ui/sign-in-flow-1";

const searchSchema = z.object({ mode: z.enum(["signin", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Entrar | FitGestor" },
      { name: "description", content: "Acesse o FitGestor para gerenciar estoque, vendas e entregas da sua loja." },
      { property: "og:title", content: "Entrar | FitGestor" },
      { property: "og:description", content: "Acesse o FitGestor para gerenciar sua loja." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const credentialsSchema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(6, "Mínimo de 6 caracteres").max(72),
});

function AuthPage() {
  const navigate = useNavigate();

  return (
    <SignInFlow
      brand={<BrandLockup align="center" size="lg" onDark />}
      title="Bem-vindo ao FitGestor"
      description="Entre para acessar a gestão da sua loja."
      footer={
        <>
          Desenvolvido pela Quero Ser Fit<sup className="text-[0.6em]">®</sup>
        </>
      }
    >
      <SignInForm onDone={() => navigate({ to: "/dashboard" })} />
    </SignInFlow>
  );
}

function SignInForm({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({ email: "", password: "" });
  const [resetting, setResetting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = credentialsSchema.safeParse(values);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }
    onDone();
  }

  async function forgot() {
    const email = values.email.trim();
    const emailParsed = z.string().email().safeParse(email);
    if (!emailParsed.success) {
      toast.error("Informe seu e-mail para recuperar a senha");
      return;
    }
    setResetting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetting(false);
    if (error) {
      toast.error("Erro ao enviar e-mail", { description: error.message });
      return;
    }
    toast.success("Enviamos um e-mail com as instruções de recuperação.");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="si-email" className="text-white/80">E-mail</Label>
        <Input
          id="si-email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
          required
          className="bg-white/5 border-white/10 text-white placeholder:text-white/40"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="si-pass" className="text-white/80">Senha</Label>
          <button
            type="button"
            onClick={forgot}
            disabled={resetting}
            className="text-[12px] text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline disabled:opacity-50"
          >
            {resetting ? "Enviando..." : "Esqueci minha senha"}
          </button>
        </div>
        <Input
          id="si-pass"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
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
        Entrar
      </Button>
    </form>
  );
}
