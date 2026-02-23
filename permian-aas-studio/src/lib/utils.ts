import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function statusColor(status: string) {
  switch (status) {
    case 'COMPLIANT': case 'APPROVED': case 'ACTIVE': return 'text-emerald-400';
    case 'PARTIAL': case 'PENDING': case 'DRAFT': return 'text-amber-400';
    case 'NON_COMPLIANT': case 'REJECTED': case 'ERROR': return 'text-red-400';
    default: return 'text-zinc-400';
  }
}
// Alias used by some pages
export const getStatusColor = statusColor;

export function statusBg(status: string) {
  switch (status) {
    case 'COMPLIANT': case 'APPROVED': case 'ACTIVE': return 'bg-emerald-400/10 border-emerald-400/30';
    case 'PARTIAL': case 'PENDING': case 'DRAFT': return 'bg-amber-400/10 border-amber-400/30';
    case 'NON_COMPLIANT': case 'REJECTED': case 'ERROR': return 'bg-red-400/10 border-red-400/30';
    default: return 'bg-zinc-400/10 border-zinc-400/30';
  }
}

export function assetIcon(type: string) {
  switch (type) {
    case 'BASIN': return '🌍';
    case 'FIELD': return '🏗️';
    case 'LEASE': return '📋';
    case 'PAD': return '🔲';
    case 'WELL': return '🛢️';
    case 'EQUIPMENT': return '⚙️';
    default: return '📦';
  }
}
export const getAssetIcon = assetIcon;

export function getEventIcon(type: string) {
  if (type.includes('CREATED')) return '📝';
  if (type.includes('SUBMITTED')) return '📤';
  if (type.includes('APPROVED')) return '✅';
  if (type.includes('REJECTED')) return '❌';
  if (type.includes('VIOLATION') || type.includes('SOD')) return '🚫';
  if (type.includes('INGESTION')) return '📥';
  if (type.includes('VERSION')) return '🔄';
  if (type.includes('ALERT') || type.includes('COMPLIANCE')) return '⚠️';
  return '📌';
}

export function timeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date('2026-02-22T21:30:00Z');
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function staleness(dateStr: string): 'FRESH' | 'STALE' | 'CRITICAL' {
  const d = new Date(dateStr);
  const now = new Date('2026-02-22T21:30:00Z');
  const hrs = (now.getTime() - d.getTime()) / 3600000;
  if (hrs < 24) return 'FRESH';
  if (hrs < 72) return 'STALE';
  return 'CRITICAL';
}