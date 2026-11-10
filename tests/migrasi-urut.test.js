const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const canonical = path.join(__dirname, "../supabase/pemasangan/toko_kita_pemasangan_awal.sql");

function psql(db, args) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
}

test("folder migrasi tidak lagi memasang enam berkas lama", () => {
  const dir = path.join(__dirname, "../supabase/migrations");
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".sql")) : [];
  assert.deepEqual(names, []);
  assert.equal(fs.existsSync(canonical), true);
});

test("pemasangan kanonik dari nol tidak meninggalkan security definer di public", () => {
  psql("postgres", ["-c", "drop database if exists toko_kita_segar;"]);
  psql("postgres", ["-c", "create database toko_kita_segar;"]);
  psql("toko_kita_segar", ["-f", path.join(__dirname, "migrasi.preamble.sql")]);
  psql("toko_kita_segar", ["-f", canonical]);
  const exposed = psql("toko_kita_segar", ["-tA", "-c", "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('public', 'graphql_public')"]).trim();
  assert.equal(exposed, "0");
  const anon = psql("toko_kita_segar", ["-tA", "-c", "set role anon; select count(*)::text from public.etalase;"]);
  assert.match(anon, /0/);
});

test("kegagalan di dalam transaksi membatalkan seluruh pemasangan", () => {
  psql("postgres", ["-c", "drop database if exists toko_kita_batal;"]);
  psql("postgres", ["-c", "create database toko_kita_batal;"]);
  psql("toko_kita_batal", ["-f", path.join(__dirname, "migrasi.preamble.sql")]);
  let failed = false;
  try {
    psql("toko_kita_batal", ["-f", path.join(__dirname, "pemasangan-batal.sql")]);
  } catch (error) {
    failed = true;
  }
  assert.equal(failed, true);
  const products = psql("toko_kita_batal", ["-tA", "-c", "select to_regclass('public.products') is null"]).trim();
  const posisi = psql("toko_kita_batal", ["-tA", "-c", "select to_regclass('public.posisi_stok') is null"]).trim();
  assert.equal(products, "t");
  assert.equal(posisi, "t");
});
