import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, Search, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { loadGoogleMaps, parseAddressComponents } from "@/lib/google-maps-loader";
import { AddressMapPreview } from "@/components/address-map-preview";

export interface AddressResult {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  lat?: number;
  lng?: number;
}

interface AddressAutocompleteProps {
  onAddressSelect?: (addr: AddressResult) => void;
  defaultAddress?: Partial<AddressResult>;
  value?: string;
  onChange?: (val: any) => void;
  onSelect?: (place: any) => void;
  placeholder?: string;
}

interface Suggestion {
  placeId: string;
  primary: string;
  secondary: string;
  toPlace: () => any;
}

export function AddressAutocomplete({
  onAddressSelect,
  defaultAddress,
  value,
  onChange,
  onSelect,
  placeholder,
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value ?? defaultAddress?.logradouro ?? "");
  const [number, setNumber] = useState(defaultAddress?.numero || "");
  const [complement, setComplement] = useState(defaultAddress?.complemento || "");
  const [bairro, setBairro] = useState(defaultAddress?.bairro || "");
  const [cidade, setCidade] = useState(defaultAddress?.cidade || "");
  const [uf, setUf] = useState(defaultAddress?.uf || "");
  const [cep, setCep] = useState(defaultAddress?.cep || "");
  const [lat, setLat] = useState<number | undefined>(defaultAddress?.lat);
  const [lng, setLng] = useState<number | undefined>(defaultAddress?.lng);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sessionTokenRef = useRef<any>(null);
  const placesLibRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const ensurePlaces = async () => {
    if (placesLibRef.current) return placesLibRef.current;
    const g = await loadGoogleMaps();
    const lib = await g.maps.importLibrary("places");
    placesLibRef.current = lib;
    sessionTokenRef.current = new (lib as any).AutocompleteSessionToken();
    return lib;
  };

  const fetchSuggestions = async (input: string) => {
    if (!input || input.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const lib: any = await ensurePlaces();
      const { suggestions: raw } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: sessionTokenRef.current,
        includedRegionCodes: ["br"],
        language: "pt-BR",
      });
      const mapped: Suggestion[] = raw
        .filter((s: any) => s.placePrediction)
        .map((s: any) => ({
          placeId: s.placePrediction.placeId,
          primary: s.placePrediction.mainText?.text ?? s.placePrediction.text?.text ?? "",
          secondary: s.placePrediction.secondaryText?.text ?? "",
          toPlace: () => s.placePrediction.toPlace(),
        }));
      setSuggestions(mapped);
    } catch (err: any) {
      console.error("[places] autocomplete failed:", err);
      setError("Não foi possível buscar sugestões. Verifique sua conexão.");
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setOpen(true);
    if (onChange) onChange(val);
    if (onAddressSelect) {
      onAddressSelect({ logradouro: val, numero: number, complemento: complement, bairro, cidade, uf, cep, lat, lng });
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 280);
  };

  const handleSelectSuggestion = async (s: Suggestion) => {
    setOpen(false);
    setLoading(true);
    try {
      const place = s.toPlace();
      await place.fetchFields({
        fields: ["addressComponents", "location", "formattedAddress"],
      });
      const loc = place.location
        ? { lat: place.location.lat(), lng: place.location.lng() }
        : undefined;
      const parsed = parseAddressComponents(place.addressComponents, loc);

      const nextLogradouro = parsed.logradouro || s.primary;
      const nextNumero = parsed.numero || number;
      setQuery(nextLogradouro);
      if (parsed.numero) setNumber(parsed.numero);
      setBairro(parsed.bairro);
      setCidade(parsed.cidade);
      setUf(parsed.uf);
      setCep(parsed.cep);
      setLat(parsed.lat);
      setLng(parsed.lng);

      // Rotate session token after a selection
      const lib: any = placesLibRef.current;
      if (lib) sessionTokenRef.current = new lib.AutocompleteSessionToken();

      if (onSelect) onSelect(parsed);
      if (onChange) onChange(nextLogradouro);
      if (onAddressSelect) {
        onAddressSelect({
          logradouro: nextLogradouro,
          numero: nextNumero,
          complemento: complement,
          bairro: parsed.bairro,
          cidade: parsed.cidade,
          uf: parsed.uf,
          cep: parsed.cep,
          lat: parsed.lat,
          lng: parsed.lng,
        });
      }
    } catch (err) {
      console.error("[places] fetchFields failed:", err);
      setError("Não foi possível carregar detalhes do endereço.");
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (
    field: "number" | "complement" | "bairro" | "cidade" | "uf" | "cep",
    val: string,
  ) => {
    let nextNum = number;
    let nextComp = complement;
    let nextBairro = bairro;
    let nextCidade = cidade;
    let nextUf = uf;
    let nextCep = cep;

    if (field === "number") { setNumber(val); nextNum = val; }
    if (field === "complement") { setComplement(val); nextComp = val; }
    if (field === "bairro") { setBairro(val); nextBairro = val; }
    if (field === "cidade") { setCidade(val); nextCidade = val; }
    if (field === "uf") { setUf(val); nextUf = val; }
    if (field === "cep") { setCep(val); nextCep = val; }

    if (onAddressSelect) {
      onAddressSelect({
        logradouro: query,
        numero: nextNum,
        complemento: nextComp,
        bairro: nextBairro,
        cidade: nextCidade,
        uf: nextUf,
        cep: nextCep,
        lat,
        lng,
      });
    }
  };

  return (
    <div className="space-y-3" ref={containerRef}>
      <div className="relative">
        <Label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
          📍 Buscar Endereço (Logradouro / Rua)
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => query.trim().length >= 3 && setOpen(true)}
            placeholder={placeholder ?? "Digite a rua, avenida ou CEP..."}
            className="pl-9 h-10 text-xs rounded-xl border-slate-200"
            autoComplete="off"
          />
          {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-600 animate-spin" />}
        </div>

        {open && query.trim().length >= 3 && (
          <Card className="absolute z-40 left-0 right-0 mt-1 max-h-64 overflow-y-auto divide-y divide-slate-100 shadow-lg rounded-xl border-slate-200 bg-white">
            {error ? (
              <div className="p-3 text-xs text-red-600 text-center">{error}</div>
            ) : suggestions.length === 0 ? (
              <div className="p-3 text-xs text-slate-500 text-center">
                {loading ? "Buscando..." : `Nenhuma sugestão para "${query}"`}
              </div>
            ) : (
              suggestions.map((item) => (
                <button
                  key={item.placeId}
                  type="button"
                  onClick={() => handleSelectSuggestion(item)}
                  className="w-full text-left p-2.5 hover:bg-indigo-50/70 transition flex items-start gap-2 text-xs"
                >
                  <MapPin className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-800">{item.primary}</div>
                    {item.secondary && (
                      <div className="truncate text-[11px] text-slate-500">{item.secondary}</div>
                    )}
                  </div>
                </button>
              ))
            )}
          </Card>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs font-semibold text-slate-600">Número *</Label>
          <Input
            value={number}
            onChange={(e) => handleFieldChange("number", e.target.value)}
            placeholder="123"
            className="h-9 text-xs rounded-xl mt-1"
          />
        </div>
        <div>
          <Label className="text-xs font-semibold text-slate-600">Complemento / Ap</Label>
          <Input
            value={complement}
            onChange={(e) => handleFieldChange("complement", e.target.value)}
            placeholder="Apto 42, Bloco B"
            className="h-9 text-xs rounded-xl mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs font-semibold text-slate-600">Bairro</Label>
          <Input
            value={bairro}
            onChange={(e) => handleFieldChange("bairro", e.target.value)}
            placeholder="Centro"
            className="h-9 text-xs rounded-xl mt-1"
          />
        </div>
        <div>
          <Label className="text-xs font-semibold text-slate-600">Cidade / UF</Label>
          <Input
            value={`${cidade}${uf ? ` / ${uf}` : ""}`}
            onChange={(e) => handleFieldChange("cidade", e.target.value.split("/")[0].trim())}
            placeholder="São Paulo / SP"
            className="h-9 text-xs rounded-xl mt-1"
          />
        </div>
      </div>

      {cep && (
        <div className="text-[11px] text-slate-500">
          CEP detectado: <span className="font-semibold text-slate-700">{cep}</span>
        </div>
      )}
    </div>
  );
}
