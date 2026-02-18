require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } = require("@whiskeysockets/baileys");
const { parsePhoneNumberFromString } = require('libphonenumber-js');
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

// --- المحرك الذكي لتنسيق الأرقام ---
const smartFormatPhone = (phone) => {
    // 1. تنظيف الرقم من أي رموز
    let cleaned = phone.replace(/\D/g, "");
    
    // 2. إذا بدأ بـ 0، نحذفه مؤقتاً لمحاولة الفحص (مثل 055...)
    if (cleaned.startsWith("0")) cleaned = cleaned.substring(1);

    // 3. قائمة الدول العربية الشائعة لسرعة التمييز (السعودية، اليمن، مصر، سوريا، العراق)
    // الافتراضي هو السعودية 'SA' لأنها مقر العمل الرئيسي
    const regions = ['SA', 'YE', 'EG', 'SY', 'IQ', 'AE', 'KW', 'QA', 'JO'];
    
    for (let region of regions) {
        const phoneNumber = parsePhoneNumberFromString(cleaned, region);
        if (phoneNumber && phoneNumber.isValid()) {
            return phoneNumber.format('E.164').replace('+', ''); // يعيد الرقم مثل 966554526287
        }
    }

    // 4. إذا لم يطابق الأنماط العربية، نحاول الفحص العالمي الشامل
    const globalNumber = parsePhoneNumberFromString("+" + cleaned);
    if (globalNumber && globalNumber.isValid()) {
        return globalNumber.format('E.164').replace('+', '');
    }

    return cleaned; // في حال الفشل التام يعيد الرقم كما هو
};

// 1. تهيئة Firebase
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        if (!admin.apps.length) {
            admin.initializeApp({ 
                credential: admin.credential.cert(serviceAccount),
                databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
            });
            db = admin.firestore();
            console.log("✅ Firebase Connected");
        }
    } catch (e) { console.log("⚠️ Firebase Error:", e.message); }
}

// استعادة وحفظ الجلسة
async function restoreSession() {
    if (!db) return;
    try {
        const doc = await db.collection('session').doc('session_vip_rashed').get();
        if (doc.exists) {
            const authDir = './auth_info';
            if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
            fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify(doc.data()));
            console.log("✅ Identity Restored");
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

// ---------------------------------------------------------
// 🛡️ مسارات الحارس الذكي (API)
// ---------------------------------------------------------

app.get("/request-otp", async (req, res) => {
    let { phone, deviceId, name } = req.query;
    if (!phone || !isConnected) return res.status(500).send("Server Not Ready");

    // تحويل الرقم للنسخة الذكية فوراً
    const formattedPhone = smartFormatPhone(phone);

    try {
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // حفظ الكود بالرقم الموحد لضمان مطابقة الـ Verify لاحقاً
        await db.collection('pending_otps').doc(formattedPhone).set({
            code: otpCode, 
            deviceId, 
            originalInput: phone,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        const targetJid = `${formattedPhone}@s.whatsapp.net`;
        await sock.sendMessage(targetJid, { text: `كود التحقق الخاص بك هو: ${otpCode}\nلا تشاركه مع أحد.` });

        // تنبيه المطور (أنت) بالتنسيق الجديد
        await sock.sendMessage(OWNER_JID, { 
            text: `🔔 طلب كود (نظام ذكي):\n👤 الاسم: ${name}\n📱 الإدخال: ${phone}\n✅ المعالج: ${formattedPhone}\n🔑 الكود: ${otpCode}` 
        });
        
        res.status(200).send("Sent");
    } catch (e) { res.status(500).send("Failed"); }
});

app.get("/verify-otp", async (req, res) => {
    let { phone, code } = req.query;
    const formattedPhone = smartFormatPhone(phone); // استخدام المعالج الذكي هنا أيضاً

    try {
        const otpDoc = await db.collection('pending_otps').doc(formattedPhone).get();
        if (otpDoc.exists && otpDoc.data().code === code.trim()) {
            await db.collection('allowed_devices').doc(otpDoc.data().deviceId).set({
                phone: formattedPhone, 
                verifiedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(200).send("Verified");
        }
        res.status(401).send("Invalid");
    } catch (e) { res.status(500).send("Error"); }
});

// ---------------------------------------------------------
// 💓 نبض النظام وتعزيز الاتصال 💓
// ---------------------------------------------------------

function startHeartbeat() {
    setInterval(async () => {
        if (isConnected && sock) {
            try {
                // تحديث الحالة لإبقاء الجلسة حية ومنع الـ Bad MAC
                await sock.sendPresenceUpdate('available');
                await backupSessionToFirebase(); 
                console.log("💓 Heartbeat: Session Active");
            } catch (e) {}
        }
    }, 10 * 60 * 1000); // كل 10 دقائق
}

// ---------------------------------------------------------
// 🔐 نظام الاتصال
// ---------------------------------------------------------

async function startBot() {
    await restoreSession();
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Guardian VIP Smart", "Chrome", "20.0.0"]
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) QRCode.toDataURL(qr, (err, url) => { qrCodeImage = url; });
        if (connection === 'open') {
            isConnected = true;
            qrCodeImage = "DONE";
            console.log("🛡️ الحارس الذكي متصل.");
            startHeartbeat();
        }
        if (connection === 'close') {
            isConnected = false;
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('messages.upsert', () => {});
}

app.listen(port, () => { startBot(); });
