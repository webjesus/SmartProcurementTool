export type DecisionPersistenceMode = "CENTRAL_SERVER" | "LEGACY_LOCAL";

export function decisionPersistenceMode(): DecisionPersistenceMode {
  const mode = process.env.DECISION_PERSISTENCE_MODE;
  if (mode !== "CENTRAL_SERVER" && mode !== "LEGACY_LOCAL") {
    throw new Error(
      "DECISION_PERSISTENCE_MODE must be explicitly set to CENTRAL_SERVER or LEGACY_LOCAL."
    );
  }
  if (mode === "CENTRAL_SERVER" && !process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required when DECISION_PERSISTENCE_MODE=CENTRAL_SERVER; no fallback is available."
    );
  }
  return mode;
}
