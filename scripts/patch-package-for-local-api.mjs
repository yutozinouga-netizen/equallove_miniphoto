import { copyFile, readFile, writeFile } from "node:fs/promises";

const packagePath = "package.json";

const raw = await readFile(packagePath, "utf-8");
const pkg = JSON.parse(raw);

await copyFile(packagePath, "package.json.bak");

pkg.scripts = pkg.scripts ?? {};

if (!pkg.scripts["dev:vite"]) {
  pkg.scripts["dev:vite"] = pkg.scripts.dev || "vite";
}

pkg.scripts.dev = "node scripts/dev.mjs";
pkg.scripts.server = "node server/import-plusmember-server.mjs";

await writeFile(packagePath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

console.log("package.json を更新しました。元のファイルは package.json.bak に保存しました。");
console.log("次回から npm run dev で React と URL取込API が同時に起動します。");
