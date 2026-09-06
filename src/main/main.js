const { app, BrowserWindow, ipcMain, Menu, shell, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { DatabaseService } = require('../services/database.service');
const { LicenseService } = require('../services/license.service');
const { SecurityService } = require('../services/security.service');
const { AdvancedEncryptionService } = require('../services/advanced-encryption.service');

class SadeemApplication {
    constructor() {
        this.mainWindow = null;
        this.databaseService = null;
        this.licenseService = null;
        this.securityService = null;
        this.encryptionService = null;
        this.isReady = false;
        this.splashScreen = null;
        this.appLock = null;
        this.isQuitting = false;
        this.licenseStatus = null;
        this.readOnlyMode = false;
        this.splashComplete = false;
        this.currentPage = 'dashboard';
        this.shortcuts = [];
        this.navigationHistory = [];
        this.auditLogEnabled = true;
        this.isLicenseValid = false;
    }

    // ========================================
    // نظام التشفير المتقدم
    // ========================================
    
    async initializeEncryption() {
        try {
            console.log('🔐 تهيئة نظام التشفير المتقدم...');
            this.encryptionService = new AdvancedEncryptionService();
            await this.encryptionService.initialize();
            console.log('✅ تم تهيئة نظام التشفير المتقدم');
            return true;
        } catch (error) {
            console.error('❌ فشل تهيئة نظام التشفير:', error);
            throw error;
        }
    }

    async generateLicenseKey(data) {
        try {
            return this.encryptionService.generateLicenseKey(data);
        } catch (error) {
            console.error('❌ خطأ في توليد كود الترخيص:', error);
            throw error;
        }
    }

    async verifyLicenseKey(licenseKey, deviceHWID = null) {
        try {
            const hwid = deviceHWID || await this.securityService.getHWID();
            return this.encryptionService.verifyLicenseKey(licenseKey, hwid);
        } catch (error) {
            console.error('❌ خطأ في التحقق من كود الترخيص:', error);
            return { valid: false, message: 'خطأ في التحقق' };
        }
    }

    // ========================================
    // استيراد Word و Excel
    // ========================================
    
    async importWord(filePath) {
        try {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ path: filePath });
            const text = result.value;
            const lines = text.split('\n').filter(line => line.trim());
            const data = lines.map(line => {
                const parts = line.split('\t');
                return parts;
            });
            return data;
        } catch (error) {
            console.error('خطأ في استيراد Word:', error);
            throw error;
        }
    }

    async importExcel(filePath) {
        try {
            const XLSX = require('xlsx');
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);
            return data;
        } catch (error) {
            console.error('خطأ في استيراد Excel:', error);
            throw error;
        }
    }

    // ========================================
    // تصدير PDF و Excel
    // ========================================
    
    async exportPDF(data, options) {
        try {
            const PDFDocument = require('pdfkit');
            const result = await dialog.showSaveDialog(this.mainWindow, {
                title: 'حفظ ملف PDF',
                defaultPath: `report_${new Date().toISOString().split('T')[0]}.pdf`,
                filters: [
                    { name: 'PDF Files', extensions: ['pdf'] }
                ]
            });

            if (result.canceled) {
                return { success: false, message: 'تم إلغاء التصدير' };
            }

            const doc = new PDFDocument({ 
                size: 'A4',
                margins: { top: 50, bottom: 50, left: 50, right: 50 }
            });
            
            const writeStream = fs.createWriteStream(result.filePath);
            doc.pipe(writeStream);

            doc.fontSize(20)
               .text('سديم - نظام إدارة المصانع', { align: 'center' })
               .moveDown();

            doc.fontSize(12)
               .text(`التقرير: ${options.title || 'تقرير عام'}`, { align: 'center' })
               .text(`التاريخ: ${new Date().toLocaleDateString('ar-EG')}`, { align: 'center' })
               .moveDown();

            if (data && data.length > 0) {
                const columns = Object.keys(data[0]);
                const columnWidth = (doc.page.width - 100) / columns.length;

                doc.fontSize(10);
                
                let y = doc.y;
                columns.forEach((col, i) => {
                    doc.text(col, 50 + i * columnWidth, y, { width: columnWidth, align: 'center' });
                });

                doc.moveDown();
                y = doc.y;

                doc.fontSize(9);

                for (const row of data) {
                    if (doc.y > doc.page.height - 100) {
                        doc.addPage();
                        y = doc.y;
                        columns.forEach((col, i) => {
                            doc.text(col, 50 + i * columnWidth, y, { width: columnWidth, align: 'center' });
                        });
                        doc.moveDown();
                        y = doc.y;
                    }

                    columns.forEach((col, i) => {
                        const value = row[col] !== undefined ? row[col] : '';
                        doc.text(String(value), 50 + i * columnWidth, y, { 
                            width: columnWidth, 
                            align: 'center',
                            ellipsis: true
                        });
                    });
                    doc.moveDown();
                    y = doc.y;
                }
            }

            const totalPages = doc.bufferedPageRange().count;
            for (let i = 0; i < totalPages; i++) {
                doc.switchToPage(i);
                doc.fontSize(8)
                   .text(`الصفحة ${i + 1} من ${totalPages}`, 50, doc.page.height - 30, { align: 'center' });
            }

            doc.end();

            return new Promise((resolve, reject) => {
                writeStream.on('finish', () => {
                    resolve({ 
                        success: true, 
                        message: 'تم تصدير التقرير بنجاح',
                        path: result.filePath
                    });
                });

                writeStream.on('error', (error) => {
                    reject(error);
                });
            });

        } catch (error) {
            console.error('خطأ في تصدير PDF:', error);
            return { success: false, message: error.message };
        }
    }

    async exportExcel(data, options) {
        try {
            const XLSX = require('xlsx');
            
            const result = await dialog.showSaveDialog(this.mainWindow, {
                title: 'حفظ ملف Excel',
                defaultPath: `report_${new Date().toISOString().split('T')[0]}.xlsx`,
                filters: [
                    { name: 'Excel Files', extensions: ['xlsx'] }
                ]
            });

            if (result.canceled) {
                return { success: false, message: 'تم إلغاء التصدير' };
            }

            const workbook = XLSX.utils.book_new();
            
            let worksheetData = [];
            if (data && data.length > 0) {
                const headers = Object.keys(data[0]);
                worksheetData.push(headers);
                
                for (const row of data) {
                    const rowData = headers.map(header => row[header] !== undefined ? row[header] : '');
                    worksheetData.push(rowData);
                }
            }

            const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
            XLSX.utils.book_append_sheet(workbook, worksheet, 'التقرير');

            if (options && options.title) {
                worksheet['!cols'] = worksheetData[0] ? 
                    worksheetData[0].map(() => ({ wch: 15 })) : 
                    [];
            }

            XLSX.writeFile(workbook, result.filePath);

            return {
                success: true,
                message: 'تم تصدير التقرير بنجاح',
                path: result.filePath
            };
        } catch (error) {
            console.error('خطأ في تصدير Excel:', error);
            return { success: false, message: error.message };
        }
    }

    // ========================================
    // تهيئة التطبيق
    // ========================================
    async initialize() {
        try {
            console.log('🚀 بدء تهيئة تطبيق سديم...');
            
            this.appLock = app.requestSingleInstanceLock();
            if (!this.appLock) {
                console.log('📌 التطبيق يعمل بالفعل، إغلاق النسخة الجديدة');
                app.quit();
                return;
            }

            await this.initializeEncryption();

            console.log('🔐 تهيئة الخدمات الأمنية...');
            this.securityService = new SecurityService();
            await this.securityService.initialize();

            console.log('📜 تهيئة نظام التفعيل...');
            this.licenseService = new LicenseService(this.securityService);
            await this.licenseService.initialize();

            this.licenseStatus = await this.licenseService.validateLicense();
            this.readOnlyMode = !this.licenseStatus?.valid;
            this.isLicenseValid = this.licenseStatus?.valid || false;

            console.log('💾 تهيئة قاعدة البيانات...');
            this.databaseService = new DatabaseService(this.securityService);
            await this.databaseService.initialize();

            console.log('⚙️ إعداد التطبيق...');
            this.setupAppEvents();
            this.setupIPCHandlers();
            this.setupGlobalShortcuts();

            console.log('🖥️ إنشاء نافذة البداية...');
            await this.createSplashWindow();

            this.isReady = true;
            console.log('✅ تم تهيئة التطبيق بنجاح!');
            
        } catch (error) {
            console.error('❌ فشل تهيئة التطبيق:', error);
            dialog.showErrorBox('خطأ في التشغيل', 'حدث خطأ أثناء تهيئة النظام. يرجى إعادة المحاولة.');
            app.quit();
        }
    }

    // ========================================
    // إعدادات أحداث التطبيق
    // ========================================
    setupAppEvents() {
        app.on('before-quit', (e) => {
            if (!this.isQuitting) {
                e.preventDefault();
                this.handleAppClose();
            }
        });

        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                this.createMainWindow();
            }
        });

        process.on('uncaughtException', (error) => {
            console.error('❌ خطأ غير متوقع:', error);
            this.logError(error);
        });

        process.on('unhandledRejection', (reason) => {
            console.error('❌ رفض غير معالج:', reason);
            this.logError(reason);
        });
    }

    // ========================================
    // معالج إغلاق التطبيق
    // ========================================
    async handleAppClose() {
        if (this.isQuitting) return;
        this.isQuitting = true;

        try {
            await this.cleanupApplication();
            app.exit(0);
        } catch (error) {
            console.error('❌ خطأ أثناء الإغلاق:', error);
            app.exit(1);
        }
    }

    // ========================================
    // إعدادات معالجات IPC
    // ========================================
    setupIPCHandlers() {
        // التحكم في النافذة
        ipcMain.handle('window:minimize', () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow && !focusedWindow.isDestroyed()) {
                focusedWindow.minimize();
            }
        });

        ipcMain.handle('window:maximize', () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow && !focusedWindow.isDestroyed()) {
                if (focusedWindow.isMaximized()) {
                    focusedWindow.unmaximize();
                } else {
                    focusedWindow.maximize();
                }
            }
        });

        ipcMain.handle('window:close', () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow && !focusedWindow.isDestroyed()) {
                focusedWindow.close();
            }
        });

        ipcMain.handle('window:isMaximized', () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            return focusedWindow?.isMaximized() || false;
        });

        // نظام التنقل
        ipcMain.handle('navigation:navigate', (event, page) => {
            this.navigateTo(page);
        });

        ipcMain.handle('navigation:back', () => {
            this.goBack();
        });

        ipcMain.handle('navigation:getCurrentPage', () => {
            return this.currentPage;
        });

        // نظام التفعيل
        ipcMain.handle('license:validate', async () => {
            return await this.licenseService.validateLicense();
        });

        ipcMain.handle('license:activate', async (event, licenseKey) => {
            const result = await this.licenseService.activateLicense(licenseKey);
            if (result.success) {
                this.licenseStatus = await this.licenseService.validateLicense();
                this.readOnlyMode = !this.licenseStatus?.valid;
                this.isLicenseValid = this.licenseStatus?.valid || false;
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('app:license-status', this.licenseStatus);
                    this.mainWindow.webContents.send('app:readonly-mode', this.readOnlyMode);
                }
            }
            return result;
        });

        ipcMain.handle('license:getStatus', async () => {
            return await this.licenseService.getLicenseStatus();
        });

        ipcMain.handle('license:getTrialInfo', async () => {
            return await this.licenseService.getTrialInformation();
        });

        ipcMain.handle('license:generateKey', async (event, data) => {
            return await this.generateLicenseKey(data);
        });

        ipcMain.handle('license:verifyKey', async (event, licenseKey, deviceHWID) => {
            return await this.verifyLicenseKey(licenseKey, deviceHWID);
        });

        ipcMain.handle('license:getRemainingDays', async (event, licenseKey) => {
            return this.encryptionService.getRemainingDays(licenseKey);
        });

        ipcMain.handle('license:isExpired', async (event, licenseKey) => {
            return this.encryptionService.isLicenseExpired(licenseKey);
        });

        ipcMain.handle('license:getHWID', async () => {
            return await this.securityService.getHWID();
        });

        // عمليات قاعدة البيانات
        ipcMain.handle('db:query', async (event, sql, params) => {
            if (this.readOnlyMode && (sql.toUpperCase().includes('INSERT') || sql.toUpperCase().includes('UPDATE') || sql.toUpperCase().includes('DELETE'))) {
                throw new Error('وضع القراءة فقط - لا يمكن تعديل البيانات');
            }
            return await this.databaseService.query(sql, params);
        });

        ipcMain.handle('db:run', async (event, sql, params) => {
            if (this.readOnlyMode) {
                throw new Error('وضع القراءة فقط - لا يمكن تنفيذ عمليات تعديل');
            }
            return await this.databaseService.run(sql, params);
        });

        ipcMain.handle('db:transaction', async (event, operations) => {
            if (this.readOnlyMode) {
                throw new Error('وضع القراءة فقط - لا يمكن تنفيذ معاملات');
            }
            return await this.databaseService.transaction(operations);
        });

        // استيراد وتصدير
        ipcMain.handle('import:word', async (event, filePath) => {
            if (this.readOnlyMode) {
                throw new Error('وضع القراءة فقط - لا يمكن استيراد البيانات');
            }
            return await this.importWord(filePath);
        });

        ipcMain.handle('import:excel', async (event, filePath) => {
            if (this.readOnlyMode) {
                throw new Error('وضع القراءة فقط - لا يمكن استيراد البيانات');
            }
            return await this.importExcel(filePath);
        });

        ipcMain.handle('export:pdf', async (event, data, options) => {
            return await this.exportPDF(data, options);
        });

        ipcMain.handle('export:excel', async (event, data, options) => {
            return await this.exportExcel(data, options);
        });

        // النسخ الاحتياطي
        ipcMain.handle('backup:create', async () => {
            return await this.databaseService.createBackup();
        });

        ipcMain.handle('backup:restore', async (event, backupPath) => {
            if (this.readOnlyMode) {
                throw new Error('وضع القراءة فقط - لا يمكن استعادة النسخ الاحتياطية');
            }
            return await this.databaseService.restoreBackup(backupPath);
        });

        // معلومات النظام
        ipcMain.handle('system:getInfo', async () => {
            return {
                version: app.getVersion(),
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
                electronVersion: process.versions.electron,
                isDev: process.env.NODE_ENV === 'development',
                readOnly: this.readOnlyMode,
                currentPage: this.currentPage,
                isLicenseValid: this.isLicenseValid
            };
        });

        ipcMain.handle('system:getHWID', async () => {
            return await this.securityService.getHWID();
        });

        ipcMain.handle('system:getReadOnly', async () => {
            return this.readOnlyMode;
        });

        // سجل العمليات
        ipcMain.handle('audit:log', async (event, action, target, details) => {
            if (this.auditLogEnabled) {
                await this.databaseService.run(`
                    INSERT INTO activity_log (user, action, target_table, target_id, new_data)
                    VALUES (?, ?, ?, ?, ?)
                `, ['system', action, target.table, target.id, JSON.stringify(details)]);
            }
        });

        ipcMain.handle('audit:getLogs', async (event, limit = 50) => {
            return await this.databaseService.query(`
                SELECT * FROM activity_log 
                ORDER BY created_at DESC 
                LIMIT ?
            `, [limit]);
        });

        // معالجة الأخطاء
        ipcMain.handle('error:log', async (event, error) => {
            console.error('خطأ من عملية التصيير:', error);
            await this.logError(error);
        });

        // اكتمال شاشة البداية
        ipcMain.handle('splash:complete', async () => {
            console.log('✅ تم استلام إشارة اكتمال شاشة البداية');
            this.splashComplete = true;
            await this.createMainWindow();
            if (this.splashScreen && !this.splashScreen.isDestroyed()) {
                this.splashScreen.destroy();
                this.splashScreen = null;
                console.log('🗑️ تم تدمير شاشة البداية');
            }
        });
    }

    // ========================================
    // إنشاء نافذة البداية
    // ========================================
    async createSplashWindow() {
        this.splashScreen = new BrowserWindow({
            width: 900,
            height: 650,
            resizable: false,
            movable: true,
            minimizable: false,
            maximizable: false,
            closable: false,
            frame: false,
            transparent: true,
            backgroundColor: '#0A0A0A',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                sandbox: true
            },
            icon: path.join(__dirname, '../assets/logo.png')
        });

        await this.splashScreen.loadFile(
            path.join(__dirname, '../renderer/pages/splash/splash.html')
        );

        this.splashScreen.on('ready-to-show', () => {
            this.splashScreen.show();
        });

        this.splashScreen.webContents.setWindowOpenHandler((details) => {
            shell.openExternal(details.url);
            return { action: 'deny' };
        });

        if (process.platform === 'win32') {
            this.splashScreen.setContentProtection(true);
        }

        this.splashScreen.webContents.on('did-finish-load', () => {
            this.splashScreen.webContents.send('license-status', this.licenseStatus);
        });
    }

    // ========================================
    // إنشاء النافذة الرئيسية
    // ========================================
    async createMainWindow() {
        try {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.show();
                this.mainWindow.focus();
                return;
            }

            if (!this.splashComplete) {
                await new Promise((resolve) => {
                    const checkComplete = setInterval(() => {
                        if (this.splashComplete) {
                            clearInterval(checkComplete);
                            resolve();
                        }
                    }, 100);
                });
            }

            console.log('🖥️ إنشاء النافذة الرئيسية...');

            const isReadOnly = this.readOnlyMode;

            this.mainWindow = new BrowserWindow({
                width: 1400,
                height: 900,
                minWidth: 1200,
                minHeight: 700,
                frame: false,
                transparent: true,
                backgroundColor: '#0A0A0A',
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: path.join(__dirname, 'preload.js'),
                    sandbox: true,
                    webSecurity: true,
                    allowRunningInsecureContent: false
                },
                icon: path.join(__dirname, '../assets/logo.png')
            });

            this.setupApplicationMenu(isReadOnly);

            await this.mainWindow.loadFile(
                path.join(__dirname, '../renderer/pages/dashboard/dashboard.html')
            );

            this.mainWindow.on('ready-to-show', () => {
                console.log('✅ النافذة الرئيسية جاهزة للعرض');
                this.mainWindow.maximize();
                this.mainWindow.show();
                this.mainWindow.focus();

                if (this.splashScreen && !this.splashScreen.isDestroyed()) {
                    this.splashScreen.destroy();
                    this.splashScreen = null;
                    console.log('🗑️ تم تدمير شاشة البداية');
                }
            });

            this.mainWindow.on('closed', () => {
                this.mainWindow = null;
            });

            this.mainWindow.webContents.setWindowOpenHandler((details) => {
                shell.openExternal(details.url);
                return { action: 'deny' };
            });

            if (process.platform === 'win32') {
                this.mainWindow.setContentProtection(true);
            }

            if (isReadOnly) {
                this.mainWindow.webContents.send('app:readonly-mode', true);
            }

            this.mainWindow.webContents.send('app:license-status', this.licenseStatus);

            console.log('✅ تم إنشاء النافذة الرئيسية بنجاح');

        } catch (error) {
            console.error('❌ فشل إنشاء النافذة الرئيسية:', error);
            throw error;
        }
    }

    // ========================================
    // إعدادات قائمة التطبيق
    // ========================================
    setupApplicationMenu(isReadOnly) {
        const template = [
            {
                label: 'سديم',
                submenu: [
                    { label: 'عن البرنامج', role: 'about' },
                    { type: 'separator' },
                    { label: 'الإعدادات', click: () => this.navigateTo('settings') },
                    { type: 'separator' },
                    { label: 'الخروج', role: 'quit' }
                ]
            },
            {
                label: 'ملف',
                submenu: [
                    { label: 'نسخ احتياطي', click: () => this.createBackup() },
                    { label: 'استعادة نسخة', click: () => this.restoreBackup() },
                    { type: 'separator' },
                    { label: 'استيراد Excel', click: () => this.importExcelFile() },
                    { label: 'استيراد Word', click: () => this.importWordFile() }
                ]
            },
            {
                label: 'عرض',
                submenu: [
                    { label: 'تكبير', role: 'zoomIn' },
                    { label: 'تصغير', role: 'zoomOut' },
                    { label: 'إعادة تعيين', role: 'resetZoom' },
                    { type: 'separator' },
                    { label: 'وضع ملء الشاشة', role: 'togglefullscreen' }
                ]
            },
            {
                label: 'مساعدة',
                submenu: [
                    { label: 'الدعم الفني', click: () => this.showSupportInfo() },
                    { label: 'اختصارات لوحة المفاتيح', click: () => this.showShortcuts() },
                    { label: 'مطور', click: () => this.openDeveloperTools() }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
    }

    // ========================================
    // وظائف النظام
    // ========================================
    async importExcelFile() {
        if (this.readOnlyMode) {
            dialog.showMessageBox(this.mainWindow, {
                title: 'تنبيه',
                message: 'وضع القراءة فقط - لا يمكن استيراد البيانات',
                type: 'warning'
            });
            return;
        }

        const result = await dialog.showOpenDialog(this.mainWindow, {
            title: 'استيراد ملف Excel',
            filters: [
                { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            try {
                const data = await this.importExcel(result.filePaths[0]);
                dialog.showMessageBox(this.mainWindow, {
                    title: 'نجاح',
                    message: `تم استيراد ${data.length} سجل بنجاح`,
                    type: 'info'
                });
            } catch (error) {
                dialog.showMessageBox(this.mainWindow, {
                    title: 'خطأ',
                    message: 'فشل استيراد الملف: ' + error.message,
                    type: 'error'
                });
            }
        }
    }

    async importWordFile() {
        if (this.readOnlyMode) {
            dialog.showMessageBox(this.mainWindow, {
                title: 'تنبيه',
                message: 'وضع القراءة فقط - لا يمكن استيراد البيانات',
                type: 'warning'
            });
            return;
        }

        const result = await dialog.showOpenDialog(this.mainWindow, {
            title: 'استيراد ملف Word',
            filters: [
                { name: 'Word Files', extensions: ['docx', 'doc'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            try {
                const data = await this.importWord(result.filePaths[0]);
                dialog.showMessageBox(this.mainWindow, {
                    title: 'نجاح',
                    message: `تم استيراد البيانات بنجاح`,
                    type: 'info'
                });
            } catch (error) {
                dialog.showMessageBox(this.mainWindow, {
                    title: 'خطأ',
                    message: 'فشل استيراد الملف: ' + error.message,
                    type: 'error'
                });
            }
        }
    }

    showShortcuts() {
        const shortcuts = [
            'Ctrl+Shift+D → لوحة التحكم',
            'Ctrl+Shift+W → إدارة العمال',
            'Ctrl+Shift+P → الرواتب والسلف',
            'Ctrl+Shift+E → المصروفات',
            'Ctrl+Shift+A → منطقة العمل',
            'Ctrl+Shift+T → دليل الاستخدام',
            'Ctrl+Shift+S → الإعدادات',
            'Ctrl+Shift+G → مولد الأكواد',
            'F5 → تحديث الصفحة'
        ];
        dialog.showMessageBox(this.mainWindow, {
            title: 'اختصارات لوحة المفاتيح',
            message: shortcuts.join('\n'),
            type: 'info'
        });
    }

    // ========================================
    // نظام التنقل
    // ========================================
    navigateTo(page) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.navigationHistory.push(this.currentPage);
            this.currentPage = page;
            const pagePath = path.join(__dirname, `../renderer/pages/${page}/${page}.html`);
            this.mainWindow.loadFile(pagePath);
        }
    }

    goBack() {
        if (this.navigationHistory.length > 0) {
            const previousPage = this.navigationHistory.pop();
            this.currentPage = previousPage;
            this.navigateTo(previousPage);
        }
    }

    // ========================================
    // الاختصارات العالمية
    // ========================================
    setupGlobalShortcuts() {
        globalShortcut.register('CommandOrControl+Shift+D', () => {
            this.navigateTo('dashboard');
        });

        globalShortcut.register('CommandOrControl+Shift+W', () => {
            this.navigateTo('workers');
        });

        globalShortcut.register('CommandOrControl+Shift+P', () => {
            this.navigateTo('payroll');
        });

        globalShortcut.register('CommandOrControl+Shift+E', () => {
            this.navigateTo('expenses');
        });

        globalShortcut.register('CommandOrControl+Shift+A', () => {
            this.navigateTo('workspace');
        });

        globalShortcut.register('CommandOrControl+Shift+T', () => {
            this.navigateTo('tutorial');
        });

        globalShortcut.register('CommandOrControl+Shift+S', () => {
            this.navigateTo('settings');
        });

        globalShortcut.register('CommandOrControl+Shift+G', () => {
            this.navigateTo('generator');
        });

        globalShortcut.register('F5', () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.reload();
            }
        });

        this.shortcuts = [
            'CommandOrControl+Shift+D', 'CommandOrControl+Shift+W',
            'CommandOrControl+Shift+P', 'CommandOrControl+Shift+E',
            'CommandOrControl+Shift+A', 'CommandOrControl+Shift+T',
            'CommandOrControl+Shift+S', 'CommandOrControl+Shift+G', 'F5'
        ];
    }

    // ========================================
    // النسخ الاحتياطي
    // ========================================
    async createBackup() {
        if (this.readOnlyMode) {
            dialog.showMessageBox(this.mainWindow, {
                title: 'تنبيه',
                message: 'وضع القراءة فقط - لا يمكن إنشاء نسخ احتياطية',
                type: 'warning'
            });
            return;
        }

        const result = await dialog.showSaveDialog(this.mainWindow, {
            title: 'حفظ النسخة الاحتياطية',
            defaultPath: `Sadeem_Backup_${new Date().toISOString().split('T')[0]}.sdb`,
            filters: [
                { name: 'Sadeem Backup', extensions: ['sdb'] }
            ]
        });

        if (!result.canceled) {
            await this.databaseService.createBackup(result.filePath);
            dialog.showMessageBox(this.mainWindow, {
                title: 'نجاح',
                message: 'تم إنشاء النسخة الاحتياطية بنجاح',
                type: 'info'
            });
        }
    }

    async restoreBackup() {
        if (this.readOnlyMode) {
            dialog.showMessageBox(this.mainWindow, {
                title: 'تنبيه',
                message: 'وضع القراءة فقط - لا يمكن استعادة النسخ الاحتياطية',
                type: 'warning'
            });
            return;
        }

        const result = await dialog.showOpenDialog(this.mainWindow, {
            title: 'استعادة النسخة الاحتياطية',
            filters: [
                { name: 'Sadeem Backup', extensions: ['sdb'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const confirm = await dialog.showMessageBox(this.mainWindow, {
                title: 'تأكيد الاستعادة',
                message: 'سيتم استبدال جميع البيانات الحالية. هل أنت متأكد؟',
                type: 'warning',
                buttons: ['نعم', 'لا']
            });

            if (confirm.response === 0) {
                await this.databaseService.restoreBackup(result.filePaths[0]);
                dialog.showMessageBox(this.mainWindow, {
                    title: 'نجاح',
                    message: 'تم استعادة البيانات بنجاح. سيتم إعادة تشغيل التطبيق.',
                    type: 'info'
                });
                app.relaunch();
                app.quit();
            }
        }
    }

    // ========================================
    // معلومات الدعم
    // ========================================
    showSupportInfo() {
        const supportInfo = `
        🏢 شركة سديم
        👤 المالكين: محمود حازم & مصطفى رينو
        📞 رقم الدعم: 01554567596
        📱 واتساب: 01554567596
        📷 إنستغرام: mh_rm_a
        `;
        dialog.showMessageBox(this.mainWindow, {
            title: 'الدعم الفني',
            message: supportInfo,
            type: 'info'
        });
    }

    openDeveloperTools() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.openDevTools();
        }
    }

    async logError(error) {
        const logPath = path.join(app.getPath('userData'), 'logs', 'error.log');
        await fs.ensureDir(path.dirname(logPath));
        const logEntry = typeof error === 'object' ? 
            JSON.stringify(error, null, 2) : 
            String(error);
        await fs.appendFile(logPath, `[${new Date().toISOString()}] ${logEntry}\n`);
    }

    async cleanupApplication() {
        console.log('🧹 تنظيف التطبيق...');
        
        for (const shortcut of this.shortcuts) {
            globalShortcut.unregister(shortcut);
        }
        
        if (this.databaseService) {
            await this.databaseService.close();
        }
        console.log('✅ تم تنظيف التطبيق بنجاح');
    }
}

const appInstance = new SadeemApplication();
appInstance.initialize().catch(error => {
    console.error('❌ فشل تشغيل التطبيق:', error);
    dialog.showErrorBox('خطأ فادح', 'تعذر تشغيل التطبيق. يرجى التحقق من تثبيت النظام.');
    app.quit();
});

module.exports = { SadeemApplication };
