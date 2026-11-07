const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("penjual melihat cadangan sendiri tanpa pesanan penjual lain", () => {
  const dir = __dirname;
  const db = "toko_kita_posisi";
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `drop database if exists ${db};`], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `create database ${db};`], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", path.join(dir, "migrasi.preamble.sql")], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", path.join(dir, "../supabase/pemasangan/toko_kita_pemasangan_awal.sql")], { stdio: "pipe" });
  const output = execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", path.join(dir, "posisi-penjual.sql")], { encoding: "utf8" });
  assert.equal(output.includes("UJI GAGAL"), false);
});
