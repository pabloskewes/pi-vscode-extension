import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";

const cwd = process.cwd();
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const sessionManager = SessionManager.create(cwd);

const { session } = await createAgentSession({
  cwd,
  authStorage,
  modelRegistry,
  sessionManager,
});

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
  process.exitCode = 1;
}
