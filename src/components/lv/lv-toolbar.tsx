"use client";

import { ChevronsUpDown, Search } from "lucide-react";
import { resolveSupplierBrand } from "@/domain/brand-registry";
import { BrandMark } from "./brand-mark";

export type LvSortMode =
  | "LV_ORDER"
  | "UNRESOLVED_FIRST"
  | "AUTOMATIC_FIRST"
  | "STATUS"
  | "PRICE_DIFFERENCE";
export type LvPositionFilter =
  | "ALL"
  | "SELECTED"
  | "UNSELECTED"
  | "WARNINGS";

export function LvToolbar({
  search,
  supplier,
  suppliers,
  positionFilter,
  sort,
  shown,
  total,
  onSearch,
  onSupplier,
  onPositionFilter,
  onSort,
  onExpandAll,
  onCollapseAll
}: {
  search: string;
  supplier: string;
  suppliers: string[];
  positionFilter: LvPositionFilter;
  sort: LvSortMode;
  shown: number;
  total: number;
  onSearch: (value: string) => void;
  onSupplier: (value: string) => void;
  onPositionFilter: (value: LvPositionFilter) => void;
  onSort: (value: LvSortMode) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <div className="lv-toolbar">
      <label>
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Position, Beschreibung oder Artikel suchen..."
          aria-label="LV durchsuchen"
        />
      </label>
      <div className="lv-supplier-filter">
        {supplier !== "ALL" ? (
          <BrandMark
            resolution={resolveSupplierBrand(supplier)}
            label={supplier}
            compact
          />
        ) : null}
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
      </div>
      <select
        value={positionFilter}
        onChange={(event) =>
          onPositionFilter(event.target.value as LvPositionFilter)
        }
        aria-label="Auswahl und Hinweise filtern"
      >
        <option value="ALL">Alle Positionen</option>
        <option value="SELECTED">Ausgewählt</option>
        <option value="UNSELECTED">Nicht ausgewählt</option>
        <option value="WARNINGS">Mit Hinweisen</option>
      </select>
      <select
        value={sort}
        onChange={(event) => onSort(event.target.value as LvSortMode)}
        aria-label="Sortierung"
      >
        <option value="LV_ORDER">LV-Reihenfolge</option>
      </select>
      <div className="lv-collapse-actions">
        <ChevronsUpDown size={15} />
        <button onClick={onExpandAll}>Alle öffnen</button>
        <button onClick={onCollapseAll}>Alle schließen</button>
      </div>
      <strong>{shown} von {total} Positionen</strong>
    </div>
  );
}
