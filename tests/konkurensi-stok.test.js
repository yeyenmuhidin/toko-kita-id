const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const path = require("node:path");

const db = "toko_kita_kunci_stok";

function psqlSync(args) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
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

test("kunci stok menahan penyelesaian ganda dan perebutan sisa", async () => {
  const dir = __dirname;
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `drop database if exists ${db};`], { stdio: "pipe" });
  execFileSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-c", `create database ${db};`], { stdio: "pipe" });
  psqlSync(["-f", path.join(dir, "migrasi.preamble.sql")]);
  psqlSync(["-f", path.join(dir, "../supabase/pemasangan/toko_kita_pemasangan_awal.sql")]);
  psqlSync(["-f", path.join(dir, "konkurensi-stok.sql")]);

  const cukup = psqlValue("select id::text from public.products where name = 'Kunci Cukup'");
  const tipis = psqlValue("select id::text from public.products where name = 'Kunci Tipis'");
  const tarif = psqlValue("select id::text from public.shipping_rates where label = 'Uji kunci'");
  const buyer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

  function buat(productId, key) {
    return `set role service_role; select public.internal_buat_pesanan('${buyer}', '${key}', jsonb_build_array(jsonb_build_object('product_id', '${productId}', 'quantity', 1)), '${tarif}'::uuid, null);`;
  }
  psqlSync(["-c", buat(cukup, "ffffffff-ffff-4fff-8fff-fffffffffff1")]);
  psqlSync(["-c", buat(cukup, "ffffffff-ffff-4fff-8fff-fffffffffff2")]);
  const pertama = psqlValue("select gateway_order_id || '|' || total from public.orders where idempotency_key = 'ffffffff-ffff-4fff-8fff-fffffffffff1'");
  const kedua = psqlValue("select gateway_order_id || '|' || total from public.orders where idempotency_key = 'ffffffff-ffff-4fff-8fff-fffffffffff2'");
  const [gateway1, total1] = pertama.split("|");
  const [gateway2, total2] = kedua.split("|");

  function catat(gateway, total, status, tx, hold) {
    const call = `select public.internal_catat_pembayaran('${gateway}', ${total}, 'IDR', '${status}', 'accept', '${tx}', true);`;
    const sql = hold
      ? `begin; set role service_role; ${call} select pg_sleep(${hold}); commit;`
      : `set role service_role; ${call}`;
    return psqlAsync(sql);
  }

  const tahan = catat(gateway1, total1, "settlement", "tx-stok-1", 1);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const lawan = await catat(gateway1, total1, "expire", "tx-stok-2", 0);
  await tahan;
  assert.equal(psqlValue(`select payment_status from public.orders where gateway_order_id = '${gateway1}'`), "dibayar");
  assert.equal(psqlValue("select stock::text from public.products where name = 'Kunci Cukup'"), "4");
  assert.equal(psqlValue(`select count(*) from public.inventory_movements m join public.orders o on o.id = m.order_id where o.gateway_order_id = '${gateway1}' and m.reason = 'penjualan sandbox'`), "1");
  assert.equal(psqlValue(`select count(*) from public.inventory_movements m join public.orders o on o.id = m.order_id where o.gateway_order_id = '${gateway1}' and m.reason = 'lepas cadangan'`), "0");
  assert.match(lawan, /diabaikan/);

  const dupA = catat(gateway2, total2, "settlement", "tx-stok-3", 1);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const dupB = await catat(gateway2, total2, "settlement", "tx-stok-4", 0);
  await dupA;
  assert.equal(psqlValue("select stock::text from public.products where name = 'Kunci Cukup'"), "3");
  assert.match(dupB, /duplikat/);

  const rebutA = psqlAsync(`begin; ${buat(tipis, "ffffffff-ffff-4fff-8fff-fffffffffff3")} select pg_sleep(1); commit;`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await assert.rejects(psqlAsync(buat(tipis, "ffffffff-ffff-4fff-8fff-fffffffffff4")), /Stok tidak cukup/);
  await rebutA;
  assert.equal(psqlValue("select stock::text from public.products where name = 'Kunci Tipis'"), "1");
  assert.equal(psqlValue("select coalesce(sum(i.quantity), 0)::text from public.order_items i join public.orders o on o.id = i.order_id where i.product_id = '" + tipis + "' and o.stock_reserved"), "1");
});
