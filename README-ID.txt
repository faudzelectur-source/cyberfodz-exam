FØDZ EXAM — CARA MENJALANKAN DI TERMUX (ANDROID)

PENTING:
- Ini starter website. File questions.json berisi 20 slot contoh yang WAJIB diganti dengan 20 soal asli sebelum ujian.
- Jangan bagikan password admin.
- Termux hanya menjalankan server. Agar peserta dari luar jaringan rumah/kampus bisa membuka website, aplikasi harus di-deploy ke hosting/server publik dengan HTTPS. Jangan membuka port HP ke internet sembarangan.
- Website tidak bisa menjamin screenshot mustahil. Blokir copy di browser juga bukan perlindungan kuat; peserta masih dapat memakai perangkat lain atau cara lain.
- Catatan pindah tab/keluar halaman hanya indikator, bisa salah mendeteksi notifikasi atau perpindahan aplikasi. Jangan jadikan bukti tunggal kecurangan.
- SQLite memakai node:sqlite yang tersedia di Node.js modern (Node 22+).

LANGKAH TERMUX:
1. Pasang Node.js versi 22 atau lebih baru.
2. Ekstrak folder fael-exam.
3. Masuk ke folder:
   cd fael-exam
4. Instal paket:
   npm install
5. Salin .env.example menjadi .env, lalu ubah password admin dan session secret.
   cp .env.example .env
   nano .env
6. Jalankan:
   npm start
7. Buka di browser HP yang sama:
   http://localhost:3000
8. Panel admin:
   http://localhost:3000/admin.html

PENGISIAN SOAL:
Edit questions.json. Pertahankan format:
{
  "id": 1,
  "question": "Teks soal",
  "options": {"A":"...", "B":"...", "C":"...", "D":"..."},
  "answer": "B",
  "explanation": ""
}
Isi tepat 20 soal, id unik 1 sampai 20, dan answer harus A/B/C/D.

FITUR:
- Form nama + pilihan kelas TRII F/TRII E.
- 20 soal, urutan soal diacak untuk setiap peserta.
- Tidak ada timer.
- Nilai otomatis.
- Satu kali pengumpulan per kombinasi nama dan kelas.
- Jawaban dan nilai disimpan dalam exam.sqlite.
- Admin dapat melihat hasil dan mengunduh CSV.
- Percobaan copy, klik kanan, pindah tab, dan blur dicatat sebagai indikator aktivitas.

BATASAN:
- Penguncian screenshot sistem Android tidak bisa dilakukan oleh website biasa.
- Endpoint demo ini belum memiliki sistem akun peserta/verifikasi identitas kuat.
- Untuk pemakaian resmi dengan banyak peserta, deploy ke hosting HTTPS, gunakan backup database, dan uji dengan beberapa HP terlebih dahulu.
