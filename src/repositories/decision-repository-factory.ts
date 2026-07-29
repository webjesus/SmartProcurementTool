import { decisionPersistenceMode } from "@/services/decision-persistence-config";

export async function getDecisionUnitOfWork() {
  if (decisionPersistenceMode() !== "CENTRAL_SERVER") {
    throw new Error("PERSISTENCE_UNAVAILABLE");
  }
  const [{ getDecisionDatabase }, { createPostgresDecisionUnitOfWork }] =
    await Promise.all([
      import("@/db/client"),
      import("@/repositories/postgres-decision-repositories")
    ]);
  return createPostgresDecisionUnitOfWork(getDecisionDatabase());
}
