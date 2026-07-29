import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "@/db/schema";

type DecisionDatabase = PostgresJsDatabase<typeof schema>;

const databaseGlobal = globalThis as typeof globalThis & {
  __sptDecisionSql?: Sql;
  __sptDecisionDb?: DecisionDatabase;
};

export class CentralDatabaseUnavailableError extends Error {
  constructor() {
    super(
      "DATABASE_URL is required for CENTRAL_SERVER decision persistence."
    );
    this.name = "CentralDatabaseUnavailableError";
  }
}

export function getDecisionDatabase(): DecisionDatabase {
  if (databaseGlobal.__sptDecisionDb) return databaseGlobal.__sptDecisionDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new CentralDatabaseUnavailableError();
  const sql = postgres(url, {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });
  const database = drizzle(sql, { schema });
  databaseGlobal.__sptDecisionSql = sql;
  databaseGlobal.__sptDecisionDb = database;
  return database;
}

export type { DecisionDatabase };
