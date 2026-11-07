import test from "node:test";
import assert from "node:assert/strict";
import { indikatorStok } from "../admin-ui.mjs";

test("indikator stok membedakan cukup, batas menipis, habis, dan belum diatur", () => {
  assert.equal(indikatorStok({ on_hand: 6, available: 6, low_stock_threshold: 3, contoh: false }), "Cukup");
  assert.equal(indikatorStok({ on_hand: 2, available: 2, low_stock_threshold: 2, contoh: false }), "Menipis");
  assert.equal(indikatorStok({ on_hand: 0, available: 0, low_stock_threshold: 1, contoh: false }), "Habis");
  assert.equal(indikatorStok({ on_hand: null, available: null, low_stock_threshold: null, contoh: false }), "Belum diatur, tidak dijual");
  assert.equal(indikatorStok({ on_hand: 4, available: 4, low_stock_threshold: 1, contoh: true }), "Belum diatur, tidak dijual");
});
