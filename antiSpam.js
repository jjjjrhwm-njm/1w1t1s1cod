// نظام الحماية المتقدم ضد السبام
class IntelligentAntiSpam {
    constructor() {
        this.userActivity = new Map();
        this.groupActivity = new Map();
        this.messagePatterns = new Map();
        this.suspiciousUsers = new Set();
        this.temporaryBans = new Map();
        this.learningThreshold = 5;
        
        // أنماط الرسائل المزعجة
        this.spamPatterns = [
            /(.)\1{5,}/, // حروف مكررة
            /[A-Z]{5,}/, // أحرف إنجليزية كبيرة
            /\d{8,}/, // أرقام طويلة
            /(http|www\.)/, // روابط
            /[\u0600-\u06FF]{20,}/ // عربية طويلة جداً
        ];
    }

    isSpamming(jid, message) {
        const now = Date.now();
        
        // تهيئة بيانات المستخدم
        if (!this.userActivity.has(jid)) {
            this.userActivity.set(jid, {
                messages: [],
                lastMessage: now,
                warningCount: 0,
                isSuspicious: false
            });
        }
        
        const userData = this.userActivity.get(jid);
        
        // التحقق من الحظر المؤقت
        if (this.temporaryBans.has(jid)) {
            const banUntil = this.temporaryBans.get(jid);
            if (now < banUntil) {
                return true; // لا يزال محظوراً
            } else {
                this.temporaryBans.delete(jid);
            }
        }
        
        // تحليل النمط
        const isPatternSpam = this.checkMessagePattern(message);
        const isRateSpam = this.checkMessageRate(jid, now);
        const isContentSpam = this.checkContentSpam(message);
        
        // إذا كان هناك اشتباه
        if (isPatternSpam || isRateSpam || isContentSpam) {
            userData.warningCount++;
            
            // إذا تجاوز العتبة
            if (userData.warningCount >= this.learningThreshold) {
                userData.isSuspicious = true;
                this.suspiciousUsers.add(jid);
                
                // حظر مؤقت (5 دقائق)
                this.temporaryBans.set(jid, now + 5 * 60 * 1000);
                
                // إعادة تعيين العد
                userData.warningCount = 0;
                
                return true;
            }
        } else {
            // تقليل العد إذا كان السلوك طبيعياً
            if (userData.warningCount > 0) {
                userData.warningCount--;
            }
        }
        
        // تحديث آخر رسالة
        userData.lastMessage = now;
        userData.messages.push({
            time: now,
            content: message.substring(0, 50) // حفظ جزء فقط
        });
        
        // الاحتفاظ بآخر 20 رسالة فقط
        if (userData.messages.length > 20) {
            userData.messages = userData.messages.slice(-20);
        }
        
        return false;
    }

    checkMessagePattern(message) {
        // التحقق من الأنماط المعروفة للسبام
        for (const pattern of this.spamPatterns) {
            if (pattern.test(message)) {
                return true;
            }
        }
        
        // التحقق من الرسائل المتطابقة المتكررة
        if (this.messagePatterns.has(message)) {
            const count = this.messagePatterns.get(message) + 1;
            this.messagePatterns.set(message, count);
            
            if (count > 3) { // نفس الرسالة أكثر من 3 مرات
                return true;
            }
        } else {
            this.messagePatterns.set(message, 1);
        }
        
        // تنظيف الأنماط القديمة
        if (this.messagePatterns.size > 1000) {
            const keys = Array.from(this.messagePatterns.keys()).slice(0, 500);
            keys.forEach(key => this.messagePatterns.delete(key));
        }
        
        return false;
    }

    checkMessageRate(jid, now) {
        const userData = this.userActivity.get(jid);
        
        if (!userData.messages.length) {
            return false;
        }
        
        // حساب معدل الرسائل في آخر 10 ثواني
        const tenSecondsAgo = now - 10000;
        const recentMessages = userData.messages.filter(msg => msg.time > tenSecondsAgo);
        
        // إذا أرسل أكثر من 5 رسائل في 10 ثواني
        if (recentMessages.length > 5) {
            return true;
        }
        
        // إذا كانت الفترة بين الرسائل أقل من 500 مللي ثانية
        if (userData.messages.length >= 2) {
            const lastTwo = userData.messages.slice(-2);
            const timeDiff = lastTwo[1].time - lastTwo[0].time;
            
            if (timeDiff < 500) { // أقل من نصف ثانية
                return true;
            }
        }
        
        return false;
    }

    checkContentSpam(message) {
        const msgLower = message.toLowerCase();
        
        // كلمات ممنوعة أو مشبوهة
        const suspiciousWords = [
            'سبام', 'إعلان', 'ترويج', 'عرض', 'خصم',
            'مجانا', 'free', 'win', 'winner', 'prize',
            'كسب', 'ربح', 'سحب', 'جائزة', 'مسابقة'
        ];
        
        // إذا كانت الرسالة قصيرة جداً ومتكررة
        if (message.length < 3 && this.messagePatterns.has(message)) {
            return true;
        }
        
        // إذا احتوت على كلمات مشبوهة
        for (const word of suspiciousWords) {
            if (msgLower.includes(word)) {
                return true;
            }
        }
        
        // إذا كانت معظم الرسائل أحرف أو رموز
        const charRatio = message.replace(/[\s\u0600-\u06FF]/g, '').length / message.length;
        if (charRatio > 0.8 && message.length > 10) {
            return true;
        }
        
        return false;
    }

    // دالة لتخفيف الحماية للمستخدمين الموثوقين
    whitelistUser(jid) {
        if (this.userActivity.has(jid)) {
            const userData = this.userActivity.get(jid);
            userData.isSuspicious = false;
            userData.warningCount = 0;
        }
        
        this.suspiciousUsers.delete(jid);
        this.temporaryBans.delete(jid);
    }

    // الحصول على تقرير عن المستخدم
    getUserReport(jid) {
        if (!this.userActivity.has(jid)) {
            return 'لا توجد بيانات عن هذا المستخدم';
        }
        
        const userData = this.userActivity.get(jid);
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        
        const recentMessages = userData.messages.filter(msg => msg.time > oneMinuteAgo);
        
        return {
            totalMessages: userData.messages.length,
            recentMessages: recentMessages.length,
            warningCount: userData.warningCount,
            isSuspicious: userData.isSuspicious,
            isBanned: this.temporaryBans.has(jid),
            banRemaining: this.temporaryBans.has(jid) 
                ? Math.ceil((this.temporaryBans.get(jid) - now) / 1000) 
                : 0
        };
    }

    // تنظيف البيانات القديمة
    cleanupOldData() {
        const now = Date.now();
        const oneHourAgo = now - 3600000;
        
        // تنظيف بيانات المستخدمين غير النشطين
        this.userActivity.forEach((data, jid) => {
            if (data.lastMessage < oneHourAgo && !data.isSuspicious) {
                this.userActivity.delete(jid);
            }
        });
        
        // تنظيف الأنماط القديمة
        if (this.messagePatterns.size > 2000) {
            const halfSize = Math.floor(this.messagePatterns.size / 2);
            const keys = Array.from(this.messagePatterns.keys()).slice(0, halfSize);
            keys.forEach(key => this.messagePatterns.delete(key));
        }
    }
}

// إنشاء نسخة واحدة
const intelligentAntiSpam = new IntelligentAntiSpam();

// دالة رئيسية للتوافق
function isSpamming(jid, message = '') {
    return intelligentAntiSpam.isSpamming(jid, message);
}

module.exports = { 
    isSpamming,
    intelligentAntiSpam  // للاستخدام المتقدم
};
