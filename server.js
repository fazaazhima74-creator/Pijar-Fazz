const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = 9090;
const DB_PATH = path.join(__dirname, 'pijar.db');
const PUBLIC_DIR = path.join(__dirname, '..'); // Folder root untuk index.html & admin.html

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Server start time untuk uptime
const serverStartTime = Date.now();

// SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database at', DB_PATH);
        initDatabase();
    }
});

// Initialize database tables
function initDatabase() {
    const createTables = [
        `CREATE TABLE IF NOT EXISTS siswa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama TEXT NOT NULL,
            nisn TEXT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS guru (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama TEXT NOT NULL,
            nip TEXT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS materi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            judul TEXT NOT NULL,
            deskripsi TEXT,
            tanggal DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            message TEXT NOT NULL,
            user_email TEXT
        )`
    ];

    createTables.forEach((sql) => {
        db.run(sql, (err) => {
            if (err) console.error('Error creating table:', err);
        });
    });

    console.log('✅ Database tables ready');
}

// Helper functions
function logActivity(message, userEmail = null) {
    const sql = `INSERT INTO activity_logs (message, user_email) VALUES (?, ?)`;
    db.run(sql, [message, userEmail], (err) => {
        if (err) console.error('Error logging activity:', err);
    });
}

// In-memory online users tracking dengan timestamp
let onlineUsers = new Map(); // email -> timestamp last heartbeat
let forceLogoutList = new Set();

// Cleanup offline users every 30 seconds
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (let [email, timestamp] of onlineUsers) {
        if (now - timestamp > 30000) { // 30 seconds timeout
            onlineUsers.delete(email);
            changed = true;
            console.log(`User ${email} offline due to heartbeat timeout`);
        }
    }
    if (changed) {
        console.log(`Online users updated: ${onlineUsers.size} online`);
    }
}, 30000);

// Update online status (heartbeat from frontend)
app.post('/api/update-online', (req, res) => {
    const { email, isOnline } = req.body;
    if (email) {
        if (isOnline) {
            onlineUsers.set(email, Date.now());
        } else {
            onlineUsers.delete(email);
        }
        res.json({ success: true, onlineCount: onlineUsers.size });
    } else {
        res.json({ success: false, message: 'Email required' });
    }
});

// Force logout endpoint untuk admin
app.post('/api/force-logout', (req, res) => {
    const { email } = req.body;
    if (email && onlineUsers.has(email)) {
        onlineUsers.delete(email);
        forceLogoutList.add(email);
        logActivity(`Admin force logout: ${email}`, 'admin');
        res.json({ success: true, message: `User ${email} telah di-force logout` });
    } else {
        res.json({ success: false, message: 'User tidak ditemukan atau sudah offline' });
    }
});

// Endpoint untuk cek apakah user di-force logout
app.post('/api/check-force-logout', (req, res) => {
    const { email } = req.body;
    if (email && forceLogoutList.has(email)) {
        forceLogoutList.delete(email);
        res.json({ forceLogout: true });
    } else {
        res.json({ forceLogout: false });
    }
});

// Get online users list
app.get('/api/online-users', (req, res) => {
    const onlineEmails = Array.from(onlineUsers.keys());
    res.json({ success: true, online: onlineEmails, count: onlineEmails.length });
});

// Get users with online status (for admin)
app.get('/api/users-with-status', (req, res) => {
    const siswaSql = 'SELECT id, nama, nisn, email, created_at FROM siswa ORDER BY created_at DESC';
    const guruSql = 'SELECT id, nama, nip, email, created_at FROM guru ORDER BY created_at DESC';

    db.all(siswaSql, (err, siswa) => {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        db.all(guruSql, (err, guru) => {
            if (err) {
                return res.status(500).json({ success: false, message: err.message });
            }

            const allUsers = [];

            siswa.forEach(s => {
                allUsers.push({
                    ...s,
                    role: 'siswa',
                    isOnline: onlineUsers.has(s.email)
                });
            });

            guru.forEach(g => {
                allUsers.push({
                    ...g,
                    role: 'guru',
                    isOnline: onlineUsers.has(g.email)
                });
            });

            res.json({
                success: true,
                users: allUsers,
                onlineCount: onlineUsers.size
            });
        });
    });
});

// API Endpoints
app.get('/api/status', (req, res) => {
    const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const formatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        onlineCount: onlineUsers.size,
        uptime: formatted,
        uptimeSeconds: uptimeSeconds
    });
});

app.get('/api/users', (req, res) => {
    const siswaSql = 'SELECT id, nama, nisn, email, created_at FROM siswa ORDER BY created_at DESC';
    const guruSql = 'SELECT id, nama, nip, email, created_at FROM guru ORDER BY created_at DESC';

    db.all(siswaSql, (err, siswa) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: err.message });
        }
        db.all(guruSql, (err, guru) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ success: false, message: err.message });
            }

            const siswaWithRole = siswa.map(u => ({...u, role: 'siswa' }));
            const guruWithRole = guru.map(u => ({...u, role: 'guru' }));

            res.json({ success: true, siswa: siswaWithRole, guru: guruWithRole });
        });
    });
});

app.get('/api/materi', (req, res) => {
    const sql = 'SELECT * FROM materi ORDER BY tanggal DESC';
    db.all(sql, (err, data) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: data || [] });
    });
});

app.post('/api/materi', (req, res) => {
    const { judul, deskripsi } = req.body;
    if (!judul) return res.status(400).json({ success: false, message: 'Judul wajib diisi' });
    const sql = `INSERT INTO materi (judul, deskripsi) VALUES (?, ?)`;
    db.run(sql, [judul, deskripsi || ''], function(err) {
        if (err) return res.status(500).json({ success: false, message: err.message });
        logActivity(`Materi ditambahkan: "${judul}"`);
        res.json({ success: true, id: this.lastID });
    });
});

app.delete('/api/materi/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM materi WHERE id = ?';
    db.run(sql, [id], function(err) {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (this.changes === 0) return res.status(404).json({ success: false, message: 'Materi tidak ditemukan' });
        logActivity(`Materi ID ${id} dihapus`);
        res.json({ success: true });
    });
});

app.get('/api/activity-logs', (req, res) => {
    const sql = 'SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 100';
    db.all(sql, (err, logs) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, logs: logs || [] });
    });
});

app.post('/api/clear-logs', (req, res) => {
    const sql = 'DELETE FROM activity_logs';
    db.run(sql, (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        logActivity('Semua activity logs dibersihkan (admin)');
        res.json({ success: true });
    });
});

// Reset DB endpoint (hapus semua data)
app.post('/api/admin/reset-db', async(req, res) => {
    try {
        const confirmToken = req.headers['x-admin-token'];
        const ADMIN_TOKEN = process.env.ADMIN_RESET_TOKEN || 'admin';

        if (!confirmToken || confirmToken !== ADMIN_TOKEN) {
            return res.status(403).json({ success: false, message: 'Forbidden: invalid admin token' });
        }

        onlineUsers.clear();
        forceLogoutList.clear();

        const execSQL = (sql) => new Promise((resolve, reject) => {
            db.run(sql, function(err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            });
        });

        const deletedLogs = await execSQL('DELETE FROM activity_logs');
        const deletedMateri = await execSQL('DELETE FROM materi');
        const deletedSiswa = await execSQL('DELETE FROM siswa');
        const deletedGuru = await execSQL('DELETE FROM guru');

        logActivity('Admin reset-db: bersihkan akun, materi, dan log', 'admin');

        res.json({
            success: true,
            deleted: {
                activity_logs: deletedLogs,
                materi: deletedMateri,
                siswa: deletedSiswa,
                guru: deletedGuru
            }
        });
    } catch (err) {
        console.error('reset-db error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Cek email sudah terdaftar di kedua tabel
function checkEmailExists(email, callback) {
    const sql = 'SELECT 1 FROM siswa WHERE email = ? UNION SELECT 1 FROM guru WHERE email = ?';
    db.get(sql, [email, email], (err, row) => {
        callback(err, !!row);
    });
}

// Auth - Siswa Register
app.post('/api/auth/siswa/register', async(req, res) => {
    const { nama, nisn, email, password } = req.body;
    if (!nama || !email || !password) {
        return res.status(400).json({ success: false, message: 'Nama, email, password wajib' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
    }

    checkEmailExists(email, async(err, exists) => {
        if (exists) {
            return res.status(400).json({ success: false, message: 'Email sudah terdaftar' });
        }
        try {
            const hash = await bcrypt.hash(password, 10);
            const sql = `INSERT INTO siswa (nama, nisn, email, password) VALUES (?, ?, ?, ?)`;
            db.run(sql, [nama, nisn || '', email, hash], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                logActivity(`Siswa registered: ${email} (${nama})`);
                onlineUsers.set(email, Date.now());
                res.json({ success: true, user: { id: this.lastID, nama, email, role: 'siswa', nisn: nisn || '' } });
            });
        } catch (err) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });
});

// Auth - Siswa Login
app.post('/api/auth/siswa/login', async(req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email dan password wajib' });
    }
    const sql = 'SELECT * FROM siswa WHERE email = ?';
    db.get(sql, [email], async(err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, message: 'Email atau password salah' });
        }
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Email atau password salah' });
        }
        onlineUsers.set(email, Date.now());
        logActivity(`Siswa login: ${email}`, email);
        res.json({ success: true, user: { id: user.id, nama: user.nama, email: user.email, role: 'siswa', nisn: user.nisn || '' } });
    });
});

// Auth - Guru Register
app.post('/api/auth/guru/register', async(req, res) => {
    const { nama, nip, email, password } = req.body;
    if (!nama || !email || !password) {
        return res.status(400).json({ success: false, message: 'Nama, email, password wajib' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
    }

    checkEmailExists(email, async(err, exists) => {
        if (exists) {
            return res.status(400).json({ success: false, message: 'Email sudah terdaftar' });
        }
        try {
            const hash = await bcrypt.hash(password, 10);
            const sql = `INSERT INTO guru (nama, nip, email, password) VALUES (?, ?, ?, ?)`;
            db.run(sql, [nama, nip || '', email, hash], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                logActivity(`Guru registered: ${email} (${nama})`);
                onlineUsers.set(email, Date.now());
                res.json({ success: true, user: { id: this.lastID, nama, email, role: 'guru', nip: nip || '' } });
            });
        } catch (err) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });
});

// Auth - Guru Login
app.post('/api/auth/guru/login', async(req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email dan password wajib' });
    }
    const sql = 'SELECT * FROM guru WHERE email = ?';
    db.get(sql, [email], async(err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, message: 'Email atau password salah' });
        }
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Email atau password salah' });
        }
        onlineUsers.set(email, Date.now());
        logActivity(`Guru login: ${email}`, email);
        res.json({ success: true, user: { id: user.id, nama: user.nama, email: user.email, role: 'guru', nip: user.nip || '' } });
    });
});

// Frontend routes
app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// Catch-all for API not found
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, message: 'API endpoint not found' });
});

// Catch-all untuk SPA (redirect ke index.html)
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║     🚀 PIJAR EDUCATION SERVER            ║
╠═══════════════════════════════════════════╣
║  Server: http://localhost:${PORT}            ║
║  Pijar:  http://localhost:${PORT}/index.html  ║
║  Admin:  http://localhost:${PORT}/admin.html  ║
║  Status: http://localhost:${PORT}/api/status  ║
╚═══════════════════════════════════════════╝
    `);
});