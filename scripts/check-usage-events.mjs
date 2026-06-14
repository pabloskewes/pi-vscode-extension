import {
  AuthStorage,
  DefaultPackageManager,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const agentDir = getAgentDir();
const settingsPath = join(agentDir, "settings.json");

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function printJSON(label, value) {
  console.log(`${label}:`, JSON.stringify(value, null, 2));
}

printHeader("Environment");
printJSON("env", {
  cwd,
  agentDir,
  settingsPath,
  settingsExists: existsSync(settingsPath),
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR ?? null,
});

const settingsManager = SettingsManager.create(cwd, agentDir);
await settingsManager.reload();
const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
const resolvedPaths = await packageManager.resolve();

printHeader("Settings");
printJSON("packages.global", settingsManager.getGlobalSettings().packages ?? []);
printJSON("packages.project", settingsManager.getProjectSettings().packages ?? []);
printJSON("packages.merged", settingsManager.getPackages());

printHeader("Package resolution");
printJSON(
  "resolved.extensions",
  resolvedPaths.extensions.map((entry) => ({
    path: entry.path,
    enabled: entry.enabled,
    source: entry.metadata?.source,
    scope: entry.metadata?.scope,
    origin: entry.metadata?.origin,
  })),
);

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const sessionManager = SessionManager.create(cwd);

const { session } = await createAgentSession({
  cwd,
  agentDir,
  authStorage,
  modelRegistry,
  settingsManager,
  sessionManager,
});

printHeader("Session resource loader");
const loaded = session.resourceLoader.getExtensions();
console.log("extensions", loaded.extensions.map((ext) => ext.path));
console.log("errors", loaded.errors);

const bus = session.resourceLoader.eventBus;
let eventCount = 0;

bus.on("usage-core:update-current", (payload) => {
  eventCount += 1;
  const providers = payload?.state?.providers ?? [];
  console.log(
    "usage update",
    providers.map((provider) => `${provider.providerId}:${provider.windows?.length ?? 0}/${provider.balances?.length ?? 0}:${provider.status}`).join(","),
  );
});

bus.on("usage-core:ready", (payload) => {
  eventCount += 1;
  console.log("usage ready", payload?.state?.providers?.length ?? 0);
});

await session.bindExtensions({
  mode: "rpc",
  onError: (err) => {
    console.error("extension error", err);
  },
});

await new Promise((resolve) => setTimeout(resolve, 3000));
await session.extensionRunner.emit({ type: "session_shutdown", reason: "debug" });
session.dispose();

if (eventCount === 0) {
  console.error("No usage-core events received.");
  if ((settingsManager.getPackages()?.length ?? 0) === 0) {
    console.error("Hint: no package sources were loaded from settings. Check access to ~/.pi/agent/settings.json and lockfile permissions.");
  }
  process.exitCode = 1;
}
