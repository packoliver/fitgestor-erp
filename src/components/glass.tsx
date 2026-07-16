import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Level = "soft" | "medium" | "strong";

interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  level?: Level;
}

const levelClass: Record<Level, string> = {
  soft: "glass-soft",
  medium: "glass-medium",
  strong: "glass-strong",
};

/** Painel Glass reutilizável — usa tokens fit-* globais. */
export const GlassPanel = forwardRef<HTMLDivElement, GlassProps>(
  ({ level = "medium", className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(levelClass[level], "rounded-2xl", className)}
      {...props}
    />
  ),
);
GlassPanel.displayName = "GlassPanel";

export const GlassCard = forwardRef<HTMLDivElement, GlassProps>(
  ({ level = "soft", className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(levelClass[level], "rounded-xl p-5", className)}
      {...props}
    />
  ),
);
GlassCard.displayName = "GlassCard";
