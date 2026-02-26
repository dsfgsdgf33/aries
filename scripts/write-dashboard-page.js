
const fs = require('fs');
const code = `'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Stats {
  totalWells: number;
  totalOperators: number;
  totalCounties: number;
  totalFormations: number;
  avgCumOil: number;
  avgCumGas: number;
  totalCumOil: number;
  totalCumGas: number;
  byStatus: Record<string, number>;
  byCounty: Record<string, number>;
  byOperator: Record<string, number>;
  topCounties: { name: string; count: number }[];
  topOperators: { name: string; count: number }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const fmt = (n: number | undefined | null): string => {
    if (n === undefined || n === null || isNaN(n)) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0a0e17', color: '#e2e8f0'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, border: '3px solid #1e3a5f',
            borderTopColor: '#3b82f6', borderRadius: '50%',
            animation: 'spin 1s linear infinite', margin: '0 auto 16px'
          }} />
          <p style={{ fontSize: 18 }}>Loading Permian Basin data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0a0e17', color: '#ef4444'
      }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Wells', value: fmt(stats?.totalWells), icon: '\\u{1F6E2}', color: '#3b82f6', sub: 'Permian Basin' },
    { label: 'Operators', value: fmt(stats?.totalOperators), icon: '\\u{1F3ED}', color: '#8b5cf6', sub: 'Active companies' },
    { label: 'Counties', value: fmt(stats?.totalCounties), icon: '\\u{1F4CD}', color: '#10b981', sub: 'TX & NM' },
    { label: 'Formations', value: fmt(stats?.totalFormations), icon: '\\u{1F30D}', color: '#f59e0b', sub: 'Geological targets' },
    { label: 'Cum. Oil', value: fmt(stats?.totalCumOil) + ' bbl', icon: '\\u{1F4C8}', color: '#ef4444', sub: 'Total production' },
    { label: 'Cum. Gas', value: fmt(stats?.totalCumGas) + ' mcf', icon: '\\u{1F525}', color: '#06b6d4', sub: 'Total production' },
  ];

  const quickActions = [
    { title: 'Well Map', desc: 'Interactive Leaflet map with 4,370+ wells', href: '/map', icon: '\\u{1F5FA}', gradient: 'linear-gradient(135deg, #1e40af, #3b82f6)' },
    { title: 'Data Model', desc: 'Query ShaleXP + RRC, normalize & merge', href: '/data-model', icon: '\\u{1F50D}', gradient: 'linear-gradient(135deg, #7c3aed, #8b5cf6)' },
    { title: 'Operators', desc: 'Search operators, view wells & decline curves', href: '/operator', icon: '\\u{1F3E2}', gradient: 'linear-gradient(135deg, #059669, #10b981)' },
    { title: 'AAS Explorer', desc: 'IEC 63278 Asset Administration Shell', href: '/aas-explorer', icon: '\\u{1F3D7}', gradient: 'linear-gradient(135deg, #d97706, #f59e0b)' },
  ];

  const dataSources = [
    { name: 'Texas RRC (EWA)', status: 'Live', desc: 'Railroad Commission electronic well data', color: '#10b981' },
    { name: 'ShaleXP Premium', status: 'Live', desc: 'Premium well search & production data', color: '#10b981' },
    { name: 'Local Database', status: 'Active', desc: '4,370 wells with 12-month production history', color: '#3b82f6' },
    { name: 'CSV/TSV Upload', status: 'Ready', desc: 'Import custom well data files', color: '#f59e0b' },
  ];

  const statusColors: Record<string, string> = {
    Active: '#10b981', 'Shut-in': '#f59e0b', Plugged: '#ef4444',
    Drilling: '#3b82f6', Permitted: '#8b5cf6', Completed: '#06b6d4',
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
          Permian Basin AAS Studio
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 4 }}>
          Asset Administration Shell \\u{00B7} Real-time well data \\u{00B7} IEC 63278 compliant
        </p>
      </div>

      {/* Stat Cards */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16, marginBottom: 32
      }}>
        {statCards.map((c, i) => (
          <div key={i} style={{
            background: '#111827', border: '1px solid #1e3a5f',
            borderRadius: 12, padding: '20px 24px',
            borderTop: \`3px solid \${c.color}\`,
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = \`0 8px 25px \${c.color}20\`; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>{c.label}</p>
                <p style={{ color: '#f1f5f9', fontSize: 28, fontWeight: 700, margin: '8px 0 4px' }}>{c.value}</p>
                <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>{c.sub}</p>
              </div>
              <span style={{ fontSize: 32 }}>{c.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9', marginBottom: 16 }}>Quick Actions</h2>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16, marginBottom: 32
      }}>
        {quickActions.map((a, i) => (
          <Link key={i} href={a.href} style={{ textDecoration: 'none' }}>
            <div style={{
              background: a.gradient, borderRadius: 12, padding: '24px',
              cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s',
              minHeight: 120, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 12px 30px rgba(0,0,0,0.4)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
            >
              <span style={{ fontSize: 36, marginBottom: 12 }}>{a.icon}</span>
              <div>
                <p style={{ color: '#fff', fontSize: 18, fontWeight: 600, margin: 0 }}>{a.title}</p>
                <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, margin: '4px 0 0' }}>{a.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Bottom row: Data Sources + Status Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Data Sources */}
        <div style={{
          background: '#111827', border: '1px solid #1e3a5f',
          borderRadius: 12, padding: 24
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#f1f5f9', margin: '0 0 16px' }}>Data Sources</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {dataSources.map((s, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', background: '#0d1117', borderRadius: 8,
                border: '1px solid #1e293b'
              }}>
                <div>
                  <p style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 500, margin: 0 }}>{s.name}</p>
                  <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 0' }}>{s.desc}</p>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: \`\${s.color}20\`, color: s.color, border: \`1px solid \${s.color}40\`
                }}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status Distribution */}
        <div style={{
          background: '#111827', border: '1px solid #1e3a5f',
          borderRadius: 12, padding: 24
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#f1f5f9', margin: '0 0 16px' }}>Well Status Distribution</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stats?.byStatus && Object.entries(stats.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count], i) => {
                const pct = stats.totalWells ? (count / stats.totalWells * 100) : 0;
                const barColor = statusColors[status] || '#64748b';
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: '#e2e8f0', fontSize: 13 }}>{status}</span>
                      <span style={{ color: '#94a3b8', fontSize: 13 }}>{count.toLocaleString()} ({pct.toFixed(1)}%)</span>
                    </div>
                    <div style={{
                      height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden'
                    }}>
                      <div style={{
                        height: '100%', width: pct + '%', background: barColor,
                        borderRadius: 4, transition: 'width 0.8s ease'
                      }} />
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Top Counties */}
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', margin: '24px 0 12px' }}>Top Counties</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {stats?.topCounties?.slice(0, 8).map((c, i) => (
              <span key={i} style={{
                padding: '6px 12px', borderRadius: 20, fontSize: 12,
                background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155'
              }}>
                {c.name}: {c.count}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <div style={{
        marginTop: 32, padding: '20px 24px', background: '#111827',
        border: '1px solid #1e3a5f', borderRadius: 12,
        display: 'flex', gap: 12, flexWrap: 'wrap'
      }}>
        {[
          { href: '/submodels', label: 'Submodels' },
          { href: '/ingestion', label: 'Data Ingestion' },
          { href: '/map', label: 'Well Map' },
        ].map((l, i) => (
          <Link key={i} href={l.href} style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155',
            textDecoration: 'none', transition: 'background 0.2s'
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#334155'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#1e293b'; }}
          >
            {l.label}
          </Link>
        ))}
      </div>

      <style>{\`
        @keyframes spin { to { transform: rotate(360deg); } }
      \`}</style>
    </div>
  );
}
`;
fs.writeFileSync('app/page.tsx', code);
console.log('Dashboard page written:', code.length, 'chars');
`;
fs.writeFileSync('scripts/write-dashboard-page.js', code);
console.log('Script written');
