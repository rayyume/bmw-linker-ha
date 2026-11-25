import { readFileSync, writeFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const placeholder = "/* generated bridge */ null";
const installer = read("./install-bridge.js");
if (!installer.includes(placeholder)) {
  throw new Error("Expected a bridge placeholder in the installer");
}

const script = installer.replace(placeholder, () => JSON.stringify(read("./webhook-patch.js")));
writeFileSync(new URL("../bmw-linker-ha-setup.js", import.meta.url), script);
