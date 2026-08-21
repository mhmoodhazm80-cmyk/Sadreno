class SettingsController {
    constructor() {
        this.settings = {};
        this.initialized = false;
        this.readOnlyMode = false;
    }

    async initialize() {
        try {
            await this.checkReadOnlyMode();
            await this.loadSettings();
            this.setupEventListeners();
            await this.loadSystemInfo();
            await this.loadLicenseStatus();
            this.setupToggleAnimations();
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('فشل تهيئة الإعدادات:', error);
            await window.electronAPI.logError(error);
            return false;
        }
    }

    async checkReadOnlyMode() {
        try {
            this.readOnlyMode = await window.electronAPI.getReadOnly();
            
            if (this.readOnlyMode) {
                document.querySelectorAll('.settings-input, .settings-select, .settings-toggle').forEach(el => {
                    el.disabled = true;
                });
                document.getElementById('saveGeneralSettings').disabled = true;
                document.getElementById('activateLicense').disabled = true;
                document.getElementById('createBackupBtn').disabled = true;
                document.getElementById('restoreBackupBtn').disabled = true;
            }
        } catch (error) {
            console.error('خطأ في التحقق من وضع القراءة فقط:', error);
        }
    }

    async loadSettings() {
        try {
            const result = await window.electronAPI.dbQuery('SELECT * FROM settings');
            
            for (const setting of result) {
                this.settings[setting.key] = setting.value;
            }

            document.getElementById('companyName').value = this.settings.company_name || '';
            document.getElementById('companyAddress').value = this.settings.company_address || '';
            document.getElementById('companyPhone').value = this.settings.company_phone || '';
            document.getElementById('currencySymbol').value = this.settings.currency_symbol || 'ج.م';
            document.getElementById('decimalPlaces').value = this.settings.decimal_places || '2';
            document.getElementById('payrollCycle').value = this.settings.payroll_cycle || 'monthly';
            document.getElementById('payrollDay').value = this.settings.payroll_day || '1';
            
            const autoBackup = this.settings.auto_backup === 'true';
            const toggle = document.getElementById('autoBackup');
            if (autoBackup) {
                toggle.classList.add('active');
            } else {
                toggle.classList.remove('active');
            }

            document.getElementById('backupInterval').value = this.settings.backup_interval || '24';
            document.getElementById('backupRetention').value = this.settings.backup_retention || '30';
        } catch (error) {
            console.error('خطأ في تحميل الإعدادات:', error);
        }
    }

    setupEventListeners() {
        // التبديل بين اللوحات
        document.querySelectorAll('.settings-sidebar-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.settings-sidebar-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                
                const panel = item.dataset.panel;
                document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(`panel-${panel}`).classList.add('active');
            });
        });

        // تبديل التفعيل التلقائي
        const toggle = document.getElementById('autoBackup');
        if (!this.readOnlyMode) {
            toggle.addEventListener('click', function() {
                if (!this.disabled) {
                    this.classList.toggle('active');
                }
            });
        }

        // حفظ الإعدادات العامة
        document.getElementById('saveGeneralSettings').addEventListener('click', async () => {
            if (!this.readOnlyMode) {
                await this.saveGeneralSettings();
            }
        });

        // تفعيل الترخيص
        document.getElementById('activateLicense').addEventListener('click', async () => {
            if (!this.readOnlyMode) {
                await this.activateLicense();
            }
        });

        // النسخ الاحتياطي
        document.getElementById('createBackupBtn').addEventListener('click', async () => {
            if (!this.readOnlyMode) {
                await this.createBackup();
            }
        });

        document.getElementById('restoreBackupBtn').addEventListener('click', async () => {
            if (!this.readOnlyMode) {
                await this.restoreBackup();
            }
        });

        // إدخال كود التفعيل - دعم Enter
        document.getElementById('licenseKey').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !this.readOnlyMode) {
                this.activateLicense();
            }
        });
    }

    setupToggleAnimations() {
        // تأثيرات إضافية للتبديلات
        document.querySelectorAll('.settings-toggle').forEach(toggle => {
            toggle.addEventListener('mouseenter', () => {
                toggle.style.transform = 'scale(1.05)';
            });
            
            toggle.addEventListener('mouseleave', () => {
                toggle.style.transform = 'scale(1)';
            });
        });
    }

    async saveGeneralSettings() {
        try {
            if (this.readOnlyMode) {
                alert('⚠️ وضع القراءة فقط - لا يمكن حفظ الإعدادات');
                return;
            }

            const settings = {
                company_name: document.getElementById('companyName').value,
                company_address: document.getElementById('companyAddress').value,
                company_phone: document.getElementById('companyPhone').value,
                currency_symbol: document.getElementById('currencySymbol').value,
                decimal_places: document.getElementById('decimalPlaces').value,
                payroll_cycle: document.getElementById('payrollCycle').value,
                payroll_day: document.getElementById('payrollDay').value,
                auto_backup: document.getElementById('autoBackup').classList.contains('active') ? 'true' : 'false',
                backup_interval: document.getElementById('backupInterval').value,
                backup_retention: document.getElementById('backupRetention').value
            };

            const operations = [];
            for (const [key, value] of Object.entries(settings)) {
                operations.push({
                    sql: `
                        INSERT OR REPLACE INTO settings (key, value, updated_at)
                        VALUES (?, ?, CURRENT_TIMESTAMP)
                    `,
                    params: [key, value]
                });
            }

            await window.electronAPI.dbTransaction(operations);
            
            this.settings = { ...this.settings, ...settings };
            
            this.showToast('✅ تم حفظ الإعدادات بنجاح');
        } catch (error) {
            console.error('خطأ في حفظ الإعدادات:', error);
            alert('❌ حدث خطأ في حفظ الإعدادات. يرجى المحاولة مرة أخرى.');
        }
    }

    async loadLicenseStatus() {
        try {
            const status = await window.electronAPI.getLicenseStatus();
            const statusElement = document.getElementById('licenseStatus');
            
            if (status.isValid) {
                if (status.isTrial) {
                    statusElement.textContent = `⏳ فترة تجريبية - متبقي ${status.daysRemaining} أيام`;
                    statusElement.className = 'value trial';
                } else {
                    statusElement.textContent = `✅ مفعل بالكامل - ينتهي في ${status.daysRemaining || 'غير محدد'} يوم`;
                    statusElement.className = 'value valid';
                }
            } else {
                if (status.isExpired) {
                    statusElement.textContent = '⏰ انتهت صلاحية الترخيص - يرجى التجديد';
                    statusElement.className = 'value invalid';
                } else {
                    statusElement.textContent = '🔒 غير مفعل - يرجى إدخال كود التفعيل';
                    statusElement.className = 'value invalid';
                }
            }
        } catch (error) {
            console.error('خطأ في تحميل حالة الترخيص:', error);
            const statusElement = document.getElementById('licenseStatus');
            statusElement.textContent = '⚠️ خطأ في التحقق';
            statusElement.className = 'value invalid';
        }
    }

    async activateLicense() {
        try {
            if (this.readOnlyMode) {
                alert('⚠️ وضع القراءة فقط - لا يمكن تفعيل الترخيص');
                return;
            }

            const licenseKey = document.getElementById('licenseKey').value.trim();
            
            if (!licenseKey) {
                alert('⚠️ الرجاء إدخال كود التفعيل');
                document.getElementById('licenseKey').focus();
                return;
            }

            const result = await window.electronAPI.activateLicense(licenseKey);
            
            if (result.success) {
                this.showToast(`✅ ${result.message}`);
                await this.loadLicenseStatus();
                document.getElementById('licenseKey').value = '';
                // تحديث وضع القراءة فقط
                this.readOnlyMode = await window.electronAPI.getReadOnly();
            } else {
                alert(`❌ فشل التفعيل: ${result.message}`);
            }
        } catch (error) {
            console.error('خطأ في تفعيل الترخيص:', error);
            alert('❌ حدث خطأ في عملية التفعيل. يرجى المحاولة مرة أخرى.');
        }
    }

    async loadSystemInfo() {
        try {
            const systemInfo = await window.electronAPI.getSystemInfo();
            
            document.getElementById('appVersion').textContent = systemInfo.version || '1.0.0';
            document.getElementById('osInfo').textContent = 
                `${systemInfo.platform} ${systemInfo.arch}`;

            const hwid = await window.electronAPI.getHWID();
            document.getElementById('hwid').textContent = hwid || 'غير متاح';

            const dbSize = await this.getDatabaseSize();
            document.getElementById('dbSize').textContent = this.formatFileSize(dbSize);

            const readOnly = await window.electronAPI.getReadOnly();
            document.getElementById('readOnlyStatus').textContent = readOnly ? '🔒 نعم' : '🔓 لا';
            document.getElementById('readOnlyStatus').style.color = readOnly ? '#ffc107' : '#4CAF50';
        } catch (error) {
            console.error('خطأ في تحميل معلومات النظام:', error);
        }
    }

    async getDatabaseSize() {
        try {
            const result = await window.electronAPI.dbQuery('PRAGMA page_count');
            const pageCount = result[0]?.page_count || 0;
            const pageSize = await window.electronAPI.dbQuery('PRAGMA page_size');
            const size = pageCount * (pageSize[0]?.page_size || 4096);
            return size;
        } catch (error) {
            console.error('خطأ في الحصول على حجم قاعدة البيانات:', error);
            return 0;
        }
    }

    async createBackup() {
        try {
            if (this.readOnlyMode) {
                alert('⚠️ وضع القراءة فقط - لا يمكن إنشاء نسخ احتياطية');
                return;
            }

            const result = await window.electronAPI.createBackup();
            this.showToast(`✅ تم إنشاء النسخة الاحتياطية بنجاح\nالمسار: ${result.path}\nالحجم: ${this.formatFileSize(result.size)}`);
        } catch (error) {
            console.error('خطأ في إنشاء النسخة الاحتياطية:', error);
            alert('❌ حدث خطأ في إنشاء النسخة الاحتياطية. يرجى المحاولة مرة أخرى.');
        }
    }

    async restoreBackup() {
        try {
            if (this.readOnlyMode) {
                alert('⚠️ وضع القراءة فقط - لا يمكن استعادة النسخ الاحتياطية');
                return;
            }

            const result = await window.electronAPI.restoreBackup();
            if (result) {
                this.showToast('✅ تم استعادة النسخة الاحتياطية بنجاح. سيتم إعادة تشغيل التطبيق.');
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
        } catch (error) {
            console.error('خطأ في استعادة النسخة الاحتياطية:', error);
            alert('❌ حدث خطأ في استعادة النسخة الاحتياطية. يرجى المحاولة مرة أخرى.');
        }
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            padding: 14px 24px;
            background: rgba(28, 28, 30, 0.95);
            border: 1px solid rgba(200, 213, 224, 0.1);
            border-radius: 10px;
            color: #F5F5F5;
            font-size: 14px;
            z-index: 9999;
            backdrop-filter: blur(10px);
            animation: slideUp 0.4s ease;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
            max-width: 90%;
            white-space: pre-line;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideDown 0.4s ease forwards';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 400);
        }, 4000);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 بايت';
        const k = 1024;
        const sizes = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// تشغيل الإعدادات
document.addEventListener('DOMContentLoaded', async () => {
    const settings = new SettingsController();
    await settings.initialize();
    
    window.__settings = settings;
});