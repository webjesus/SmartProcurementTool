"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  CheckSquare2,
  ClipboardCheck,
  FileOutput,
  FileSearch,
  Files,
  LayoutDashboard,
  Scale,
  Settings2
} from "lucide-react";
import { project } from "@/lib/demo-data";

const nav = [
  { href: "/", label: "Projektübersicht", icon: LayoutDashboard },
  { href: "/dokumente", label: "Dokumente", icon: Files },
  { href: "/gefundene-daten", label: "Gefundene Daten", icon: FileSearch },
  { href: "/pruefung", label: "Prüfung", icon: ClipboardCheck, count: 3 },
  { href: "/zuordnung", label: "Zuordnung", icon: Boxes, count: 2 },
  { href: "/lv-vergleich", label: "LV-Vergleich", icon: Scale },
  { href: "/entscheidungen", label: "Entscheidungen", icon: CheckSquare2, count: 4 },
  { href: "/export", label: "Export", icon: FileOutput }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SPT</div>
          <div>
            <strong>Smart Procurement</strong>
            <span>WEINBUCH</span>
          </div>
        </div>
        <div className="sidebar-project">
          <span>AKTIVES PROJEKT</span>
          <strong>{project.name}</strong>
          <small>{project.reference}</small>
        </div>
        <nav className="main-nav" aria-label="Hauptnavigation">
          {nav.map(({ href, label, icon: Icon, count }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={active ? "active" : ""}>
                <Icon size={17} strokeWidth={1.8} />
                <span>{label}</span>
                {count ? <b>{count}</b> : null}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <Settings2 size={17} />
          <div>
            <strong>Lokaler Arbeitsmodus</strong>
            <small>Corpus bleibt auf diesem Gerät</small>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{project.reference}</span>
            <i>/</i>
            <strong>{nav.find((item) => item.href === pathname)?.label ?? "Smart Procurement Tool"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="system-state"><i /> Systeme bereit</span>
            <button className="avatar" aria-label="Operatorprofil">NK</button>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
