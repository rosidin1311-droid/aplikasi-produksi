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

// BUAT TABEL-TABEL BARU (LEBIH DETIL)
db.serialize(() => {
    // Tabel Transaksi Produksi
    db.run(`CREATE TABLE IF NOT EXISTS produksi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer TEXT,
        jenis_barang TEXT,
        nama_item TEXT,
        proses_sekarang TEXT,
        jumlah_ok INTEGER,
        jumlah_ng INTEGER,
        waktu TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel Transaksi Pengiriman
    db.run(`CREATE TABLE IF NOT EXISTS delivery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer TEXT,
        jenis_barang TEXT,
        nama_item TEXT,
        no_surat_jalan TEXT,
        jumlah_kirim INTEGER,
        waktu TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // TABEL MASTER DATA (TERPISAH KATEGORI)
    db.run(`CREATE TABLE IF NOT EXISTS master_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer TEXT,
        jenis_barang TEXT,
        nama_item TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS master_proses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama_proses TEXT
    )`);

    // Data awal untuk simulasi testing awal
    db.get("SELECT COUNT(*) as count FROM master_items", [], (err, row) => {
        if (row && row.count === 0) {
            db.run("INSERT INTO master_items (customer, jenis_barang, nama_item) VALUES ('PT A', 'Gift Box', 'Box Oreo isi 6')");
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
// API MASTER DATA
// ==========================================
app.get('/api/master', (req, res) => {
    db.all("SELECT * FROM master_items", [], (err, items) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all("SELECT * FROM master_proses", [], (err, proses) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ items, proses });
        });
    });
});

app.post('/api/master/item', (req, res) => {
    const { customer, jenis_barang, nama_item } = req.body;
    db.run("INSERT INTO master_items (customer, jenis_barang, nama_item) VALUES (?, ?, ?)", 
        [customer, jenis_barang, nama_item], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
    });
});

app.post('/api/master/proses', (req, res) => {
    const { nama_proses } = req.body;
    db.run("INSERT INTO master_proses (nama_proses) VALUES (?)", [nama_proses], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ==========================================
// API TRANSAKSI
// ==========================================
app.post('/api/produksi', (req, res) => {
    const { customer, jenis_barang, nama_item, proses_sekarang, jumlah_ok, jumlah_ng } = req.body;
    db.run(`INSERT INTO produksi (customer, jenis_barang, nama_item, proses_sekarang, jumlah_ok, jumlah_ng) VALUES (?, ?, ?, ?, ?, ?)`,
        [customer, jenis_barang, nama_item, proses_sekarang, jumlah_ok, jumlah_ng], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
    });
});

app.post('/api/delivery', (req, res) => {
    const { customer, jenis_barang, nama_item, no_surat_jalan, jumlah_kirim } = req.body;
    db.run(`INSERT INTO delivery (customer, jenis_barang, nama_item, no_surat_jalan, jumlah_kirim) VALUES (?, ?, ?, ?, ?)`,
        [customer, jenis_barang, nama_item, no_surat_jalan, jumlah_kirim], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
    });
});

app.get('/api/wip', (req, res) => {
    const query = `
        SELECT 
            customer, jenis_barang, nama_item, proses_sekarang,
            SUM(jumlah_ok) as total_masuk
        FROM produksi
        GROUP BY customer, jenis_barang, nama_item, proses_sekarang
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all(`SELECT customer, jenis_barang, nama_item, SUM(jumlah_kirim) as total_kirim FROM delivery GROUP BY customer, jenis_barang, nama_item`, [], (err, delivRows) => {
            db.all("SELECT nama_proses FROM master_proses", [], (err, listProses) => {
                const alurProses = listProses.map(p => p.nama_proses);
                let hasilWIP = [];
                let diproses = {};

                rows.forEach(r => {
                    const key = `${r.customer}|${r.jenis_barang}|${r.nama_item}`;
                    if (!diproses[key]) diproses[key] = {};
                    diproses[key][r.proses_sekarang] = r.total_masuk;
                });

                let kirimMap = {};
                delivRows.forEach(d => { 
                    kirimMap[`${d.customer}|${d.jenis_barang}|${d.nama_item}`] = d.total_kirim; 
                });

                rows.forEach(r => {
                    const key = `${r.customer}|${r.jenis_barang}|${r.nama_item}`;
                    const idx = alurProses.indexOf(r.proses_sekarang);

                    if (idx !== -1) {
                        let sisa = 0;
                        if (idx === alurProses.length - 1) {
                            const totalKirim = kirimMap[key] || 0;
                            sisa = r.total_masuk - totalKirim;
                        } else {
                            const prosesBerikutnya = alurProses[idx + 1];
                            const totalLolos = (diproses[key] && diproses[key][prosesBerikutnya]) || 0;
                            sisa = r.total_masuk - totalLolos;
                        }

                        if (sisa > 0) {
                            hasilWIP.push({
                                customer: r.customer,
                                jenis_barang: r.jenis_barang,
                                nama_item: r.nama_item,
                                proses_sekarang: r.proses_sekarang,
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

app.get('/api/export-excel', (req, res) => {
    res.redirect('/api/wip');
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Aplikasi berjalan di port ${PORT}`);
});
