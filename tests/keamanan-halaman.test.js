const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; font-src 'self'; connect-src 'self' https://xlsbhvpveivhbqikmxxp.supabase.co wss://xlsbhvpveivhbqikmxxp.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'";

test("setiap halaman memuat CSS lokal, CSP, dan referrer tanpa skrip pihak ketiga", () => {
  assert.deepEqual(htmlFiles.sort(), ["admin.html", "index.html", "kelola.html", "masuk.html", "penjual.html", "pesanan.html", "uji-admin.html"]);
  htmlFiles.forEach((name) => {
    const html = fs.readFileSync(path.join(root, name), "utf8");
    assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin" \/>/, name);
    assert.match(html, new RegExp(`<meta http-equiv="Content-Security-Policy" content="${csp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" \\/>`), name);
    assert.equal(html.includes("unsafe-inline"), false, name);
    assert.equal(html.includes("unsafe-eval"), false, name);
    assert.equal(html.includes("cdn.tailwindcss.com"), false, name);
    assert.equal(html.includes("cdnjs.cloudflare.com"), false, name);
    assert.equal(/<style[\s>]/i.test(html), false, name);
    assert.match(html, /href="assets\/tailwind\.css"/, name);
    const sources = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    sources.forEach((source) => {
      assert.equal(/^https?:/i.test(source), false, name + " " + source);
      assert.equal(source.includes("integrity="), false);
    });
  });
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(index, /href="assets\/fontawesome\/css\/all\.min\.css"/);
  assert.match(index, /href="assets\/index\.css"/);
  assert.match(fs.readFileSync(path.join(root, "kelola.html"), "utf8"), /href="assets\/kelola\.css"/);
});

test("modul peramban tidak mengimpor skrip pihak ketiga", () => {
  const files = fs.readdirSync(root).filter((name) => name.endsWith(".mjs") || name.endsWith(".js"));
  files.forEach((name) => {
    const source = fs.readFileSync(path.join(root, name), "utf8");
    assert.equal(source.includes("esm.sh"), false, name);
    assert.equal(source.includes("cdn.tailwindcss.com"), false, name);
  });
  assert.match(fs.readFileSync(path.join(root, "marketplace.mjs"), "utf8"), /from "\.\/vendor\/supabase-js\.mjs"/);
});
