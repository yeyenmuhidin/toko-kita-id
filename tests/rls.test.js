const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("aturan RLS memisahkan penjual dan menyembunyikan yang menunggu", () => {
  const sql = path.join(__dirname, "rls.harness.sql");
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", "drop database if exists toko_kita_uji;"], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", "create database toko_kita_uji;"], { stdio: "pipe" });
  const output = execFileSync("sudo", ["-u", "postgres", "psql", "-d", "toko_kita_uji", "-v", "ON_ERROR_STOP=1", "-f", sql], { encoding: "utf8" });
  assert.equal(output.includes("UJI GAGAL"), false);
});
