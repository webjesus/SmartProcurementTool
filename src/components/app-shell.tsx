"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Boxes,
  CircleHelp,
  CheckSquare2,
  ClipboardCheck,
  FileOutput,
  FileSearch,
  Files,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Scale,
  Settings2
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { ProcessingPanel } from "@/components/processing-panel";
import { useDecisionIdentity } from "@/components/decision-identity";

const developerNav = [
  { href: "/", label: "Projektübersicht", icon: LayoutDashboard },
  { href: "/dokumente", label: "Dokumente", icon: Files },
  { href: "/gefundene-daten", label: "Gefundene Daten", icon: FileSearch },
  { href: "/pruefung", label: "Prüfung", icon: ClipboardCheck, count: 3 },
  { href: "/zuordnung", label: "Zuordnung", icon: Boxes, count: 2 },
  { href: "/lv-vergleich", label: "LV-Vergleich", icon: Scale },
  { href: "/entscheidungen", label: "Entscheidungen", icon: CheckSquare2, count: 4 },
  { href: "/export", label: "Export", icon: FileOutput }
];

const liveNav = [
  {
    href: "/lv-vergleich",
    label: "LV-Vergleich",
    icon: Scale,
    count: undefined
  }
];

const PROJECT_SIDEBAR_KEY = "spt.browser.sidebar-expanded";
const PROJECT_SIDEBAR_EVENT = "spt:browser-sidebar";

function subscribeProjectSidebar(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(PROJECT_SIDEBAR_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(PROJECT_SIDEBAR_EVENT, listener);
  };
}

function projectSidebarSnapshot() {
  return window.localStorage.getItem(PROJECT_SIDEBAR_KEY) === "true";
}

export function AppShell({
  children,
  devUiEnabled,
  browserLocal
}: {
  children: React.ReactNode;
  devUiEnabled: boolean;
  browserLocal: boolean;
}) {
  const pathname = usePathname();
  const identity = useDecisionIdentity();
  const projectSidebarExpanded = useSyncExternalStore(
    subscribeProjectSidebar,
    projectSidebarSnapshot,
    () => false
  );
  function toggleProjectSidebar() {
    window.localStorage.setItem(
      PROJECT_SIDEBAR_KEY,
      String(!projectSidebarExpanded)
    );
    window.dispatchEvent(new Event(PROJECT_SIDEBAR_EVENT));
  }
  if (browserLocal && pathname.startsWith("/projects")) {
    return (
      <div
        className="browser-project-frame"
        data-sidebar-expanded={projectSidebarExpanded}
      >
        <aside className="browser-project-sidebar">
          <Link href="/projects" className="browser-sidebar-logo" aria-label="Projekte">
            <Building2 size={28} strokeWidth={1.8} />
            <span>Smart Procurement</span>
          </Link>
          <button
            type="button"
            className="browser-sidebar-toggle"
            aria-label={
              projectSidebarExpanded
                ? "Navigation reduzieren"
                : "Navigation erweitern"
            }
            aria-expanded={projectSidebarExpanded}
            onClick={toggleProjectSidebar}
          >
            {projectSidebarExpanded ? (
              <PanelLeftClose size={19} />
            ) : (
              <PanelLeftOpen size={19} />
            )}
            <span>
              {projectSidebarExpanded ? "Reduzieren" : "Navigation"}
            </span>
          </button>
          <nav aria-label="Projektnavigation">
            <Link
              href="/projects"
              className={pathname === "/projects" ? "active" : ""}
              aria-label="Projekte"
            >
              <Files size={20} />
              <span>Projekte</span>
            </Link>
            <Link href="/projects/settings" aria-label="Einstellungen">
              <Settings2 size={20} />
              <span>Einstellungen</span>
            </Link>
            <Link href="/projects/help" aria-label="Info und Hilfe">
              <CircleHelp size={20} />
              <span>Hilfe</span>
            </Link>
          </nav>
        </aside>
        <main className="browser-project-main">{children}</main>
      </div>
    );
  }
  const nav = devUiEnabled ? developerNav : liveNav;
  const initials = identity.user?.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("de"))
    .join("") || "—";
  return (
    <div className={`app-frame ${devUiEnabled ? "dev-shell" : "live-shell"}`}>
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
          <strong>{devUiEnabled ? "Projektansicht" : "Heizung LV-Vergleich"}</strong>
          <small>{devUiEnabled ? "Entwicklungsmodus" : "Lokaler Arbeitsmodus"}</small>
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
            <span>{devUiEnabled ? "Projektansicht" : "Heizung"}</span>
            <i>/</i>
            <strong>{nav.find((item) => item.href === pathname)?.label ?? "Smart Procurement Tool"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="system-state"><i /> Systeme bereit</span>
            {identity.enabled && identity.user ? (
              <span className="decision-user-label">
                Bearbeitet von: <strong>{identity.user.displayName}</strong>
              </span>
            ) : null}
            <button className="avatar" aria-label="Operatorprofil">{initials}</button>
          </div>
        </header>
        <div className="page-content">
          {devUiEnabled ? <ProcessingPanel /> : null}
          {children}
        </div>
      </main>
    </div>
  );
}
