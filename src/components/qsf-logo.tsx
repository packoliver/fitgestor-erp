import { cn } from "@/lib/utils";

/**
 * Marca oficial do sistema — Quero Ser Fit®.
 * "QSF" é apenas a abreviação visual da marca, nunca uma marca isolada.
 */
export function QsfMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-[10px] border border-white/10 bg-[#17171B] text-white",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        className="font-semibold leading-none tracking-[-0.04em]"
        style={{ fontSize: Math.round(size * 0.42) }}
      >
        QSF
      </span>
      <span
        className="absolute bottom-1 right-1 h-1 w-1 rounded-full"
        style={{ backgroundColor: "#8B5CF6" }}
      />
    </div>
  );
}

/**
 * Bloco de identidade completo:
 *   QSF
 *   Quero Ser Fit®
 *   Sistema de Gestão
 */
export function QsfIdentity({
  align = "left",
  size = "md",
  onDark = false,
  className,
}: {
  align?: "left" | "center";
  size?: "sm" | "md" | "lg";
  onDark?: boolean;
  className?: string;
}) {
  const scale = size === "lg" ? { mark: 52, title: "text-[28px]", sub: "text-[13px]", tag: "text-[11px]" }
    : size === "sm" ? { mark: 32, title: "text-[18px]", sub: "text-[11.5px]", tag: "text-[10px]" }
    : { mark: 40, title: "text-[22px]", sub: "text-[12.5px]", tag: "text-[10.5px]" };

  const muted = onDark ? "text-white/55" : "text-muted-foreground";
  const strong = onDark ? "text-white" : "text-foreground";

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        align === "center" && "flex-col text-center gap-2.5",
        className,
      )}
    >
      <QsfMark size={scale.mark} />
      <div className={cn("min-w-0", align === "center" ? "" : "leading-tight")}>
        <p className={cn("font-semibold tracking-[-0.02em]", scale.title, strong)}>QSF</p>
        <p className={cn("mt-0.5 font-medium", scale.sub, muted)}>
          Quero Ser Fit<span className="align-super text-[0.6em]">®</span>
        </p>
        <p className={cn("mt-0.5 uppercase tracking-[0.18em]", scale.tag, muted)}>
          Sistema de Gestão
        </p>
      </div>
    </div>
  );
}
