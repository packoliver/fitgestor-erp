import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { Loader2, ExternalLink } from "lucide-react";

interface AddressMapPreviewProps {
  lat?: number;
  lng?: number;
  label?: string;
  className?: string;
}

export function AddressMapPreview({ lat, lng, label, className }: AddressMapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lat == null || lng == null || !containerRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const g: any = await loadGoogleMaps();
        if (cancelled || !containerRef.current) return;
        const pos = { lat, lng };
        if (!mapRef.current) {
          mapRef.current = new g.maps.Map(containerRef.current, {
            center: pos,
            zoom: 17,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "cooperative",
            clickableIcons: false,
          });
          markerRef.current = new g.maps.Marker({ position: pos, map: mapRef.current });
        } else {
          mapRef.current.setCenter(pos);
          markerRef.current.setPosition(pos);
        }
        setReady(true);
      } catch (err: any) {
        console.error("[map preview] failed:", err);
        setError("Não foi possível carregar o mapa.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  if (lat == null || lng == null) return null;

  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-slate-600">
          📍 Preview no mapa {label ? `— ${label}` : ""}
        </span>
        <a
          href={gmapsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-indigo-600 hover:underline inline-flex items-center gap-1"
        >
          Abrir no Google Maps <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50" style={{ height: 180 }}>
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando mapa...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-red-600">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
