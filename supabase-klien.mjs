import { createClient } from "./vendor/supabase-js.mjs";
import { konfigurasiAman } from "./akun.mjs";

var klien = null;

export function klienToko(cfg) {
  if (klien) return klien;
  var sumber = cfg || (typeof window !== "undefined" && window.TOKO_KITA_SUPABASE) || {};
  var konfigurasi = konfigurasiAman(sumber);
  if (!konfigurasi.ok) return null;
  klien = createClient(konfigurasi.url, konfigurasi.publishableKey);
  return klien;
}
