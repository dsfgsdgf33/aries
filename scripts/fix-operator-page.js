
const fs = require('fs');
const path = require('path');

const content = `'use client';
import { useState, useCallback } from 'react';

interface Well {
  api: string;
  name: string;
  operator: string;
  county: string;
  state: string;
  lat: number;
  lng: number;
  status: string;
  formation: string;
  cumOil: number;
  cumGas: number;
  cumWater: number;
  depth: number;
  production: { month: string; oil: number; gas: number; water: number }[];
}

interface DeclineResult {
  apiNumber: string;
  analysisType: string;
  initialRate: number;
  initialDecline: number;
  bFactor: number;
  forecast: { month: number; rate: number; cumulative: number }[];
  eur: number;
  r2: number;
}

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(Number(n))) return '0';
  const v = Number(n);
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toLocaleString();
}

export default function OperatorPage() {
  const [tab, setTab] = useState<'wells' | 'shalexp' | 'rrc' | 'decline'>('wells');
  const [operator, setOperator] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Well[]>([]);
  const [declineResults, setDeclineResults] = useState<DeclineResult[]>([]);
  const [selected, setSelected] = useState<Well | null>(null);
  const [source, setSource] = useState('');
  const [wellFilter, setWellFilter] = useState('');
  const [countyFilter, setCountyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const searchShaleXP = useCallback(async () => {
    if (!operator.trim()) return;
    setLoading(true); setError(''); setResults([]); setSource('');
    try {
      const res = await fetch('/api/rrc/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: operator.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      setResults(data.wells || []);
      setSource(data.meta?.source || 'ShaleXP');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [operator]);

  const searchRRC = useCallback(async () => {
    if (!operator.trim()) return;
    setLoading(true); setError(''); setResults([]); setSource('');
    try {
      const res = await fetch('/api/rrc/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: operator.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      setResults(data.wells || []);
      setSource(data.meta?.source || 'RRC');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [operator]);

  const loadWells = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (wellFilter) params.set('query', wellFilter);
      if (countyFilter) params.set('county', countyFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch('/api/wells?' + params.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setResults(data.wells || []);
      setSource('Local Database (' + (data.total || data.wells?.length || 0) + ' total)');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [wellFilter, countyFilter, statusFilter]);

  const runDecline = useCallback(async () => {
    if (results.length === 0) { setError('Load wells first from Browse tab'); return; }
    setLoading(true); setError(''); setDeclineResults([]);
    try {
      const wellsForDCA = results.slice(0, 20).map(w => ({
        apiNumber: w.api,
        initialRate: w.production?.[0]?.oil || 500,
        initialDecline: 0.08,
        bFactor: 1.2,
        analysisType: 'hybrid',
      }));
      const res = await fetch('/api/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wells: wellsForDCA }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Decline analysis failed');
      setDeclineResults(data.results || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [results]);

  const tabs = [
    { id: 'wells' as const, label: 'Browse Wells', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
    { id: 'shalexp' as const, label: 'ShaleXP Search', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
    { id: 'rrc' as const, label: 'RRC Direct', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { id: 'decline' as const, label: 'Decline Analysis', icon: 'M13 17h8m0 0V9m0 8l-8-8-4 4-6-6' },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary, #e2e8f0)' }}>
        Operator Analysis
      </h1>
      <p style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 14, marginBottom: 24 }}>
        Search operators, browse wells, and run decline curve analysis
      </p>

      {/* Tabs */}
      <div className="tab-bar" style={{ marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t.id} className={'tab-item' + (tab === t.id ? ' active' : '')}
            onClick={() => { setTab(t.id); setError(''); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:6}}>
              <path d={t.icon}/>
            </svg>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search bar — ShaleXP / RRC */}
      {(tab === 'shalexp' || tab === 'rrc') && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <input className="input-field" style={{ flex: 1 }}
              placeholder="Enter operator name (e.g. Pioneer, Diamondback, Chevron)..."
              value={operator} onChange={e => setOperator(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (tab === 'shalexp' ? searchShaleXP() : searchRRC())}
            />
            <button className="btn btn-primary"
              onClick={tab === 'shalexp' ? searchShaleXP : searchRRC}
              disabled={loading || !operator.trim()}>
              {loading ? 'Searching...' : tab === 'shalexp' ? 'Search ShaleXP' : 'Query RRC'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            {tab === 'shalexp'
              ? 'Queries ShaleXP premium database. Falls back to local data if scraper unavailable.'
              : 'Queries Texas RRC EWA directly. Falls back to local data if RRC unavailable.'}
          </p>
        </div>
      )}

      {/* Filter bar — Wells */}
      {tab === 'wells' && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input className="input-field" style={{ flex: 1, minWidth: 200 }}
              placeholder="Search by name, API, operator..." value={wellFilter}
              onChange={e => setWellFilter(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadWells()} />
            <input className="input-field" style={{ width: 150 }}
              placeholder="County..." value={countyFilter}
              onChange={e => setCountyFilter(e.target.value)} />
            <select className="input-field" style={{ width: 150 }}
              value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="Active">Active</option>
              <option value="Shut-in">Shut-in</option>
              <option value="P&A">P&A</option>
              <option value="Drilling">Drilling</option>
              <option value="Completed">Completed</option>
            </select>
            <button className="btn btn-primary" onClick={loadWells} disabled={loading}>
              {loading ? 'Loading...' : 'Load Wells'}
            </button>
          </div>
        </div>
      )}

      {/* Decline controls */}
      {tab === 'decline' && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Decline Curve Analysis</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Runs exponential/hyperbolic/harmonic DCA on up to 20 wells. Load wells from Browse tab first.
              </p>
            </div>
            <button className="btn btn-primary" onClick={runDecline}
              disabled={loading || results.length === 0}>
              {loading ? 'Analyzing...' : 'Run DCA (' + Math.min(results.length, 20) + ' wells)'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#f87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Source badge */}
      {source && results.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span className="badge badge-green">{source}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {results.length} wells loaded
          </span>
        </div>
      )}

      {/* Main content */}
      <div style={{ display: 'flex', gap: 20, minHeight: 500 }}>
        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {tab !== 'decline' && results.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>API</th>
                    <th>Well Name</th>
                    <th>Operator</th>
                    <th>County</th>
                    <th>Status</th>
                    <th style={{textAlign:'right'}}>Cum Oil</th>
                    <th style={{textAlign:'right'}}>Cum Gas</th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 200).map((w, i) => (
                    <tr key={w.api || i} onClick={() => setSelected(w)}
                      style={{ cursor: 'pointer', background: selected?.api === w.api ? 'rgba(59,130,246,0.12)' : undefined }}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{w.api}</td>
                      <td>{w.name}</td>
                      <td>{w.operator}</td>
                      <td>{w.county}</td>
                      <td>
                        <span className={'badge ' + (
                          w.status === 'Active' ? 'badge-green' :
                          w.status === 'Shut-in' ? 'badge-yellow' :
                          w.status === 'Drilling' ? 'badge-blue' : 'badge-red'
                        )}>{w.status}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmt(w.cumOil)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(w.cumGas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.length > 200 && (
                <p style={{ textAlign: 'center', padding: 12, color: 'var(--text-secondary)', fontSize: 12 }}>
                  Showing 200 of {results.length.toLocaleString()} wells
                </p>
              )}
            </div>
          )}

          {/* Decline results */}
          {tab === 'decline' && declineResults.length > 0 && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>API</th>
                    <th>Type</th>
                    <th style={{textAlign:'right'}}>Qi (bbl/d)</th>
                    <th style={{textAlign:'right'}}>Di</th>
                    <th style={{textAlign:'right'}}>b</th>
                    <th style={{textAlign:'right'}}>EUR (bbl)</th>
                    <th style={{textAlign:'right'}}>R2</th>
                  </tr>
                </thead>
                <tbody>
                  {declineResults.map((d, i) => (
                    <tr key={d.apiNumber || i}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.apiNumber}</td>
                      <td><span className="badge badge-blue">{d.analysisType}</span></td>
                      <td style={{ textAlign: 'right' }}>{fmt(d.initialRate)}</td>
                      <td style={{ textAlign: 'right' }}>{((d.initialDecline || 0) * 100).toFixed(1)}%</td>
                      <td style={{ textAlign: 'right' }}>{(d.bFactor || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: '#22c55e' }}>{fmt(d.eur)}</td>
                      <td style={{ textAlign: 'right' }}>{(d.r2 || 0).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state */}
          {results.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-secondary)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 16 }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary, #e2e8f0)' }}>
                {tab === 'wells' ? 'Click "Load Wells" to browse the database' :
                 tab === 'decline' ? 'Load wells first, then run decline analysis' :
                 'Enter an operator name and search'}
              </p>
              <p style={{ fontSize: 13 }}>
                {tab === 'wells' ? '4,370 wells across 17 Permian Basin counties' :
                 tab === 'shalexp' ? 'Searches ShaleXP premium with local fallback' :
                 tab === 'rrc' ? 'Queries Texas RRC EWA with local fallback' :
                 'Exponential, hyperbolic, harmonic DCA with EUR estimation'}
              </p>
            </div>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <div className="shimmer" style={{ width: 40, height: 40, borderRadius: '50%', margin: '0 auto 16px' }}></div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading...</p>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selected && tab !== 'decline' && (
          <div className="card" style={{ width: 360, flexShrink: 0, overflow: 'auto',
            maxHeight: 'calc(100vh - 200px)', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Well Detail</h3>
              <button onClick={() => setSelected(null)} className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: 12 }}>Close</button>
            </div>

            <div className="detail-section">
              {[
                ['API', selected.api, true],
                ['Name', selected.name, false],
                ['Operator', selected.operator, false],
                ['County', selected.county, false],
                ['State', selected.state || 'TX', false],
                ['Formation', selected.formation, false],
                ['Depth', fmt(selected.depth) + ' ft', false],
                ['Location', (selected.lat?.toFixed(4) || '-') + ', ' + (selected.lng?.toFixed(4) || '-'), true],
              ].map(([label, value, mono]) => (
                <div className="detail-row" key={String(label)}>
                  <span className="detail-label">{String(label)}</span>
                  <span className="detail-value" style={mono ? { fontFamily: 'monospace', fontSize: 12 } : undefined}>
                    {String(value)}
                  </span>
                </div>
              ))}
              <div className="detail-row">
                <span className="detail-label">Status</span>
                <span className={'badge ' + (
                  selected.status === 'Active' ? 'badge-green' :
                  selected.status === 'Shut-in' ? 'badge-yellow' : 'badge-red'
                )}>{selected.status}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 16 }}>
              <div className="stat-card" style={{ padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Oil</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#22c55e' }}>{fmt(selected.cumOil)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>bbl</div>
              </div>
              <div className="stat-card" style={{ padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Gas</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#3b82f6' }}>{fmt(selected.cumGas)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>mcf</div>
              </div>
              <div className="stat-card" style={{ padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>Water</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#a78bfa' }}>{fmt(selected.cumWater)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>bbl</div>
              </div>
            </div>

            {selected.production && selected.production.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                  Monthly Production ({selected.production.length} months)
                </h4>
                <div style={{ maxHeight: 200, overflow: 'auto' }}>
                  <table className="data-table" style={{ fontSize: 11 }}>
                    <thead><tr><th>Month</th><th style={{textAlign:'right'}}>Oil</th><th style={{textAlign:'right'}}>Gas</th></tr></thead>
                    <tbody>
                      {selected.production.map((p, i) => (
                        <tr key={i}>
                          <td>{p.month}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(p.oil)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(p.gas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
`;

const fp = path.join(__dirname, '..', 'app', 'operator', 'page.tsx');
fs.writeFileSync(fp, content);
console.log('Wrote', fp, fs.statSync(fp).size, 'bytes');
const verify = fs.readFileSync(fp, 'utf8');
console.log('Verified. Has searchShaleXP:', verify.includes('searchShaleXP'));
console.log('Has loadWells:', verify.includes('loadWells'));
console.log('Has runDecline:', verify.includes('runDecline'));
console.log('Has tab-bar:', verify.includes('tab-bar'));
