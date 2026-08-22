const crypto = require('crypto');
const { machineId } = require('node-machine-id');
const os = require('os');
const fs = require('fs-extra');
const path = require('path');

class SecurityService {
    constructor() {
        this.hwid = null;
        this.securityKey = null;
        this.encryptionSalt = null;
        this.scramblingMatrix = null;
        this.initialized = false;
        this.iterations = 100000;
        this.keyLength = 64;
        this.hashAlgorithm = 'sha512';
    }

    async initialize() {
        try {
            console.log('🔐 تهيئة الخدمات الأمنية المتقدمة...');
            
            // الحصول على HWID باستخدام machine-id
            this.hwid = await machineId();
            
            // توليد الملح الخاص
            this.encryptionSalt = this.generateSalt();
            
            // توليد مصفوفة الخلط الديناميكية من HWID
            this.scramblingMatrix = this.generateScramblingMatrix(this.hwid);
            
            // توليد مفتاح الأمان المشتق من HWID باستخدام PBKDF2
            this.securityKey = this.deriveKeyFromHWID(this.hwid, this.encryptionSalt, this.iterations);
            
            this.initialized = true;
            console.log('✅ تم تهيئة الخدمات الأمنية المتقدمة بنجاح');
            return true;
        } catch (error) {
            console.error('❌ فشل تهيئة الخدمات الأمنية:', error);
            throw error;
        }
    }

    /**
     * توليد ملح عشوائي
     */
    generateSalt() {
        const saltLength = 32;
        const salt = crypto.randomBytes(saltLength);
        return salt.toString('hex');
    }

    /**
     * توليد مصفوفة خلط ديناميكية من HWID
     */
    generateScramblingMatrix(hwid) {
        const matrix = new Uint8Array(256);
        const seed = hwid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        
        for (let i = 0; i < 256; i++) {
            const index = (i * 7 + seed * 13 + i * i * 3 + Math.floor(i / 7) * 11) % 256;
            matrix[i] = (i * 13 + seed * 7 + index * 5 + Math.floor(i / 3) * 17) % 256;
        }
        
        return matrix;
    }

    /**
     * اشتقاق مفتاح من HWID باستخدام PBKDF2/SHA-512
     */
    deriveKeyFromHWID(hwid, salt, iterations = 100000) {
        try {
            const saltBuffer = Buffer.from(salt, 'hex');
            const derivedKey = crypto.pbkdf2Sync(
                hwid,
                saltBuffer,
                iterations,
                this.keyLength,
                this.hashAlgorithm
            );
            return derivedKey.toString('hex');
        } catch (error) {
            console.error('❌ خطأ في اشتقاق المفتاح:', error);
            throw error;
        }
    }

    /**
     * الحصول على HWID
     */
    getHWID() {
        return this.hwid;
    }

    /**
     * تطبيق مصفوفة الخلط على البيانات
     */
    applyScrambling(data) {
        if (!this.initialized) {
            throw new Error('Security service not initialized');
        }

        const result = Buffer.alloc(data.length);
        const matrix = this.scramblingMatrix;
        
        for (let i = 0; i < data.length; i++) {
            const index = (i + matrix[i % 256] + Math.floor(i / 256) + Math.floor(i / 512) * 3) % 256;
            result[i] = data[i] ^ matrix[index];
            
            if (i > 0) {
                result[i] = (result[i] + result[i-1] + Math.floor(i / 100)) % 256;
            }
        }
        
        return result;
    }

    /**
     * عكس مصفوفة الخلط
     */
    applyReverseScrambling(data) {
        if (!this.initialized) {
            throw new Error('Security service not initialized');
        }

        const result = Buffer.alloc(data.length);
        const matrix = this.scramblingMatrix;
        
        for (let i = data.length - 1; i >= 0; i--) {
            let value = data[i];
            if (i > 0) {
                value = (value - result[i-1] - Math.floor(i / 100) + 768) % 256;
            }
            
            const index = (i + matrix[i % 256] + Math.floor(i / 256) + Math.floor(i / 512) * 3) % 256;
            result[i] = value ^ matrix[index];
        }
        
        return result;
    }

    /**
     * تطبيق XOR Shift مع المفتاح
     */
    applyXORShift(data, key) {
        const result = Buffer.alloc(data.length);
        const keyBuffer = Buffer.from(key, 'hex');
        
        for (let i = 0; i < data.length; i++) {
            const keyByte = keyBuffer[i % keyBuffer.length];
            const shift = (i * 7 + keyByte + Math.floor(i / 13) * 3) % 8;
            
            let value = data[i] ^ keyByte ^ Math.floor(i / 7);
            value = ((value << shift) | (value >> (8 - shift))) & 0xFF;
            
            result[i] = value;
        }
        
        return result;
    }

    /**
     * عكس XOR Shift
     */
    applyReverseXORShift(data, key) {
        const result = Buffer.alloc(data.length);
        const keyBuffer = Buffer.from(key, 'hex');
        
        for (let i = 0; i < data.length; i++) {
            const keyByte = keyBuffer[i % keyBuffer.length];
            const shift = (i * 7 + keyByte + Math.floor(i / 13) * 3) % 8;
            
            let value = ((data[i] >> shift) | (data[i] << (8 - shift))) & 0xFF;
            value = value ^ keyByte ^ Math.floor(i / 7);
            
            result[i] = value;
        }
        
        return result;
    }

    /**
     * تشفير البيانات باستخدام النظام المتقدم
     */
    encryptData(data) {
        if (!this.initialized) {
            throw new Error('Security service not initialized');
        }

        try {
            // تحويل البيانات إلى Buffer
            let inputBuffer;
            if (typeof data === 'string') {
                inputBuffer = Buffer.from(data, 'utf8');
            } else if (Buffer.isBuffer(data)) {
                inputBuffer = data;
            } else {
                inputBuffer = Buffer.from(JSON.stringify(data), 'utf8');
            }

            // تطبيق مصفوفة الخلط
            const scrambled = this.applyScrambling(inputBuffer);
            
            // تطبيق XOR Shift مع المفتاح
            const encrypted = this.applyXORShift(scrambled, this.securityKey);
            
            // إضافة بيانات التحقق (الملح)
            const result = Buffer.concat([
                Buffer.from(this.encryptionSalt, 'hex'),
                encrypted
            ]);
            
            return result.toString('base64');
        } catch (error) {
            console.error('❌ خطأ في التشفير:', error);
            throw error;
        }
    }

    /**
     * فك تشفير البيانات
     */
    decryptData(encryptedData) {
        if (!this.initialized) {
            throw new Error('Security service not initialized');
        }

        try {
            // فك ترميز base64
            const encryptedBuffer = Buffer.from(encryptedData, 'base64');
            
            // استخراج الملح
            const saltLength = 32;
            const salt = encryptedBuffer.slice(0, saltLength).toString('hex');
            const data = encryptedBuffer.slice(saltLength);
            
            // التحقق من صحة الملح
            if (salt !== this.encryptionSalt) {
                throw new Error('Invalid encryption salt - data may be corrupted');
            }
            
            // اشتقاق المفتاح من الملح
            const derivedKey = this.deriveKeyFromHWID(this.hwid, salt, this.iterations);
            
            // عكس XOR Shift
            const unscrambled = this.applyReverseXORShift(data, derivedKey);
            
            // عكس مصفوفة الخلط
            const decrypted = this.applyReverseScrambling(unscrambled);
            
            // تحويل النتيجة
            try {
                const strResult = decrypted.toString('utf8');
                try {
                    return JSON.parse(strResult);
                } catch {
                    return strResult;
                }
            } catch {
                return decrypted;
            }
        } catch (error) {
            console.error('❌ خطأ في فك التشفير:', error);
            throw error;
        }
    }

    /**
     * توليد توقيع للتحقق من سلامة البيانات
     */
    generateSignature(data) {
        const hash = crypto.createHash('sha512');
        hash.update(data);
        hash.update(this.securityKey);
        hash.update(this.encryptionSalt);
        return hash.digest('hex');
    }

    /**
     * التحقق من توقيع البيانات
     */
    verifySignature(data, signature) {
        const computedSignature = this.generateSignature(data);
        try {
            return crypto.timingSafeEqual(
                Buffer.from(computedSignature),
                Buffer.from(signature)
            );
        } catch {
            return false;
        }
    }

    /**
     * توليد مفتاح جلسة مؤقت
     */
    generateSessionKey() {
        const sessionData = {
            timestamp: Date.now(),
            random: crypto.randomBytes(32).toString('hex'),
            hwid: this.hwid,
            salt: this.encryptionSalt
        };
        return this.encryptData(JSON.stringify(sessionData));
    }

    /**
     * التحقق من صحة مفتاح الجلسة
     */
    verifySessionKey(sessionKey) {
        try {
            const data = this.decryptData(sessionKey);
            if (typeof data === 'string') {
                const sessionData = JSON.parse(data);
                const timeDiff = Date.now() - sessionData.timestamp;
                return timeDiff < 300000 && sessionData.hwid === this.hwid;
            }
            return false;
        } catch {
            return false;
        }
    }

    /**
     * الحصول على توقيت آمن - حماية ضد التلاعب بالتاريخ
     */
    getSecureTimestamp() {
        const sources = [
            Date.now(),
            new Date().getTime(),
            performance.now(),
            process.uptime() * 1000
        ];
        
        const sorted = sources.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        
        if (sorted.length % 2 === 0) {
            return Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
        }
        return Math.floor(sorted[mid]);
    }

    /**
     * حساب الوسيط
     */
    calculateMedian(numbers) {
        const sorted = numbers.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        
        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1] + sorted[mid]) / 2;
        }
        return sorted[mid];
    }

    /**
     * توليد معرف فريد للجلسة
     */
    generateUniqueId() {
        return crypto.randomBytes(16).toString('hex') + '-' + Date.now().toString(36);
    }
}

module.exports = { SecurityService };