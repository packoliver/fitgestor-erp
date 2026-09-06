import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, FileText, Receipt } from "lucide-react";

type Mode = "80mm" | "a4";

/**
 * PrintDialog — mostra prévia do comprovante e imprime via window.print().
 * O mesmo `children` é usado para 80mm e A4; a diferença é apenas CSS
 * (classes .thermal-only / .a4-only e regras @media print em styles.css).
 */
export function PrintDialog({
  open,
  onOpenChange,
  title,
  triggerLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  triggerLabel?: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("80mm");

  const doPrint = (m: Mode) => {
    setMode(m);
    const cls = m === "80mm" ? "print-80mm" : "print-a4";
    document.documentElement.classList.remove("print-80mm", "print-a4");
    document.documentElement.classList.add(cls);
    // @page não pode ser aninhado sob seletor; injetamos dinamicamente.
    let pageStyle = document.getElementById("print-page-rule") as HTMLStyleElement | null;
    if (!pageStyle) {
      pageStyle = document.createElement("style");
      pageStyle.id = "print-page-rule";
      document.head.appendChild(pageStyle);
    }
    pageStyle.textContent =
      m === "80mm"
        ? "@media print { @page { size: 80mm auto; margin: 3mm; } }"
        : "@media print { @page { size: A4; margin: 12mm; } }";
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.documentElement.classList.remove("print-80mm", "print-a4");
      }, 300);
    }, 60);
  };

  // Sempre monta o print-root no <body> para o @media print encontrá-lo,
  // independente de onde o Dialog aparecer na árvore.
  const printRoot = typeof document !== "undefined"
    ? document.getElementById("print-root") ?? (() => {
        const el = document.createElement("div");
        el.id = "print-root";
        document.body.appendChild(el);
        return el;
      })()
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{title}{triggerLabel ? ` — ${triggerLabel}` : ""}</DialogTitle>
          </DialogHeader>

          <div className="flex gap-2 items-center border-b pb-2 flex-wrap">
            <span className="text-xs text-muted-foreground mr-2">Formato da prévia:</span>
            <Button size="sm" variant={mode === "80mm" ? "default" : "outline"} onClick={() => setMode("80mm")} aria-label="Ver prévia 80 milímetros" aria-pressed={mode === "80mm"}>
              <Receipt className="mr-1 h-4 w-4" aria-hidden />80 mm
            </Button>
            <Button size="sm" variant={mode === "a4" ? "default" : "outline"} onClick={() => setMode("a4")} aria-label="Ver prévia A4" aria-pressed={mode === "a4"}>
              <FileText className="mr-1 h-4 w-4" aria-hidden />A4
            </Button>
          </div>

          <div className="flex-1 overflow-auto bg-muted/30 p-4 flex justify-center">
            <div
              className={
                mode === "80mm"
                  ? "bg-white text-black shadow-md p-3 rounded"
                  : "bg-white text-black shadow-md p-8 rounded"
              }
              style={
                mode === "80mm"
                  ? { width: "80mm", fontSize: 11, lineHeight: 1.35, fontFamily: "ui-sans-serif, system-ui" }
                  : { width: "210mm", minHeight: "297mm", fontSize: 12, lineHeight: 1.45, fontFamily: "ui-sans-serif, system-ui" }
              }
              data-preview-mode={mode}
            >
              {/* Toggle .a4-only / .thermal-only na prévia via CSS inline */}
              <style>{`
                [data-preview-mode="80mm"] .a4-only { display: none !important; }
                [data-preview-mode="a4"] .thermal-only { display: none !important; }
              `}</style>
              {children}
            </div>
          </div>

          <DialogFooter className="border-t pt-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
            <Button variant="secondary" onClick={() => doPrint("80mm")}>
              <Printer className="mr-2 h-4 w-4" />Imprimir 80 mm
            </Button>
            <Button onClick={() => doPrint("a4")}>
              <Printer className="mr-2 h-4 w-4" />Imprimir A4 / PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conteúdo real da impressão, portalizado fora do Dialog. */}
      {open && printRoot && createPortal(<div>{children}</div>, printRoot)}
    </>
  );
}
