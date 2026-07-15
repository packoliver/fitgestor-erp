import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Boxes, ShoppingBag, Tag, Users, Package, LineChart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="font-display text-lg font-semibold">F</span>
            </div>
            <span className="font-display text-xl font-semibold">FitGestor</span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost">
              <Link to="/auth">Entrar</Link>
            </Button>
            <Button asChild>
              <Link to="/auth" search={{ mode: "signup" }}>Começar</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 py-24">
          <div className="max-w-3xl">
            <p className="text-sm font-medium uppercase tracking-widest text-primary">ERP para moda fitness</p>
            <h1 className="mt-4 font-display text-5xl font-semibold leading-tight tracking-tight md:text-6xl">
              Gestão que acompanha o ritmo da sua loja.
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Produtos, variações por tamanho, estoque unificado entre loja física e online,
              etiquetas com código de barras e auditoria completa. Tudo em um só lugar.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>Criar conta grátis</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/auth">Já tenho conta</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 md:grid-cols-3">
            {[
              { icon: Package, title: "Produtos e variações", desc: "Cada cor é um produto; tamanhos são variações com SKU e código de barras próprios." },
              { icon: Boxes, title: "Estoque unificado", desc: "Movimentações rastreadas, entradas, inventário e ajustes com auditoria total." },
              { icon: Tag, title: "Etiquetas prontas", desc: "Gere PDFs de etiquetas com CODE128 usando seu próprio SKU." },
              { icon: ShoppingBag, title: "Pronto para Shopify e Olist", desc: "Arquitetura preparada para sincronização futura sem quebrar SKUs." },
              { icon: Users, title: "Funcionários e permissões", desc: "Papéis por módulo — Administrador, Gerente, Caixa, Vendedor e Estoquista." },
              { icon: LineChart, title: "Dashboard operacional", desc: "Alertas de estoque baixo, produtos sem foto, SKUs duplicados e mais." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl border bg-card p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} FitGestor</span>
          <span>Etapa 1 · Base operacional</span>
        </div>
      </footer>
    </div>
  );
}
