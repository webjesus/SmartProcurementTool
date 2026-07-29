import { ProjectStartPage } from "@/components/project-start-page";
import { isVercelPreview } from "@/services/deployment-profile";

export default function OverviewPage() {
  return <ProjectStartPage preview={isVercelPreview()} />;
}
