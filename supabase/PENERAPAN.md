# Penerapan uji coba Supabase

Berkas ini belum dijalankan ke proyek jarak jauh. Jangan menaruh `service_role` di repositori, di `supabase-config.js`, atau di chat.

Proyek yang sudah ada: ref `xlsbhvpveivhbqikmxxp`, region `ap-southeast-1`. URL API yang diharapkan: `https://xlsbhvpveivhbqikmxxp.supabase.co`.

## Yang belum dilakukan

Migrasi ini belum dijalankan ke proyek jarak jauh. Auth, SMTP, Edge Function, dan Midtrans juga belum diubah. `supabase-config.js` sudah berisi URL dan kunci publishable yang aman untuk peramban. Itu bukan service role dan tidak berarti masuk atau pembayaran siap.

Selama tabel produk akun kosong, etalase menampilkan delapan contoh `catalog.json` dengan keterangan bahwa itu bukan stok sungguhan dan tidak dapat dibayar. Jika pemuatan akun gagal, contoh itu tidak dipakai sebagai pengganti diam-diam.

## Jalur pemasangan satu berkas

Jangan menggabungkan PR #3, #4, atau #5 ke `main` sendiri, dan jangan menerapkan enam berkas migrasi lama. Di riwayat git berkas itu masih ada, tetapi folder `supabase/migrations` pada cabang pemasangan sengaja kosong supaya `supabase db push` tidak memasang definisi sementara.

Satu-satunya SQL pemasangan adalah `supabase/pemasangan/toko_kita_pemasangan_awal.sql`. Berkas itu membuat keadaan akhir langsung: fungsi istimewa ada di `private`, RPC `public` adalah security invoker, dan tidak ada `SECURITY DEFINER` di `public` bahkan di tengah berkas. Setelah objek dibuat, berkas mencabut hak `PUBLIC`, `anon`, dan `authenticated` yang diwarisi dari default ACL Supabase, lalu memberi hanya izin yang dimaksud. `service_role` tetap boleh membaca dan menulis data aplikasi serta menjalankan RPC pembayaran, tanpa `TRUNCATE`, `REFERENCES`, atau `TRIGGER`. Default global tidak diubah. Berkas tidak berisi `BEGIN` atau `COMMIT`.

`apply_migration` hanya menerima `project_id`, `name`, dan `query`, lalu memberi versi sendiri. Jangan menulis `schema_migrations` manual dan jangan `db push` sebelum nama berkas sama dengan versi itu.

1. Tinjau isi `supabase/pemasangan/toko_kita_pemasangan_awal.sql`.
2. Panggil `apply_migration` sekali, `name` = `toko_kita_pemasangan_awal`, `query` = seluruh isi berkas.
3. Simpan versi yang dikembalikan alat.
4. Commit biasa berikutnya mengganti nama berkas menjadi `supabase/migrations/<versi>_toko_kita_pemasangan_awal.sql`.

Sampai langkah 2, migrasi remote belum dijalankan. Pengaturan Exposed schemas di dashboard belum diverifikasi dari konektor ini (`pgrst.db_schemas` kosong di Postgres lokal). Sebelum menganggap `private` tersembunyi, pastikan di dashboard Exposed schemas hanya `public` dan `graphql_public`.

Di Authentication, yang belum terverifikasi dan harus diatur pemilik:

- konfirmasi email tetap nyala; jangan dimatikan
- SMTP kustom, karena pendaftaran publik membutuhkannya
- kata sandi minimal 8 karakter
- Site URL `https://yeyenmuhidin.github.io/toko-kita-id`
- redirect `https://yeyenmuhidin.github.io/toko-kita-id/masuk.html`

Lalu daftar lewat halaman Masuk dengan email pemilik yang sebenarnya, salin User UID dari Authentication, dan jalankan `supabase/bootstrap-admin.sql` setelah UUID diganti. Jangan mengangkat admin dari pemilik organisasi atau dari pendaftar pertama.

Skema `private` tidak boleh ditambahkan ke Exposed schemas. API tetap `public` dan `graphql_public`.

## Pembayaran sandbox

Fungsi `buat-pembayaran` dan `midtrans-notifikasi` belum di-deploy. Rahasia diisi sebagai environment function, bukan di repositori:

- `MIDTRANS_ENV=sandbox`
- `MIDTRANS_SERVER_KEY` dari dashboard sandbox Midtrans setelah akun merchant sendiri dibuat

`MIDTRANS_ENV=production` ditolak kode. Tidak ada tarif ongkir di migrasi. Selama tabel `shipping_rates` kosong, pesanan dapat tersimpan tetapi pembayaran tidak dimulai dan tidak ada total kirim. Status lunas hanya berubah lewat notifikasi yang tanda tangannya sah dan dicek ulang ke API sandbox. Kembali dari halaman pembayaran tidak menandai lunas.

Biaya Midtrans ada di https://midtrans.com/pricing dan tidak disetujui oleh repositori ini. Metode yang muncul di Snap tergantung yang diaktifkan akun sandbox, bukan daftar tetap di kode.

## Produk dan stok admin

Pemasangan tidak mengisi stok. `stock` null berarti belum diatur dan tidak dapat dipesan. Produk `contoh` tetap tidak dijual. Cadangan di `posisi_stok` dihitung lewat `private.angka_stok`, hanya untuk pemilik produk atau admin, tanpa membuka total pesanan, baris penjual lain, atau data pembeli.

Model yang dipakai halaman Produk dan halaman Stok sama:

- Fisik (`products.stock`) adalah jumlah di tangan.
- Cadangan adalah jumlah pada pesanan yang `stock_reserved` masih benar.
- Tersedia = fisik − cadangan. Null jika fisik belum diatur.
- Menipis jika tersedia lebih dari 0 dan tidak lebih besar dari `low_stock_threshold`. Habis jika tersedia 0. Ambang hanya penanda di aplikasi.

Penyesuaian admin memakai `sesuaikan_stok_admin` dengan alasan, versi yang diharapkan, dan kunci idempotensi. `kelola_produk_admin` dengan aksi `ubah_stok` menolak menulis stok supaya tidak tercatat dua kali. Pembayaran sandbox mengurangi fisik sekali saat status menjadi dibayar. Kedaluwarsa, gagal, atau batal hanya melepas cadangan. Riwayat `inventory_movements` tidak dapat diubah atau dihapus klien. Penjual hanya dapat membaca gerakan produknya sendiri. Admin membaca semuanya.
