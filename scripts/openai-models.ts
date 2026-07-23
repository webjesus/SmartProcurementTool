import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const documentedCompatibleModels = [
  "gpt-5.6-sol",
  "gpt-5.6",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5"
] as const;

async function readLocalEnv(): Promise<Record<string, string>> {
  const content = await readFile(path.resolve(process.cwd(), ".env.local"), "utf8");
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const name = line.slice(0, separator).trim();
        const raw = line.slice(separator + 1).trim();
        const value =
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
            ? raw.slice(1, -1)
            : raw;
        return [name, value];
      })
  );
}

async function main() {
  const localEnv = await readLocalEnv();
  const apiKey = localEnv.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing from .env.local.");
  }

  const client = new OpenAI({
    apiKey,
    timeout: 30_000,
    maxRetries: 1
  });
  const available = new Set<string>();
  for await (const model of client.models.list()) available.add(model.id);

  const compatible = documentedCompatibleModels.filter((model) => available.has(model));
  const selected = compatible[0];
  if (!selected) {
    throw new Error(
      "Connection succeeded, but no account model matches the documented Responses API + image input + Structured Outputs catalog."
    );
  }

  process.stdout.write("OpenAI connection: OK\n");
  process.stdout.write(`Account models discovered: ${available.size}\n`);
  process.stdout.write(
    `Compatible account models: ${compatible.length > 0 ? compatible.join(", ") : "none"}\n`
  );
  process.stdout.write(`Selected model ID: ${selected}\n`);
  process.stdout.write(
    "Capability source: official OpenAI model catalog; account access source: GET /v1/models.\n"
  );

  const missing: string[] = [];
  if (!localEnv.OPENAI_EXTRACTION_MODEL) {
    missing.push(`OPENAI_EXTRACTION_MODEL=${selected}`);
  }
  if (!localEnv.OPENAI_RECHECK_MODEL) {
    missing.push(`OPENAI_RECHECK_MODEL=${selected}`);
  }
  if (missing.length > 0) {
    process.stdout.write("Add these exact lines to .env.local:\n");
    process.stdout.write(`${missing.join("\n")}\n`);
    process.stdout.write(".env.local was not modified.\n");
  }
}

main().catch((error: unknown) => {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
  const suffix = status ? ` (HTTP ${status})` : "";
  console.error(`OpenAI model discovery failed${suffix}. Check the key and account access.`);
  process.exitCode = 1;
});
