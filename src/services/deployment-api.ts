import { NextResponse } from "next/server";

export const BROWSER_LOCAL_PERSISTENCE_ERROR = {
  error: "PERSISTENCE_UNAVAILABLE",
  message: "Server persistence is unavailable in browser-local mode."
} as const;

export function previewPersistenceResponse(): NextResponse {
  return NextResponse.json(BROWSER_LOCAL_PERSISTENCE_ERROR, { status: 503 });
}

export function previewLocalDataResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "LOCAL_DATA_UNAVAILABLE",
      message: "Server-local corpus data is unavailable in browser-local mode."
    },
    { status: 503 }
  );
}
