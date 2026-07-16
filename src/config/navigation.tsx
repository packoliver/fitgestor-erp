import {
  LayoutDashboard, Package, Boxes, ArrowDownToLine, ClipboardList, Tag,
  Users, ShieldCheck, Truck, FolderTree, Sparkles, Settings, ScrollText,
  ShoppingCart, Wallet, Receipt, UserSquare2, RefreshCw, Ticket, PiggyBank, FileBarChart,
  MapPin, AlertTriangle, Rocket,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * Central navigation / workspace configuration.
 *
 * A single item can drive:
 *   - the sidebar (group + priority + visibility)
 *   - the /trabalho shortcuts (workspaces + priority)
 *   - future breadcrumbs / mobile nav
 *
 * Rules:
 *   - `perm` is UX gating only. Backend RPC/RLS remain the source of truth.
 *   - `workspaces` decides where the item shows up as a shortcut. If empty,
 *     the item never appears in /trabalho.
 *   - When `perm` is an array, the visitor needs ANY of the codes.
 */
export type Workspace = "admin" | "employee" | "courier";

export type NavGroup =
  | "Vendas" | "Operação" | "Cadastros" | "Expedição"
  | "Relatórios" | "Administração";

export type NavItem = {
  id: string;
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  perm?: string | string[];
  group: NavGroup;
  workspaces?: Workspace[];
  priority?: number;
  description?: string;
  mobile?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  // ── Vendas ────────────────────────────────────────────────
  { id: "pdv", title: "PDV", url: "/pdv", icon: ShoppingCart, perm: "pos.view",
    group: "Vendas", workspaces: ["employee","admin"], priority: 100, mobile: true,
    description: "Registrar uma nova venda" },
  { id: "caixa", title: "Caixa", url: "/caixa", icon: Wallet,
    perm: ["pos.open_cash","pos.close_cash","pos.view"],
    group: "Vendas", workspaces: ["employee","admin"], priority: 90,
    description: "Abrir e fechar caixa" },
  { id: "vendas", title: "Vendas", url: "/vendas", icon: Receipt,
    group: "Vendas", workspaces: ["employee","admin"], priority: 70 },
  { id: "trocas", title: "Trocas", url: "/trocas", icon: RefreshCw, perm: "exchanges.view",
    group: "Vendas", workspaces: ["employee","admin"], priority: 60 },
  { id: "vales", title: "Vales-troca", url: "/trocas/vales", icon: Ticket, perm: "vouchers.view",
    group: "Vendas", workspaces: ["admin"], priority: 50 },
  { id: "creditos", title: "Créditos", url: "/trocas/creditos", icon: PiggyBank, perm: "credits.view",
    group: "Vendas", workspaces: ["admin"], priority: 40 },
  { id: "clientes", title: "Clientes", url: "/clientes", icon: UserSquare2,
    group: "Vendas", workspaces: ["employee","admin"], priority: 30 },

  // ── Operação ──────────────────────────────────────────────
  { id: "dashboard", title: "Dashboard", url: "/dashboard", icon: LayoutDashboard,
    group: "Operação", workspaces: ["admin"], priority: 100, mobile: true },
  { id: "produtos", title: "Produtos", url: "/produtos", icon: Package, perm: "product.view",
    group: "Operação", workspaces: ["employee","admin"], priority: 80 },
  { id: "estoque", title: "Estoque", url: "/estoque", icon: Boxes, perm: "stock.view",
    group: "Operação", workspaces: ["employee","admin"], priority: 70 },
  { id: "estoque-entrada", title: "Entrada rápida", url: "/estoque/entrada", icon: ArrowDownToLine,
    perm: "goods_receipt.create", group: "Operação", workspaces: ["employee","admin"], priority: 60 },
  { id: "recebimentos", title: "Receber mercadoria", url: "/estoque/recebimentos", icon: ArrowDownToLine,
    perm: "goods_receipt.create", group: "Operação", workspaces: ["employee","admin"], priority: 55 },
  { id: "inventario", title: "Inventário", url: "/estoque/inventario", icon: ClipboardList,
    perm: "inventory.manage", group: "Operação", workspaces: ["admin"], priority: 40 },
  { id: "etiquetas", title: "Etiquetas", url: "/etiquetas", icon: Tag, perm: "label.print",
    group: "Operação", workspaces: ["employee","admin"], priority: 30 },

  // ── Cadastros ─────────────────────────────────────────────
  { id: "fornecedores", title: "Fornecedores", url: "/fornecedores", icon: Truck, perm: "supplier.manage",
    group: "Cadastros", workspaces: ["admin"] },
  { id: "categorias", title: "Categorias", url: "/categorias", icon: FolderTree, perm: "category.manage",
    group: "Cadastros", workspaces: ["admin"] },
  { id: "marcas", title: "Marcas", url: "/marcas", icon: Sparkles, perm: "brand.manage",
    group: "Cadastros", workspaces: ["admin"] },

  // ── Expedição ─────────────────────────────────────────────
  { id: "expedicao", title: "Painel Expedição", url: "/expedicao", icon: LayoutDashboard,
    perm: ["shipping.view","shipping.view_all","shipping.dispatch","shipping.pick"],
    group: "Expedição", workspaces: ["employee","admin"], priority: 100 },
  { id: "expedicao-fila", title: "Fila", url: "/expedicao/fila", icon: ClipboardList,
    perm: ["shipping.view","shipping.view_all","shipping.pick","shipping.dispatch","shipping.deliver"],
    group: "Expedição", workspaces: ["employee","admin"], priority: 90 },
  { id: "expedicao-rotas", title: "Rotas", url: "/expedicao/rotas", icon: MapPin,
    perm: ["shipping.view","shipping.view_all","shipping.dispatch"],
    group: "Expedição", workspaces: ["employee","admin"], priority: 80 },
  { id: "expedicao-pendencias", title: "Vendas sem entrega", url: "/expedicao/pendencias", icon: AlertTriangle,
    perm: ["shipping.view","shipping.view_all","shipping.create"],
    group: "Expedição", workspaces: ["employee","admin"], priority: 70 },
  { id: "motoboys", title: "Motoboys", url: "/expedicao/motoboys", icon: Truck,
    perm: "shipping.manage_couriers",
    group: "Expedição", workspaces: ["admin"], priority: 60 },
  { id: "motoboy-app", title: "Minhas rotas", url: "/motoboy", icon: Truck,
    perm: ["shipping.view_own","shipping.deliver"],
    group: "Expedição", workspaces: ["courier"], priority: 100, mobile: true,
    description: "Suas entregas do dia" },

  // ── Relatórios ────────────────────────────────────────────
  { id: "rel-trocas", title: "Relatório de trocas", url: "/relatorios/trocas", icon: FileBarChart,
    perm: "reports.exchanges.view", group: "Relatórios", workspaces: ["admin"] },

  // ── Administração ─────────────────────────────────────────
  { id: "setup", title: "Configuração inicial", url: "/configuracao-inicial", icon: Rocket,
    perm: "user.manage", group: "Administração", workspaces: ["admin"], priority: 110 },
  { id: "funcionarios", title: "Funcionários", url: "/funcionarios", icon: Users, perm: "user.manage",
    group: "Administração", workspaces: ["admin"], priority: 90 },
  { id: "cargos", title: "Cargos e permissões", url: "/cargos", icon: ShieldCheck, perm: "role.manage",
    group: "Administração", workspaces: ["admin"], priority: 80 },
  { id: "auditoria", title: "Auditoria", url: "/auditoria", icon: ScrollText, perm: "audit.view",
    group: "Administração", workspaces: ["admin"], priority: 70 },
  { id: "config", title: "Configurações", url: "/configuracoes", icon: Settings,
    group: "Administração", workspaces: ["admin"], priority: 60 },
];

export const NAV_GROUPS: NavGroup[] = [
  "Vendas","Operação","Cadastros","Expedição","Relatórios","Administração",
];

export function itemsByGroup(items: NavItem[]) {
  return NAV_GROUPS
    .map((g) => ({ label: g, items: items.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);
}

export function filterByPermission(
  items: NavItem[],
  hasPerm: (code: string) => boolean,
  hasAnyPerm: (...codes: string[]) => boolean,
) {
  return items.filter((i) => {
    if (!i.perm) return true;
    return Array.isArray(i.perm) ? hasAnyPerm(...i.perm) : hasPerm(i.perm);
  });
}

export function itemsForWorkspace(items: NavItem[], workspace: Workspace | null) {
  if (!workspace) return [];
  return items
    .filter((i) => i.workspaces?.includes(workspace))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

// Permission group taxonomy for the /cargos UI. Codes not listed here
// fall back to their own module label (see permissionGroupOf).
export const PERMISSION_GROUPS: { id: string; label: string; codes: string[] }[] = [
  { id: "dashboard", label: "Dashboard e relatórios", codes: ["report.view"] },
  { id: "pdv", label: "PDV e vendas", codes: [
    "pos.view","pos.sell","pos.sell_without_stock","pos.use_voucher","pos.use_store_credit",
    "pos.apply_item_discount","pos.apply_order_discount","pos.override_price",
    "pos.authorize_discount","pos.cancel_sale","sale.create","sale.cancel","sale.discount",
  ] },
  { id: "caixa", label: "Caixa", codes: [
    "pos.open_cash","pos.close_cash","pos.cash_in","pos.cash_out",
  ] },
  { id: "clientes", label: "Clientes", codes: ["client.manage"] },
  { id: "produtos", label: "Produtos", codes: [
    "product.view","product.create","product.edit","product.delete","product.change_price",
    "product.view_cost","pos.view_cost",
  ] },
  { id: "estoque", label: "Estoque", codes: [
    "stock.view","stock.adjust","stock.allow_negative","inventory.manage",
  ] },
  { id: "recebimentos", label: "Recebimentos", codes: ["goods_receipt.create"] },
  { id: "etiquetas", label: "Etiquetas", codes: ["label.print"] },
  { id: "trocas", label: "Trocas e estornos", codes: [
    "exchange.create","exchanges.view","exchanges.create","exchanges.approve","exchanges.cancel",
    "exchanges.complete","exchanges.issue_receipt","exchanges.reprint_receipt","exchanges.print_receipt",
    "exchanges.issue_voucher","exchanges.print_voucher","exchanges.issue_store_credit",
    "exchanges.adjust_voucher","exchanges.adjust_credit",
    "exchanges.override_deadline","exchanges.accept_defective","exchanges.accept_without_tag",
    "exchanges.return_to_available_stock","exchanges.refund_without_stock_return",
    "exchanges.refund_cash","exchanges.refund_card","exchanges.refund_pix","refund.create",
    "vouchers.view","credits.view",
  ] },
  { id: "expedicao", label: "Expedição", codes: [
    "shipping.view","shipping.view_all","shipping.view_own","shipping.create","shipping.pick",
    "shipping.dispatch","shipping.deliver","shipping.override_schedule","shipping.settings",
    "shipping.manage_couriers",
  ] },
  { id: "cadastros", label: "Cadastros auxiliares", codes: [
    "supplier.manage","category.manage","brand.manage",
  ] },
  { id: "admin", label: "Administração", codes: [
    "user.manage","role.manage","audit.view",
  ] },
];

// Codes considered sensitive — surfaced with a red highlight in the UI.
export const SENSITIVE_PERMISSIONS = new Set<string>([
  "product.view_cost","pos.view_cost","report.view",
  "pos.close_cash","pos.cash_out","pos.cancel_sale","sale.cancel",
  "pos.authorize_discount","pos.override_price","product.change_price",
  "exchanges.override_deadline","exchanges.approve","exchanges.cancel",
  "exchanges.refund_cash","exchanges.refund_card","exchanges.refund_pix",
  "exchanges.refund_without_stock_return","refund.create",
  "stock.adjust","stock.allow_negative","inventory.manage",
  "shipping.override_schedule","shipping.settings",
  "user.manage","role.manage","audit.view",
]);

export function permissionGroupOf(code: string): string {
  for (const g of PERMISSION_GROUPS) if (g.codes.includes(code)) return g.label;
  return "Outros";
}
