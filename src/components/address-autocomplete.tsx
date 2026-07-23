import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, Search, Check, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";

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

// Lista de sugestões de exemplo para busca offline/fallback rápido
const MOCK_SUGGESTIONS = [
  { logradouro: "Av. Paulista", bairro: "Bela Vista", cidade: "São Paulo", uf: "SP", cep: "01310-100", lat: -23.5615, lng: -46.6559 },
  { logradouro: "Rua Oscar Freire", bairro: "Jardins", cidade: "São Paulo", uf: "SP", cep: "01426-001", lat: -23.5638, lng: -46.6698 },
  { logradouro: "Av. Brigadeiro Faria Lima", bairro: "Itaim Bibi", cidade: "São Paulo", uf: "SP", cep: "01452-000", lat: -23.5824, lng: -46.6856 },
  { logradouro: "Rua Augusta", bairro: "Consolação", cidade: "São Paulo", uf: "SP", cep: "01305-000", lat: -23.5517, lng: -46.6499 },
  { logradouro: "Av. das Américas", bairro: "Barra da Tijuca", cidade: "Rio de Janeiro", uf: "RJ", cep: "22640-100", lat: -23.0003, lng: -43.3659 },
];

export function AddressAutocomplete({ onAddressSelect, defaultAddress, value, onChange, onSelect, placeholder }: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value ?? defaultAddress?.logradouro ?? "");
  const [number, setNumber] = useState(defaultAddress?.numero || "");
  const [complement, setComplement] = useState(defaultAddress?.complemento || "");
  const [bairro, setBairro] = useState(defaultAddress?.bairro || "");
  const [cidade, setCidade] = useState(defaultAddress?.cidade || "");
  const [uf, setUf] = useState(defaultAddress?.uf || "SP");
  const [cep, setCep] = useState(defaultAddress?.cep || "");
  const [lat, setLat] = useState<number | undefined>(defaultAddress?.lat);
  const [lng, setLng] = useState<number | undefined>(defaultAddress?.lng);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const suggestions = MOCK_SUGGESTIONS.filter((s) =>
    `${s.logradouro} ${s.bairro} ${s.cidade}`.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelectSuggestion = (s: typeof MOCK_SUGGESTIONS[0]) => {
    setQuery(s.logradouro);
    setBairro(s.bairro);
    setCidade(s.cidade);
    setUf(s.uf);
    setCep(s.cep);
    setLat(s.lat);
    setLng(s.lng);
    setOpen(false);

    if (onSelect) onSelect(s);
    if (onChange) onChange(s.logradouro);

    if (onAddressSelect) {
      onAddressSelect({
        logradouro: s.logradouro,
        numero: number,
        complemento: complement,
        bairro: s.bairro,
        cidade: s.cidade,
        uf: s.uf,
        cep: s.cep,
        lat: s.lat,
        lng: s.lng,
      });
    }
  };

  const handleFieldChange = (
    field: "number" | "complement" | "bairro" | "cidade" | "uf" | "cep",
    val: string
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
    <div className="space-y-3">
      {/* Busca com Autocomplete */}
      <div className="relative">
        <Label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
          📍 Buscar Endereço (Logradouro / Rua)
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              setOpen(true);
              if (onChange) onChange(val);
              if (onAddressSelect) {
                onAddressSelect({ logradouro: val, numero: number, complemento: complement, bairro, cidade, uf, cep, lat, lng });
              }
            }}
            onFocus={() => setOpen(true)}
            placeholder="Digite a rua, avenida ou CEP..."
            className="pl-9 h-10 text-xs rounded-xl border-slate-200"
          />
          {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-600 animate-spin" />}
        </div>

        {/* Dropdown de sugestões */}
        {open && query.trim().length > 1 && (
          <Card className="absolute z-40 left-0 right-0 mt-1 max-h-48 overflow-y-auto divide-y divide-slate-100 shadow-lg rounded-xl border-slate-200 bg-white">
            {suggestions.length === 0 ? (
              <div className="p-3 text-xs text-slate-500 text-center">
                Utilize &quot;{query}&quot; como endereço principal
              </div>
            ) : (
              suggestions.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectSuggestion(item)}
                  className="w-full text-left p-2.5 hover:bg-indigo-50/70 transition flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <MapPin className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                    <span className="truncate font-semibold text-slate-800">
                      {item.logradouro} - {item.bairro}, {item.cidade} ({item.uf})
                    </span>
                  </div>
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 opacity-0 group-hover:opacity-100" />
                </button>
              ))
            )}
          </Card>
        )}
      </div>

      {/* Número e Complemento */}
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

      {/* Bairro e Cidade */}
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
            onChange={(e) => handleFieldChange("cidade", e.target.value)}
            placeholder="São Paulo / SP"
            className="h-9 text-xs rounded-xl mt-1"
          />
        </div>
      </div>
    </div>
  );
}
