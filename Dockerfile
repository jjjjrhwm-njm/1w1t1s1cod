FROM node:20

# إنشاء مجلد العمل
WORKDIR /app

# نسخ ملفات الإعدادات
COPY package*.json ./

# تثبيت المكتبات
RUN npm install

# نسخ بقية الملفات
COPY . .

# فتح المنفذ (البورت)
EXPOSE 10000

# تشغيل البوت
CMD ["npm", "start"]
