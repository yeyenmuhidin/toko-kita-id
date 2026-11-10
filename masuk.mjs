import { konfigurasiAman, teksBerhasilMasuk } from "./akun.mjs";
import { klienToko } from "./supabase-klien.mjs";
import { muatTautanAdmin } from "./tautan-admin.mjs";

var banner = document.getElementById("akunBanner");
var status = document.getElementById("akunStatus");
var berhasil = document.getElementById("masukBerhasil");
var berhasilTeks = document.getElementById("masukBerhasilTeks");
var konfigurasi = konfigurasiAman(window.TOKO_KITA_SUPABASE || {});
var forms = [document.getElementById("masukForm"), document.getElementById("daftarForm")];

function tampilkanBerhasil(session, jenis, fokus) {
  if (!session) {
    berhasil.hidden = true;
    berhasilTeks.textContent = "";
    document.getElementById("keluar").hidden = true;
    return;
  }
  berhasil.hidden = false;
  berhasilTeks.textContent = teksBerhasilMasuk(session.user && session.user.email, jenis);
  document.getElementById("keluar").hidden = false;
  status.textContent = "";
  if (fokus) berhasil.focus();
}

if (!konfigurasi.ok) {
  banner.textContent = "Akun penjual belum terhubung. " + konfigurasi.reason + " Pendaftaran tidak dijalankan dan tidak ada akun yang dibuat.";
  forms.forEach(function (form) { form.querySelector("button").disabled = true; });
} else {
  banner.textContent = "URL proyek sudah diisi, tetapi konfirmasi email dan SMTP belum diverifikasi. Pendaftaran dapat gagal sampai pemilik mengatur SMTP. Halaman ini belum berarti masuk siap dipakai. Checkout contoh tidak menagih.";
  var supabase = klienToko(window.TOKO_KITA_SUPABASE);
  async function sinkronSesi(session, jenis, fokus) {
    tampilkanBerhasil(session, jenis, fokus);
    await muatTautanAdmin(supabase);
  }
  supabase.auth.getSession().then(function (result) {
    if (result.data.session) sinkronSesi(result.data.session, "sudah");
  });
  document.getElementById("masukForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var hasil = await supabase.auth.signInWithPassword({
      email: document.getElementById("masukEmail").value.trim(),
      password: document.getElementById("masukPassword").value
    });
    document.getElementById("masukPassword").value = "";
    if (hasil.error || !hasil.data.session) {
      status.textContent = "Masuk gagal. Periksa email, kata sandi, atau konfirmasi email. Tidak ada sesi yang dibuat.";
      return;
    }
    await sinkronSesi(hasil.data.session, "masuk", true);
  });
  document.getElementById("daftarForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var password = document.getElementById("daftarPassword").value;
    if (password.length < 8) {
      status.textContent = "Kata sandi minimal 8 karakter.";
      return;
    }
    var hasil = await supabase.auth.signUp({
      email: document.getElementById("daftarEmail").value.trim(),
      password: password,
      options: {
        data: { display_name: document.getElementById("daftarNama").value.trim() },
        emailRedirectTo: new URL("masuk.html", window.location.href).href
      }
    });
    document.getElementById("daftarPassword").value = "";
    if (hasil.error) {
      status.textContent = "Daftar gagal. Akun belum dibuat di sesi ini.";
      return;
    }
    if (!hasil.data.session) {
      status.textContent = "Pendaftaran tercatat. Konfirmasi email dulu sebelum masuk. Sesi belum aktif.";
      return;
    }
    await sinkronSesi(hasil.data.session, "daftar", true);
  });
  document.getElementById("keluar").addEventListener("click", async function () {
    await supabase.auth.signOut();
    status.textContent = "Anda sudah keluar.";
    await sinkronSesi(null);
  });
}
