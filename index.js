require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay, getContentType } = require("@whiskeysockets/baileys");
const admin = require("firebase-admin");
const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const https = require('https'); // للنبض

// استيراد المنطق المطور
const { getAIResponse } = require("./core/ai");
const { handleManualCommand } = require("./core/commands");
const { isSpamming } = require("./core/antiSpam");
const gatekeeper = require("./gatekeeper");

const app = express();
const port = process.env.PORT || 10000;
let qrCodeImage = "";
let isConnected = false;
let sock = null;
let db = null;
let botStatus = {
    isActive: true,
    autoReply: true,
    privateMode: false,
    maintenance: false,
    lastRestart: new Date()
};

// إعداد Firebase
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        if (!admin.apps.length) {
            admin.initializeApp({ 
                credential: admin.credential.cert(serviceAccount),
                databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
            });
            db = admin.firestore();
            console.log("✅ Firebase connected successfully");
        }
    } catch (e) { 
        console.log("⚠️ Firebase Error:", e.message); 
    }
}

// إعداد مجلدات النظام
function setupDirectories() {
    const directories = [
        './auth_info',
        './logs',
        './backups',
        './cache',
        './temp'
    ];
    
    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

// نظام حفظ السجلات
class Logger {
    constructor() {
        this.logFile = `./logs/bot_${new Date().toISOString().split('T')[0]}.log`;
        if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');
    }
    
    log(type, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            type,
            message,
            data: data ? JSON.stringify(data).substring(0, 500) : null
        };
        
        console.log(`[${timestamp}] ${type}: ${message}`);
        
        try {
            fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
        } catch (e) {}
        
        if (db && type === 'ERROR') {
            this.saveToFirebase(logEntry);
        }
    }
    
    async saveToFirebase(logEntry) {
        try {
            await db.collection('error_logs').add({
                ...logEntry,
                serverTime: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error("Failed to save log to Firebase:", error);
        }
    }
}

const logger = new Logger();

// نظام إدارة الحالة
class StateManager {
    constructor() {
        this.userStates = new Map();
    }
    
    updateUserState(jid, updates) {
        const state = this.userStates.get(jid) || { lastInteraction: new Date() };
        Object.assign(state, updates);
        state.lastInteraction = new Date();
        this.userStates.set(jid, state);
    }
}

const stateManager = new StateManager();

// =============================================
// 🔥 نظام النبض كل 10 دقائق 🔥
// =============================================
function startPingService() {
    const pingInterval = 10 * 60 * 1000; // 10 دقائق
    const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
    
    console.log(`📡 نظام النبض شغال على ${selfUrl} كل 10 دقائق`);
    
    // نبض فوري عند التشغيل
    setTimeout(() => {
        https.get(selfUrl, (res) => {
            console.log(`✅ نبض أولي: ${res.statusCode} - ${new Date().toLocaleTimeString()}`);
        }).on('error', (err) => {
            console.log(`❌ خطأ في النبض الأولي: ${err.message}`);
        });
    }, 5000);
    
    // نبض كل 10 دقائق
    setInterval(() => {
        https.get(selfUrl, (res) => {
            console.log(`✅ نبض: ${res.statusCode} - ${new Date().toLocaleTimeString()}`);
        }).on('error', (err) => {
            console.log(`❌ خطأ في النبض: ${err.message}`);
        });
    }, pingInterval);
}

async function startBot() {
    try {
        setupDirectories();
        logger.log('INFO', 'Starting bot initialization...');
        
        await restoreSession();
        
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        const { version } = await fetchLatestBaileysVersion();
        
        sock = makeWASocket({ 
            version, 
            auth: state, 
            printQRInTerminal: false, 
            logger: pino({ level: "silent" }),
            browser: ["Mac OS", "Chrome", "114.0.5735.198"],
            markOnlineOnConnect: true,
            syncFullHistory: false
        });
        
        sock.ev.on('creds.update', async () => {
            await saveCreds();
            await backupSessionToFirebase();
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect } = update;
            if (qr) {
                QRCode.toDataURL(qr, (err, url) => { qrCodeImage = url; });
                console.log("📱 QR Code generated - Scan with WhatsApp");
            }
            if (connection === 'open') { 
                isConnected = true; 
                qrCodeImage = "DONE"; 
                logger.log('SUCCESS', 'Bot connected successfully!');
                
                // تهيئة الحارس
                const ownerJid = process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER + '@s.whatsapp.net' : null;
                if (ownerJid) {
                    gatekeeper.initialize(sock, ownerJid);
                }
                
                await sendStartupNotification();
            }
            if (connection === 'close') {
                isConnected = false;
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log("🔄 إعادة الاتصال بعد 5 ثواني...");
                    setTimeout(startBot, 5000);
                }
            }
        });
        
        sock.ev.on('messages.upsert', async m => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            await processIncomingMessage(msg);
        });
        
    } catch (error) {
        logger.log('ERROR', 'Failed to start bot:', error);
        setTimeout(startBot, 10000);
    }
}

async function restoreSession() {
    if (!db) return;
    try {
        const doc = await db.collection('session').doc('session_vip_rashed').get();
        if (doc.exists) {
            const sessionData = doc.data();
            if (!fs.existsSync('./auth_info')) fs.mkdirSync('./auth_info');
            fs.writeFileSync('./auth_info/creds.json', JSON.stringify(sessionData));
            console.log("✅ تم استعادة الجلسة من Firebase");
        }
    } catch (e) {}
}

async function backupSessionToFirebase() {
    if (!db || !fs.existsSync('./auth_info/creds.json')) return;
    try {
        const creds = JSON.parse(fs.readFileSync('./auth_info/creds.json', 'utf8'));
        await db.collection('session').doc('session_vip_rashed').set(creds, { merge: true });
        console.log("✅ تم حفظ الجلسة في Firebase");
    } catch (e) {}
}

async function sendStartupNotification() {
    const ownerJid = process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER + '@s.whatsapp.net' : null;
    if (ownerJid && sock) {
        await sock.sendMessage(ownerJid, { text: `✅ راشد جاهز لخدمتك يا مطور!\n🧠 الذكاء: ${gatekeeper.isAIEnabled() ? 'مفعل' : 'معطل'}` });
    }
}

async function processIncomingMessage(msg) {
    const jid = msg.key.remoteJid;
    const pushName = msg.pushName || 'صديق';
    const messageType = getContentType(msg.message);
    
    let text = '';
    if (messageType === 'conversation') text = msg.message.conversation;
    else if (messageType === 'extendedTextMessage') text = msg.message.extendedTextMessage?.text;
    else if (messageType === 'imageMessage') text = msg.message.imageMessage?.caption;
    
    if (!text || !text.trim()) return;
    if (isSpamming(jid, text)) return;

    const isOwner = jid.includes(process.env.OWNER_NUMBER || "966554526287");
    
    try {
        // فحص الأوامر اليدوية أولاً
        const manualResponse = await handleManualCommand(text, jid, isOwner, pushName);
        
        if (manualResponse) {
            await simulateHumanTyping(jid, manualResponse.length);
            await sock.sendMessage(jid, { text: manualResponse });
            return;
        }

        // نظام الحارس
        
        // إذا كان المرسل هو المالك، نفحص إذا كان يرد بـ نعم/لا
        if (isOwner) {
            if (gatekeeper.handleOwnerDecision(text)) return; 
        }

        // فحص الإذن والانتظار
        const gateResponse = await gatekeeper.handleEverything(jid, pushName, text);
        
        if (gateResponse.status === 'STOP' || gateResponse.status === 'WAITING' || gateResponse.status === 'WAITING_OTP') {
            return;
        }
        
        if (botStatus.maintenance && !isOwner) return;
        
        // ✅ التحقق من حالة الذكاء الاصطناعي
        // إذا كان الذكاء معطل والمرسل ليس المالك، نتجاهل الرسالة تماماً
        if (!gatekeeper.isAIEnabled() && !isOwner) {
            console.log(`🤖 الذكاء معطل - تم تجاهل رسالة من ${pushName} (${jid.split('@')[0]})`);
            return;
        }
        
        if (!botStatus.autoReply && !isOwner) return;
        
        // الرد بالذكاء الاصطناعي
        await sock.sendPresenceUpdate('composing', jid);
        const aiResponse = await getAIResponse(jid, text, pushName);
        
        if (aiResponse) {
            await delay(1000 + (aiResponse.length * 10)); 
            await sock.sendMessage(jid, { text: aiResponse });
            if (db) updateStatistics(jid, pushName, text, aiResponse);
        }
        
    } catch (error) {
        logger.log('ERROR', `Error with ${pushName}:`, error.message);
        if (gatekeeper.isAIEnabled()) {
            await sock.sendMessage(jid, { text: `حصل خطأ بسيط في معالجة رسالتك، أعد المحاولة يا غالي.` });
        }
    }
}

async function simulateHumanTyping(jid, textLength) {
    try {
        await sock.sendPresenceUpdate('composing', jid);
        await delay(Math.min(textLength * 20, 2000));
        await sock.sendPresenceUpdate('paused', jid);
    } catch (e) {}
}

async function updateStatistics(jid, pushName, query, response) {
    try {
        await db.collection('conversations').add({
            user_jid: jid,
            user_name: pushName,
            query: query,
            response: response,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {}
}

// =============================================
// 🔥 نقاط API للتحقق من التطبيقات 🔥
// =============================================

app.use(express.json());

// نقطة نهاية لطلب التحقق من التطبيق
app.post('/api/verify-app', async (req, res) => {
    try {
        const { jid, pushName, appName, name, phone, deviceId } = req.body;
        
        if (!jid || !appName || !deviceId) {
            return res.status(400).json({ 
                success: false, 
                error: 'بيانات ناقصة: jid, appName, deviceId مطلوبة' 
            });
        }
        
        const result = await gatekeeper.handleAppVerification(jid, pushName, appName, name, phone, deviceId);
        res.json({ success: true, ...result });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// نقطة نهاية للتحقق من الكود
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { jid, appName, otp } = req.body;
        
        if (!jid || !appName || !otp) {
            return res.status(400).json({ 
                success: false, 
                error: 'بيانات ناقصة: jid, appName, otp مطلوبة' 
            });
        }
        
        const result = await gatekeeper.verifyOTP(jid, appName, otp);
        res.json({ success: true, ...result });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// نقطة نهاية للتحقق من حالة التوثيق
app.post('/api/check-verification', async (req, res) => {
    try {
        const { jid, appName } = req.body;
        
        if (!jid || !appName) {
            return res.status(400).json({ 
                success: false, 
                error: 'بيانات ناقصة: jid, appName مطلوبة' 
            });
        }
        
        const isVerified = gatekeeper.isAppVerified(jid, appName);
        const sessionInfo = gatekeeper.getSessionInfo(jid);
        const otpInfo = gatekeeper.getOTPInfo(jid, appName);
        
        res.json({ 
            success: true, 
            verified: isVerified,
            session: sessionInfo,
            otp: otpInfo
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// نقطة نهاية للتحقق من الرقم وتصحيحه
app.post('/api/check-phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({ 
                success: false, 
                error: 'الرجاء إدخال رقم الهاتف' 
            });
        }
        
        const result = await gatekeeper.checkPhoneNumber(phone);
        res.json({ success: true, ...result });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// نقطة نهاية للبحث عن تطبيقات برقم هاتف (للمطور)
app.post('/api/find-by-phone', async (req, res) => {
    try {
        const { phone, adminKey } = req.body;
        
        // تحقق بسيط (للمطور فقط)
        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ 
                success: false, 
                error: 'غير مصرح' 
            });
        }
        
        if (!phone) {
            return res.status(400).json({ 
                success: false, 
                error: 'الرجاء إدخال رقم الهاتف' 
            });
        }
        
        const results = gatekeeper.findAppByPhone(phone);
        res.json({ 
            success: true, 
            count: results.length,
            apps: results 
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// نقطة نهاية للصحة
app.get('/api/health', (req, res) => {
    res.json({
        status: isConnected ? 'connected' : 'disconnected',
        aiEnabled: gatekeeper.isAIEnabled(),
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        otpPending: Array.from(gatekeeper.otpWhitelist || []).length
    });
});

// الصفحة الرئيسية
app.get("/", (req, res) => {
    if (isConnected) {
        res.send(`<h1 style='text-align:center;color:green;'>✅ راشد متصل الآن</h1>
                 <p style='text-align:center;'>🧠 الذكاء: ${gatekeeper.isAIEnabled() ? 'مفعل' : 'معطل'}</p>
                 <p style='text-align:center;'>📱 نقاط API: /api/verify-app, /api/verify-otp, /api/check-phone</p>`);
    }
    else if (qrCodeImage && qrCodeImage !== "DONE") {
        res.send(`<div style='text-align:center;'><h1>🔐 امسح الكود</h1><img src='${qrCodeImage}'></div>`);
    }
    else {
        res.send("<h1 style='text-align:center;'>🔄 جاري التهيئة...</h1>");
    }
});

// بدء الخادم
app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Server on port ${port}`);
    console.log(`📱 API endpoints available at http://localhost:${port}/api/`);
    console.log(`   - POST /api/verify-app`);
    console.log(`   - POST /api/verify-otp`);
    console.log(`   - POST /api/check-verification`);
    console.log(`   - POST /api/check-phone`);
    console.log(`   - POST /api/find-by-phone`);
    console.log(`   - GET  /api/health`);
    startBot();
    startPingService(); // تشغيل النبض
});
