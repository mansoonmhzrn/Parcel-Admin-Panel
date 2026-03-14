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
                if (!isBatch) {
                    setTimeout(() => {
                        resultContainer.classList.add('hidden');
                        document.getElementById('reader').classList.remove('hidden');
                        reader.render(onScanSuccess, onScanFailure);
                        hideStatus();
                        isProcessing = false;
                    }, 2000);
                } else {
                    // In batch mode, keep scanning but wait a bit
                    setTimeout(() => {
                        hideStatus();
                        isProcessing = false;
                    }, 1500);
                }
            } else {
                showStatus(`Error: ${data.message}`, 'error');
                playSound('error');
                isProcessing = false;
            }
        } catch (error) {
            showStatus('Network error. Is the server running?', 'error');
            playSound('error');
            isProcessing = false;
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
