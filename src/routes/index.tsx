import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ReactNode } from "react";
import { BrandMark, BrandLockup } from "@/components/brand-logo";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const { data: workspace } = await supabase.rpc("default_workspace_for_current_user");
    const target =
      workspace === "operational" ? "/trabalho" :
      workspace === "motoboy" ? "/motoboy" :
      workspace === "setup" ? "/setup" :
      "/dashboard";
    throw redirect({ to: target });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="dark fit-aurora min-h-screen text-foreground selection:bg-primary/30 selection:text-foreground">
      <SiteHeader />
      <main>
        <Hero />
        <OperationOverview />
        <ModuleSection index="01" eyebrow="Recebimento"
          title="Da chegada da mercadoria ao estoque, em um único fluxo."
          body="Escaneie o código de barras, confira a quantidade e feche o recebimento com histórico completo, controle de concorrência e etiquetas prontas para impressão."
          reverse={false} mockup={<ReceivingMockup />} />
        <ModuleSection index="02" eyebrow="Estoque"
          title="Cada cor um produto. Cada tamanho uma variação."
          body="Grade de tamanhos, SKU próprio por variação, saldo em tempo real, alertas de baixa e auditoria de cada movimentação."
          reverse mockup={<StockMockup />} />
        <ModuleSection index="03" eyebrow="Etiquetas"
          title="CODE128 impresso no seu ritmo."
          body="Gere lotes de etiquetas em PDF com o seu próprio SKU, sem retrabalho, prontos para a impressora térmica."
          reverse={false} mockup={<LabelsMockup />} />
        <ModuleSection index="04" eyebrow="PDV"
          title="Venda pelo balcão sem perder o controle."
          body="Ponto de venda direto ao ponto: leitor, pagamento, recibo e baixa de estoque instantânea, com permissões por cargo."
          reverse mockup={<PdvMockup />} />
        <ModuleSection index="05" eyebrow="Trocas e crédito"
          title="Trocas organizadas, vale-crédito rastreável."
          body="Registre trocas com origem, motivo e crédito por cliente. Consulta e uso do saldo sem planilhas paralelas."
          reverse={false} mockup={<ExchangeMockup />} />
        <ModuleSection index="06" eyebrow="Relatórios"
          title="Números claros para decidir sem achismo."
          body="Vendas por período, produtos parados, curva de estoque, trocas e créditos — a operação em uma única leitura."
          reverse mockup={<ReportsMockup />} />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------- Header ---------------------------------- */

function SiteHeader() {
  return (
    <header className="glass-soft sticky top-0 z-30 rounded-none border-0 border-b border-white/10">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 lg:px-10">
        <Link to="/" className="flex items-center gap-2.5">
          <BrandMark size={30} />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">FitGestor</span>
        </Link>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hover:bg-white/5">
            <Link to="/auth">Entrar</Link>
          </Button>
          <Button asChild size="sm" className="rounded-[10px] bg-primary text-primary-foreground hover:bg-primary-hover">
            <Link to="/auth">Acessar sistema</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------- Hero ---------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-white/5">
      {/* Aurora blobs de fundo */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-20 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.35),transparent_70%)] blur-3xl" />
        <div className="absolute top-20 right-[-160px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.28),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-180px] left-1/3 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.30),transparent_70%)] blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-14 px-6 pb-24 pt-20 lg:grid-cols-12 lg:gap-10 lg:px-10 lg:pb-32 lg:pt-28">
        <div className="lg:col-span-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-primary-glow shadow-[0_0_10px_rgba(167,139,250,0.9)]" />
            FitGestor · Sistema de Gestão
          </div>

          <h1 className="mt-8 text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-[54px] lg:text-[60px]">
            Da entrada da mercadoria<br />
            à venda,<br />
            <span className="bg-gradient-to-r from-white via-white/70 to-white/40 bg-clip-text text-transparent">tudo sob controle.</span>
          </h1>

          <p className="mt-7 max-w-[54ch] text-[15.5px] leading-relaxed text-muted-foreground">
            O FitGestor foi desenvolvido pela Quero Ser Fit<sup className="text-[0.6em]">®</sup> para
            centralizar toda a operação da empresa em uma única plataforma. Controle
            estoque, recebimentos, etiquetas, vendas, PDV, trocas, relatórios e
            indicadores com rapidez, organização e segurança.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="rounded-full bg-primary px-6 text-primary-foreground shadow-[0_10px_30px_-8px_rgba(139,92,246,0.65)] hover:bg-primary-hover hover:shadow-[0_14px_36px_-8px_rgba(139,92,246,0.8)]">
              <Link to="/auth">
                Entrar no sistema <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="rounded-full border border-white/12 bg-white/[0.04] text-foreground backdrop-blur-md hover:bg-white/[0.08]">
              <a href="#operacao">Conhecer a plataforma</a>
            </Button>
          </div>

          <dl className="mt-14 grid max-w-md grid-cols-3 gap-8 border-t border-white/8 pt-8">
            <Stat kpi="7" label="módulos integrados" />
            <Stat kpi="1" label="fonte de verdade" />
            <Stat kpi="0" label="planilhas paralelas" />
          </dl>
        </div>

        <div className="relative lg:col-span-6">
          {/* Glow difuso atrás do mockup */}
          <div aria-hidden className="pointer-events-none absolute -inset-10 rounded-[40px] bg-[radial-gradient(circle_at_50%_40%,rgba(139,92,246,0.35),transparent_60%)] blur-2xl" />
          <div className="relative">
            <HeroMockup />
            {/* Cards flutuantes Liquid Glass */}
            <FloatingChip
              className="absolute -left-6 top-10 hidden md:flex"
              label="Vendas do dia"
              value="R$ 4.820"
              accent="+12%"
            />
            <FloatingChip
              className="absolute -right-6 top-1/2 hidden -translate-y-1/2 md:flex"
              label="Entregas em rota"
              value="14"
              accent="3 concluídas"
            />
            <FloatingChip
              className="absolute -bottom-6 left-8 hidden md:flex"
              label="Pós-venda"
              value="6"
              accent="pendentes"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function FloatingChip({ className, label, value, accent }: { className?: string; label: string; value: string; accent: string }) {
  return (
    <div
      className={`liquid-surface rounded-2xl px-4 py-3 min-w-[160px] ${className ?? ""}`}
      style={{ animation: "float 6s ease-in-out infinite" }}
    >
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/60">{label}</p>
      <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-white">{value}</p>
      <p className="text-[10.5px] text-primary-glow">{accent}</p>
    </div>
  );
}

function Stat({ kpi, label }: { kpi: string; label: string }) {
  return (
    <div>
      <dt className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-foreground">{kpi}</dt>
      <dd className="mt-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dd>
    </div>
  );
}

/* --------------------------- Operation overview -------------------------- */

function OperationOverview() {
  const items = [
    { n: "01", t: "Recebimento", d: "Escaneie e concilie" },
    { n: "02", t: "Estoque", d: "Produto e variação" },
    { n: "03", t: "Etiquetas", d: "PDF e CODE128" },
    { n: "04", t: "PDV", d: "Venda no balcão" },
    { n: "05", t: "Trocas", d: "Crédito por cliente" },
    { n: "06", t: "Relatórios", d: "Decisões com dados" },
  ];
  return (
    <section id="operacao" className="border-b border-border">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 px-6 py-24 lg:grid-cols-12 lg:gap-10 lg:px-10">
        <div className="lg:col-span-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-glow">A operação</p>
          <h2 className="mt-4 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[36px]">
            Um sistema para tudo o que acontece entre a caixa aberta e o cliente na porta.
          </h2>
        </div>
        <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-border bg-border/60 sm:grid-cols-2 lg:col-span-8 lg:grid-cols-3">
          {items.map((it) => (
            <li key={it.n} className="flex flex-col justify-between bg-background p-6">
              <span className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground">{it.n}</span>
              <div className="mt-8">
                <p className="text-[15px] font-semibold text-foreground">{it.t}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{it.d}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------- Module section ----------------------------- */

function ModuleSection({
  index, eyebrow, title, body, reverse, mockup,
}: { index: string; eyebrow: string; title: string; body: string; reverse: boolean; mockup: ReactNode }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 px-6 py-24 lg:grid-cols-12 lg:gap-14 lg:px-10 lg:py-28">
        <div className={`lg:col-span-5 ${reverse ? "lg:order-2" : ""}`}>
          <div className="flex items-baseline gap-4">
            <span className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground">{index}</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-glow">{eyebrow}</span>
          </div>
          <h3 className="mt-5 text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[34px]">
            {title}
          </h3>
          <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground">{body}</p>
        </div>
        <div className={`lg:col-span-7 ${reverse ? "lg:order-1" : ""}`}>
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            {mockup}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Closing --------------------------------- */

function ClosingCta() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1200px] px-6 py-28 lg:px-10">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-glow">FitGestor</p>
            <h2 className="mt-4 text-[36px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[48px] lg:text-[58px]">
              A operação da empresa funciona melhor <br />
              <span className="text-muted-foreground">quando o sistema entende o negócio.</span>
            </h2>
          </div>
          <div className="flex items-end lg:col-span-4">
            <div className="w-full">
              <Button asChild size="lg" className="w-full rounded-[10px] bg-primary text-primary-foreground hover:bg-primary-hover">
                <Link to="/auth">
                  Entrar no sistema <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
                Ambiente corporativo. Acesso restrito à equipe autorizada da Quero Ser Fit<sup className="text-[0.6em]">®</sup>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- Footer --------------------------------- */

function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 px-6 py-12 sm:flex-row sm:items-center lg:px-10">
        <BrandLockup size="sm" onDark />
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <span className="text-[11px] text-muted-foreground">
            Desenvolvido pela Quero Ser Fit<sup className="text-[0.6em]">®</sup>
          </span>
          <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            © {new Date().getFullYear()} · Todos os direitos reservados
          </span>
        </div>
      </div>
    </footer>
  );
}

/* =============================== Mockups ================================ */

function BrowserChrome({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border bg-background/80 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="ml-3 truncate text-[11px] text-muted-foreground">fitgestor.app{path}</span>
      </div>
      <div className="bg-background">{children}</div>
    </div>
  );
}

function AppFrame({ active, children }: { active: string; children: ReactNode }) {
  const nav = ["Dashboard", "PDV", "Produtos", "Estoque", "Recebimentos", "Etiquetas", "Trocas", "Relatórios"];
  return (
    <div className="grid grid-cols-12">
      <aside className="col-span-3 hidden border-r border-border bg-[#0D0D10] p-3 text-[11px] sm:block">
        <div className="mb-3 flex items-center gap-2 px-2 py-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-primary text-[10px] font-semibold text-white">F</div>
          <span className="text-[12px] font-semibold text-white/90">FitGestor</span>
        </div>
        <nav className="space-y-0.5">
          {nav.map((l) => (
            <div key={l}
              className={`flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 ${
                l === active ? "bg-primary/15 text-white" : "text-white/55"
              }`}>
              <span className={`h-1 w-1 rounded-full ${l === active ? "bg-primary-glow" : "bg-white/20"}`} />
              {l}
            </div>
          ))}
        </nav>
      </aside>
      <div className="col-span-12 sm:col-span-9">{children}</div>
    </div>
  );
}

function HeroMockup() {
  return (
    <div className="liquid-surface rounded-[24px] p-2 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55)]">
      <div className="rounded-[18px] border border-white/10 bg-[#0d0d12] overflow-hidden">
      <BrowserChrome path="/dashboard">
        <AppFrame active="Dashboard">
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Visão geral</p>
                <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">Hoje, 16 de julho</p>
              </div>
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Loja Centro</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { l: "Vendas do dia", v: "R$ 4.820", d: "+12%" },
                { l: "Ticket médio", v: "R$ 187", d: "26 vendas" },
                { l: "Estoque baixo", v: "8", d: "SKUs" },
              ].map((k) => (
                <div key={k.l} className="rounded-[10px] border border-border bg-background p-3">
                  <p className="text-[10px] text-muted-foreground">{k.l}</p>
                  <p className="mt-1.5 text-[18px] font-semibold leading-none tracking-[-0.02em] text-foreground">{k.v}</p>
                  <p className="mt-1.5 text-[10px] text-primary-glow">{k.d}</p>
                </div>
              ))}
            </div>
            <div className="rounded-[10px] border border-border bg-background p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-foreground">Últimos recebimentos</p>
                <span className="text-[10px] text-muted-foreground">RC-0128 · RC-0127 · RC-0126</span>
              </div>
              <div className="mt-3 space-y-2">
                {[
                  ["Fornecedor Alfa", "142 peças", "Concluído"],
                  ["Fornecedor Nova", "38 peças", "Rascunho"],
                  ["Fornecedor Sul", "96 peças", "Concluído"],
                ].map(([f, q, s]) => (
                  <div key={f} className="flex items-center justify-between text-[11px]">
                    <span className="text-foreground">{f}</span>
                    <span className="text-muted-foreground">{q}</span>
                    <span className={s === "Rascunho" ? "text-primary-glow" : "text-muted-foreground"}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </AppFrame>
      </BrowserChrome>
      </div>
    </div>
  );
}

function ReceivingMockup() {
  return (
    <BrowserChrome path="/estoque/recebimentos/novo">
      <AppFrame active="Recebimentos">
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Recebimento</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">RC-0128 · Fornecedor Alfa</p>
            </div>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary-glow">Rascunho v3</span>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-3">
            <div className="col-span-2 space-y-2 rounded-[10px] border border-border bg-background p-3">
              <p className="text-[10px] text-muted-foreground">Bipar código de barras</p>
              <div className="rounded-[8px] border border-dashed border-border p-3 text-center font-mono text-[12px] text-foreground">
                7898·23140·00218
              </div>
              <p className="text-[10px] text-primary-glow">+1 unidade · Camiseta Slim · Preto · M</p>
            </div>
            <div className="col-span-3 rounded-[10px] border border-border bg-background">
              <div className="grid grid-cols-6 border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="col-span-3">Produto</span><span>P</span><span>M</span><span>G</span>
              </div>
              {[
                ["Camiseta Slim · Preto", 4, 6, 3],
                ["Camiseta Slim · Marinho", 2, 5, 4],
                ["Legging Alta · Grafite", 3, 4, 2],
              ].map(([n, a, b, c]) => (
                <div key={String(n)} className="grid grid-cols-6 border-b border-border/60 px-3 py-2 text-[11px] last:border-0">
                  <span className="col-span-3 text-foreground">{n as string}</span>
                  <span className="text-muted-foreground">{a as number}</span>
                  <span className="text-muted-foreground">{b as number}</span>
                  <span className="text-muted-foreground">{c as number}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AppFrame>
    </BrowserChrome>
  );
}

function StockMockup() {
  const rows = [
    ["Camiseta Slim", "Preto", "PP", "SKU-CS-PT-PP", 4, "OK"],
    ["Camiseta Slim", "Preto", "P", "SKU-CS-PT-P", 12, "OK"],
    ["Camiseta Slim", "Preto", "M", "SKU-CS-PT-M", 2, "Baixo"],
    ["Camiseta Slim", "Preto", "G", "SKU-CS-PT-G", 7, "OK"],
    ["Camiseta Slim", "Marinho", "M", "SKU-CS-MN-M", 0, "Zerado"],
    ["Legging Alta", "Grafite", "P", "SKU-LA-GR-P", 5, "OK"],
  ] as const;
  return (
    <BrowserChrome path="/estoque">
      <AppFrame active="Estoque">
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Estoque por variação</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">248 SKUs ativos</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Todos</span>
              <span className="rounded-full border border-border bg-white/5 px-2 py-0.5 text-[10px] text-foreground">Baixo (8)</span>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-[10px] border border-border">
            <div className="grid grid-cols-12 border-b border-border bg-background/60 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="col-span-4">Produto</span>
              <span className="col-span-2">Cor</span>
              <span className="col-span-1">Tam</span>
              <span className="col-span-3">SKU</span>
              <span className="col-span-1 text-right">Qtd</span>
              <span className="col-span-1 text-right">Status</span>
            </div>
            {rows.map((r) => (
              <div key={r[3]} className="grid grid-cols-12 border-b border-border/60 px-4 py-2.5 text-[11px] last:border-0">
                <span className="col-span-4 text-foreground">{r[0]}</span>
                <span className="col-span-2 text-muted-foreground">{r[1]}</span>
                <span className="col-span-1 text-muted-foreground">{r[2]}</span>
                <span className="col-span-3 font-mono text-[10.5px] text-muted-foreground">{r[3]}</span>
                <span className="col-span-1 text-right text-foreground">{r[4]}</span>
                <span className={`col-span-1 text-right text-[10px] ${
                  r[5] === "OK" ? "text-muted-foreground" : r[5] === "Baixo" ? "text-primary-glow" : "text-destructive"
                }`}>{r[5]}</span>
              </div>
            ))}
          </div>
        </div>
      </AppFrame>
    </BrowserChrome>
  );
}

function LabelsMockup() {
  return (
    <BrowserChrome path="/etiquetas">
      <AppFrame active="Etiquetas">
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Lote de etiquetas</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">LT-042 · 48 etiquetas</p>
            </div>
            <span className="rounded-[8px] border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] text-primary-glow">Gerar PDF</span>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-[8px] border border-border bg-[#F4F1ED] p-2 text-[9px] text-[#0D0D10]">
                <p className="truncate font-semibold">Camiseta Slim</p>
                <p className="mt-0.5 text-[8px] text-neutral-600">Preto · M</p>
                <div className="mt-2 flex h-6 items-end gap-[1px]">
                  {Array.from({ length: 28 }).map((__, j) => (
                    <span key={j} className="w-[2px] bg-[#0D0D10]"
                      style={{ height: `${40 + ((j * 13) % 60)}%`, opacity: j % 3 === 0 ? 1 : 0.85 }} />
                  ))}
                </div>
                <p className="mt-1 text-center font-mono text-[8px]">CS-PT-M-{100 + i}</p>
              </div>
            ))}
          </div>
        </div>
      </AppFrame>
    </BrowserChrome>
  );
}

function PdvMockup() {
  return (
    <BrowserChrome path="/pdv">
      <AppFrame active="PDV">
        <div className="grid grid-cols-5 gap-4 p-5">
          <div className="col-span-3 rounded-[10px] border border-border bg-background p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Carrinho</p>
            <div className="mt-3 space-y-2">
              {[
                ["Camiseta Slim · Preto · M", 2, "R$ 79,90"],
                ["Legging Alta · Grafite · P", 1, "R$ 149,90"],
                ["Top Cropped · Rosa · G", 1, "R$ 89,90"],
              ].map((it) => (
                <div key={it[0] as string} className="flex items-center justify-between text-[11px]">
                  <span className="text-foreground">{it[0]}</span>
                  <span className="text-muted-foreground">×{it[1]}</span>
                  <span className="font-mono text-foreground">{it[2]}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-3 text-[11px]">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="font-mono">R$ 399,60</span></div>
              <div className="mt-1 flex justify-between text-muted-foreground"><span>Desconto</span><span className="font-mono">— R$ 10,00</span></div>
              <div className="mt-2 flex justify-between text-[16px] font-semibold tracking-[-0.02em] text-foreground"><span>Total</span><span>R$ 389,60</span></div>
            </div>
          </div>
          <div className="col-span-2 space-y-3">
            <div className="rounded-[10px] border border-border bg-background p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Pagamento</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                {["Dinheiro", "Pix", "Débito", "Crédito"].map((p, i) => (
                  <div key={p} className={`rounded-[8px] border px-2 py-2 text-center ${i === 1 ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}>
                    {p}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[10px] bg-primary p-3 text-center text-[12px] font-semibold text-primary-foreground">
              Finalizar venda
            </div>
          </div>
        </div>
      </AppFrame>
    </BrowserChrome>
  );
}

function ExchangeMockup() {
  return (
    <BrowserChrome path="/trocas">
      <AppFrame active="Trocas">
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Nova troca</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">TR-0087 · Maria Andrade</p>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Venda VD-1204</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[10px] border border-border bg-background p-3">
              <p className="text-[10px] text-muted-foreground">Devolvido</p>
              <p className="mt-2 text-[12px] text-foreground">Legging Alta · Grafite · P</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">R$ 149,90</p>
            </div>
            <div className="rounded-[10px] border border-border bg-background p-3">
              <p className="text-[10px] text-muted-foreground">Trocado por</p>
              <p className="mt-2 text-[12px] text-foreground">Legging Alta · Grafite · M</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">R$ 149,90</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-[10px] border border-primary/40 bg-primary/10 p-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-primary-glow">Crédito gerado</p>
              <p className="mt-1 text-[16px] font-semibold tracking-[-0.02em] text-foreground">R$ 0,00</p>
            </div>
            <span className="rounded-[8px] bg-primary px-3 py-1.5 text-[11px] text-primary-foreground">Confirmar troca</span>
          </div>
        </div>
      </AppFrame>
    </BrowserChrome>
  );
}

function ReportsMockup() {
  const bars = [42, 58, 36, 71, 49, 64, 82, 55, 60, 74, 68, 90];
  return (
    <BrowserChrome path="/relatorios">
      <AppFrame active="Relatórios">
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Vendas · últimos 12 dias</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">R$ 48.310</p>
            </div>
            <div className="flex gap-1.5 text-[10px]">
              {["7d", "12d", "30d"].map((p, i) => (
                <span key={p} className={`rounded-full border px-2 py-0.5 ${i === 1 ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}>{p}</span>
              ))}
            </div>
          </div>
          <div className="mt-6 flex h-40 items-end gap-2">
            {bars.map((h, i) => (
              <div key={i} className="flex-1 rounded-t-[3px] bg-white/8" style={{ height: `${h}%` }}>
                <div className="h-full w-full rounded-t-[3px] bg-primary/70" style={{ opacity: i === bars.length - 1 ? 1 : 0.55 }} />
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4 text-[11px]">
            <div><p className="text-muted-foreground">Peças vendidas</p><p className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">312</p></div>
            <div><p className="text-muted-foreground">Trocas</p><p className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">14</p></div>
            <div><p className="text-muted-foreground">Crédito em aberto</p><p className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">R$ 486</p></div>
          </div>
        </div>
      </AppFrame>
    </BrowserChrome>
  );
}
