import type { PilotAnalysis } from "@/domain/contracts";

export function decisionProjectId(analysis: PilotAnalysis): string {
  return process.env.SPT_PROJECT_ID ?? `local-project-${analysis.basisDocumentId}`;
}

export function decisionAnalysisVersionId(analysis: PilotAnalysis): string {
  return `${analysis.id}@${analysis.generatedAt}`;
}
