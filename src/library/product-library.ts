export type ProductStatus = "CONFIRMED" | "REVIEW_REQUIRED";

export type ProductAttribute = Readonly<{
  name: string;
  value: string;
}>;

export type SupplierProductAlias = Readonly<{
  supplierId: string;
  supplierLabel: string;
  supplierArticleReference: string;
}>;

export type CanonicalProduct = {
  id: string;
  version: number;
  status: ProductStatus;
  productName: string;
  manufacturer: string;
  model: string;
  category: string;
  application: string;
  technicalAttributes: ProductAttribute[];
  supplierAliases: SupplierProductAlias[];
  documentCount: number;
  usageCount: number;
  updatedAt: string;
};

export type ProductLibraryFilter = {
  query?: string;
  category?: string;
  manufacturer?: string;
};

function searchText(product: CanonicalProduct): string {
  return [
    product.productName,
    product.manufacturer,
    product.model,
    product.category,
    product.application,
    ...product.technicalAttributes.flatMap((attribute) => [
      attribute.name,
      attribute.value
    ]),
    ...product.supplierAliases.flatMap((alias) => [
      alias.supplierLabel,
      alias.supplierArticleReference
    ])
  ]
    .join(" ")
    .toLocaleLowerCase("de");
}
export function filterConfirmedProducts(
  products: readonly CanonicalProduct[],
  filter: ProductLibraryFilter = {}
): CanonicalProduct[] {
  const query = filter.query?.trim().toLocaleLowerCase("de") ?? "";
  return products
    .filter((product) => product.status === "CONFIRMED")
    .filter(
      (product) =>
        !filter.category || product.category === filter.category
    )
    .filter(
      (product) =>
        !filter.manufacturer || product.manufacturer === filter.manufacturer
    )
    .filter((product) => !query || searchText(product).includes(query))
    .sort((left, right) =>
      left.productName.localeCompare(right.productName, "de")
    );
}

export type ProjectProductSnapshot = Readonly<{
  id: string;
  projectId: string;
  sourceProductId: string;
  sourceProductVersion: number;
  productName: string;
  manufacturer: string;
  model: string;
  category: string;
  application: string;
  technicalAttributes: readonly ProductAttribute[];
  createdAt: string;
}>;

export function createProjectProductSnapshot(
  product: CanonicalProduct,
  projectId: string,
  createdAt: string
): ProjectProductSnapshot {
  if (product.status !== "CONFIRMED") {
    throw new Error("PRODUCT_MUST_BE_CONFIRMED");
  }
  if (!projectId.trim()) throw new Error("PROJECT_ID_REQUIRED");
  const technicalAttributes = product.technicalAttributes.map((attribute) =>
    Object.freeze({ ...attribute })
  );
  return Object.freeze({
    id: crypto.randomUUID(),
    projectId,
    sourceProductId: product.id,
    sourceProductVersion: product.version,
    productName: product.productName,
    manufacturer: product.manufacturer,
    model: product.model,
    category: product.category,
    application: product.application,
    technicalAttributes: Object.freeze(technicalAttributes),
    createdAt
  });
}
