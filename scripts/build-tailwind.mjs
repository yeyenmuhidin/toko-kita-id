/**
 * Menulis ulang assets/tailwind.css dari kelas yang benar-benar dipakai.
 * GitHub Pages hanya menyajikan berkas yang sudah di-commit. Jangan jadikan
 * perintah ini langkah build di Pages.
 *
 * Dari akar repositori:
 *   node scripts/build-tailwind.mjs
 *
 * Tailwind CLI 3.4.17 dipakai karena halaman sebelumnya memuat Play CDN
 * (Tailwind 3), bukan Tailwind 4. Konfigurasi ada di tailwind.config.js:
 * tidak ada kustomisasi tema di HTML. Satu kelas shadow dengan koma ada di
 * safelist karena pemindai sumber memotong argumen rgba().
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(
  "npx",
  [
    "--yes",
    "tailwindcss@3.4.17",
    "-c",
    "tailwind.config.js",
    "-i",
    "assets/tailwind.src.css",
    "-o",
    "assets/tailwind.css",
    "--minify"
  ],
  { cwd: root, stdio: "inherit" }
);
