import { redirect } from "next/navigation";
import { ProjectStartPage } from "@/components/project-start-page";
import { isBrowserLocal } from "@/services/deployment-profile";

export default function OverviewPage() {
  if (isBrowserLocal()) redirect("/projects");
  return <ProjectStartPage />;
}
