const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./produksi.db');
const bcrypt = require('bcryptjs');

db.serialize(() => {
    // Buat Tabel
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, role TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, nama_customer TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS processes (id INTEGER PRIMARY KEY, nama_proses TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS models (id INTEGER PRIMARY KEY, nama_model TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS model_routings (id INTEGER PRIMARY KEY, model_id INTEGER, process_id INTEGER, step_number INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, customer_id INTEGER, model_id INTEGER, nama_item TEXT, target_produksi INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS production_logs (id INTEGER PRIMARY KEY, item_id INTEGER, process_id INTEGER, jumlah_ok INTEGER DEFAULT 0, jumlah_ng INTEGER DEFAULT 0, tanggal DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, item_id INTEGER, jumlah_kirim INTEGER, no_surat_jalan TEXT, tanggal_kirim DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    // Isi Akun Login Default (Password: admin123)
    const hash = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO users (id, username, password, role) VALUES (1, 'admin', '${hash}', 'admin')`);

    // Isi Data Master Awal (PT A)
    db.run(`INSERT OR IGNORE INTO customers (id, nama_customer) VALUES (1, 'PT A')`);

    // Isi Master Proses Global
    const listProses = ['Flexo', 'Lem Auto', 'Cek Point', 'Diecut', 'Kopek', 'Longway', 'Coblos', 'Lem Semi'];
    listProses.forEach((p, index) => {
        db.run(`INSERT OR IGNORE INTO processes (id, nama_proses) VALUES (${index + 1}, '${p}')`);
    });

    // Isi Master Model
    db.run(`INSERT OR IGNORE INTO models (id, nama_model) VALUES (1, 'Master Box'), (2, 'Gift Box'), (3, 'Inner Pad')`);

    // Set Alur Routing Persis Sesuai Request Kamu
    const routings = [
        // Master Box: Flexo (1), Lem Auto (2), Cek Point (3)
        {m: 1, p: 1, s: 1}, {m: 1, p: 2, s: 2}, {m: 1, p: 3, s: 3},
        // Gift Box: Diecut (4), Kopek (5), Longway (6), Coblos (7), Lem Semi (8), Cek Point (3)
        {m: 2, p: 4, s: 1}, {m: 2, p: 5, s: 2}, {m: 2, p: 6, s: 3}, {m: 2, p: 7, s: 4}, {m: 2, p: 8, s: 5}, {m: 2, p: 3, s: 6},
        // Inner Pad: Diecut (4), Kopek (5), Coblos (7), Cek Point (3)
        {m: 3, p: 4, s: 1}, {m: 3, p: 5, s: 2}, {m: 3, p: 7, s: 3}, {m: 3, p: 3, s: 4}
    ];
    routings.forEach(r => {
        db.run(`INSERT OR IGNORE INTO model_routings (model_id, process_id, step_number) VALUES (${r.m}, ${r.p}, ${r.s})`);
    });

    // Tambah Item Contoh: Box Oreo isi 6 (Jenis Model: Gift Box)
    db.run(`INSERT OR IGNORE INTO items (id, customer_id, model_id, nama_item, target_produksi) VALUES (1, 1, 2, 'Box Oreo isi 6', 500)`);
});

module.exports = db;