import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/use-permissions";
import {
  NAV_ITEMS, itemsByGroup, filterByPermission,
  ESSENTIAL_ITEM_IDS, type NavItem, type NavGroup,
} from "@/config/navigation";


const LS_GROUPS = "fg:nav:groups-open";
const LS_ESSENTIAL = "fg:nav:essential";

function loadOpenGroups(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(LS_GROUPS) || "{}"); }
  catch { return {}; }
}
function loadEssentialDefault(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(LS_ESSENTIAL);
  return v === null ? true : v === "1";
}

/* Hide "Minhas rotas" from admins/employees — it belongs to the courier
   workspace. We keep the backend RLS check untouched; this is UX-only. */
function applyCourierFilter(items: NavItem[], has: (c: string) => boolean) {
  return items.filter((i) => {
    if (!i.courierOnly) return true;
    // Show only for users that look like couriers: they have view_own but
    // not the broad admin/dispatcher shipping perms.
    return has("shipping.view_own") &&
      !has("shipping.view_all") &&
      !has("shipping.manage_couriers");
  });
}

function AppSidebar({
  onOpenSearch,
}: { onOpenSearch: () => void }) {
  const { state, setOpenMobile, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");
  const { has, hasAny, isLoading } = usePermissions();

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => loadOpenGroups());
  const [essential, setEssential] = useState<boolean>(() => loadEssentialDefault());
  const [expandedAll, setExpandedAll] = useState<boolean>(false);

  // persist
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_GROUPS, JSON.stringify(openGroups));
  }, [openGroups]);
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

  // active group opens automatically; Início stays open by default
  const activeGroup: NavGroup | null = useMemo(() => {
    const active = permitted.find((i) => isActive(i.url));
    return active?.group ?? null;
  }, [permitted, pathname]);

  const isGroupOpen = (g: string) => {
    if (openGroups[g] !== undefined) return openGroups[g];
    if (g === "Início") return true;
    if (g === activeGroup) return true;
    return false;
  };
  const toggleGroup = (g: string) =>
    setOpenGroups((prev) => ({ ...prev, [g]: !isGroupOpen(g) }));

  const handleNav = () => { if (isMobile) setOpenMobile(false); };

  const renderItem = (item: NavItem) => {
    const active = isActive(item.url);
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
            <span className="truncate">{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border h-16 justify-center">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
            <span className="text-[15px] font-semibold leading-none tracking-[-0.03em]">F</span>
          </div>
          {!collapsed && (
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-sidebar-foreground truncate">
              FitGestor
            </span>
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

      <SidebarContent className="px-2 py-2 gap-0.5">
        {groups.map((g) => {
          const open = isGroupOpen(g.label);
          return (
            <SidebarGroup key={g.label} className="py-0.5">
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(g.label)}
                  aria-expanded={open}
                  className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45 hover:text-sidebar-foreground/80 transition-colors"
                >
                  <span>{g.label}</span>
                  <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
                </button>
              ) : (
                <SidebarGroupLabel className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/45 px-2 sr-only">
                  {g.label}
                </SidebarGroupLabel>
              )}
              {(open || collapsed) && (
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {g.items.map(renderItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          );
        })}

        {/* Essential toggle & expand-all */}
        {!collapsed && (
          <div className="mt-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-sidebar-foreground truncate">Menu essencial</p>
                  <p className="text-[10.5px] text-sidebar-foreground/55 truncate">Mostrar apenas o básico</p>
                </div>
              </div>
              <Switch
                checked={essential}
                onCheckedChange={(v) => { setEssential(v); setExpandedAll(false); }}
                aria-label="Alternar menu essencial"
              />
            </div>
            {essential && !expandedAll && (
              <button
                type="button"
                onClick={() => setExpandedAll(true)}
                className="mt-2 w-full rounded-md border border-sidebar-border/60 px-2 py-1.5 text-[11.5px] font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors"
              >
                Ver todos os módulos
              </button>
            )}
          </div>
        )}
      </SidebarContent>

      {!collapsed && (
        <div className="mt-auto border-t border-sidebar-border px-4 py-4">
          <p className="text-[10.5px] font-medium text-sidebar-foreground/50">Desenvolvido pela</p>
          <p className="text-[11px] font-semibold tracking-[-0.01em] text-sidebar-foreground/80">
            Quero Ser Fit<sup className="text-[0.6em]">®</sup>
          </p>
        </div>
      )}
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
      <Command
        filter={(value, search, keywords) => {
          const hay = `${value} ${(keywords ?? []).join(" ")}`.toLowerCase();
          const needle = search.toLowerCase().trim();
          if (!needle) return 1;
          return hay.includes(needle) ? 1 : 0;
        }}
      >
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
      </Command>
    </CommandDialog>
  );
}

export function AppShell({ children, userEmail }: { children: ReactNode; userEmail: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { has, hasAny, isLoading } = usePermissions();
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K / Ctrl+K opens search
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

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar onOpenSearch={() => setSearchOpen(true)} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="glass-soft h-16 flex items-center gap-3 border-0 border-b border-border/60 px-4 sm:px-6 sticky top-0 z-20 rounded-none">
            <SidebarTrigger className="h-9 w-9 rounded-lg hover:bg-muted" />
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden md:flex relative flex-1 max-w-md h-10 items-center rounded-xl border border-border bg-muted/40 pl-9 pr-14 text-left text-sm text-muted-foreground/80 hover:bg-card focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
              aria-label="Buscar no FitGestor"
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <span>Buscar no FitGestor</span>
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden lg:inline-flex h-6 items-center rounded-md border border-border bg-card px-1.5 text-[10.5px] font-medium text-muted-foreground">⌘K</kbd>
            </button>
            <div className="flex-1 md:hidden" />
            <Button variant="ghost" size="icon" aria-label="Buscar" onClick={() => setSearchOpen(true)} className="md:hidden">
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Notificações" className="relative">
              <Bell className="h-4 w-4" />
              <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-primary" />
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
      <NavSearchDialog open={searchOpen} onOpenChange={setSearchOpen} items={searchItems} />
    </SidebarProvider>
  );
}

// Keep NAV_GROUPS export referenced to avoid unused import warning in strict mode.
