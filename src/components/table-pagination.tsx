import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 500];

type TablePaginationProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Nome do que está sendo listado, no plural. Ex.: "saldos", "produtos". */
  itemLabel?: string;
};

// Monta a régua de páginas no estilo "01 02 03 04 05 … 75": sempre a primeira
// e a última, mais duas vizinhas de cada lado da atual, com reticências no que
// for pulado. Com poucas páginas mostra todas, sem reticências.
function buildPageList(current: number, total: number): (number | "gap")[] {
  const SIBLINGS = 2;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const out: (number | "gap")[] = [1];
  const left = Math.max(2, current - SIBLINGS);
  const right = Math.min(total - 1, current + SIBLINGS);

  if (left > 2) out.push("gap");
  for (let p = left; p <= right; p++) out.push(p);
  if (right < total - 1) out.push("gap");
  out.push(total);

  return out;
}

export function TablePagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  itemLabel = "itens",
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const firstShown = totalItems === 0 ? 0 : (current - 1) * pageSize + 1;
  const lastShown = Math.min(current * pageSize, totalItems);

  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap">Mostrar</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-[84px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="whitespace-nowrap">por página</span>
      </div>

      <span className="whitespace-nowrap">
        {totalItems === 0
          ? `Nenhum resultado`
          : `${firstShown}–${lastShown} de ${totalItems.toLocaleString("pt-BR")} ${itemLabel}`}
      </span>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Página anterior"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {buildPageList(current, totalPages).map((entry, i) =>
          entry === "gap" ? (
            <span key={`gap-${i}`} className="px-1.5 select-none">
              …
            </span>
          ) : (
            <Button
              key={entry}
              variant={entry === current ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8 font-mono text-xs"
              aria-current={entry === current ? "page" : undefined}
              onClick={() => onPageChange(entry)}
            >
              {String(entry).padStart(2, "0")}
            </Button>
          ),
        )}

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Próxima página"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
