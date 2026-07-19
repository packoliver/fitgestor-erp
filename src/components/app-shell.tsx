import { type ReactNode, useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  LogOut, Search, Bell, Settings, ChevronDown, Sparkles,
  Pin, PinOff, PanelLeftOpen, HelpCircle, User,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/use-permissions";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  NAV_ITEMS, itemsByGroup, filterByPermission, NAV_GROUPS, NAV_GROUP_META,
  ESSENTIAL_ITEM_IDS, type NavItem, type NavGroup,
} from "@/config/navigation";


const LS_ESSENTIAL = "fg:nav:essential";
const LS_PINNED = "fg:nav:pinned";

function loadEssentialDefault(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(LS_ESSENTIAL);
  return v === null ? true : v === "1";
}
function loadPinnedDefault(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(LS_PINNED);
  return v === null ? true : v === "1";
}

/* Hide "Minhas rotas" from admins/employees — it belongs to the courier
   workspace. We keep the backend RLS check untouched; this is UX-only. */
function applyCourierFilter(items: NavItem[], has: (c: string) => boolean) {
  return items.filter((i) => {
    if (!i.courierOnly) return true;
    return has("shipping.view_own") &&
      !has("shipping.view_all") &&
      !has("shipping.manage_couriers");
  });
}

/* --------------------------- Nav badges (pending) ------------------------- */

type BadgeMap = Record<string, number>;

function useNavBadges(hasAny: (...c: string[]) => boolean, isLoading: boolean): BadgeMap {
  const canPostSale = !isLoading && hasAny("post_sale.view", "post_sale.manage");
  const canInbound = !isLoading && hasAny("inventory.view", "inventory.manage");
  const canShipping = !isLoading && hasAny("shipping.view", "shipping.view_all", "shipping.dispatch");

  const posSale = useQuery({
    queryKey: ["nav-badge", "pos-venda"],
    enabled: canPostSale,
    staleTime: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("post_sale_tasks")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "scheduled"]);
      return count ?? 0;
    },
  });

  const inbound = useQuery({
    queryKey: ["nav-badge", "estoque-entrada"],
    enabled: canInbound,
    staleTime: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("goods_receipt_drafts")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft");
      return count ?? 0;
    },
  });

  const shipping = useQuery({
    queryKey: ["nav-badge", "expedicao"],
    enabled: canShipping,
    staleTime: 60_000,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { count } = await supabase
        .from("shipments")
        .select("id", { count: "exact", head: true })
        .lt("scheduled_date", today)
        .not("status", "in", "(delivered,cancelled,failed)");
      return count ?? 0;
    },
  });

  return {
    "pos-venda": posSale.data ?? 0,
    "estoque-entrada": inbound.data ?? 0,
    "expedicao": shipping.data ?? 0,
  };
}

/* -------------------------------- Sidebar -------------------------------- */

function AppSidebar({
  onOpenSearch, pinned, onTogglePin, onSignOut, userEmail,
}: {
  onOpenSearch: () => void;
  pinned: boolean;
  onTogglePin: () => void;
  onSignOut: () => void;
  userEmail: string;
}) {
  const { state, setOpenMobile, isMobile, setOpen } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");
  const { has, hasAny, isLoading } = usePermissions();
  const badges = useNavBadges(hasAny, isLoading);

  const [essential, setEssential] = useState<boolean>(() => loadEssentialDefault());
  const [expandedAll, setExpandedAll] = useState<boolean>(false);
  const [selectedGroup, setSelectedGroup] = useState<NavGroup>("Início");

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_ESSENTIAL, essential ? "1" : "0");
  }, [essential]);

  const permitted = isLoading
    ? NAV_ITEMS
    : applyCourierFilter(filterByPermission(NAV_ITEMS, has, hasAny), has);

  const visible = essential && !expandedAll
    ? permitted.filter((i) => ESSENTIAL_ITEM_IDS.has(i.id) || i.courierOnly)
    : permitted;

  const groups = itemsByGroup(visible);

  const activeGroup: NavGroup | null = useMemo(() => {
    const active = permitted.find((i) => isActive(i.url));
    return active?.group ?? null;
  }, [permitted, pathname]);

  // Sync selected group with the current active route.
  useEffect(() => {
    if (activeGroup) setSelectedGroup(activeGroup);
  }, [activeGroup]);

  // If sidebar is in "hidden" mode (not pinned) on desktop, close after nav.
  const handleNav = () => {
    if (isMobile) { setOpenMobile(false); return; }
    if (!pinned) setOpen(false);
  };

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "FG";

  const renderItem = (item: NavItem) => {
    const active = isActive(item.url);
    const badge = badges[item.id] ?? 0;
    return (
      <SidebarMenuItem key={item.id}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={item.description ? `${item.title} — ${item.description}` : item.title}
          className="h-9 rounded-lg text-[13.5px] font-medium text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:font-semibold transition-colors"
        >
          <Link to={item.url} onClick={handleNav} className="flex items-center gap-2.5">
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate flex-1">{item.title}</span>
            {!collapsed && badge > 0 && (
              <span
                aria-label={`${badge} pendente${badge === 1 ? "" : "s"}`}
                className="ml-auto shrink-0 rounded-full bg-primary/15 text-primary px-1.5 py-0 text-[10.5px] font-semibold leading-[16px] min-w-[18px] text-center"
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
            {collapsed && badge > 0 && (
              <span
                aria-hidden
                className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-primary"
              />
            )}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar
      collapsible={isMobile || pinned ? "icon" : "offcanvas"}
      className="border-r border-sidebar-border"
    >
      <SidebarHeader className="border-b border-sidebar-border h-16 justify-center">
        <div className="flex items-center gap-2 px-2">
          <BrandMark size={36} />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-[15px] font-semibold tracking-[-0.02em] text-sidebar-foreground">
                FitGestor
              </span>
              {!isMobile && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={onTogglePin}
                        aria-label={pinned ? "Ocultar barra automaticamente" : "Manter barra fixa"}
                        aria-pressed={pinned}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      {pinned ? "Manter barra fixa" : "Ocultar barra automaticamente"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </>
          )}
        </div>
      </SidebarHeader>

      {/* Search launcher */}
      <div className="px-2 pt-3">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Buscar no FitGestor"
          className={`flex w-full items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/30 px-2.5 text-[12.5px] text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors ${collapsed ? "h-9 justify-center" : "h-9"}`}
        >
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left truncate">Buscar no FitGestor</span>
              <kbd className="hidden md:inline-flex h-5 items-center rounded-md border border-sidebar-border bg-sidebar px-1.5 text-[10px] font-medium text-sidebar-foreground/60">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* Menu — layout Olist: rail de categorias + coluna de sub-itens */}
      <SidebarContent className="p-0 gap-0 overflow-hidden">
        {collapsed ? (
          /* Modo ícone: apenas rail de grupos */
          <div className="flex flex-col items-center gap-1 py-2">
            {NAV_GROUPS.map((g) => {
              const Meta = NAV_GROUP_META[g];
              const active = g === activeGroup;
              return (
                <TooltipProvider key={g} delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => { setSelectedGroup(g); setOpen(true); }}
                        aria-label={g}
                        className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                          active
                            ? "bg-primary/15 text-primary"
                            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                        }`}
                      >
                        <Meta.icon className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">{g}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-1">
            {/* Rail de grupos (coluna 1) */}
            <nav
              aria-label="Categorias"
              className="flex w-[92px] shrink-0 flex-col gap-0.5 border-r border-sidebar-border/70 bg-sidebar/60 px-1.5 py-2 overflow-y-auto"
            >
              {NAV_GROUPS.map((g) => {
                const Meta = NAV_GROUP_META[g];
                const isSel = selectedGroup === g;
                const isActive = activeGroup === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setSelectedGroup(g)}
                    aria-pressed={isSel}
                    className={`relative flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10.5px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      isSel
                        ? "bg-primary/12 text-primary"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    }`}
                  >
                    {isActive && (
                      <span aria-hidden className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-primary" />
                    )}
                    <Meta.icon className="h-[18px] w-[18px]" />
                    <span className="text-center break-words leading-[1.15]">{g}</span>
                  </button>
                );
              })}
            </nav>

            {/* Coluna de sub-itens (coluna 2) */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="px-3 pt-3 pb-2 border-b border-sidebar-border/60">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45">
                  {selectedGroup}
                </p>
                <p className="mt-0.5 text-[11px] text-sidebar-foreground/55 truncate">
                  {NAV_GROUP_META[selectedGroup].description}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto px-2 py-2">
                <SidebarMenu className="gap-0.5">
                  {(groups.find((g) => g.label === selectedGroup)?.items ?? []).map(renderItem)}
                  {(groups.find((g) => g.label === selectedGroup)?.items ?? []).length === 0 && (
                    <p className="px-2 py-6 text-center text-[11.5px] text-sidebar-foreground/50">
                      Nenhum módulo disponível nesta categoria.
                    </p>
                  )}
                </SidebarMenu>
              </div>

              {/* Modo essencial — footer da coluna de itens */}
              <div className="border-t border-sidebar-border/60 px-2 py-2">
                <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
                  <label htmlFor="essential-switch" className="text-[11.5px] font-medium text-sidebar-foreground flex-1 min-w-0 truncate cursor-pointer">
                    Modo essencial
                  </label>
                  <Switch
                    id="essential-switch"
                    checked={essential}
                    onCheckedChange={(v) => { setEssential(v); setExpandedAll(false); }}
                    aria-label="Alternar modo essencial"
                    className="scale-90"
                  />
                </div>
                {essential && (
                  <button
                    type="button"
                    onClick={() => setExpandedAll((v) => !v)}
                    className="mt-1 w-full text-left px-1.5 text-[10.5px] text-sidebar-foreground/60 hover:text-sidebar-foreground underline underline-offset-2 decoration-sidebar-foreground/25 hover:decoration-sidebar-foreground/60 transition-colors"
                  >
                    {expandedAll ? "Ocultar módulos avançados" : "Ver todos os módulos"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </SidebarContent>


      {/* Footer fixo — perfil, configurações, ajuda, sair */}
      <div className="mt-auto border-t border-sidebar-border p-2">
        {!collapsed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sidebar-foreground hover:bg-sidebar-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-primary/15 text-primary text-[11px] font-semibold">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium truncate leading-tight">{userEmail || "Usuário"}</p>
                  <p className="text-[10.5px] text-sidebar-foreground/55 truncate leading-tight">FitGestor</p>
                </div>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/45" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56 rounded-xl">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Conectado como</span>
                  <span className="text-sm font-medium truncate">{userEmail}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {has("profile.view") || true ? (
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes"><User className="mr-2 h-4 w-4" />Meu perfil</Link>
                </DropdownMenuItem>
              ) : null}
              {has("settings.view") && (
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes"><Settings className="mr-2 h-4 w-4" />Configurações</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <a href="https://queroserfit.com.br/ajuda" target="_blank" rel="noreferrer">
                  <HelpCircle className="mr-2 h-4 w-4" />Ajuda
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Menu do usuário"
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary/15 text-primary text-[11px] font-semibold">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56 rounded-xl">
              <DropdownMenuLabel className="font-normal">
                <span className="text-sm font-medium truncate block">{userEmail}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/configuracoes"><Settings className="mr-2 h-4 w-4" />Configurações</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="https://queroserfit.com.br/ajuda" target="_blank" rel="noreferrer">
                  <HelpCircle className="mr-2 h-4 w-4" />Ajuda
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </Sidebar>
  );
}

function NavSearchDialog({
  open, onOpenChange, items,
}: { open: boolean; onOpenChange: (v: boolean) => void; items: NavItem[] }) {
  const navigate = useNavigate();
  const grouped = useMemo(() => itemsByGroup(items), [items]);

  const go = (url: string) => {
    onOpenChange(false);
    navigate({ to: url });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar módulo ou ação…" />
      <CommandList>
        <CommandEmpty>Nenhum módulo encontrado.</CommandEmpty>
        {grouped.map((g) => (
          <CommandGroup key={g.label} heading={g.label}>
            {g.items.map((it) => (
              <CommandItem
                key={it.id}
                value={it.title}
                keywords={[...(it.keywords ?? []), it.description ?? "", it.group]}
                onSelect={() => go(it.url)}
              >
                <it.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-medium truncate">{it.title}</span>
                  {it.description && (
                    <span className="text-[11px] text-muted-foreground truncate">{it.description}</span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/* --------------------------- Floating reopen btn ------------------------- */

function FloatingReopen({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Abrir barra lateral"
      title="Abrir barra lateral (Ctrl/Cmd + B)"
      className="fixed left-2 top-1/2 z-30 -translate-y-1/2 hidden md:flex h-10 w-8 items-center justify-center rounded-r-xl border border-l-0 border-border bg-card/90 text-muted-foreground shadow-md backdrop-blur hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
    >
      <PanelLeftOpen className="h-4 w-4" />
    </button>
  );
}

/* -------------------------------- Shell ---------------------------------- */

export function AppShell({ children, userEmail }: { children: ReactNode; userEmail: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { has, hasAny, isLoading } = usePermissions();
  const [searchOpen, setSearchOpen] = useState(false);

  const isMobile = useIsMobile();
  const [pinned, setPinned] = useState<boolean>(() => loadPinnedDefault());
  // Controlled sidebar open state (desktop). Mobile uses its own drawer state.
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return loadPinnedDefault(); // starts closed when not pinned
  });

  // Persist pin preference and sync open state when it changes
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_PINNED, pinned ? "1" : "0");
    // When switching to pinned, ensure it is visible; when switching to hidden, close.
    setSidebarOpen(pinned);
  }, [pinned]);

  const togglePin = useCallback(() => setPinned((v) => !v), []);

  // ⌘K / Ctrl+K opens search. Ctrl+B toggles sidebar (also handled by shadcn).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const searchItems = useMemo(() => {
    const permitted = isLoading
      ? NAV_ITEMS
      : applyCourierFilter(filterByPermission(NAV_ITEMS, has, hasAny), has);
    return permitted;
  }, [isLoading, has, hasAny]);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("Você saiu");
    navigate({ to: "/auth", replace: true });
  }

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "FG";
  const showFloatingReopen = !isMobile && !pinned && !sidebarOpen;

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} style={{ ["--sidebar-width" as any]: "19rem" }}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar
          onOpenSearch={() => setSearchOpen(true)}
          pinned={pinned}
          onTogglePin={togglePin}
          onSignOut={handleSignOut}
          userEmail={userEmail}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center gap-3 px-4 sm:px-6 sticky top-0 z-20 bg-[#0D0D10] text-white border-b border-white/10">
            <SidebarTrigger className="h-9 w-9 rounded-lg text-white/80 hover:bg-white/10 hover:text-white" />
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex relative flex-1 max-w-md h-10 items-center rounded-xl border border-white/10 bg-white/5 pl-9 pr-14 text-left text-sm text-white/60 hover:bg-white/10 hover:text-white/80 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/20 transition-all"
              aria-label="Buscar no FitGestor"
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
              <span>Buscar no FitGestor</span>
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden lg:inline-flex h-6 items-center rounded-md border border-white/10 bg-white/5 px-1.5 text-[10.5px] font-medium text-white/60">⌘K</kbd>
            </button>
            <div className="flex-1 md:hidden" />
            <Button variant="ghost" size="icon" aria-label="Buscar" onClick={() => setSearchOpen(true)} className="md:hidden text-white/80 hover:bg-white/10 hover:text-white">
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Notificações" className="relative text-white/80 hover:bg-white/10 hover:text-white">
              <Bell className="h-4 w-4" />
              <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-primary-glow" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 gap-2 pl-1.5 pr-3 rounded-xl">
                  <Avatar className="h-7 w-7"><AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials}</AvatarFallback></Avatar>
                  <span className="hidden sm:inline text-sm font-medium max-w-[160px] truncate">{userEmail}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Conectado como</span>
                    <span className="text-sm font-medium truncate">{userEmail}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes"><Settings className="mr-2 h-4 w-4" />Configurações</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="https://queroserfit.com.br/ajuda" target="_blank" rel="noreferrer">
                    <HelpCircle className="mr-2 h-4 w-4" />Ajuda
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0">
            <div className="mx-auto w-full max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
      {showFloatingReopen && <FloatingReopen onOpen={() => setSidebarOpen(true)} />}
      <NavSearchDialog open={searchOpen} onOpenChange={setSearchOpen} items={searchItems} />
    </SidebarProvider>
  );
}
