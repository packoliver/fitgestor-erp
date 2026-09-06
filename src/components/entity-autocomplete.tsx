import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { X, Search, Loader2 } from "lucide-react";

export type EntityOption = { id: string; label: string; sublabel?: string };

/**
 * Autocomplete simples e debounced para escolher UMA entidade (cliente, operador, etc.).
 * - O componente pai controla `value` (id selecionado) e `label` (rótulo mostrado).
 * - `fetcher(term)` é chamado apenas depois de 300 ms de digitação.
 * - Botão "×" limpa a seleção.
 * - Não carrega listas completas: sem termo, o menu não faz consulta.
 */
export function EntityAutocomplete({
  value,
  label,
  onChange,
  fetcher,
  placeholder,
  ariaLabel,
  disabled,
}: {
  value: string;
  label: string;
  onChange: (id: string, label: string) => void;
  fetcher: (term: string) => Promise<EntityOption[]>;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<EntityOption[]>([]);
  const cache = useRef(new Map<string, EntityOption[]>());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    if (!open) return;
    if (debounced.length < 2) {
      setOptions([]);
      return;
    }
    const cached = cache.current.get(debounced);
    if (cached) {
      setOptions(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetcher(debounced)
      .then((res) => {
        if (cancelled) return;
        cache.current.set(debounced, res);
        setOptions(res);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, open, fetcher]);

  const displayValue = useMemo(() => {
    if (value && label) return label;
    return "";
  }, [value, label]);

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            className="flex-1 justify-start font-normal h-10"
          >
            <Search className="mr-2 h-4 w-4 opacity-60" aria-hidden />
            <span className={displayValue ? "" : "text-muted-foreground"}>
              {displayValue || placeholder || "Pesquisar…"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]" align="start">
          <div className="p-2 border-b">
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={placeholder || "Digite ao menos 2 caracteres…"}
              aria-label={ariaLabel ? `Pesquisar ${ariaLabel}` : "Pesquisar"}
            />
          </div>
          <div className="max-h-64 overflow-auto text-sm">
            {loading && (
              <div className="flex items-center gap-2 p-3 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
              </div>
            )}
            {!loading && debounced.length < 2 && (
              <div className="p-3 text-muted-foreground">Digite ao menos 2 caracteres.</div>
            )}
            {!loading && debounced.length >= 2 && options.length === 0 && (
              <div className="p-3 text-muted-foreground">Nenhum resultado.</div>
            )}
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent focus:bg-accent focus:outline-none"
                onClick={() => {
                  onChange(o.id, o.label);
                  setOpen(false);
                  setTerm("");
                }}
              >
                <div className="font-medium">{o.label}</div>
                {o.sublabel && <div className="text-xs text-muted-foreground">{o.sublabel}</div>}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange("", "")}
          aria-label="Limpar seleção"
          className="h-10 w-10 shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
