import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { peranAdmin, terapkanTautanAdmin, teksBerhasilMasuk } from "../akun.mjs";
import { muatTautanAdmin } from "../tautan-admin.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const halaman = ["index.html", "kelola.html", "masuk.html", "penjual.html", "pesanan.html", "admin.html"];

function klien(sessionUser, hasilProfil) {
  const panggilan = [];
  return {
    panggilan,
    auth: {
      async getSession() {
        return { data: { session: sessionUser ? { user: sessionUser } : null } };
      }
    },
    from(table) {
      panggilan.push({ table });
      return {
        select(kolom) {
          panggilan.push({ select: kolom });
          return {
            eq(kolomEq, id) {
              panggilan.push({ eq: kolomEq, id });
              return {
                async single() {
                  return hasilProfil;
                }
              };
            }
          };
        }
      };
    }
  };
}

test("tautan admin hanya untuk peran admin", () => {
  assert.equal(peranAdmin("admin"), true);
  assert.equal(peranAdmin("pembeli"), false);
  assert.equal(peranAdmin("penjual"), false);
  assert.equal(peranAdmin(""), false);
  assert.equal(peranAdmin(null), false);
  assert.equal(peranAdmin("Admin"), false);
  const tautan = [{ hidden: true }, { hidden: true }];
  assert.equal(terapkanTautanAdmin(tautan, "penjual"), false);
  assert.deepEqual(tautan.map((el) => el.hidden), [true, true]);
  assert.equal(terapkanTautanAdmin(tautan, "admin"), true);
  assert.deepEqual(tautan.map((el) => el.hidden), [false, false]);
  terapkanTautanAdmin(tautan, undefined);
  assert.deepEqual(tautan.map((el) => el.hidden), [true, true]);
});

test("pesan masuk yang berhasil menyebut akun dan tetap bahasa Indonesia", () => {
  assert.equal(teksBerhasilMasuk("ada@toko.id", "masuk"), "Masuk berhasil. Anda masuk sebagai ada@toko.id.");
  assert.equal(teksBerhasilMasuk("ada@toko.id", "sudah"), "Anda sudah masuk sebagai ada@toko.id.");
  assert.equal(teksBerhasilMasuk("ada@toko.id", "daftar"), "Daftar dan masuk berhasil. Anda masuk sebagai ada@toko.id.");
  assert.equal(teksBerhasilMasuk("", "masuk"), "Masuk berhasil.");
});

test("muat tautan membaca role profil id sendiri dan menyembunyikan selain admin", async () => {
  const tautan = [{ hidden: false }];
  globalThis.document = { querySelectorAll: () => tautan };
  const userId = "11111111-1111-4111-8111-111111111111";
  const admin = klien({ id: userId }, { data: { role: "admin" }, error: null });
  assert.equal(await muatTautanAdmin(admin), true);
  assert.equal(tautan[0].hidden, false);
  assert.deepEqual(admin.panggilan, [
    { table: "profiles" },
    { select: "role" },
    { eq: "id", id: userId }
  ]);

  for (const role of ["pembeli", "penjual"]) {
    tautan[0].hidden = false;
    const lain = klien({ id: userId }, { data: { role }, error: null });
    assert.equal(await muatTautanAdmin(lain), false);
    assert.equal(tautan[0].hidden, true);
  }

  tautan[0].hidden = false;
  const kosong = klien(null, { data: { role: "admin" }, error: null });
  assert.equal(await muatTautanAdmin(kosong), false);
  assert.equal(kosong.panggilan.length, 0);
  assert.equal(tautan[0].hidden, true);

  tautan[0].hidden = false;
  const gagal = klien({ id: userId }, null);
  gagal.from = () => { throw new Error("jaringan"); };
  assert.equal(await muatTautanAdmin(gagal), false);
  assert.equal(tautan[0].hidden, true);
  delete globalThis.document;
});

test("header menyembunyikan tautan admin sampai peran admin", () => {
  halaman.forEach((name) => {
    const html = fs.readFileSync(path.join(root, name), "utf8");
    const tautan = [...html.matchAll(/<a\b[^>]*href="admin\.html"[^>]*>/g)].map((match) => match[0]);
    assert.ok(tautan.length >= 1, name);
    tautan.forEach((anchor) => {
      assert.match(anchor, /\bhidden\b/, name);
      assert.match(anchor, /data-nav-admin/, name);
      assert.match(html.slice(html.indexOf(anchor), html.indexOf(anchor) + anchor.length + 20), />Admin</, name);
    });
    if (name === "masuk.html") {
      assert.match(fs.readFileSync(path.join(root, "masuk.mjs"), "utf8"), /from "\.\/tautan-admin\.mjs"/);
      assert.match(html, /id="masukBerhasil"/);
      assert.match(html, /id="masukBerhasil" hidden/);
    } else {
      assert.match(html, /<script type="module" src="tautan-admin\.mjs"><\/script>/, name);
    }
  });
  const penjual = fs.readFileSync(path.join(root, "penjual.html"), "utf8");
  const pesanan = fs.readFileSync(path.join(root, "pesanan.html"), "utf8");
  assert.equal(penjual.includes(">Tinjau<"), false);
  assert.equal(pesanan.includes(">Tinjau<"), false);
});
