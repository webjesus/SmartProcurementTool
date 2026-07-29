import { getDecisionDatabase } from "@/db/client";
import { createPostgresDecisionUnitOfWork } from "@/repositories/postgres-decision-repositories";

export function getDecisionUnitOfWork() {
  return createPostgresDecisionUnitOfWork(getDecisionDatabase());
}
