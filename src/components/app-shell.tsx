"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck,
  Calculator,
  ChevronRight,
  FileOutput,
  Files,
  FolderArchive,
  FolderPlus,
  MailPlus,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Scale,
  X
} from "lucide-react";
import { useState } from "react";
import { useDecisionIdentity } from "@/components/decision-identity";
import { ProcessingPanel } from "@/components/processing-panel";
import { ThemeControl } from "@/components/theme-control";
import {
  GLOBAL_NAVIGATION,
  globalNavigationItemForPath,
  type GlobalNavigationItem
} from "@/navigation/global-navigation";

const icons: Record<GlobalNavigationItem["id"], typeof Files> = {
  library: BookOpenCheck,
  projects: Files,
  "new-project": FolderPlus,
  pdf: FileOutput,
  email: MailPlus,
  revision: FolderArchive,
  "own-lv": Calculator
};

function activeFor(pathname: string, item: GlobalNavigationItem) {
  return globalNavigationItemForPath(pathname)?.id === item.id;
}

function Navigation({
  pathname,
  close
}: {
  pathname: string;
  close(): void;
}) {
  return (
    <nav className="wb-navigation" aria-label="Hauptnavigation">
      <span className="wb-nav-heading">ARBEITSBEREICH</span>
      {GLOBAL_NAVIGATION.slice(0, 3).map((item) => {
        const Icon = icons[item.id];
        return (
          <Link
            key={item.id}
            href={item.href}
            title={item.label}
            className={activeFor(pathname, item) ? "active" : ""}
            onClick={close}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{item.label}</span>
            {item.id === "new-project" ? <Plus size={15} /> : null}
          </Link>
        );
      })}
      <span className="wb-nav-heading wb-nav-heading-tools">WERKZEUGE</span>
      {GLOBAL_NAVIGATION.slice(3).map((item) => {
        const Icon = icons[item.id];
        return (
          <Link
            key={item.id}
            href={item.href}
            title={item.label}
            className={activeFor(pathname, item) ? "active" : ""}
            onClick={close}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function isProjectWorkspacePath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  return (
    segments[0] === "projects" &&
    Boolean(segments[1]) &&
    segments[1] !== "new" &&
    segments.length >= 3
  );
}

export function isLvWorkspacePath(pathname: string): boolean {
  return pathname === "/lv-vergleich" || pathname.endsWith("/lv-vergleich");
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
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [workspaceNavigationExpanded, setWorkspaceNavigationExpanded] =
    useState(false);
  const current = globalNavigationItemForPath(pathname);
  const focusedWorkspace =
    isProjectWorkspacePath(pathname) || isLvWorkspacePath(pathname);
  const lvWorkspace = isLvWorkspacePath(pathname);
  const workspaceNavigation = focusedWorkspace
    ? workspaceNavigationExpanded
      ? "expanded"
      : "compact"
    : "standard";
  const initials =
    identity.user?.displayName
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("de"))
      .join("") || "WB";

  return (
    <div
      className="wb-app-frame"
      data-mobile-nav={mobileNavigation}
      data-workspace-nav={workspaceNavigation}
      data-lv-workspace={lvWorkspace}
    >
      <aside className="wb-sidebar">
        <div className="wb-brand-block">
          <Link
            href="/"
            className="wb-brand"
            aria-label="Weinbuch Produktbibliothek"
          >
            <span className="wb-brand-image">
              <Image
                src="/weinbuch-logo.png"
                alt="Weinbuch Logo"
                width={130}
                height={45}
                priority
              />
            </span>
            <span className="wb-brand-product">
              <strong>Smart Procurement</strong>
              <small>TECHNICAL LEDGER</small>
            </span>
          </Link>
          {focusedWorkspace ? (
            <button
              type="button"
              className="wb-workspace-nav-toggle"
              aria-label={
                workspaceNavigationExpanded
                  ? "Navigation minimieren"
                  : "Navigation erweitern"
              }
              title={
                workspaceNavigationExpanded
                  ? "Navigation minimieren"
                  : "Navigation erweitern"
              }
              onClick={() =>
                setWorkspaceNavigationExpanded((expanded) => !expanded)
              }
            >
              {workspaceNavigationExpanded ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="wb-mobile-close"
            aria-label="Navigation schließen"
            onClick={() => setMobileNavigation(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="wb-spine-label">
          <span />
          <p>
            <strong>WEINBUCH WERKSTATT</strong>
            <small>Beschaffung · Dokumente · Entscheidungen</small>
          </p>
        </div>

        <Navigation
          pathname={pathname}
          close={() => setMobileNavigation(false)}
        />

        <div className="wb-sidebar-footer">
          <Link href="/projects">
            <Scale size={17} />
            <span>
              <strong>Projektarbeitsplatz</strong>
              <small>Projekt auswählen</small>
            </span>
            <ChevronRight size={15} />
          </Link>
          <p>
            <i />
            Lokal gespeichert
          </p>
        </div>
      </aside>

      {mobileNavigation ? (
        <button
          type="button"
          className="wb-mobile-backdrop"
          aria-label="Navigation schließen"
          onClick={() => setMobileNavigation(false)}
        />
      ) : null}

      <main className="wb-main">
        <header className="wb-topbar">
          <div className="wb-topbar-context">
            <button
              type="button"
              className="wb-mobile-menu"
              aria-label="Navigation öffnen"
              onClick={() => setMobileNavigation(true)}
            >
              <Menu size={20} />
            </button>
            <span>Smart Procurement</span>
            <ChevronRight size={14} />
            <strong>{current?.label ?? "Projektarbeitsbereich"}</strong>
          </div>
          <div className="wb-topbar-actions">
            <span className="wb-build-state">
              <i /> Arbeitsbereich
            </span>
            <ThemeControl />
            {identity.enabled && identity.user ? (
              <span className="wb-operator-name">
                Bearbeitet von <strong>{identity.user.displayName}</strong>
              </span>
            ) : null}
            <button
              type="button"
              className="wb-avatar"
              aria-label="Operatorprofil"
            >
              {initials}
            </button>
          </div>
        </header>
        <div className="wb-page-content">
          {devUiEnabled && !browserLocal ? <ProcessingPanel /> : null}
          {children}
        </div>
      </main>
    </div>
  );
}
