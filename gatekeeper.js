// gatekeeper.js - النسخة المطورة مع نظام التحقق لكل تطبيق
const pendingPermissions = new Map();
const activeSessions = new Map();
const pendingOTP = new Map(); // أكود التحقق المؤقتة لكل تطبيق
const verifiedApps = new Map(); // التطبيقات الموثقة (صلاحية 30 يوم)
const userData = new Map(); // حفظ بيانات المستخدمين (الاسم، الرقم)

class Gatekeeper {
    constructor() {
        this.timeoutLimit = 35000;
        this.sessionDuration = 10 * 60 * 1000;
        this.otpExpiry = 5 * 60 * 1000; // 5 دقائق
        this.lastRequestJid = null;
        this.sock = null;
        this.ownerJid = null;
    }

    // تهيئة الـ Gatekeeper
    initialize(sock, ownerJid) {
        this.sock = sock;
        this.ownerJid = ownerJid;
        console.log('✅ Gatekeeper جاهز مع نظام التحقق لكل تطبيق');
    }

    // دالة لجلب الاسم من جهات الاتصال
    async getSavedName(jid) {
        try {
            if (!this.sock) return null;
            
            if (this.sock.getContactById) {
                try {
                    const contact = await this.sock.getContactById(jid);
                    if (contact?.name?.trim()) return contact.name.trim();
                    if (contact?.notify?.trim()) return contact.notify.trim();
                } catch (error) {}
            }
            
            if (this.sock.contacts && this.sock.contacts[jid]) {
                const contact = this.sock.contacts[jid];
                if (contact?.name?.trim()) return contact.name.trim();
                if (contact?.notify?.trim()) return contact.notify.trim();
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

    // حفظ بيانات المستخدم (الاسم والرقم)
    saveUserData(jid, name, phone) {
        if (!userData.has(jid)) {
            userData.set(jid, {
                name: name,
                phone: phone,
                firstSeen: new Date(),
                apps: new Map()
            });
        } else {
            const data = userData.get(jid);
            data.name = name || data.name;
            data.phone = phone || data.phone;
        }
    }

    // طلب التحقق لتطبيق معين
    async requestAppVerification(jid, pushName, appName, name, phone, deviceId) {
        // حفظ بيانات المستخدم
        this.saveUserData(jid, name, phone);
        
        const appKey = `${jid}_${appName}`;
        const now = Date.now();
        
        // التحقق إذا كان التطبيق موثق مسبقاً
        if (verifiedApps.has(appKey)) {
            const verified = verifiedApps.get(appKey);
            if (now - verified.timestamp < 30 * 24 * 60 * 60 * 1000) { // 30 يوم
                return { 
                    status: 'VERIFIED', 
                    message: 'التطبيق موثق مسبقاً',
                    appName,
                    deviceId 
                };
            }
        }
        
        // توليد كود جديد
        const otp = this.generateOTP();
        
        // تخزين الكود مع البيانات
        pendingOTP.set(appKey, {
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
        
        // إرسال الكود للمستخدم عبر الواتساب (وليس للتطبيق!)
        const userName = name || pushName || 'صديق';
        const userMsg = `🔐 *كود التحقق لتطبيق ${appName}*\n\n` +
                       `مرحباً ${userName},\n\n` +
                       `كود التحقق الخاص بك هو:\n\n` +
                       `*${otp}*\n\n` +
                       `⏰ صلاحية الكود: 5 دقائق\n` +
                       `📱 الجهاز: ${deviceId || 'غير معروف'}\n\n` +
                       `أدخل هذا الكود في التطبيق للمتابعة.`;
        
        await this.sock.sendMessage(jid, { text: userMsg });
        
        // إرسال إشعار للمالك
        const ownerMsg = `📱 *طلب تحقق تطبيق جديد*\n\n` +
                        `👤 المستخدم: ${userName}\n` +
                        `📞 الرقم: ${phone || jid.split('@')[0]}\n` +
                        `📱 التطبيق: ${appName}\n` +
                        `🆔 الجهاز: ${deviceId || 'غير معروف'}\n` +
                        `🔑 الكود: ${otp}\n\n` +
                        `⏳ في انتظار إدخال الكود من التطبيق...`;
        
        await this.sock.sendMessage(this.ownerJid, { text: ownerMsg });
        
        return { 
            status: 'OTP_SENT', 
            message: 'تم إرسال كود التحقق إلى الواتساب',
            appName 
        };
    }

    // التحقق من الكود المدخل من التطبيق
    async verifyAppOTP(jid, appName, userOTP) {
        const appKey = `${jid}_${appName}`;
        const now = Date.now();
        
        if (!pendingOTP.has(appKey)) {
            return { 
                status: 'ERROR', 
                message: 'لا يوجد طلب تحقق لهذا التطبيق أو انتهت صلاحية الكود' 
            };
        }
        
        const otpData = pendingOTP.get(appKey);
        
        // التحقق من الصلاحية
        if (now > otpData.expiry) {
            pendingOTP.delete(appKey);
            return { status: 'ERROR', message: 'انتهت صلاحية الكود' };
        }
        
        // زيادة عدد المحاولات
        otpData.attempts++;
        
        // التحقق من عدد المحاولات
        if (otpData.attempts > otpData.maxAttempts) {
            pendingOTP.delete(appKey);
            
            // إشعار المالك بالفشل
            await this.sock.sendMessage(this.ownerJid, { 
                text: `⚠️ *فشل التحقق*\n\n` +
                      `👤 المستخدم: ${otpData.name || otpData.pushName}\n` +
                      `📱 التطبيق: ${appName}\n` +
                      `❌ تجاوز الحد الأقصى للمحاولات (3 محاولات)` 
            });
            
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
        verifiedApps.set(appKey, {
            timestamp: now,
            appName: otpData.appName,
            deviceId: otpData.deviceId,
            name: otpData.name,
            phone: otpData.phone,
            jid: jid
        });
        
        // تحديث بيانات المستخدم
        if (userData.has(jid)) {
            const data = userData.get(jid);
            data.apps.set(appName, {
                verifiedAt: now,
                deviceId: otpData.deviceId
            });
        }
        
        // حذف الكود المؤقت
        pendingOTP.delete(appKey);
        
        // إرسال إشعار للمالك بالنجاح
        const ownerMsg = `✅ *تم توثيق تطبيق بنجاح*\n\n` +
                        `👤 المستخدم: ${otpData.name || otpData.pushName}\n` +
                        `📞 الرقم: ${otpData.phone || jid.split('@')[0]}\n` +
                        `📱 التطبيق: ${appName}\n` +
                        `🆔 الجهاز: ${otpData.deviceId || 'غير معروف'}\n\n` +
                        `🔓 أصبح بإمكانه استخدام التطبيق الآن.`;
        
        await this.sock.sendMessage(this.ownerJid, { text: ownerMsg });
        
        // رسالة تأكيد للمستخدم
        await this.sock.sendMessage(jid, { 
            text: `✅ *تم التحقق بنجاح!*\n\n` +
                  `تطبيق ${appName} أصبح موثقاً وجاهزاً للاستخدام.` 
        });
        
        return { 
            status: 'VERIFIED', 
            message: '✅ تم التحقق بنجاح',
            appName,
            deviceId: otpData.deviceId
        };
    }

    // التحقق من حالة التوثيق
    checkAppVerification(jid, appName) {
        const appKey = `${jid}_${appName}`;
        const now = Date.now();
        
        if (verifiedApps.has(appKey)) {
            const verified = verifiedApps.get(appKey);
            if (now - verified.timestamp < 30 * 24 * 60 * 60 * 1000) {
                return {
                    verified: true,
                    appName: appName,
                    deviceId: verified.deviceId,
                    verifiedAt: verified.timestamp
                };
            } else {
                // انتهت الصلاحية
                verifiedApps.delete(appKey);
            }
        }
        
        return { verified: false };
    }

    // الدالة الرئيسية للتحقق من الوصول
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
        const userPhone = jid.split('@')[0];
        
        // التحقق إذا كان المستخدم مسجل مسبقاً
        const userExists = userData.has(jid);
        const userInfo = userExists ? userData.get(jid) : null;
        
        // إرسال طلب الإذن للمالك
        const requestMsg = `🔔 *طلب إذن وصول*\n\n` +
                         `👤 *الاسم:* ${displayName}\n` +
                         `📞 *الرقم:* ${userPhone}\n` +
                         `📊 *الحالة:* ${savedName ? '✅ مسجل' : '⚠️ غير مسجل'}\n` +
                         `🆕 *مستخدم جديد:* ${!userExists ? 'نعم' : 'لا'}\n` +
                         `💬 *الرسالة:* "${text.length > 50 ? text.substring(0, 50) + '...' : text}"\n\n` +
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
                        text: `✅ *تم السماح*\n\n👤 ${displayName}\n📞 ${targetJid.split('@')[0]}\n⏰ لمدة 10 دقائق` 
                    }).catch(() => {});
                    
                    resolve({ status: 'PROCEED', ownerApproved: true });
                } else {
                    this.sock.sendMessage(this.ownerJid, { 
                        text: `❌ *تم المنع*\n\n👤 ${displayName}\n📞 ${targetJid.split('@')[0]}\n\nلن يتمكن من إرسال رسائل.` 
                    }).catch(() => {});
                    
                    resolve({ status: 'STOP', ownerDenied: true });
                }
                
                this.lastRequestJid = null;
                return true;
            }
        }
        
        return false;
    }

    // أوامر المطور الجديدة
    handleOwnerCommands(text) {
        const cmd = text.trim();
        
        // نجم حضر - عرض المستخدمين النشطين
        if (cmd === 'نجم حضر') {
            const activeNow = [];
            
            // المستخدمين النشطين حالياً
            for (const [jid, data] of activeSessions) {
                const remaining = this.sessionDuration - (Date.now() - data.timestamp);
                if (remaining > 0) {
                    const userName = data.userName || jid.split('@')[0];
                    const userPhone = jid.split('@')[0];
                    const minsLeft = Math.round(remaining / 60000);
                    activeNow.push(`• ${userName} (${userPhone}) - ${minsLeft}د`);
                }
            }
            
            // التطبيقات الموثقة حديثاً
            const recentApps = [];
            const now = Date.now();
            for (const [appKey, data] of verifiedApps) {
                if (now - data.timestamp < 60 * 60 * 1000) { // آخر ساعة
                    const [jid, appName] = appKey.split('_');
                    recentApps.push(`• ${data.name || 'مستخدم'} - ${appName} (${jid.split('@')[0]})`);
                }
            }
            
            let msg = `✅ *المستخدمين النشطين:*\n`;
            msg += activeNow.length ? activeNow.join('\n') : 'لا يوجد مستخدمين نشطين';
            
            if (recentApps.length > 0) {
                msg += `\n\n🆕 *تطبيقات موثقة حديثاً:*\n`;
                msg += recentApps.join('\n');
            }
            
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
            
            // إضافة المستخدمين من التطبيقات الموثقة
            verifiedApps.forEach((_, appKey) => {
                const jid = appKey.split('_')[0];
                users.add(jid);
            });
            
            const msg = `📢 *رسالة من المطور:*\n\n${message}`;
            
            users.forEach(jid => {
                this.sock.sendMessage(jid, { text: msg }).catch(() => {});
            });
            
            this.sock.sendMessage(this.ownerJid, { 
                text: `✅ تم إرسال الرسالة لـ ${users.size} مستخدم` 
            });
            return true;
        }
        
        // نجم احصا - إحصائيات كاملة
        if (cmd === 'نجم احصا') {
            const now = Date.now();
            const activeCount = Array.from(activeSessions.values())
                .filter(data => now - data.timestamp < this.sessionDuration).length;
            
            const pendingCount = pendingPermissions.size;
            const otpCount = pendingOTP.size;
            const verifiedCount = verifiedApps.size;
            const usersCount = userData.size;
            
            // إحصائيات التطبيقات
            const appsStats = new Map();
            verifiedApps.forEach((data) => {
                const app = data.appName || 'غير معروف';
                appsStats.set(app, (appsStats.get(app) || 0) + 1);
            });
            
            let appsText = '';
            appsStats.forEach((count, app) => {
                appsText += `• ${app}: ${count}\n`;
            });
            
            const msg = `📊 *إحصائيات النظام:*\n\n` +
                       `👥 *المستخدمين:*\n` +
                       `• إجمالي: ${usersCount}\n` +
                       `• نشطين حالياً: ${activeCount}\n` +
                       `• طلبات معلقة: ${pendingCount}\n\n` +
                       `📱 *التطبيقات:*\n` +
                       `• موثقة: ${verifiedCount}\n` +
                       `• أكود معلقة: ${otpCount}\n` +
                       `${appsStats.size ? '\n*حسب التطبيق:*\n' + appsText : ''}\n\n` +
                       `⏳ *وقت التشغيل:* ${Math.floor(process.uptime() / 60)} دقيقة`;
            
            this.sock.sendMessage(this.ownerJid, { text: msg });
            return true;
        }
        
        // نجم معلومات - معلومات عن مستخدم معين
        if (cmd.startsWith('نجم معلومات ')) {
            const target = cmd.substring(12);
            let found = false;
            let info = '';
            
            // البحث في بيانات المستخدمين
            for (const [jid, data] of userData) {
                if (jid.includes(target) || (data.phone && data.phone.includes(target)) || (data.name && data.name.includes(target))) {
                    info = `ℹ️ *معلومات المستخدم:*\n\n` +
                           `👤 الاسم: ${data.name || 'غير معروف'}\n` +
                           `📞 الرقم: ${data.phone || jid.split('@')[0]}\n` +
                           `🆔 JID: ${jid}\n` +
                           `📅 أول ظهور: ${data.firstSeen.toLocaleString('ar-SA')}\n\n` +
                           `📱 *التطبيقات الموثقة:*\n`;
                    
                    if (data.apps.size > 0) {
                        data.apps.forEach((appData, appName) => {
                            info += `• ${appName} - ${new Date(appData.verifiedAt).toLocaleDateString('ar-SA')}\n`;
                        });
                    } else {
                        info += 'لا يوجد تطبيقات موثقة';
                    }
                    
                    found = true;
                    break;
                }
            }
            
            // إذا ما لقينا في userData، نبحث في verifiedApps
            if (!found) {
                for (const [appKey, data] of verifiedApps) {
                    const [jid, appName] = appKey.split('_');
                    if (jid.includes(target) || (data.phone && data.phone.includes(target)) || (data.name && data.name.includes(target))) {
                        info = `ℹ️ *معلومات المستخدم:*\n\n` +
                               `👤 الاسم: ${data.name || 'غير معروف'}\n` +
                               `📞 الرقم: ${data.phone || jid.split('@')[0]}\n` +
                               `🆔 JID: ${jid}\n` +
                               `📱 التطبيق: ${appName}\n` +
                               `✅ موثق منذ: ${new Date(data.timestamp).toLocaleString('ar-SA')}`;
                        found = true;
                        break;
                    }
                }
            }
            
            if (found) {
                this.sock.sendMessage(this.ownerJid, { text: info });
            } else {
                this.sock.sendMessage(this.ownerJid, { 
                    text: `❌ لم يتم العثور على مستخدم: ${target}` 
                });
            }
            
            return true;
        }
        
        return false;
    }

    // دوال مساعدة للاستعلام
    getUserData(jid) {
        return userData.get(jid) || null;
    }
    
    getAppVerificationStatus(jid, appName) {
        return this.checkAppVerification(jid, appName);
    }
    
    getPendingOTP(jid, appName) {
        const appKey = `${jid}_${appName}`;
        if (pendingOTP.has(appKey)) {
            const data = pendingOTP.get(appKey);
            return {
                pending: true,
                expiry: new Date(data.expiry).toLocaleString('ar-SA'),
                attempts: data.attempts
            };
        }
        return { pending: false };
    }
}

// إنشاء نسخة واحدة
const gatekeeper = new Gatekeeper();
module.exports = gatekeeper;
