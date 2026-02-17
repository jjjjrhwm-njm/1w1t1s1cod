const fs = require('fs');
const path = require('path');

class HistoryManager {
    constructor() {
        this.historyDir = './conversation_history';
        this.init();
    }

    init() {
        if (!fs.existsSync(this.historyDir)) {
            fs.mkdirSync(this.historyDir, { recursive: true });
        }
    }

    saveConversation(jid, userMessage, botResponse) {
        const historyFile = path.join(this.historyDir, `${jid.replace(/[@\.]/g, '_')}.json`);
        
        let history = [];
        if (fs.existsSync(historyFile)) {
            history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        }
        
        history.push({
            timestamp: new Date().toISOString(),
            user: userMessage,
            bot: botResponse
        });
        
        // الاحتفاظ بآخر 100 محادثة فقط
        if (history.length > 100) {
            history = history.slice(-100);
        }
        
        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
    }

    getConversationHistory(jid, limit = 10) {
        const historyFile = path.join(this.historyDir, `${jid.replace(/[@\.]/g, '_')}.json`);
        
        if (!fs.existsSync(historyFile)) {
            return [];
        }
        
        const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        return history.slice(-limit);
    }

    clearHistory(jid) {
        const historyFile = path.join(this.historyDir, `${jid.replace(/[@\.]/g, '_')}.json`);
        
        if (fs.existsSync(historyFile)) {
            fs.unlinkSync(historyFile);
            return true;
        }
        
        return false;
    }
}

module.exports = new HistoryManager();
