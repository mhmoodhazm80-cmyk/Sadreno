const { app, BrowserWindow, ipcMain, Menu, shell, dialog, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { DatabaseService } = require('../services/database.service');
const { LicenseService } = require('../services/license.service');
const { SecurityService } = require('../services/security.service');

class SadeemApplication {
    constructor() {
        this.mainWindow = null;
        this.databaseService = null;
        this.licenseService = null;
        this.securityService = null;
        this.isReady = false;
        this.splashScreen = null;
        this.appLock = null;
        this.isQuitting = false;
        this.licenseStatus = null;
        this.readOnlyMode = false;
        this.splashComplete = false;
    }

    // ========================================
    // نظام التشفير المتقدم - PBKDF2/SHA-512 + HWID Scrambling
    // ========================================
    
    /**
     * توليد مفتاح مشتق من HWID باستخدام PBKDF2/SHA-512
     */
    deriveKeyFromHWID(hwid, salt, iterations = 100000) {
        try {
            const derivedKey = crypto.pbkdf2Sync(
                hwid,
                salt,
                iterations,
                64,
                'sha512'
            );
            return derivedKey.toString('hex');
        } catch (error) {
            console.error('خطأ في اشتقاق المفتاح:', error);
            throw error;
        }
    }

    /**
     * تطبيق مصفوفة الخلط (Scrambling Matrix) على البيانات
     */
    applyScramblingMatrix(data, hwid) {
        try {
            const matrix = this.generateScramblingMatrix(hwid);
            const result = Buffer.alloc(data.length);
            
            for (let i = 0; i < data.length; i++) {
                const index = (i + matrix[i % 256] + Math.floor(i / 256)) % 256;
                result[i] = data[i] ^ matrix[index];
                
                if (i > 0) {
                    result[i] = (result[i] + result[i-1]) % 256;
                }
            }
            
            return result;
        } catch (error) {
            console.error('خطأ في تطبيق مصفوفة الخلط:', error);
            throw error;
        }
    }

    /**
     * عكس مصفوفة الخلط
     */
    reverseScramblingMatrix(data, hwid) {
        try {
            const matrix = this.generateScramblingMatrix(hwid);
            const result = Buffer.alloc(data.length);
            
            for (let i = data.length - 1; i >= 0; i--) {
                let value = data[i];
                if (i > 0) {
                    value = (value - result[i-1] + 256) % 256;
                }
                
                const index = (i + matrix[i % 256] + Math.floor(i / 256)) % 256;
                result[i] = value ^ matrix[index];
            }
            
            return result;
        } catch (error) {
            console.error('خطأ في عكس مصفوفة الخلط:', error);
            throw error;
        }
    }

    /**
     * توليد مصفوفة الخلط الديناميكية من HWID
     */
    generateScramblingMatrix(hwid) {
        const matrix = new Uint8Array(256);
        const seed = hwid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        
        for (let i = 0; i < 256; i++) {
            const index = (i * 7 + seed * 13 + i * i * 3) % 256;
            matrix[i] = (i * 13 + seed * 7 + index * 5) % 256;
        }
        
        return matrix;
    }

    /**
     * تطبيق XOR Shift مع المفتاح
     */
    applyXORShift(data, key) {
        try {
            const result = Buffer.alloc(data.length);
            const keyBuffer = Buffer.from(key, 'hex');
            
            for (let i = 0; i < data.length; i++) {
                const keyByte = keyBuffer[i % keyBuffer.length];
                const shift = (i * 7 + keyByte) % 8;
                
                let value = data[i] ^ keyByte;
                value = ((value << shift) | (value >> (8 - shift))) & 0xFF;
                
                result[i] = value;
            }
            
            return result;
        } catch (error) {
            console.error('خطأ في تطبيق XOR Shift:', error);
            throw error;
        }
    }

    /**
     * عكس XOR Shift
     */
    reverseXORShift(data, key) {
        try {
            const result = Buffer.alloc(data.length);
            const keyBuffer = Buffer.from(key, 'hex');
            
            for (let i = 0; i < data.length; i++) {
                const keyByte = keyBuffer[i % keyBuffer.length];
                const shift = (i * 7 + keyByte) % 8;
                
                let value = ((data[i] >> shift) | (data[i] << (8 - shift))) & 0xFF;
                value = value ^ keyByte;
                
                result[i] = value;
            }
            
            return result;
        } catch (error) {
            console.error('خطأ في عكس XOR Shift:', error);
            throw error;
        }
    }

    /**
     * تشفير بيانات الترخيص باستخدام النظام المتقدم
     */
    encryptLicenseData(data, hwid) {
        try {
            const jsonData = JSON.stringify(data);
            const dataBuffer = Buffer.from(jsonData, 'utf8');
            
            const salt = crypto.randomBytes(32);
            const derivedKey = this.deriveKeyFromHWID(hwid, salt);
            const scrambled = this.applyScramblingMatrix(dataBuffer, hwid);
            const encrypted = this.applyXORShift(scrambled, derivedKey);
            
            const result = Buffer.concat([
                salt,
                encrypted
            ]);
            
            return result.toString('base64');
        } catch (error) {
            console.error('خطأ في تشفير بيانات الترخيص:', error);
            throw error;
        }
    }

    /**
     * فك تشفير بيانات الترخيص
     */
    decryptLicenseData(encryptedData, hwid) {
        try {
            const encryptedBuffer = Buffer.from(encryptedData, 'base64');
            const salt = encryptedBuffer.slice(0, 32);
            const data = encryptedBuffer.slice(32);
            
            const derivedKey = this.deriveKeyFromHWID(hwid, salt);
            const unscrambled = this.reverseXORShift(data, derivedKey);
            const decrypted = this.reverseScramblingMatrix(unscrambled, hwid);
            
            const jsonString = decrypted.toString('utf8');
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('خطأ في فك تشفير بيانات الترخيص:', error);
            throw error;
        }
    }

    /**
     * توليد توقيع للتحقق من سلامة البيانات
     */
    generateSignature(data, hwid) {
        try {
            const hash = crypto.createHash('sha512');
            hash.update(data);
            hash.update(hwid);
            hash.update('SADEEM_SECURE_SALT_2024');
            return hash.digest('hex');
        } catch (error) {
            console.error('خطأ في توليد التوقيع:', error);
            throw error;
        }
    }

    /**
     * التحقق من توقيع البيانات
     */
    verifySignature(data, signature, hwid) {
        try {
            const computedSignature = this.generateSignature(data, hwid);
            return crypto.timingSafeEqual(
                Buffer.from(computedSignature),
                Buffer.from(signature)
            );
        } catch (error) {
            console.error('خطأ في التحقق من التوقيع:', error);
            return false;
        }
    }

    // ========================================
    // تصدير PDF
    // ========================================
    async exportPDF(data, options) {
        try {
            const PDFDocument = require('pdfkit');
            const fs = require('fs-extra');
            const path = require('path');
            
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

            doc.font('Helvetica-Bold')
               .fontSize(20)
               .text('سديم - نظام إدارة المصانع', { align: 'center' })
               .moveDown();

            doc.font('Helvetica')
               .fontSize(12)
               .text(`التقرير: ${options.title || 'تقرير عام'}`, { align: 'center' })
               .text(`التاريخ: ${new Date().toLocaleDateString('ar-EG')}`, { align: 'center' })
               .moveDown();

            if (data && data.length > 0) {
                const columns = Object.keys(data[0]);
                const columnWidth = (doc.page.width - 100) / columns.length;

                doc.font('Helvetica-Bold')
                   .fontSize(10);
                
                let y = doc.y;
                columns.forEach((col, i) => {
                    doc.text(col, 50 + i * columnWidth, y, { width: columnWidth, align: 'center' });
                });

                doc.moveDown();
                y = doc.y;

                doc.font('Helvetica')
                   .fontSize(9);

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
                doc.font('Helvetica')
                   .fontSize(8)
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

    // ========================================
    // تصدير Excel
    // ========================================
    async exportExcel(data, options) {
        try {
            const XLSX = require('xlsx');
            const fs = require('fs-extra');
            
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

            console.log('🔐 تهيئة الخدمات الأمنية...');
            this.securityService = new SecurityService();
            await this.securityService.initialize();

            console.log('📜 تهيئة نظام التفعيل...');
            this.licenseService = new LicenseService(this.securityService);
            await this.licenseService.initialize();

            this.licenseStatus = await this.licenseService.validateLicense();
            this.readOnlyMode = !this.licenseStatus?.valid;

            console.log('💾 تهيئة قاعدة البيانات...');
            this.databaseService = new DatabaseService(this.securityService);
            await this.databaseService.initialize();

            console.log('⚙️ إعداد التطبيق...');
            this.setupAppEvents();
            this.setupIPCHandlers();

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
        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('activate', async () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                await this.createMainWindow();
            }
        });

        app.on('before-quit', async (event) => {
            if (this.isQuitting) return;
            this.isQuitting = true;
            
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                event.preventDefault();
                await this.cleanupApplication();
                app.quit();
            }
        });

        if (process.platform === 'win32') {
            systemPreferences.on('accent-color-changed', this.handleSystemThemeChange.bind(this));
        }
    }

    // ========================================
    // إعدادات معالجات IPC
    // ========================================
    setupIPCHandlers() {
        // ========================================
        // التحكم في النافذة - استخدام النافذة النشطة
        // ========================================
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

        // ========================================
        // نظام التفعيل المتقدم
        // ========================================
        ipcMain.handle('license:validate', async () => {
            return await this.licenseService.validateLicense();
        });

        ipcMain.handle('license:activate', async (event, licenseKey) => {
            const result = await this.licenseService.activateLicense(licenseKey);
            if (result.success) {
                this.licenseStatus = await this.licenseService.validateLicense();
                this.readOnlyMode = !this.licenseStatus?.valid;
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

        // ========================================
        // عمليات التشفير المتقدمة
        // ========================================
        ipcMain.handle('encrypt:license', async (event, data, hwid) => {
            return this.encryptLicenseData(data, hwid);
        });

        ipcMain.handle('decrypt:license', async (event, encryptedData, hwid) => {
            return this.decryptLicenseData(encryptedData, hwid);
        });

        ipcMain.handle('encrypt:generateSignature', async (event, data, hwid) => {
            return this.generateSignature(data, hwid);
        });

        ipcMain.handle('encrypt:verifySignature', async (event, data, signature, hwid) => {
            return this.verifySignature(data, signature, hwid);
        });

        ipcMain.handle('encrypt:deriveKey', async (event, hwid, salt, iterations) => {
            return this.deriveKeyFromHWID(hwid, salt, iterations || 100000);
        });

        // ========================================
        // عمليات قاعدة البيانات
        // ========================================
        ipcMain.handle('db:query', async (event, sql, params) => {
            if (this.readOnlyMode && sql.toUpperCase().includes('INSERT')) {
                throw new Error('وضع القراءة فقط - لا يمكن إضافة بيانات');
            }
            if (this.readOnlyMode && sql.toUpperCase().includes('UPDATE')) {
                throw new Error('وضع القراءة فقط - لا يمكن تعديل بيانات');
            }
            if (this.readOnlyMode && sql.toUpperCase().includes('DELETE')) {
                throw new Error('وضع القراءة فقط - لا يمكن حذف بيانات');
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

        // ========================================
        // عمليات النسخ الاحتياطي
        // ========================================
        ipcMain.handle('backup:create', async () => {
            return await this.databaseService.createBackup();
        });

        ipcMain.handle('backup:restore', async (event, backupPath) => {
            if (this.readOnlyMode) {
                throw new Error('وضع القراءة فقط - لا يمكن استعادة النسخ الاحتياطية');
            }
            return await this.databaseService.restoreBackup(backupPath);
        });

        // ========================================
        // معلومات النظام
        // ========================================
        ipcMain.handle('system:getInfo', async () => {
            return {
                version: app.getVersion(),
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
                electronVersion: process.versions.electron,
                isDev: process.env.NODE_ENV === 'development',
                readOnly: this.readOnlyMode
            };
        });

        ipcMain.handle('system:getHWID', async () => {
            return await this.securityService.getHWID();
        });

        ipcMain.handle('system:getReadOnly', async () => {
            return this.readOnlyMode;
        });

        // ========================================
        // تصدير التقارير
        // ========================================
        ipcMain.handle('export:pdf', async (event, data, options) => {
            return await this.exportPDF(data, options);
        });

        ipcMain.handle('export:excel', async (event, data, options) => {
            return await this.exportExcel(data, options);
        });

        // ========================================
        // معالجة الأخطاء
        // ========================================
        ipcMain.handle('error:log', async (event, error) => {
            console.error('خطأ من عملية التصيير:', error);
            await this.logError(error);
        });

        // ========================================
        // اكتمال شاشة البداية - إنشاء النافذة الرئيسية
        // ========================================
        ipcMain.handle('splash:complete', async () => {
            console.log('✅ تم استلام إشارة اكتمال شاشة البداية');
            this.splashComplete = true;
            await this.createMainWindow();
        });
    }

    // ========================================
    // إنشاء نافذة البداية (Splash Screen)
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

        // إرسال حالة الترخيص إلى شاشة البداية
        this.splashScreen.webContents.on('did-finish-load', () => {
            this.splashScreen.webContents.send('license-status', this.licenseStatus);
        });
    }

    // ========================================
    // إنشاء النافذة الرئيسية
    // ========================================
    async createMainWindow() {
        try {
            // إذا كانت النافذة الرئيسية موجودة بالفعل، أظهرها
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                console.log('🔄 النافذة الرئيسية موجودة بالفعل، إظهارها');
                this.mainWindow.show();
                this.mainWindow.focus();
                return;
            }

            // التحقق من اكتمال شاشة البداية
            if (!this.splashComplete) {
                console.log('⏳ انتظار اكتمال شاشة البداية...');
                // انتظار حتى تكتمل شاشة البداية
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

            // إعداد قائمة التطبيق
            this.setupApplicationMenu(isReadOnly);

            // تحميل لوحة التحكم
            await this.mainWindow.loadFile(
                path.join(__dirname, '../renderer/pages/dashboard/dashboard.html')
            );

            // عند جاهزية النافذة الرئيسية
            this.mainWindow.on('ready-to-show', () => {
                console.log('✅ النافذة الرئيسية جاهزة للعرض');
                
                // تكبير النافذة
                this.mainWindow.maximize();
                this.mainWindow.show();
                this.mainWindow.focus();

                // إغلاق شاشة البداية
                if (this.splashScreen && !this.splashScreen.isDestroyed()) {
                    console.log('🗑️ إغلاق شاشة البداية');
                    this.splashScreen.close();
                    this.splashScreen = null;
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
                    { label: 'الإعدادات', click: () => this.navigateToSettings() },
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
                    { label: 'تصدير البيانات', enabled: !isReadOnly }
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
                    { label: 'توثيق النظام', click: () => this.openDocumentation() },
                    { type: 'separator' },
                    { label: 'مطور', click: () => this.openDeveloperTools() }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
    }

    // ========================================
    // معالجات التحكم في النافذة
    // ========================================
    handleMinimize() {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.minimize();
        }
    }

    handleMaximize() {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow && !focusedWindow.isDestroyed()) {
            if (focusedWindow.isMaximized()) {
                focusedWindow.unmaximize();
            } else {
                focusedWindow.maximize();
            }
        }
    }

    handleClose() {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.close();
        }
    }

    // ========================================
    // وظائف النظام
    // ========================================
    async navigateToSettings() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            await this.mainWindow.loadFile(
                path.join(__dirname, '../renderer/pages/settings/settings.html')
            );
        }
    }

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

    showSupportInfo() {
        dialog.showMessageBox(this.mainWindow, {
            title: 'الدعم الفني',
            message: 'رقم الدعم الفني: 01554567596',
            detail: 'للتواصل مع فريق الدعم الفني',
            type: 'info'
        });
    }

    openDocumentation() {
        shell.openExternal('https://docs.sadeem.com');
    }

    openDeveloperTools() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.openDevTools();
        }
    }

    handleSystemThemeChange() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('system:theme-change');
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
        if (this.databaseService) {
            await this.databaseService.close();
        }
        console.log('✅ تم تنظيف التطبيق بنجاح');
    }
}

// ========================================
// تشغيل التطبيق
// ========================================
const appInstance = new SadeemApplication();
appInstance.initialize().catch(error => {
    console.error('❌ فشل تشغيل التطبيق:', error);
    dialog.showErrorBox('خطأ فادح', 'تعذر تشغيل التطبيق. يرجى التحقق من تثبيت النظام.');
    app.quit();
});

module.exports = { SadeemApplication };
