import { notFound, redirect } from "next/navigation";
import { SectionView, type SectionName } from "@/components/section-view";
import { localCorpusEnabled } from "@/services/deployment-profile";

const sectionNames = [
  "dokumente",
  "gefundene-daten",
  "pruefung",
  "zuordnung",
  "lv-vergleich",
  "entscheidungen",
  "export"
] as const;

export function generateStaticParams() {
  return sectionNames.map((section) => ({ section }));
}

export default async function SectionPage({
  params
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!sectionNames.some((candidate) => candidate === section)) notFound();
  // Demo /lv-vergleich rendered the legacy synthetic table whenever corpus
  // data was missing. That made the approved three-pane workspace look like it
  // had snapped back to the previous interface.
  if (section === "lv-vergleich" && !localCorpusEnabled()) {
    redirect("/projects");
  }
  if (
    process.env.DEV_UI_ENABLED !== "true" &&
    section === "entscheidungen"
  ) {
    redirect("/lv-vergleich#entscheidungspruefung");
  }
  return <SectionView section={section as SectionName} />;
}
