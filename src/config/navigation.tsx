import {
  LayoutDashboard, Package, Boxes, ArrowDownToLine, ClipboardList, Tag,
  Users, ShieldCheck, Truck, FolderTree, Sparkles, Settings, ScrollText,
  ShoppingCart, Wallet, Receipt, UserSquare2, RefreshCw, Ticket, PiggyBank, FileBarChart,
  MapPin, AlertTriangle, Rocket, MessageCircle, Home, Briefcase, Trophy, Upload,
} from "lucide-react";
import type { ComponentType } from "react";

export type Workspace = "admin" | "employee" | "courier";

export type NavGroup =
  | "Início" | "Cadastros" | "Suprimentos" | "Vendas"
  | "Entregas" | "Relatórios" | "Configurações";

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
  /** Show in "Menu essencial" (first-run compact view). */
  essential?: boolean;
  /** Only show in the sidebar for courier-context users (never admin). */
  courierOnly?: boolean;
  /** Extra terms for the navigation search. */
  keywords?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  // ── Início ────────────────────────────────────────────────
  { id: "dashboard", title: "Visão geral", url: "/dashboard", icon: Home,
    group: "Início", workspaces: ["admin"], priority: 100, mobile: true, essential: true,
    description: "Indicadores e resumo da operação.",
    keywords: ["dashboard","home","indicadores","kpi","resumo"] },
  { id: "trabalho", title: "Área de trabalho", url: "/trabalho", icon: Briefcase,
    group: "Início", priority: 90, mobile: true, essential: true,
    description: "Atalhos para as tarefas do dia.",
    keywords: ["atalhos","tarefas","trabalho","hoje"] },

  // ── Vendas ────────────────────────────────────────────────
  { id: "pdv", title: "PDV", url: "/pdv", icon: ShoppingCart, perm: "pos.view",
    group: "Vendas", workspaces: ["employee","admin"], priority: 100, mobile: true, essential: true,
    description: "Registre uma nova venda no balcão.",
    keywords: ["vender","venda","balcao","caixa registradora","cupom"] },
  { id: "caixa", title: "Caixa", url: "/caixa", icon: Wallet,
    perm: ["pos.open_cash","pos.close_cash","pos.view"],
    group: "Vendas", workspaces: ["employee","admin"], priority: 90,
    description: "Abertura, fechamento e movimentos de caixa.",
    keywords: ["caixa","abrir","fechar","sangria","suprimento"] },
  { id: "vendas", title: "Vendas", url: "/vendas", icon: Receipt,
    group: "Vendas", workspaces: ["employee","admin"], priority: 70,
    description: "Histórico das vendas realizadas.",
    keywords: ["vendas","historico","pedidos","cupons"] },
  { id: "clientes", title: "Clientes", url: "/clientes", icon: UserSquare2,
    group: "Cadastros", workspaces: ["employee","admin"], priority: 100, essential: true,
    description: "Cadastro e histórico das clientes.",
    keywords: ["clientes","cliente","cadastro","cpf"] },
  { id: "trocas", title: "Trocas", url: "/trocas", icon: RefreshCw, perm: "exchanges.view",
    group: "Vendas", workspaces: ["employee","admin"], priority: 50,
    description: "Registre trocas, devoluções e reembolsos.",
    keywords: ["troca","devolucao","reembolso","estorno"] },
  { id: "pos-venda", title: "Pós-venda", url: "/pos-venda", icon: MessageCircle,
    perm: "post_sale.view", group: "Vendas", workspaces: ["employee","admin"], priority: 40,
    mobile: true, essential: true,
    description: "Prepare e envie mensagens de acompanhamento às clientes.",
    keywords: ["mensagem","whatsapp","pos venda","acompanhamento","follow up"] },
  { id: "vales", title: "Vales-troca", url: "/trocas/vales", icon: Ticket, perm: "vouchers.view",
    group: "Vendas", workspaces: ["admin"], priority: 30,
    description: "Vales de troca emitidos e disponíveis.",
    keywords: ["vale","voucher","vale troca","credito"] },
  { id: "creditos", title: "Créditos", url: "/trocas/creditos", icon: PiggyBank, perm: "credits.view",
    group: "Vendas", workspaces: ["admin"], priority: 20,
    description: "Saldo de crédito por cliente.",
    keywords: ["credito","saldo","cliente","vale"] },

  // ── Estoque ───────────────────────────────────────────────
  { id: "produtos", title: "Produtos", url: "/produtos", icon: Package, perm: "product.view",
    group: "Cadastros", workspaces: ["employee","admin"], priority: 90, essential: true,
    description: "Catálogo de produtos, cores e tamanhos.",
    keywords: ["produto","catalogo","sku","cadastro"] },
  { id: "fornecedores", title: "Fornecedores", url: "/fornecedores", icon: Truck, perm: "supplier.manage",
    group: "Cadastros", workspaces: ["admin"], priority: 70,
    description: "Cadastro de fornecedores.",
    keywords: ["fornecedor","supplier"] },
  { id: "categorias", title: "Categorias", url: "/categorias", icon: FolderTree, perm: "category.manage",
    group: "Cadastros", workspaces: ["admin"], priority: 60,
    description: "Categorias de produtos.",
    keywords: ["categoria"] },
  { id: "marcas", title: "Marcas", url: "/marcas", icon: Sparkles, perm: "brand.manage",
    group: "Cadastros", workspaces: ["admin"], priority: 50,
    description: "Marcas de produtos.",
    keywords: ["marca","brand"] },

  // ── Suprimentos (entradas, estoque, etiquetas) ────────────
  { id: "estoque", title: "Estoque", url: "/estoque", icon: Boxes, perm: "stock.view",
    group: "Suprimentos", workspaces: ["employee","admin"], priority: 100, essential: true,
    description: "Saldo atual por SKU e variação.",
    keywords: ["estoque","saldo","inventario","sku"] },
  { id: "recebimentos", title: "Entrada de mercadoria", url: "/estoque/recebimentos", icon: ArrowDownToLine,
    perm: "goods_receipt.create", group: "Suprimentos", workspaces: ["employee","admin"], priority: 90,
    essential: true,
    description: "Conte, registre e dê entrada nas peças recebidas.",
    keywords: ["receber","recebimento","mercadoria","nota","fornecedor","contagem"] },
  { id: "estoque-entrada", title: "Entrada rápida", url: "/estoque/entrada", icon: ArrowDownToLine,
    perm: "goods_receipt.create", group: "Suprimentos", workspaces: ["employee","admin"], priority: 80,
    description: "Ajuste simples ou reposição rápida.",
    keywords: ["entrada","ajuste","mercadoria"] },
  { id: "inventario", title: "Inventário", url: "/estoque/inventario", icon: ClipboardList,
    perm: "inventory.manage", group: "Suprimentos", workspaces: ["admin"], priority: 70,
    description: "Contagens e ajustes de inventário.",
    keywords: ["inventario","contagem","balanco"] },
  { id: "etiquetas", title: "Etiquetas", url: "/etiquetas", icon: Tag, perm: "label.print",
    group: "Suprimentos", workspaces: ["employee","admin"], priority: 60,
    description: "Gere lotes de etiquetas em PDF.",
    keywords: ["etiqueta","codigo de barras","code128","imprimir"] },

  // ── Entregas ──────────────────────────────────────────────
  { id: "expedicao", title: "Painel de entregas", url: "/expedicao", icon: LayoutDashboard,
    perm: ["shipping.view","shipping.view_all","shipping.dispatch","shipping.pick"],
    group: "Entregas", workspaces: ["employee","admin"], priority: 100, essential: true,
    description: "Panorama das entregas do dia.",
    keywords: ["expedicao","entregas","painel","visao geral","panorama"] },
  { id: "expedicao-fila", title: "Fila de entregas", url: "/expedicao/fila", icon: ClipboardList,
    perm: ["shipping.view","shipping.view_all","shipping.pick","shipping.dispatch","shipping.deliver"],
    group: "Entregas", workspaces: ["employee","admin"], priority: 90,
    description: "Pedidos aguardando separação, rota ou entrega.",
    keywords: ["fila","entrega","separar","aguardando"] },
  { id: "expedicao-rotas", title: "Rotas", url: "/expedicao/rotas", icon: MapPin,
    perm: ["shipping.view","shipping.view_all","shipping.dispatch"],
    group: "Entregas", workspaces: ["employee","admin"], priority: 80,
    description: "Organize as saídas e entregas dos motoboys.",
    keywords: ["rotas","rota","saida","motoboy"] },
  { id: "expedicao-pendencias", title: "Vendas sem entrega", url: "/expedicao/pendencias", icon: AlertTriangle,
    perm: ["shipping.view","shipping.view_all","shipping.create"],
    group: "Entregas", workspaces: ["employee","admin"], priority: 70,
    description: "Vendas pendentes de definição de entrega.",
    keywords: ["pendencia","sem entrega","definir","atrasado"] },
  { id: "motoboys", title: "Motoboys", url: "/expedicao/motoboys", icon: Truck,
    perm: "shipping.manage_couriers",
    group: "Entregas", workspaces: ["admin"], priority: 60,
    description: "Cadastro de motoboys.",
    keywords: ["motoboy","entregador","courier"] },
  { id: "motoboy-app", title: "Minhas rotas", url: "/motoboy", icon: Truck,
    perm: ["shipping.view_own","shipping.deliver"],
    group: "Entregas", workspaces: ["courier"], priority: 50, mobile: true,
    courierOnly: true,
    description: "Suas entregas do dia.",
    keywords: ["minhas rotas","motoboy","minhas entregas"] },

  // ── Configurações (equipe, permissões, ajustes) ───────────
  { id: "funcionarios", title: "Funcionários", url: "/funcionarios", icon: Users, perm: "user.manage",
    group: "Configurações", workspaces: ["admin"], priority: 100,
    description: "Cadastro e acesso dos funcionários.",
    keywords: ["funcionario","equipe","usuario","staff"] },
  { id: "cargos", title: "Cargos e permissões", url: "/cargos", icon: ShieldCheck, perm: "role.manage",
    group: "Configurações", workspaces: ["admin"], priority: 90,
    description: "Cargos e regras de permissão.",
    keywords: ["cargo","permissao","role","acesso"] },
  { id: "config", title: "Configurações gerais", url: "/configuracoes", icon: Settings,
    group: "Configurações", workspaces: ["admin"], priority: 80,
    description: "Configurações gerais do FitGestor.",
    keywords: ["configuracoes","preferencias","ajustes"] },
  { id: "config-tamanhos", title: "Tamanhos padrão", url: "/configuracoes/tamanhos", icon: Settings,
    perm: "settings.manage", group: "Configurações", workspaces: ["admin"], priority: 70,
    description: "Grade de tamanhos usada na entrada de mercadoria.",
    keywords: ["tamanhos","grade","preset"] },
  { id: "config-importar", title: "Importar dados", url: "/configuracoes/importar", icon: Upload,
    perm: "settings.manage", group: "Configurações", workspaces: ["admin"], priority: 60,
    description: "Traga produtos, clientes e estoque de outro ERP.",
    keywords: ["importar","bling","tiny","olist","csv","xlsx","planilha"] },
  { id: "setup", title: "Configuração inicial", url: "/configuracao-inicial", icon: Rocket,
    perm: "user.manage", group: "Configurações", workspaces: ["admin"], priority: 50,
    description: "Assistente de configuração inicial.",
    keywords: ["setup","onboarding"] },
  { id: "auditoria", title: "Auditoria", url: "/auditoria", icon: ScrollText, perm: "audit.view",
    group: "Configurações", workspaces: ["admin"], priority: 40,
    description: "Registro de ações sensíveis do sistema.",
    keywords: ["auditoria","log","registro","historico"] },

  // ── Relatórios ────────────────────────────────────────────
  { id: "rel-mais-vendidos", title: "Produtos mais vendidos", url: "/relatorios/mais-vendidos", icon: Trophy,
    perm: "report.view", group: "Relatórios", workspaces: ["admin"], priority: 100,
    description: "Ranking dos produtos que mais saem da loja.",
    keywords: ["mais vendidos","ranking","top","best sellers","produtos","curva abc"] },
  { id: "rel-trocas", title: "Relatório de trocas", url: "/relatorios/trocas", icon: FileBarChart,
    perm: "reports.exchanges.view", group: "Relatórios", workspaces: ["admin"],
    description: "Indicadores e desempenho das trocas.",
    keywords: ["relatorio","trocas","report"] },
];

export const NAV_GROUPS: NavGroup[] = [
  "Início","Cadastros","Suprimentos","Vendas","Entregas","Relatórios","Configurações",
];

/** IDs shown by default when "Menu essencial" is on. */
export const ESSENTIAL_ITEM_IDS = new Set(
  NAV_ITEMS.filter((i) => i.essential).map((i) => i.id),
);

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
  { id: "recebimentos", label: "Entrada de mercadoria", codes: ["goods_receipt.create"] },
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
  { id: "post_sale", label: "Pós-venda", codes: [
    "post_sale.view","post_sale.send","post_sale.create_manual",
    "post_sale.manage_templates","post_sale.manage_rules","post_sale.settings",
    "post_sale.skip","post_sale.cancel","post_sale.assign","post_sale.review",
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
