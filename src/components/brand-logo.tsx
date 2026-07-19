import { cn } from "@/lib/utils";
import iconAsset from "@/assets/fitgestor-icon.png.asset.json";
import lockupAsset from "@/assets/fitgestor-lockup.png.asset.json";

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
    <img
      src={iconAsset.url}
      alt="FitGestor"
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
    />
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
  const height = size === "lg" ? 52 : size === "sm" ? 28 : 38;
  const sigCls = size === "lg" ? "text-[11.5px]" : size === "sm" ? "text-[10.5px]" : "text-[11px]";
  const muted = onDark ? "text-white/60" : "text-muted-foreground";

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        align === "center" && "flex-col text-center gap-2",
        className,
      )}
    >
      <img
        src={lockupAsset.url}
        alt="FitGestor"
        style={{ height, width: "auto" }}
        className={cn("object-contain", onDark && "brightness-0 invert")}
      />
      {showSignature && (
        <p className={cn("mt-1 font-medium", sigCls, muted)}>
          Desenvolvido pela Quero Ser Fit<sup className="text-[0.6em]">®</sup>
        </p>
      )}
    </div>
  );
}
