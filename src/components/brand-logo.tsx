import { cn } from "@/lib/utils";

/**
 * Marca oficial do sistema — FitGestor.
 * Desenvolvido pela Quero Ser Fit®.
 */
export function BrandMark({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        className="font-semibold leading-none tracking-[-0.04em]"
        style={{ fontSize: Math.round(size * 0.5) }}
      >
        F
      </span>
    </div>
  );
}

export function BrandLockup({
  size = "md",
  align = "left",
  onDark = false,
  showSignature = false,
  className,
}: {
  size?: "sm" | "md" | "lg";
  align?: "left" | "center";
  onDark?: boolean;
  showSignature?: boolean;
  className?: string;
}) {
  const scale =
    size === "lg"
      ? { mark: 52, title: "text-[30px]", sub: "text-[13px]", sig: "text-[11.5px]" }
      : size === "sm"
        ? { mark: 30, title: "text-[16px]", sub: "text-[11px]", sig: "text-[10.5px]" }
        : { mark: 38, title: "text-[20px]", sub: "text-[12px]", sig: "text-[11px]" };

  const strong = onDark ? "text-white" : "text-foreground";
  const muted = onDark ? "text-white/55" : "text-muted-foreground";

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        align === "center" && "flex-col text-center gap-3",
        className,
      )}
    >
      <BrandMark size={scale.mark} />
      <div className={cn("min-w-0", align === "center" ? "" : "leading-tight")}>
        <p className={cn("font-semibold tracking-[-0.02em]", scale.title, strong)}>
          FitGestor
        </p>
        <p className={cn("mt-0.5 font-medium", scale.sub, muted)}>Sistema de Gestão</p>
        {showSignature && (
          <p className={cn("mt-1.5 font-medium", scale.sig, muted)}>
            Desenvolvido pela Quero Ser Fit<sup className="text-[0.6em]">®</sup>
          </p>
        )}
      </div>
    </div>
  );
}
