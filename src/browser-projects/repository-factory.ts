import {
  BrowserIndexedDbAnalysisRepository,
  BrowserIndexedDbDocumentBlobRepository,
  BrowserIndexedDbDocumentRepository,
  BrowserIndexedDbProcessingRunRepository,
  BrowserIndexedDbProjectRepository,
  BrowserIndexedDbSelectionRepository,
  BrowserIndexedDbWorkspaceRepository,
  BrowserProjectDatabase
} from "@/browser-projects/indexeddb";
import type {
  AnalysisRepository,
  DocumentBlobRepository,
  DocumentRepository,
  ProcessingRunRepository,
  ProjectRepositories,
  ProjectRepository,
  SelectionRepository,
  WorkspaceRepository
} from "@/browser-projects/repositories";
import type {
  BrowserAnalysisSnapshot,
  BrowserDocumentRecord,
  BrowserProjectRecord,
  BrowserSelectionRecord,
  BrowserWorkspaceRecord
} from "@/browser-projects/types";
import type { SptDeploymentMode } from "@/services/deployment-profile";

class ServerRepository {
  protected async request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      ...init
    });
    if (!response.ok) {
      throw new Error(`SERVER_REPOSITORY_${response.status}`);
    }
    return (await response.json()) as T;
  }
}

export class OnPremServerProjectRepository
  extends ServerRepository
  implements ProjectRepository
{
  async get(projectId: string) {
    const projects = await this.list();
    return projects.find((project) => project.projectId === projectId) ?? null;
  }
  async list() {
    const payload = await this.request<{ projects: BrowserProjectRecord[] }>(
      "/api/projects"
    );
    return payload.projects;
  }
  async save() {
    throw new Error("ON_PREM_PROJECT_WRITES_USE_EXISTING_SERVER_WORKFLOW");
  }
  async delete() {
    throw new Error("ON_PREM_PROJECT_WRITES_USE_EXISTING_SERVER_WORKFLOW");
  }
}

export class OnPremServerDocumentRepository
  extends ServerRepository
  implements DocumentRepository
{
  async get() {
    return null;
  }
  async list() {
    return [] as BrowserDocumentRecord[];
  }
  async save() {
    throw new Error("ON_PREM_DOCUMENT_WRITES_USE_EXISTING_SERVER_WORKFLOW");
  }
  async delete() {
    throw new Error("ON_PREM_DOCUMENT_WRITES_USE_EXISTING_SERVER_WORKFLOW");
  }
}

export class OnPremServerSelectionRepository
  extends ServerRepository
  implements SelectionRepository
{
  async get() {
    return null;
  }
  async list(projectId: string) {
    const payload = await this.request<{ decisions: BrowserSelectionRecord[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/decisions`
    );
    return payload.decisions;
  }
  async save() {
    throw new Error("ON_PREM_SELECTION_WRITES_USE_EXISTING_SERVER_WORKFLOW");
  }
  async delete() {
    throw new Error("ON_PREM_SELECTION_WRITES_USE_EXISTING_SERVER_WORKFLOW");
  }
}

export class OnPremServerWorkspaceRepository
  extends ServerRepository
  implements WorkspaceRepository
{
  async get(projectId: string) {
    const payload = await this.request<{ workspace: BrowserWorkspaceRecord | null }>(
      `/api/projects/${encodeURIComponent(projectId)}/workspace`
    );
    return payload.workspace;
  }
  async save(workspace: BrowserWorkspaceRecord) {
    await this.request(`/api/projects/${encodeURIComponent(workspace.projectId)}/workspace`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: workspace.state, expectedVersion: null })
    });
  }
}

class OnPremUnsupportedBlobRepository implements DocumentBlobRepository {
  async get() {
    return null;
  }
  async save() {
    throw new Error("ON_PREM_BLOBS_USE_LOCAL_CORPUS_STORAGE");
  }
  async delete() {
    throw new Error("ON_PREM_BLOBS_USE_LOCAL_CORPUS_STORAGE");
  }
}

class OnPremUnsupportedAnalysisRepository implements AnalysisRepository {
  async get() {
    return null;
  }
  async latest() {
    return null;
  }
  async list() {
    return [] as BrowserAnalysisSnapshot[];
  }
  async save() {
    throw new Error("ON_PREM_ANALYSIS_USES_EXISTING_SERVER_WORKFLOW");
  }
}

class OnPremUnsupportedProcessingRepository implements ProcessingRunRepository {
  async current() {
    return null;
  }
  async save() {
    throw new Error("ON_PREM_PROCESSING_USES_EXISTING_SERVER_WORKFLOW");
  }
}

let browserRepositories: ProjectRepositories | null = null;

export function createBrowserProjectRepositories(
  database = new BrowserProjectDatabase()
): ProjectRepositories {
  return {
    projects: new BrowserIndexedDbProjectRepository(database),
    documents: new BrowserIndexedDbDocumentRepository(database),
    documentBlobs: new BrowserIndexedDbDocumentBlobRepository(database),
    analyses: new BrowserIndexedDbAnalysisRepository(database),
    selections: new BrowserIndexedDbSelectionRepository(database),
    workspaces: new BrowserIndexedDbWorkspaceRepository(database),
    processingRuns: new BrowserIndexedDbProcessingRunRepository(database)
  };
}

export function getBrowserProjectRepositories(): ProjectRepositories {
  browserRepositories ??= createBrowserProjectRepositories();
  return browserRepositories;
}

export function createOnPremProjectRepositories(): ProjectRepositories {
  return {
    projects: new OnPremServerProjectRepository(),
    documents: new OnPremServerDocumentRepository(),
    documentBlobs: new OnPremUnsupportedBlobRepository(),
    analyses: new OnPremUnsupportedAnalysisRepository(),
    selections: new OnPremServerSelectionRepository(),
    workspaces: new OnPremServerWorkspaceRepository(),
    processingRuns: new OnPremUnsupportedProcessingRepository()
  };
}

export function createProjectRepositoriesForProfile(
  mode: SptDeploymentMode,
  database?: BrowserProjectDatabase
): ProjectRepositories {
  return mode === "BROWSER_LOCAL"
    ? createBrowserProjectRepositories(database)
    : createOnPremProjectRepositories();
}
