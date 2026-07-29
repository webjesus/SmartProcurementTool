"use client";

import { useState } from "react";
import type { BrandResolution } from "@/domain/brand-registry";

export function BrandMark({
  resolution,
  label,
  compact = false,
  allowFallback = true
}: {
  resolution: BrandResolution;
  label: string;
  compact?: boolean;
  allowFallback?: boolean;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const asset =
    resolution.confidence !== "UNKNOWN" && !assetFailed
      ? resolution.brand.logoAsset
      : undefined;
  return (
    <span
      className={`supplier-brand-mark ${compact ? "compact" : ""}`}
      data-brand-id={resolution.brand.canonicalId}
      data-brand-confidence={resolution.confidence}
    >
      {asset ? (
        // Local static assets are intentionally used without runtime hotlinks.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset}
          alt={`${resolution.brand.shortName} Logo`}
          onError={() => setAssetFailed(true)}
        />
      ) : allowFallback ? (
        <span className="brand-fallback" aria-hidden="true">
          {resolution.brand.fallbackInitials}
        </span>
      ) : null}
      <span className="brand-label">{label}</span>
    </span>
  );
}
