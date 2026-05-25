const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const excelJS = require('exceljs');
const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API MASTER
app.get('/api/master', async (req, res) => {
  try {
    const items = await pool.query('SELECT * FROM master_items ORDER BY id DESC');
    const proses = await pool.query('SELECT * FROM master_proses ORDER BY jenis_barang, urutan_proses ASC');
    res.json({ items: items.rows, proses: proses.rows });
  } catch (err) { res.status(500).send('Server Error'); }
});

// API PRODUKSI (Otomatis deteksi proses terakhir)
app.post('/api/produksi', async (req, res) => {
  const { customer, jenis_barang, nama_item, proses_sekarang, jumlah_ok, jumlah_ng, shift_kerja } = req.body;
  try {
    const query = 'INSERT INTO produksi (customer, jenis_barang, nama_item, proses_sekarang, jumlah_ok, jumlah_ng, shift_kerja) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *';
    await pool.query(query, [customer, jenis_barang, nama_item, proses_sekarang, jumlah_ok, jumlah_ng, shift_kerja]);
    res.json({ success: true });
  } catch (err) { res.status(500).send(err.message); }
});

// LOGIKA UTAMA: WIP & GUDANG
app.get('/api/wip', async (req, res) => {
  try {
    const ruteData = await pool.query('SELECT * FROM master_proses ORDER BY urutan_proses ASC');
    const prodData = await pool.query('SELECT * FROM produksi ORDER BY id ASC');
    const delivData = await pool.query('SELECT * FROM delivery ORDER BY id ASC');
    
    let ruteProduk = {};
    ruteData.rows.forEach(p => {
      if (!ruteProduk[p.jenis_barang]) ruteProduk[p.jenis_barang] = [];
      ruteProduk[p.jenis_barang].push(p.nama_proses);
    });

    let saldoWIP = {}, gudangJadi = {};

    prodData.rows.forEach(p => {
      const itemKey = `${p.customer}|${p.jenis_barang}|${p.nama_item}`;
      const rute = ruteProduk[p.jenis_barang] || [];
      const idx = rute.indexOf(p.proses_sekarang);
      
      // Jika di proses terakhir, masukkan ke Gudang
      if (idx !== -1 && idx === rute.length - 1) {
        if (!gudangJadi[itemKey]) gudangJadi[itemKey] = { customer: p.customer, jenis_barang: p.jenis_barang, nama_item: p.nama_item, stok_jadi: 0 };
        gudangJadi[itemKey].stok_jadi += parseInt(p.jumlah_ok);
      } else {
        const key = `${itemKey}|${p.proses_sekarang}`;
        if (!saldoWIP[key]) saldoWIP[key] = { ...p, sisa_wip: 0 };
        saldoWIP[key].sisa_wip += parseInt(p.jumlah_ok);
      }
    });

    delivData.rows.forEach(d => {
      const itemKey = `${d.customer}|${d.jenis_barang}|${d.nama_item}`;
      if (gudangJadi[itemKey]) gudangJadi[itemKey].stok_jadi -= parseInt(d.jumlah_kirim);
    });

    res.json({ wip: Object.values(saldoWIP).filter(w => w.sisa_wip > 0), gudang: Object.values(gudangJadi).filter(g => g.stok_jadi > 0) });
  } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/delivery', async (req, res) => {
    const { customer, jenis_barang, nama_item, no_surat_jalan, jumlah_kirim } = req.body;
    await pool.query('INSERT INTO delivery (customer, jenis_barang, nama_item, no_surat_jalan, jumlah_kirim) VALUES ($1, $2, $3, $4, $5)', [customer, jenis_barang, nama_item, no_surat_jalan, jumlah_kirim]);
    res.json({ success: true });
});

app.listen(port, () => console.log(`Server running on port ${port}`));
