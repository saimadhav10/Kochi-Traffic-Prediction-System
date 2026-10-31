import { spawn, execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { loadSettings, projectRoot, tomTomKey } from "./environment.mjs";

// Never put credential values in process arguments or inherit verbose provider errors.
let directory;
let secretFile;
try {
  execFileSync("git", ["check-ignore", "-q", ".env"], {
    cwd: projectRoot,
    stdio: "pipe",
  });
  const settings = loadSettings();
  const key = tomTomKey(settings);
  let salt = settings.QUOTA_SALT?.trim();
  if (!salt) {
    salt = randomBytes(32).toString("hex");
    appendFileSync(join(projectRoot, ".env"), `\nQUOTA_SALT=${salt}\n`, {
      mode: 0o600,
    });
  }
  if (salt.length < 32) throw new Error("Invalid quota salt");
  const secrets = [key, salt];
  const files = (path) =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(path, entry.name))
        : [join(path, entry.name)],
    );
  for (const path of files(join(projectRoot, "dist"))) {
    const data = readFileSync(path);
    if (
      secrets.some(
        (value) =>
          data.includes(Buffer.from(value)) ||
          data.includes(Buffer.from(encodeURIComponent(value))),
      )
    )
      throw new Error("Unsafe build");
  }
  directory = mkdtempSync(join(tmpdir(), "kochi-deploy-"));
  secretFile = join(directory, "secrets.json");
  writeFileSync(
    secretFile,
    JSON.stringify({ TOMTOM_API_KEY: key, QUOTA_SALT: salt }),
    { mode: 0o600, flag: "wx" },
  );
  const child = spawn(
    process.execPath,
    [
      join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
      "deploy",
      "--strict",
      "--secrets-file",
      secretFile,
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const redact = (text) =>
    secrets.reduce(
      (result, value) => result.split(value).join("[redacted]"),
      text,
    );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  console.log(redact(output));
  if (code !== 0) process.exitCode = 1;
} catch {
  console.error(
    "Deployment could not complete. Check the build, ignored local credentials, and Cloudflare authentication. Credential details were withheld.",
  );
  process.exitCode = 1;
} finally {
  if (secretFile) {
    try {
      unlinkSync(secretFile);
    } catch {
      console.error(
        "Remove the temporary deployment secrets file from your user temp folder.",
      );
      process.exitCode = 1;
    }
  }
  if (directory) {
    try {
      rmdirSync(directory);
    } catch {
      /* Non-recursive cleanup only. */
    }
  }
}
