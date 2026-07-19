import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ReactNode } from "react";
import { BrandLockup } from "@/components/brand-logo";
import heroAthlete from "@/assets/hero-athlete.jpg";

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
    <div className="dark min-h-screen bg-[#0a0a0a] text-foreground selection:bg-[#FF4D00] selection:text-white">
      <SiteHeader />
      <main>
        <Hero />
        <OperationOverview />
        <Testimonials />
        <FaqSection />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------- Header ---------------------------------- */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0a0a]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-6 lg:px-10">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center bg-[#FF4D00]">
            <span className="font-['Bebas_Neue'] text-xl leading-none text-black">F</span>
          </div>
          <span className="font-['Bebas_Neue'] text-2xl leading-none tracking-[0.08em] text-white">
            FITGESTOR
          </span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          <a href="#operacao" className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70 transition-colors hover:text-[#FF4D00]">Operação</a>
          <a href="#depoimentos" className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70 transition-colors hover:text-[#FF4D00]">Times</a>
          <a href="#faq" className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70 transition-colors hover:text-[#FF4D00]">FAQ</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link to="/auth" className="hidden text-[10px] font-black uppercase tracking-[0.28em] text-white/70 transition-colors hover:text-white sm:inline">
            Entrar
          </Link>
          <Link
            to="/auth"
            className="bg-[#FF4D00] px-5 py-3 text-[10px] font-black uppercase tracking-[0.24em] text-white transition-all hover:-translate-y-0.5 hover:bg-white hover:text-black active:translate-y-0"
          >
            Acessar
          </Link>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------- Hero ---------------------------------- */

function Hero() {
  return (
    <section className="relative w-full overflow-hidden bg-[#0a0a0a] px-4 py-6 md:p-8">
      <div className="relative mx-auto flex w-full max-w-[1400px] flex-col overflow-hidden border-4 border-white bg-[#1a1a1a] shadow-[0_0_50px_rgba(0,0,0,0.5)] md:aspect-[16/9] md:flex-row">
        {/* Diagonal energy stripes */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <div className="absolute -top-1/2 -right-1/4 h-[200%] w-[80%] translate-x-10 rotate-[25deg] bg-[#FF4D00]" />
          <div className="absolute -top-1/2 -right-1/3 h-[200%] w-[80%] translate-x-40 rotate-[25deg] bg-[#FFD700] opacity-80" />
        </div>

        {/* Content layer */}
        <div className="relative z-20 flex w-full flex-col md:h-full md:flex-row">
          {/* Left: editorial headline box */}
          <div className="flex w-full items-center justify-center p-6 py-14 md:h-full md:w-5/12 md:p-12 lg:p-16">
            <div className="w-full -rotate-1 bg-white p-6 shadow-[10px_10px_0px_0px_#FF4D00] md:p-10 md:shadow-[15px_15px_0px_0px_#FF4D00] lg:p-12">
              <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-black/60">
                FitGestor · Sistema de Gestão
              </p>
              <h1 className="font-['Bebas_Neue'] text-[68px] leading-[0.85] tracking-tight text-[#FF4D00] uppercase md:text-[92px] lg:text-[112px]">
                ENTRADA.<br />ESTOQUE.<br />VENDA.
              </h1>
              <p className="mt-6 border-l-4 border-black pl-4 text-[15px] font-black leading-tight text-black md:text-lg">
                O ERP QUE ENTENDE O RITMO DA SUA LOJA DE MODA FITNESS.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/auth"
                  className="inline-flex items-center justify-center gap-2 bg-black px-8 py-4 text-[11px] font-black uppercase tracking-[0.22em] text-white transition-all hover:-translate-y-1 hover:bg-[#FF4D00] active:translate-y-0"
                >
                  Acessar o sistema <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <a
                  href="#operacao"
                  className="inline-flex items-center justify-center border-2 border-black px-8 py-4 text-[11px] font-black uppercase tracking-[0.22em] text-black transition-all hover:bg-black hover:text-white"
                >
                  Conhecer módulos
                </a>
              </div>
            </div>
          </div>

          {/* Right: hero image + vertical text */}
          <div className="relative flex min-h-[420px] w-full flex-col justify-end md:h-full md:w-7/12 md:min-h-0">
            <div className="absolute inset-0 z-10">
              <img
                src={heroAthlete}
                alt="Atleta em movimento"
                width={1200}
                height={1600}
                className="h-full w-full object-cover object-center grayscale contrast-125"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            </div>

            {/* Giant vertical text overlay */}
            <div aria-hidden className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden">
              <div className="rotate-90 whitespace-nowrap font-['Bebas_Neue'] text-[16rem] leading-none tracking-tighter text-white/10 md:text-[22rem]">
                FITGESTOR
              </div>
            </div>

            {/* Bottom branding bar */}
            <div className="relative z-30 flex w-full items-end justify-between p-6 md:p-8">
              <div className="text-white">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.28em] opacity-70">
                  Management System
                </div>
                <div className="h-1 w-24 bg-[#FFD700]" />
              </div>
              <div className="bg-[#FFD700] p-3 text-[10px] font-black uppercase tracking-[0.22em] text-black md:p-4">
                Powering Fitness Retail
              </div>
            </div>
          </div>
        </div>

        {/* Decorative frame elements */}
        <div aria-hidden className="absolute left-4 top-4 z-40 flex space-x-2 md:left-6 md:top-6">
          <div className="h-2 w-2 bg-[#FF4D00]" />
          <div className="h-2 w-2 bg-white" />
          <div className="h-2 w-2 bg-[#FFD700]" />
        </div>
        <div aria-hidden className="absolute bottom-4 right-4 z-40 font-mono text-[9px] text-white/40 md:bottom-6 md:right-6 md:text-[10px]">
          SYSTEM_ID: 04-GESTOR-MODA
        </div>
      </div>
    </section>
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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-8 lg:grid-cols-3">
          {items.map((it) => (
            <li
              key={it.n}
              className="liquid-card group relative flex flex-col justify-between overflow-hidden rounded-[18px] p-6 transition-transform duration-300 hover:-translate-y-0.5"
            >
              <span className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground">{it.n}</span>
              <div className="mt-8">
                <p className="text-[15px] font-semibold text-foreground">{it.t}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{it.d}</p>
              </div>
              <span
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.35),transparent_70%)] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
              />
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
    <section className="fit-aurora relative overflow-hidden border-b border-white/5">
      <div className="mx-auto max-w-[1200px] px-6 py-28 lg:px-10">
        <div className="liquid-surface relative overflow-hidden rounded-[28px] p-10 lg:p-14">
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.35),transparent_70%)] blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 right-[-120px] h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.28),transparent_70%)] blur-3xl"
          />
          <div className="relative grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-glow">FitGestor</p>
              <h2 className="mt-4 text-[36px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[48px] lg:text-[58px]">
                A operação da empresa funciona melhor <br />
                <span className="text-muted-foreground">quando o sistema entende o negócio.</span>
              </h2>
            </div>
            <div className="flex items-end lg:col-span-4">
              <div className="w-full">
                <Button
                  asChild
                  size="lg"
                  className="w-full rounded-full bg-primary text-primary-foreground shadow-[0_14px_36px_-8px_rgba(139,92,246,0.7)] hover:bg-primary-hover"
                >
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
      </div>
    </section>
  );
}

/* -------------------------------- Footer --------------------------------- */

function SiteFooter() {
  return (
    <footer className="fit-aurora relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-20 h-40 bg-[radial-gradient(60%_100%_at_50%_100%,rgba(139,92,246,0.20),transparent_70%)] blur-2xl"
      />
      <div className="mx-auto max-w-[1200px] px-6 py-12 lg:px-10">
        <div className="glass-medium flex flex-col items-start justify-between gap-6 rounded-[22px] px-6 py-6 sm:flex-row sm:items-center lg:px-8">
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
      </div>
    </footer>
  );
}

/* ----------------------------- Testimonials ----------------------------- */

function Testimonials() {
  const items = [
    {
      quote:
        "Reduzimos em 70% o tempo do recebimento de mercadoria. A conciliação virou parte natural do fluxo, não um retrabalho.",
      name: "Amanda Ribeiro",
      role: "Gerente de operações",
    },
    {
      quote:
        "O PDV com trocas e crédito por cliente resolveu a maior dor do balcão. Hoje qualquer vendedor fecha uma troca sem depender do supervisor.",
      name: "Rafael Nunes",
      role: "Supervisor de loja",
    },
    {
      quote:
        "Ter estoque, etiquetas e vendas na mesma plataforma acabou com as planilhas paralelas. A operação inteira olha para os mesmos números.",
      name: "Camila Duarte",
      role: "Diretora comercial",
    },
  ];
  return (
    <section id="depoimentos" className="fit-aurora relative overflow-hidden border-b border-white/5">
      <div className="mx-auto max-w-[1200px] px-6 py-24 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-glow">
            Quem opera com o FitGestor
          </p>
          <h2 className="mt-4 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[38px]">
            Times que trocaram planilhas por{" "}
            <span className="bg-gradient-to-r from-white via-white/75 to-white/40 bg-clip-text text-transparent">
              uma única fonte de verdade
            </span>
            .
          </h2>
        </div>
        <ul className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {items.map((t) => (
            <li
              key={t.name}
              className="liquid-card relative flex flex-col justify-between rounded-[20px] p-7"
            >
              <span
                aria-hidden
                className="absolute right-6 top-4 text-[80px] font-serif leading-none text-white/10 select-none"
              >
                &ldquo;
              </span>
              <p className="relative text-[14.5px] leading-relaxed text-foreground/90">
                {t.quote}
              </p>
              <div className="relative mt-8 flex items-center gap-3 border-t border-white/10 pt-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/25 text-[13px] font-semibold text-white">
                  {t.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-foreground">{t.name}</p>
                  <p className="text-[11px] text-muted-foreground">{t.role}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --------------------------------- FAQ ---------------------------------- */

function FaqSection() {
  const faqs = [
    {
      q: "O FitGestor substitui meu ERP atual?",
      a: "Sim, para lojas de varejo de moda e itens fitness ele cobre recebimento, estoque, etiquetas, PDV, trocas, entregas, funcionários e pós-venda em um único sistema, dispensando planilhas paralelas.",
    },
    {
      q: "Precisa instalar algo na loja?",
      a: "Não. É 100% web, rodando em qualquer navegador moderno. Balança, leitor de código de barras e impressora de etiquetas funcionam nativamente via USB/serial.",
    },
    {
      q: "Como funciona o controle de trocas e crédito da loja?",
      a: "Toda troca gera um vale ou crédito vinculado ao cliente. No PDV o crédito aparece automaticamente na hora do pagamento, com histórico completo e regras de expiração configuráveis.",
    },
    {
      q: "Consigo controlar entregas e motoboys?",
      a: "Sim. O módulo de expedição organiza fila, rotas e motoboys, com comprovantes digitais de entrega e rastreio por cliente.",
    },
    {
      q: "Meus dados ficam seguros?",
      a: "Sim. Todo acesso é autenticado, com perfis de permissão por cargo, trilha de auditoria e backups automáticos em ambiente corporativo.",
    },
  ];
  return (
    <section id="faq" className="fit-aurora relative overflow-hidden border-b border-white/5">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-14 px-6 py-24 lg:grid-cols-12 lg:gap-12 lg:px-10 lg:py-28">
        <div className="lg:col-span-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-glow">
            Perguntas frequentes
          </p>
          <h2 className="mt-4 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[38px]">
            Tudo o que a operação costuma perguntar,{" "}
            <span className="text-muted-foreground">antes de trocar de sistema.</span>
          </h2>
          <p className="mt-6 max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground">
            Se restar dúvida, fale com o time da Quero Ser Fit
            <sup className="text-[0.6em]">®</sup> — respondemos em horário comercial.
          </p>
        </div>
        <ul className="space-y-3 lg:col-span-7">
          {faqs.map((f, i) => (
            <li key={f.q} className="liquid-card group rounded-[18px] p-1">
              <details className="group/details rounded-[16px] p-5 open:pb-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
                  <span className="flex items-baseline gap-3">
                    <span className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[15px] font-semibold text-foreground">{f.q}</span>
                  </span>
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] text-foreground transition-transform duration-300 group-open/details:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-4 pl-10 text-[14px] leading-relaxed text-muted-foreground">
                  {f.a}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
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
      <div className="bg-background overflow-x-auto">{children}</div>
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
