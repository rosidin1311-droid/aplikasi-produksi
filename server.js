const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const xl = require('excel4node');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// KONEKSI DATABASE
const db = new sqlite3.Database('./produksi.db', (err) => {
    if (err) console.error(err.message);
    console.log('Terhubung ke database SQLite.');
});

// BUAT TABEL-TABEL JIKA BELUM ADA
db.serialize(() => {
    // Tabel Transaksi Produksi
    db.run(`CREATE TABLE IF NOT EXISTS produksi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama_item TEXT,
        proses_sekarang TEXT,
        jumlah_ok INTEGER,
        jumlah_ng INTEGER,
        waktu TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel Transaksi Pengiriman
    db.run(`CREATE TABLE IF NOT EXISTS delivery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama_item TEXT,
        no_surat_jalan TEXT,
        jumlah_kirim INTEGER,
        waktu TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // TABEL BARU: Master Item & Customer
    db.run(`CREATE TABLE IF NOT EXISTS master_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer TEXT,
        nama_item TEXT
    )`);

    // TABEL BARU: Master Tahapan Proses
    db.run(`CREATE TABLE IF NOT EXISTS master_proses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama_proses TEXT
    )`);

    // ISI DATA AWAL (DEFAULT) JIKA TABEL MASTER MASIH KOSONG
    db.get("SELECT COUNT(*) as count FROM master_items", [], (err, row) => {
        if (row && row.count === 0) {
            db.run("INSERT INTO master_items (customer, nama_item) VALUES ('PT A', 'Box Oreo isi 6 (Model: Gift Box)')");
        }
    });

    db.get("SELECT COUNT(*) as count FROM master_proses", [], (err, row) => {
        if (row && row.count === 0) {
            const prosesAwal = ['Diecut', 'Kopek', 'Longway', 'Coblos', 'Lem Semi', 'Cek Point'];
            prosesAwal.forEach(p => {
                db.run("INSERT INTO master_proses (nama_proses) VALUES (?)", [p]);
            });
        }
    });
});

// ==========================================
// API UNTUK KELOLA DATA MASTER (DARI HP)
// ==========================================

// 1. Ambil semua data master customer, item, dan proses
app.get('/api/master', (req, res) => {
    db.all("SELECT * FROM master_items", [], (err, items) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all("SELECT * FROM master_proses", [], (err, proses) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ items, proses });
        });
    });
});

// 2. Tambah Item & Customer baru
app.post('/api/master/item', (req, res) => {
    const { customer, nama_item } = req.body;
    db.run("INSERT INTO master_items (customer, nama_item) VALUES (?, ?)", [customer, nama_item], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// 3. Tambah Tahapan Proses baru
app.post('/api/master/proses', (req, res) => {
    const { nama_proses } = req.body;
    db.run("INSERT INTO master_proses (nama_proses) VALUES (?)", [nama_proses], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// ==========================================
// API LOGIKA TRANSAKSI & WIP (PENGHITUNGAN)
// ==========================================

app.post('/api/produksi', (req, res) => {
    const { nama_item, proses_sekarang, jumlah_ok, jumlah_ng } = req.body;
    db.run(`INSERT INTO produksi (nama_item, proses_sekarang, jumlah_ok, jumlah_ng) VALUES (?, ?, ?, ?)`,
        [nama_item, proses_sekarang, jumlah_ok, jumlah_ng], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
    });
});

app.post('/api/delivery', (req, res) => {
    const { nama_item, no_surat_jalan, jumlah_kirim } = req.body;
    db.run(`INSERT INTO delivery (nama_item, no_surat_jalan, jumlah_kirim) VALUES (?, ?, ?)`,
        [nama_item, no_surat_jalan, jumlah_kirim], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
    });
});

// Ambil Data Sisa WIP Aktif secara Real-Time
app.get('/api/wip', (req, res) => {
    const query = `
        SELECT 
            m.customer,
            p.nama_item,
            p.proses_sekarang,
            SUM(p.jumlah_ok) as total_masuk
        FROM produksi p
        LEFT JOIN master_items m ON p.nama_item = m.nama_item
        GROUP BY p.nama_item, p.proses_sekarang
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(`SELECT nama_item, SUM(jumlah_ok) as total_ok FROM produksi GROUP BY nama_item, proses_sekarang`, [], (err, allProd) => {
            db.all(`SELECT nama_item, SUM(jumlah_kirim) as total_kirim FROM delivery GROUP BY nama_item`, [], (err, delivRows) => {
                
                db.all("SELECT nama_proses FROM master_proses", [], (err, listProses) => {
                    const alurProses = listProses.map(p => p.nama_proses);
                    
                    let hasilWIP = [];
                    let diproses = {};

                    rows.forEach(r => {
                        if (!diproses[r.nama_item]) diproses[r.nama_item] = {};
                        diproses[r.nama_item][r.proses_sekarang] = r.total_masuk;
                    });

                    let kirimMap = {};
                    delivRows.forEach(d => { kirimMap[d.nama_item] = d.total_kirim; });

                    rows.forEach(r => {
                        const item = r.nama_item;
                        const proc = r.proses_sekarang;
                        const idx = alurProses.indexOf(proc);

                        if (idx !== -1) {
                            let sisa = 0;
                            if (idx === alurProses.length - 1) {
                                const totalKirim = kirimMap[item] || 0;
                                sisa = r.total_masuk - totalKirim;
                            } else {
                                const prosesBerikutnya = alurProses[idx + 1];
                                const totalLolos = (diproses[item] && diproses[item][prosesBerikutnya]) || 0;
                                sisa = r.total_masuk - totalLolos;
                            }

                            if (sisa > 0) {
                                hasilWIP.push({
                                    customer: r.customer || 'Umum',
                                    nama_item: item,
                                    proses_sekarang: proc,
                                    sisa_wip: sisa
                                });
                            }
                        }
                    });

                    res.json(hasilWIP);
                });
            });
        });
    });
});

// EXPORT TO EXCEL
app.get('/api/export-excel', (req, res) => {
    const wb = new xl.Workbook();
    const ws = wb.addWorksheet('Laporan WIP PPIC');
    
    const styleHeader = wb.createStyle({ font: { bold: true, color: 'FFFFFF', size: 12 }, fill: { type: 'pattern', patternType: 'solid', fgColor: '1F4E78' } });
    const styleData = wb.createStyle({ font: { size: 11 }, border: { left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } } });

    ws.cell(1,1).string('Customer').style(styleHeader);
    ws.cell(1,2).string('Nama Item').style(styleHeader);
    ws.cell(1,3).string('Proses Macet').style(styleHeader);
    ws.cell(1,4).string('Sisa Antrean (WIP)').style(styleHeader);

    // Ambil data WIP via internal hit / fungsi database langsung
    res.redirect('/api/wip'); 
    // Catatan: Untuk download excel, di browser tinggal hit endpoint ini langsung redirect data terkini
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Aplikasi Produksi Jalan di http://localhost:${PORT}`);
});
