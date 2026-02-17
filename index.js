require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay, getContentType } = require("@whiskeysockets/baileys");
const admin = require("firebase-admin");
const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");

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
            console.log("✅ Firebase connected");
        }
    } catch (e) { console.log("⚠️ Firebase Error:", e.message); }
}

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        const { version } = await fetchLatestBaileysVersion();
        
        sock = makeWASocket({ 
            version, auth: state, printQRInTerminal: false, 
            logger: pino({ level: "silent" }),
            browser: ["Mac OS", "Chrome", "114.0.5735.198"],
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', (update) => {
            const { connection, qr } = update;
            if (qr) QRCode.toDataURL(qr, (err, url) => { qrCodeImage = url; });
            if (connection === 'open') { isConnected = true; qrCodeImage = "DONE"; }
            if (connection === 'close') { isConnected = false; setTimeout(startBot, 5000); }
        });

        sock.ev.on('messages.upsert', async m => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            await processIncomingMessage(msg);
        });
    } catch (error) { setTimeout(startBot, 10000); }
}

async function processIncomingMessage(msg) {
    const jid = msg.key.remoteJid;
    const pushName = msg.pushName || 'صديق';
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    
    if (!text || isSpamming(jid, text)) return;
    const isOwner = jid.includes(process.env.OWNER_NUMBER || "966554526287");
    
    try {
        // فحص أوامر "نجم" وأوامر السكرتير
        const manualResponse = await handleManualCommand(text, jid, isOwner, pushName, sock, db);
        if (manualResponse) {
            await sock.sendMessage(jid, { text: manualResponse });
            return;
        }

        // نظام الحارس (Gatekeeper)
        if (isOwner) { if (gatekeeper.handleOwnerDecision(text)) return; }
        const gateResponse = await gatekeeper.handleEverything(jid, pushName, text);
        if (gateResponse.status !== 'PROCEED') return;

        // الرد بالذكاء الاصطناعي
        const aiResponse = await getAIResponse(jid, text, pushName);
        if (aiResponse) await sock.sendMessage(jid, { text: aiResponse });
        
    } catch (e) { console.error(e); }
}

// 🌐 مسارات المزامنة مع كود السمالي (تعدد التطبيقات)
app.get("/request-otp", async (req, res) => {
    const { phone, name, deviceId, app: appName } = req.query;
    const cleanPhone = phone.replace(/\D/g, '') + "@s.whatsapp.net";
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // حفظ البيانات في Firebase
    if (db) {
        await db.collection('app_users').doc(phone).set({
            name, deviceId, appName, otpCode, status: 'pending', lastSeen: new Date()
        });
    }

    // إرسال الكود للمستخدم عبر الواتساب
    if (sock) {
        await sock.sendMessage(cleanPhone, { text: `🔐 كود التحقق الخاص بك لتطبيق [${appName}] هو: ${otpCode}` });
        // تنبيه المالك
        await sock.sendMessage(process.env.OWNER_NUMBER + "@s.whatsapp.net", { 
            text: `🔔 دخول جديد!\n👤 الاسم: ${name}\n📱 الرقم: ${phone}\n🆔 الجهاز: ${deviceId}\n📦 التطبيق: ${appName}\n🔑 الكود: ${otpCode}`
        });
    }
    res.sendStatus(200);
});

app.get("/verify-otp", async (req, res) => {
    const { phone, code } = req.query;
    if (db) {
        const doc = await db.collection('app_users').doc(phone).get();
        if (doc.exists && doc.data().otpCode === code) {
            await db.collection('app_users').doc(phone).update({ status: 'verified' });
            return res.sendStatus(200); // السمالي سيفتح التطبيق
        }
    }
    res.sendStatus(401); // السمالي سيعطي خطأ
});

app.get("/", (req, res) => {
    if (isConnected) res.send("<h1>✅ السكرتير متصل</h1>");
    else res.send(qrCodeImage ? `<img src="${qrCodeImage}">` : "<h1>🔄 جاري التحميل...</h1>");
});

app.listen(port, () => { console.log(`Server on ${port}`); startBot(); });
