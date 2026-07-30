import { Suspense } from "react";
import {
  DEFAULT_BROWSER_UPLOAD_LIMITS,
  type BrowserUploadLimits
} from "@/browser-projects/project-service";
import { NewProjectPage } from "@/components/browser-projects/new-project-page";

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function uploadLimits(): BrowserUploadLimits {
  return {
    maxFiles: positive(
      process.env.SPT_BROWSER_MAX_FILES,
      DEFAULT_BROWSER_UPLOAD_LIMITS.maxFiles
    ),
    maxTotalBytes: positive(
      process.env.SPT_BROWSER_MAX_TOTAL_BYTES,
      DEFAULT_BROWSER_UPLOAD_LIMITS.maxTotalBytes
    ),
    maxFileBytes: positive(
      process.env.SPT_BROWSER_MAX_FILE_BYTES,
      DEFAULT_BROWSER_UPLOAD_LIMITS.maxFileBytes
    ),
    maxTotalPages: positive(
      process.env.SPT_BROWSER_MAX_TOTAL_PAGES,
      DEFAULT_BROWSER_UPLOAD_LIMITS.maxTotalPages
    )
  };
}

export default function CreateBrowserProjectPage() {
  return (
    <Suspense>
      <NewProjectPage limits={uploadLimits()} />
    </Suspense>
  );
}
