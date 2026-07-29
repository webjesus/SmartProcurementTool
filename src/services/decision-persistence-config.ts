import {
  deploymentMode,
  type DeploymentEnvironment
} from "@/services/deployment-profile";

export type DecisionPersistenceMode =
  | "CENTRAL_SERVER"
  | "LEGACY_LOCAL"
  | "VERCEL_READ_ONLY";

export class DecisionPersistenceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionPersistenceConfigurationError";
  }
}

export function decisionPersistenceMode(
  environment: DeploymentEnvironment = process.env
): DecisionPersistenceMode {
  if (deploymentMode(environment) === "VERCEL_PREVIEW") {
    return "VERCEL_READ_ONLY";
  }
  const mode = environment.DECISION_PERSISTENCE_MODE;
  if (mode !== "CENTRAL_SERVER" && mode !== "LEGACY_LOCAL") {
    throw new DecisionPersistenceConfigurationError(
      "DECISION_PERSISTENCE_MODE must be explicitly set to CENTRAL_SERVER or LEGACY_LOCAL."
    );
  }
  if (mode === "CENTRAL_SERVER" && !environment.DATABASE_URL) {
    throw new DecisionPersistenceConfigurationError(
      "DATABASE_URL is required when DECISION_PERSISTENCE_MODE=CENTRAL_SERVER; no fallback is available."
    );
  }
  return mode;
}

export function centralDecisionUiEnabled(
  environment: DeploymentEnvironment = process.env
): boolean {
  if (deploymentMode(environment) === "VERCEL_PREVIEW") return false;
  return environment.DECISION_PERSISTENCE_MODE !== "LEGACY_LOCAL";
}
