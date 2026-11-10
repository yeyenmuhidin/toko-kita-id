const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const dir = __dirname;
const canonical = path.join(dir, "../supabase/pemasangan/toko_kita_pemasangan_awal.sql");

function psql(db, file) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8" });
}

function fresh(name) {
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `drop database if exists ${name};`], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `create database ${name};`], { stdio: "pipe" });
  psql(name, path.join(dir, "migrasi.preamble.sql"));
  psql(name, path.join(dir, "acl-bawaan.sql"));
}

test("hak efektif postgres tidak mewarisi default anon", () => {
  fresh("toko_kita_acl_pg");
  psql("toko_kita_acl_pg", canonical);
  const output = psql("toko_kita_acl_pg", path.join(dir, "acl-periksa.sql"));
  assert.equal(output.includes("UJI GAGAL"), false);
});

test("hak efektif supabase_admin tidak mewarisi default anon", () => {
  fresh("toko_kita_acl_admin");
  psql("toko_kita_acl_admin", path.join(dir, "acl-pasang-admin.sql"));
  const output = psql("toko_kita_acl_admin", path.join(dir, "acl-periksa.sql"));
  assert.equal(output.includes("UJI GAGAL"), false);
});
