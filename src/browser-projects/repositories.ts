import type {
  BrowserAnalysisSnapshot,
  BrowserDocumentBlobRecord,
  BrowserDocumentRecord,
  BrowserProcessingRun,
  BrowserProjectRecord,
  BrowserSelectionRecord,
  BrowserWorkspaceRecord
} from "@/browser-projects/types";

export interface ProjectRepository {
  get(projectId: string): Promise<BrowserProjectRecord | null>;
  list(): Promise<BrowserProjectRecord[]>;
  save(project: BrowserProjectRecord): Promise<void>;
  delete(projectId: string): Promise<void>;
}

export interface DocumentRepository {
  get(projectId: string, documentId: string): Promise<BrowserDocumentRecord | null>;
  list(projectId: string): Promise<BrowserDocumentRecord[]>;
  save(document: BrowserDocumentRecord): Promise<void>;
  delete(projectId: string, documentId: string): Promise<void>;
}

export interface DocumentBlobRepository {
  get(projectId: string, documentId: string): Promise<Blob | null>;
  save(record: BrowserDocumentBlobRecord): Promise<void>;
  delete(projectId: string, documentId: string): Promise<void>;
}

export interface AnalysisRepository {
  get(projectId: string, analysisVersionId: string): Promise<BrowserAnalysisSnapshot | null>;
  latest(projectId: string): Promise<BrowserAnalysisSnapshot | null>;
  list(projectId: string): Promise<BrowserAnalysisSnapshot[]>;
  save(snapshot: BrowserAnalysisSnapshot): Promise<void>;
}

export interface SelectionRepository {
  get(projectId: string, positionId: string): Promise<BrowserSelectionRecord | null>;
  list(projectId: string): Promise<BrowserSelectionRecord[]>;
  save(selection: BrowserSelectionRecord): Promise<void>;
  delete(projectId: string, positionId: string): Promise<void>;
}

export interface WorkspaceRepository {
  get(projectId: string): Promise<BrowserWorkspaceRecord | null>;
  save(workspace: BrowserWorkspaceRecord): Promise<void>;
}

export interface ProcessingRunRepository {
  current(projectId: string): Promise<BrowserProcessingRun | null>;
  save(run: BrowserProcessingRun): Promise<void>;
}

export type ProjectRepositories = {
  projects: ProjectRepository;
  documents: DocumentRepository;
  documentBlobs: DocumentBlobRepository;
  analyses: AnalysisRepository;
  selections: SelectionRepository;
  workspaces: WorkspaceRepository;
  processingRuns: ProcessingRunRepository;
};
