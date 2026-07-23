import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), ".data");
const heartbeat = path.join(dataDir, "worker-heartbeat.local.json");
const intervalMs = 10_000;

async function tick() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    heartbeat,
    JSON.stringify({
      workerId: `local-${process.pid}`,
      status: "IDLE",
      updatedAt: new Date().toISOString(),
      note: "File-backed development heartbeat; production requires durable queue infrastructure."
    }),
    "utf8"
  );
}

async function main() {
  await access(process.cwd());
  await tick();
  process.stdout.write(`[worker] local worker ready (pid ${process.pid})\n`);
  const timer = setInterval(() => void tick(), intervalMs);

  const shutdown = () => {
    clearInterval(timer);
    process.stdout.write("[worker] stopped\n");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
