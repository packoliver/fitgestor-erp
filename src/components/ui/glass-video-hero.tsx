import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface GlassVideoHeroProps {
  eyebrow?: string;
  title: React.ReactNode;
  description: string;
  primaryCta: { label: string; to: string };
  secondaryCta: { label: string; href: string };
  videoSrc?: string;
  posterSrc?: string;
}

/**
 * GlassVideoHero — hero em Liquid Glass com vídeo de fundo, poster de fallback
 * e overlay para legibilidade. Respeita prefers-reduced-motion e é acessível.
 */
export function GlassVideoHero({
  eyebrow = "FitGestor · Sistema de Gestão",
  title,
  description,
  primaryCta,
  secondaryCta,
  videoSrc = "/videos/fitgestor-hero.mp4",
  posterSrc = "/images/fitgestor-hero-poster.webp",
}: GlassVideoHeroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mql.matches);
    apply();
    mql.addEventListener?.("change", apply);
    return () => mql.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (reduceMotion) {
      v.pause();
      return;
    }
    v.play().catch(() => {
      /* autoplay bloqueado — o poster continua servindo como fundo */
    });
  }, [reduceMotion, videoReady]);

  return (
    <section
      aria-label="Apresentação do FitGestor"
      className="fit-aurora relative isolate overflow-hidden border-b border-white/5"
    >
      {/* Fundo: vídeo + poster de fallback */}
      <div aria-hidden className="absolute inset-0 -z-10">
        {posterSrc && (
          <img
            src={posterSrc}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover opacity-90"
            loading="eager"
            decoding="async"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        {videoSrc && !reduceMotion && (
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
              videoReady ? "opacity-100" : "opacity-0"
            }`}
            src={videoSrc}
            poster={posterSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedData={() => setVideoReady(true)}
            onError={() => setVideoReady(false)}
          />
        )}
        {/* Overlays de legibilidade */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/55 to-background/90" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_0%,rgba(0,0,0,0.55)_75%)]" />
        {/* Aurora glow — mesmo vocabulário do design system */}
        <div className="pointer-events-none absolute -top-40 -left-20 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.28),transparent_70%)] blur-3xl" />
        <div className="pointer-events-none absolute top-20 right-[-160px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.22),transparent_70%)] blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[86vh] max-w-[1200px] flex-col items-center justify-center gap-8 px-6 py-24 text-center lg:min-h-[92vh] lg:px-10 lg:py-32">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/85 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-primary-glow shadow-[0_0_10px_rgba(167,139,250,0.9)]" />
          {eyebrow}
        </div>

        <h1 className="max-w-[22ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground drop-shadow-[0_4px_24px_rgba(0,0,0,0.55)] sm:text-[54px] lg:text-[64px]">
          {title}
        </h1>

        <p className="max-w-[62ch] text-[15.5px] leading-relaxed text-white/80 sm:text-[17px]">
          {description}
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="rounded-full bg-primary px-6 text-primary-foreground shadow-[0_10px_30px_-8px_rgba(139,92,246,0.65)] hover:bg-primary-hover hover:shadow-[0_14px_36px_-8px_rgba(139,92,246,0.8)] focus-visible:ring-2 focus-visible:ring-primary-glow focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Link to={primaryCta.to as string}>
              {primaryCta.label} <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="ghost"
            className="rounded-full border border-white/15 bg-white/[0.06] text-foreground backdrop-blur-md hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <a href={secondaryCta.href}>
              <PlayCircle className="h-4 w-4" />
              {secondaryCta.label}
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

export default GlassVideoHero;
