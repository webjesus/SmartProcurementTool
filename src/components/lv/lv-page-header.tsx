"use client";

import { ArrowLeft, ChevronDown, FileDown, FilePlus2, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { WarningCenter, type LvWarning } from "@/components/lv/warning-center";

export function LvPageHeader({
  warnings,
  warningOpen,
  onToggleWarnings,
  onSelectWarning,
  onExportExcel,
  onExportPdf,
  selectedCount = 0,
  totalCount = 0,
  projectContext,
  disciplineLabel = "Heizung",
  utilityActions
}: {
  warnings: LvWarning[];
  warningOpen: boolean;
  onToggleWarnings: () => void;
  onSelectWarning: (warning: LvWarning) => void;
  onExportExcel?: () => void;
  onExportPdf?: () => void;
  selectedCount?: number;
  totalCount?: number;
  projectContext?: {
    name: string;
    leaving: boolean;
    onBack: () => void;
    onDocuments: () => void;
    onAddDocuments: () => void;
  };
  disciplineLabel?: string;
  utilityActions?: ReactNode;
}) {
  const affectedPositionCount = new Set(warnings.map((warning) => warning.positionId)).size;
  const progress = totalCount ? Math.round((selectedCount / totalCount) * 100) : 0;

  return (
    <header className="lv-page-header">
      <div className="lv-page-identity">
        {projectContext ? (
          <button
            type="button"
            className="lv-header-back"
            disabled={projectContext.leaving}
            onClick={projectContext.onBack}
            aria-label="Zurück zu Projekte"
          >
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <div className="lv-title-stack">
          <nav aria-label="Projektpfad">
            <span>Projekte</span>
            <i>/</i>
            <strong title={projectContext?.name}>
              {projectContext?.name ?? "Smart Procurement"}
            </strong>
          </nav>
          <div className="lv-title-line">
            <h1>LV-Vergleich</h1>
            <span>{disciplineLabel}</span>
          </div>
        </div>
      </div>

      <div
        className="lv-header-progress"
        aria-label={`${selectedCount} von ${totalCount} entschieden`}
      >
        <div>
          <span>Fortschritt</span>
          <strong>
            {selectedCount} / {totalCount}
          </strong>
        </div>
        <span className="lv-progress-track" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </span>
      </div>

      <div className="lv-page-actions">
        {projectContext ? (
          <>
            <button
              type="button"
              className="lv-header-action"
              disabled={projectContext.leaving}
              onClick={projectContext.onDocuments}
            >
              <FolderOpen size={16} /> Dokumente
            </button>
            <button
              type="button"
              className="lv-header-icon-action"
              onClick={projectContext.onAddDocuments}
              aria-label="Dokumente hinzufügen"
              title="Dokumente hinzufügen"
            >
              <FilePlus2 size={17} />
            </button>
          </>
        ) : null}

        <WarningCenter
          warnings={warnings}
          open={warningOpen}
          onToggle={onToggleWarnings}
          onClose={onToggleWarnings}
          onSelect={onSelectWarning}
        />

        <details className="lv-export-menu">
          <summary>
            <FileDown size={16} /> Exportieren <ChevronDown size={14} />
          </summary>
          <div>
            <button type="button" onClick={onExportExcel} disabled={!onExportExcel}>
              Excel-Datei
            </button>
            <button type="button" onClick={onExportPdf} disabled={!onExportPdf}>
              PDF-Bericht
            </button>
          </div>
        </details>
        {utilityActions}
      </div>
      <span className="lv-header-a11y-status" role="status" aria-live="polite">
        {affectedPositionCount} Positionen mit Hinweisen
      </span>
    </header>
  );
}
