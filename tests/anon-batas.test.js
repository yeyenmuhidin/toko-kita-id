const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

function psql(db, file) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8" });
}

test("anon membaca etalase tanpa mengeksekusi fungsi admin", () => {
  const dir = __dirname;
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", "drop database if exists toko_kita_anon;"], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", "create database toko_kita_anon;"], { stdio: "pipe" });
  psql("toko_kita_anon", path.join(dir, "rls.harness.sql"));
  const output = psql("toko_kita_anon", path.join(dir, "anon-batas.sql"));
  assert.equal(output.includes("UJI GAGAL"), false);
});
