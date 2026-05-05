// ===== STATE =====
let token = localStorage.getItem('px_token');
let user = JSON.parse(localStorage.getItem('px_user') || 'null');
let cropper = null;
let dl = {};
let files = {};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    if (token && user) showTools();
    else showHero();
});

// ===== AUTH =====
function showModal(id) { document.getElementById(id).classList.add('show'); }
function hideModal(id) { document.getElementById(id).classList.remove('show'); }

async function register() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-pass').value;
    if (!name||!email||!password) return alert('All fields required');
    if (password.length < 6) return alert('Password: 6+ characters');
    try {
        const r = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,email,password}) });
        const d = await r.json();
        if (d.success) { saveLogin(d); hideModal('register-modal'); showTools(); alert(d.message); }
        else alert(d.error);
    } catch(e) { alert('Network error: ' + e.message); }
}

async function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-pass').value;
    if (!email||!password) return alert('All fields required');
    try {
        const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password}) });
        const d = await r.json();
        if (d.success) { saveLogin(d); hideModal('login-modal'); showTools(); }
        else alert(d.error);
    } catch(e) { alert('Network error: ' + e.message); }
}

async function googleLogin() {
    const email = prompt('Google Email:');
    const name = prompt('Name:');
    if (!email||!name) return;
    try {
        const r = await fetch('/api/google-login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,name}) });
        const d = await r.json();
        if (d.success) { saveLogin(d); hideModal('login-modal'); hideModal('register-modal'); showTools(); }
        else alert(d.error);
    } catch(e) { alert('Network error: ' + e.message); }
}

function saveLogin(d) {
    token = d.token; user = d.user;
    localStorage.setItem('px_token', token);
    localStorage.setItem('px_user', JSON.stringify(user));
}

function logout() {
    token = null; user = null;
    localStorage.clear();
    fetch('/api/logout', { method:'POST' });
    location.reload();
}

function showHero() {
    document.getElementById('hero-section').style.display = 'block';
    document.getElementById('tools-section').style.display = 'none';
    document.getElementById('header-actions').style.display = 'flex';
    document.getElementById('header-user').style.display = 'none';
}

function showTools() {
    document.getElementById('hero-section').style.display = 'none';
    document.getElementById('tools-section').style.display = 'block';
    document.getElementById('header-actions').style.display = 'none';
    document.getElementById('header-user').style.display = 'flex';
    const plan = user?.plan?.toUpperCase() || 'FREE';
    document.getElementById('user-badge').textContent = plan;
    if (plan === 'PRO') {
        document.getElementById('user-badge').style.background = 'linear-gradient(45deg,#f093fb,#f5576c)';
    }
}

// ===== RAZORPAY PAYMENT =====
async function startPayment() {
    hideModal('pricing-modal');
    showModal('payment-modal');
    document.getElementById('payment-content').innerHTML = `
        <div style="text-align:center;padding:20px;">
            <div class="spin"></div>
            <p>Creating secure payment...</p>
        </div>
    `;
    
    if (!token) { alert('Please login first!'); return; }
    
    try {
        const r = await fetch('/api/payment/create-order', { 
            method:'POST', 
            headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'} 
        });
        const order = await r.json();
        
        if (!order.success) {
            document.getElementById('payment-content').innerHTML = `
                <p style="color:red;text-align:center;">❌ Error: ${order.error}</p>
                <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
            `;
            return;
        }
        
        // Show order info
        document.getElementById('payment-content').innerHTML = `
            <div style="text-align:center;">
                <p>Amount: <b>₹${order.amount / 100}</b></p>
                <p>Order ID: ${order.orderId}</p>
                <p style="color:#888;font-size:0.8em;">Opening Razorpay checkout...</p>
            </div>
        `;
        
        // Load Razorpay Checkout
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = () => {
            const options = {
                key: order.keyId,
                amount: order.amount,
                currency: order.currency,
                name: 'Pixeloid',
                description: 'PRO Upgrade - 1 Week',
                image: '',
                order_id: order.orderId,
                handler: async function (response) {
                    // Payment successful - verify on server
                    document.getElementById('payment-content').innerHTML = `
                        <div style="text-align:center;padding:20px;">
                            <div class="spin"></div>
                            <p>Verifying payment...</p>
                        </div>
                    `;
                    
                    try {
                        const verifyRes = await fetch('/api/payment/verify', {
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
                        const verifyData = await verifyRes.json();
                        
                        if (verifyData.success) {
                            saveLogin(verifyData);
                            document.getElementById('payment-content').innerHTML = `
                                <div style="text-align:center;color:#48bb78;">
                                    <p style="font-size:3em;">✅</p>
                                    <h3>Payment Successful!</h3>
                                    <p>PRO activated for 1 week</p>
                                    <button class="btn prim" onclick="location.reload()">Start Using PRO 🚀</button>
                                </div>
                            `;
                        } else {
                            document.getElementById('payment-content').innerHTML = `
                                <p style="color:red;">❌ Verification failed: ${verifyData.error}</p>
                                <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
                            `;
                        }
                    } catch (e) {
                        document.getElementById('payment-content').innerHTML = `
                            <p style="color:red;">❌ Verification error</p>
                            <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
                        `;
                    }
                },
                prefill: {
                    email: order.userEmail,
                    name: order.userName
                },
                theme: {
                    color: '#667eea'
                },
                modal: {
                    ondismiss: function() {
                        document.getElementById('payment-content').innerHTML = `
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
            document.getElementById('payment-content').innerHTML = `
                <p style="color:red;">❌ Failed to load payment gateway</p>
                <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
            `;
        };
        document.body.appendChild(script);
        
    } catch(e) {
        document.getElementById('payment-content').innerHTML = `
            <p style="color:red;">❌ Network error</p>
            <button class="btn outl" onclick="hideModal('payment-modal')">Close</button>
        `;
    }
}

// ===== TOOL SWITCH =====
function switchTool(name) {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('active'));
    const btn = document.querySelector(`[onclick="switchTool('${name}')"]`);
    if (btn) btn.classList.add('active');
    const panel = document.getElementById('tool-' + name);
    if (panel) panel.classList.add('active');
    if (cropper) { cropper.destroy(); cropper = null; }
}

// ===== HELPERS =====
function fmt(b) { if(!b||b===0) return '0 KB'; if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(2)+' MB'; }
function showLoader(s) { document.getElementById('loader').style.display = s?'block':'none'; }

async function apiPost(url, fd) {
    try {
        const r = await fetch(url, { method:'POST', headers:{'Authorization':'Bearer '+token}, body:fd });
        const d = await r.json();
        if (d.needAuth) { logout(); return null; }
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
    reader.onload = e => { document.getElementById('compress-img').src = e.target.result; };
    reader.readAsDataURL(file);
    document.getElementById('compress-upload').style.display = 'none';
    document.getElementById('compress-editor').style.display = 'block';
    document.getElementById('compress-info').textContent = file.name + ' (' + fmt(file.size) + ')';
    document.getElementById('compress-dl').style.display = 'none';
}
async function processCompress() {
    if (!files.compress) return;
    showLoader(true);
    const fd = new FormData(); fd.append('image', files.compress);
    fd.append('quality', document.getElementById('cq').value);
    fd.append('format', document.getElementById('cformat').value);
    fd.append('maxWidth', document.getElementById('cw').value);
    fd.append('maxHeight', document.getElementById('ch').value);
    const d = await apiPost('/api/compress', fd);
    if (d?.success) {
        dl.compress = d.downloadUrl;
        document.getElementById('corig').textContent = fmt(d.originalSize);
        document.getElementById('ccomp').textContent = fmt(d.compressedSize);
        document.getElementById('csaved').textContent = '-' + d.savedPercent + '%';
        document.getElementById('compress-dl').style.display = 'block';
    }
    showLoader(false);
}
function downloadCompress() { if (dl.compress) location.href = dl.compress; }

// ===== CROP =====
function handleCrop(file) {
    if (!file?.type?.startsWith('image/')) return;
    if (cropper) { cropper.destroy(); cropper = null; }
    const reader = new FileReader();
    reader.onload = e => {
        const img = document.getElementById('crop-img'); img.src = e.target.result;
        document.getElementById('crop-upload').style.display = 'none';
        document.getElementById('crop-editor').style.display = 'block';
        document.getElementById('crop-dl').style.display = 'none';
        img.onload = () => { cropper = new Cropper(img, { aspectRatio: NaN, viewMode: 2, autoCropArea: 0.9, responsive: true }); };
    };
    reader.readAsDataURL(file);
}
async function doCrop() {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas(); if (!canvas) return;
    canvas.toBlob(async blob => {
        const fd = new FormData(); fd.append('image', blob, 'crop.jpg');
        const cd = cropper.getData();
        fd.append('x', cd.x); fd.append('y', cd.y); fd.append('width', cd.width); fd.append('height', cd.height);
        showLoader(true);
        const d = await apiPost('/api/crop', fd);
        if (d?.success) { dl.crop = d.downloadUrl; document.getElementById('crop-dl').style.display = 'block'; }
        showLoader(false);
    }, 'image/jpeg', 0.95);
}
function resetCrop() { if (cropper) cropper.reset(); }
function downloadCrop() { if (dl.crop) location.href = dl.crop; }

// ===== BG REMOVER =====
function handleBG(file) {
    if (!file?.type?.startsWith('image/')) return;
    files.bg = file;
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('bg-img').src = e.target.result; };
    reader.readAsDataURL(file);
    document.getElementById('bg-upload').style.display = 'none';
    document.getElementById('bg-editor').style.display = 'block';
    document.getElementById('bg-dl').style.display = 'none';
    document.getElementById('bg-info').textContent = file.name;
}
async function removeBG() {
    if (!files.bg) return;
    showLoader(true);
    const fd = new FormData(); fd.append('image', files.bg);
    const d = await apiPost('/api/remove-bg', fd);
    if (d?.success) { dl.bg = d.downloadUrl; document.getElementById('bg-dl').style.display = 'block'; alert(d.message); }
    showLoader(false);
}
function downloadBG() { if (dl.bg) location.href = dl.bg; }

// ===== WM REMOVER =====
function handleWM(file) {
    if (!file?.type?.startsWith('image/')) return;
    files.wm = file;
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('wm-img').src = e.target.result; };
    reader.readAsDataURL(file);
    document.getElementById('wm-upload').style.display = 'none';
    document.getElementById('wm-editor').style.display = 'block';
    document.getElementById('wm-dl').style.display = 'none';
    document.getElementById('wm-info').textContent = file.name;
}
async function removeWM() {
    if (!files.wm) return;
    showLoader(true);
    const fd = new FormData(); fd.append('image', files.wm);
    const d = await apiPost('/api/remove-watermark', fd);
    if (d?.success) { dl.wm = d.downloadUrl; document.getElementById('wm-dl').style.display = 'block'; alert(d.message); }
    showLoader(false);
}
function downloadWM() { if (dl.wm) location.href = dl.wm; }

// ===== SOCIAL =====
function handleSocial(file) {
    if (!file?.type?.startsWith('image/')) return;
    files.social = file;
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('social-img').src = e.target.result; };
    reader.readAsDataURL(file);
    document.getElementById('social-upload').style.display = 'none';
    document.getElementById('social-editor').style.display = 'block';
    document.getElementById('social-dl').style.display = 'none';
}
function setSocial() {
    const v = document.getElementById('soc-tpl').value;
    if (v) { const [w, h] = v.split(','); document.getElementById('sw').value = w; document.getElementById('sh').value = h; }
    else { document.getElementById('sw').value = ''; document.getElementById('sh').value = ''; }
}
async function processSocial() {
    if (!files.social) return;
    showLoader(true);
    const fd = new FormData(); fd.append('image', files.social);
    fd.append('maxWidth', document.getElementById('sw').value);
    fd.append('maxHeight', document.getElementById('sh').value);
    const d = await apiPost('/api/compress', fd);
    if (d?.success) { dl.social = d.downloadUrl; document.getElementById('social-dl').style.display = 'block'; }
    showLoader(false);
}
function downloadSocial() { if (dl.social) location.href = dl.social; }