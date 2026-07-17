import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin } from "lucide-react";

export type AddressParts = {
  address: string;
  address_number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  latitude: number | null;
  longitude: number | null;
  place_id: string;
  formatted_address: string;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSelect: (parts: AddressParts) => void;
  placeholder?: string;
  country?: string; // ISO 3166-1 alpha-2, default "br"
  id?: string;
  className?: string;
};

let googleMapsPromise: Promise<any> | null = null;
function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const w = window as any;
  if (w.google?.maps?.importLibrary) return Promise.resolve(w.google);
  if (googleMapsPromise) return googleMapsPromise;

  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
  if (!key) return Promise.reject(new Error("Google Maps não configurado."));

  googleMapsPromise = new Promise((resolve, reject) => {
    const cbName = "__lovableInitGmaps";
    (window as any)[cbName] = () => resolve((window as any).google);
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key,
      libraries: "places",
      loading: "async",
      callback: cbName,
      language: "pt-BR",
      region: "BR",
    });
    if (channel) params.set("channel", channel);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.onerror = () => { googleMapsPromise = null; reject(new Error("Falha ao carregar Google Maps.")); };
    document.head.appendChild(s);
  });
  return googleMapsPromise;
}

function pick(components: any[], type: string, short = false): string {
  const c = components?.find((x) => (x.types ?? []).includes(type));
  if (!c) return "";
  return short ? (c.shortText ?? c.short_name ?? "") : (c.longText ?? c.long_name ?? "");
}

export function AddressAutocomplete({
  value, onChange, onSelect, placeholder, country = "br", id, className,
}: Props) {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<any>(null);
  const placesLibRef = useRef<any>(null);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    loadGoogleMaps()
      .then(async (g) => {
        const places = await g.maps.importLibrary("places");
        if (!alive) return;
        placesLibRef.current = places;
        sessionRef.current = new places.AutocompleteSessionToken();
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function scheduleFetch(input: string) {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (input.trim().length < 3 || !placesLibRef.current) {
      setSuggestions([]); setOpen(false); return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        const { AutocompleteSuggestion } = placesLibRef.current;
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: sessionRef.current,
          includedRegionCodes: [country.toUpperCase()],
          language: "pt-BR",
        });
        setSuggestions(suggestions ?? []);
        setOpen(true);
      } catch (e: any) {
        setError(e?.message ?? "Erro ao buscar endereço.");
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  async function handlePick(s: any) {
    try {
      const place = s.placePrediction.toPlace();
      await place.fetchFields({ fields: ["addressComponents", "formattedAddress", "location", "id"] });
      const comps = place.addressComponents ?? [];
      const parts: AddressParts = {
        address: pick(comps, "route") || pick(comps, "premise"),
        address_number: pick(comps, "street_number"),
        neighborhood: pick(comps, "sublocality_level_1") || pick(comps, "sublocality") || pick(comps, "political"),
        city:
          pick(comps, "administrative_area_level_2") ||
          pick(comps, "locality") ||
          pick(comps, "postal_town"),
        state: pick(comps, "administrative_area_level_1", true),
        zip_code: pick(comps, "postal_code"),
        latitude: place.location?.lat() ?? null,
        longitude: place.location?.lng() ?? null,
        place_id: place.id ?? "",
        formatted_address: place.formattedAddress ?? "",
      };
      onSelect(parts);
      onChange(parts.address || parts.formatted_address);
      setOpen(false);
      setSuggestions([]);
      // Start a fresh session token for the next lookup (billing best practice).
      if (placesLibRef.current) {
        sessionRef.current = new placesLibRef.current.AutocompleteSessionToken();
      }
    } catch (e: any) {
      setError(e?.message ?? "Erro ao carregar endereço.");
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder ?? "Digite o endereço…"}
        onChange={(e) => { onChange(e.target.value); scheduleFetch(e.target.value); }}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        autoComplete="off"
      />
      {loading && (
        <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
          <ul className="max-h-72 overflow-auto py-1 text-sm">
            {suggestions.map((s, i) => {
              const p = s.placePrediction;
              const main = p?.mainText?.text ?? p?.text?.text ?? "";
              const sec = p?.secondaryText?.text ?? "";
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => handlePick(s)}
                    className="w-full text-left px-3 py-2 hover:bg-accent flex items-start gap-2"
                  >
                    <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <span>
                      <span className="font-medium">{main}</span>
                      {sec && <span className="block text-xs text-muted-foreground">{sec}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="px-3 py-1 text-[10px] text-muted-foreground border-t bg-muted/30">
            Sugestões do Google Maps
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
