import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PACKAGES = [
  {
    dir: resolve(import.meta.dirname, "..", "node_modules", "@earendil-works", "pi-agent-core"),
    name: "@earendil-works/pi-agent-core",
  },
  {
    dir: resolve(import.meta.dirname, "..", "node_modules", "@earendil-works", "pi-ai"),
    name: "@earendil-works/pi-ai",
  },
];

let changed = false;

for (const pkg of PACKAGES) {
  const pkgPath = resolve(pkg.dir, "package.json");
  let json;
  try {
    json = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    console.warn(`SKIP ${pkg.name}: package.json not found at ${pkgPath}`);
    continue;
  }

  if (!json.exports || typeof json.exports !== "object") {
    console.warn(`SKIP ${pkg.name}: no "exports" field (already relying on "main")`);
    continue;
  }

  for (const [entry, value] of Object.entries(json.exports)) {
    if (entry === "./package.json") continue;
    if (!value || typeof value !== "object") continue;

    if (value.default !== undefined) {
      continue;
    }

    if (value.import) {
      json.exports[entry] = { ...value, default: value.import };
      changed = true;
      console.log(`PATCH ${pkg.name}: added default -> ${value.import} for ${entry}`);
    } else {
      console.warn(`SKIP ${pkg.name}: subpath ${entry} has no "import" to duplicate as "default"`);
    }
  }

  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(json, null, 2) + "\n", "utf8");
    console.log(`SAVED ${pkg.name}`);
  } else {
    console.log(`OK    ${pkg.name}: already has default exports or nothing to patch`);
  }
}

if (!changed) {
  console.log("No changes: compat patches already applied.");
}
