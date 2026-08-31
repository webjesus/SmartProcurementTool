"use client";

import {
  ArchiveRestore,
  ArrowRight,
  BookOpenCheck,
  Boxes,
  CheckCircle2,
  FileText,
  Filter,
  FolderPlus,
  History,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  filterConfirmedProducts,
  type CanonicalProduct
} from "@/library/product-library";

const detailTabs = [
  "Stammdaten",
  "Technische Daten",
  "Lieferantenartikel",
  "Dokumente",
  "Verwendung",
  "Änderungshistorie"
] as const;

function ProductInspectorContent({
  product,
  activeTab
}: {
  product: CanonicalProduct;
  activeTab: (typeof detailTabs)[number];
}) {
  if (activeTab === "Technische Daten") {
    return product.technicalAttributes.length ? (
      <dl>
        {product.technicalAttributes.map((attribute) => (
          <div key={`${attribute.name}:${attribute.value}`}>
            <dt>{attribute.name}</dt><dd>{attribute.value}</dd>
          </div>
        ))}
      </dl>
    ) : <p>Noch keine bestätigten technischen Merkmale.</p>;
  }
  if (activeTab === "Lieferantenartikel") {
    return product.supplierAliases.length ? (
      <dl>
        {product.supplierAliases.map((alias) => (
          <div key={`${alias.supplierId}:${alias.supplierArticleReference}`}>
            <dt>{alias.supplierLabel}</dt>
            <dd>{alias.supplierArticleReference}</dd>
          </div>
        ))}
      </dl>
    ) : <p>Noch keine bestätigten Lieferantenartikel.</p>;
  }
  if (activeTab === "Dokumente") {
    return <p>{product.documentCount} bestätigte Dokumentverknüpfungen.</p>;
  }
  if (activeTab === "Verwendung") {
    return <p>In {product.usageCount} Projekten als unveränderlicher Snapshot verwendet.</p>;
  }
  if (activeTab === "Änderungshistorie") {
    return (
      <dl>
        <div><dt>Version</dt><dd>{product.version}</dd></div>
        <div><dt>Letzte Änderung</dt><dd>{new Date(product.updatedAt).toLocaleString("de-DE")}</dd></div>
      </dl>
    );
  }
  return (
    <dl>
      <div><dt>Hersteller</dt><dd>{product.manufacturer}</dd></div>
      <div><dt>Modell</dt><dd>{product.model}</dd></div>
      <div><dt>Kategorie</dt><dd>{product.category}</dd></div>
      <div><dt>Anwendung</dt><dd>{product.application}</dd></div>
    </dl>
  );
}

function unique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "de")
  );
}

export function ProductLibraryPage({
  initialProducts
}: {
  initialProducts: readonly CanonicalProduct[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] =
    useState<(typeof detailTabs)[number]>("Stammdaten");

  const categories = useMemo(
    () =>
      unique(
        initialProducts
          .filter((product) => product.status === "CONFIRMED")
          .map((product) => product.category)
      ),
    [initialProducts]
  );
  const manufacturers = useMemo(
    () =>
      unique(
        initialProducts
          .filter((product) => product.status === "CONFIRMED")
          .map((product) => product.manufacturer)
      ),
    [initialProducts]
  );
  const products = useMemo(
    () =>
      filterConfirmedProducts(initialProducts, {
        query,
        category: category || undefined,
        manufacturer: manufacturer || undefined
      }),
    [category, initialProducts, manufacturer, query]
  );
  const selected = initialProducts.find((product) => product.id === selectedId);
  const confirmedCount = initialProducts.filter(
    (product) => product.status === "CONFIRMED"
  ).length;
  const reviewCount = initialProducts.filter(
    (product) => product.status === "REVIEW_REQUIRED"
  ).length;
  const filtering = Boolean(query.trim() || category || manufacturer);

  return (
    <div className="library-page" data-library-page>
      <header className="library-heading">
        <div>
          <span className="page-kicker">ZENTRALE WISSENSBASIS</span>
          <h1>Produktbibliothek</h1>
          <p>
            Bestätigte Produkte, technische Merkmale und nachvollziehbare
            Lieferantenzuordnungen an einem Ort.
          </p>
        </div>
        <div className="library-heading-actions">
          <button
            className="wb-button wb-button-secondary"
            type="button"
            disabled
            title="Im nächsten MVP-Paket"
          >
            <ArchiveRestore size={17} /> Prüfwarteschlange
            {reviewCount ? <span>{reviewCount}</span> : null}
          </button>
          <button
            className="wb-button wb-button-primary"
            type="button"
            disabled
            title="Im nächsten MVP-Paket"
          >
            <Plus size={18} /> Produkt hinzufügen
          </button>
        </div>
      </header>

      <p className="library-scope-note" role="note">
        Lesemodell im ersten MVP-Paket: Suche, Filter und Detailansicht sind
        aktiv. Import, Prüfung und Projektzuordnung folgen im nächsten Paket.
      </p>

      <section className="library-ledger" aria-label="Bibliotheksstatus">
        <div>
          <BookOpenCheck size={19} />
          <span>Bestätigte Produkte</span>
          <strong>{confirmedCount}</strong>
        </div>
        <div>
          <ShieldCheck size={19} />
          <span>Mit geprüften Stammdaten</span>
          <strong>
            {
              initialProducts.filter(
                (product) =>
                  product.status === "CONFIRMED" &&
                  product.technicalAttributes.length > 0
              ).length
            }
          </strong>
        </div>
        <div>
          <History size={19} />
          <span>Offene Prüfungen</span>
          <strong>{reviewCount}</strong>
        </div>
      </section>

      <section className="library-workbench">
        <header className="library-toolbar">
          <label className="library-search">
            <Search size={19} />
            <span className="sr-only">Produkte suchen</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Produkt, Hersteller, Modell oder Merkmal suchen …"
            />
          </label>
          <label>
            <Filter size={16} />
            <span className="sr-only">Kategorie</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">Alle Kategorien</option>
              {categories.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <SlidersHorizontal size={16} />
            <span className="sr-only">Hersteller</span>
            <select
              value={manufacturer}
              onChange={(event) => setManufacturer(event.target.value)}
            >
              <option value="">Alle Hersteller</option>
              {manufacturers.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <span className="library-result-count">
            {products.length} von {confirmedCount}
          </span>
        </header>

        <div className="library-table-wrap">
          <table className="library-table">
            <thead>
              <tr>
                <th>Produkt</th>
                <th>Hersteller / Modell</th>
                <th>Kategorie</th>
                <th>Anwendung</th>
                <th>Dokumente</th>
                <th>Verwendung</th>
                <th>Status</th>
                <th><span className="sr-only">Aktion</span></th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.id}
                  className={selectedId === product.id ? "selected" : ""}
                >
                  <td>
                    <button
                      type="button"
                      className="library-product-name"
                      onClick={() => setSelectedId(product.id)}
                    >
                      <span><Boxes size={17} /></span>
                      <strong>{product.productName}</strong>
                    </button>
                  </td>
                  <td>
                    <strong>{product.manufacturer}</strong>
                    <small>{product.model}</small>
                  </td>
                  <td>{product.category}</td>
                  <td>{product.application}</td>
                  <td><FileText size={14} /> {product.documentCount}</td>
                  <td>{product.usageCount} Projekte</td>
                  <td>
                    <span className="library-confirmed-state">
                      <CheckCircle2 size={14} /> Bestätigt
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="library-row-action"
                      aria-label={`${product.productName} öffnen`}
                      onClick={() => setSelectedId(product.id)}
                    >
                      <ArrowRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {products.length === 0 ? (
            <div className="library-empty-state">
              <span className="empty-bookmark"><BookOpenCheck size={28} /></span>
              <div>
                <h2>
                  {filtering
                    ? "Keine passenden Produkte"
                    : "Noch keine bestätigten Produkte"}
                </h2>
                <p>
                  {filtering
                    ? "Passen Sie Suche oder Filter an. Ungeprüfte Kandidaten bleiben bewusst außerhalb der Bibliothek."
                    : "Bestätigen Sie den ersten Produktkandidaten oder legen Sie ein Produkt manuell an. Rohzeilen aus Angeboten werden nicht automatisch übernommen."}
                </p>
              </div>
              {filtering ? (
                <button
                  className="wb-button wb-button-secondary"
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setCategory("");
                    setManufacturer("");
                  }}
                >
                  Filter zurücksetzen
                </button>
              ) : (
                <button
                  className="wb-button wb-button-primary"
                  type="button"
                  disabled
                  title="Im nächsten MVP-Paket"
                >
                  <Plus size={17} /> Produkt hinzufügen
                </button>
              )}
            </div>
          ) : null}
        </div>

        <footer className="library-workbench-footer">
          <span>
            Ein Produktpreis wird immer mit Lieferant, Angebot, Revision, Projekt
            und Datum gespeichert.
          </span>
          <button
            type="button"
            className="wb-button wb-button-secondary"
            disabled
            title="Im nächsten MVP-Paket"
          >
            <FolderPlus size={17} /> Zum Projekt hinzufügen
          </button>
        </footer>
      </section>

      {selected ? (
        <aside className="product-inspector" aria-label="Produktdetails">
          <header>
            <div>
              <span>BESTÄTIGTES PRODUKT · V{selected.version}</span>
              <h2>{selected.productName}</h2>
              <p>{selected.manufacturer} · {selected.model}</p>
            </div>
            <button
              type="button"
              className="shell-icon-button"
              aria-label="Produktdetails schließen"
              onClick={() => setSelectedId(null)}
            >
              <X size={18} />
            </button>
          </header>
          <nav aria-label="Produktdetailbereiche">
            {detailTabs.map((tab) => (
              <button
                type="button"
                className={activeTab === tab ? "active" : ""}
                onClick={() => setActiveTab(tab)}
                key={tab}
              >
                {tab}
              </button>
            ))}
          </nav>
          <div className="product-inspector-content">
            <span>{activeTab}</span>
            <ProductInspectorContent product={selected} activeTab={activeTab} />
          </div>
        </aside>
      ) : null}
    </div>
  );
}
