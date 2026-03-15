document.addEventListener('DOMContentLoaded', () => {
    const reader = new Html5QrcodeScanner("reader", { 
        fps: 10, 
        qrbox: { width: 250, height: 150 } 
    });

    const resultContainer = document.getElementById('result-container');
    const scannedBarcode = document.getElementById('scanned-barcode');
    const dispatchBtn = document.getElementById('dispatch-btn');
    const rescanBtn = document.getElementById('rescan-btn');
    const carrierSelect = document.getElementById('carrier');
    const statusMessage = document.getElementById('status-message');
    const batchMode = document.getElementById('batch-mode');

    // --- Staff Login ---
    let staffPin = sessionStorage.getItem('staffPin');
    let staffEmail = sessionStorage.getItem('staffEmail');

    const staffAuthModal = document.getElementById('staff-auth-modal');
    const staffPinInput = document.getElementById('staff-pin-input');
    const staffNameBadge = document.getElementById('staff-name-badge');

    function updateStaffUI() {
        if (staffPin && staffEmail) {
            document.getElementById('staff-logged-out').classList.add('hidden');
            document.getElementById('staff-logged-in').classList.remove('hidden');
            staffNameBadge.textContent = `👤 ${staffEmail}`;
        } else {
            document.getElementById('staff-logged-out').classList.remove('hidden');
            document.getElementById('staff-logged-in').classList.add('hidden');
        }
    }

    document.getElementById('staff-login-btn').addEventListener('click', () => {
        staffPinInput.value = '';
        staffPinInput.classList.remove('input-error');
        staffAuthModal.classList.remove('hidden');
        setTimeout(() => staffPinInput.focus(), 100);
    });

    document.getElementById('staff-pin-cancel').addEventListener('click', () => {
        staffAuthModal.classList.add('hidden');
    });

    async function submitStaffPin() {
        const pin = staffPinInput.value;
        if (!pin || pin.length < 4) return;

        try {
            const response = await fetch('/api/verify-pin', {
                headers: { 'x-admin-pin': pin }
            });

            if (response.ok) {
                const data = await response.json();
                staffPin = pin;
                staffEmail = data.admin;
                sessionStorage.setItem('staffPin', staffPin);
                sessionStorage.setItem('staffEmail', staffEmail);
                staffAuthModal.classList.add('hidden');
                updateStaffUI();
                showToast(`Welcome, ${staffEmail}!`, 'success');
            } else {
                const modalContent = staffAuthModal.querySelector('.modal-content');
                modalContent.classList.add('shake');
                staffPinInput.classList.add('input-error');
                setTimeout(() => { modalContent.classList.remove('shake'); }, 500);
                staffPinInput.value = '';
                staffPinInput.focus();
                showToast('Invalid PIN. Please try again.', 'error');
            }
        } catch (e) {
            showToast('Network error. Check connection.', 'error');
        }
    }

    document.getElementById('staff-pin-submit').addEventListener('click', submitStaffPin);
    staffPinInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') submitStaffPin(); });

    document.getElementById('staff-logout-btn').addEventListener('click', () => {
        staffPin = null;
        staffEmail = null;
        sessionStorage.removeItem('staffPin');
        sessionStorage.removeItem('staffEmail');
        updateStaffUI();
        showToast('Logged out successfully.', 'success');
    });

    updateStaffUI();

    // Synth Audio Utility
    function playSound(type) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = 'sine';
            if (type === 'success') {
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
            } else {
                osc.frequency.setValueAtTime(150, ctx.currentTime);
                osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 0.2);
            }

            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
        } catch (e) { console.warn('Audio not supported', e); }
    }

    // --- IndexedDB for Offline Queue ---
    const DB_NAME = 'ParcelTrackerOffline';
    const STORE_NAME = 'scanQueue';
    let db;

    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
        db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
    };
    request.onsuccess = (e) => { db = e.target.result; syncQueue(); };
    request.onerror = (e) => console.error('IndexedDB error:', e);

    async function addToQueue(parcel) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.add(parcel);
            request.onsuccess = () => resolve();
            request.onerror = () => reject();
        });
    }

    async function getQueue() {
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
        });
    }

    async function removeFromQueue(id) {
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
        });
    }

    async function syncQueue() {
        if (!navigator.onLine || isProcessing) return;
        const queue = await getQueue();
        if (queue.length === 0) {
            document.getElementById('sync-badge').classList.add('hidden');
            return;
        }

        document.getElementById('sync-badge').classList.remove('hidden');
        document.getElementById('sync-count').textContent = queue.length;

        for (const item of queue) {
            try {
                const response = await fetch('/api/dispatch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ barcode: item.barcode, carrier: item.carrier })
                });
                if (response.ok || response.status === 409) {
                    await removeFromQueue(item.id);
                }
            } catch (e) { break; } // Stop if network fails again
        }
        
        const remaining = await getQueue();
        if (remaining.length === 0) {
            document.getElementById('sync-badge').classList.add('hidden');
            showToast('All offline scans synced successfully!', 'success');
        } else {
            document.getElementById('sync-count').textContent = remaining.length;
        }
    }

    window.addEventListener('online', syncQueue);

    let lastScannedBarcode = null;
    let lastScanTime = 0;
    let isProcessing = false;

    function onScanSuccess(decodedText, decodedResult) {
        if (isProcessing) return;
        
        // Prevent duplicate scans within 3 seconds for the same barcode
        const now = Date.now();
        if (decodedText === lastScannedBarcode && (now - lastScanTime) < 3000) {
            return;
        }

        lastScannedBarcode = decodedText;
        lastScanTime = now;

        // Feedback
        playSound('success');
        if ('vibrate' in navigator) navigator.vibrate(50);

        if (batchMode.checked) {
            console.log(`Auto-dispatching barcode: ${decodedText}`);
            scannedBarcode.textContent = decodedText;
            dispatchParcel(decodedText, carrierSelect.value, true);
        } else {
            isProcessing = true;
            reader.clear();
            scannedBarcode.textContent = decodedText;
            resultContainer.classList.remove('hidden');
            document.getElementById('reader').classList.add('hidden');
        }
    }

    function onScanFailure(error) {
        // Minor failures are common (e.g. no QR code in frame), just ignore them
    }

    reader.render(onScanSuccess, onScanFailure);

    rescanBtn.addEventListener('click', () => {
        resultContainer.classList.add('hidden');
        document.getElementById('reader').classList.remove('hidden');
        reader.render(onScanSuccess, onScanFailure);
    });

    dispatchBtn.addEventListener('click', () => {
        dispatchParcel(scannedBarcode.textContent, carrierSelect.value, false);
    });

    async function dispatchParcel(barcode, carrier, isBatch) {
        if (!isBatch) showStatus('Processing dispatch...', 'info');
        isProcessing = true;

        try {
            const response = await fetch('/api/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ barcode, carrier })
            });

            const data = await response.json();

            if (response.ok) {
                showStatus(`Successfully dispatched! ${data.trackingId}`, 'success');
                finishDispatch(isBatch);
            } else if (response.status === 409) {
                showStatus(data.message, 'error');
                playSound('error');
                finishDispatch(isBatch);
            } else {
                throw new Error('Server error');
            }
        } catch (error) {
            // Save to offline queue
            await addToQueue({ barcode, carrier, timestamp: new Date().toISOString() });
            showStatus('Offline: Scan saved to local queue', 'info');
            syncQueue(); // Try to show badge
            finishDispatch(isBatch);
        }
    }

    function finishDispatch(isBatch) {
        if (!isBatch) {
            setTimeout(() => {
                resultContainer.classList.add('hidden');
                document.getElementById('reader').classList.remove('hidden');
                reader.render(onScanSuccess, onScanFailure);
                hideStatus();
                isProcessing = false;
            }, 2000);
        } else {
            setTimeout(() => {
                hideStatus();
                isProcessing = false;
            }, 1500);
        }
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

    function showStatus(text, type) {
        statusMessage.textContent = text;
        statusMessage.className = `status-message ${type} pulsing`;
        statusMessage.classList.remove('hidden');
        if (type === 'success' || type === 'error') {
            showToast(text, type);
        }
    }

    function hideStatus() {
        statusMessage.classList.add('hidden');
        statusMessage.classList.remove('pulsing');
    }

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

    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(reg => console.log('Service Worker registered'))
                .catch(err => console.log('Service Worker registration failed', err));
        });
    }
});
