// Loads the Google Maps JS API once (async) with the places library.
// Uses the Lovable-managed browser key. Safe to call multiple times.

let loadPromise: Promise<any> | null = null;

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("google maps only available in browser"));
  }
  if ((window as any).google?.maps?.importLibrary) {
    return Promise.resolve((window as any).google);
  }
  if (loadPromise) return loadPromise;

  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
  if (!key) {
    return Promise.reject(new Error("Google Maps browser key not configured"));
  }

  loadPromise = new Promise((resolve, reject) => {
    const cbName = `__initGmaps_${Math.random().toString(36).slice(2)}`;
    (window as any)[cbName] = () => {
      resolve((window as any).google);
      delete (window as any)[cbName];
    };
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      loading: "async",
      libraries: "places",
      callback: cbName,
    });
    if (channel) params.set("channel", channel);
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export interface ParsedAddress {
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  lat?: number;
  lng?: number;
}

export function parseAddressComponents(
  components: google.maps.places.AddressComponent[] | undefined,
  location?: { lat: number; lng: number },
): ParsedAddress {
  const get = (type: string) =>
    components?.find((c) => c.types.includes(type as any));

  return {
    logradouro: get("route")?.longText ?? "",
    numero: get("street_number")?.longText ?? "",
    bairro:
      get("sublocality_level_1")?.longText ??
      get("sublocality")?.longText ??
      get("neighborhood")?.longText ??
      "",
    cidade:
      get("administrative_area_level_2")?.longText ??
      get("locality")?.longText ??
      "",
    uf: get("administrative_area_level_1")?.shortText ?? "",
    cep: get("postal_code")?.longText ?? "",
    lat: location?.lat,
    lng: location?.lng,
  };
}
