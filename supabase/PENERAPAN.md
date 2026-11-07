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

## Produk dan stok admin

Setelah dua migrasi di atas, jalankan `supabase/migrations/20261107030520_admin_produk_stok.sql` sekali. Migrasi ini tidak mengisi stok produk yang sudah ada: `stock` null berarti belum diatur dan tidak dapat dipesan. Produk `contoh` tetap tidak dijual.

Model yang dipakai halaman Produk dan halaman Stok sama:

- Fisik (`products.stock`) adalah jumlah di tangan.
- Cadangan adalah jumlah pada pesanan yang `stock_reserved` masih benar.
- Tersedia = fisik − cadangan. Null jika fisik belum diatur.
- Menipis jika tersedia lebih dari 0 dan tidak lebih besar dari `low_stock_threshold`. Habis jika tersedia 0. Ambang hanya penanda di aplikasi.

Penyesuaian admin memakai `sesuaikan_stok_admin` dengan alasan, versi yang diharapkan, dan kunci idempotensi. `kelola_produk_admin` dengan aksi `ubah_stok` menolak menulis stok supaya tidak tercatat dua kali. Pembayaran sandbox mengurangi fisik sekali saat status menjadi dibayar. Kedaluwarsa, gagal, atau batal hanya melepas cadangan. Riwayat `inventory_movements` tidak dapat diubah atau dihapus klien. Penjual hanya dapat membaca gerakan produknya sendiri. Admin membaca semuanya.
