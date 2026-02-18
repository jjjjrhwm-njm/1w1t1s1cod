// gatekeeper.js - النسخة المطورة مع نظام التحقق وتصحيح الأرقام الذكي
const pendingPermissions = new Map();
const activeSessions = new Map();
const pendingOTP = new Map(); // تخزين أكود التحقق المؤقتة
const verifiedApps = new Map(); // تخزين التطبيقات الموثقة

// =============================================
// 🔥 نظام كشف وتصحيح الأرقام الدولي 🔥
// =============================================
const countryCodes = {
    // دول الخليج
    'SA': { code: '966', name: 'السعودية', length: 9, pattern: /^5[0-9]{8}$/ }, // 5xxxxxxxx
    'AE': { code: '971', name: 'الإمارات', length: 9, pattern: /^5[0-9]{8}$/ },
    'KW': { code: '965', name: 'الكويت', length: 8, pattern: /^[5-9][0-9]{7}$/ },
    'QA': { code: '974', name: 'قطر', length: 8, pattern: /^3[0-9]{7}$|^6[0-9]{7}$|^7[0-9]{7}$/ },
    'BH': { code: '973', name: 'البحرين', length: 8, pattern: /^3[0-9]{7}$|^6[0-9]{7}$/ },
    'OM': { code: '968', name: 'عمان', length: 8, pattern: /^[79][0-9]{7}$/ },
    
    // دول عربية أخرى
    'EG': { code: '20', name: 'مصر', length: 10, pattern: /^1[0-2,5][0-9]{8}$/ }, // 1xxxxxxxxx
    'JO': { code: '962', name: 'الأردن', length: 9, pattern: /^7[0-9]{8}$/ },
    'PS': { code: '970', name: 'فلسطين', length: 9, pattern: /^5[0-9]{8}$|^9[0-9]{8}$/ },
    'LB': { code: '961', name: 'لبنان', length: 8, pattern: /^[37][0-9]{7}$|^81[0-9]{6}$/ },
    'SY': { code: '963', name: 'سوريا', length: 9, pattern: /^9[0-9]{8}$/ },
    'IQ': { code: '964', name: 'العراق', length: 10, pattern: /^7[0-9]{9}$/ },
    'YE': { code: '967', name: 'اليمن', length: 9, pattern: /^7[0-9]{8}$|^3[0-9]{8}$/ },
    'SD': { code: '249', name: 'السودان', length: 9, pattern: /^9[0-9]{8}$/ },
    'LY': { code: '218', name: 'ليبيا', length: 9, pattern: /^9[0-9]{8}$/ },
    'TN': { code: '216', name: 'تونس', length: 8, pattern: /^2[0-9]{7}$|^5[0-9]{7}$|^9[0-9]{7}$/ },
    'DZ': { code: '213', name: 'الجزائر', length: 9, pattern: /^5[0-9]{8}$|^6[0-9]{8}$|^7[0-9]{8}$/ },
    'MA': { code: '212', name: 'المغرب', length: 9, pattern: /^6[0-9]{8}$|^7[0-9]{8}$/ },
    'MR': { code: '222', name: 'موريتانيا', length: 8, pattern: /^[23][0-9]{7}$/ },
    'SO': { code: '252', name: 'الصومال', length: 8, pattern: /^[67][0-9]{7}$|^9[0-9]{7}$/ },
    'DJ': { code: '253', name: 'جيبوتي', length: 8, pattern: /^7[0-9]{7}$/ },
    'KM': { code: '269', name: 'جزر القمر', length: 7, pattern: /^3[0-9]{6}$|^7[0-9]{6}$/ },
    
    // دول غير عربية شائعة
    'TR': { code: '90', name: 'تركيا', length: 10, pattern: /^5[0-9]{9}$/ },
    'PK': { code: '92', name: 'باكستان', length: 10, pattern: /^3[0-9]{9}$/ },
    'IN': { code: '91', name: 'الهند', length: 10, pattern: /^[6-9][0-9]{9}$/ },
    'BD': { code: '880', name: 'بنغلاديش', length: 10, pattern: /^1[0-9]{9}$/ },
    'PH': { code: '63', name: 'الفلبين', length: 10, pattern: /^9[0-9]{9}$/ },
    'ID': { code: '62', name: 'إندونيسيا', length: 11, pattern: /^8[0-9]{10}$/ },
    'MY': { code: '60', name: 'ماليزيا', length: 10, pattern: /^1[0-9]{9}$/ },
    'TH': { code: '66', name: 'تايلاند', length: 9, pattern: /^[89][0-9]{8}$/ },
    'VN': { code: '84', name: 'فيتنام', length: 9, pattern: /^[39][0-9]{8}$|^8[0-9]{8}$/ },
    'LK': { code: '94', name: 'سريلانكا', length: 9, pattern: /^7[0-9]{8}$/ },
    'NP': { code: '977', name: 'نيبال', length: 9, pattern: /^9[0-9]{8}$/ },
    'AF': { code: '93', name: 'أفغانستان', length: 9, pattern: /^7[0-9]{8}$/ },
    'IR': { code: '98', name: 'إيران', length: 10, pattern: /^9[0-9]{9}$/ },
    'IL': { code: '972', name: 'إسرائيل', length: 9, pattern: /^5[0-9]{8}$/ },
    
    // دول أوروبية وأمريكية
    'US': { code: '1', name: 'الولايات المتحدة', length: 10, pattern: /^[2-9][0-9]{2}[2-9][0-9]{2}[0-9]{4}$/ },
    'CA': { code: '1', name: 'كندا', length: 10, pattern: /^[2-9][0-9]{2}[2-9][0-9]{2}[0-9]{4}$/ },
    'GB': { code: '44', name: 'بريطانيا', length: 10, pattern: /^7[0-9]{9}$/ },
    'FR': { code: '33', name: 'فرنسا', length: 9, pattern: /^6[0-9]{8}$|^7[0-9]{8}$/ },
    'DE': { code: '49', name: 'ألمانيا', length: 11, pattern: /^1[5-7][0-9]{9}$/ },
    'IT': { code: '39', name: 'إيطاليا', length: 10, pattern: /^3[0-9]{9}$/ },
    'ES': { code: '34', name: 'إسبانيا', length: 9, pattern: /^[67][0-9]{8}$/ },
    'NL': { code: '31', name: 'هولندا', length: 9, pattern: /^6[0-9]{8}$/ },
    'BE': { code: '32', name: 'بلجيكا', length: 9, pattern: /^4[0-9]{8}$|^3[0-9]{8}$/ },
    'CH': { code: '41', name: 'سويسرا', length: 9, pattern: /^7[0-9]{8}$/ },
    'AT': { code: '43', name: 'النمسا', length: 10, pattern: /^6[0-9]{9}$/ },
    'SE': { code: '46', name: 'السويد', length: 9, pattern: /^7[0-9]{8}$/ },
    'NO': { code: '47', name: 'النرويج', length: 8, pattern: /^[49][0-9]{7}$/ },
    'DK': { code: '45', name: 'الدنمارك', length: 8, pattern: /^[2-9][0-9]{7}$/ },
    'FI': { code: '358', name: 'فنلندا', length: 9, pattern: /^4[0-9]{8}$|^5[0-9]{8}$/ },
    'PL': { code: '48', name: 'بولندا', length: 9, pattern: /^[45][0-9]{8}$|^6[0-9]{8}$|^7[0-9]{8}$/ },
    'CZ': { code: '420', name: 'التشيك', length: 9, pattern: /^[2-9][0-9]{8}$/ },
    'HU': { code: '36', name: 'المجر', length: 9, pattern: /^[2-9][0-9]{8}$/ },
    'GR': { code: '30', name: 'اليونان', length: 10, pattern: /^6[0-9]{9}$/ },
    'PT': { code: '351', name: 'البرتغال', length: 9, pattern: /^9[0-9]{8}$/ },
    'IE': { code: '353', name: 'أيرلندا', length: 9, pattern: /^8[0-9]{8}$/ },
    'AU': { code: '61', name: 'أستراليا', length: 9, pattern: /^4[0-9]{8}$/ },
    'NZ': { code: '64', name: 'نيوزيلندا', length: 9, pattern: /^2[0-9]{8}$/ },
    'ZA': { code: '27', name: 'جنوب أفريقيا', length: 9, pattern: /^[67][0-9]{8}$|^8[0-9]{8}$/ },
    'BR': { code: '55', name: 'البرازيل', length: 11, pattern: /^[1-9][0-9]{10}$/ },
    'AR': { code: '54', name: 'الأرجنتين', length: 10, pattern: /^9[0-9]{9}$/ },
    'MX': { code: '52', name: 'المكسيك', length: 10, pattern: /^1[0-9]{9}$|^2[0-9]{9}$|^3[0-9]{9}$/ },
    'RU': { code: '7', name: 'روسيا', length: 10, pattern: /^9[0-9]{9}$/ },
    'UA': { code: '380', name: 'أوكرانيا', length: 9, pattern: /^[3-9][0-9]{8}$/ },
    'CN': { code: '86', name: 'الصين', length: 11, pattern: /^1[3-9][0-9]{9}$/ },
    'JP': { code: '81', name: 'اليابان', length: 10, pattern: /^[7-9][0-9]{9}$/ },
    'KR': { code: '82', name: 'كوريا الجنوبية', length: 10, pattern: /^1[0-9]{9}$|^2[0-9]{9}$/ },
    'SG': { code: '65', name: 'سنغافورة', length: 8, pattern: /^[89][0-9]{7}$/ }
};

class PhoneNumberDetector {
    constructor() {
        this.countryCodes = countryCodes;
    }

    // تنظيف الرقم من الرموز والمسافات
    cleanNumber(number) {
        return number.replace(/[\s\-\(\)\+]/g, '');
    }

    // كشف مفتاح الدولة من الرقم
    detectCountry(phone) {
        const cleaned = this.cleanNumber(phone);
        
        // محاولة كشف المفتاح
        for (const [country, data] of Object.entries(this.countryCodes)) {
            if (cleaned.startsWith(data.code)) {
                const withoutCode = cleaned.substring(data.code.length);
                // التحقق من طول الرقم المحلي
                if (withoutCode.length === data.length) {
                    return {
                        country: country,
                        name: data.name,
                        code: data.code,
                        localNumber: withoutCode,
                        fullNumber: data.code + withoutCode
                    };
                }
            }
        }
        
        return null;
    }

    // تصحيح الرقم تلقائياً
    autoCorrect(phone, defaultCountry = 'SA') {
        const cleaned = this.cleanNumber(phone);
        
        // 1. إذا كان الرقم يبدأ بمفتاح دولة معروف
        const detected = this.detectCountry(phone);
        if (detected) {
            return {
                success: true,
                original: phone,
                corrected: detected.fullNumber,
                country: detected.name,
                countryCode: detected.code,
                localNumber: detected.localNumber,
                message: `✅ تم التعرف على الرقم: ${detected.name}`
            };
        }
        
        // 2. إذا كان الرقم بدون مفتاح (محلي)
        // نستخدم الدولة الافتراضية (السعودية)
        const defaultData = this.countryCodes[defaultCountry];
        
        // إزالة الصفر الأول إذا وجد
        let localNumber = cleaned.startsWith('0') ? cleaned.substring(1) : cleaned;
        
        // التحقق من صحة الرقم المحلي
        if (defaultData.pattern.test(localNumber)) {
            const fullNumber = defaultData.code + localNumber;
            return {
                success: true,
                original: phone,
                corrected: fullNumber,
                country: defaultData.name,
                countryCode: defaultData.code,
                localNumber: localNumber,
                message: `✅ تم إضافة مفتاح ${defaultData.name} تلقائياً`
            };
        }
        
        // 3. محاولة البحث عن تطابق في أي دولة
        for (const [country, data] of Object.entries(this.countryCodes)) {
            // تجربة مع صفر
            let testNumber = cleaned.startsWith('0') ? cleaned.substring(1) : cleaned;
            
            if (data.pattern.test(testNumber)) {
                const fullNumber = data.code + testNumber;
                return {
                    success: true,
                    original: phone,
                    corrected: fullNumber,
                    country: data.name,
                    countryCode: data.code,
                    localNumber: testNumber,
                    message: `✅ تم التعرف على الرقم: ${data.name}`
                };
            }
        }
        
        // 4. إذا فشل كل شيء، نستخدم السعودية كافتراضي مع محاولة التصحيح
        let finalNumber = cleaned.startsWith('0') ? cleaned.substring(1) : cleaned;
        // إذا كان الرقم قصير جداً، نضيف 5 قبله (افتراض سعودي)
        if (finalNumber.length === 8) {
            finalNumber = '5' + finalNumber;
        }
        
        return {
            success: true,
            original: phone,
            corrected: '966' + finalNumber,
            country: 'السعودية (افتراضي)',
            countryCode: '966',
            localNumber: finalNumber,
            message: '⚠️ تم استخدام التنسيق الافتراضي للسعودية'
        };
    }

    // التحقق من صحة الرقم
    isValid(phone) {
        const result = this.autoCorrect(phone);
        // تحقق بسيط: الرقم يجب أن يكون 12-15 رقم بعد إضافة المفتاح
        const cleaned = this.cleanNumber(result.corrected);
        return cleaned.length >= 10 && cleaned.length <= 15;
    }

    // الحصول على معلومات الرقم
    getInfo(phone) {
        const corrected = this.autoCorrect(phone);
        return {
            original: phone,
            corrected: corrected.corrected,
            country: corrected.country,
            countryCode: corrected.countryCode,
            localNumber: corrected.localNumber,
            isValid: this.isValid(phone),
            message: corrected.message
        };
    }
}

const phoneDetector = new PhoneNumberDetector();

class Gatekeeper {
    constructor() {
        this.timeoutLimit = 35000;
        this.sessionDuration = 10 * 60 * 1000;
        this.otpExpiry = 5 * 60 * 1000; // 5 دقائق صلاحية الكود
        this.lastRequestJid = null;
        this.sock = null;
        this.ownerJid = null;
        this.aiEnabled = true; // الذكاء مفعل افتراضياً
        
        // ⚠️ السماح لرسائل OTP بدون موافقة مسبقة
        this.otpWhitelist = new Set(); // قائمة الأرقام المسموح لها باستقبال OTP
    }

    // تهيئة الـ Gatekeeper
    initialize(sock, ownerJid) {
        this.sock = sock;
        this.ownerJid = ownerJid;
        console.log('✅ Gatekeeper جاهز للعمل مع نظام التحقق وتصحيح الأرقام');
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
        
        // ✅ تصحيح الرقم تلقائياً
        const phoneInfo = phoneDetector.autoCorrect(phone);
        const correctedPhone = phoneInfo.corrected;
        
        console.log(`📱 تصحيح الرقم: ${phone} → ${correctedPhone} (${phoneInfo.country})`);
        
        // توليد كود تحقق جديد
        const otp = this.generateOTP();
        const otpKey = `${jid}_${appName}`;
        
        // تخزين الكود مع البيانات (مع الرقم المصحح)
        pendingOTP.set(otpKey, {
            otp,
            timestamp: now,
            expiry: now + this.otpExpiry,
            jid,
            pushName,
            appName,
            name,
            phone: correctedPhone, // حفظ الرقم المصحح
            originalPhone: phone,   // حفظ الرقم الأصلي للتتبع
            phoneInfo,              // حفظ معلومات الرقم
            deviceId,
            attempts: 0,
            maxAttempts: 3
        });
        
        // ⚠️ إضافة الرقم إلى قائمة المسموح لهم مؤقتاً
        this.otpWhitelist.add(jid);
        
        // إرسال الكود للمستخدم عبر الواتساب مع معلومات التصحيح
        let correctionMsg = '';
        if (phone !== correctedPhone) {
            correctionMsg = `\n\n📌 *تم تصحيح الرقم تلقائياً:*\n${phone} → ${correctedPhone} (${phoneInfo.country})`;
        }
        
        const userMsg = `🔐 *كود التحقق لتطبيق ${appName}*\n\n` +
                       `مرحباً ${name || pushName},${correctionMsg}\n\n` +
                       `كود التحقق الخاص بك هو:\n\n` +
                       `*${otp}*\n\n` +
                       `⏰ صلاحية الكود: 5 دقائق\n` +
                       `📱 الجهاز: ${deviceId}\n\n` +
                       `أدخل هذا الكود في التطبيق للمتابعة.`;
        
        await this.sock.sendMessage(jid, { text: userMsg });
        
        // إرسال إشعار للمالك مع معلومات التصحيح
        const ownerMsg = `📱 *طلب تحقق تطبيق جديد*\n\n` +
                        `👤 المستخدم: ${name || pushName}\n` +
                        `📞 الرقم المدخل: ${phone}\n` +
                        `✅ الرقم المصحح: ${correctedPhone} (${phoneInfo.country})\n` +
                        `📱 التطبيق: ${appName}\n` +
                        `🆔 الجهاز: ${deviceId}\n` +
                        `🔑 الكود: ${otp}\n\n` +
                        `⏳ في انتظار إدخال الكود من التطبيق...`;
        
        await this.sock.sendMessage(this.ownerJid, { text: ownerMsg });
        
        return { 
            status: 'OTP_SENT', 
            appName, 
            otpKey,
            correctedPhone,
            phoneInfo: {
                country: phoneInfo.country,
                countryCode: phoneInfo.countryCode
            }
        };
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
            this.otpWhitelist.delete(jid); // إزالة من القائمة بعد انتهاء المحاولات
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
            phone: otpData.phone,
            phoneInfo: otpData.phoneInfo
        });
        
        // حذف الكود المؤقت
        pendingOTP.delete(otpKey);
        
        // ⚠️ إزالة من قائمة المسموح لهم (لأنه صار موثق)
        this.otpWhitelist.delete(jid);
        
        // إرسال إشعار للمالك بالنجاح
        const ownerMsg = `✅ *تم توثيق تطبيق بنجاح*\n\n` +
                        `👤 المستخدم: ${otpData.name || otpData.pushName}\n` +
                        `📞 الرقم: ${otpData.phone} (${otpData.phoneInfo?.country || 'غير معروف'})\n` +
                        `📱 التطبيق: ${appName}\n` +
                        `🆔 الجهاز: ${otpData.deviceId}\n\n` +
                        `🔓 أصبح بإمكانه استخدام التطبيق الآن.`;
        
        await this.sock.sendMessage(this.ownerJid, { text: ownerMsg });
        
        return { 
            status: 'VERIFIED', 
            message: '✅ تم التحقق بنجاح',
            appName,
            deviceId: otpData.deviceId,
            phone: otpData.phone,
            phoneInfo: otpData.phoneInfo
        };
    }

    // دالة للتحقق من الرقم (يمكن استخدامها من التطبيق)
    async checkPhoneNumber(phone) {
        const phoneInfo = phoneDetector.getInfo(phone);
        return {
            success: phoneInfo.isValid,
            original: phoneInfo.original,
            corrected: phoneInfo.corrected,
            country: phoneInfo.country,
            countryCode: phoneInfo.countryCode,
            localNumber: phoneInfo.localNumber,
            message: phoneInfo.message
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

        // ⚠️ التحقق من وجود طلب OTP معلق
        const hasPendingOTP = Array.from(pendingOTP.keys()).some(key => key.startsWith(jid));
        
        // ⚠️ إذا كان الرقم في قائمة المسموح لهم (لأجل OTP)، نسمح بالرسالة
        if (this.otpWhitelist.has(jid) || hasPendingOTP) {
            console.log(`📱 رقم ${jid.split('@')[0]} مسموح له مؤقتاً لاستقبال OTP`);
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
                attempts: data.attempts,
                phoneInfo: data.phoneInfo
            };
        }
        return { pending: false };
    }
    
    isAppVerified(jid, appName) {
        const appKey = `${jid}_${appName}`;
        return verifiedApps.has(appKey);
    }

    // دالة للبحث عن رقم في التطبيقات الموثقة
    findAppByPhone(phone) {
        const corrected = phoneDetector.autoCorrect(phone).corrected;
        const results = [];
        
        verifiedApps.forEach((data, key) => {
            if (data.phone === corrected) {
                results.push({
                    appName: data.appName,
                    deviceId: data.deviceId,
                    name: data.name,
                    timestamp: data.timestamp,
                    phoneInfo: data.phoneInfo
                });
            }
        });
        
        return results;
    }
}

// إنشاء نسخة واحدة
const gatekeeper = new Gatekeeper();
module.exports = gatekeeper;
