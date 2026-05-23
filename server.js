const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const db = require('./database');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const SECRET_KEY = 'PABRIK_RAHASIA_KITA';

// 🔐 API LOGIN
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ message: 'Username atau Password Salah!' });
        }
        const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ token, role: user.role });
    });
});

// 📊 API HITUNG SISA WIP > 0 (Dinamis & Otomatis Sembunyikan yang 0)
const getWipData = (callback) => {
    const query = `
        SELECT 
            c.nama_customer, m.nama_model, i.nama_item, p.nama_proses AS proses_saat_ini, mr.step_number,
            CASE 
                WHEN mr.step_number = 1 THEN i.target_produksi - IFNULL(current_log.total_masuk, 0)
                ELSE IFNULL(prev_log.total_ok, 0) - IFNULL(current_log.total_masuk, 0)
            END AS sisa_wip
        FROM items i
        JOIN customers c ON i.customer_id = c.id
        JOIN models m ON i.model_id = m.id
        JOIN model_routings mr ON m.id = mr.model_id
        JOIN processes p ON mr.process_id = p.id
        LEFT JOIN (
            SELECT item_id, process_id, SUM(jumlah_ok + jumlah_ng) AS total_masuk FROM production_logs GROUP BY item_id, process_id
        ) current_log ON i.id = current_log.item_id AND p.id = current_log.process_id
        LEFT JOIN model_routings prev_mr ON m.id = prev_mr.model_id AND prev_mr.step_number = mr.step_number - 1
        LEFT JOIN (
            SELECT item_id, process_id, SUM(jumlah_ok) AS total_ok FROM production_logs GROUP BY item_id, process_id
        ) prev_log ON i.id = prev_log.item_id AND prev_mr.process_id = prev_log.process_id
        WHERE sisa_wip > 0
        ORDER BY c.nama_customer, i.nama_item, mr.step_number ASC`;
    db.all(query, [], (err, rows) => callback(err, rows));
};

app.get('/api/wip', (req, res) => {
    getWipData((err, rows) => { if (err) res.status(500).send(err.message); else res.json(rows); });
});

// 💾 API AUTO-SAVE INPUT PRODUKSI
app.post('/api/produksi', (req, res) => {
    const { item_id, process_id, jumlah_ok, jumlah_ng } = req.body;
    db.run(`INSERT INTO production_logs (item_id, process_id, jumlah_ok, jumlah_ng) VALUES (?, ?, ?, ?)`,
        [item_id, process_id, jumlah_ok, jumlah_ng], (err) => {
            if (err) res.status(500).json({ message: 'Gagal simpan' });
            else res.json({ message: '✔️ Tersimpan Otomatis ke Server' });
        });
});

// 🚚 API INPUT DELIVERY (POTONG STOK)
app.post('/api/delivery', (req, res) => {
    const { item_id, jumlah_kirim, no_surat_jalan } = req.body;
    db.run(`INSERT INTO deliveries (item_id, jumlah_kirim, no_surat_jalan) VALUES (?, ?, ?)`,
        [item_id, jumlah_kirim, no_surat_jalan], (err) => {
            if (err) res.status(500).json({ message: 'Gagal kirim' });
            else res.json({ message: '🟢 Pengiriman Berhasil dicatat!' });
        });
});

// 📥 API EXPORT WIP KE EXCEL UNTUK PPIC
app.get('/api/export-wip', (req, res) => {
    getWipData(async (err, rows) => {
        let workbook = new ExcelJS.Workbook();
        let worksheet = workbook.addWorksheet('Sisa WIP Aktif');
        worksheet.columns = [
            { header: 'Customer', key: 'nama_customer', width: 15 },
            { header: 'Model', key: 'nama_model', width: 15 },
            { header: 'Nama Item', key: 'nama_item', width: 25 },
            { header: 'Proses Mandek', key: 'proses_saat_ini', width: 15 },
            { header: 'Sisa WIP (Antrean)', key: 'sisa_wip', width: 20 }
        ];
        rows.forEach(row => worksheet.addRow(row));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Laporan_WIP_PPIC.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    });
});

app.listen(3000, () => console.log('Aplikasi Produksi Jalan di http://localhost:3000'));