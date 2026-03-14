const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'parcels.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS parcels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT NOT NULL,
            carrier TEXT NOT NULL,
            trackingId TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parcel_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            timestamp TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            pin TEXT NOT NULL
        )`, () => {
            // Seed default admin if table is newly created and empty
            db.get("SELECT COUNT(*) as count FROM admins", (err, row) => {
                if (!err && row.count === 0) {
                    const crypto = require('crypto');
                    const defaultPass = crypto.createHash('sha256').update('admin123').digest('hex');
                    db.run("INSERT INTO admins (email, password, pin) VALUES (?, ?, ?)", 
                        ['admin@warehouse.com', defaultPass, '1234']);
                    console.log('Default admin seeded: admin@warehouse.com / admin123 / PIN: 1234');
                }
            });
        });
        
        console.log('Database tables initialized.');
    });
}

const dbOps = {
    addParcel: (parcel) => {
        return new Promise((resolve, reject) => {
            const { barcode, carrier, trackingId, status, timestamp } = parcel;
            const sql = `INSERT INTO parcels (barcode, carrier, trackingId, status, timestamp) VALUES (?, ?, ?, ?, ?)`;
            db.run(sql, [barcode, carrier, trackingId, status, timestamp], function(err) {
                if (err) reject(err);
                else {
                    const parcelId = this.lastID;
                    dbOps.logAction(parcelId, 'CREATE', `Parcel created with barcode ${barcode}`).then(() => resolve(parcelId)).catch(reject);
                }
            });
        });
    },
    getAllParcels: () => {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM parcels ORDER BY timestamp DESC`;
            db.all(sql, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    updateParcel: (id, updates) => {
        return new Promise((resolve, reject) => {
            const { carrier, status } = updates;
            const sql = `UPDATE parcels SET carrier = ?, status = ? WHERE id = ?`;
            db.run(sql, [carrier, status, id], function(err) {
                if (err) reject(err);
                else {
                    const changes = this.changes;
                    if (changes > 0) {
                        dbOps.logAction(id, 'UPDATE', `Updated to Carrier: ${carrier}, Status: ${status}`).then(() => resolve(changes)).catch(reject);
                    } else {
                        resolve(changes);
                    }
                }
            });
        });
    },
    deleteParcel: (id) => {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM parcels WHERE id = ?`;
            db.run(sql, [id], function(err) {
                if (err) reject(err);
                else {
                    const changes = this.changes;
                    if (changes > 0) {
                        dbOps.logAction(id, 'DELETE', `Parcel record deleted`).then(() => resolve(changes)).catch(reject);
                    } else {
                        resolve(changes);
                    }
                }
            });
        });
    },
    logAction: (parcelId, action, details) => {
        return new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString();
            const sql = `INSERT INTO audit_logs (parcel_id, action, details, timestamp) VALUES (?, ?, ?, ?)`;
            db.run(sql, [parcelId, action, details, timestamp], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    },
    getAnalytics: () => {
        return new Promise((resolve, reject) => {
            const queries = {
                totalParcels: "SELECT COUNT(*) as count FROM parcels",
                byCarrier: "SELECT carrier, COUNT(*) as count FROM parcels GROUP BY carrier",
                todayCount: "SELECT COUNT(*) as count FROM parcels WHERE date(timestamp) = date('now')",
                statusBreakdown: "SELECT status, COUNT(*) as count FROM parcels GROUP BY status"
            };

            const stats = {};
            const keys = Object.keys(queries);
            let completed = 0;

            keys.forEach(key => {
                db.get(queries[key], [], (err, row) => {
                    if (err) return reject(err);
                    stats[key] = row.count || row; // row if it's multiple rows (not for get, need all)
                });
            });

            // Re-implementing with proper all/each for grouped queries
            const fetchStats = async () => {
                try {
                    const total = await new Promise((res, rej) => db.get(queries.totalParcels, (e, r) => e ? rej(e) : res(r.count)));
                    const today = await new Promise((res, rej) => db.get(queries.todayCount, (e, r) => e ? rej(e) : res(r.count)));
                    const carriers = await new Promise((res, rej) => db.all(queries.byCarrier, (e, r) => e ? rej(e) : res(r)));
                    const statuses = await new Promise((res, rej) => db.all(queries.statusBreakdown, (e, r) => e ? rej(e) : res(r)));
                    
                    resolve({ total, today, carriers, statuses });
                } catch (e) {
                    reject(e);
                }
            };
            fetchStats();
        });
    },
    getAuditLogs: () => {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100`;
            db.all(sql, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    getAdmin: (email) => {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM admins WHERE email = ?", [email], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    getAdminByPin: (pin) => {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM admins WHERE pin = ?", [pin], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    updateAdminPin: (email, newPin) => {
        return new Promise((resolve, reject) => {
            db.run("UPDATE admins SET pin = ? WHERE email = ?", [newPin, email], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    },
    updateAdminPassword: (email, newPasswordHash) => {
        return new Promise((resolve, reject) => {
            db.run("UPDATE admins SET password = ? WHERE email = ?", [newPasswordHash, email], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }
};

module.exports = dbOps;
