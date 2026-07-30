import type {
  BrowserProjectRecord,
  BrowserProjectStatus
} from "@/browser-projects/types";

export function projectDisplayStatus(
  project: BrowserProjectRecord
): BrowserProjectStatus {
  if (project.status !== "BEREIT" || project.basisPositionCount > 0) {
    return project.status;
  }
  return project.processingFailureCode ? "FEHLER" : "PRÜFUNG_ERFORDERLICH";
}
