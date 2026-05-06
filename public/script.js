// ============================================
// PIXELOID - COMPLETE SCRIPT (FINAL)
// ============================================

// ===== STATE =====
let token = localStorage.getItem('px_token');
let user = JSON.parse(localStorage.getItem('px_user') || 'null');
let cropper = null;
let dl = {};
let files = {};

// ===== INIT =====
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token');
if (urlToken) {
    token = urlToken;
    localStorage.setItem('px_token', token);
    window.history.replaceState({}, document.title, '/');
}

document.addEventListener('DOMContentLoaded', async () => {
    if (token) {
        await fetchProfile();
        showTools();
    } else {
        showHero();
    }
});

// ==================== AUTH ====================
function showModal(id) { 
    const m = document.getElementById(id);
    if (m) m.classList.add('show'); 
}

function hideModal(id) { 
    const m = document.getElementById(id);
    if (m) m.classList.remove('show'); 
}

async function fetchProfile() {
    try {
        const r = await fetch('/api/profile', { 
            headers: { 'Authorization': 'Bearer ' + token } 
        });
        const d = await r.json();
        if (d.success && d.user) {
            user = d.user;
            localStorage.setItem('px_user', JSON.stringify(user));
            updateUI();
        } else if (d.needAuth) {
            logout();
        }
    } catch(e) {
        console.error('Profile fetch error:', e);
    }
}

async function register() {
    const name = document.getElementById('reg-name')?.value.trim();
    const email = document.getElementById('reg-email')?.value.trim();
    const password = document.getElementById('reg-pass')?.value;
    
    if (!name || !email || !password) return alert('All fields required!');
    if (password.length < 6) return alert('Password must be 6+ characters!');
    
    try {
        const r = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const d = await r.json();
        
        if (d.success) {
            saveLogin(d);
            hideModal('register-modal');
            showTools();
            alert(d.message || 'Account created!');
        } else {
            alert('Error: ' + d.error);
        }
    } catch(e) {
        alert('Network error. Please try again.');
    }
}

async function login() {
    const email = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-pass')?.value;
    
    if (!email || !password) return alert('Email and password required!');
    
    try {
        const r = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const d = await r.json();
        
        if (d.success) {
            saveLogin(d);
            hideModal('login-modal');
            showTools();
        } else {
            alert('Error: ' + d.error);
        }
    } catch(e) {
        alert('Network error. Please try again.');
    }
}

function googleLogin() {
    window.location.href = '/auth/google';
}

function saveLogin(d) {
    token = d.token;
    user = d.user;
    localStorage.setItem('px_token', token);
    localStorage.setItem('px_user', JSON.stringify(user));
    updateUI();
}

function logout() {
    token = null;
    user = null;
    localStorage.clear();
    fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.reload();
}

function showHero() {
    const hero = document.getElementById('hero-section');
    const tools = document.getElementById('tools-section');
    const actions = document.getElementById('header-actions');
    const userHeader = document.getElementById('header-user');
    
    if (hero) hero.style.display = 'block';
    if (tools) tools.style.display = 'none';
    if (actions) actions.style.display = 'flex';
    if (userHeader) userHeader.style.display = 'none';
}

function showTools() {
    const hero = document.getElementById('hero-section');
    const tools = document.getElementById('tools-section');
    const actions = document.getElementById('header-actions');
    const userHeader = document.getElementById('header-user');
    
    if (hero) hero.style.display = 'none';
    if (tools) tools.style.display = 'block';
    if (actions) actions.style.display = 'none';
    if (userHeader) userHeader.style.display = 'flex';
    
    updateUI();
}

function updateUI() {
    if (!user) return;
    
    const badge = document.getElementById('user-badge');
    const dailyLimit = document.getElementById('daily-limit');
    const dailyCount = document.getElementById('daily-count');
    
    if (badge) {
        badge.textContent = user.plan?.toUpperCase() || 'FREE';
        badge.style.background = user.plan === 'pro' 
            ? 'linear-gradient(45deg,#f093fb,#f5576c)' 
            : 'rgba(255,255,255,0.15)';
    }
    
    // Show daily limit for free users
    if (user.plan === 'free' && user.trialDaysLeft <= 0) {
        if (dailyLimit) dailyLimit.style.display = 'block';
        if (dailyCount) dailyCount.textContent = `${user.dailyCount || 0}/${user.dailyLimit || 5}`;
    }
    
    // Show/hide PRO badges on tools
    const isPro = user.plan === 'pro' || (user.trialDaysLeft > 0);
    document.querySelectorAll('.pro-badge-tool').forEach(el => {
        el.style.display = isPro ? 'none' : 'inline-block';
    });
}

// ==================== PAYMENT ====================
async function startPayment() {
    hideModal('pricing-modal');
    showModal('payment-modal');
    
    const content = document.getElementById('payment-content');
    if (content) content.innerHTML = `
        <div style="text-align:center;padding:20px;">
            <div class="spin"></div>
            <p>Creating secure order...</p>
        </div>
    `;
    
    if (!token) {
        alert('Please login first!');
        hideModal('payment-modal');
        return;
    }
    
    try {
        const r = await fetch('/api/payment/create-order', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
        const order = await r.json();
        
        if (!order.success) {
            if (content) content.innerHTML = `
                <p style="color:red;text-align:center;">❌ ${order.error}</p>
                <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
            `;
            return;
        }
        
        if (content) content.innerHTML = `
            <div style="text-align:center;">
                <p>Amount: <b>₹${order.amount / 100}</b></p>
                <p style="color:#888;">Opening Razorpay...</p>
            </div>
        `;
        
        // Load Razorpay
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = () => {
            const options = {
                key: order.keyId,
                amount: order.amount,
                currency: order.currency,
                name: 'Pixeloid',
                description: 'PRO Upgrade - 1 Week',
                order_id: order.orderId,
                handler: async function(response) {
                    if (content) content.innerHTML = `
                        <div style="text-align:center;padding:20px;">
                            <div class="spin"></div>
                            <p>Verifying payment...</p>
                        </div>
                    `;
                    
                    try {
                        const vRes = await fetch('/api/payment/verify', {
                            method: 'POST',
                            headers: {
                                'Authorization': 'Bearer ' + token,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature
                            })
                        });
                        const vData = await vRes.json();
                        
                        if (vData.success) {
                            saveLogin(vData);
                            if (content) content.innerHTML = `
                                <div style="text-align:center;color:#48bb78;">
                                    <p style="font-size:3em;">✅</p>
                                    <h3>PRO Activated!</h3>
                                    <p>Enjoy 1 week of unlimited access!</p>
                                    <button class="btn prim" onclick="location.reload()">Start Using PRO 🚀</button>
                                </div>
                            `;
                        } else {
                            if (content) content.innerHTML = `
                                <p style="color:red;">❌ ${vData.error || 'Verification failed'}</p>
                                <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
                            `;
                        }
                    } catch(e) {
                        if (content) content.innerHTML = `
                            <p style="color:red;">❌ Verification error</p>
                            <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
                        `;
                    }
                },
                prefill: { email: order.userEmail, name: order.userName },
                theme: { color: '#667eea' },
                modal: {
                    ondismiss: () => {
                        if (content) content.innerHTML = `
                            <p style="text-align:center;">Payment cancelled</p>
                            <button class="btn prim" onclick="startPayment()">Try Again</button>
                            <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
                        `;
                    }
                }
            };
            
            const rzp = new Razorpay(options);
            rzp.open();
        };
        script.onerror = () => {
            if (content) content.innerHTML = `
                <p style="color:red;">❌ Failed to load payment gateway</p>
                <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
            `;
        };
        document.body.appendChild(script);
        
    } catch(e) {
        if (content) content.innerHTML = `
            <p style="color:red;">❌ Network error</p>
            <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
        `;
    }
}

// ==================== TOOLS ====================
function switchTool(name) {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('active'));
    
    const btn = document.querySelector(`[onclick="switchTool('${name}')"]`);
    if (btn) btn.classList.add('active');
    
    const panel = document.getElementById('tool-' + name);
    if (panel) panel.classList.add('active');
    
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
}

// ===== HELPERS =====
function fmt(b) {
    if (!b || b === 0) return '0 KB';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
}

function showLoader(s) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = s ? 'block' : 'none';
}

async function apiPost(url, fd) {
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: fd
        });
        const d = await r.json();
        
        if (d.needAuth) {
            logout();
            return null;
        }
        if (d.upgradeNeeded) {
            alert(d.error);
            showModal('pricing-modal');
            return null;
        }
        if (!d.success) {
            alert(d.error || 'Something went wrong');
            return null;
        }
        return d;
    } catch(e) {
        alert('Network error: ' + e.message);
        return null;
    }
}

// ===== COMPRESS =====
function handleCompress(file) {
    if (!file?.type?.startsWith('image/')) return;
    files.compress = file;
    
    const reader = new FileReader();
    reader.onload = e => {
        const img = document.getElementById('compress-img');
        if (img) img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    
    const upload = document.getElementById('compress-upload');
    const editor = document.getElementById('compress-editor');
    const info = document.getElementById('compress-info');
    const dlBtn = document.getElementById('compress-dl');
    
    if (upload) upload.style.display = 'none';
    if (editor) editor.style.display = 'block';
    if (info) info.textContent = file.name + ' (' + fmt(file.size) + ')';
    if (dlBtn) dlBtn.style.display = 'none';
}

async function processCompress() {
    if (!files.compress) return;
    showLoader(true);
    
    const fd = new FormData();
    fd.append('image', files.compress);
    fd.append('quality', document.getElementById('cq')?.value || '80');
    fd.append('format', document.getElementById('cformat')?.value || 'jpeg');
    fd.append('maxWidth', document.getElementById('cw')?.value || '');
    fd.append('maxHeight', document.getElementById('ch')?.value || '');
    
    const d = await apiPost('/api/compress', fd);
    
    if (d) {
        dl.compress = d.downloadUrl;
        const corig = document.getElementById('corig');
        const ccomp = document.getElementById('ccomp');
        const csaved = document.getElementById('csaved');
        const dlBtn = document.getElementById('compress-dl');
        
        if (corig) corig.textContent = fmt(d.originalSize);
        if (ccomp) ccomp.textContent = fmt(d.compressedSize);
        if (csaved) csaved.textContent = '-' + d.savedPercent + '%';
        if (dlBtn) dlBtn.style.display = 'block';
        
        await fetchProfile();
    }
    showLoader(false);
}

function downloadCompress() {
    if (dl.compress) location.href = dl.compress;
}

// ===== CROP =====
function handleCrop(file) {
    if (!file?.type?.startsWith('image/')) return;
    if (cropper) { cropper.destroy(); cropper = null; }
    
    const reader = new FileReader();
    reader.onload = e => {
        const img = document.getElementById('crop-img');
        if (!img) return;
        
        img.src = e.target.result;
        
        const upload = document.getElementById('crop-upload');
        const editor = document.getElementById('crop-editor');
        const dlBtn = document.getElementById('crop-dl');
        
        if (upload) upload.style.display = 'none';
        if (editor) editor.style.display = 'block';
        if (dlBtn) dlBtn.style.display = 'none';
        
        img.onload = () => {
            cropper = new Cropper(img, {
                aspectRatio: NaN,
                viewMode: 2,
                autoCropArea: 0.9,
                responsive: true
            });
        };
    };
    reader.readAsDataURL(file);
}

async function doCrop() {
    if (!cropper) return;
    
    const canvas = cropper.getCroppedCanvas();
    if (!canvas) return;
    
    canvas.toBlob(async (blob) => {
        const fd = new FormData();
        fd.append('image', blob, 'crop.jpg');
        
        const cropData = cropper.getData();
        fd.append('x', cropData.x);
        fd.append('y', cropData.y);
        fd.append('width', cropData.width);
        fd.append('height', cropData.height);
        
        showLoader(true);
        const d = await apiPost('/api/crop', fd);
        
        if (d) {
            dl.crop = d.downloadUrl;
            const dlBtn = document.getElementById('crop-dl');
            if (dlBtn) dlBtn.style.display = 'block';
        }
        showLoader(false);
    }, 'image/jpeg', 0.95);
}

function resetCrop() {
    if (cropper) cropper.reset();
}

function downloadCrop() {
    if (dl.crop) location.href = dl.crop;
}

// ===== BACKGROUND REMOVER =====
function handleBG(file) {
    if (!file?.type?.startsWith('image/')) return;
    files.bg = file;
    
    const reader = new FileReader();
    reader.onload = e => {
        const img = document.getElementById('bg-img');
        if (img) img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    
    const upload = document.getElementById('bg-upload');
    const editor = document.getElementById('bg-editor');
    const info = document.getElementById('bg-info');
    const dlBtn = document.getElementById('bg-dl');
    
    if (upload) upload.style.display = 'none';
    if (editor) editor.style.display = 'block';
    if (info) info.textContent = file.name;
    if (dlBtn) dlBtn.style.display = 'none';
}

async function removeBG() {
    if (!files.bg) return;
    showLoader(true);
    
    const fd = new FormData();
    fd.append('image', files.bg);
    
    const d = await apiPost('/api/remove-bg', fd);
    
    if (d) {
        dl.bg = d.downloadUrl;
        const dlBtn = document.getElementById('bg-dl');
        if (dlBtn) dlBtn.style.display = 'block';
        alert(d.message || 'Background removed!');
    }
    showLoader(false);
}

function downloadBG() {
    if (dl.bg) location.href = dl.bg;
}

// ===== WATERMARK REMOVER =====
function handleWM(file) {
    if (!file?.type?.startsWith('image/')) return;
    files.wm = file;
    
    const reader = new FileReader();
    reader.onload = e => {
        const img = document.getElementById('wm-img');
        if (img) img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    
    const upload = document.getElementById('wm-upload');
    const editor = document.getElementById('wm-editor');
    const info = document.getElementById('wm-info');
    const dlBtn = document.getElementById('wm-dl');
    
    if (upload) upload.style.display = 'none';
    if (editor) editor.style.display = 'block';
    if (info) info.textContent = file.name;
    if (dlBtn) dlBtn.style.display = 'none';
}

async function removeWM() {
    if (!files.wm) return;
    showLoader(true);
    
    const fd = new FormData();
    fd.append('image', files.wm);
    
    const d = await apiPost('/api/remove-watermark', fd);
    
    if (d) {
        dl.wm = d.downloadUrl;
        const dlBtn = document.getElementById('wm-dl');
        if (dlBtn) dlBtn.style.display = 'block';
        alert(d.message || 'Watermark removed!');
    }
    showLoader(false);
}

function downloadWM() {
    if (dl.wm) location.href = dl.wm;
}

// ===== SOCIAL =====
function handleSocial(file) {
    if (!file?.type?.startsWith('image/')) return;
    files.social = file;
    
    const reader = new FileReader();
    reader.onload = e => {
        const img = document.getElementById('social-img');
        if (img) img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    
    const upload = document.getElementById('social-upload');
    const editor = document.getElementById('social-editor');
    const dlBtn = document.getElementById('social-dl');
    
    if (upload) upload.style.display = 'none';
    if (editor) editor.style.display = 'block';
    if (dlBtn) dlBtn.style.display = 'none';
}

function setSocial() {
    const tpl = document.getElementById('soc-tpl');
    const sw = document.getElementById('sw');
    const sh = document.getElementById('sh');
    
    if (!tpl) return;
    const v = tpl.value;
    
    if (v) {
        const [w, h] = v.split(',');
        if (sw) sw.value = w;
        if (sh) sh.value = h;
    } else {
        if (sw) sw.value = '';
        if (sh) sh.value = '';
    }
}

async function processSocial() {
    if (!files.social) return;
    showLoader(true);
    
    const fd = new FormData();
    fd.append('image', files.social);
    fd.append('maxWidth', document.getElementById('sw')?.value || '');
    fd.append('maxHeight', document.getElementById('sh')?.value || '');
    
    const d = await apiPost('/api/compress', fd);
    
    if (d) {
        dl.social = d.downloadUrl;
        const dlBtn = document.getElementById('social-dl');
        if (dlBtn) dlBtn.style.display = 'block';
    }
    showLoader(false);
}

function downloadSocial() {
    if (dl.social) location.href = dl.social;
}