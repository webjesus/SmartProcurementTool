import { notFound, redirect } from "next/navigation";
import { SectionView, type SectionName } from "@/components/section-view";

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
  if (
    process.env.DEV_UI_ENABLED !== "true" &&
    section === "entscheidungen"
  ) {
    redirect("/lv-vergleich#entscheidungspruefung");
  }
  return <SectionView section={section as SectionName} />;
}
