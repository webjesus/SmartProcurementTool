export type BrandLogoVariant = "FULL" | "WORDMARK" | "SYMBOL";
export type BrandBackground = "LIGHT" | "DARK";
export type BrandConfidence = "EXACT" | "ALIAS" | "UNKNOWN";

export type SupplierBrand = {
  canonicalId: string;
  displayName: string;
  shortName: string;
  aliases: string[];
  logoAsset?: string;
  logoVariant?: BrandLogoVariant;
  preferredBackground?: BrandBackground;
  fallbackInitials: string;
};

export type BrandResolution = {
  brand: SupplierBrand;
  confidence: BrandConfidence;
  matchedAlias: string | null;
};

const normalizeBrandName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("de")
    .replace(/&/g, " und ")
    .replace(/\b(gmbh|kg|se|ag|co|gruppe|haustechnik)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const initials = (value: string) => {
  const parts = value
    .replace(/&/g, " ")
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  return (parts.length > 1
    ? `${parts[0][0]}${parts[1][0]}`
    : parts[0]?.slice(0, 2) ?? "?"
  ).toLocaleUpperCase("de");
};

export const SUPPLIER_BRAND_REGISTRY_VERSION =
  "supplier-brand-registry-v1" as const;

export const SUPPLIER_BRANDS: readonly SupplierBrand[] = [
  {
    canonicalId: "gienger",
    displayName: "Wilhelm Gienger KG",
    shortName: "Gienger",
    aliases: [
      "Gienger",
      "Wilhelm Gienger",
      "Wilhelm Gienger KG",
      "Wilhelm Gienger Haustechnik",
      "Gienger München",
      "Gienger & Funk",
      "Gienger Erlstätt"
    ],
    logoAsset: "/brands/suppliers/gienger.svg",
    logoVariant: "SYMBOL",
    preferredBackground: "LIGHT",
    fallbackInitials: "GI"
  },
  {
    canonicalId: "pfeiffer-may",
    displayName: "PFEIFFER & MAY",
    shortName: "P&M",
    aliases: [
      "P&M",
      "P & M",
      "P und M",
      "PUM",
      "PuM",
      "Pfeiffer & May",
      "Pfeiffer und May",
      "PFEIFFER & MAY Gruppe"
    ],
    logoAsset: "/brands/suppliers/pm.webp",
    logoVariant: "WORDMARK",
    preferredBackground: "LIGHT",
    fallbackInitials: "PM"
  },
  {
    canonicalId: "reisser",
    displayName: "REISSER",
    shortName: "Reisser",
    aliases: ["Reisser", "REISSER", "Reisser Gruppe", "REISSER Gruppe"],
    logoAsset: "/brands/suppliers/reisser.svg",
    logoVariant: "WORDMARK",
    preferredBackground: "LIGHT",
    fallbackInitials: "RE"
  },
  {
    canonicalId: "weishaupt",
    displayName: "Max Weishaupt SE",
    shortName: "Weishaupt",
    aliases: ["Weishaupt", "Max Weishaupt", "Max Weishaupt SE"],
    logoAsset: "/brands/suppliers/weishaupt.svg",
    logoVariant: "WORDMARK",
    preferredBackground: "LIGHT",
    fallbackInitials: "WE"
  }
] as const;

const CONFIRMED_MANUFACTURERS: readonly SupplierBrand[] = [
  {
    canonicalId: "esbe",
    displayName: "ESBE",
    shortName: "ESBE",
    aliases: ["ESBE"],
    logoAsset: "/brands/manufacturers/esbe.png",
    logoVariant: "WORDMARK",
    preferredBackground: "LIGHT",
    fallbackInitials: "ES"
  },
  {
    canonicalId: "grundfos",
    displayName: "Grundfos",
    shortName: "Grundfos",
    aliases: ["Grundfos"],
    fallbackInitials: "GR"
  },
  {
    canonicalId: "reflex",
    displayName: "Reflex",
    shortName: "Reflex",
    aliases: ["Reflex"],
    logoAsset: "/brands/manufacturers/reflex.svg",
    logoVariant: "WORDMARK",
    preferredBackground: "LIGHT",
    fallbackInitials: "RE"
  }
] as const;

function resolveFromRegistry(
  value: string | null | undefined,
  registry: readonly SupplierBrand[]
): BrandResolution {
  const label = value?.trim() || "Unbekannter Anbieter";
  const normalized = normalizeBrandName(label);
  for (const brand of registry) {
    const exactNames = [brand.displayName, brand.shortName];
    const exact = exactNames.find(
      (candidate) => normalizeBrandName(candidate) === normalized
    );
    if (exact) return { brand, confidence: "EXACT", matchedAlias: exact };
    const alias = brand.aliases.find(
      (candidate) => normalizeBrandName(candidate) === normalized
    );
    if (alias) return { brand, confidence: "ALIAS", matchedAlias: alias };
  }
  return {
    brand: {
      canonicalId: `unknown:${normalized || "empty"}`,
      displayName: label,
      shortName: label,
      aliases: [label],
      fallbackInitials: initials(label)
    },
    confidence: "UNKNOWN",
    matchedAlias: null
  };
}

export function resolveSupplierBrand(
  value: string | null | undefined
): BrandResolution {
  return resolveFromRegistry(value, SUPPLIER_BRANDS);
}

export function resolveManufacturerBrand(
  value: string | null | undefined
): BrandResolution {
  return resolveFromRegistry(value, CONFIRMED_MANUFACTURERS);
}
