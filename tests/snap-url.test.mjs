import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { putuskanPengalihan, urlPembayaranDiizinkan } from "../pesanan.mjs";

test("hanya https ke host Midtrans yang boleh dialihkan", () => {
  assert.equal(urlPembayaranDiizinkan("https://app.sandbox.midtrans.com/snap/v4/redirection/abc"), true);
  assert.equal(urlPembayaranDiizinkan("https://app.midtrans.com/snap/v2/vtweb/abc?x=1"), true);
  assert.equal(urlPembayaranDiizinkan("https://APP.MIDTRANS.COM/snap/v2/vtweb/abc"), true);
  assert.equal(urlPembayaranDiizinkan("https://app.midtrans.com:443/snap/v2/vtweb/abc"), true);
  assert.equal(urlPembayaranDiizinkan("http://app.midtrans.com/snap/v2/vtweb/abc"), false);
  assert.equal(urlPembayaranDiizinkan("http://app.sandbox.midtrans.com/snap/v1/transactions"), false);
  assert.equal(urlPembayaranDiizinkan("https://evil.com/app.midtrans.com"), false);
  assert.equal(urlPembayaranDiizinkan("https://app.midtrans.com.evil.com/snap"), false);
  assert.equal(urlPembayaranDiizinkan("https://evil.app.midtrans.com/snap"), false);
  assert.equal(urlPembayaranDiizinkan("https://app.sandbox.midtrans.com.evil.com/"), false);
  assert.equal(urlPembayaranDiizinkan("https://api.sandbox.midtrans.com/v2/order/status"), false);
  assert.equal(urlPembayaranDiizinkan("https://user:pass@app.midtrans.com/snap"), false);
  assert.equal(urlPembayaranDiizinkan("https://app.midtrans.com.evil.com@app.midtrans.com/snap"), false);
  assert.equal(urlPembayaranDiizinkan("javascript:alert(1)"), false);
  assert.equal(urlPembayaranDiizinkan("data:text/html,https://app.midtrans.com"), false);
  assert.equal(urlPembayaranDiizinkan(""), false);
  assert.equal(urlPembayaranDiizinkan(null), false);
  assert.equal(urlPembayaranDiizinkan(undefined), false);
  assert.deepEqual(putuskanPengalihan(""), { redirect: false, error: "" });
  assert.deepEqual(putuskanPengalihan(null), { redirect: false, error: "" });
  const ditolak = putuskanPengalihan("https://evil.example/snap");
  assert.equal(ditolak.redirect, false);
  assert.match(ditolak.error, /Midtrans/);
  assert.deepEqual(putuskanPengalihan("https://app.sandbox.midtrans.com/snap/v4/redirection/abc"), { redirect: true, error: "" });
});

test("pesanan.mjs tidak mengalihkan sebelum URL lolos allowlist", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "../pesanan.mjs"), "utf8");
  const keputusan = source.indexOf("putuskanPengalihan(body.snap_redirect_url)");
  const assign = source.indexOf("window.location.assign(body.snap_redirect_url)");
  assert.equal(keputusan > 0, true);
  assert.equal(assign > keputusan, true);
  assert.match(source, /else if \(keputusan\.redirect\) window\.location\.assign\(body\.snap_redirect_url\)/);
  assert.equal(source.includes("esm.sh"), false);
});
