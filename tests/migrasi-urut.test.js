const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function psql(db, args) {
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", ...args], { stdio: "pipe" });
}

function migrationFiles() {
  const dir = path.join(__dirname, "../supabase/migrations");
  return fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort().map((name) => path.join(dir, name));
}

function assertSecure(db) {
  const sql = `
    select case when count(*) = 0 then 'AMAN' else 'DEFINER ' || string_agg(n.nspname || '.' || p.proname, ',') end
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'graphql_public');
  `;
  const exposed = execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-tA", "-c", sql], { encoding: "utf8" }).trim();
  assert.equal(exposed, "AMAN");
  const anon = execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-tA", "-c", "set role anon; select count(*) from public.etalase; select count(*) from public.profiles;"], { encoding: "utf8" });
  assert.match(anon, /0/);
}

test("migrasi segar dari nol tidak meninggalkan security definer di public", () => {
  const files = migrationFiles();
  psql("postgres", ["-c", "drop database if exists toko_kita_segar;"]);
  psql("postgres", ["-c", "create database toko_kita_segar;"]);
  psql("toko_kita_segar", ["-f", path.join(__dirname, "migrasi.preamble.sql")]);
  for (const file of files) psql("toko_kita_segar", ["-f", file]);
  assertSecure("toko_kita_segar");
});

test("kenaikan dari migrasi lama lalu berkas batas tetap aman", () => {
  const files = migrationFiles();
  const lama = files.filter((file) => !path.basename(file).includes("_batas_"));
  const batas = files.filter((file) => path.basename(file).includes("_batas_"));
  assert.ok(lama.length >= 1);
  assert.ok(batas.length >= 1);
  psql("postgres", ["-c", "drop database if exists toko_kita_naik;"]);
  psql("postgres", ["-c", "create database toko_kita_naik;"]);
  psql("toko_kita_naik", ["-f", path.join(__dirname, "migrasi.preamble.sql")]);
  for (const file of lama) psql("toko_kita_naik", ["-f", file]);
  for (const file of batas) psql("toko_kita_naik", ["-f", file]);
  assertSecure("toko_kita_naik");
});
