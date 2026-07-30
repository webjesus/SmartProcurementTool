export type SptDeploymentMode = "LOCAL_ON_PREM" | "BROWSER_LOCAL";
export type DeploymentEnvironment = Record<string, string | undefined>;

function isVercelEnvironment(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function deploymentMode(
  environment: DeploymentEnvironment = process.env
): SptDeploymentMode {
  const explicit = environment.SPT_DEPLOYMENT_MODE;
  if (explicit === "LOCAL_ON_PREM" || explicit === "BROWSER_LOCAL") {
    return explicit;
  }
  if (explicit === "VERCEL_PREVIEW") return "BROWSER_LOCAL";
  if (explicit) {
    throw new Error(
      "SPT_DEPLOYMENT_MODE must be LOCAL_ON_PREM or BROWSER_LOCAL."
    );
  }
  return isVercelEnvironment(environment.VERCEL)
    ? "BROWSER_LOCAL"
    : "LOCAL_ON_PREM";
}

export function isBrowserLocal(
  environment: DeploymentEnvironment = process.env
): boolean {
  return deploymentMode(environment) === "BROWSER_LOCAL";
}

/** @deprecated Compatibility alias for routes created before BROWSER_LOCAL. */
export const isVercelPreview = isBrowserLocal;

export function localCorpusEnabled(
  environment: DeploymentEnvironment = process.env
): boolean {
  return (
    deploymentMode(environment) === "LOCAL_ON_PREM" &&
    environment.LOCAL_CORPUS_ENABLED === "true"
  );
}
