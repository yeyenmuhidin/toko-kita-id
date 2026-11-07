import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { konfigurasiAman } from "./akun.mjs";

var banner = document.getElementById("akunBanner");
var status = document.getElementById("akunStatus");
var konfigurasi = konfigurasiAman(window.TOKO_KITA_SUPABASE || {});
var forms = [document.getElementById("masukForm"), document.getElementById("daftarForm")];

if (!konfigurasi.ok) {
  banner.textContent = "Akun penjual belum terhubung. " + konfigurasi.reason + " Pendaftaran tidak dijalankan dan tidak ada akun yang dibuat.";
  forms.forEach(function (form) { form.querySelector("button").disabled = true; });
} else {
  banner.textContent = "Masuk memakai Supabase Auth. Halaman ini tidak menyimpan kata sandi di repositori. Checkout toko tetap simulasi.";
  var supabase = createClient(konfigurasi.url, konfigurasi.publishableKey);
  supabase.auth.getSession().then(function (result) {
    if (result.data.session) {
      status.textContent = "Anda sudah masuk sebagai " + result.data.session.user.email + ".";
      document.getElementById("keluar").hidden = false;
    }
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
    status.textContent = "Masuk berhasil.";
    document.getElementById("keluar").hidden = false;
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
    status.textContent = "Daftar dan masuk berhasil.";
    document.getElementById("keluar").hidden = false;
  });
  document.getElementById("keluar").addEventListener("click", async function () {
    await supabase.auth.signOut();
    status.textContent = "Anda sudah keluar.";
    document.getElementById("keluar").hidden = true;
  });
}
