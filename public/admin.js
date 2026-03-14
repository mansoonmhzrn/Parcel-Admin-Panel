document.addEventListener('DOMContentLoaded', () => {
    const parcelList = document.getElementById('parcel-list');
    const searchInput = document.getElementById('search-input');
    const editModal = document.getElementById('edit-modal');
    const saveEditBtn = document.getElementById('save-edit-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    
    let allParcels = [];
    let editingId = null;
    let currentCategory = 'all';

    let adminPin = sessionStorage.getItem('adminPin');
    let authPromise = null;
    const logoutBtn = document.getElementById('logout-btn');

    async function checkAuth() {
        if (adminPin) return;
        if (authPromise) return authPromise;

        authPromise = new Promise((resolve) => {
            const pin = prompt('Enter Admin PIN to access dashboard (Default: 1234).\nType "RESET" if you forgot your PIN:');
            if (pin === 'RESET') {
                document.getElementById('reset-modal').classList.remove('hidden');
                // We'll resolve once they reset, but for now we block
                authPromise = null;
                resolve();
            } else if (pin) {
                adminPin = pin;
                sessionStorage.setItem('adminPin', adminPin);
                authPromise = null;
                resolve();
            } else {
                window.location.href = 'index.html';
                authPromise = null;
                resolve();
            }
        });

        return authPromise;
    }

    async function secureFetch(url, options = {}) {
        await checkAuth();
        if (!adminPin) return new Response(null, { status: 401 });

        const headers = options.headers || {};
        headers['x-admin-pin'] = adminPin;
        
        const response = await fetch(url, { ...options, headers });
        
        if (response.status === 401) {
            sessionStorage.removeItem('adminPin');
            adminPin = null;
            // Only alert and retry if we haven't just failed
            if (!options._is_retry) {
                alert('Invalid PIN. Please try again.');
                await checkAuth();
                if (adminPin) {
                    return await secureFetch(url, { ...options, _is_retry: true });
                }
            }
        }
        return response;
    }

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('adminPin');
        window.location.href = 'index.html';
    });

    async function loadParcels() {
        try {
            parcelList.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;"><div class="pulsing">Loading parcels...</div></td></tr>';
            const response = await secureFetch('/api/parcels');
            if (!response.ok) return;
            allParcels = await response.json();
            updateDisplay();
            loadAnalytics();
        } catch (error) {
            console.error('Error loading parcels:', error);
        }
    }

    async function loadAnalytics() {
        try {
            const response = await secureFetch('/api/analytics');
            const stats = await response.json();
            
            document.getElementById('stat-total').textContent = stats.total;
            document.getElementById('stat-today').textContent = stats.today;
            
            const carrierList = document.getElementById('stat-carriers');
            carrierList.innerHTML = stats.carriers.map(c => `
                <div class="mini-row-wrapper" style="margin-bottom: 0.75rem;">
                    <div class="mini-row" style="border:none; margin-bottom: 2px;">
                        <span>${c.carrier.replace('_', ' ').toUpperCase()}</span>
                        <b>${c.count}</b>
                    </div>
                    <div style="height: 6px; background: var(--bg); border-radius: 10px; overflow: hidden;">
                        <div style="width: ${(c.count / stats.total * 100).toFixed(1)}%; height: 100%; background: var(--primary); border-radius: 10px;"></div>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading analytics:', error);
        }
    }

    const exportBtn = document.getElementById('export-btn');
    exportBtn.addEventListener('click', () => {
        // For download, we'll append the pin to the URL
        window.location.href = `/api/export?pin=${adminPin || prompt('PIN:')}`;
    });

    function updateDisplay() {
        const query = searchInput.value.toLowerCase();
        let filtered = allParcels;

        // Filter by category
        if (currentCategory !== 'all' && currentCategory !== 'audit') {
            filtered = filtered.filter(p => p.carrier === currentCategory);
        }

        // Filter by search
        if (query) {
            filtered = filtered.filter(p => 
                p.barcode.toLowerCase().includes(query) || 
                p.trackingId.toLowerCase().includes(query)
            );
        }

        renderParcels(filtered);
    }

    function renderParcels(parcels) {
        console.log(`Rendering ${parcels.length} parcels for category: ${currentCategory}`);
        parcelList.innerHTML = '';
        
        if (parcels.length === 0) {
            parcelList.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">No parcels found in this category</td></tr>';
            return;
        }

        parcels.forEach(parcel => {
            const trackingUrls = {
                royal_mail: `https://www.royalmail.com/track-your-item?trackingId=${parcel.trackingId}`,
                evri: `https://www.evri.com/track-a-parcel?trackingNumber=${parcel.trackingId}`
            };
            const trackUrl = trackingUrls[parcel.carrier] || '#';
            const linkTag = trackUrl !== '#' ? `<a href="${trackUrl}" target="_blank" style="text-decoration:none; color:var(--primary)">${parcel.trackingId}</a>` : parcel.trackingId;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${parcel.barcode}</td>
                <td style="font-family: monospace; font-size: 0.875rem;">${linkTag}</td>
                <td>${parcel.carrier.replace('_', ' ').toUpperCase()}</td>
                <td><span class="status-badge">${parcel.status}</span></td>
                <td style="font-size: 0.8125rem;">${new Date(parcel.timestamp).toLocaleString()}</td>
                <td class="actions">
                    <button class="action-btn edit-btn">Edit</button>
                    <button class="action-btn print-btn" style="background:var(--success)">Print</button>
                    <button class="action-btn delete-btn">Delete</button>
                </td>
            `;

            // Attach listeners safely
            const eb = row.querySelector('.edit-btn');
            const pb = row.querySelector('.print-btn');
            const dbBtn = row.querySelector('.delete-btn');
            
            eb.onclick = () => openEdit(parcel);
            pb.onclick = () => openPrintLabel(parcel);
            dbBtn.onclick = () => deleteParcel(parcel.id);

            parcelList.appendChild(row);
        });
    }

    searchInput.addEventListener('input', updateDisplay);

    // Tab Listeners
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update category and display
            currentCategory = btn.dataset.category;
            
            if (currentCategory === 'audit') {
                document.getElementById('parcel-view').classList.add('hidden');
                document.getElementById('audit-view').classList.remove('hidden');
                searchInput.classList.add('hidden');
                loadAuditLogs();
            } else {
                document.getElementById('parcel-view').classList.remove('hidden');
                document.getElementById('audit-view').classList.add('hidden');
                searchInput.classList.remove('hidden');
                updateDisplay();
            }
        });
    });

    async function loadAuditLogs() {
        try {
            const response = await secureFetch('/api/audit');
            const logs = await response.json();
            const list = document.getElementById('audit-list');
            list.innerHTML = logs.map(log => `
                <tr>
                    <td>#${log.parcel_id || 'N/A'}</td>
                    <td><b style="color:var(--primary)">${log.action}</b></td>
                    <td style="font-size:0.875rem">${log.details}</td>
                    <td style="font-size:0.8125rem">${new Date(log.timestamp).toLocaleString()}</td>
                </tr>
            `).join('');
        } catch (error) {
            console.error('Error loading audit logs:', error);
        }
    }

    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icon = type === 'success' ? '✅' : '❌';
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function updateClock() {
        const now = new Date();
        const clock = document.getElementById('live-clock');
        if (clock) {
            clock.textContent = now.toLocaleTimeString();
        }
    }
    setInterval(updateClock, 1000);
    updateClock();

    function openEdit(parcel) {
        editingId = parcel.id;
        document.getElementById('edit-carrier').value = parcel.carrier;
        document.getElementById('edit-status').value = parcel.status;
        editModal.classList.remove('hidden');
    }

    cancelEditBtn.addEventListener('click', () => {
        editModal.classList.add('hidden');
        editingId = null;
    });

    saveEditBtn.addEventListener('click', async () => {
        const carrier = document.getElementById('edit-carrier').value;
        const status = document.getElementById('edit-status').value;

        try {
            const response = await secureFetch(`/api/parcels/${editingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ carrier, status })
            });

            if (response.ok) {
                showToast('Parcel updated successfully');
                editModal.classList.add('hidden');
                loadParcels();
            } else {
                const errorData = await response.json().catch(() => ({}));
                showToast(`Failed to update parcel: ${errorData.message || response.statusText}`, 'error');
            }
        } catch (error) {
            console.error('Error updating parcel:', error);
        }
    });

    async function deleteParcel(id) {
        if (!confirm('Are you sure you want to delete this record?')) return;

        try {
            const response = await secureFetch(`/api/parcels/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                loadParcels();
            } else {
                alert('Failed to delete parcel');
            }
        } catch (error) {
            console.error('Error deleting parcel:', error);
        }
    }

    function openPrintLabel(parcel) {
        const printWindow = window.open('', '_blank', 'width=600,height=400');
        printWindow.document.write(`
            <html>
            <head>
                <title>Print Label - ${parcel.trackingId}</title>
                <style>
                    body { font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .label-box { width: 4in; height: 6in; border: 2px solid black; padding: 20px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; }
                    .header { border-bottom: 2px solid black; padding-bottom: 10px; font-weight: bold; font-size: 24px; text-transform: uppercase; }
                    .barcode-zone { height: 100px; background: #eee; display: flex; align-items: center; justify-content: center; font-family: monospace; }
                    .tracking { font-size: 18px; font-weight: bold; margin-top: 20px; }
                    .footer { font-size: 12px; color: #666; }
                    @media print { .no-print { display: none; } }
                </style>
            </head>
            <body>
                <div class="label-box">
                    <div class="header">${parcel.carrier.replace('_', ' ')} Priority</div>
                    <div class="tracking">TRACKING: ${parcel.trackingId}</div>
                    <div class="barcode-zone">||||||||||||||||| BARCODE: ${parcel.barcode} |||||||||||||||||</div>
                    <div class="footer">Dispatched: ${new Date(parcel.timestamp).toLocaleString()}</div>
                    <button class="no-print" onclick="window.print()" style="margin-top:20px; padding:10px; background:#6366f1; color:white; border:none; border-radius:5px; cursor:pointer;">Print Label</button>
                </div>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    // Security Settings
    const securityBtn = document.getElementById('security-btn');
    const securityModal = document.getElementById('security-modal');
    const resetModal = document.getElementById('reset-modal');
    
    securityBtn.addEventListener('click', () => securityModal.classList.remove('hidden'));
    document.getElementById('close-security-btn').addEventListener('click', () => securityModal.classList.add('hidden'));
    document.getElementById('close-reset-btn').addEventListener('click', () => resetModal.classList.add('hidden'));

    document.getElementById('save-pin-btn').addEventListener('click', async () => {
        const newPin = document.getElementById('new-pin').value;
        if (newPin.length < 4) return alert('PIN must be at least 4 digits');

        try {
            const response = await secureFetch('/api/admin/change-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPin })
            });
            if (response.ok) {
                showToast('PIN updated successfully!');
                sessionStorage.setItem('adminPin', newPin);
                setTimeout(() => location.reload(), 1000);
            } else {
                const err = await response.json();
                showToast(err.message || 'Failed to update PIN', 'error');
            }
        } catch (e) { console.error(e); }
    });

    document.getElementById('confirm-reset-btn').addEventListener('click', async () => {
        const email = document.getElementById('reset-email').value;
        const password = document.getElementById('reset-password').value;
        const newPin = document.getElementById('reset-new-pin').value;

        try {
            const response = await fetch('/api/admin/reset-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, newPin })
            });
            if (response.ok) {
                showToast('PIN reset successful! You can now log in.');
                resetModal.classList.add('hidden');
            } else {
                const err = await response.json();
                showToast(err.message || 'Reset failed', 'error');
            }
        } catch (e) { console.error(e); }
    });

    // Theme Toggle
    const themeToggle = document.getElementById('theme-toggle');
    const currentTheme = localStorage.getItem('theme') || 'light';
    
    if (currentTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    themeToggle.addEventListener('click', () => {
        let theme = document.documentElement.getAttribute('data-theme');
        if (theme === 'dark') {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        }
    });

    loadParcels();
});
