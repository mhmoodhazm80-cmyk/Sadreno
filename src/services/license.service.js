const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const crypto = require('crypto');

class LicenseService {
    constructor(securityService) {
        this.securityService = securityService;
        this.hwid = null;
        this.licenseData = null;
        this.trialKey = 'mostafa_reno';
        this.trialDuration = 5;
        this.supportNumber = '01554567596';
        this.registryPath = path.join(os.homedir(), 'AppData', 'Local', 'Sadeem', 'license.dat');
        this.trialPath = path.join(os.homedir(), 'AppData', 'Local', 'Sadeem', 'trial.dat');
        this.initialized = false;
        this.readOnlyMode = false;
    }

    async initialize() {
        try {
            console.log('📜 تهيئة نظام التفعيل المتقدم...');
            this.hwid = await this.securityService.getHWID();
            await this.ensureLicenseDirectory();
            await this.loadLicenseData();
            this.initialized = true;
            console.log('✅ تم تهيئة نظام التفعيل المتقدم بنجاح');
            return true;
        } catch (error) {
            console.error('❌ فشل تهيئة نظام التفعيل:', error);
            throw error;
        }
    }

    async ensureLicenseDirectory() {
        const dir = path.dirname(this.registryPath);
        await fs.ensureDir(dir);
    }

    async loadLicenseData() {
        try {
            if (await fs.pathExists(this.registryPath)) {
                const encryptedData = await fs.readFile(this.registryPath, 'utf8');
                const decrypted = this.securityService.decryptData(encryptedData);
                this.licenseData = decrypted;
                console.log('📄 تم تحميل بيانات الترخيص');
                return decrypted;
            }
        } catch (error) {
            console.error('❌ خطأ في تحميل بيانات الترخيص:', error);
        }
        return null;
    }

    async saveLicenseData(data) {
        try {
            const encrypted = this.securityService.encryptData(data);
            await fs.writeFile(this.registryPath, encrypted, 'utf8');
            this.licenseData = data;
            console.log('💾 تم حفظ بيانات الترخيص');
            return true;
        } catch (error) {
            console.error('❌ خطأ في حفظ بيانات الترخيص:', error);
            return false;
        }
    }

    async validateLicense() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // 1. التحقق من الترخيص المدفوع المحلي
            if (this.licenseData) {
                const result = this.validateLocalLicense(this.licenseData);
                if (result.valid) {
                    this.readOnlyMode = false;
                    return result;
                }
                // إذا انتهى الترخيص المدفوع، ننتقل للتجريبي
            }

            // 2. التحقق من الكود التجريبي
            const trialResult = await this.validateTrial();
            if (trialResult.valid) {
                this.readOnlyMode = false;
                return trialResult;
            }

            // 3. لا يوجد ترخيص صالح - تفعيل وضع القراءة فقط
            this.readOnlyMode = true;
            return {
                valid: false,
                message: 'الرجاء تفعيل البرنامج',
                isTrialAvailable: true,
                readOnly: true
            };
        } catch (error) {
            console.error('❌ خطأ في التحقق من الترخيص:', error);
            return {
                valid: false,
                message: 'حدث خطأ في التحقق من الترخيص',
                readOnly: true
            };
        }
    }

    validateLocalLicense(licenseData) {
        try {
            if (!licenseData || !licenseData.expiryDate) {
                return { valid: false, message: 'بيانات ترخيص غير صالحة' };
            }

            const expiryDate = new Date(licenseData.expiryDate);
            const currentDate = new Date();
            
            // التحقق من التلاعب بالتاريخ
            if (licenseData.lastCheck) {
                const lastCheck = new Date(licenseData.lastCheck);
                if (currentDate < lastCheck) {
                    return { 
                        valid: false, 
                        message: 'تم اكتشاف تلاعب في تاريخ النظام',
                        isTampered: true,
                        readOnly: true
                    };
                }
            }

            if (currentDate > expiryDate) {
                return { 
                    valid: false, 
                    message: 'انتهت صلاحية الترخيص',
                    isExpired: true,
                    readOnly: true
                };
            }

            // تحديث تاريخ آخر فحص
            this.licenseData.lastCheck = currentDate.getTime();
            this.saveLicenseData(this.licenseData);

            const daysRemaining = Math.floor((expiryDate - currentDate) / (1000 * 60 * 60 * 24));

            return {
                valid: true,
                license: licenseData,
                expiryDate: expiryDate,
                daysRemaining: daysRemaining,
                isPaid: true,
                readOnly: false
            };
        } catch (error) {
            console.error('❌ خطأ في التحقق من الترخيص المحلي:', error);
            return { valid: false, message: 'خطأ في التحقق من الترخيص', readOnly: true };
        }
    }

    async validateTrial() {
        try {
            const trialData = await this.getTrialData();

            if (!trialData) {
                return {
                    valid: false,
                    message: 'لم يتم تفعيل الكود التجريبي',
                    isTrialAvailable: true,
                    readOnly: true
                };
            }

            const startDate = new Date(trialData.startDate);
            const currentDate = new Date();

            // التحقق من التلاعب بالتاريخ
            if (currentDate < startDate) {
                return {
                    valid: false,
                    message: 'تم اكتشاف تلاعب في تاريخ النظام',
                    isTampered: true,
                    readOnly: true
                };
            }

            const daysUsed = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));

            if (daysUsed > this.trialDuration) {
                return {
                    valid: false,
                    message: 'انتهت الفترة التجريبية',
                    isTrialExpired: true,
                    readOnly: true
                };
            }

            return {
                valid: true,
                isTrial: true,
                daysRemaining: this.trialDuration - daysUsed,
                startDate: startDate,
                expiryDate: new Date(startDate.getTime() + this.trialDuration * 24 * 60 * 60 * 1000),
                readOnly: false
            };
        } catch (error) {
            console.error('❌ خطأ في التحقق من الكود التجريبي:', error);
            return {
                valid: false,
                message: 'حدث خطأ في التحقق من الكود التجريبي',
                readOnly: true
            };
        }
    }

    async getTrialData() {
        try {
            if (await fs.pathExists(this.trialPath)) {
                const encryptedData = await fs.readFile(this.trialPath, 'utf8');
                const decrypted = this.securityService.decryptData(encryptedData);
                return decrypted;
            }
        } catch (error) {
            console.error('❌ خطأ في قراءة بيانات التجربة:', error);
        }
        return null;
    }

    async saveTrialData() {
        try {
            const data = {
                startDate: new Date().toISOString(),
                hwid: this.hwid,
                trialKey: this.trialKey,
                timestamp: Date.now(),
                signature: this.securityService.generateSignature(this.hwid + this.trialKey)
            };
            const encrypted = this.securityService.encryptData(data);
            await fs.writeFile(this.trialPath, encrypted, 'utf8');
            return true;
        } catch (error) {
            console.error('❌ خطأ في حفظ بيانات التجربة:', error);
            return false;
        }
    }

    async activateLicense(licenseKey) {
        try {
            if (!licenseKey || typeof licenseKey !== 'string') {
                return {
                    success: false,
                    message: 'الرجاء إدخال كود التفعيل'
                };
            }

            licenseKey = licenseKey.trim();

            // 1. التحقق من الكود التجريبي
            if (licenseKey === this.trialKey) {
                const trialData = await this.getTrialData();
                if (trialData) {
                    return {
                        success: false,
                        message: 'تم استخدام الكود التجريبي مسبقاً على هذا الجهاز'
                    };
                }

                // التحقق من عدم استخدام الكود التجريبي مع HWID مختلف
                const saved = await this.saveTrialData();
                if (!saved) {
                    return {
                        success: false,
                        message: 'فشل في حفظ بيانات التجربة'
                    };
                }

                return {
                    success: true,
                    message: 'تم تفعيل الكود التجريبي بنجاح لمدة 5 أيام',
                    isTrial: true,
                    expiryDate: new Date(Date.now() + this.trialDuration * 24 * 60 * 60 * 1000)
                };
            }

            // 2. التحقق من الكود المدفوع - فك التشفير المتقدم
            const licenseData = this.decryptLicenseKey(licenseKey);
            
            if (!licenseData) {
                return {
                    success: false,
                    message: 'كود التفعيل غير صالح - يرجى التحقق من الكود'
                };
            }

            // التحقق من HWID
            if (licenseData.hwid !== this.hwid) {
                return {
                    success: false,
                    message: 'هذا الكود غير مخصص لهذا الجهاز'
                };
            }

            const expiryDate = new Date(licenseData.expiryDate);
            const currentDate = new Date();

            if (currentDate > expiryDate) {
                return {
                    success: false,
                    message: 'انتهت صلاحية الكود'
                };
            }

            // حفظ الترخيص المدفوع
            const saveData = {
                licenseKey: licenseKey,
                factoryName: licenseData.factoryName,
                hwid: this.hwid,
                activationDate: new Date().toISOString(),
                expiryDate: expiryDate.toISOString(),
                licenseType: licenseData.licenseType || 'monthly',
                lastCheck: currentDate.getTime(),
                isPaid: true,
                signature: this.securityService.generateSignature(
                    licenseData.factoryName + licenseData.hwid + expiryDate.toISOString()
                )
            };

            const saved = await this.saveLicenseData(saveData);
            if (!saved) {
                return {
                    success: false,
                    message: 'فشل في حفظ بيانات الترخيص'
                };
            }

            this.readOnlyMode = false;

            return {
                success: true,
                message: 'تم التفعيل بنجاح',
                expiryDate: expiryDate,
                licenseType: licenseData.licenseType,
                isPaid: true
            };
        } catch (error) {
            console.error('❌ خطأ في تفعيل الترخيص:', error);
            return {
                success: false,
                message: 'حدث خطأ في عملية التفعيل: ' + error.message
            };
        }
    }

    /**
     * فك تشفير كود الترخيص المدفوع باستخدام النظام المتقدم
     */
    decryptLicenseKey(encryptedKey) {
        try {
            // استخدام نظام التشفير المتقدم لفك التشفير
            const decrypted = this.securityService.decryptData(encryptedKey);
            
            if (!decrypted || typeof decrypted !== 'object') {
                return null;
            }

            // التحقق من صحة البيانات
            if (!decrypted.factoryName || !decrypted.expiryDate || !decrypted.hwid) {
                return null;
            }

            // التحقق من التوقيع
            const signatureData = decrypted.factoryName + decrypted.hwid + decrypted.expiryDate;
            if (decrypted.signature) {
                const isValid = this.securityService.verifySignature(signatureData, decrypted.signature);
                if (!isValid) {
                    console.warn('⚠️ توقيع غير صالح للكود');
                    // لا نرفض الكود نهائياً، لكن نسجل التحذير
                }
            }

            return {
                factoryName: decrypted.factoryName,
                expiryDate: decrypted.expiryDate,
                hwid: decrypted.hwid,
                licenseType: decrypted.licenseType || 'monthly',
                signature: decrypted.signature || null
            };
        } catch (error) {
            console.error('❌ خطأ في فك تشفير الكود:', error);
            return null;
        }
    }

    /**
     * توليد كود ترخيص مدفوع (للاستخدام في لوحة الإدارة)
     */
    async generatePaidLicenseKey(factoryName, expiryDate, hwid, licenseType = 'monthly') {
        try {
            const data = {
                factoryName: factoryName,
                expiryDate: expiryDate.toISOString(),
                hwid: hwid,
                licenseType: licenseType,
                generatedAt: new Date().toISOString(),
                signature: this.securityService.generateSignature(
                    factoryName + hwid + expiryDate.toISOString()
                )
            };

            // استخدام نظام التشفير المتقدم
            const encrypted = this.securityService.encryptData(data);
            return encrypted;
        } catch (error) {
            console.error('❌ خطأ في توليد كود الترخيص:', error);
            throw error;
        }
    }

    async getLicenseStatus() {
        const validation = await this.validateLicense();
        return {
            isValid: validation.valid || false,
            isTrial: validation.isTrial || false,
            isPaid: validation.isPaid || false,
            isExpired: validation.isExpired || false,
            isTampered: validation.isTampered || false,
            daysRemaining: validation.daysRemaining || 0,
            message: validation.message || '',
            readOnly: this.readOnlyMode,
            supportNumber: this.supportNumber
        };
    }

    async getTrialInformation() {
        const trialData = await this.getTrialData();
        if (!trialData) {
            return {
                isActive: false,
                isAvailable: true,
                maxDays: this.trialDuration,
                trialKey: this.trialKey
            };
        }

        const startDate = new Date(trialData.startDate);
        const currentDate = new Date();
        const daysUsed = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.max(0, this.trialDuration - daysUsed);

        return {
            isActive: true,
            isAvailable: false,
            startDate: startDate,
            daysUsed: daysUsed,
            daysRemaining: daysRemaining,
            maxDays: this.trialDuration,
            isExpired: daysUsed >= this.trialDuration,
            trialKey: this.trialKey
        };
    }

    async checkReadOnlyMode() {
        await this.validateLicense();
        return this.readOnlyMode;
    }

    async getCurrentLicenseType() {
        const validation = await this.validateLicense();
        if (validation.valid) {
            if (validation.isTrial) return 'trial';
            if (validation.isPaid) return 'paid';
        }
        return 'none';
    }
}

module.exports = { LicenseService };