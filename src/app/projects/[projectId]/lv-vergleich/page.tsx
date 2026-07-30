import { BrowserLvPage } from "@/components/browser-projects/browser-lv-page";

export default async function BrowserLvRoute({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <BrowserLvPage projectId={projectId} />;
}
