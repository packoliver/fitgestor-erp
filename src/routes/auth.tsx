import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { QsfIdentity } from "@/components/qsf-logo";

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
    <div className="dark min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-10 flex justify-center">
          <QsfIdentity align="center" size="lg" onDark />
        </div>

        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-2">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Acessar conta</h2>
            <p className="text-[13px] text-muted-foreground">Entre com suas credenciais corporativas.</p>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
              <TabsList className="grid w-full grid-cols-2">
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
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Ambiente corporativo · Quero Ser Fit<sup className="text-[0.6em]">®</sup>
        </p>
      </div>
    </div>
  );
}

function SignInForm({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({ email: "", password: "" });

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

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="si-email">E-mail</Label>
        <Input id="si-email" type="email" autoComplete="email" value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="si-pass">Senha</Label>
        <Input id="si-pass" type="password" autoComplete="current-password" value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
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
        <Label htmlFor="su-name">Nome completo</Label>
        <Input id="su-name" value={values.fullName}
          onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="su-email">E-mail</Label>
        <Input id="su-email" type="email" autoComplete="email" value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="su-pass">Senha</Label>
        <Input id="su-pass" type="password" autoComplete="new-password" value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Criar conta
      </Button>
    </form>
  );
}
