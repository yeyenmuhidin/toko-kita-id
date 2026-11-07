# Penerapan uji coba Supabase

Berkas ini belum dijalankan ke proyek jarak jauh. Jangan menaruh `service_role` di repositori, di `supabase-config.js`, atau di chat.

Proyek yang sudah ada: ref `xlsbhvpveivhbqikmxxp`, region `ap-southeast-1`. URL API yang diharapkan: `https://xlsbhvpveivhbqikmxxp.supabase.co`.

## Yang diterapkan pemilik setelah meninjau SQL

1. Di SQL Editor proyek itu, jalankan isi `supabase/migrations/20261107024105_marketplace_penjual.sql` sekali.
2. Di Authentication, aktifkan email, konfirmasi email, dan kata sandi minimal 8 karakter.
3. Tambahkan URL situs ke redirect yang diizinkan:
   - `https://yeyenmuhidin.github.io/toko-kita-id`
   - `https://yeyenmuhidin.github.io/toko-kita-id/masuk.html`
4. Salin URL proyek dan kunci **publishable** atau anon. Isi hanya dua nilai itu di `supabase-config.js` pada situs yang di-deploy. Jangan salin service role.
5. Daftar lewat halaman Masuk dengan email pemilik yang sebenarnya.
6. Buka Authentication, Users, dan salin User UID akun itu.
7. Di SQL Editor, jalankan perintah di `supabase/bootstrap-admin.sql` setelah UUID diganti dengan UID tersebut.

Sebelum langkah 4, etalase tetap mode demo dari `catalog.json`.

## Pembayaran sandbox

Fungsi `buat-pembayaran` dan `midtrans-notifikasi` belum di-deploy. Rahasia diisi sebagai environment function, bukan di repositori:

- `MIDTRANS_ENV=sandbox`
- `MIDTRANS_SERVER_KEY` dari dashboard sandbox Midtrans setelah akun merchant sendiri dibuat

`MIDTRANS_ENV=production` ditolak kode. Tidak ada tarif ongkir di migrasi. Selama tabel `shipping_rates` kosong, pesanan dapat tersimpan tetapi pembayaran tidak dimulai dan tidak ada total kirim. Status lunas hanya berubah lewat notifikasi yang tanda tangannya sah dan dicek ulang ke API sandbox. Kembali dari halaman pembayaran tidak menandai lunas.

Biaya Midtrans ada di https://midtrans.com/pricing dan tidak disetujui oleh repositori ini. Metode yang muncul di Snap tergantung yang diaktifkan akun sandbox, bukan daftar tetap di kode.
