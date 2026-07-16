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
import { LogOut, Search, Bell } from "lucide-react";
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
import { NAV_ITEMS, itemsByGroup, filterByPermission, type NavItem } from "@/config/navigation";


function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");
  const { has, hasAny, isLoading } = usePermissions();

  const visible = isLoading ? NAV_ITEMS : filterByPermission(NAV_ITEMS, has, hasAny);
  const groups = itemsByGroup(visible);
  const renderItem = (item: NavItem) => {
    const active = isActive(item.url);
    return (
      <SidebarMenuItem key={item.id}>
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
