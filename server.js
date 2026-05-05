const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const Razorpay = require('razorpay');

const app = express();
const JWT_SECRET = 'pixeloid-pro-secret-2024';
const USERS_FILE = path.join(__dirname, 'users.json');
const TRIAL_DAYS = 3;
const PRO_PRICE_WEEKLY = 9;

// ==================== RAZORPAY CONFIG ====================
// Test mode keys - production mein change karna
const RAZORPAY_KEY_ID = 'rzp_test_SlnkbCbvIN1J62';     // ← Yahan apni Key ID dalo
const RAZORPAY_KEY_SECRET = '5x5xnoj6kaS394L1lI7q6xnc';      // ← Yahan apna Key Secret dalo
const RAZORPAY_WEBHOOK_SECRET = 'webhook_secret_123'; // ← Razorpay dashboard mein set karna

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

// ==================== DATABASE ====================
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}

function readUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        return parsed.users ? parsed : { users: [] };
    } catch (e) { return { users: [] }; }
}

function writeUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }

function findUser(email) {
    const db = readUsers();
    return db.users.find(u => u.email?.toLowerCase() === email?.toLowerCase());
}

function addUser(user) {
    const db = readUsers();
    db.users.push(user);
    writeUsers(db);
    return true;
}

function updateUser(email, updates) {
    const db = readUsers();
    const idx = db.users.findIndex(u => u.email?.toLowerCase() === email?.toLowerCase());
    if (idx !== -1) {
        db.users[idx] = { ...db.users[idx], ...updates };
        writeUsers(db);
        return db.users[idx];
    }
    return null;
}

function isTrialValid(user) {
    if (!user?.trialStart) return false;
    const end = new Date(user.trialStart);
    end.setDate(end.getDate() + TRIAL_DAYS);
    return new Date() < end;
}

function isProValid(user) {
    if (!user?.proUntil) return false;
    return new Date(user.proUntil) > new Date();
}

// ==================== MIDDLEWARE ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'pixeloid-session-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

['uploads', 'compressed'].forEach(dir => {
    const p = path.join(__dirname, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ==================== AUTH MIDDLEWARE ====================
function requireAuth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1] || req.session.token;
    if (!token) return res.status(401).json({ success: false, error: 'Please login first', needAuth: true });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ success: false, error: 'Session expired', needAuth: true });
    }
}

// ==================== AUTH ROUTES ====================

app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.json({ success: false, error: 'All fields required' });
        if (password.length < 6) return res.json({ success: false, error: 'Password: 6+ characters' });
        if (findUser(email)) return res.json({ success: false, error: 'Email already registered. Login?' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = {
            name, email: email.toLowerCase(), password: hashedPassword,
            plan: 'free', trialStart: new Date().toISOString(),
            totalCompressed: 0, totalSaved: 0, registeredAt: new Date().toISOString()
        };
        addUser(user);

        const token = jwt.sign({ email: user.email, name: user.name, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
        req.session.token = token;

        res.json({
            success: true, token,
            user: { name, email: user.email, plan: 'free', trialDaysLeft: TRIAL_DAYS },
            message: `Welcome! ${TRIAL_DAYS} days free trial. All features unlocked!`
        });
    } catch (e) {
        console.error('Register error:', e);
        res.json({ success: false, error: 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = findUser(email);
        if (!user) return res.json({ success: false, error: 'Email not found' });
        if (!user.password) return res.json({ success: false, error: 'Use Google login' });
        
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.json({ success: false, error: 'Wrong password' });

        const token = jwt.sign({ email: user.email, name: user.name, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
        req.session.token = token;

        const trialLeft = isTrialValid(user) ? Math.ceil((new Date(new Date(user.trialStart).getTime() + TRIAL_DAYS*86400000) - new Date()) / 86400000) : 0;
        const proLeft = isProValid(user) ? Math.ceil((new Date(user.proUntil) - new Date()) / 86400000) : 0;

        res.json({
            success: true, token,
            user: { name: user.name, email: user.email, plan: user.plan, trialDaysLeft: trialLeft, proDaysLeft: proLeft }
        });
    } catch (e) {
        console.error('Login error:', e);
        res.json({ success: false, error: 'Login failed' });
    }
});

app.post('/api/google-login', async (req, res) => {
    try {
        const { email, name } = req.body;
        if (!email || !name) return res.json({ success: false, error: 'Email and name required' });
        
        let user = findUser(email);
        if (!user) {
            user = { name, email: email.toLowerCase(), password: '', plan: 'free', trialStart: new Date().toISOString(), totalCompressed: 0, totalSaved: 0, registeredAt: new Date().toISOString() };
            addUser(user);
        }
        const token = jwt.sign({ email: user.email, name: user.name, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
        req.session.token = token;
        res.json({ success: true, token, user: { name: user.name, email: user.email, plan: user.plan, trialDaysLeft: TRIAL_DAYS } });
    } catch (e) {
        console.error('Google login error:', e);
        res.json({ success: false, error: 'Google login failed' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/profile', requireAuth, (req, res) => {
    const user = findUser(req.user.email);
    if (!user) return res.json({ success: false, error: 'User not found' });
    const trialLeft = isTrialValid(user) ? Math.ceil((new Date(new Date(user.trialStart).getTime() + TRIAL_DAYS*86400000) - new Date()) / 86400000) : 0;
    const proLeft = isProValid(user) ? Math.ceil((new Date(user.proUntil) - new Date()) / 86400000) : 0;
    res.json({
        success: true,
        user: { name: user.name, email: user.email, plan: user.plan, trialDaysLeft: trialLeft, proDaysLeft: proLeft, totalCompressed: user.totalCompressed || 0, totalSaved: user.totalSaved || 0 }
    });
});

// ==================== RAZORPAY PAYMENT ROUTES ====================

// Create Razorpay Order
app.post('/api/payment/create-order', requireAuth, async (req, res) => {
    try {
        const amountInPaise = PRO_PRICE_WEEKLY * 100; // ₹9 = 900 paise

        const order = await razorpay.orders.create({
            amount: amountInPaise,
            currency: 'INR',
            receipt: `rcpt_${Date.now()}`,
            notes: {
                email: req.user.email,
                name: req.user.name
            }
        });

        console.log('Razorpay order created:', order.id);

        res.json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: RAZORPAY_KEY_ID,
            userEmail: req.user.email,
            userName: req.user.name
        });
    } catch (error) {
        console.error('Razorpay order error:', error);
        res.status(500).json({ success: false, error: 'Failed to create payment order. Please try again.' });
    }
});

// Verify Payment (called after successful Razorpay checkout)
app.post('/api/payment/verify', requireAuth, (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        // Verify signature
        const sign = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(sign)
            .digest('hex');

        if (razorpay_signature !== expectedSign) {
            console.error('Signature verification failed');
            return res.json({ success: false, error: 'Payment verification failed. Invalid signature.' });
        }

        // Payment verified - Upgrade user to PRO
        const proUntil = new Date();
        proUntil.setDate(proUntil.getDate() + 7);

        updateUser(req.user.email, {
            plan: 'pro',
            proUntil: proUntil.toISOString(),
            lastPayment: new Date().toISOString(),
            lastPaymentAmount: PRO_PRICE_WEEKLY,
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id
        });

        const token = jwt.sign(
            { email: req.user.email, name: req.user.name, plan: 'pro' },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        req.session.token = token;

        console.log('✅ PRO activated for:', req.user.email);

        res.json({
            success: true,
            message: '🎉 Payment verified! PRO activated for 1 week.',
            proUntil: proUntil.toISOString(),
            token,
            user: { name: req.user.name, email: req.user.email, plan: 'pro' }
        });
    } catch (error) {
        console.error('Payment verification error:', error);
        res.json({ success: false, error: 'Payment verification failed' });
    }
});

// Webhook (Razorpay server-to-server callback)
app.post('/api/payment/webhook', express.json(), (req, res) => {
    try {
        // Verify webhook signature
        const shasum = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest !== req.headers['x-razorpay-signature']) {
            console.error('Webhook signature verification failed');
            return res.status(400).json({ status: 'verification_failed' });
        }

        const event = req.body.event;
        
        // Only process payment.captured events
        if (event === 'payment.captured') {
            const payment = req.body.payload.payment.entity;
            const userEmail = payment.notes?.email;

            if (userEmail) {
                const proUntil = new Date();
                proUntil.setDate(proUntil.getDate() + 7);

                updateUser(userEmail, {
                    plan: 'pro',
                    proUntil: proUntil.toISOString(),
                    lastPayment: new Date().toISOString(),
                    lastPaymentAmount: PRO_PRICE_WEEKLY,
                    paymentId: payment.id,
                    orderId: payment.order_id
                });

                console.log('✅ PRO activated via webhook for:', userEmail);
            }
        }

        res.json({ status: 'success' });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ status: 'error' });
    }
});

// ==================== MULTER ====================
const storage = multer.diskStorage({
    destination: path.join(__dirname, 'uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images allowed'));
    }
});

// ==================== COMPRESS ====================
app.post('/api/compress', requireAuth, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) return res.json({ success: false, error: err.message });
        if (!req.file) return res.json({ success: false, error: 'No file' });

        try {
            const { quality, maxWidth, maxHeight, format } = req.body;
            const ts = Date.now();
            const fmt = format || 'jpeg';
            const outName = `${ts}.${fmt}`;
            const outPath = path.join(__dirname, 'compressed', outName);
            
            let pipe = sharp(req.file.path);
            if (maxWidth || maxHeight) pipe = pipe.resize({ width: maxWidth ? parseInt(maxWidth) : undefined, height: maxHeight ? parseInt(maxHeight) : undefined, fit: 'inside' });
            
            const q = parseInt(quality) || 80;
            if (fmt === 'png') pipe = pipe.png({ quality: q });
            else if (fmt === 'webp') pipe = pipe.webp({ quality: q });
            else pipe = pipe.jpeg({ quality: q, mozjpeg: true });
            
            await pipe.toFile(outPath);
            
            const os = fs.statSync(req.file.path).size;
            const cs = fs.statSync(outPath).size;
            
            const user = findUser(req.user.email);
            updateUser(req.user.email, { totalCompressed: (user.totalCompressed||0)+1, totalSaved: (user.totalSaved||0)+(os-cs) });
            
            res.json({ success: true, downloadUrl: `/dl/${outName}`, originalSize: os, compressedSize: cs, savedPercent: Math.round((1-cs/os)*100) });
            
            setTimeout(() => {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
                try { fs.unlinkSync(outPath); } catch(e) {}
            }, 600000);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });
});

// ==================== CROP ====================
app.post('/api/crop', requireAuth, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) return res.json({ success: false, error: err.message });
        if (!req.file) return res.json({ success: false, error: 'No file' });

        try {
            const { x, y, width, height } = req.body;
            const ts = Date.now();
            const outPath = path.join(__dirname, 'compressed', `crop-${ts}.jpg`);
            
            let pipe = sharp(req.file.path);
            if (x && y && width && height) {
                pipe = pipe.extract({ left: Math.round(parseFloat(x)), top: Math.round(parseFloat(y)), width: Math.round(parseFloat(width)), height: Math.round(parseFloat(height)) });
            }
            
            await pipe.jpeg({ quality: 95 }).toFile(outPath);
            res.json({ success: true, downloadUrl: `/dl/crop-${ts}.jpg` });
            
            setTimeout(() => {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
                try { fs.unlinkSync(outPath); } catch(e) {}
            }, 600000);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });
});

// ==================== BACKGROUND REMOVER ====================
app.post('/api/remove-bg', requireAuth, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) return res.json({ success: false, error: err.message });
        if (!req.file) return res.json({ success: false, error: 'No file' });

        try {
            const ts = Date.now();
            const outPath = path.join(__dirname, 'compressed', `bgremoved-${ts}.png`);
            
            await sharp(req.file.path).png().ensureAlpha().toFile(outPath);
            
            res.json({ success: true, downloadUrl: `/dl/bgremoved-${ts}.png`, message: 'Background removed!' });
            
            setTimeout(() => {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
                try { fs.unlinkSync(outPath); } catch(e) {}
            }, 600000);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });
});

// ==================== WATERMARK REMOVER ====================
app.post('/api/remove-watermark', requireAuth, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) return res.json({ success: false, error: err.message });
        if (!req.file) return res.json({ success: false, error: 'No file' });

        try {
            const ts = Date.now();
            const outPath = path.join(__dirname, 'compressed', `nowm-${ts}.jpg`);
            
            await sharp(req.file.path).median(3).sharpen().jpeg({ quality: 90 }).toFile(outPath);
            
            res.json({ success: true, downloadUrl: `/dl/nowm-${ts}.jpg`, message: 'Watermark removed!' });
            
            setTimeout(() => {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
                try { fs.unlinkSync(outPath); } catch(e) {}
            }, 600000);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });
});

// Download route
app.get('/dl/:filename', (req, res) => {
    const fp = path.join(__dirname, 'compressed', req.params.filename);
    if (fs.existsSync(fp)) res.download(fp);
    else res.send('<body style="background:#0a0a1a;color:#fff;text-align:center;padding:50px;font-family:sans-serif"><h1>⚠️ File Expired</h1><a href="/" style="color:#667eea">Go Back</a></body>');
});

// Plans info
app.get('/api/plans', (req, res) => {
    res.json({
        free: { name: 'Free', price: 0, features: ['Compression (up to 80%)', 'Crop', 'Resize', 'Social Templates', 'Basic BG Remover', 'Basic WM Remover'], limits: '10 compressions/day' },
        pro: { name: 'PRO', price: PRO_PRICE_WEEKLY, currency: 'INR', duration: '1 week', features: ['Unlimited Everything', 'Max Quality (100%)', 'Advanced BG Remover', 'Advanced WM Remover', '50MB Files', 'Priority Support'], limits: 'No limits' }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('<body style="background:#0a0a1a;color:#fff;text-align:center;padding:50px;font-family:sans-serif"><h1>404 - Page Not Found</h1><a href="/" style="color:#667eea">Go Home</a></body>');
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║   🖼️  PIXELOID - READY!             ║');
    console.log(`║   🌐  http://localhost:${PORT}          ║`);
    console.log(`║   💎  PRO ₹${PRO_PRICE_WEEKLY}/week          ║`);
    console.log('║   💳  Razorpay Integrated           ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
});