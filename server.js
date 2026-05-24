const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const excelJS = require('exceljs'); // Library untuk fitur ekspor Excel ke PPIC
const app = express();
const port = process.env.PORT || 3000;

// 1. PENGATURAN DATABASE POSTGRESQL (SUPABASE)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Wajib aktif agar koneksi ke Supabase aman & stabil
  }
});

// Tes koneksi database di awal server berjalan
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Gagal koneksi ke database Supabase:', err.stack);
  }
  console.log('✅ Koneksi ke database Supabase BERHASIL!');
  release();
});

// 2. MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// 3. FITUR UTAMA: EKSPOR EXCEL UNTUK LAMPIRAN PPIC (KEKE)
// =========================================================================
app.get('/download-lampiran-ppic', async (req, res) => {
  try {
    // Mengambil data dari tabel produksi di Supabase
    const result = await pool.query('SELECT * FROM produksi ORDER BY tanggal DESC');
    const dataProduksi = result.rows;

    const workbook = new excelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lampiran PPIC');

    // Mengatur Header Kolom Excel
    worksheet.columns = [
      { header: 'No', key: 'no', width: 5 },
      { header: 'Tanggal', key: 'tanggal', width: 15 },
      { header: 'Nama Keke / Bagian', key: 'nama_keke', width: 25 },
      { header: 'Target Produksi', key: 'target', width: 15 },
      { header: 'Hasil Aktual', key: 'aktual', width: 15 },
      { header: 'Status', key: 'status', width: 15 }
    ];

    // Memasukkan data ke dalam baris Excel
    dataProduksi.forEach((item, index) => {
      worksheet.addRow({
        no: index + 1,
        tanggal: item.tanggal,
        nama_keke: item.nama_keke,
        target: item.target,
        aktual: item.aktual,
        status: item.aktual >= item.target ? 'Mencapai Target' : 'Kurang'
      });
    });

    // Membuat header Excel menjadi tebal (Bold) agar rapi
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
    });

    // Mengirim file Excel langsung ke browser HP/Laptop untuk di-download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Lampiran_Keke_PPIC.xlsx');

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Gagal membuat lampiran Excel:', error);
    res.status(500).send('Terjadi kesalahan saat mengunduh lampiran PPIC.');
  }
});

// =========================================================================
// 4. API ENDPOINTS LAINNYA (CONTOH QUERY POSTGRESQL)
// =========================================================================

// API Ambil Semua Data Produksi
app.get('/api/produksi', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produksi ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// API Tambah Data Produksi Baru (Menggunakan $1, $2 dst pengganti tanda tanya SQLite)
app.post('/api/produksi', async (req, res) => {
  const { tanggal, nama_keke, target, aktual } = req.body;
  try {
    const queryText = 'INSERT INTO produksi (tanggal, nama_keke, target, aktual) VALUES ($1, $2, $3, $4) RETURNING *';
    const values = [tanggal, nama_keke, target, aktual];
    const result = await pool.query(queryText, values);
    res.json({ message: 'Data berhasil disimpan!', data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// 5. MENJALANKAN SERVER
app.listen(port, () => {
  console.log(`🚀 Server berjalan mulus di port ${port}`);
});
