import { ArrowRight, Construction, ShieldCheck } from "lucide-react";
import Link from "next/link";

export function PlannedWorkspacePage({
  eyebrow,
  title,
  description,
  boundary
}: {
  eyebrow: string;
  title: string;
  description: string;
  boundary: string;
}) {
  return (
    <div className="planned-workspace">
      <span className="page-kicker">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <section>
        <span className="empty-bookmark"><Construction size={27} /></span>
        <div>
          <strong>Noch nicht verfügbar</strong>
          <p>{boundary}</p>
        </div>
      </section>
      <aside>
        <ShieldCheck size={17} />
        <span>Dieser Arbeitsbereich führt noch keine Aktion aus und erzeugt keine scheinbar fertigen Dokumente.</span>
      </aside>
      <Link href="/" className="wb-button wb-button-secondary">
        Zur Produktbibliothek <ArrowRight size={16} />
      </Link>
    </div>
  );
}
