"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FilePlus2,
  Grid2X2,
  List,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectIllustration } from "@/browser-projects/project-illustrations";
import { getBrowserProjectService } from "@/browser-projects/project-service";
import { projectDisplayStatus } from "@/browser-projects/project-status";
import type {
  BrowserProjectRecord,
  BrowserProjectStatus
} from "@/browser-projects/types";

const statusLabels: Record<BrowserProjectStatus, string> = {
  ENTWURF: "Entwurf",
  DOKUMENTE_GELADEN: "Dokumente geladen",
  PRÜFUNG_ERFORDERLICH: "Prüfung erforderlich",
  IN_VERARBEITUNG: "In Verarbeitung",
  BEREIT: "Bereit",
  FEHLER: "Fehler"
};

function date(value: string, withTime = false): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: withTime ? "short" : "medium",
    ...(withTime ? { timeStyle: "short" as const } : {})
  }).format(new Date(value));
}

function projectHref(project: BrowserProjectRecord): string {
  if (project.documentCount === 0) {
    return `/projects/new?projectId=${encodeURIComponent(project.projectId)}`;
  }
  switch (project.lastRoute) {
    case "PROCESSING":
      return `/projects/${project.projectId}/processing`;
    case "PROCESSING_RESULT":
      return `/projects/${project.projectId}/processing/result`;
    case "LV_COMPARISON":
      return `/projects/${project.projectId}/lv-vergleich`;
    case "DOCUMENT_REVIEW":
    case "PROJECT_DOCUMENTS":
    default:
      return project.status === "BEREIT"
        ? `/projects/${project.projectId}/lv-vergleich`
        : `/projects/${project.projectId}/documents/review`;
  }
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ProjectsPage() {
  const service = useMemo(() => getBrowserProjectService(), []);
  const router = useRouter();
  const [projects, setProjects] = useState<BrowserProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"UPDATED" | "NAME" | "CREATED">("UPDATED");
  const [view, setView] = useState<"GRID" | "LIST">("GRID");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editProject, setEditProject] =
    useState<BrowserProjectRecord | null>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editEngineeringOffice, setEditEngineeringOffice] = useState("");
  const [editArchitectureOffice, setEditArchitectureOffice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteProject, setDeleteProject] =
    useState<BrowserProjectRecord | null>(null);
  const [restorePreview, setRestorePreview] = useState<{
    file: File;
    summary: Awaited<ReturnType<typeof service.inspectBackup>>["summary"];
  } | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const editNameInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setProjects(await service.listProjects());
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Projekte konnten nicht geladen werden."
      );
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timeout);
  }, [reload]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("de");
    return projects
      .filter((project) =>
        `${project.name} ${project.address} ${project.engineeringOffice} ${project.architectureOffice} ${project.objectDescription}`
          .toLocaleLowerCase("de")
          .includes(query)
      )
      .sort((left, right) => {
        if (sort === "NAME") return left.name.localeCompare(right.name, "de");
        if (sort === "CREATED") return right.createdAt.localeCompare(left.createdAt);
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [projects, search, sort]);

  async function openProject(project: BrowserProjectRecord) {
    await service.openProject(project.projectId);
    router.push(projectHref(project));
  }

  function beginEdit(project: BrowserProjectRecord) {
    setOpenMenu(null);
    setEditProject(project);
    setEditName(project.name);
    setEditAddress(project.address);
    setEditEngineeringOffice(project.engineeringOffice);
    setEditArchitectureOffice(project.architectureOffice);
    setEditDescription(project.objectDescription);
    window.setTimeout(() => editNameInput.current?.focus(), 0);
  }

  async function saveEdit() {
    if (
      !editProject ||
      !editName.trim() ||
      !editAddress.trim() ||
      !editEngineeringOffice.trim() ||
      !editArchitectureOffice.trim()
    ) return;
    try {
      await service.updateProject(editProject.projectId, {
        name: editName,
        address: editAddress,
        engineeringOffice: editEngineeringOffice,
        architectureOffice: editArchitectureOffice,
        objectDescription: editDescription
      });
      setEditProject(null);
      await reload();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Projektdaten konnten nicht gespeichert werden."
      );
    }
  }

  async function duplicate(project: BrowserProjectRecord) {
    await service.duplicateProject(project.projectId);
    setOpenMenu(null);
    await reload();
  }

  async function remove(project: BrowserProjectRecord) {
    await service.deleteProject(project.projectId);
    setDeleteProject(null);
    setOpenMenu(null);
    await reload();
  }

  async function backup(project: BrowserProjectRecord) {
    const blob = await service.backupProject(project.projectId);
    downloadBlob(blob, `${project.name.replace(/[^\p{L}\p{N}-]+/gu, "-")}.spt-project`);
    setOpenMenu(null);
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    try {
      const inspected = await service.inspectBackup(file);
      setRestorePreview({ file, summary: inspected.summary });
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Projekt konnte nicht wiederhergestellt werden."
      );
    } finally {
      if (restoreInput.current) restoreInput.current.value = "";
    }
  }

  async function confirmRestore() {
    if (!restorePreview) return;
    await service.restoreProject(restorePreview.file);
    setRestorePreview(null);
    await reload();
  }

  function cardClick(
    event: React.MouseEvent<HTMLElement>,
    project: BrowserProjectRecord
  ) {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [role='menu']")) {
      return;
    }
    if (window.getSelection()?.toString()) return;
    void openProject(project);
  }

  function cardKeyDown(
    event: React.KeyboardEvent<HTMLElement>,
    project: BrowserProjectRecord
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if ((event.target as HTMLElement).closest("button, a, [role='menu']")) return;
    event.preventDefault();
    void openProject(project);
  }

  return (
    <div className="projects-page" data-browser-projects data-project-view={view.toLowerCase()}>
      <header className="projects-header">
        <div>
          <h1>Projekte</h1>
          <p>Ihre Projekte</p>
        </div>
        <div>
          <button
            className="project-restore-button"
            onClick={() => restoreInput.current?.click()}
          >
            <Upload size={17} /> Projekt wiederherstellen
          </button>
          <Link className="projects-primary-action" href="/projects/new">
            <Plus size={20} /> Neues Projekt
          </Link>
          <input
            ref={restoreInput}
            type="file"
            accept=".spt-project,application/vnd.smart-procurement.project+json"
            hidden
            onChange={(event) => void restore(event.target.files?.[0])}
          />
        </div>
      </header>

      <aside className="browser-local-prototype-note" role="note">
        Lokal gespeichert: Diese Liste wird noch nicht zwischen
        Arbeitsplätzen synchronisiert. Gemeinsamer Server-Speicher ist noch
        nicht verfügbar. Sichern Sie wichtige Projekte regelmäßig.
      </aside>

      <div className="projects-toolbar">
        <label className="projects-search">
          <Search size={20} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Projekte suchen..."
          />
        </label>
        <label className="projects-sort">
          <span>Sortieren:</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="UPDATED">Zuletzt bearbeitet</option>
            <option value="NAME">Projektname</option>
            <option value="CREATED">Erstellt am</option>
          </select>
        </label>
        <div className="projects-view-toggle" aria-label="Darstellung">
          <button
            className={view === "GRID" ? "active" : ""}
            onClick={() => setView("GRID")}
            aria-label="Rasteransicht"
          >
            <Grid2X2 size={20} />
          </button>
          <button
            className={view === "LIST" ? "active" : ""}
            onClick={() => setView("LIST")}
            aria-label="Listenansicht"
          >
            <List size={20} />
          </button>
        </div>
      </div>

      {error ? <p className="browser-project-error" role="alert">{error}</p> : null}
      {loading ? <p className="projects-loading">Projekte werden geladen...</p> : null}

      <section className={`projects-collection ${view.toLowerCase()}`}>
        {visible.map((project) => (
          <article
            className="browser-project-card"
            key={project.projectId}
            data-project-id={project.projectId}
            role="link"
            tabIndex={0}
            aria-label={`${project.name} öffnen`}
            onClick={(event) => cardClick(event, project)}
            onKeyDown={(event) => cardKeyDown(event, project)}
          >
            <button
              className="project-card-open"
              onClick={() => void openProject(project)}
              aria-label={`${project.name} öffnen`}
            >
              <ProjectIllustration
                illustrationId={project.illustrationId}
                compact={view === "LIST"}
              />
              <span className="project-card-title">
                <strong>{project.name}</strong>
                {project.objectDescription ? <small>{project.objectDescription}</small> : null}
              </span>
            </button>
            <div className="project-menu">
              <button
                onClick={() =>
                  setOpenMenu((current) =>
                    current === project.projectId ? null : project.projectId
                  )
                }
                aria-label={`Aktionen für ${project.name}`}
              >
                <MoreVertical size={20} />
              </button>
              {openMenu === project.projectId ? (
                <div role="menu">
                  <button onClick={() => void openProject(project)}>
                    <ArrowRight size={15} /> Öffnen
                  </button>
                  <button onClick={() => beginEdit(project)}>
                    <Pencil size={15} /> Umbenennen
                  </button>
                  <button onClick={() => void duplicate(project)}>
                    <Copy size={15} /> Duplizieren
                  </button>
                  <button onClick={() => void backup(project)}>
                    <Download size={15} /> Projekt sichern
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      setOpenMenu(null);
                      setDeleteProject(project);
                    }}
                  >
                    <Trash2 size={15} /> Löschen
                  </button>
                </div>
              ) : null}
            </div>
            <dl className="project-directory-details">
              <div>
                <dt>Adresse</dt>
                <dd>{project.address || "Nicht hinterlegt"}</dd>
              </div>
              <div>
                <dt>Ingenieurbüro</dt>
                <dd>{project.engineeringOffice || "Nicht hinterlegt"}</dd>
              </div>
              <div>
                <dt>Architekturbüro</dt>
                <dd>{project.architectureOffice || "Nicht hinterlegt"}</dd>
              </div>
            </dl>
            <dl className="project-metrics">
              <div><dt>Basis-Positionen</dt><dd>{project.basisPositionCount}</dd></div>
              <div><dt>Dokumente</dt><dd>{project.documentCount}</dd></div>
              <div><dt>Angebote</dt><dd>{project.supplierOfferCount}</dd></div>
            </dl>
            <dl className="project-dates">
              <div><dt>Zuletzt bearbeitet</dt><dd>{date(project.updatedAt, true)}</dd></div>
              <div><dt>Erstellt am</dt><dd>{date(project.createdAt)}</dd></div>
            </dl>
            <span className={`project-status status-${projectDisplayStatus(project).toLocaleLowerCase("de")}`}>
              {projectDisplayStatus(project) === "BEREIT" ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}
              {statusLabels[projectDisplayStatus(project)]}
            </span>
          </article>
        ))}
        {view === "GRID" ? (
          <Link className="new-project-card" href="/projects/new">
            <span><Plus size={30} /></span>
            <strong>Neues Projekt erstellen</strong>
            <p>Ein neues Projekt anlegen und<br />Dokumente hochladen</p>
          </Link>
        ) : (
          <Link className="new-project-list-row" href="/projects/new">
            <FilePlus2 size={20} /> Neues Projekt erstellen
          </Link>
        )}
      </section>

      {!loading && projects.length === 0 ? (
        <p className="projects-empty-note">
          Ihr erstes Projekt kann sofort angelegt werden.
        </p>
      ) : null}

      <footer className="projects-pagination">
        <span>
          Zeige {visible.length ? 1 : 0} bis {visible.length} von {visible.length} Projekten
        </span>
        <div>
          <button disabled aria-label="Vorherige Seite"><ArrowLeft size={17} /></button>
          <strong>1</strong>
          <button disabled aria-label="Nächste Seite"><ArrowRight size={17} /></button>
        </div>
      </footer>

      {editProject ? (
        <div
          className="browser-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditProject(null);
          }}
        >
          <section
            className="browser-confirm-dialog project-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-edit-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditProject(null);
              if (event.key === "Enter" && editName.trim()) void saveEdit();
            }}
          >
            <header>
              <h2 id="project-edit-title">Projekt bearbeiten</h2>
              <button onClick={() => setEditProject(null)} aria-label="Schließen">
                <X size={18} />
              </button>
            </header>
            <label>
              Projektname
              <input
                ref={editNameInput}
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                aria-invalid={!editName.trim()}
                maxLength={160}
              />
            </label>
            {!editName.trim() ? (
              <small className="browser-field-error">
                Projektname ist erforderlich.
              </small>
            ) : null}
            <label>
              Adresse
              <input
                value={editAddress}
                onChange={(event) => setEditAddress(event.target.value)}
                aria-invalid={!editAddress.trim()}
                maxLength={300}
              />
            </label>
            <label>
              Ingenieurbüro
              <input
                value={editEngineeringOffice}
                onChange={(event) => setEditEngineeringOffice(event.target.value)}
                aria-invalid={!editEngineeringOffice.trim()}
                maxLength={200}
              />
            </label>
            <label>
              Architekturbüro
              <input
                value={editArchitectureOffice}
                onChange={(event) => setEditArchitectureOffice(event.target.value)}
                aria-invalid={!editArchitectureOffice.trim()}
                maxLength={200}
              />
            </label>
            <label>
              Objekt / Beschreibung
              <textarea
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                maxLength={2000}
              />
            </label>
            <footer>
              <button onClick={() => setEditProject(null)}>Abbrechen</button>
              <button
                className="primary"
                disabled={
                  !editName.trim() ||
                  !editAddress.trim() ||
                  !editEngineeringOffice.trim() ||
                  !editArchitectureOffice.trim()
                }
                onClick={() => void saveEdit()}
              >
                Änderungen speichern
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {deleteProject ? (
        <div className="browser-modal-backdrop" role="presentation">
          <section
            className="browser-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-title"
          >
            <header>
              <h2 id="project-delete-title">Projekt löschen</h2>
              <button onClick={() => setDeleteProject(null)} aria-label="Schließen">
                <X size={18} />
              </button>
            </header>
            <p>
              <strong>{deleteProject.name}</strong> und alle lokal gespeicherten
              Dokumente werden endgültig gelöscht.
            </p>
            <footer>
              <button onClick={() => setDeleteProject(null)}>Abbrechen</button>
              <button
                className="danger"
                onClick={() => void remove(deleteProject)}
              >
                Projekt löschen
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {restorePreview ? (
        <div className="browser-modal-backdrop" role="presentation">
          <section
            className="browser-confirm-dialog restore-project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-restore-title"
          >
            <header>
              <h2 id="project-restore-title">Projekt wiederherstellen</h2>
              <button onClick={() => setRestorePreview(null)} aria-label="Schließen">
                <X size={18} />
              </button>
            </header>
            <dl>
              <div><dt>Projekt</dt><dd>{restorePreview.summary.projectName}</dd></div>
              <div><dt>Schema-Version</dt><dd>{restorePreview.summary.schemaVersion}</dd></div>
              <div><dt>Dokumente</dt><dd>{restorePreview.summary.documentCount}</dd></div>
              <div><dt>Basis-Positionen</dt><dd>{restorePreview.summary.basisPositionCount}</dd></div>
              <div><dt>Angebote</dt><dd>{restorePreview.summary.offerCount}</dd></div>
              <div><dt>Backup-Datum</dt><dd>{date(restorePreview.summary.exportedAt, true)}</dd></div>
              <div><dt>Gesamtgröße</dt><dd>{Math.ceil(restorePreview.summary.totalSize / 1024)} KB</dd></div>
              <div><dt>Prüfsummen</dt><dd>Gültig</dd></div>
            </dl>
            <footer>
              <button onClick={() => setRestorePreview(null)}>Abbrechen</button>
              <button className="primary" onClick={() => void confirmRestore()}>
                Projekt wiederherstellen
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
