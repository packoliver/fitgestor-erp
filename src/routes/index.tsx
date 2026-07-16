import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Boxes, ShoppingBag, Tag, Users, Package, LineChart,
  ArrowRight, Check, Sparkles, ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

const features = [
  { icon: Package, title: "Produtos e variações", desc: "Cada cor é um produto; tamanhos são variações com SKU e código de barras próprios." },
  { icon: Boxes, title: "Estoque unificado", desc: "Movimentações rastreadas, entradas, inventário e ajustes com auditoria total." },
  { icon: Tag, title: "Etiquetas prontas", desc: "Gere PDFs de etiquetas com CODE128 usando seu próprio SKU, no seu ritmo." },
  { icon: ShoppingBag, title: "Pronto para marketplace", desc: "Arquitetura preparada para Shopify e Olist sem quebrar SKUs existentes." },
  { icon: Users, title: "Funcionários e permissões", desc: "Papéis por módulo — Administrador, Gerente, Caixa, Vendedor e Estoquista." },
  { icon: LineChart, title: "Dashboard operacional", desc: "Alertas de estoque baixo, produtos sem foto, SKUs duplicados e muito mais." },
];

function Landing() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary text-white shadow-glow">
              <span className="font-display text-lg font-bold leading-none">F</span>
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">FitGestor</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth">Entrar</Link>
            </Button>
            <Button asChild size="sm" variant="premium">
              <Link to="/auth" search={{ mode: "signup" }}>
                Começar agora <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
              <span className="font-display text-lg font-bold leading-none">F</span>
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">FitGestor</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth">Entrar</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/auth" search={{ mode: "signup" }}>
                Começar agora <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 opacity-[0.35]"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)",
            }}
          />
          <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-20 pb-24 sm:pt-28 sm:pb-32 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-xs">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              ERP moderno para moda fitness
            </div>
            <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              Gestão que acompanha
              <br className="hidden sm:block" />
              <span className="text-primary">o ritmo da sua loja.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed">
              Produtos, variações por tamanho, estoque unificado entre loja física e online,
              etiquetas com código de barras e auditoria completa. Tudo em um só lugar.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>
                  Criar conta grátis <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/auth">Já tenho conta</Link>
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Sem cartão de crédito</span>
              <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> Configuração em 2 minutos</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-success" /> Dados criptografados</span>
            </div>
          </div>

          {/* Product mockup */}
          <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-24">
            <div className="relative rounded-3xl border border-border bg-card p-1.5 shadow-lg">
              <div className="rounded-[calc(1.5rem-6px)] border border-border bg-muted/40 overflow-hidden">
                <div className="flex items-center gap-1.5 border-b border-border bg-card px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
                  <span className="ml-3 text-xs text-muted-foreground">fitgestor.app/dashboard</span>
                </div>
                <div className="grid grid-cols-5 min-h-[360px]">
                  <div className="col-span-1 border-r border-border bg-card p-4 space-y-1.5 hidden sm:block">
                    {["Dashboard", "PDV", "Produtos", "Estoque", "Etiquetas", "Clientes"].map((l, i) => (
                      <div key={l} className={`h-8 rounded-lg px-3 flex items-center text-xs font-medium ${i === 0 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>{l}</div>
                    ))}
                  </div>
                  <div className="col-span-5 sm:col-span-4 p-6 space-y-4">
                    <div className="h-6 w-40 rounded-md bg-foreground/10" />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                          <div className="h-3 w-16 rounded-md bg-muted-foreground/25" />
                          <div className="h-6 w-20 rounded-md bg-foreground/15" />
                        </div>
                      ))}
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <div className="h-3.5 w-1/2 rounded-md bg-muted-foreground/20" />
                          <div className="h-5 w-14 rounded-full bg-primary/15" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-24">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Recursos</p>
              <h2 className="mt-3 font-display text-3xl sm:text-4xl font-semibold tracking-tight">
                Tudo que sua operação precisa, em um só lugar.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Construído para lojas que vendem no balcão e online sem perder o controle do estoque.
              </p>
            </div>
            <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {features.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="group rounded-2xl border border-border bg-card p-6 shadow-xs transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-base font-semibold tracking-tight">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-24">
            <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-10 sm:p-14 text-center shadow-xs">
              <div
                aria-hidden
                className="absolute inset-0 -z-10 opacity-60"
                style={{
                  backgroundImage:
                    "radial-gradient(ellipse 80% 60% at 50% 100%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 70%)",
                }}
              />
              <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
                Pronta para profissionalizar sua loja?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                Comece grátis, sem cartão. Você configura tudo em minutos e escala quando quiser.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button asChild size="lg">
                  <Link to="/auth" search={{ mode: "signup" }}>
                    Criar conta grátis <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/auth">Fazer login</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-[11px] font-bold">F</div>
            <span>© {new Date().getFullYear()} FitGestor</span>
          </div>
          <span className="text-xs">Feito para lojas que vendem melhor.</span>
        </div>
      </footer>
    </div>
  );
}
