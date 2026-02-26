'use client';
import { useEffect, useRef, useState } from 'react';

interface Well {
  apiNumber: string;
  wellName: string;
  operator: string;
  county: string;
  status: string;
  latitude: number;
  longitude: number;
  field?: string;
  formation?: string;
  wellType?: string;
  firstProdDate?: string;
  totalOil?: number;
  totalGas?: number;
}

const STATUS_COLORS: Record<string, string> = {
  'Producing': '#10b981',
  'Shut-in': '#f59e0b',
  'DUC': '#ef4444',
  'Drilling': '#3b82f6',
  'P&A': '#6b7280',
  'Completed': '#8b5cf6',
  'Permitted': '#06b6d4',
};

export default function AssetMap({ wells }: { wells: Well[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Well | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || !mapRef.current || typeof window === 'undefined') return;
    
    const initMap = async () => {
      const L = (await import('leaflet')).default;
      
      // Import CSS
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }

      const map = L.map(mapRef.current!, {
        center: [31.9, -103.5],
        zoom: 7,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB © OSM',
        maxZoom: 19,
      }).addTo(map);

      mapInstance.current = map;

      // Add wells
      const filtered = wells.filter(w => {
        if (filter !== 'All' && w.status !== filter) return false;
        if (search && !w.wellName.toLowerCase().includes(search.toLowerCase()) && 
            !w.operator.toLowerCase().includes(search.toLowerCase()) &&
            !w.county.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      });

      filtered.forEach(w => {
        if (!w.latitude || !w.longitude) return;
        const color = STATUS_COLORS[w.status] || '#6b7280';
        const circle = L.circleMarker([w.latitude, w.longitude], {
          radius: 6,
          fillColor: color,
          color: '#1e293b',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.85,
        }).addTo(map);

        circle.on('click', () => setSelected(w));

        circle.bindTooltip(
          `<b>${w.wellName}</b><br/>${w.operator}<br/>${w.county} Co.<br/>Status: ${w.status}`,
          { className: 'leaflet-tooltip-dark' }
        );
      });

      // Fit bounds if wells exist
      if (filtered.length > 0) {
        const lats = filtered.filter(w => w.latitude).map(w => w.latitude);
        const lngs = filtered.filter(w => w.longitude).map(w => w.longitude);
        if (lats.length > 0) {
          map.fitBounds([
            [Math.min(...lats) - 0.1, Math.min(...lngs) - 0.1],
            [Math.max(...lats) + 0.1, Math.max(...lngs) + 0.1],
          ]);
        }
      }

      setTimeout(() => map.invalidateSize(), 100);
    };

    initMap();

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [mounted, wells, filter, search]);

  const statuses = ['All', ...Object.keys(STATUS_COLORS)];
  const filtered = wells.filter(w => {
    if (filter !== 'All' && w.status !== filter) return false;
    if (search && !w.wellName.toLowerCase().includes(search.toLowerCase()) && 
        !w.operator.toLowerCase().includes(search.toLowerCase()) &&
        !w.county.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (!mounted) return <div className="h-full flex items-center justify-center text-slate-500">Loading map...</div>;

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center gap-3 p-3 bg-slate-800/50 border-b border-slate-700">
        <input
          className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-slate-500 w-64"
          placeholder="Search wells, operators, counties..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-1">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                filter === s ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-400">{filtered.length} wells</span>
      </div>

      {/* Map + Detail */}
      <div className="flex-1 flex">
        <div ref={mapRef} className="flex-1" style={{ minHeight: 500 }} />
        {selected && (
          <div className="w-80 bg-slate-800 border-l border-slate-700 p-4 overflow-y-auto">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-sm font-bold text-white">{selected.wellName}</h3>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white text-lg">×</button>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ['API', selected.apiNumber],
                ['Operator', selected.operator],
                ['County', selected.county],
                ['Status', selected.status],
                ['Type', selected.wellType || 'N/A'],
                ['Field', selected.field || 'N/A'],
                ['Formation', selected.formation || 'N/A'],
                ['First Prod', selected.firstProdDate || 'N/A'],
                ['Cum Oil', selected.totalOil ? `${(selected.totalOil/1000).toFixed(0)}K bbl` : 'N/A'],
                ['Cum Gas', selected.totalGas ? `${(selected.totalGas/1000).toFixed(0)}K mcf` : 'N/A'],
                ['Lat', selected.latitude?.toFixed(6)],
                ['Lon', selected.longitude?.toFixed(6)],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between">
                  <span className="text-slate-400">{k}</span>
                  <span className="text-white font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 p-2 bg-slate-800/50 border-t border-slate-700">
        {Object.entries(STATUS_COLORS).map(([status, color]) => {
          const count = wells.filter(w => w.status === status).length;
          if (count === 0) return null;
          return (
            <div key={status} className="flex items-center gap-1.5 text-xs">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-slate-400">{status}: {count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
