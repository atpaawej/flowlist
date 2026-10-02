/**
 * Dev/start launcher: runs inside the Bun runtime so `.env.local` is loaded
 * into process.env, then passes the configured PORT explicitly to Next.js.
 *
 *   bun scripts/dev.ts        → next dev -p $PORT
 *   bun scripts/dev.ts start  → next start -p $PORT
 */
import { spawn } from "node:child_process";

const mode = process.argv[2] === "start" ? "start" : "dev";
const port = process.env.PORT ?? "4565";

console.log(`[flowlist] starting next ${mode} on port ${port}`);

const child = spawn("bun", ["run", "next", mode, "-p", port], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
