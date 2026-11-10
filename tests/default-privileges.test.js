const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
const migration = fs.readdirSync(path.join(dir, "../supabase/migrations")).find((name) => name.endsWith("_cabut_default_privileges_public.sql"));

function psql(db, args) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
}

function fresh(name) {
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `drop database if exists ${name};`], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `create database ${name};`], { stdio: "pipe" });
  psql(name, ["-f", path.join(dir, "migrasi.preamble.sql")]);
}

function acl(db, sql) {
  return psql(db, ["-tA", "-c", sql]).trim();
}

test("migrasi mencabut default masa depan dan membiarkan grant yang sudah ada", () => {
  fresh("toko_kita_defacl");
  psql("toko_kita_defacl", ["-f", path.join(dir, "acl-bawaan.sql")]);
  psql("toko_kita_defacl", ["-c", "create table public.sudah_ada (id int);"]);
  psql("toko_kita_defacl", ["-c", "set role supabase_admin; create table public.sudah_admin (id int); reset role;"]);
  psql("toko_kita_defacl", ["-f", path.join(dir, "../supabase/migrations", migration)]);
  assert.equal(acl("toko_kita_defacl", "select has_table_privilege('anon', 'public.sudah_ada', 'SELECT')"), "t");
  assert.equal(acl("toko_kita_defacl", "select has_table_privilege('anon', 'public.sudah_admin', 'SELECT')"), "t");
  psql("toko_kita_defacl", ["-c", "create table public.baru (id int); create sequence public.seq_baru; create function public.fn_baru() returns int language sql as $$ select 1 $$;"]);
  psql("toko_kita_defacl", ["-c", "set role supabase_admin; create table public.baru_admin (id int); create sequence public.seq_admin; create function public.fn_admin() returns int language sql as $$ select 1 $$; reset role;"]);
  assert.equal(acl("toko_kita_defacl", "select has_table_privilege('anon', 'public.baru', 'SELECT')"), "f");
  assert.equal(acl("toko_kita_defacl", "select has_table_privilege('authenticated', 'public.baru', 'INSERT')"), "f");
  assert.equal(acl("toko_kita_defacl", "select has_table_privilege('service_role', 'public.baru', 'SELECT')"), "t");
  assert.equal(acl("toko_kita_defacl", "select has_table_privilege('anon', 'public.baru_admin', 'SELECT')"), "f");
  assert.equal(acl("toko_kita_defacl", "select has_table_privilege('authenticated', 'public.baru_admin', 'SELECT')"), "f");
  assert.equal(acl("toko_kita_defacl", "select has_table_privilege('service_role', 'public.baru_admin', 'SELECT')"), "t");
  assert.equal(acl("toko_kita_defacl", "select has_sequence_privilege('anon', 'public.seq_baru', 'USAGE')"), "f");
  assert.equal(acl("toko_kita_defacl", "select has_sequence_privilege('service_role', 'public.seq_baru', 'USAGE')"), "t");
  assert.equal(acl("toko_kita_defacl", "select has_sequence_privilege('anon', 'public.seq_admin', 'USAGE')"), "f");
  const fn = acl("toko_kita_defacl", "select proacl::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fn_baru'");
  const fnAdmin = acl("toko_kita_defacl", "select proacl::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fn_admin'");
  assert.equal(fn.includes("anon="), false);
  assert.equal(fn.includes("authenticated="), false);
  assert.equal(fn.includes("service_role="), true);
  assert.equal(fnAdmin.includes("anon="), false);
  assert.equal(fnAdmin.includes("authenticated="), false);
  assert.equal(fnAdmin.includes("service_role="), true);
});

test("blok supabase_admin di migrasi tidak menggagalkan sesi yang tidak berhak", () => {
  fresh("toko_kita_defacl_tolak");
  const sql = fs.readFileSync(path.join(dir, "../supabase/migrations", migration), "utf8");
  const block = sql.slice(sql.indexOf("DO $cabut_supabase_admin$"));
  assert.match(block, /WHEN insufficient_privilege/);
  psql("toko_kita_defacl_tolak", ["-c", "do $$ begin create role supabase_admin nologin; exception when duplicate_object then null; end $$; do $$ begin create role penonton nologin; exception when duplicate_object then null; end $$;"]);
  psql("toko_kita_defacl_tolak", ["-c", "alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated;"]);
  const before = acl("toko_kita_defacl_tolak", "select a.defaclacl::text from pg_default_acl a join pg_roles r on r.oid = a.defaclrole where r.rolname = 'supabase_admin' and a.defaclnamespace = 'public'::regnamespace and a.defaclobjtype = 'r'");
  assert.match(before, /anon=/);
  const file = path.join("/tmp", "toko-blok-supabase-admin.sql");
  fs.writeFileSync(file, "set role penonton;\n" + block);
  try {
    psql("toko_kita_defacl_tolak", ["-f", file]);
  } finally {
    fs.unlinkSync(file);
  }
  const after = acl("toko_kita_defacl_tolak", "select a.defaclacl::text from pg_default_acl a join pg_roles r on r.oid = a.defaclrole where r.rolname = 'supabase_admin' and a.defaclnamespace = 'public'::regnamespace and a.defaclobjtype = 'r'");
  assert.equal(after, before);
});
