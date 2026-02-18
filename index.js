require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } = require("@whiskeysockets/baileys");
const admin = require("firebase-admin");
const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 10000;

let qrCodeImage = "";
let isConnected = false;
let sock = null;
let db = null;

// 1. إعداد Firebase (لقاعدة البيانات)
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
            db = admin.firestore();
        }
    } catch (e) { console.log("Firebase Error:", e.message); }
}

// ---------------------------------------------------------
// 🛠️ المسارات الخاصة بالتطبيق (API Endpoints)
// ---------------------------------------------------------

// أ. فحص الجهاز (Check Device)
app.get("/check-device", async (req, res) => {
    const { id } = req.query;
    if (!id || !db) return res.status(400).send("Error");

    try {
        const deviceDoc = await db.collection('allowed_devices').doc(id).get();
        if (deviceDoc.exists) return res.status(200).send("OK");
        return res.status(403).send("Unauthorized");
    } catch (e) { res.status(500).send("Error"); }
});

// ب. طلب الكود وإرساله (Request OTP)
// هذا هو المحرك الرئيسي: يستقبل الطلب من التطبيق ويرسل رسالة واتساب للرقم المستهدف
app.get("/request-otp", async (req, res) => {
    const { phone, deviceId } = req.query;
    if (!phone || !isConnected || !sock) return res.status(500).send("Server Not Ready");

    try {
        // 1. توليد كود عشوائي
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // 2. حفظ الكود في Firebase للتحقق لاحقاً
        await db.collection('pending_otps').doc(phone).set({
            code: otpCode,
            deviceId: deviceId,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // 3. إرسال الكود للرقم المطلوب عبر الواتساب (إرسال حقيقي)
        const targetJid = phone.includes('@s.whatsapp.net') ? phone : `${phone}@s.whatsapp.net`;
        await sock.sendMessage(targetJid, { 
            text: `كود التحقق الخاص بك هو: ${otpCode}\nلا تشارك هذا الكود مع أحد.` 
        });

        console.log(`✅ تم إرسال كود لـ: ${phone}`);
        res.status(200).send("Sent");
    } catch (e) {
        console.error("خطأ في إرسال الكود:", e);
        res.status(500).send("Failed");
    }
});

// ج. التحقق من الكود (Verify OTP)
app.get("/verify-otp", async (req, res) => {
    const { phone, code } = req.query;
    if (!phone || !code || !db) return res.status(400).send("Missing Data");

    try {
        const otpDoc = await db.collection('pending_otps').doc(phone).get();
        if (otpDoc.exists && otpDoc.data().code === code) {
            const deviceId = otpDoc.data().deviceId;
            // توثيق الجهاز في القائمة البيضاء
            await db.collection('allowed_devices').doc(deviceId).set({
                phone, verifiedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(200).send("Verified");
        }
        res.status(401).send("Invalid");
    } catch (e) { res.status(500).send("Error"); }
});

// ---------------------------------------------------------
// 🔐 نظام الاتصال (Baileys) - المحافظة على الهوية والـ QR
// ---------------------------------------------------------

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // الهوية كما هي
        logger: pino({ level: "silent" }),
        browser: ["Guardian Server", "Chrome", "20.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) QRCode.toDataURL(qr, (err, url) => { qrCodeImage = url; });
        if (connection === 'open') {
            isConnected = true;
            qrCodeImage = "DONE";
            console.log("🛡️ السيرفر متصل ويعمل كحارس للتطبيق فقط.");
        }
        if (connection === 'close') {
            isConnected = false;
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
        }
    });

    // ⛔ تعطيل الرد على الرسائل تماماً ⛔
    sock.ev.on('messages.upsert', async m => {
        // لا يوجد أي منطق هنا للرد على الرسائل
        // السيرفر سيبقى صامتاً مهما استقبل من رسائل
        return; 
    });
}

// واجهة الويب لعرض الـ QR
app.get("/", (req, res) => {
    if (isConnected) res.send("<h1 style='text-align:center;color:blue;'>🛡️ نظام الحارس نشط (صامت)</h1>");
    else if (qrCodeImage) res.send(`<div style='text-align:center;'><h1>امسح الكود لربط التطبيق</h1><img src='${qrCodeImage}'></div>`);
    else res.send("<h1>جاري التهيئة...</h1>");
});

app.listen(port, () => {
    console.log(`🌐 Guardian API on port ${port}`);
    startBot();
});
