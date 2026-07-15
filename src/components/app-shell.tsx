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
  ShoppingCart, Wallet, Receipt, UserSquare2, RefreshCw, Ticket, PiggyBank,
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

type NavItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }> };

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "Vendas",
    items: [
      { title: "PDV", url: "/pdv", icon: ShoppingCart },
      { title: "Caixa", url: "/caixa", icon: Wallet },
      { title: "Vendas", url: "/vendas", icon: Receipt },
      { title: "Trocas", url: "/trocas", icon: RefreshCw },
      { title: "Vales-troca", url: "/trocas/vales", icon: Ticket },
      { title: "Créditos", url: "/trocas/creditos", icon: PiggyBank },
      { title: "Clientes", url: "/clientes", icon: UserSquare2 },
    ],
  },
  {
    label: "Operação",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Produtos", url: "/produtos", icon: Package },
      { title: "Estoque", url: "/estoque", icon: Boxes },
      { title: "Entrada de mercadorias", url: "/estoque/entrada", icon: ArrowDownToLine },
      { title: "Inventário", url: "/estoque/inventario", icon: ClipboardList },
      { title: "Etiquetas", url: "/etiquetas", icon: Tag },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { title: "Fornecedores", url: "/fornecedores", icon: Truck },
      { title: "Categorias", url: "/categorias", icon: FolderTree },
      { title: "Marcas", url: "/marcas", icon: Sparkles },
    ],
  },
  {
    label: "Administração",
    items: [
      { title: "Funcionários", url: "/funcionarios", icon: Users },
      { title: "Cargos e permissões", url: "/cargos", icon: ShieldCheck },
      { title: "Auditoria", url: "/auditoria", icon: ScrollText },
      { title: "Configurações", url: "/configuracoes", icon: Settings },
    ],
  },
];


function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="font-display text-lg font-semibold">F</span>
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-display text-base font-semibold">FitGestor</span>
              <span className="text-xs text-muted-foreground">ERP</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
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
          <header className="h-14 flex items-center gap-2 border-b bg-card/50 px-4 sticky top-0 z-10 backdrop-blur">
            <SidebarTrigger />
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 gap-2 pl-2 pr-3">
                  <Avatar className="h-7 w-7"><AvatarFallback>{initials}</AvatarFallback></Avatar>
                  <span className="hidden sm:inline text-sm">{userEmail}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Minha conta</DropdownMenuLabel>
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
          <main className="flex-1 p-4 sm:p-6 min-w-0">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
