require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } = require("@whiskeysockets/baileys");
const admin = require("firebase-admin");
const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 10000;

let qrCodeImage = "";
let isConnected = false;
let sock = null;
let db = null;
const OWNER_JID = (process.env.OWNER_NUMBER || "966554526287") + "@s.whatsapp.net";

// 1. تهيئة Firebase (المسؤول عن استعادة هويتك)
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        if (!admin.apps.length) {
            admin.initializeApp({ 
                credential: admin.credential.cert(serviceAccount),
                databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
            });
            db = admin.firestore();
            console.log("✅ متصل بـ Firebase - سيتم استعادة الجلسة الآن");
        }
    } catch (e) { console.log("⚠️ Firebase Error:", e.message); }
}

// دالة استعادة الهوية من السحابة (عشان ما يطلب QR)
async function restoreSession() {
    if (!db) return;
    try {
        const doc = await db.collection('session').doc('session_vip_rashed').get();
        if (doc.exists) {
            const sessionData = doc.data();
            const authDir = './auth_info';
            if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
            fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify(sessionData));
            console.log("✅ تم استعادة هويتك وجلستك من Firebase بنجاح!");
        }
    } catch (e) { console.log("❌ فشل استعادة الجلسة:", e.message); }
}

// دالة حفظ الهوية للسحابة (للنسخ الاحتياطي المستمر)
async function backupSessionToFirebase() {
    if (!db || !fs.existsSync('./auth_info/creds.json')) return;
    try {
        const creds = JSON.parse(fs.readFileSync('./auth_info/creds.json', 'utf8'));
        await db.collection('session').doc('session_vip_rashed').set(creds, { merge: true });
    } catch (e) {}
}

// ---------------------------------------------------------
// 🛡️ مسارات الحارس الخاص بالتطبيق (API)
// ---------------------------------------------------------

app.get("/check-device", async (req, res) => {
    const { id } = req.query;
    if (!id || !db) return res.status(400).send("Error");
    try {
        const deviceDoc = await db.collection('allowed_devices').doc(id).get();
        if (deviceDoc.exists) return res.status(200).send("OK");
        return res.status(403).send("Unauthorized");
    } catch (e) { res.status(500).send("Error"); }
});

app.get("/request-otp", async (req, res) => {
    const { phone, deviceId, name } = req.query;
    if (!phone || !isConnected || !sock) return res.status(500).send("Server Not Ready");
    try {
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        await db.collection('pending_otps').doc(phone).set({
            code: otpCode, deviceId, timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // إرسال الكود للرقم المطلوب
        const targetJid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
        await sock.sendMessage(targetJid, { text: `كود التحقق الخاص بك هو: ${otpCode}\nلا تشاركه مع أحد.` });

        // تنبيه لك كـ مطور (اختياري)
        await sock.sendMessage(OWNER_JID, { text: `🔔 كود جديد لـ ${name || 'مستخدم'}\n📱 الرقم: ${phone}\n🔑 الكود: ${otpCode}` });
        
        res.status(200).send("Sent");
    } catch (e) { res.status(500).send("Failed"); }
});

app.get("/verify-otp", async (req, res) => {
    const { phone, code } = req.query;
    try {
        const otpDoc = await db.collection('pending_otps').doc(phone).get();
        if (otpDoc.exists && otpDoc.data().code === code) {
            await db.collection('allowed_devices').doc(otpDoc.data().deviceId).set({
                phone, verifiedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(200).send("Verified");
        }
        res.status(401).send("Invalid");
    } catch (e) { res.status(500).send("Error"); }
});

// ---------------------------------------------------------
// 🔐 نظام الاتصال (Baileys) - استعادة الهوية والصمت
// ---------------------------------------------------------

async function startBot() {
    // 1. استعادة الجلسة من Firebase قبل البدء
    await restoreSession();

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Guardian VIP", "Chrome", "20.0.0"]
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await backupSessionToFirebase(); // حفظ أي تحديث فوراً
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) QRCode.toDataURL(qr, (err, url) => { qrCodeImage = url; });
        if (connection === 'open') {
            isConnected = true;
            qrCodeImage = "DONE";
            console.log("🛡️ تم استعادة هويتك.. الحارس متصل الآن وبصمت تام.");
        }
        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    // ⛔ تعطيل الرد على الرسائل تماماً ⛔
    sock.ev.on('messages.upsert', () => { return; });
}

app.get("/", (req, res) => {
    if (isConnected) res.send("<h1 style='text-align:center;color:green;'>🛡️ نظام الحارس نشط (الهوية مستعادة)</h1>");
    else if (qrCodeImage) res.send(`<div style='text-align:center;'><h1>الهوية مفقودة.. امسح الكود</h1><img src='${qrCodeImage}'></div>`);
    else res.send("<h1>جاري المحاولة واستعادة البيانات...</h1>");
});

app.listen(port, () => {
    console.log(`🌐 API on port ${port}`);
    startBot();
});
