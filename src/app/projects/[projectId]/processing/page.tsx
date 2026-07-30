import { ProcessingPage } from "@/components/browser-projects/processing-page";

export default async function BrowserProcessingRoute({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProcessingPage projectId={projectId} />;
}
