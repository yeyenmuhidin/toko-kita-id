const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("stok fisik, cadangan, dan webhook tetap konsisten", () => {
  const dir = __dirname;
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", "drop database if exists toko_kita_stok;"], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", "create database toko_kita_stok;"], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "toko_kita_stok", "-v", "ON_ERROR_STOP=1", "-f", path.join(dir, "rls.harness.sql")], { stdio: "pipe" });
  const output = execFileSync("sudo", ["-u", "postgres", "psql", "-d", "toko_kita_stok", "-v", "ON_ERROR_STOP=1", "-f", path.join(dir, "stok.extra.sql")], { encoding: "utf8" });
  assert.equal(output.includes("UJI GAGAL"), false);
});
