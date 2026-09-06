// src/services/advanced-encryption.service.js

const crypto = require('crypto');
const { machineId } = require('node-machine-id');

class AdvancedEncryptionService {
    constructor() {
        this.hwid = null;
        this.masterSalt = 'SADEEM_MASTER_SALT_2024_SECURE';
        this.iterationCount = 100000;
        this.keyLength = 64;
        this.algorithm = 'aes-256-gcm';
        this.initialized = false;
        this.encryptionKey = null;
    }

    async initialize() {
        try {
            this.hwid = await machineId();
            this.encryptionKey = this.deriveMasterKey(this.hwid);
            this.initialized = true;
            console.log('✅ تم تهيئة نظام التشفير المتقدم');
            return true;
        } catch (error) {
            console.error('❌ فشل تهيئة نظام التشفير:', error);
            throw error;
        }
    }

    deriveMasterKey(hwid) {
        try {
            const salt = this.masterSalt + hwid;
            const key = crypto.pbkdf2Sync(
                hwid,
                salt,
                this.iterationCount,
                this.keyLength,
                'sha512'
            );
            return key.toString('hex');
        } catch (error) {
            console.error('❌ خطأ في اشتقاق المفتاح الرئيسي:', error);
            throw error;
        }
    }

    deriveSessionKey(hwid, timestamp) {
        try {
            const data = hwid + timestamp + this.masterSalt;
            const hash = crypto.createHash('sha512');
            hash.update(data);
            return hash.digest('hex').slice(0, 64);
        } catch (error) {
            console.error('❌ خطأ في اشتقاق مفتاح الجلسة:', error);
            throw error;
        }
    }

    generateLicenseKey(data) {
        try {
            const {
                factoryName,
                hwid,
                months,
                startDate,
                endDate,
                licenseType = 'monthly'
            } = data;

            if (!factoryName || !hwid || !months) {
                throw new Error('بيانات الترخيص غير مكتملة');
            }

            const start = startDate ? new Date(startDate) : new Date();
            const end = endDate ? new Date(endDate) : new Date(start);
            if (!endDate) {
                end.setMonth(end.getMonth() + months);
            }

            // توليد معرف فريد للكود
            const uniqueId = crypto.randomBytes(16).toString('hex');
            const timestamp = Date.now();

            const licenseData = {
                factoryName: factoryName,
                hwid: hwid,
                months: months,
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                licenseType: licenseType,
                generatedAt: new Date().toISOString(),
                uniqueId: uniqueId,
                timestamp: timestamp,
                version: '3.0'
            };

            // تشفير البيانات
            const sessionKey = this.deriveSessionKey(hwid, timestamp);
            const encrypted = this.encryptData(licenseData, sessionKey);
            const signature = this.generateSignature(encrypted, hwid);
            
            const finalKey = {
                data: encrypted,
                signature: signature,
                hwid: hwid,
                timestamp: timestamp,
                version: '3.0'
            };

            return Buffer.from(JSON.stringify(finalKey)).toString('base64');
        } catch (error) {
            console.error('❌ خطأ في توليد كود الترخيص:', error);
            throw error;
        }
    }

    verifyLicenseKey(licenseKey, deviceHWID = null) {
        try {
            const decoded = Buffer.from(licenseKey, 'base64').toString('utf8');
            const keyData = JSON.parse(decoded);

            if (keyData.version !== '3.0') {
                return { valid: false, message: 'إصدار غير مدعوم' };
            }

            const hwid = deviceHWID || this.hwid;
            if (keyData.hwid !== hwid) {
                return { valid: false, message: 'هذا الكود غير مخصص لهذا الجهاز' };
            }

            const isValidSignature = this.verifySignature(keyData.data, keyData.signature, hwid);
            if (!isValidSignature) {
                return { valid: false, message: 'توقيع غير صالح - الكود معدل' };
            }

            const sessionKey = this.deriveSessionKey(hwid, keyData.timestamp);
            const decrypted = this.decryptData(keyData.data, sessionKey);

            const endDate = new Date(decrypted.endDate);
            const currentDate = new Date();

            if (currentDate > endDate) {
                return {
                    valid: false,
                    message: 'انتهت صلاحية الترخيص',
                    expired: true,
                    data: decrypted
                };
            }

            return {
                valid: true,
                message: 'كود التفعيل صالح',
                data: decrypted,
                daysRemaining: Math.floor((endDate - currentDate) / (1000 * 60 * 60 * 24))
            };
        } catch (error) {
            console.error('❌ خطأ في التحقق من كود الترخيص:', error);
            return { valid: false, message: 'كود التفعيل غير صالح' };
        }
    }

    encryptData(data, customKey = null) {
        if (!this.initialized) {
            throw new Error('نظام التشفير غير مهيأ');
        }

        try {
            const key = customKey || this.encryptionKey;
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(this.algorithm, Buffer.from(key, 'hex'), iv);
            
            const jsonData = typeof data === 'string' ? data : JSON.stringify(data);
            let encrypted = cipher.update(jsonData, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag().toString('hex');
            
            return {
                encrypted: encrypted,
                iv: iv.toString('hex'),
                authTag: authTag,
                timestamp: Date.now(),
                hwid: this.hwid
            };
        } catch (error) {
            console.error('❌ خطأ في تشفير البيانات:', error);
            throw error;
        }
    }

    decryptData(encryptedData, customKey = null) {
        if (!this.initialized) {
            throw new Error('نظام التشفير غير مهيأ');
        }

        try {
            const key = customKey || this.encryptionKey;
            const decipher = crypto.createDecipheriv(
                this.algorithm,
                Buffer.from(key, 'hex'),
                Buffer.from(encryptedData.iv, 'hex')
            );
            decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
            
            let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            try {
                return JSON.parse(decrypted);
            } catch {
                return decrypted;
            }
        } catch (error) {
            console.error('❌ خطأ في فك تشفير البيانات:', error);
            throw error;
        }
    }

    generateSignature(data, hwid) {
        try {
            const hash = crypto.createHash('sha512');
            hash.update(JSON.stringify(data));
            hash.update(hwid);
            hash.update(this.masterSalt);
            hash.update(data.timestamp.toString());
            return hash.digest('hex');
        } catch (error) {
            console.error('❌ خطأ في توليد التوقيع:', error);
            throw error;
        }
    }

    verifySignature(data, signature, hwid) {
        try {
            const computedSignature = this.generateSignature(data, hwid);
            return crypto.timingSafeEqual(
                Buffer.from(computedSignature),
                Buffer.from(signature)
            );
        } catch (error) {
            console.error('❌ خطأ في التحقق من التوقيع:', error);
            return false;
        }
    }

    getHWID() {
        return this.hwid;
    }

    getRemainingDays(licenseKey) {
        try {
            const result = this.verifyLicenseKey(licenseKey);
            if (result.valid) {
                return result.daysRemaining;
            }
            return 0;
        } catch {
            return 0;
        }
    }

    isLicenseExpired(licenseKey) {
        try {
            const result = this.verifyLicenseKey(licenseKey);
            return !result.valid && result.expired;
        } catch {
            return true;
        }
    }

    generateUniqueKey() {
        return crypto.randomBytes(32).toString('hex');
    }
}

module.exports = { AdvancedEncryptionService };
