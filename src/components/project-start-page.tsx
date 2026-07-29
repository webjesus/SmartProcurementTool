"use client";

import { ArrowRight, FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useDecisionIdentity } from "@/components/decision-identity";

type ProjectCard = {
  id: string;
  name: string;
  projectNumber: string;
  disciplines: string[];
  lastOpenedAt: string;
  lastEditedAt: string;
  basisPositionCount: number;
};

function date(value: string): string {
  return new Date(value).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export function ProjectStartPage() {
  const identity = useDecisionIdentity();
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!identity.user) return;
    const controller = new AbortController();
    void fetch("/api/projects", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          projects?: ProjectCard[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "PROJECTS_LOAD_FAILED");
        setProjects(payload.projects ?? []);
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Projekte konnten nicht geladen werden."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [identity.user]);

  return (
    <section className="project-start-page" data-project-start-page>
      <header>
        <div>
          <span>Smart Procurement Tool</span>
          <h1>Zuletzt verwendete Projekte</h1>
          <p>Projekt öffnen und an der zuletzt gespeicherten Stelle fortfahren.</p>
        </div>
        <button
          className="button button-primary"
          disabled
          title="Die Projekterstellung wird in einem separaten Schritt umgesetzt."
        >
          <Plus size={17} /> Neues Projekt erstellen
        </button>
      </header>
      {loading ? <p>Projekte werden geladen...</p> : null}
      {error ? <p className="action-error">{error}</p> : null}
      <div className="project-card-grid">
        {projects.map((project) => (
          <article className="project-card" key={project.id}>
            <div className="project-card-icon">
              <FolderOpen size={24} />
            </div>
            <div>
              <span>{project.projectNumber}</span>
              <h2>{project.name}</h2>
              <p>{project.disciplines.join(" · ")}</p>
            </div>
            <dl>
              <div>
                <dt>Zuletzt geöffnet</dt>
                <dd>{date(project.lastOpenedAt)}</dd>
              </div>
              <div>
                <dt>Zuletzt bearbeitet</dt>
                <dd>{date(project.lastEditedAt)}</dd>
              </div>
              <div>
                <dt>Basis-Positionen</dt>
                <dd>{project.basisPositionCount}</dd>
              </div>
            </dl>
            <Link
              className="button button-secondary"
              href={`/lv-vergleich?project=${encodeURIComponent(project.id)}`}
            >
              Öffnen <ArrowRight size={16} />
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
