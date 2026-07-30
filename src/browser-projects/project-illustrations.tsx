import type { SVGProps } from "react";

type IllustrationDefinition = {
  id: string;
  label: string;
  Component: (props: SVGProps<SVGSVGElement>) => React.ReactNode;
};

const common = {
  viewBox: "0 0 120 84",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

function Administrative(props: SVGProps<SVGSVGElement>) {
  return <svg {...common} {...props}><path d="M12 72h96M21 70V31l26-15v54M47 70V24l34 10v36M81 70V42l18 5v23"/><path d="M28 35l11-6v11l-11 5zM55 34h8v9h-8zM69 36h7v9h-7zM55 51h8v9h-8zM69 53h7v9h-7zM87 52h6v8h-6z"/></svg>;
}

function Residential(props: SVGProps<SVGSVGElement>) {
  return <svg {...common} {...props}><path d="M16 72h88M26 70V23h55v47M22 23h63l-6-8H29zM81 70V36h13v34"/><path d="M35 31h8v9h-8zM51 31h8v9h-8zM67 31h8v9h-8zM35 48h8v9h-8zM51 48h8v9h-8zM67 48h8v9h-8zM51 62h9v8h-9z"/></svg>;
}

function PublicBuilding(props: SVGProps<SVGSVGElement>) {
  return <svg {...common} {...props}><path d="M12 72h96M25 70V42h70v28M20 42l40-23 40 23M52 70V49h16v21M60 19V9M60 9l10 5"/><path d="M33 49h9v11h-9zM78 49h9v11h-9zM56 30a6 6 0 1 0 8 0 6 6 0 0 0-8 0z"/></svg>;
}

function OfficeTower(props: SVGProps<SVGSVGElement>) {
  return <svg {...common} {...props}><path d="M12 72h96M27 70V27l20-10v53M47 70V10h25v60M72 70V29l20 8v33"/><path d="M34 32h7M34 42h7M34 52h7M54 20h11M54 31h11M54 42h11M54 53h11M79 40h7M79 50h7M79 60h7"/></svg>;
}

function Industrial(props: SVGProps<SVGSVGElement>) {
  return <svg {...common} {...props}><path d="M10 72h100M18 70V38l23 11V36l23 13V30l23 13v27M87 70V20h12v50"/><path d="M27 56h12v14H27zM50 56h12v14H50zM72 54h9v8h-9zM91 13h5"/></svg>;
}

function Construction(props: SVGProps<SVGSVGElement>) {
  return <svg {...common} {...props}><path d="M10 72h100M26 70V39h53v31M20 39h66L73 26H33zM40 70V51h24v19M91 70V18M83 18h22M97 18v10l8 5"/><path d="M33 47h8M68 47h5"/></svg>;
}

function Fallback(props: SVGProps<SVGSVGElement>) {
  return <svg {...common} {...props}><path d="M12 72h96M22 70V38l38-22 38 22v32M34 70V45h52v25M51 70V53h18v17"/><path d="M41 51h5M74 51h5M41 61h5M74 61h5"/></svg>;
}

export const ProjectIllustrationRegistry: readonly IllustrationDefinition[] = [
  { id: "administrative", label: "Architekturillustration", Component: Administrative },
  { id: "residential", label: "Architekturillustration", Component: Residential },
  { id: "public-building", label: "Architekturillustration", Component: PublicBuilding },
  { id: "office-tower", label: "Architekturillustration", Component: OfficeTower },
  { id: "industrial", label: "Architekturillustration", Component: Industrial },
  { id: "construction", label: "Architekturillustration", Component: Construction },
  { id: "building-fallback", label: "Architekturillustration", Component: Fallback }
] as const;

export function stableProjectHash(projectId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < projectId.length; index += 1) {
    hash ^= projectId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function assignProjectIllustrationId(projectId: string): string {
  return ProjectIllustrationRegistry[
    stableProjectHash(projectId) % ProjectIllustrationRegistry.length
  ].id;
}

export function ProjectIllustration({
  illustrationId,
  compact = false,
  decorative = true
}: {
  illustrationId: string;
  compact?: boolean;
  decorative?: boolean;
}) {
  const definition =
    ProjectIllustrationRegistry.find((item) => item.id === illustrationId) ??
    ProjectIllustrationRegistry.at(-1)!;
  const Component = definition.Component;
  return (
    <span
      className={`project-illustration ${compact ? "compact" : ""}`}
      data-project-illustration={definition.id}
    >
      <Component
        role={decorative ? undefined : "img"}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : definition.label}
      />
    </span>
  );
}
