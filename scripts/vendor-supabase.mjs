/**
 * Menulis ulang vendor/supabase-js.mjs.
 * Bundel ESM satu berkas dari @supabase/supabase-js@2.81.1, tanpa impor ke
 * esm.sh atau host lain. Halaman memuat berkas lokal ini.
 *
 * Dari akar repositori:
 *   node scripts/vendor-supabase.mjs
 *
 * esbuild 0.25.10 hanya alat pembuat. Hasilnya yang di-commit.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(path.join(tmpdir(), "supabase-vendor-"));
const out = path.join(root, "vendor", "supabase-js.mjs");
execFileSync("npm", ["init", "-y"], { cwd: dir, stdio: "inherit" });
execFileSync("npm", ["install", "--silent", "@supabase/supabase-js@2.81.1", "esbuild@0.25.10"], { cwd: dir, stdio: "inherit" });
execFileSync(
  "npx",
  [
    "esbuild",
    "node_modules/@supabase/supabase-js/dist/module/index.js",
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--target=es2020",
    `--outfile=${out}`
  ],
  { cwd: dir, stdio: "inherit" }
);
