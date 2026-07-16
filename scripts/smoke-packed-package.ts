#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const fixture = path.join(root, "packages/fixtures/demo_project");
const workspace = await mkdtemp(path.join(tmpdir(), "pi-elixir-packed-smoke-"));
const packDirectory = path.join(workspace, "pack");
const installDirectory = path.join(workspace, "install");

type EmbeddedTransport = typeof import("../packages/extension/src/embedded/stdio-process.ts");
let transport: EmbeddedTransport | undefined;

async function loadInstalledTransport(installedRoot: string): Promise<EmbeddedTransport> {
  const codingAgentPackage = path.join(
    installDirectory,
    "node_modules/@earendil-works/pi-coding-agent/package.json",
  );
  const require = createRequire(codingAgentPackage);
  const jitiPackage = require.resolve("jiti/package.json");
  const jitiModule = await import(
    pathToFileURL(path.join(path.dirname(jitiPackage), "lib/jiti.mjs")).href
  );
  const jiti = jitiModule.createJiti(path.join(installedRoot, "package.json"));

  return (await jiti.import(
    path.join(installedRoot, "packages/extension/src/embedded/stdio-process.ts"),
  )) as EmbeddedTransport;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

try {
  await mkdir(packDirectory, { recursive: true });
  execFileSync("npm", ["pack", "--pack-destination", packDirectory], {
    cwd: root,
    stdio: "pipe",
  });

  const archives = (await readdir(packDirectory)).filter((file) => file.endsWith(".tgz"));
  if (archives.length !== 1) {
    throw new Error(`Expected one npm archive, found ${archives.length}`);
  }

  const archive = path.join(packDirectory, archives[0]);
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      installDirectory,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { stdio: "pipe" },
  );

  const installedRoot = path.join(installDirectory, "node_modules/pi-elixir");
  transport = await loadInstalledTransport(installedRoot);

  process.env.PI_ELIXIR_BRIDGE_MIX_ENV = "dev";
  process.env.PI_ELIXIR_MIRROR = "0";
  process.env.PI_ELIXIR_PLUGINS = "0";
  process.env.PI_ELIXIR_SKILLS = "0";

  transport.startEmbeddedInBackground(fixture);
  await waitUntil(() => transport.isEmbeddedReady(fixture), 120_000);

  const info = transport.getBridgeInfo(fixture);
  const result = await transport.callEmbeddedTool(fixture, "project_eval_structured", {
    code: "{Mix.Project.config()[:app], 6 * 7}",
  });

  if (result.isError) throw new Error(result.text);
  if (info?.build === undefined || !info.build.startsWith("pi_bridge@")) {
    throw new Error(
      `Packed bridge returned invalid build metadata: ${JSON.stringify(info ?? null)}`,
    );
  }

  const payload = JSON.parse(result.text) as { result?: string };
  if (payload.result !== "{:pi_demo_project, 42}") {
    throw new Error(`Packed project eval returned unexpected result: ${result.text}`);
  }

  console.log(`Packed artifact smoke ok: ${info.build} · ${payload.result}`);
} finally {
  transport?.stopEmbedded(fixture);
  await rm(workspace, { recursive: true, force: true });
}
