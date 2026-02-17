class PersonalityEngine {
    constructor() {
        this.personalityTraits = {
            formality: 0.5, // 0 = casual, 1 = formal
            humor: 0.3,    // 0 = serious, 1 = humorous
            empathy: 0.7,  // 0 = logical, 1 = emotional
            brevity: 0.6,  // 0 = detailed, 1 = concise
            creativity: 0.4 // 0 = predictable, 1 = creative
        };
    }

    analyzeMood(text) {
        const textLower = text.toLowerCase();
        
        const moodIndicators = {
            happy: ['😂', '😄', '🤣', 'فرح', 'سعيد', 'مرح'],
            sad: ['😢', '😔', '💔', 'حزين', 'تعبان', 'زعلان'],
            angry: ['😠', '👿', 'غاضب', 'منزعج'],
            excited: ['🤩', '🎉', 'واو', 'متحمس'],
            neutral: ['👌', 'تمام', 'طيب', 'حلو']
        };
        
        for (const [mood, indicators] of Object.entries(moodIndicators)) {
            if (indicators.some(indicator => textLower.includes(indicator))) {
                return mood;
            }
        }
        
        return 'neutral';
    }

    getResponseStyle(mood) {
        const styles = {
            happy: {
                formality: 0.3,
                humor: 0.7,
                empathy: 0.6,
                brevity: 0.5,
                creativity: 0.6
            },
            sad: {
                formality: 0.4,
                humor: 0.1,
                empathy: 0.9,
                brevity: 0.3,
                creativity: 0.4
            },
            angry: {
                formality: 0.6,
                humor: 0.1,
                empathy: 0.8,
                brevity: 0.7,
                creativity: 0.3
            },
            excited: {
                formality: 0.2,
                humor: 0.6,
                empathy: 0.7,
                brevity: 0.4,
                creativity: 0.7
            },
            neutral: {
                formality: 0.5,
                humor: 0.3,
                empathy: 0.5,
                brevity: 0.6,
                creativity: 0.4
            }
        };
        
        return styles[mood] || styles.neutral;
    }

    adjustPersonality(mood, conversationLength) {
        const style = this.getResponseStyle(mood);
        
        // تعديل حسب طول المحادثة
        if (conversationLength > 10) {
            style.formality *= 0.8; // أقل رسمية مع الوقت
            style.humor *= 1.2;     // أكثر مرحاً
        }
        
        return style;
    }
}

module.exports = new PersonalityEngine();
