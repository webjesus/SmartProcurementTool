export type SptDeploymentMode = "LOCAL_ON_PREM" | "VERCEL_PREVIEW";
export type DeploymentEnvironment = Record<string, string | undefined>;

function isVercelEnvironment(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function deploymentMode(
  environment: DeploymentEnvironment = process.env
): SptDeploymentMode {
  const explicit = environment.SPT_DEPLOYMENT_MODE;
  if (explicit === "LOCAL_ON_PREM" || explicit === "VERCEL_PREVIEW") {
    return explicit;
  }
  if (explicit) {
    throw new Error(
      "SPT_DEPLOYMENT_MODE must be LOCAL_ON_PREM or VERCEL_PREVIEW."
    );
  }
  return isVercelEnvironment(environment.VERCEL)
    ? "VERCEL_PREVIEW"
    : "LOCAL_ON_PREM";
}

export function isVercelPreview(
  environment: DeploymentEnvironment = process.env
): boolean {
  return deploymentMode(environment) === "VERCEL_PREVIEW";
}

export function localCorpusEnabled(
  environment: DeploymentEnvironment = process.env
): boolean {
  return (
    deploymentMode(environment) === "LOCAL_ON_PREM" &&
    environment.LOCAL_CORPUS_ENABLED === "true"
  );
}
