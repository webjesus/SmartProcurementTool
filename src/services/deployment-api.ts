import { NextResponse } from "next/server";

export const PREVIEW_PERSISTENCE_ERROR = {
  error: "PERSISTENCE_UNAVAILABLE",
  message: "Server persistence is unavailable in preview mode."
} as const;

export function previewPersistenceResponse(): NextResponse {
  return NextResponse.json(PREVIEW_PERSISTENCE_ERROR, { status: 503 });
}

export function previewLocalDataResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "LOCAL_DATA_UNAVAILABLE",
      message: "Local corpus data is unavailable in preview mode."
    },
    { status: 503 }
  );
}
