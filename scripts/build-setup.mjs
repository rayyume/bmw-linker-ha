import { readFileSync, writeFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const placeholder = "/* generated bridge */ null";
const installer = read("./install-bridge.js");
if (!installer.includes(placeholder)) {
  throw new Error("Expected a bridge placeholder in the installer");
}

const script = installer.replace(placeholder, () => JSON.stringify(read("./webhook-patch.js")));
writeFileSync(new URL("../bmw-linker-ha-setup.js", import.meta.url), script);

const scriptable = {
  always_run_in_app: true,
  icon: { color: "blue", glyph: "mobile-alt" },
  name: "bmw-linker-ha-setup",
  script,
  share_sheet_inputs: [],
};
writeFileSync(
  new URL("../bmw-linker-ha-setup.scriptable", import.meta.url),
  JSON.stringify(scriptable, null, 2) + "\n",
);
