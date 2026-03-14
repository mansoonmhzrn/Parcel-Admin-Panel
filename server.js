const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const asyncHandler = require('express-async-handler');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/health', asyncHandler(async (req, res) => {
    try {
        const parcels = await db.getAllParcels();
        res.json({ 
            status: 'healthy', 
            database: !!process.env.DATABASE_URL ? 'postgres' : 'unknown',
            parcelCount: parcels.length 
        });
    } catch (err) {
        res.status(500).json({ 
            status: 'error', 
            message: err.message,
            stack: err.stack 
        });
    }
}));

app.use(cors());
app.use(bodyParser.json());

const authMiddleware = asyncHandler(async (req, res, next) => {
    const pin = req.headers['x-admin-pin'] || req.query.pin;
    if (!pin) {
        return res.status(401).json({ message: 'No PIN provided' });
    }

    const admin = await db.getAdminByPin(pin);
    if (admin) {
        req.admin = admin; // Attach admin info to request
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized. Invalid PIN.' });
    }
});

app.post('/api/dispatch', asyncHandler(async (req, res) => {
    const { barcode, carrier } = req.body;

    if (!barcode || !carrier) {
        return res.status(400).json({ message: 'Barcode and carrier are required' });
    }

    const trackingId = `TRK-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    const newParcel = {
        barcode,
        carrier,
        trackingId,
        status: 'Dispatched from Warehouse',
        timestamp: new Date().toISOString()
    };

    try {
        await db.addParcel(newParcel);
        console.log(`[SAVED] Parcel ${barcode} via ${carrier}. Tracking ID: ${trackingId}`);
        res.status(201).json({ 
            message: 'Parcel dispatched and saved successfully',
            trackingId 
        });
    } catch (err) {
        console.error('Database error:', err.message);
        res.status(500).json({ message: 'Failed to save parcel to database' });
    }
}));

app.get('/api/parcels', authMiddleware, asyncHandler(async (req, res) => {
    try {
        const parcels = await db.getAllParcels();
        res.json(parcels);
    } catch (err) {
        res.status(500).json({ message: 'Failed to retrieve parcels' });
    }
}));

app.put('/api/parcels/:id', authMiddleware, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { carrier, status } = req.body;
    
    try {
        const changes = await db.updateParcel(id, { carrier, status });
        if (changes > 0) {
            res.json({ message: 'Parcel updated successfully' });
        } else {
            res.status(404).json({ message: 'Parcel not found' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Failed to update parcel' });
    }
}));

app.delete('/api/parcels/:id', authMiddleware, asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    try {
        const changes = await db.deleteParcel(id);
        if (changes > 0) {
            res.json({ message: 'Parcel deleted successfully' });
        } else {
            res.status(404).json({ message: 'Parcel not found' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Failed to delete parcel' });
    }
}));

app.get('/api/analytics', authMiddleware, asyncHandler(async (req, res) => {
    try {
        const stats = await db.getAnalytics();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ message: 'Failed to retrieve analytics' });
    }
}));

app.get('/api/export', authMiddleware, asyncHandler(async (req, res) => {
    try {
        const parcels = await db.getAllParcels();
        let csv = 'ID,Barcode,Carrier,Tracking ID,Status,Timestamp\n';
        parcels.forEach(p => {
            csv += `${p.id},"${p.barcode}","${p.carrier}","${p.trackingId}","${p.status}","${p.timestamp}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=parcels.csv');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ message: 'Failed to export data' });
    }
}));

app.get('/api/audit', authMiddleware, asyncHandler(async (req, res) => {
    try {
        const logs = await db.getAuditLogs();
        res.json(logs);
    } catch (err) {
        res.status(500).json({ message: 'Failed to retrieve audit logs' });
    }
}));

// Admin Controls
app.post('/api/admin/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const admin = await db.getAdmin(email);

    if (admin) {
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        if (hash === admin.password) {
            // Success - return the PIN so user can see it (for reset) 
            // OR allow them to set a new one. Here we'll return the current PIN.
            return res.json({ message: 'Login successful', pin: admin.pin });
        }
    }
    res.status(401).json({ message: 'Invalid email or password' });
}));

app.post('/api/admin/change-pin', authMiddleware, asyncHandler(async (req, res) => {
    const { newPin } = req.body;
    if (!newPin || newPin.length < 4) {
        return res.status(400).json({ message: 'PIN must be at least 4 digits' });
    }

    await db.updateAdminPin(req.admin.email, newPin);
    res.json({ message: 'PIN updated successfully' });
}));

app.post('/api/admin/reset-pin', asyncHandler(async (req, res) => {
    const { email, password, newPin } = req.body;
    const admin = await db.getAdmin(email);

    if (admin) {
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        if (hash === admin.password) {
            await db.updateAdminPin(email, newPin);
            return res.json({ message: 'PIN reset successfully' });
        }
    }
    res.status(401).json({ message: 'Invalid credentials' });
}));

app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err); // Log full error object
    res.status(500).json({ 
        message: 'Internal Server Error', 
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined 
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Local Tracking System (Offline Mode) Ready.');
});
