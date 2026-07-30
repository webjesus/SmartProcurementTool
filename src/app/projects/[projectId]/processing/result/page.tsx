import { ProcessingResultPage } from "@/components/browser-projects/processing-result-page";

export default async function BrowserProcessingResultRoute({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProcessingResultPage projectId={projectId} />;
}
