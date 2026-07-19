import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  ArrowRight, Boxes, ScanBarcode, Tag, ShoppingCart, RefreshCw, BarChart3,
  Truck, Users, Check, ShieldCheck, Zap, Database,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ReactNode } from "react";

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
  head: () => ({
    meta: [
      { title: "FitGestor · ERP para varejo de moda fitness" },
      { name: "description", content: "ERP completo para lojas de moda e fitness: PDV, estoque, recebimento, etiquetas, trocas, expedição e relatórios em um único sistema." },
      { property: "og:title", content: "FitGestor · ERP para varejo de moda fitness" },
      { property: "og:description", content: "PDV, estoque, recebimento, etiquetas, trocas, expedição e relatórios em um único sistema." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Landing() {
  return (
    <div className="min-h-screen bg-[#0b0d10] text-slate-100 antialiased">
      <SiteHeader />
      <main>
        <Hero />
        <TrustBar />
        <Modules />
        <PreviewSection />
        <WhyErp />
        <Testimonials />
        <FaqSection />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* -------------------------------- Header --------------------------------- */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0b0d10]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground">F</div>
          <span className="text-[15px] font-semibold tracking-tight text-white">FitGestor</span>
          <span className="ml-2 hidden rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:inline">ERP</span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          <a href="#modulos" className="text-[13px] text-slate-300 transition-colors hover:text-white">Módulos</a>
          <a href="#preview" className="text-[13px] text-slate-300 transition-colors hover:text-white">Sistema</a>
          <a href="#depoimentos" className="text-[13px] text-slate-300 transition-colors hover:text-white">Clientes</a>
          <a href="#faq" className="text-[13px] text-slate-300 transition-colors hover:text-white">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/auth" className="hidden rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-300 transition-colors hover:text-white sm:inline-block">
            Entrar
          </Link>
          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Acessar o sistema <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------- Hero ---------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-white/5">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.10),transparent_60%)]" />
      <div className="relative mx-auto max-w-[1200px] px-6 pb-16 pt-16 lg:pb-24 lg:pt-24">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Sistema operacional para lojas de moda fitness
            </span>
            <h1 className="mt-5 text-[38px] font-semibold leading-[1.05] tracking-[-0.02em] text-white sm:text-[46px] lg:text-[52px]">
              Da entrada da mercadoria à venda, tudo sob controle.
            </h1>
            <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-slate-400">
              ERP web unificado com PDV, estoque por variação, recebimento com bipagem,
              etiquetas, trocas, expedição de motoboy e relatórios — sem planilha paralela.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/auth" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Acessar o sistema <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#preview" className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/10">
                Ver o sistema
              </a>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-slate-400">
              {["100% web", "Multi-loja", "Auditoria completa", "Integração Olist / Tiny"].map((f) => (
                <li key={f} className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-400" />{f}</li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-6">
            <div className="rounded-xl border border-white/10 bg-[#0f1116] shadow-2xl shadow-black/40">
              <HeroMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Trust bar -------------------------------- */

function TrustBar() {
  const stats = [
    { v: "24/7", l: "Disponibilidade" },
    { v: "< 200 ms", l: "Resposta do PDV" },
    { v: "99,9%", l: "SLA operacional" },
    { v: "AES-256", l: "Dados em repouso" },
  ];
  return (
    <section className="border-b border-white/5 bg-[#0d1015]">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-y-6 px-6 py-8 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.l} className="border-l border-white/10 px-4 first:border-l-0">
            <p className="text-[18px] font-semibold text-white">{s.v}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">{s.l}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------- Modules -------------------------------- */

function Modules() {
  const items = [
    { icon: ScanBarcode, t: "Recebimento", d: "Bipagem, conferência por variação e entrada em lote com rastreabilidade completa." },
    { icon: Boxes, t: "Estoque", d: "Saldos por SKU, mínimos, reservado e disponível. Alertas de ruptura e curva ABC." },
    { icon: Tag, t: "Etiquetas", d: "Lotes com CODE128, geração em PDF pronta para impressora térmica." },
    { icon: ShoppingCart, t: "PDV", d: "Venda de balcão com cliente, vendedor, formas de pagamento e recibo." },
    { icon: RefreshCw, t: "Trocas", d: "Vale-troca e crédito por cliente, aplicados automaticamente no PDV." },
    { icon: Truck, t: "Expedição", d: "Fila de entregas, rotas, motoboy e comprovante digital do cliente." },
    { icon: Users, t: "Funcionários", d: "Cargos, permissões granulares e trilha de auditoria por ação." },
    { icon: BarChart3, t: "Relatórios", d: "Vendas, ticket médio, mais vendidos, trocas e desempenho por vendedor." },
  ];
  return (
    <section id="modulos" className="border-b border-white/5">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-glow">Módulos</p>
          <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[36px]">
            Um sistema, oito operações — uma única fonte de verdade.
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-slate-400">
            Cada módulo do FitGestor conversa com os demais em tempo real: o estoque cai na venda, a troca gera crédito, a etiqueta sai do recebimento.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex flex-col gap-3 bg-[#0f1116] p-5 transition-colors hover:bg-[#12151b]">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/5 text-primary-glow">
                <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-white">{t}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-400">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Preview section --------------------------- */

function PreviewSection() {
  return (
    <section id="preview" className="border-b border-white/5 bg-[#0d1015]">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-glow">O sistema por dentro</p>
          <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[36px]">
            Interface pensada para quem opera no dia a dia.
          </h2>
        </div>
        <div className="mt-10 space-y-6">
          <ModuleRow eyebrow="01 · Recebimento" title="Bipe o código de barras, confira por variação, encerre o lote." body="Substitua a planilha de conferência. O rascunho salva a cada bipagem, e o encerramento gera o movimento de entrada com rastreabilidade." mockup={<ReceivingMockup />} />
          <ModuleRow eyebrow="02 · Estoque" reverse title="Saldos por SKU, com alerta de ruptura e mínimo." body="Filtre por marca, categoria, cor, tamanho ou situação. Exporte para conferência ou dispare recontagem de inventário." mockup={<StockMockup />} />
          <ModuleRow eyebrow="03 · PDV" title="Venda em segundos, com cliente, crédito e trocas integrados." body="Atalhos de teclado, formas de pagamento múltiplas e recibo pronto para impressão em térmica ou envio por WhatsApp." mockup={<PdvMockup />} />
          <ModuleRow eyebrow="04 · Relatórios" reverse title="Números que dão base para decisão — não para achismo." body="Vendas por período, ticket médio, mais vendidos, desempenho por vendedor e giro de estoque com comparativo." mockup={<ReportsMockup />} />
        </div>
      </div>
    </section>
  );
}

function ModuleRow({ eyebrow, title, body, reverse, mockup }: { eyebrow: string; title: string; body: string; reverse?: boolean; mockup: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-8 rounded-xl border border-white/10 bg-[#0f1116] p-6 lg:grid-cols-12 lg:gap-10 lg:p-8">
      <div className={`lg:col-span-4 ${reverse ? "lg:order-2" : ""}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-glow">{eyebrow}</p>
        <h3 className="mt-3 text-[22px] font-semibold leading-tight tracking-[-0.015em] text-white">{title}</h3>
        <p className="mt-3 text-[13.5px] leading-relaxed text-slate-400">{body}</p>
      </div>
      <div className={`lg:col-span-8 ${reverse ? "lg:order-1" : ""}`}>
        <div className="overflow-hidden rounded-lg border border-white/10 bg-background">
          {mockup}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Why ERP -------------------------------- */

function WhyErp() {
  const items = [
    { icon: Database, t: "Dado único", d: "Cadastro, estoque, venda e cliente centralizados — sem planilhas paralelas." },
    { icon: ShieldCheck, t: "Controle real", d: "Permissões por cargo, aprovações e trilha completa de auditoria." },
    { icon: Zap, t: "Operação rápida", d: "Fluxos otimizados para balcão, sem cliques desnecessários." },
  ];
  return (
    <section className="border-b border-white/5">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-20 lg:grid-cols-3">
        {items.map(({ icon: Icon, t, d }) => (
          <div key={t}>
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 text-primary-glow">
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <p className="mt-4 text-[16px] font-semibold text-white">{t}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-slate-400">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- Testimonials ----------------------------- */

function Testimonials() {
  const items = [
    { quote: "Reduzimos em 70% o tempo do recebimento. A conciliação virou parte natural do fluxo.", name: "Amanda Ribeiro", role: "Gerente de operações" },
    { quote: "O PDV com trocas e crédito resolveu a maior dor do balcão. Qualquer vendedor fecha sozinho.", name: "Rafael Nunes", role: "Supervisor de loja" },
    { quote: "Estoque, etiquetas e vendas na mesma plataforma acabou com as planilhas paralelas.", name: "Camila Duarte", role: "Diretora comercial" },
  ];
  return (
    <section id="depoimentos" className="border-b border-white/5 bg-[#0d1015]">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-glow">Clientes</p>
          <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[36px]">
            Times que trocaram planilhas por uma fonte de verdade.
          </h2>
        </div>
        <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          {items.map((t) => (
            <li key={t.name} className="flex flex-col rounded-lg border border-white/10 bg-[#0f1116] p-6">
              <p className="text-[14px] leading-relaxed text-slate-200">"{t.quote}"</p>
              <div className="mt-6 flex items-center gap-3 border-t border-white/10 pt-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-[12px] font-semibold text-primary-glow">
                  {t.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </div>
                <div>
                  <p className="text-[13px] font-medium text-white">{t.name}</p>
                  <p className="text-[11.5px] text-slate-400">{t.role}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------- FAQ ---------------------------------- */

function FaqSection() {
  const faqs = [
    { q: "O FitGestor substitui meu ERP atual?", a: "Sim. Para lojas de varejo de moda e itens fitness ele cobre recebimento, estoque, etiquetas, PDV, trocas, entregas, funcionários e pós-venda em um único sistema, dispensando planilhas paralelas." },
    { q: "Precisa instalar algo na loja?", a: "Não. É 100% web em qualquer navegador moderno. Balança, leitor de código de barras e impressora de etiquetas funcionam nativamente via USB/serial." },
    { q: "Como funciona o controle de trocas e crédito?", a: "Toda troca gera vale ou crédito vinculado ao cliente. No PDV o crédito aparece na hora do pagamento, com histórico completo e regras de expiração configuráveis." },
    { q: "Consigo controlar entregas e motoboys?", a: "Sim. O módulo de expedição organiza fila, rotas e motoboys, com comprovantes digitais e rastreio por cliente." },
    { q: "Meus dados ficam seguros?", a: "Todo acesso é autenticado, com perfis de permissão por cargo, trilha de auditoria e backups automáticos em ambiente corporativo." },
    { q: "Integra com Olist / Tiny?", a: "Sim. Sincronização automática de produtos, variações, fotos e saldo de estoque, com webhook para atualizações em tempo real." },
  ];
  return (
    <section id="faq" className="border-b border-white/5">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-20 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-glow">FAQ</p>
          <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[32px]">
            Perguntas frequentes.
          </h2>
          <p className="mt-3 text-[13.5px] leading-relaxed text-slate-400">
            Não achou o que precisa? Fale com o time da Quero Ser Fit<sup className="text-[0.6em]">®</sup>.
          </p>
        </div>
        <ul className="divide-y divide-white/10 lg:col-span-8">
          {faqs.map((f) => (
            <li key={f.q}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5">
                  <span className="text-[14.5px] font-medium text-white">{f.q}</span>
                  <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/15 text-slate-400 transition-transform group-open:rotate-45 group-open:border-primary/60 group-open:text-primary-glow">+</span>
                </summary>
                <p className="pb-5 pr-10 text-[13.5px] leading-relaxed text-slate-400">{f.a}</p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------ Closing CTA ----------------------------- */

function ClosingCta() {
  return (
    <section className="border-b border-white/5 bg-[#0d1015]">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="flex flex-col items-start justify-between gap-6 rounded-xl border border-white/10 bg-[#0f1116] p-8 lg:flex-row lg:items-center lg:p-10">
          <div className="max-w-xl">
            <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[30px]">
              Pronto para operar tudo em um só sistema?
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-slate-400">
              Acesso restrito à equipe autorizada da Quero Ser Fit<sup className="text-[0.6em]">®</sup>. Solicite credenciais ao administrador.
            </p>
          </div>
          <Link to="/auth" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Acessar o sistema <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- Footer -------------------------------- */

function SiteFooter() {
  return (
    <footer className="bg-[#0b0d10]">
      <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-4 px-6 py-8 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground">F</div>
          <span className="text-[13.5px] font-semibold text-white">FitGestor</span>
          <span className="text-[11.5px] text-slate-500">· ERP para varejo de moda fitness</span>
        </div>
        <p className="text-[11.5px] text-slate-500">
          © {new Date().getFullYear()} Quero Ser Fit<sup className="text-[0.6em]">®</sup> — Todos os direitos reservados.
        </p>
      </div>
    </footer>
  );
}

/* =============================== Mockups ================================ */

function BrowserChrome({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border bg-background/80 px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="ml-3 truncate text-[11px] text-muted-foreground">fitgestor.app{path}</span>
      </div>
      <div className="overflow-x-auto bg-background">{children}</div>
    </div>
  );
}

function AppFrame({ active, children }: { active: string; children: ReactNode }) {
  const nav = ["Dashboard", "PDV", "Produtos", "Estoque", "Recebimentos", "Etiquetas", "Trocas", "Relatórios"];
  return (
    <div className="grid grid-cols-12">
      <aside className="col-span-3 hidden border-r border-border bg-[#0D0D10] p-3 text-[11px] sm:block">
        <div className="mb-3 flex items-center gap-2 px-2 py-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-white">F</div>
          <span className="text-[12px] font-semibold text-white/90">FitGestor</span>
        </div>
        <nav className="space-y-0.5">
          {nav.map((l) => (
            <div key={l} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 ${l === active ? "bg-primary/15 text-white" : "text-white/55"}`}>
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
    <BrowserChrome path="/dashboard">
      <AppFrame active="Dashboard">
        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Visão geral</p>
              <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">Hoje, 19 de julho</p>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Loja Centro</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { l: "Vendas do dia", v: "R$ 4.820", d: "+12%" },
              { l: "Ticket médio", v: "R$ 187", d: "26 vendas" },
              { l: "Estoque baixo", v: "8", d: "SKUs" },
            ].map((k) => (
              <div key={k.l} className="rounded-md border border-border bg-background p-3">
                <p className="text-[10px] text-muted-foreground">{k.l}</p>
                <p className="mt-1.5 text-[18px] font-semibold leading-none tracking-[-0.02em] text-foreground">{k.v}</p>
                <p className="mt-1.5 text-[10px] text-primary-glow">{k.d}</p>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-border bg-background p-3">
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
            <div className="col-span-2 space-y-2 rounded-md border border-border bg-background p-3">
              <p className="text-[10px] text-muted-foreground">Bipar código de barras</p>
              <div className="rounded-md border border-dashed border-border p-3 text-center font-mono text-[12px] text-foreground">
                7898·23140·00218
              </div>
              <p className="text-[10px] text-primary-glow">+1 unidade · Camiseta Slim · Preto · M</p>
            </div>
            <div className="col-span-3 rounded-md border border-border bg-background">
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
          <div className="mt-4 overflow-hidden rounded-md border border-border">
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
                <span className={`col-span-1 text-right text-[10px] ${r[5] === "OK" ? "text-muted-foreground" : r[5] === "Baixo" ? "text-primary-glow" : "text-destructive"}`}>{r[5]}</span>
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
          <div className="col-span-3 rounded-md border border-border bg-background p-3">
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
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Pagamento</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                {["Dinheiro", "Pix", "Débito", "Crédito"].map((p, i) => (
                  <div key={p} className={`rounded-md border px-2 py-2 text-center ${i === 1 ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}>
                    {p}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md bg-primary p-3 text-center text-[12px] font-semibold text-primary-foreground">
              Finalizar venda
            </div>
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
              <div key={i} className="flex-1 rounded-t bg-white/8" style={{ height: `${h}%` }}>
                <div className="h-full w-full rounded-t bg-primary/70" style={{ opacity: i === bars.length - 1 ? 1 : 0.55 }} />
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
