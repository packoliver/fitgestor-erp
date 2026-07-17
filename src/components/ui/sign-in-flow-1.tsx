import * as React from "react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Sign In Flow visual shell (adaptado de 21st.dev/aghasisahakyan1/sign-in-flow-1)
 * Fornece apenas layout, fundo animado (aurora 3D via three/@react-three/fiber),
 * transições e estrutura. A lógica de autenticação é responsabilidade do consumidor.
 */

// ---------- Background 3D (lazy) ----------
const AuroraCanvas = lazy(() => import("./aurora-canvas"));

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useIsSmallScreen() {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setSmall(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return small;
}

function StaticAurora() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden bg-[#07070d]" aria-hidden>
      <div
        className="absolute -inset-[20%] opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(40% 55% at 25% 30%, rgba(139,92,246,0.55), transparent 60%)," +
            "radial-gradient(45% 60% at 75% 65%, rgba(59,130,246,0.45), transparent 60%)," +
            "radial-gradient(35% 45% at 55% 20%, rgba(168,85,247,0.35), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.08] mix-blend-overlay"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}

function Background() {
  const reduced = usePrefersReducedMotion();
  const small = useIsSmallScreen();
  const [tabHidden, setTabHidden] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const use3D = !reduced && !small && !failed;

  return (
    <>
      <StaticAurora />
      {use3D && (
        <ErrorBoundary onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <div className="absolute inset-0 -z-10">
              <AuroraCanvas paused={tabHidden} />
            </div>
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ---------- Shell ----------
export interface SignInFlowProps {
  brand?: React.ReactNode;
  title?: string;
  description?: string;
  children: React.ReactNode; // formulário
  footer?: React.ReactNode;
  className?: string;
}

export function SignInFlow({
  brand,
  title = "Bem-vindo ao FitGestor",
  description = "Entre para acessar a gestão da sua loja.",
  children,
  footer,
  className,
}: SignInFlowProps) {
  return (
    <div
      className={cn(
        "dark relative min-h-screen w-full overflow-hidden text-foreground",
        "flex items-center justify-center px-4 py-12",
        className,
      )}
    >
      <Background />

      {/* vignette sobre o fundo para garantir contraste do card */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 50%, transparent 0%, rgba(4,4,10,0.55) 70%, rgba(4,4,10,0.85) 100%)",
        }}
        aria-hidden
      />

      <AnimatePresence mode="wait">
        <motion.div
          key="card"
          initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-[420px]"
        >
          {brand && <div className="mb-8 flex justify-center">{brand}</div>}

          <div
            className={cn(
              "relative overflow-hidden rounded-3xl",
              "border border-white/10",
              "bg-[rgba(14,14,22,0.72)] backdrop-blur-2xl",
              "shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.06)]",
            )}
          >
            {/* borda reflexiva */}
            <div
              className="pointer-events-none absolute inset-0 rounded-3xl"
              style={{
                background:
                  "linear-gradient(140deg, rgba(139,92,246,0.35), transparent 30%, transparent 70%, rgba(59,130,246,0.3))",
                WebkitMask:
                  "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                WebkitMaskComposite: "xor",
                maskComposite: "exclude",
                padding: 1,
              }}
              aria-hidden
            />

            <div className="px-7 pt-8 pb-2 text-center">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-white">
                {title}
              </h1>
              <p className="mt-1.5 text-[13px] text-white/60">{description}</p>
            </div>

            <div className="px-7 pb-7 pt-6">{children}</div>

            {footer && (
              <div className="border-t border-white/10 px-6 py-4 text-center text-[11px] text-white/50">
                {footer}
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default SignInFlow;
