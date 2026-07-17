import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  component: AuthPage,
});

const credentialsSchema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(6, "Mínimo de 6 caracteres").max(72),
});
const signupSchema = credentialsSchema.extend({
  fullName: z.string().trim().min(2, "Informe seu nome").max(120),
});

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"signin" | "signup">(search.mode ?? "signin");

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
      <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
        <TabsList className="grid w-full grid-cols-2 bg-white/5">
          <TabsTrigger value="signin">Entrar</TabsTrigger>
          <TabsTrigger value="signup">Cadastrar</TabsTrigger>
        </TabsList>
        <TabsContent value="signin" className="mt-6">
          <SignInForm onDone={() => navigate({ to: "/dashboard" })} />
        </TabsContent>
        <TabsContent value="signup" className="mt-6">
          <SignUpForm onDone={() => navigate({ to: "/setup" })} />
        </TabsContent>
      </Tabs>
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
            className="text-[12px] text-violet-300 hover:text-violet-200 underline-offset-2 hover:underline disabled:opacity-50"
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
        className="w-full bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-400 hover:to-blue-400 text-white shadow-lg shadow-violet-500/20"
        disabled={loading}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Entrar
      </Button>
    </form>
  );
}

function SignUpForm({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({ fullName: "", email: "", password: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = signupSchema.safeParse(values);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name: parsed.data.fullName },
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Erro ao cadastrar", { description: error.message });
      return;
    }
    toast.success("Conta criada! Vamos configurar sua loja.");
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="su-name" className="text-white/80">Nome completo</Label>
        <Input
          id="su-name"
          value={values.fullName}
          onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))}
          required
          className="bg-white/5 border-white/10 text-white placeholder:text-white/40"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="su-email" className="text-white/80">E-mail</Label>
        <Input
          id="su-email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
          required
          className="bg-white/5 border-white/10 text-white placeholder:text-white/40"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="su-pass" className="text-white/80">Senha</Label>
        <Input
          id="su-pass"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
          required
          className="bg-white/5 border-white/10 text-white placeholder:text-white/40"
        />
      </div>
      <Button
        type="submit"
        className="w-full bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-400 hover:to-blue-400 text-white shadow-lg shadow-violet-500/20"
        disabled={loading}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Criar conta
      </Button>
    </form>
  );
}
