// Samakan versi Docky di package.json, src-tauri/tauri.conf.json, dan Cargo.toml.
// Pemakaian: npm run version:set -- 0.2.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Pemakaian: npm run version:set -- 0.2.0");
  process.exit(1);
}

const editJson = (path) => {
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
};
editJson("package.json");
editJson("src-tauri/tauri.conf.json");

const cargo = readFileSync("Cargo.toml", "utf8");
const next = cargo.replace(/(\[workspace\.package\][^[]*?\nversion = )"[^"]+"/, `$1"${version}"`);
if (next === cargo && !cargo.includes(`version = "${version}"`)) {
  console.error("Versi di Cargo.toml tidak ditemukan.");
  process.exit(1);
}
writeFileSync("Cargo.toml", next);
console.log(`Versi Docky sekarang ${version}. Lanjutkan: cargo check, commit, lalu git tag v${version} dan push tag itu.`);
