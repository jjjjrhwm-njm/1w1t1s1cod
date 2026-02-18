// gatekeeper.js - النسخة المطورة مع نظام التحقق للتطبيقات
const pendingPermissions = new Map();
const activeSessions = new Map();
const pendingOTP = new Map(); // تخزين أكود التحقق المؤقتة
const verifiedApps = new Map(); // تخزين التطبيقات الموثقة

class Gatekeeper {
    constructor() {
        this.timeoutLimit = 35000;
        this.sessionDuration = 10 * 60 * 1000;
        this.otpExpiry = 5 * 60 * 1000; // 5 دقائق صلاحية الكود
        this.lastRequestJid = null;
        this.sock = null;
        this.ownerJid = null;
        this.aiEnabled = true; // الذكاء مفعل افتراضياً
    }

    // تهيئة الـ Gatekeeper
    initialize(sock, ownerJid) {
        this.sock = sock;
        this.ownerJid = ownerJid;
        console.log('✅ Gatekeeper جاهز للعمل مع نظام التحقق');
    }

    // دالة محسنة لجلب الاسم
    async getSavedName(jid) {
        try {
            if (!this.sock) return null;
            
            if (this.sock.getContactById) {
                try {
                    const contact = await this.sock.getContactById(jid);
                    if (contact?.name?.trim()) return contact.name.trim();
                    if (contact?.notify?.trim()) return contact.notify.trim();
                    if (contact?.verifiedName?.trim()) return contact.verifiedName.trim();
                } catch (error) {}
            }
            
            if (this.sock.contacts && this.sock.contacts[jid]) {
                const contact = this.sock.contacts[jid];
                if (contact?.name?.trim()) return contact.name.trim();
                if (contact?.notify?.trim()) return contact.notify.trim();
                if (contact?.verifiedName?.trim()) return contact.verifiedName.trim();
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    // توليد كود تحقق عشوائي من 6 أرقام
    generateOTP() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    // معالجة طلب التحقق من التطبيق
    async handleAppVerification(jid, pushName, appName, name, phone, deviceId) {
        const now = Date.now();
        const appKey = `${jid}_${appName}`;
        
        // التحقق إذا كان التطبيق موثق مسبقاً
        if (verifiedApps.has(appKey)) {
            const verified = verifiedApps.get(appKey);
            if (now - verified.timestamp < 30 * 24 * 60 * 60 * 1000) { // 30 يوم
                return { status: 'VERIFIED', appName, deviceId };
            }
        }
        
        // توليد كود تحقق جديد
        const otp = this.generateOTP();
        const otpKey = `${jid}_${appName}`;
        
        // تخزين الكود مع البيانات
        pendingOTP.set(otpKey, {
            otp,
            timestamp: now,
            expiry: now + this.otpExpiry,
            jid,
            pushName,
            appName,
            name,
            phone,
            deviceId,
            attempts: 0,
            maxAttempts: 3
        });
        
        // إرسال الكود للمستخدم عبر الواتساب
        const userMsg = `🔐 *كود التحقق لتطبيق ${appName}*\n\n` +
                       `مرحباً ${name || pushName},\n\n` +
                       `كود التحقق الخاص بك هو:\n\n` +
                       `*${otp}*\n\n` +
                       `⏰ صلاحية الكود: 5 دقائق\n` +
                       `📱 الجهاز: ${deviceId}\n\n` +
                       `أدخل هذا الكود في التطبيق للمتابعة.`;
        
        await this.sock.sendMessage(jid, { text: userMsg });
        
        // إرسال إشعار للمالك
        const ownerMsg = `📱 *طلب تحقق تطبيق جديد*\n\n` +
                        `👤 المستخدم: ${name || pushName}\n` +
                        `📞 الرقم: ${phone}\n` +
                        `📱 التطبيق: ${appName}\n` +
                        `🆔 الجهاز: ${deviceId}\n` +
                        `🔑 الكود: ${otp}\n\n` +
                        `⏳ في انتظار إدخال الكود من التطبيق...`;
        
        await this.sock.sendMessage(this.ownerJid, { text: ownerMsg });
        
        return { status: 'OTP_SENT', appName, otpKey };
    }

    // التحقق من الكود المدخل من التطبيق
    async verifyOTP(jid, appName, userOTP) {
        const otpKey = `${jid}_${appName}`;
        const now = Date.now();
        
        if (!pendingOTP.has(otpKey)) {
            return { 
                status: 'ERROR', 
                message: 'لا يوجد طلب تحقق لهذا التطبيق أو انتهت صلاحية الكود' 
            };
        }
        
        const otpData = pendingOTP.get(otpKey);
        
        // التحقق من الصلاحية
        if (now > otpData.expiry) {
            pendingOTP.delete(otpKey);
            return { status: 'ERROR', message: 'انتهت صلاحية الكود' };
        }
        
        // زيادة عدد المحاولات
        otpData.attempts++;
        
        // التحقق من عدد المحاولات
        if (otpData.attempts > otpData.maxAttempts) {
            pendingOTP.delete(otpKey);
            return { status: 'ERROR', message: 'تجاوزت الحد الأقصى للمحاولات' };
        }
        
        // التحقق من الكود
        if (otpData.otp !== userOTP) {
            return { 
                status: 'ERROR', 
                message: `كود غير صحيح (المحاولة ${otpData.attempts}/${otpData.maxAttempts})` 
            };
        }
        
        // ✅ الكود صحيح - توثيق التطبيق
        const appKey = `${jid}_${appName}`;
        verifiedApps.set(appKey, {
            timestamp: now,
            appName: otpData.appName,
            deviceId: otpData.deviceId,
            name: otpData.name,
            phone: otpData.phone
        });
        
        // حذف الكود المؤقت
        pendingOTP.delete(otpKey);
        
        // إرسال إشعار للمالك بالنجاح
        const ownerMsg = `✅ *تم توثيق تطبيق بنجاح*\n\n` +
                        `👤 المستخدم: ${otpData.name || otpData.pushName}\n` +
                        `📞 الرقم: ${otpData.phone}\n` +
                        `📱 التطبيق: ${appName}\n` +
                        `🆔 الجهاز: ${otpData.deviceId}\n\n` +
                        `🔓 أصبح بإمكانه استخدام التطبيق الآن.`;
        
        await this.sock.sendMessage(this.ownerJid, { text: ownerMsg });
        
        return { 
            status: 'VERIFIED', 
            message: '✅ تم التحقق بنجاح',
            appName,
            deviceId: otpData.deviceId
        };
    }

    // الدالة الرئيسية
    async handleEverything(jid, pushName, text) {
        // تجاهل المجموعات
        if (jid.includes('@g.us')) {
            return { status: 'PROCEED' };
        }

        // إذا كانت رسالة من المالك
        if (jid === this.ownerJid) {
            // معالجة أوامر المطور
            if (this.handleOwnerCommands(text)) {
                return { status: 'STOP' };
            }
            return { status: 'PROCEED' };
        }

        // التحقق من الجلسة النشطة للمستخدم العادي
        const now = Date.now();
        if (activeSessions.has(jid)) {
            const sessionData = activeSessions.get(jid);
            if (now - sessionData.timestamp < this.sessionDuration) {
                return { status: 'PROCEED' };
            } else {
                activeSessions.delete(jid);
            }
        }

        // إذا كان هناك طلب OTP معلق لهذا المستخدم
        const hasPendingOTP = Array.from(pendingOTP.keys()).some(key => key.startsWith(jid));
        if (hasPendingOTP) {
            return { status: 'WAITING_OTP' };
        }

        // إذا كان هناك طلب إذن معلق
        if (pendingPermissions.has(jid)) {
            return { status: 'WAITING' };
        }

        // حفظ الطلب الحالي
        this.lastRequestJid = jid;
        
        // جلب الاسم الحقيقي
        const savedName = await this.getSavedName(jid);
        const displayName = savedName ? savedName : pushName || jid.split('@')[0];
        const nameStatus = savedName ? '✅ مسجل' : '⚠️ غير مسجل';
        
        // إرسال طلب الإذن للمالك
        const requestMsg = `🔔 *طلب إذن وصول*\n\n` +
                         `👤 *الاسم:* ${displayName}\n` +
                         `📊 *الحالة:* ${nameStatus}\n` +
                         `📱 *الرقم:* ${jid.split('@')[0]}\n` +
                         `💬 *الرسالة:* "${text.length > 100 ? text.substring(0, 100) + '...' : text}"\n\n` +
                         `⏰ *المدة:* 10 دقائق بعد الموافقة\n\n` +
                         `✅ *نعم* - للسماح\n` +
                         `❌ *لا* - للمنع`;

        await this.sock.sendMessage(this.ownerJid, { text: requestMsg });

        // انتظار القرار
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (pendingPermissions.has(jid)) {
                    pendingPermissions.delete(jid);
                    activeSessions.set(jid, { 
                        timestamp: Date.now(),
                        autoApproved: true 
                    });
                    resolve({ status: 'PROCEED', autoApproved: true });
                }
            }, this.timeoutLimit);

            pendingPermissions.set(jid, { 
                resolve, 
                timer,
                displayName 
            });
        });
    }

    // معالجة قرار المالك
    handleOwnerDecision(text) {
        const decision = text.trim().toLowerCase();
        
        const isYes = ['نعم', 'yes', 'y', '✅', '✔', '👍', 'موافق', 'قبول', 'ok', 'okay', 'اوك', 'ن'].includes(decision);
        const isNo = ['لا', 'no', 'n', '❌', '✖', '👎', 'رفض', 'منع', 'مرفوض', 'block', 'ل'].includes(decision);
        
        if ((isYes || isNo) && this.lastRequestJid) {
            const targetJid = this.lastRequestJid;
            
            if (pendingPermissions.has(targetJid)) {
                const { resolve, timer, displayName } = pendingPermissions.get(targetJid);
                clearTimeout(timer);
                pendingPermissions.delete(targetJid);
                
                if (isYes) {
                    activeSessions.set(targetJid, { 
                        timestamp: Date.now(),
                        approvedBy: this.ownerJid,
                        userName: displayName
                    });
                    
                    this.sock.sendMessage(this.ownerJid, { 
                        text: `✅ *تم السماح*\n\n👤 ${displayName}\n📱 ${targetJid.split('@')[0]}\n⏰ لمدة 10 دقائق` 
                    }).catch(() => {});
                    
                    resolve({ status: 'PROCEED', ownerApproved: true });
                } else {
                    this.sock.sendMessage(this.ownerJid, { 
                        text: `❌ *تم المنع*\n\n👤 ${displayName}\n📱 ${targetJid.split('@')[0]}\n\nلن يتمكن من إرسال رسائل.` 
                    }).catch(() => {});
                    
                    resolve({ status: 'STOP', ownerDenied: true });
                }
                
                this.lastRequestJid = null;
                return true;
            }
        }
        
        return false;
    }

    // معالجة أوامر المطور الجديدة
    handleOwnerCommands(text) {
        const cmd = text.trim();
        
        // أمر تشغيل/إيقاف الذكاء الاصطناعي
        if (cmd === 'نجم ذكا') {
            this.aiEnabled = true;
            this.sock.sendMessage(this.ownerJid, { 
                text: `🧠 *تم تشغيل الذكاء الاصطناعي*\n\nالآن راح يرد على الجميع.` 
            });
            return true;
        }
        
        if (cmd === 'نجم ذكا قف') {
            this.aiEnabled = false;
            this.sock.sendMessage(this.ownerJid, { 
                text: `⏸️ *تم إيقاف الذكاء الاصطناعي*\n\nالآن راح يتجاهل كل الرسائل.` 
            });
            return true;
        }
        
        // نجم حضر - عرض المستخدمين الحاضرين
        if (cmd === 'نجم حضر') {
            const activeNow = Array.from(activeSessions.entries())
                .filter(([_, data]) => Date.now() - data.timestamp < this.sessionDuration)
                .map(([jid, data]) => `• ${data.userName || jid.split('@')[0]} (${Math.round((this.sessionDuration - (Date.now() - data.timestamp)) / 60000)}د)`);
            
            const msg = `✅ *المستخدمين النشطين حالياً:*\n\n` +
                       (activeNow.length ? activeNow.join('\n') : 'لا يوجد مستخدمين نشطين');
            
            this.sock.sendMessage(this.ownerJid, { text: msg });
            return true;
        }
        
        // نجم نشر - إرسال رسالة لجميع المستخدمين
        if (cmd.startsWith('نجم نشر ')) {
            const message = cmd.substring(8);
            const users = new Set();
            
            // جمع كل المستخدمين
            activeSessions.forEach((_, jid) => users.add(jid));
            pendingPermissions.forEach((_, jid) => users.add(jid));
            
            const msg = `📢 *رسالة من المطور:*\n\n${message}`;
            
            users.forEach(jid => {
                this.sock.sendMessage(jid, { text: msg }).catch(() => {});
            });
            
            this.sock.sendMessage(this.ownerJid, { 
                text: `✅ تم إرسال الرسالة لـ ${users.size} مستخدم` 
            });
            return true;
        }
        
        // نجم احصا - عرض إحصائيات
        if (cmd === 'نجم احصا') {
            const now = Date.now();
            const activeCount = Array.from(activeSessions.values())
                .filter(data => now - data.timestamp < this.sessionDuration).length;
            
            const pendingCount = pendingPermissions.size;
            const otpCount = pendingOTP.size;
            const verifiedCount = verifiedApps.size;
            
            const msg = `📊 *إحصائيات النظام:*\n\n` +
                       `🧠 الذكاء: ${this.aiEnabled ? '🟢 مفعل' : '🔴 معطل'}\n` +
                       `🟢 مستخدمين نشطين: ${activeCount}\n` +
                       `🟡 طلبات معلقة: ${pendingCount}\n` +
                       `🔵 أكود تحقق معلقة: ${otpCount}\n` +
                       `✅ تطبيقات موثقة: ${verifiedCount}\n` +
                       `📱 مجموع المستخدمين: ${activeSessions.size}`;
            
            this.sock.sendMessage(this.ownerJid, { text: msg });
            return true;
        }
        
        // نجم معلومات - معلومات عن مستخدم معين
        if (cmd.startsWith('نجم معلومات ')) {
            const target = cmd.substring(12);
            let found = false;
            
            // البحث في الجلسات النشطة
            for (const [jid, data] of activeSessions) {
                if (jid.includes(target) || (data.userName && data.userName.includes(target))) {
                    const msg = `ℹ️ *معلومات المستخدم:*\n\n` +
                               `👤 الاسم: ${data.userName || 'غير معروف'}\n` +
                               `📱 الرقم: ${jid.split('@')[0]}\n` +
                               `⏰ آخر نشاط: ${new Date(data.timestamp).toLocaleString('ar-SA')}\n` +
                               `✅ موافقة: ${data.approvedBy ? 'يدوية' : 'تلقائية'}`;
                    
                    this.sock.sendMessage(this.ownerJid, { text: msg });
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                this.sock.sendMessage(this.ownerJid, { 
                    text: `❌ لم يتم العثور على مستخدم: ${target}` 
                });
            }
            
            return true;
        }
        
        return false;
    }
    
    // دوال مساعدة
    isAIEnabled() {
        return this.aiEnabled;
    }
    
    getSessionInfo(jid) {
        if (activeSessions.has(jid)) {
            const session = activeSessions.get(jid);
            const remaining = this.sessionDuration - (Date.now() - session.timestamp);
            return {
                active: true,
                remaining: Math.max(0, Math.round(remaining / 1000)),
                userName: session.userName
            };
        }
        return { active: false };
    }
    
    getOTPInfo(jid, appName) {
        const otpKey = `${jid}_${appName}`;
        if (pendingOTP.has(otpKey)) {
            const data = pendingOTP.get(otpKey);
            return {
                pending: true,
                expiry: new Date(data.expiry).toLocaleString('ar-SA'),
                attempts: data.attempts
            };
        }
        return { pending: false };
    }
    
    isAppVerified(jid, appName) {
        const appKey = `${jid}_${appName}`;
        return verifiedApps.has(appKey);
    }
}

// إنشاء نسخة واحدة
const gatekeeper = new Gatekeeper();
module.exports = gatekeeper;
