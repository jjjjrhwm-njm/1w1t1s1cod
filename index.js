require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay, getContentType } = require("@whiskeysockets/baileys");
const admin = require("firebase-admin");
const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

// استيراد المنطق المطور
const { getAIResponse } = require("./core/ai");
const { handleManualCommand } = require("./core/commands");
const { isSpamming } = require("./core/antiSpam");
const gatekeeper = require("./gatekeeper"); // [ديب سيك] استدعاء ملف الحارس

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
            }
            if (connection === 'open') { 
                isConnected = true; 
                qrCodeImage = "DONE"; 
                logger.log('SUCCESS', 'Bot connected successfully!');
                
                // تهيئة الحارس فور الاتصال
                const ownerJid = process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER + '@s.whatsapp.net' : null;
                if (ownerJid) {
                    gatekeeper.initialize(sock, ownerJid);
                }
                
                await sendStartupNotification();
            }
            if (connection === 'close') {
                isConnected = false;
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) setTimeout(startBot, 5000);
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
        }
    } catch (e) {}
}

async function backupSessionToFirebase() {
    if (!db || !fs.existsSync('./auth_info/creds.json')) return;
    try {
        const creds = JSON.parse(fs.readFileSync('./auth_info/creds.json', 'utf8'));
        await db.collection('session').doc('session_vip_rashed').set(creds, { merge: true });
    } catch (e) {}
}

async function sendStartupNotification() {
    const ownerJid = process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER + '@s.whatsapp.net' : null;
    if (ownerJid && sock) {
        await sock.sendMessage(ownerJid, { text: `✅ راشد جاهز لخدمتك يا مطور!` });
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
        // فحص الأوامر اليدوية
        const manualResponse = await handleManualCommand(text, jid, isOwner, pushName);
        
        if (manualResponse) {
            await simulateHumanTyping(jid, manualResponse.length);
            await sock.sendMessage(jid, { text: manualResponse });
            return;
        }

        // نظام الحارس
        
        // إذا كان المرسل هو المالك، نفحص إذا كان يرد بـ نعم/لا أو أوامر
        if (isOwner) {
            if (gatekeeper.handleOwnerDecision(text)) return; 
        }

        // فحص الإذن والانتظار
        const gateResponse = await gatekeeper.handleEverything(jid, pushName, text);
        
        if (gateResponse.status === 'STOP' || gateResponse.status === 'WAITING' || gateResponse.status === 'WAITING_OTP') return;
        
        if (botStatus.maintenance && !isOwner) return;
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
        await sock.sendMessage(jid, { text: `حصل خطأ بسيط في معالجة رسالتك، أعد المحاولة يا غالي.` });
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
// 🔥 نقاط API الجديدة للتحقق من التطبيقات 🔥
// =============================================

app.use(express.json()); // لقراءة JSON من التطبيق

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

// نقطة نهاية للحصول على معلومات المستخدم (للمطور)
app.post('/api/user-info', async (req, res) => {
    try {
        const { jid, adminKey } = req.body;
        
        // تحقق بسيط
        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ 
                success: false, 
                error: 'غير مصرح' 
            });
        }
        
        if (!jid) {
            return res.status(400).json({ 
                success: false, 
                error: 'jid مطلوب' 
            });
        }
        
        const sessionInfo = gatekeeper.getSessionInfo(jid);
        const verifiedApps = [];
        
        // البحث عن التطبيقات الموثقة لهذا المستخدم
        // هذا يحتاج تعديل في gatekeeper.js لكن حالياً نرجع معلومات بسيطة
        
        res.json({ 
            success: true, 
            jid,
            session: sessionInfo
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// نقطة نهاية للصحة (Health check)
app.get('/api/health', (req, res) => {
    res.json({
        status: isConnected ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// =============================================
// الصفحة الرئيسية (كما هي)
// =============================================

app.get("/", (req, res) => {
    if (isConnected) res.send("<h1 style='text-align:center;color:green;'>✅ راشد متصل الآن</h1>");
    else if (qrCodeImage) res.send(`<div style='text-align:center;'><h1>🔐 امسح الكود</h1><img src='${qrCodeImage}'></div>`);
    else res.send("<h1>🔄 جاري التهيئة...</h1>");
});

// بدء الخادم
app.listen(port, () => {
    console.log(`🌐 Server on port ${port}`);
    console.log(`📱 API endpoints available at http://localhost:${port}/api/`);
    startBot();
});
