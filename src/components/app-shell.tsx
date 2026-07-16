import { type ReactNode } from "react";
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
  LayoutDashboard, Package, Boxes, ArrowDownToLine, ClipboardList, Tag,
  Users, ShieldCheck, Truck, FolderTree, Sparkles, Settings, ScrollText, LogOut,
  ShoppingCart, Wallet, Receipt, UserSquare2, RefreshCw, Ticket, PiggyBank, FileBarChart,
  Search, Bell,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/use-permissions";


type NavItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }>; perm?: string | string[] };

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "Vendas",
    items: [
      { title: "PDV", url: "/pdv", icon: ShoppingCart, perm: "pos.view" },
      { title: "Caixa", url: "/caixa", icon: Wallet, perm: ["pos.open_cash", "pos.close_cash", "pos.view"] },
      { title: "Vendas", url: "/vendas", icon: Receipt },
      { title: "Trocas", url: "/trocas", icon: RefreshCw, perm: "exchanges.view" },
      { title: "Vales-troca", url: "/trocas/vales", icon: Ticket, perm: "vouchers.view" },
      { title: "Créditos", url: "/trocas/creditos", icon: PiggyBank, perm: "credits.view" },
      { title: "Clientes", url: "/clientes", icon: UserSquare2 },
    ],
  },
  {
    label: "Operação",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Produtos", url: "/produtos", icon: Package, perm: "product.view" },
      { title: "Estoque", url: "/estoque", icon: Boxes, perm: "stock.view" },
      { title: "Entrada rápida de estoque", url: "/estoque/entrada", icon: ArrowDownToLine, perm: "goods_receipt.create" },
      { title: "Receber mercadoria", url: "/estoque/recebimentos", icon: ArrowDownToLine, perm: "goods_receipt.create" },
      { title: "Inventário", url: "/estoque/inventario", icon: ClipboardList, perm: "inventory.manage" },
      { title: "Etiquetas", url: "/etiquetas", icon: Tag, perm: "label.print" },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { title: "Fornecedores", url: "/fornecedores", icon: Truck, perm: "supplier.manage" },
      { title: "Categorias", url: "/categorias", icon: FolderTree, perm: "category.manage" },
      { title: "Marcas", url: "/marcas", icon: Sparkles, perm: "brand.manage" },
    ],
  },
  {
    label: "Relatórios",
    items: [
      { title: "Relatório de trocas", url: "/relatorios/trocas", icon: FileBarChart, perm: "reports.exchanges.view" },
    ],
  },

  {
    label: "Administração",
    items: [
      { title: "Funcionários", url: "/funcionarios", icon: Users, perm: "user.manage" },
      { title: "Cargos e permissões", url: "/cargos", icon: ShieldCheck, perm: "role.manage" },
      { title: "Auditoria", url: "/auditoria", icon: ScrollText, perm: "audit.view" },
      { title: "Configurações", url: "/configuracoes", icon: Settings },
    ],
  },
];



function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");
  const { has, hasAny, isLoading } = usePermissions();

  const canSee = (item: NavItem) => {
    if (!item.perm) return true;
    if (Array.isArray(item.perm)) return hasAny(...item.perm);
    return has(item.perm);
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
      <SidebarContent className="px-2 py-3 gap-1">
        {groups.map((g) => {
          const items = isLoading ? g.items : g.items.filter(canSee);
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={g.label} className="py-1">
              <SidebarGroupLabel className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/45 px-2">
                {g.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {items.map((item) => {
                    const active = isActive(item.url);
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.title}
                          className="h-9 rounded-lg text-[13.5px] font-medium text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-semibold data-[active=true]:shadow-[inset_2px_0_0_0_var(--sidebar-primary)] transition-colors"
                        >
                          <Link to={item.url} className="flex items-center gap-2.5">
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}


export function AppShell({ children, userEmail }: { children: ReactNode; userEmail: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center gap-3 border-b border-border bg-background/80 px-4 sm:px-6 sticky top-0 z-20 backdrop-blur-md">
            <SidebarTrigger className="h-9 w-9 rounded-lg hover:bg-muted" />
            <div className="hidden md:flex relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                placeholder="Buscar produtos, clientes, vendas…"
                className="w-full h-10 rounded-xl border border-border bg-muted/40 pl-9 pr-14 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary focus:bg-card focus:ring-4 focus:ring-primary/10 transition-all"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden lg:inline-flex h-6 items-center rounded-md border border-border bg-card px-1.5 text-[10.5px] font-medium text-muted-foreground">⌘K</kbd>
            </div>
            <div className="flex-1 md:hidden" />
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
    </SidebarProvider>
  );
}
