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
  Pin, PinOff, PanelLeftOpen, HelpCircle, User, ShoppingCart, Wallet, Lock,
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

function money(v: number): string {
  return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

  const permitted = useMemo(() => {
    if (isLoading || !has || !hasAny) return NAV_ITEMS;
    try {
      return applyCourierFilter(filterByPermission(NAV_ITEMS, has, hasAny), has);
    } catch {
      return NAV_ITEMS;
    }
  }, [isLoading, has, hasAny]);

  const visible = essential && !expandedAll
    ? (permitted || []).filter((i) => i && (ESSENTIAL_ITEM_IDS.has(i.id) || i.courierOnly))
    : (permitted || []);

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
          className={`h-10 rounded-xl text-xs transition-colors px-3 ${
            active
              ? "bg-indigo-600 text-white font-semibold shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 font-medium"
          }`}
        >
          <Link to={item.url} onClick={handleNav} className="flex items-center gap-2.5">
            <item.icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : "text-slate-400"}`} />
            <span className="truncate flex-1">{item.title}</span>
            {!collapsed && badge > 0 && (
              <span
                aria-label={`${badge} pendente${badge === 1 ? "" : "s"}`}
                className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold min-w-[18px] text-center ${
                  active ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700"
                }`}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
            {collapsed && badge > 0 && (
              <span
                aria-hidden
                className={`absolute right-1.5 top-1 h-2 w-2 rounded-full ${active ? "bg-white" : "bg-indigo-600"}`}
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
      className="border-r border-slate-200 bg-white text-slate-800 font-sans shadow-sm"
    >
      <SidebarHeader className="border-b border-slate-200/80 h-16 justify-center bg-white px-3">
        <div className="flex items-center gap-2 overflow-hidden w-full">
          <BrandMark size={28} className="h-7 w-auto shrink-0 object-contain" />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-base font-extrabold tracking-tight text-slate-900 leading-none">
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
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
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
      <div className="px-3 pt-3 pb-1 bg-white">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Buscar no FitGestor"
          className={`flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors ${collapsed ? "h-9 justify-center" : "h-9.5"}`}
        >
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left truncate">Buscar no FitGestor</span>
              <kbd className="hidden md:inline-flex h-5 items-center rounded-md border border-slate-200 bg-white px-1.5 text-[10px] font-mono font-bold text-slate-500">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* Menu — layout Olist: rail de categorias + coluna de sub-itens */}
      <SidebarContent className="p-0 gap-0 overflow-hidden bg-white">
        {collapsed ? (
          /* Modo ícone: apenas rail de grupos */
          <div className="flex flex-col items-center gap-1.5 py-3 bg-white">
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
                        className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                          active
                            ? "bg-indigo-600 text-white font-bold shadow-sm"
                            : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
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
          <div className="flex h-full min-h-0 flex-1 bg-white">
            {/* Rail de grupos (coluna 1) */}
            <nav
              aria-label="Categorias"
              className="flex w-[96px] shrink-0 flex-col gap-1 border-r border-slate-200/80 bg-slate-50/60 px-2 py-3 overflow-y-auto"
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
                    className={`relative flex flex-col items-center gap-1.5 rounded-xl px-1.5 py-2.5 text-[11px] font-semibold leading-tight transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
                      isSel
                        ? "bg-indigo-50 text-indigo-700 border border-indigo-200/80 font-bold shadow-2xs"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                    }`}
                  >
                    {isActive && (
                      <span aria-hidden className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-indigo-600" />
                    )}
                    <Meta.icon className={`h-[18px] w-[18px] ${isSel ? "text-indigo-600" : "text-slate-400"}`} />
                    <span className="text-center break-words leading-[1.15]">{g}</span>
                  </button>
                );
              })}
            </nav>

            {/* Coluna de sub-itens (coluna 2) */}
            <div className="flex min-w-0 flex-1 flex-col bg-white">
              <div className="px-3 pt-3.5 pb-2.5 border-b border-slate-100">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  {selectedGroup}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 font-medium truncate">
                  {NAV_GROUP_META[selectedGroup].description}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto px-2 py-2">
                <SidebarMenu className="gap-1">
                  {(groups.find((g) => g.label === selectedGroup)?.items ?? []).map(renderItem)}
                  {(groups.find((g) => g.label === selectedGroup)?.items ?? []).length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-slate-400 font-medium">
                      Nenhum módulo disponível nesta categoria.
                    </p>
                  )}
                </SidebarMenu>
              </div>

              {/* Modo essencial — footer da coluna de itens */}
              <div className="border-t border-slate-100 px-3 py-2 bg-slate-50/40">
                <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
                  <label htmlFor="essential-switch" className="text-xs font-bold text-slate-700 flex-1 min-w-0 truncate cursor-pointer">
                    Modo essencial
                  </label>
                  <Switch
                    id="essential-switch"
                    checked={essential}
                    onCheckedChange={(v) => { setEssential(v); setExpandedAll(false); }}
                    aria-label="Alternar modo essencial"
                    className="scale-85"
                  />
                </div>
                {essential && (
                  <button
                    type="button"
                    onClick={() => setExpandedAll((v) => !v)}
                    className="mt-1 w-full text-left px-1.5 text-[10.5px] font-semibold text-slate-500 hover:text-slate-800 underline underline-offset-2 decoration-slate-300 hover:decoration-slate-600 transition-colors"
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
      <div className="mt-auto border-t border-slate-200 p-2.5 bg-white">
        {!collapsed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-700 hover:bg-slate-50 border border-slate-200/80 shadow-2xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
              >
                <Avatar className="h-7.5 w-7.5 shrink-0">
                  <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs font-extrabold">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 truncate leading-tight">{userEmail || "Operador"}</p>
                  <p className="text-xs text-slate-400 font-normal truncate leading-tight">FitGestor ERP</p>
                </div>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56 rounded-xl border border-slate-200 shadow-md bg-white">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Operador Conectado</span>
                  <span className="text-xs font-bold text-slate-900 truncate">{userEmail}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {has("profile.view") || true ? (
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes"><User className="mr-2 h-4 w-4 text-slate-500" />Meu perfil</Link>
                </DropdownMenuItem>
              ) : null}
              {has("settings.view") && (
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes"><Settings className="mr-2 h-4 w-4 text-slate-500" />Configurações</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <a href="https://queroserfit.com.br/ajuda" target="_blank" rel="noreferrer">
                  <HelpCircle className="mr-2 h-4 w-4 text-slate-500" />Ajuda
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut} className="text-rose-600 font-bold focus:text-rose-700 focus:bg-rose-50">
                <LogOut className="mr-2 h-4 w-4" />Sair da Sessão
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Menu do usuário"
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs font-extrabold">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56 rounded-xl border border-slate-200 shadow-md bg-white">
              <DropdownMenuLabel className="font-normal">
                <span className="text-xs font-bold text-slate-900 truncate block">{userEmail}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/configuracoes"><Settings className="mr-2 h-4 w-4 text-slate-500" />Configurações</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="https://queroserfit.com.br/ajuda" target="_blank" rel="noreferrer">
                  <HelpCircle className="mr-2 h-4 w-4 text-slate-500" />Ajuda
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut} className="text-rose-600 font-bold focus:text-rose-700 focus:bg-rose-50">
                <LogOut className="mr-2 h-4 w-4" />Sair da Sessão
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

  const initials = userEmail && typeof userEmail === "string" ? userEmail.slice(0, 2).toUpperCase() : "FG";
  const showFloatingReopen = !isMobile && !pinned && !sidebarOpen;

  // State for cash shift status (sync from localStorage) with fallback safety
  const [cashShiftStatus, setCashShiftStatus] = useState<"open" | "closed">("open");
  const [cashShiftInitial, setCashShiftInitial] = useState<number>(100);

  useEffect(() => {
    const updateCashShift = () => {
      try {
        if (typeof window !== "undefined") {
          const saved = localStorage.getItem("pdv_current_shift");
          if (saved) {
            const parsed = JSON.parse(saved);
            setCashShiftStatus(parsed?.status === "closed" ? "closed" : "open");
            setCashShiftInitial(typeof parsed?.initialValue === "number" ? parsed.initialValue : 100);
          }
        }
      } catch {}
    };

    updateCashShift();
    const interval = setInterval(updateCashShift, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} style={{ ["--sidebar-width" as any]: "19rem" }}>
      <div className="min-h-screen flex w-full bg-slate-100 text-slate-800 font-sans">
        <AppSidebar
          onOpenSearch={() => setSearchOpen(true)}
          pinned={pinned}
          onTogglePin={togglePin}
          onSignOut={handleSignOut}
          userEmail={userEmail}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center gap-3 px-4 sm:px-6 sticky top-0 z-20 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-b border-slate-200/80 dark:border-zinc-800 shadow-xs">
            <SidebarTrigger className="h-9 w-9 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-800" />

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex relative flex-1 max-w-md h-10 items-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/50 pl-9 pr-14 text-left text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all shadow-2xs"
              aria-label="Buscar no FitGestor"
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <span>Buscar no FitGestor (módulos, clientes, produtos)…</span>
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden lg:inline-flex h-6 items-center rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300">Ctrl+K</kbd>
            </button>

            <div className="flex-1 md:hidden" />

            {/* Quick Cash Status Badge */}
            <button
              type="button"
              onClick={() => navigate({ to: "/vendas/pdv" })}
              title="Ir para a Frente de Caixa (PDV)"
              className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition shadow-2xs ${
                cashShiftStatus === "open"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300"
                  : "bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${cashShiftStatus === "open" ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
              <span>{cashShiftStatus === "open" ? "Caixa Aberto" : "Caixa Fechado"}</span>
              {cashShiftStatus === "open" && (
                <span className="font-mono text-[11px] opacity-75 font-semibold">({money(cashShiftInitial)})</span>
              )}
            </button>

            {/* Direct PDV Action Button */}
            <Button
              onClick={() => navigate({ to: "/vendas/pdv" })}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs gap-1.5"
            >
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">PDV Balcão</span>
            </Button>

            <Button variant="ghost" size="icon" aria-label="Buscar" onClick={() => setSearchOpen(true)} className="md:hidden text-slate-600">
              <Search className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" aria-label="Notificações" className="relative text-slate-600 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl">
              <Bell className="h-4 w-4" />
              <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-indigo-600" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 gap-2 pl-1.5 pr-3 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800">
                  <Avatar className="h-7 w-7"><AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs font-bold">{initials}</AvatarFallback></Avatar>
                  <span className="hidden sm:inline text-xs font-bold max-w-[140px] truncate">{userEmail}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-muted-foreground font-medium">Operador Conectado</span>
                    <span className="text-xs font-bold truncate">{userEmail}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes"><Settings className="mr-2 h-4 w-4" />Configurações do ERP</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/vendas/pdv"><ShoppingCart className="mr-2 h-4 w-4 text-emerald-600" />Ir para Frente de Caixa</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />Sair da Sessão
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
