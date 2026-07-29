import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const port = process.env.SPT_E2E_PORT ?? "3000";
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1"], {
  cwd: root,
  env: { ...process.env, PORT: port },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => process.stdout.write(`[web] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[web] ${chunk}`));

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited before E2E startup with code ${server.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Startup connection failures are expected until the server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the E2E web server.");
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function main() {
  let testExitCode = 1;
  try {
    await waitForServer();
    const tests = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
      cwd: root,
      env: {
        ...process.env,
        SPT_E2E_EXTERNAL_SERVER: "true",
        SPT_E2E_BASE_URL: baseUrl
      },
      stdio: "inherit"
    });
    testExitCode = await new Promise<number>((resolve) => {
      tests.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await stopServer();
  }
  process.exitCode = testExitCode;
}

main().catch(async (error) => {
  console.error(error);
  await stopServer();
  process.exitCode = 1;
});
