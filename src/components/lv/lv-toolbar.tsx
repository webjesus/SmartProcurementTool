"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";

export type LvSortMode =
  | "LV_ORDER"
  | "UNRESOLVED_FIRST"
  | "AUTOMATIC_FIRST"
  | "STATUS"
  | "PRICE_DIFFERENCE";
export type LvPositionFilter = "ALL" | "SELECTED" | "UNSELECTED" | "WARNINGS";

export function LvToolbar({
  search,
  supplier,
  suppliers,
  positionFilter,
  sort,
  shown,
  total,
  openCount,
  warningCount,
  onSearch,
  onSupplier,
  onPositionFilter,
  onSort
}: {
  search: string;
  supplier: string;
  suppliers: string[];
  positionFilter: LvPositionFilter;
  sort: LvSortMode;
  shown: number;
  total: number;
  openCount?: number;
  warningCount?: number;
  onSearch: (value: string) => void;
  onSupplier: (value: string) => void;
  onPositionFilter: (value: LvPositionFilter) => void;
  onSort: (value: LvSortMode) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  const filterActive = supplier !== "ALL" || sort !== "LV_ORDER" || positionFilter !== "ALL";

  return (
    <div className="lv-toolbar" data-lv-toolbar>
      <label className="lv-search-field">
        <Search size={16} />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Position, Kurzbezeichnung oder Artikel suchen"
          aria-label="LV durchsuchen"
        />
        {search ? (
          <button type="button" onClick={() => onSearch("")} aria-label="Suche löschen">
            <X size={15} />
          </button>
        ) : null}
      </label>

      <div className="lv-quick-filters" aria-label="Positionsstatus">
        <button
          type="button"
          className={positionFilter === "ALL" ? "active" : ""}
          aria-pressed={positionFilter === "ALL"}
          aria-label="Alle"
          aria-describedby="lv-count-all"
          onClick={() => onPositionFilter("ALL")}
        >
          Alle <span aria-hidden="true">{total}</span>
          <span id="lv-count-all" className="sr-only">
            {total} Positionen
          </span>
        </button>
        <button
          type="button"
          className={positionFilter === "UNSELECTED" ? "active" : ""}
          aria-pressed={positionFilter === "UNSELECTED"}
          aria-label="Offen"
          aria-describedby="lv-count-open"
          onClick={() => onPositionFilter("UNSELECTED")}
        >
          Offen <span aria-hidden="true">{openCount ?? "–"}</span>
          <span id="lv-count-open" className="sr-only">
            {openCount ?? 0} offene Positionen
          </span>
        </button>
        <button
          type="button"
          className={positionFilter === "WARNINGS" ? "active" : ""}
          aria-pressed={positionFilter === "WARNINGS"}
          aria-label="Hinweise"
          aria-describedby="lv-count-warnings"
          onClick={() => onPositionFilter("WARNINGS")}
        >
          Hinweise <span aria-hidden="true">{warningCount ?? "–"}</span>
          <span id="lv-count-warnings" className="sr-only">
            {warningCount ?? 0} Positionen mit Hinweisen
          </span>
        </button>
      </div>

      <details className="lv-filter-menu">
        <summary className={filterActive ? "active" : ""}>
          <SlidersHorizontal size={15} /> Filter
          {filterActive ? <span className="lv-filter-indicator" /> : null}
        </summary>
        <div className="lv-filter-popover">
          <header>
            <strong>Ansicht filtern</strong>
            <span>{shown} Treffer</span>
          </header>
          <label>
            Status
            <select
              value={positionFilter}
              onChange={(event) => onPositionFilter(event.target.value as LvPositionFilter)}
              aria-label="Auswahl und Hinweise filtern"
            >
              <option value="ALL">Alle Positionen</option>
              <option value="UNSELECTED">Offen</option>
              <option value="SELECTED">Entschieden</option>
              <option value="WARNINGS">Mit Hinweisen</option>
            </select>
          </label>
          <label>
            Lieferant
            <select
              value={supplier}
              onChange={(event) => onSupplier(event.target.value)}
              aria-label="Lieferant filtern"
            >
              <option value="ALL">Alle Lieferanten</option>
              {suppliers.map((supplierName) => (
                <option key={supplierName} value={supplierName}>
                  {supplierName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sortierung
            <select
              value={sort}
              onChange={(event) => onSort(event.target.value as LvSortMode)}
              aria-label="Sortierung"
            >
              <option value="LV_ORDER">LV-Reihenfolge</option>
              <option value="UNRESOLVED_FIRST">Offene zuerst</option>
              <option value="STATUS">Nach Status</option>
              <option value="PRICE_DIFFERENCE">Größte Preisspanne</option>
            </select>
          </label>
          <button
            type="button"
            className="lv-filter-reset"
            disabled={!filterActive}
            onClick={() => {
              onSupplier("ALL");
              onPositionFilter("ALL");
              onSort("LV_ORDER");
            }}
          >
            Filter zurücksetzen
          </button>
        </div>
      </details>
    </div>
  );
}
