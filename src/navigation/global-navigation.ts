export type GlobalNavigationItem = {
  id:
    | "library"
    | "projects"
    | "new-project"
    | "pdf"
    | "email"
    | "revision"
    | "own-lv";
  href: string;
  label: string;
};

export const GLOBAL_NAVIGATION: readonly GlobalNavigationItem[] = [
  { id: "library", href: "/", label: "Produktbibliothek" },
  { id: "projects", href: "/projects", label: "Projekte" },
  { id: "new-project", href: "/projects/new", label: "Neues Projekt" },
  { id: "pdf", href: "/pdf-erstellen", label: "PDF erstellen" },
  { id: "email", href: "/email-assistent", label: "E-Mail-Assistent" },
  {
    id: "revision",
    href: "/revisionsunterlagen",
    label: "Revisionsunterlagen"
  },
  { id: "own-lv", href: "/eigenes-lv", label: "Eigenes LV" }
] as const;

export function globalNavigationItemForPath(pathname: string) {
  const exact = GLOBAL_NAVIGATION.find((item) => item.href === pathname);
  if (exact) return exact;
  return GLOBAL_NAVIGATION.find(
    (item) => item.href !== "/" && pathname.startsWith(`${item.href}/`)
  );
}
