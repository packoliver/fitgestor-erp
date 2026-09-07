import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCep, lookupBrazilianCep, normalizeCep } from "@/lib/cep";

export type CepAddressValue = {
  zip_code: string;
  address: string;
  address_number: string;
  address_complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

type Props = {
  value: CepAddressValue;
  onChange: (patch: Partial<CepAddressValue>) => void;
  required?: boolean;
};

export function CepAddressFields({ value, onChange, required = false }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState(false);
  const cepDigits = normalizeCep(value.zip_code);

  useEffect(() => {
    if (cepDigits.length !== 8) {
      setFound(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await lookupBrazilianCep(cepDigits, controller.signal);
        onChange({
          zip_code: result.zipCode,
          address: result.address || value.address,
          neighborhood: result.neighborhood || value.neighborhood,
          city: result.city || value.city,
          state: result.state || value.state,
        });
        setFound(true);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setFound(false);
        setError(cause instanceof Error ? cause.message : "Não foi possível consultar o CEP.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // Search only when the normalized CEP changes. The current address values
    // are intentionally read at request time without retriggering the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cepDigits]);

  const update = <K extends keyof CepAddressValue>(field: K, next: CepAddressValue[K]) => {
    setFound(false);
    onChange({ [field]: next });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>
          CEP{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (preenchimento automático gratuito)
          </span>
        </Label>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            value={value.zip_code}
            onChange={(event) => update("zip_code", formatCep(event.target.value))}
            className="pl-9 pr-9"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />
          )}
          {!loading && found && (
            <CheckCircle2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
          )}
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        {!error && found && (
          <p className="mt-1 text-xs text-emerald-700">Endereço preenchido pelo ViaCEP.</p>
        )}
      </div>

      <div>
        <Label>Endereço {required && "*"}</Label>
        <Input
          autoComplete="address-line1"
          value={value.address}
          onChange={(event) => update("address", event.target.value)}
          placeholder="Rua ou avenida"
          className="mt-1"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label>Número {required && "*"}</Label>
          <Input
            autoComplete="address-line2"
            value={value.address_number}
            onChange={(event) => update("address_number", event.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Complemento</Label>
          <Input
            value={value.address_complement}
            onChange={(event) => update("address_complement", event.target.value)}
            placeholder="Apto, bloco ou referência"
            className="mt-1"
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label>Bairro {required && "*"}</Label>
          <Input
            value={value.neighborhood}
            onChange={(event) => update("neighborhood", event.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Cidade {required && "*"}</Label>
          <Input
            autoComplete="address-level2"
            value={value.city}
            onChange={(event) => update("city", event.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div className="w-full sm:w-32">
        <Label>Estado (UF) {required && "*"}</Label>
        <Input
          autoComplete="address-level1"
          maxLength={2}
          value={value.state}
          onChange={(event) => update("state", event.target.value.toUpperCase())}
          className="mt-1"
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Você pode corrigir manualmente qualquer campo antes de salvar.
      </p>
    </div>
  );
}
