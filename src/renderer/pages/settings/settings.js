class SettingsController {
    constructor() {
        this.settings = {};
        this.initialized = false;
        this.readOnlyMode = false;
        this.hwid = null;
        this.db = window.__db || null;
        this.currentTheme = 'dark';
    }

    async initialize() {
        try {
            if (!this.db) {
                this.db = new DatabaseHelper();
                await this.db.initialize();
                window.__db = this.db;
            }

            await this.checkReadOnlyMode();
            await this.loadHWID();
            await this.loadSettings();
            this.setupEventListeners();
            await this.loadSystemInfo();
            await this.loadLicenseStatus();
            this.setupToggleAnimations();
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('فشل تهيئة الإعدادات:', error);
            await window.electronAPI?.logError(error);
            return false;
        }
    }

    async checkReadOnlyMode() {
        try {
            if (this.db) {
                this.readOnlyMode = await this.db.getReadOnly();
            } else {
                this.readOnlyMode = await window.electronAPI.getReadOnly();
            }
            
            if (this.readOnlyMode) {
                document.querySelectorAll('.settings-input:not(#licenseKey), .settings-select:not(#licenseKey)').forEach(el => {
                    el.disabled = true;
                });
                document.getElementById('saveGeneralSettings').disabled = true;
                document.getElementById('createBackupBtn').disabled = true;
                document.getElementById('restoreBackupBtn').disabled = true;
                
                document.getElementById('licenseKey').disabled = false;
                document.getElementById('activateLicense').disabled = false;
            }
        } catch (error) {
            console.error('خطأ في التحقق من وضع القراءة فقط:', error);
        }
    }

    async loadHWID() {
        try {
            if (this.db) {
                this.hwid = await this.db.getHWID();
            } else {
                this.hwid = await window.electronAPI.getHWID();
            }
            const hwidDisplay = document.getElementById('hwidDisplay');
            if (hwidDisplay) {
                hwidDisplay.textContent = this.hwid || 'غير متاح';
            }
        } catch (error) {
            console.error('خطأ في تحميل HWID:', error);
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

            const auditLog = this.settings.audit_log !== 'false';
            const auditToggle = document.getElementById('auditLog');
            if (auditLog) {
                auditToggle.classList.add('active');
            } else {
                auditToggle.classList.remove('active');
            }

            const notifications = this.settings.notification_enabled !== 'false';
            const notifToggle = document.getElementById('notifications');
            if (notifications) {
                notifToggle.classList.add('active');
            } else {
                notifToggle.classList.remove('active');
            }

            const darkMode = this.settings.theme !== 'light';
            const darkToggle = document.getElementById('darkMode');
            if (darkMode) {
                darkToggle.classList.add('active');
            } else {
                darkToggle.classList.remove('active');
            }
            
            this.currentTheme = darkMode ? 'dark' : 'light';
            this.applyTheme(this.currentTheme);
        } catch (error) {
            console.error('خطأ في تحميل الإعدادات:', error);
        }
    }

    applyTheme(theme) {
        const root = document.documentElement;
        if (theme === 'dark') {
            root.style.setProperty('--primary', '#0A0A0A');
            root.style.setProperty('--secondary', '#1C1C1E');
            root.style.setProperty('--text-primary', '#F5F5F5');
            root.style.setProperty('--text-secondary', '#9BA5AF');
        } else {
            root.style.setProperty('--primary', '#F5F5F5');
            root.style.setProperty('--secondary', '#FFFFFF');
            root.style.setProperty('--text-primary', '#0A0A0A');
            root.style.setProperty('--text-secondary', '#4A4A4A');
        }
    }

    setupEventListeners() {
        document.querySelectorAll('.settings-sidebar-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.settings-sidebar-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                
                const panel = item.dataset.panel;
                document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(`panel-${panel}`).classList.add('active');
            });
        });

        const toggles = document.querySelectorAll('.settings-toggle');
        toggles.forEach(toggle => {
            if (!this.readOnlyMode) {
                toggle.addEventListener('click', function() {
                    if (!this.disabled) {
                        this.classList.toggle('active');
                    }
                });
            }
        });

        document.getElementById('saveGeneralSettings').addEventListener('click', async () => {
            if (!this.readOnlyMode) {
                await this.saveGeneralSettings();
            } else {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن حفظ الإعدادات', 'warning');
            }
        });

        document.getElementById('activateLicense').addEventListener('click', async () => {
            await this.activateLicense();
        });

        document.getElementById('createBackupBtn').addEventListener('click', async () => {
            if (!this.readOnlyMode) {
                await this.createBackup();
            } else {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن إنشاء نسخ احتياطية', 'warning');
            }
        });

        document.getElementById('restoreBackupBtn').addEventListener('click', async () => {
            if (!this.readOnlyMode) {
                await this.restoreBackup();
            } else {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن استعادة النسخ الاحتياطية', 'warning');
            }
        });

        document.getElementById('copyHwidBtn').addEventListener('click', () => {
            const hwid = document.getElementById('hwidDisplay').textContent;
            if (hwid && hwid !== 'غير متاح' && hwid !== 'جاري التحميل...') {
                navigator.clipboard.writeText(hwid).then(() => {
                    this.showToast('✅ تم نسخ معرف الجهاز', 'success');
                }).catch(() => {
                    const textarea = document.createElement('textarea');
                    textarea.value = hwid;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    this.showToast('✅ تم نسخ معرف الجهاز', 'success');
                });
            }
        });

        document.getElementById('licenseKey').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.activateLicense();
            }
        });

        document.getElementById('clearCacheBtn').addEventListener('click', async () => {
            if (confirm('⚠️ هل أنت متأكد من مسح الكاش؟ قد يؤثر ذلك على أداء التطبيق.')) {
                await this.clearCache();
            }
        });

        document.getElementById('resetSettingsBtn').addEventListener('click', async () => {
            if (confirm('⚠️ هل أنت متأكد من إعادة تعيين جميع الإعدادات إلى القيم الافتراضية؟')) {
                await this.resetSettings();
            }
        });
    }

    setupToggleAnimations() {
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
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن حفظ الإعدادات', 'warning');
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
                backup_retention: document.getElementById('backupRetention').value,
                audit_log: document.getElementById('auditLog').classList.contains('active') ? 'true' : 'false',
                notification_enabled: document.getElementById('notifications').classList.contains('active') ? 'true' : 'false',
                theme: document.getElementById('darkMode').classList.contains('active') ? 'dark' : 'light'
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
            
            this.applyTheme(settings.theme);
            this.showToast('✅ تم حفظ الإعدادات بنجاح', 'success');
        } catch (error) {
            console.error('خطأ في حفظ الإعدادات:', error);
            this.showToast('❌ حدث خطأ في حفظ الإعدادات', 'error');
        }
    }

    async loadLicenseStatus() {
        try {
            let status;
            if (this.db) {
                status = await this.db.getLicenseStatus();
            } else {
                status = await window.electronAPI.getLicenseStatus();
            }
            const statusElement = document.getElementById('licenseStatus');
            
            if (status && status.isValid) {
                if (status.isTrial) {
                    statusElement.textContent = `⏳ فترة تجريبية - متبقي ${status.daysRemaining} أيام`;
                    statusElement.className = 'value trial';
                } else {
                    statusElement.textContent = `✅ مفعل بالكامل - ينتهي في ${status.daysRemaining || 'غير محدد'} يوم`;
                    statusElement.className = 'value valid';
                }
            } else {
                if (status && status.isExpired) {
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
            const licenseKey = document.getElementById('licenseKey').value.trim();
            
            if (!licenseKey) {
                this.showToast('⚠️ الرجاء إدخال كود التفعيل', 'warning');
                document.getElementById('licenseKey').focus();
                return;
            }

            const btn = document.getElementById('activateLicense');
            const originalText = btn.textContent;
            btn.textContent = '⏳ جاري التفعيل...';
            btn.disabled = true;

            let result;
            if (this.db) {
                result = await this.db.activateLicense(licenseKey);
            } else {
                result = await window.electronAPI.activateLicense(licenseKey);
            }
            
            if (result.success) {
                this.showToast(`✅ ${result.message}`, 'success');
                await this.loadLicenseStatus();
                document.getElementById('licenseKey').value = '';
                
                if (this.db) {
                    this.readOnlyMode = await this.db.getReadOnly();
                } else {
                    this.readOnlyMode = await window.electronAPI.getReadOnly();
                }
                
                if (!this.readOnlyMode) {
                    document.querySelectorAll('.settings-input, .settings-select').forEach(el => {
                        el.disabled = false;
                    });
                    document.getElementById('saveGeneralSettings').disabled = false;
                    document.getElementById('createBackupBtn').disabled = false;
                    document.getElementById('restoreBackupBtn').disabled = false;
                }
                
                if (window.__navigation) {
                    window.__navigation.updateReadOnlyStatus(this.readOnlyMode);
                }
            } else {
                this.showToast(`❌ فشل التفعيل: ${result.message}`, 'error');
            }
            
            btn.textContent = originalText;
            btn.disabled = false;
        } catch (error) {
            console.error('خطأ في تفعيل الترخيص:', error);
            this.showToast('❌ حدث خطأ في عملية التفعيل', 'error');
            document.getElementById('activateLicense').textContent = '🚀 تفعيل';
            document.getElementById('activateLicense').disabled = false;
        }
    }

    async loadSystemInfo() {
        try {
            let systemInfo;
            if (this.db) {
                systemInfo = await this.db.getSystemInfo();
            } else {
                systemInfo = await window.electronAPI.getSystemInfo();
            }
            
            document.getElementById('appVersion').textContent = systemInfo?.version || '1.0.0';
            document.getElementById('osInfo').textContent = 
                `${systemInfo?.platform || 'غير معروف'} ${systemInfo?.arch || ''}`;

            let hwid;
            if (this.db) {
                hwid = await this.db.getHWID();
            } else {
                hwid = await window.electronAPI.getHWID();
            }
            document.getElementById('hwid').textContent = hwid || 'غير متاح';

            let dbSize;
            if (this.db) {
                dbSize = await this.getDatabaseSize();
            } else {
                dbSize = await this.getDatabaseSize();
            }
            document.getElementById('dbSize').textContent = this.formatFileSize(dbSize);

            let readOnly;
            if (this.db) {
                readOnly = await this.db.getReadOnly();
            } else {
                readOnly = await window.electronAPI.getReadOnly();
            }
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
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن إنشاء نسخ احتياطية', 'warning');
                return;
            }

            let result;
            if (this.db) {
                result = await this.db.createBackup();
            } else {
                result = await window.electronAPI.createBackup();
            }
            this.showToast(`✅ تم إنشاء النسخة الاحتياطية بنجاح\nالحجم: ${this.formatFileSize(result.size)}`, 'success');
        } catch (error) {
            console.error('خطأ في إنشاء النسخة الاحتياطية:', error);
            this.showToast('❌ حدث خطأ في إنشاء النسخة الاحتياطية', 'error');
        }
    }

    async restoreBackup() {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن استعادة النسخ الاحتياطية', 'warning');
                return;
            }

            let result;
            if (this.db) {
                result = await this.db.restoreBackup();
            } else {
                result = await window.electronAPI.restoreBackup();
            }
            if (result) {
                this.showToast('✅ تم استعادة النسخة الاحتياطية بنجاح. سيتم إعادة تشغيل التطبيق.', 'success');
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
        } catch (error) {
            console.error('خطأ في استعادة النسخة الاحتياطية:', error);
            this.showToast('❌ حدث خطأ في استعادة النسخة الاحتياطية', 'error');
        }
    }

    async clearCache() {
        try {
            localStorage.clear();
            this.showToast('✅ تم مسح الكاش بنجاح', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (error) {
            console.error('خطأ في مسح الكاش:', error);
            this.showToast('❌ حدث خطأ في مسح الكاش', 'error');
        }
    }

    async resetSettings() {
        try {
            await window.electronAPI.dbRun('DELETE FROM settings');
            await window.electronAPI.dbRun(`
                INSERT OR IGNORE INTO settings (key, value, category) VALUES 
                ('app_name', 'سديم - نظام إدارة المصانع', 'general'),
                ('app_version', '2.0.0', 'general'),
                ('company_name', '', 'general'),
                ('company_address', '', 'general'),
                ('company_phone', '', 'general'),
                ('company_email', '', 'general'),
                ('payroll_cycle', 'monthly', 'payroll'),
                ('payroll_day', '1', 'payroll'),
                ('currency_symbol', 'ج.م', 'general'),
                ('decimal_places', '2', 'general'),
                ('auto_backup', 'true', 'backup'),
                ('backup_interval', '24', 'backup'),
                ('backup_retention', '30', 'backup'),
                ('notification_enabled', 'true', 'notifications'),
                ('language', 'ar', 'general'),
                ('theme', 'dark', 'general'),
                ('audit_log', 'true', 'system')
            `);
            
            this.showToast('✅ تم إعادة تعيين الإعدادات بنجاح', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } catch (error) {
            console.error('خطأ في إعادة تعيين الإعدادات:', error);
            this.showToast('❌ حدث خطأ في إعادة تعيين الإعدادات', 'error');
        }
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) {
            const newContainer = document.createElement('div');
            newContainer.id = 'toastContainer';
            newContainer.style.cssText = 'position: fixed; bottom: 30px; right: 30px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;';
            document.body.appendChild(newContainer);
        }

        const toast = document.createElement('div');
        toast.className = `toast-message ${type}`;
        const icon = type === 'success' ? '✅' : (type === 'warning' ? '⚠️' : '❌');
        toast.textContent = `${icon} ${message}`;
        toast.style.cssText = `
            padding: 14px 24px;
            background: rgba(28, 28, 30, 0.95);
            border: 1px solid ${type === 'success' ? 'rgba(76, 175, 80, 0.3)' : type === 'warning' ? 'rgba(255, 193, 7, 0.3)' : 'rgba(255, 107, 107, 0.3)'};
            border-radius: 10px;
            color: #F5F5F5;
            font-size: 14px;
            backdrop-filter: blur(10px);
            animation: slideUp 0.4s ease;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
            max-width: 90%;
            white-space: pre-line;
        `;
        
        document.getElementById('toastContainer').appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideDown 0.4s ease forwards';
            setTimeout(() => {
                toast.remove();
            }, 400);
        }, 3000);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 بايت';
        const k = 1024;
        const sizes = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const settings = new SettingsController();
    await settings.initialize();
    window.__settings = settings;
});
