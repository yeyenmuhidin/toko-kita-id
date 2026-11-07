const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("pesanan menolak manipulasi harga, demo, dan webhook palsu", () => {
  const dir = __dirname;
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", "drop database if exists toko_kita_pesanan;"], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", "create database toko_kita_pesanan;"], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "toko_kita_pesanan", "-v", "ON_ERROR_STOP=1", "-f", path.join(dir, "rls.harness.sql")], { stdio: "pipe" });
  const output = execFileSync("sudo", ["-u", "postgres", "psql", "-d", "toko_kita_pesanan", "-v", "ON_ERROR_STOP=1", "-f", path.join(dir, "pesanan.extra.sql")], { encoding: "utf8" });
  assert.equal(output.includes("UJI GAGAL"), false);
});
