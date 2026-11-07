import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lingkunganDiizinkan, statusDariGateway, tandaTanganCocok, tandaTanganMidtrans } from "../supabase/functions/_shared/midtrans.js";

test("tanda tangan Midtrans dan lingkungan produksi", async () => {
  const expected = createHash("sha512").update("order20010000.00server").digest("hex");
  assert.equal(await tandaTanganMidtrans("order", "200", "10000.00", "server"), expected);
  assert.equal(await tandaTanganCocok({ order_id: "order", status_code: "200", gross_amount: "10000.00", signature_key: expected }, "server"), true);
  assert.equal(await tandaTanganCocok({ order_id: "order", status_code: "200", gross_amount: "10000.00", signature_key: "palsu" }, "server"), false);
  assert.equal(statusDariGateway("settlement", "accept"), "dibayar");
  assert.equal(statusDariGateway("capture", "deny"), null);
  assert.equal(statusDariGateway("expire", "accept"), "kedaluwarsa");
  assert.equal(lingkunganDiizinkan("sandbox"), true);
  assert.equal(lingkunganDiizinkan("production"), false);
});
