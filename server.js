const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const excelJS = require('exceljs');
const app = express();
const port = process.env.PORT || 3000;

// 1. PENGATURAN DATABASE POSTGRESQL (SUPABASE)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
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
// 3. API DATA MASTER (CUSTOMER, ITEM, PROSES)
// =========================================================================

// Ambil Data Master Item & Proses untuk Dropdown Web
app.get('/api/master', async (req, res) => {
  try {
    const itemsRes = await pool.query('SELECT * FROM master_items ORDER BY id DESC');
    const prosesRes = await pool.query('SELECT * FROM master_proses ORDER BY id DESC');
    res.json({
      items: itemsRes.rows,
      proses: prosesRes.rows
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Tambah Master Item Baru
app.post('/api/master/item', async (req, res) => {
  const { customer, jenis_barang, nama_item } = req.body;
  try {
    const queryText = 'INSERT INTO master_items (customer, jenis_barang, nama_item) VALUES ($1, $2, $3) RETURNING *';
    const result = await pool.query(queryText, [customer, jenis_barang, nama_item]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Tambah Master Proses Baru
app.post('/api/master/proses', async (req, res) => {
  const { jenis_barang, nama_proses } = req.body;
  try {
    const queryText = 'INSERT INTO master_proses (jenis_barang, nama_proses) VALUES ($1, $2) RETURNING *';
    const result = await pool.query(queryText, [jenis_barang, nama_proses]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Hapus Master Item
app.delete('/api/master/item/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM master_items WHERE id = $1', [req.params.id]);
    res.json({ message: 'Item dihapus' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Hapus Master Proses
app.delete('/api/master/proses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM master_proses WHERE id = $1', [req.params.id]);
    res.json({ message: 'Proses dihapus' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// =========================================================================
// 4. API TRANSAKSI PRODUKSI, DELIVERY & PERHITUNGAN WIP
// =========================================================================

// Simpan Hasil Kerja Harian
app.post('/api/produksi', async (req, res) => {
  const { customer, jenis_barang, nama_item, proses_sekarang, jumlah_ok, jumlah_ng } = req.body;
  try {
    const queryText = 'INSERT INTO produksi (customer, jenis_barang, nama_item, proses_sekarang, jumlah_ok, jumlah_ng) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *';
    const result = await pool.query(queryText, [customer, jenis_barang, nama_item, proses_sekarang, jumlah_ok, jumlah_ng]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Simpan Catatan Delivery / Surat Jalan
app.post('/api/delivery', async (req, res) => {
  const { customer, jenis_barang, nama_item, no_surat_jalan, jumlah_kirim } = req.body;
  try {
    const queryText = 'INSERT INTO delivery (customer, jenis_barang, nama_item, no_surat_jalan, jumlah_kirim) VALUES ($1, $2, $3, $4, $5) RETURNING *';
    const result = await pool.query(queryText, [customer, jenis_barang, nama_item, no_surat_jalan, jumlah_kirim]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Hitung Logika Pantauan Sisa WIP Aktif Otomatis
app.get('/api/wip', async (req, res) => {
  try {
    // Ambil semua riwayat produksi & pengiriman
    const prodData = await pool.query('SELECT * FROM produksi');
    const delivData = await pool.query('SELECT * FROM delivery');
    
    let stok = {};

    // 1. Tambah stok berdasarkan jumlah OK di tiap tahapan proses
    prodData.rows.forEach(p => {
      const key = `${p.customer}|${p.jenis_barang}|${p.nama_item}`;
      if (!stok[key]) stok[key] = { customer: p.customer, jenis_barang: p.jenis_barang, nama_item: p.nama_item, sisa_wip: 0, proses_sekarang: p.proses_sekarang };
      stok[key].sisa_wip += parseInt(p.jumlah_ok || 0);
      stok[key].proses_sekarang = p.proses_sekarang; // Ambil proses terakhir yang macet
    });

    // 2. Kurangi stok jika barang sudah dikirim (delivery)
    delivData.rows.forEach(d => {
      const key = `${d.customer}|${d.jenis_barang}|${d.nama_item}`;
      if (stok[key]) {
        stok[key].sisa_wip -= parseInt(d.jumlah_kirim || 0);
      }
    });

    // Saring data: Hanya tampilkan item yang WIP-nya masih tersisa di pabrik
    const hasilWIP = Object.values(stok).filter(item => item.sisa_wip > 0);
    res.json(hasilWIP);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// =========================================================================
// 5. FITUR DOWNLOAD EXCEL PPIC (DATA DIAMBIL DARI TABEL PRODUKSI)
// =========================================================================
app.get('/download-lampiran-ppic', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produksi ORDER BY tanggal DESC');
    const dataProduksi = result.rows;

    const workbook = new excelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lampiran PPIC');

    worksheet.columns = [
      { header: 'No', key: 'no', width: 5 },
      { header: 'Tanggal', key: 'tanggal', width: 20 },
      { header: 'Customer', key: 'customer', width: 20 },
      { header: 'Jenis Barang', key: 'jenis_barang', width: 15 },
      { header: 'Nama Item', key: 'nama_item', width: 20 },
      { header: 'Proses Terakhir', key: 'proses_sekarang', width: 15 },
      { header: 'Jumlah OK (Pcs)', key: 'jumlah_ok', width: 15 },
      { header: 'Jumlah NG (Pcs)', key: 'jumlah_ng', width: 15 }
    ];

    dataProduksi.forEach((item, index) => {
      worksheet.addRow({
        no: index + 1,
        tanggal: item.tanggal,
        customer: item.customer,
        jenis_barang: item.jenis_barang,
        nama_item: item.nama_item,
        proses_sekarang: item.proses_sekarang,
        jumlah_ok: item.jumlah_ok,
        jumlah_ng: item.jumlah_ng
      });
    });

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Lampiran_Keke_PPIC.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Gagal membuat lampiran Excel:', error);
    res.status(500).send('Terjadi kesalahan saat mengunduh lampiran PPIC.');
  }
});

// 6. MENJALANKAN SERVER
app.listen(port, () => {
  console.log(`🚀 Server berjalan mulus di port ${port}`);
});
