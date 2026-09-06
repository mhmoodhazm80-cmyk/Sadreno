const { contextBridge, ipcRenderer } = require('electron');

const validChannels = [
    'window:minimize',
    'window:maximize',
    'window:close',
    'window:isMaximized',
    'navigation:navigate',
    'navigation:back',
    'navigation:getCurrentPage',
    'license:validate',
    'license:activate',
    'license:getStatus',
    'license:getTrialInfo',
    'license:generateKey',
    'license:verifyKey',
    'license:getRemainingDays',
    'license:isExpired',
    'license:getHWID',
    'db:query',
    'db:run',
    'db:transaction',
    'import:word',
    'import:excel',
    'export:pdf',
    'export:excel',
    'backup:create',
    'backup:restore',
    'system:getInfo',
    'system:getHWID',
    'system:getReadOnly',
    'audit:log',
    'audit:getLogs',
    'error:log',
    'splash:complete'
];

const validListenChannels = [
    'app:readonly-mode',
    'app:license-status',
    'system:theme-change',
    'db:update',
    'app:update-data',
    'license-status',
    'navigation:changed'
];

contextBridge.exposeInMainWorld('electronAPI', {
    // التحكم في النافذة
    minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
    closeWindow: () => ipcRenderer.invoke('window:close'),
    isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    
    // نظام التنقل
    navigate: (page) => ipcRenderer.invoke('navigation:navigate', page),
    navigateBack: () => ipcRenderer.invoke('navigation:back'),
    getCurrentPage: () => ipcRenderer.invoke('navigation:getCurrentPage'),
    
    // نظام التفعيل والترخيص
    validateLicense: () => ipcRenderer.invoke('license:validate'),
    activateLicense: (licenseKey) => {
        if (typeof licenseKey !== 'string' || !licenseKey.trim()) {
            throw new Error('مفتاح الترخيص مطلوب');
        }
        return ipcRenderer.invoke('license:activate', licenseKey.trim());
    },
    getLicenseStatus: () => ipcRenderer.invoke('license:getStatus'),
    getTrialInfo: () => ipcRenderer.invoke('license:getTrialInfo'),
    
    // توليد والتحقق من الأكواد
    generateLicenseKey: (data) => ipcRenderer.invoke('license:generateKey', data),
    verifyLicenseKey: (licenseKey, deviceHWID) => ipcRenderer.invoke('license:verifyKey', licenseKey, deviceHWID),
    getLicenseRemainingDays: (licenseKey) => ipcRenderer.invoke('license:getRemainingDays', licenseKey),
    isLicenseExpired: (licenseKey) => ipcRenderer.invoke('license:isExpired', licenseKey),
    getHWID: () => ipcRenderer.invoke('license:getHWID'),
    
    // عمليات قاعدة البيانات
    dbQuery: (sql, params = []) => {
        if (typeof sql !== 'string' || !sql.trim()) {
            throw new Error('استعلام SQL مطلوب');
        }
        if (!Array.isArray(params)) {
            throw new Error('يجب أن تكون المعلمات مصفوفة');
        }
        return ipcRenderer.invoke('db:query', sql, params);
    },
    dbRun: (sql, params = []) => {
        if (typeof sql !== 'string' || !sql.trim()) {
            throw new Error('استعلام SQL مطلوب');
        }
        if (!Array.isArray(params)) {
            throw new Error('يجب أن تكون المعلمات مصفوفة');
        }
        return ipcRenderer.invoke('db:run', sql, params);
    },
    dbTransaction: (operations) => {
        if (!Array.isArray(operations) || operations.length === 0) {
            throw new Error('يجب توفير عمليات المعاملة');
        }
        for (const op of operations) {
            if (!op.sql || typeof op.sql !== 'string') {
                throw new Error('كل عملية يجب أن تحتوي على استعلام SQL صحيح');
            }
        }
        return ipcRenderer.invoke('db:transaction', operations);
    },
    
    // استيراد وتصدير
    importWord: (filePath) => {
        if (!filePath || typeof filePath !== 'string') {
            throw new Error('مسار الملف مطلوب');
        }
        return ipcRenderer.invoke('import:word', filePath);
    },
    importExcel: (filePath) => {
        if (!filePath || typeof filePath !== 'string') {
            throw new Error('مسار الملف مطلوب');
        }
        return ipcRenderer.invoke('import:excel', filePath);
    },
    exportPDF: (data, options = {}) => {
        if (!data || !Array.isArray(data)) {
            throw new Error('يجب توفير بيانات للتصدير');
        }
        return ipcRenderer.invoke('export:pdf', data, options);
    },
    exportExcel: (data, options = {}) => {
        if (!data || !Array.isArray(data)) {
            throw new Error('يجب توفير بيانات للتصدير');
        }
        return ipcRenderer.invoke('export:excel', data, options);
    },
    
    // النسخ الاحتياطي
    createBackup: () => ipcRenderer.invoke('backup:create'),
    restoreBackup: (backupPath) => {
        if (typeof backupPath !== 'string' || !backupPath.trim()) {
            throw new Error('مسار النسخة الاحتياطية مطلوب');
        }
        return ipcRenderer.invoke('backup:restore', backupPath);
    },
    
    // معلومات النظام
    getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),
    getHWID: () => ipcRenderer.invoke('system:getHWID'),
    getReadOnly: () => ipcRenderer.invoke('system:getReadOnly'),
    
    // سجل العمليات
    auditLog: (action, target, details) => {
        return ipcRenderer.invoke('audit:log', action, target, details);
    },
    getAuditLogs: (limit = 50) => {
        return ipcRenderer.invoke('audit:getLogs', limit);
    },
    
    // تسجيل الأخطاء
    logError: (error) => {
        const errorObj = {
            message: error.message || String(error),
            stack: error.stack || '',
            timestamp: new Date().toISOString()
        };
        return ipcRenderer.invoke('error:log', errorObj);
    },
    
    // أحداث شاشة البداية
    splashComplete: () => ipcRenderer.invoke('splash:complete'),
    
    // الاستماع للأحداث
    on: (channel, callback) => {
        if (!validListenChannels.includes(channel)) {
            throw new Error(`قناة غير صالحة: ${channel}`);
        }
        if (typeof callback !== 'function') {
            throw new Error('يجب توفير دالة رد الاتصال');
        }
        const listener = (event, ...args) => callback(...args);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.off(channel, listener);
    },
    
    // إزالة المستمعين
    off: (channel, callback) => {
        if (!validListenChannels.includes(channel)) {
            throw new Error(`قناة غير صالحة: ${channel}`);
        }
        if (typeof callback !== 'function') {
            throw new Error('يجب توفير دالة رد الاتصال');
        }
        ipcRenderer.off(channel, callback);
    },
    
    // إرسال حدث
    send: (channel, ...args) => {
        if (!validChannels.includes(channel)) {
            throw new Error(`قناة غير صالحة: ${channel}`);
        }
        ipcRenderer.send(channel, ...args);
    }
});

Object.freeze(globalThis);
