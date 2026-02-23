"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Network, Layers, ShieldCheck, Database,
  ScrollText, Lock, Code2
} from "lucide-react";

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/aas-explorer', label: 'AAS Explorer', icon: Network },
  { href: '/compliance-center', label: 'Compliance Center', icon: ShieldCheck },
  { href: '/ingestion', label: 'Data Ingestion', icon: Database },
  { href: '/audit', label: 'Audit Trail', icon: ScrollText },
  { href: '/security', label: 'Security & RBAC', icon: Lock },
  { href: '/digdev', label: 'DigDev Panel', icon: Code2 },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 h-screen bg-card border-r border-border flex flex-col fixed left-0 top-0 z-40">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-emerald-400/20 flex items-center justify-center">
            <Layers size={18} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-none">Permian AAS</h1>
            <p className="text-[10px] text-emerald-400">Studio</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {nav.map(item => {
          const active = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link key={item.href} href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-emerald-400/10 text-emerald-400 font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}>
              <item.icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-emerald-400/10 flex items-center justify-center text-emerald-400 text-[10px] font-bold">JM</div>
          <div>
            <p className="text-xs font-medium">Jay Martinez</p>
            <p className="text-[10px] text-muted-foreground">Admin</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// Default export for layout.tsx
export default Sidebar;