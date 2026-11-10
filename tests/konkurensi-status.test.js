const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const path = require("node:path");

const db = "toko_kita_kunci";

function psqlFile(file) {
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "pipe" });
}

function psqlValue(sql) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    execFile("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve(stdout);
    });
  });
}

function catat(gateway, total, status, tx, holdMs) {
  const call = `select public.internal_catat_pembayaran('${gateway}', ${total}, 'IDR', '${status}', 'accept', '${tx}', true);`;
  if (!holdMs) return psqlAsync(`set role service_role; ${call}`);
  return psqlAsync(`begin; set role service_role; ${call} select pg_sleep(${holdMs}); commit;`);
}

test("dua koneksi tidak menimpa lunas dengan kedaluwarsa atau penyelesaian ganda", async () => {
  const dir = __dirname;
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `drop database if exists ${db};`], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `create database ${db};`], { stdio: "pipe" });
  psqlFile(path.join(dir, "rls.harness.sql"));
  psqlFile(path.join(dir, "pesanan.extra.sql"));
  psqlFile(path.join(dir, "konkurensi-status.sql"));

  async function order(key) {
    const row = psqlValue(`select gateway_order_id || '|' || total from public.orders where idempotency_key = '${key}'`);
    const [gateway, total] = row.split("|");
    return { gateway, total };
  }

  const pertama = await order("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1");
  const tahanLunas = catat(pertama.gateway, pertama.total, "settlement", "tx-tahan-lunas", 1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const kedaluwarsa = await catat(pertama.gateway, pertama.total, "expire", "tx-kedaluwarsa", 0);
  await tahanLunas;
  assert.equal(psqlValue(`select payment_status from public.orders where gateway_order_id = '${pertama.gateway}'`), "dibayar");
  assert.match(kedaluwarsa, /diabaikan/);

  const kedua = await order("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2");
  const tahanExpire = catat(kedua.gateway, kedua.total, "expire", "tx-tahan-expire", 1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const terlambat = await catat(kedua.gateway, kedua.total, "settlement", "tx-terlambat", 0);
  await tahanExpire;
  assert.equal(psqlValue(`select payment_status from public.orders where gateway_order_id = '${kedua.gateway}'`), "kedaluwarsa");
  assert.match(terlambat, /diabaikan/);

  const ketiga = await order("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3");
  const tahanDuplikat = catat(ketiga.gateway, ketiga.total, "settlement", "tx-dup-1", 1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const ulang = await catat(ketiga.gateway, ketiga.total, "settlement", "tx-dup-2", 0);
  await tahanDuplikat;
  assert.equal(psqlValue(`select payment_status from public.orders where gateway_order_id = '${ketiga.gateway}'`), "dibayar");
  assert.match(ulang, /duplikat/);
  assert.equal(psqlValue(`select count(*) from public.order_events e join public.orders o on o.id = e.order_id where o.gateway_order_id = '${ketiga.gateway}' and e.note = 'diterima'`), "1");
});
