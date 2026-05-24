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

// Ambil Data Master Item & Proses (Urutan Proses Diurutkan dari Kecil ke Besar)
app.get('/api/master', async (req, res) => {
  try {
    const itemsRes = await pool.query('SELECT * FROM master_items ORDER BY id DESC');
    const prosesRes = await pool.query('SELECT * FROM master_proses ORDER BY jenis_barang, urutan_proses ASC');
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

// Tambah Master Proses Baru (Sekarang Menerima Input Urutan Proses)
app.post('/api/master/proses', async (req, res) => {
  const { jenis_barang, nama_proses, urutan_proses } = req.body;
  const urutan = parseInt(urutan_proses) || 1;
  try {
    const queryText = 'INSERT INTO master_proses (jenis_barang, nama_proses, urutan_proses) VALUES ($1, $2, $3) RETURNING *';
    const result = await pool.query(queryText, [jenis_barang, nama_proses, urutan]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Hapus Master Item & Proses
app.delete('/api/master/item/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM master_items WHERE id = $1', [req.params.id]);
    res.json({ message: 'Item dihapus' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

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
// 4. API TRANSAKSI PRODUKSI, DELIVERY & PERHITUNGAN WIP ESTAFET
// =========================================================================

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

// LOGIKA UTAMA: MENGHITUNG SALDO WIP ESTAFET & GUDANG BARANG JADI
app.get('/api/wip', async (req, res) => {
  try {
    // 1. Ambil data master master_proses untuk tahu susunan urutan jalur flow kerja
    const prosesMaster = await pool.query('SELECT * FROM master_proses ORDER BY jenis_barang, urutan_proses ASC');
    
    // Kelompokkan urutan proses berdasarkan jenis_barang
    let ruteProduk = {};
    prosesMaster.rows.forEach(p => {
      if (!ruteProduk[p.jenis_barang]) ruteProduk[p.jenis_barang] = [];
      ruteProduk[p.jenis_barang].push(p.nama_proses);
    });

    // 2. Ambil data riwayat transaksi aktual
    const prodData = await pool.query('SELECT * FROM produksi ORDER BY id ASC');
    const delivData = await pool.query('SELECT * FROM delivery ORDER BY id ASC');
    
    let saldoWIP = {};  // Kunci: customer|jenis_barang|nama_item|nama_proses
    let gudangJadi = {}; // Kunci: customer|jenis_barang|nama_item

    // 3. Hitung Logika Pergeseran Estafet dari Input Produksi
    prodData.rows.forEach(p => {
      const itemKey = `${p.customer}|${p.jenis_barang}|${p.nama_item}`;
      const rute = ruteProduk[p.jenis_barang] || [];
      const indexProsesSekarang = rute.indexOf(p.proses_sekarang);
      const jmlOK = parseInt(p.jumlah_ok || 0);

      // Tambah saldo di proses yang di-input saat ini
      const keySekarang = `${itemKey}|${p.proses_sekarang}`;
      if (!saldoWIP[keySekarang]) {
        saldoWIP[keySekarang] = { customer: p.customer, jenis_barang: p.jenis_barang, nama_item: p.nama_item, nama_proses: p.proses_sekarang, sisa_wip: 0 };
      }
      saldoWIP[keySekarang].sisa_wip += jmlOK;

      // Kurangi saldo di proses SEBELUMNYA (jika ada proses terdahulu di rutenya)
      if (indexProsesSekarang > 0) {
        const prosesSebelumnya = rute[indexProsesSekarang - 1];
        const keySebelumnya = `${itemKey}|${prosesSebelumnya}`;
        if (saldoWIP[keySebelumnya]) {
          saldoWIP[keySebelumnya].sisa_wip -= jmlOK;
        }
      }

      // Jika ini adalah PROSES PALING AKHIR dari rute, lempar saldo OK langsung ke Gudang Barang Jadi
      if (rute.length > 0 && indexProsesSekarang === rute.length - 1) {
        // Potong sisa WIP di stasiun akhir tersebut karena sudah sah jadi Finish Good
        saldoWIP[keySekarang].sisa_wip -= jmlOK;
        
        if (!gudangJadi[itemKey]) {
          gudangJadi[itemKey] = { customer: p.customer, jenis_barang: p.jenis_barang, nama_item: p.nama_item, stok_jadi: 0 };
        }
        gudangJadi[itemKey].stok_jadi += jmlOK;
      }
    });

    // 4. Potong Stok Gudang Jadi Berdasarkan Pengiriman Surat Jalan (Delivery)
    delivData.rows.forEach(d => {
      const itemKey = `${d.customer}|${d.jenis_barang}|${d.nama_item}`;
      const jmlKirim = parseInt(d.jumlah_kirim || 0);
      if (gudangJadi[itemKey]) {
        gudangJadi[itemKey].stok_jadi -= jmlKirim;
      }
    });

    // Saring hasil akhir: hanya keluarkan yang nilainya di atas 0
    const listWIP = Object.values(saldoWIP).filter(w => w.sisa_wip > 0);
    const listGudang = Object.values(gudangJadi).filter(g => g.stok_jadi > 0);

    // Kirim dua data terpisah ke Frontend web
    res.json({
      wip: listWIP,
      gudang: listGudang
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// =========================================================================
// 5. FITUR DOWNLOAD EXCEL PPIC
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
      { header: 'Proses Kerja', key: 'proses_sekarang', width: 15 },
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
