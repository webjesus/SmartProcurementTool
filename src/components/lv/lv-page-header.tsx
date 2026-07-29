"use client";

import { FileDown, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import {
  WarningCenter,
  type LvWarning
} from "@/components/lv/warning-center";

export function LvPageHeader({
  warnings,
  warningOpen,
  onToggleWarnings,
  onSelectWarning
}: {
  warnings: LvWarning[];
  warningOpen: boolean;
  onToggleWarnings: () => void;
  onSelectWarning: (warning: LvWarning) => void;
}) {
  return (
    <header className="lv-page-header">
      <div>
        <span>Smart Procurement Tool</span>
        <h1>Heizung LV-Vergleich</h1>
      </div>
      <div>
        <WarningCenter
          warnings={warnings}
          open={warningOpen}
          onToggle={onToggleWarnings}
          onClose={onToggleWarnings}
          onSelect={onSelectWarning}
        />
        <Link className="button button-secondary" href="/api/export?format=xlsx">
          <FileDown size={16} /> Excel export
        </Link>
        <Link className="button button-secondary" href="/api/export?format=pdf">
          <FileDown size={16} /> PDF export
        </Link>
        <Link className="button button-secondary" href="/api/review-package?format=json">
          Review-Paket
        </Link>
        <button className="icon-button" aria-label="Weitere Aktionen">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </header>
  );
}
