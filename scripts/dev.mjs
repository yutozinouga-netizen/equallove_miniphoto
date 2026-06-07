import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";

function run(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: isWindows,
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`);
    }
  });

  return child;
}

const api = run("api", "node", ["server/import-plusmember-server.mjs"]);
const vite = run("vite", "npm", ["run", "dev:vite"]);

function shutdown() {
  api.kill();
  vite.kill();
  process.exit();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
