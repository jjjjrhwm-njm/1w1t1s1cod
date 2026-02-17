// gatekeeper.js - النسخة المبسطة التي تعمل مباشرة
const fs = require('fs').promises;
const path = require('path');

class Gatekeeper {
    constructor() {
        this.timeoutLimit = 35000;
        this.sessionDuration = 10 * 60 * 1000;
        this.lastRequestJid = null;
        this.sock = null;
        this.ownerJid = null;
        this.contactsCache = new Map();
        this.isInitialized = false;
        
        console.log('✅ Gatekeeper تم إنشاؤه');
    }

    initialize(sock, ownerJid) {
        this.sock = sock;
        this.ownerJid = ownerJid;
        this.isInitialized = true;
        
        console.log('✅ Gatekeeper مهيأ للعمل');
        console.log(`📱 المالك: ${ownerJid}`);
        
        return true;
    }

    async getContactName(jid) {
        if (!jid) return null;
        
        try {
            const cleanJid = jid.split(':')[0];
            
            // إذا كان البوت متصل، جرب تجيب الاسم
            if (this.sock && this.sock.contacts) {
                try {
                    // جرب تجيب الاسم مباشرة
                    if (this.sock.contacts[cleanJid] && this.sock.contacts[cleanJid].name) {
                        const name = this.sock.contacts[cleanJid].name.trim();
                        if (name) {
                            this.contactsCache.set(cleanJid, name);
                            console.log(`✅ وجدت الاسم: ${name} لـ ${cleanJid}`);
                            return name;
                        }
                    }
                } catch (error) {
                    console.log('⚠️ لم أستطع جلب الاسم:', error.message);
                }
            }
            
            return null;
        } catch (error) {
            console.error('❌ خطأ في getContactName:', error.message);
            return null;
        }
    }

    async handleEverything(jid, pushName, text) {
        try {
            if (jid === this.ownerJid || jid.includes('@g.us')) {
                return { status: 'PROCEED' };
            }

            console.log(`🔐 طلب إذن من: ${pushName} (${jid})`);
            
            // في هذه النسخة، اسمح للجميع بالمرور
            return { status: 'PROCEED' };
            
        } catch (error) {
            console.error('❌ خطأ في handleEverything:', error.message);
            return { status: 'PROCEED' };
        }
    }

    handleOwnerDecision(text) {
        // في هذه النسخة، لا نحتاج هذه الدالة
        return false;
    }
    
    async getNameForResponse(jid, pushName) {
        try {
            const savedName = await this.getContactName(jid);
            
            if (savedName) {
                console.log(`👋 الرد باستخدام الاسم المحفوظ: ${savedName}`);
                return savedName;
            }
            
            console.log(`👋 الرد باستخدام الاسم الظاهر: ${pushName}`);
            return pushName || 'صديقي';
        } catch (error) {
            console.error('❌ خطأ في getNameForResponse:', error.message);
            return pushName || 'صديقي';
        }
    }
    
    // دالة بسيطة لـ "جهاتي"
    async getMyContactInfo(jid, pushName) {
        console.log(`📞 طلب معلومات لـ: ${pushName} (${jid})`);
        
        try {
            const phone = jid.split('@')[0];
            const savedName = await this.getContactName(jid);
            
            return {
                success: true,
                name: savedName || pushName,
                phone: phone,
                isRegistered: savedName ? true : false,
                messageCount: 1,
                firstSeen: 'الآن',
                lastSeen: 'الآن'
            };
        } catch (error) {
            console.error('❌ خطأ في getMyContactInfo:', error.message);
            
            return {
                success: true,
                name: pushName,
                phone: jid.split('@')[0],
                isRegistered: false,
                messageCount: 0,
                firstSeen: 'الآن',
                lastSeen: 'الآن'
            };
        }
    }
}

const gatekeeper = new Gatekeeper();
module.exports = gatekeeper;
