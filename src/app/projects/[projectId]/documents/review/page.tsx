import { DocumentReviewPage } from "@/components/browser-projects/document-review-page";

export default async function BrowserDocumentReviewRoute({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <DocumentReviewPage projectId={projectId} />;
}
