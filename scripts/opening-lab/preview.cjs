const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
process.env.OPENING_LAB_FIXTURE_MANIFEST = path.join(
  root,
  "output/opening-lab/fixtures.json",
);
process.env.REPLAY_EMBED_SESSION_SECRET ||= randomBytes(32).toString("hex");
const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4201",
  ],
  { cwd: root, env: process.env, stdio: "inherit", windowsHide: true },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill());
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
