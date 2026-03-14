const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

// Check if we have a PostgreSQL connection string (provided by Neon/Vercel)
const isPostgres = !!process.env.DATABASE_URL;

let dbOps;

if (isPostgres) {
    console.log('Using PostgreSQL Database (Neon/Cloud).');
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Required for Neon
    });

    const query = (text, params) => pool.query(text, params);

    // Initialize Schema
    const initDb = async () => {
        await query(`CREATE TABLE IF NOT EXISTS parcels (
            id SERIAL PRIMARY KEY,
            barcode TEXT NOT NULL,
            carrier TEXT NOT NULL,
            tracking_id TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL
        )`);

        await query(`CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            parcel_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            timestamp TIMESTAMPTZ NOT NULL
        )`);

        await query(`CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            pin TEXT NOT NULL
        )`);

        // Seed default admin
        const adminCheck = await query("SELECT COUNT(*) FROM admins");
        if (parseInt(adminCheck.rows[0].count) === 0) {
            const defaultPass = crypto.createHash('sha256').update('admin123').digest('hex');
            await query("INSERT INTO admins (email, password, pin) VALUES ($1, $2, $3)", 
                ['admin@warehouse.com', defaultPass, '1234']);
            console.log('Default admin seeded.');
        }
    };

    initDb().catch(err => {
        console.error('PostgreSQL Initialization Error:', err);
    });

    dbOps = {
        addParcel: async (parcel) => {
            const { barcode, carrier, trackingId, status, timestamp } = parcel;
            const res = await query(
                `INSERT INTO parcels (barcode, carrier, tracking_id, status, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [barcode, carrier, trackingId, status, timestamp]
            );
            const id = res.rows[0].id;
            await dbOps.logAction(id, 'CREATE', `Parcel created with barcode ${barcode}`);
            return id;
        },
        getAllParcels: async () => {
            const res = await query(`SELECT id, barcode, carrier, tracking_id as "trackingId", status, timestamp FROM parcels ORDER BY timestamp DESC`);
            return res.rows;
        },
        updateParcel: async (id, updates) => {
            const { carrier, status } = updates;
            const res = await query(`UPDATE parcels SET carrier = $1, status = $2 WHERE id = $3`, [carrier, status, id]);
            if (res.rowCount > 0) {
                await dbOps.logAction(id, 'UPDATE', `Updated to Carrier: ${carrier}, Status: ${status}`);
            }
            return res.rowCount;
        },
        deleteParcel: async (id) => {
            const res = await query(`DELETE FROM parcels WHERE id = $1`, [id]);
            if (res.rowCount > 0) {
                await dbOps.logAction(id, 'DELETE', `Parcel record deleted`);
            }
            return res.rowCount;
        },
        logAction: async (parcelId, action, details) => {
            const timestamp = new Date().toISOString();
            const res = await query(
                `INSERT INTO audit_logs (parcel_id, action, details, timestamp) VALUES ($1, $2, $3, $4) RETURNING id`,
                [parcelId, action, details, timestamp]
            );
            return res.rows[0].id;
        },
        getAnalytics: async () => {
            const total = await query("SELECT COUNT(*) FROM parcels");
            const today = await query("SELECT COUNT(*) FROM parcels WHERE date(timestamp) = CURRENT_DATE");
            const carriers = await query("SELECT carrier, COUNT(*) FROM parcels GROUP BY carrier");
            const statuses = await query("SELECT status, COUNT(*) FROM parcels GROUP BY status");
            
            return {
                total: parseInt(total.rows[0].count),
                today: parseInt(today.rows[0].count),
                carriers: carriers.rows.map(r => ({ carrier: r.carrier, count: parseInt(r.count) })),
                statuses: statuses.rows.map(r => ({ status: r.status, count: parseInt(r.count) }))
            };
        },
        getAuditLogs: async () => {
            const res = await query(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100`);
            return res.rows;
        },
        getAdmin: async (email) => {
            const res = await query("SELECT * FROM admins WHERE email = $1", [email]);
            return res.rows[0];
        },
        getAdminByPin: async (pin) => {
            const res = await query("SELECT * FROM admins WHERE pin = $1", [pin]);
            return res.rows[0];
        },
        updateAdminPin: async (email, newPin) => {
            const res = await query("UPDATE admins SET pin = $1 WHERE email = $2", [newPin, email]);
            return res.rowCount;
        },
        updateAdminPassword: async (email, newPasswordHash) => {
            const res = await query("UPDATE admins SET password = $1 WHERE email = $2", [newPasswordHash, email]);
            return res.rowCount;
        }
    };

} else {
    // Fallback to SQLite (Local Dev)
    console.log('Using SQLite Database (Local).');
    const dbPath = path.resolve(__dirname, 'parcels.db');
    const db = new sqlite3.Database(dbPath);

    // ... (rest of the existing SQLite logic)
    const initDb = () => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS parcels (id INTEGER PRIMARY KEY AUTOINCREMENT, barcode TEXT, carrier TEXT, trackingId TEXT UNIQUE, status TEXT, timestamp TEXT)`);
            db.run(`CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, parcel_id INTEGER, action TEXT, details TEXT, timestamp TEXT)`);
            db.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, pin TEXT)`);
            
            db.get("SELECT COUNT(*) as count FROM admins", (err, row) => {
                if (!err && row.count === 0) {
                    const defaultPass = crypto.createHash('sha256').update('admin123').digest('hex');
                    db.run("INSERT INTO admins (email, password, pin) VALUES (?, ?, ?)", ['admin@warehouse.com', defaultPass, '1234']);
                }
            });
        });
    };
    initDb();

    dbOps = {
        addParcel: (parcel) => new Promise((res, rej) => {
            const { barcode, carrier, trackingId, status, timestamp } = parcel;
            db.run(`INSERT INTO parcels (barcode, carrier, trackingId, status, timestamp) VALUES (?, ?, ?, ?, ?)`, 
                [barcode, carrier, trackingId, status, timestamp], function(err) {
                if (err) rej(err);
                else {
                    const id = this.lastID;
                    dbOps.logAction(id, 'CREATE', `Parcel created`).then(() => res(id));
                }
            });
        }),
        getAllParcels: () => new Promise((res, rej) => {
            db.all(`SELECT * FROM parcels ORDER BY timestamp DESC`, (err, rows) => err ? rej(err) : res(rows));
        }),
        updateParcel: (id, updates) => new Promise((res, rej) => {
            db.run(`UPDATE parcels SET carrier = ?, status = ? WHERE id = ?`, [updates.carrier, updates.status, id], function(err) {
                if (err) rej(err);
                else dbOps.logAction(id, 'UPDATE', 'Updated').then(() => res(this.changes));
            });
        }),
        deleteParcel: (id) => new Promise((res, rej) => {
            db.run(`DELETE FROM parcels WHERE id = ?`, [id], function(err) {
                if (err) rej(err);
                else dbOps.logAction(id, 'DELETE', 'Deleted').then(() => res(this.changes));
            });
        }),
        logAction: (parcelId, action, details) => new Promise((res, rej) => {
            db.run(`INSERT INTO audit_logs (parcel_id, action, details, timestamp) VALUES (?, ?, ?, ?)`, 
                [parcelId, action, details, new Date().toISOString()], err => err ? rej(err) : res());
        }),
        getAnalytics: () => new Promise(async (res, rej) => {
            try {
                const total = await new Promise((r, j) => db.get("SELECT COUNT(*) as c FROM parcels", (e, row) => e ? j(e) : r(row.c)));
                const today = await new Promise((r, j) => db.get("SELECT COUNT(*) as c FROM parcels WHERE date(timestamp) = date('now')", (e, row) => e ? j(e) : r(row.c)));
                const carriers = await new Promise((r, j) => db.all("SELECT carrier, COUNT(*) as count FROM parcels GROUP BY carrier", (e, rows) => e ? j(e) : r(rows)));
                const statuses = await new Promise((r, j) => db.all("SELECT status, COUNT(*) as count FROM parcels GROUP BY status", (e, rows) => e ? j(e) : r(rows)));
                res({ total, today, carriers, statuses });
            } catch (e) { rej(e); }
        }),
        getAuditLogs: () => new Promise((res, rej) => {
            db.all(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100`, (err, rows) => err ? rej(err) : res(rows));
        }),
        getAdmin: (email) => new Promise((res, rej) => {
            db.get("SELECT * FROM admins WHERE email = ?", [email], (err, row) => err ? rej(err) : res(row));
        }),
        getAdminByPin: (pin) => new Promise((res, rej) => {
            db.get("SELECT * FROM admins WHERE pin = ?", [pin], (err, row) => err ? rej(err) : res(row));
        }),
        updateAdminPin: (email, newPin) => new Promise((res, rej) => {
            db.run("UPDATE admins SET pin = ? WHERE email = ?", [newPin, email], function(err) { err ? rej(err) : res(this.changes); });
        }),
        updateAdminPassword: (email, newPasswordHash) => new Promise((res, rej) => {
            db.run("UPDATE admins SET password = ? WHERE email = ?", [newPasswordHash, email], function(err) { err ? rej(err) : res(this.changes); });
        })
    };
}

module.exports = dbOps;
