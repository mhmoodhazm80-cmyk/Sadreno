const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { SecurityService } = require('./security.service');

class DatabaseService {
    constructor(securityService) {
        this.db = null;
        this.securityService = securityService;
        this.dbPath = null;
        this.isEncrypted = false;
        this.backupInterval = null;
        this.transactionQueue = [];
        this.isTransactionActive = false;
        this.readOnlyMode = false;
    }

    async initialize() {
        try {
            console.log('🗄️ تهيئة قاعدة البيانات...');
            
            // تحديد مسار قاعدة البيانات
            this.dbPath = this.getDatabasePath();
            
            // التأكد من وجود المجلد
            await fs.ensureDir(path.dirname(this.dbPath));
            
            // فتح قاعدة البيانات
            this.db = new Database(this.dbPath, {
                verbose: process.env.NODE_ENV === 'development' ? console.log : null
            });
            
            // تمكين القيود الخارجية
            this.db.pragma('foreign_keys = ON');
            
            // تمكين وضع الكتابة الفورية
            this.db.pragma('journal_mode = WAL');
            
            // تحسين الأداء
            this.db.pragma('cache_size = 10000');
            this.db.pragma('synchronous = NORMAL');
            
            // إنشاء الجداول
            await this.createTables();
            
            // التحقق من التشفير
            await this.verifyEncryption();
            
            // بدء النسخ الاحتياطي التلقائي
            this.startAutoBackup();
            
            console.log('✅ تم تهيئة قاعدة البيانات بنجاح');
            return true;
        } catch (error) {
            console.error('❌ فشل تهيئة قاعدة البيانات:', error);
            throw error;
        }
    }

    getDatabasePath() {
        const appDataPath = process.env.APPDATA || 
                            (process.platform === 'darwin' ? 
                            path.join(os.homedir(), 'Library/Application Support') : 
                            path.join(os.homedir(), '.local/share'));
        
        const sadeemPath = path.join(appDataPath, 'Sadeem', 'Database');
        return path.join(sadeemPath, 'sadeem.db');
    }

    async createTables() {
        console.log('📋 إنشاء الجداول...');

        // جدول المصانع
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS factories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                address TEXT,
                phone TEXT,
                email TEXT,
                tax_id TEXT,
                commercial_register TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // جدول العمال
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                factory_id INTEGER,
                name TEXT NOT NULL,
                position TEXT,
                salary_type TEXT CHECK(salary_type IN ('hourly', 'daily', 'monthly', 'piece')),
                salary_rate REAL,
                piece_rate REAL,
                phone TEXT,
                address TEXT,
                national_id TEXT,
                bank_account TEXT,
                hire_date DATE,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE
            )
        `);

        // جدول الحضور والإنتاج اليومي
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS daily_operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                worker_id INTEGER NOT NULL,
                date DATE DEFAULT CURRENT_DATE,
                check_in_time TIME,
                check_out_time TIME,
                hours_worked REAL DEFAULT 0,
                overtime_hours REAL DEFAULT 0,
                pieces_produced INTEGER DEFAULT 0,
                defective_pieces INTEGER DEFAULT 0,
                notes TEXT,
                status TEXT CHECK(status IN ('present', 'absent', 'leave', 'holiday')) DEFAULT 'present',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
                UNIQUE(worker_id, date)
            )
        `);

        // جدول السلف والخصومات
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS advances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                worker_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                date DATE DEFAULT CURRENT_DATE,
                description TEXT,
                type TEXT CHECK(type IN ('advance', 'deduction', 'loan')) DEFAULT 'advance',
                is_deducted BOOLEAN DEFAULT 0,
                deducted_date DATE,
                remaining_amount REAL,
                interest_rate REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
            )
        `);

        // جدول المصروفات
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                factory_id INTEGER,
                category TEXT NOT NULL,
                sub_category TEXT,
                amount REAL NOT NULL,
                date DATE DEFAULT CURRENT_DATE,
                description TEXT,
                receipt_image TEXT,
                payment_method TEXT CHECK(payment_method IN ('cash', 'bank', 'check')) DEFAULT 'cash',
                check_number TEXT,
                vendor_name TEXT,
                is_recurring BOOLEAN DEFAULT 0,
                recurrence_period INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE
            )
        `);

        // جدول الرواتب
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS payroll (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                worker_id INTEGER NOT NULL,
                period_start DATE NOT NULL,
                period_end DATE NOT NULL,
                total_hours REAL DEFAULT 0,
                total_pieces INTEGER DEFAULT 0,
                base_salary REAL DEFAULT 0,
                overtime_pay REAL DEFAULT 0,
                piece_pay REAL DEFAULT 0,
                advances_deducted REAL DEFAULT 0,
                deductions REAL DEFAULT 0,
                bonuses REAL DEFAULT 0,
                net_salary REAL DEFAULT 0,
                is_paid BOOLEAN DEFAULT 0,
                paid_date DATE,
                payment_method TEXT CHECK(payment_method IN ('cash', 'bank')) DEFAULT 'cash',
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
            )
        `);

        // جدول التراخيص
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS licenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                license_key TEXT UNIQUE NOT NULL,
                factory_name TEXT,
                hwid TEXT NOT NULL,
                activation_date DATE,
                expiry_date DATE,
                license_type TEXT CHECK(license_type IN ('trial', 'monthly', 'annual', 'perpetual')) DEFAULT 'trial',
                is_active BOOLEAN DEFAULT 0,
                is_encrypted BOOLEAN DEFAULT 1,
                encrypted_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // جدول الإعدادات
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                category TEXT,
                is_encrypted BOOLEAN DEFAULT 0,
                encrypted_value TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // جدول سجل الأنشطة
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user TEXT,
                action TEXT,
                target_table TEXT,
                target_id INTEGER,
                old_data TEXT,
                new_data TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // جدول النسخ الاحتياطي
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                file_size INTEGER,
                type TEXT CHECK(type IN ('auto', 'manual')) DEFAULT 'auto',
                status TEXT CHECK(status IN ('success', 'failed')) DEFAULT 'success',
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // إنشاء الفهارس
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_workers_factory ON workers(factory_id);
            CREATE INDEX IF NOT EXISTS idx_workers_active ON workers(is_active);
            CREATE INDEX IF NOT EXISTS idx_operations_worker_date ON daily_operations(worker_id, date);
            CREATE INDEX IF NOT EXISTS idx_operations_date ON daily_operations(date);
            CREATE INDEX IF NOT EXISTS idx_advances_worker ON advances(worker_id);
            CREATE INDEX IF NOT EXISTS idx_advances_deducted ON advances(is_deducted);
            CREATE INDEX IF NOT EXISTS idx_expenses_factory ON expenses(factory_id);
            CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
            CREATE INDEX IF NOT EXISTS idx_payroll_worker ON payroll(worker_id);
            CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll(period_start, period_end);
            CREATE INDEX IF NOT EXISTS idx_licenses_hwid ON licenses(hwid);
            CREATE INDEX IF NOT EXISTS idx_licenses_active ON licenses(is_active);
            CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
            CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
        `);

        // إضافة البيانات الافتراضية
        this.insertDefaultData();
        console.log('✅ تم إنشاء جميع الجداول بنجاح');
    }

    async insertDefaultData() {
        // إضافة إعدادات افتراضية
        const defaultSettings = [
            ['app_name', 'سديم - نظام إدارة المصانع', 'general'],
            ['app_version', '1.0.0', 'general'],
            ['company_name', '', 'general'],
            ['company_address', '', 'general'],
            ['company_phone', '', 'general'],
            ['company_email', '', 'general'],
            ['payroll_cycle', 'monthly', 'payroll'],
            ['payroll_day', '1', 'payroll'],
            ['currency_symbol', 'ج.م', 'general'],
            ['decimal_places', '2', 'general'],
            ['auto_backup', 'true', 'backup'],
            ['backup_interval', '24', 'backup'],
            ['backup_retention', '30', 'backup'],
            ['notification_enabled', 'true', 'notifications'],
            ['language', 'ar', 'general'],
            ['theme', 'dark', 'general']
        ];

        const insertSetting = this.db.prepare(`
            INSERT OR IGNORE INTO settings (key, value, category) 
            VALUES (?, ?, ?)
        `);

        const insertTransaction = this.db.transaction((settings) => {
            for (const setting of settings) {
                insertSetting.run(setting);
            }
        });

        insertTransaction(defaultSettings);
        console.log('✅ تم إضافة البيانات الافتراضية');
    }

    async verifyEncryption() {
        try {
            const licenses = this.db.prepare('SELECT COUNT(*) as count FROM licenses WHERE is_encrypted = 1').get();
            
            if (licenses.count === 0) {
                await this.encryptExistingData();
            }
            
            this.isEncrypted = true;
            console.log('✅ تم التحقق من تشفير البيانات');
        } catch (error) {
            console.error('❌ خطأ في التحقق من التشفير:', error);
            throw error;
        }
    }

    async encryptExistingData() {
        const licenses = this.db.prepare('SELECT * FROM licenses').all();
        
        for (const license of licenses) {
            const encryptedData = this.securityService.encryptData({
                key: license.license_key,
                factory: license.factory_name,
                hwid: license.hwid
            });
            
            this.db.prepare(`
                UPDATE licenses 
                SET encrypted_data = ?, is_encrypted = 1 
                WHERE id = ?
            `).run(encryptedData, license.id);
        }
        console.log('✅ تم تشفير البيانات الحساسة');
    }

    startAutoBackup() {
        const backupInterval = setInterval(async () => {
            try {
                await this.createBackup();
                console.log('📦 تم إنشاء نسخة احتياطية تلقائية');
            } catch (error) {
                console.error('❌ فشل النسخ الاحتياطي التلقائي:', error);
            }
        }, 24 * 60 * 60 * 1000);

        this.backupInterval = backupInterval;
    }

    async createBackup(backupPath = null) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const defaultBackupPath = path.join(
            path.dirname(this.dbPath),
            'backups',
            `sadeem_backup_${timestamp}.sdb`
        );

        const targetPath = backupPath || defaultBackupPath;
        await fs.ensureDir(path.dirname(targetPath));

        try {
            this.db.exec(`VACUUM INTO '${targetPath}'`);
            
            const stats = await fs.stat(targetPath);
            this.db.prepare(`
                INSERT INTO backups (file_path, file_size, type, status)
                VALUES (?, ?, ?, 'success')
            `).run(targetPath, stats.size, backupPath ? 'manual' : 'auto');

            await this.cleanupOldBackups();

            return {
                path: targetPath,
                size: stats.size,
                timestamp: new Date()
            };
        } catch (error) {
            this.db.prepare(`
                INSERT INTO backups (file_path, type, status, notes)
                VALUES (?, ?, 'failed', ?)
            `).run(targetPath, backupPath ? 'manual' : 'auto', error.message);
            
            throw error;
        }
    }

    async restoreBackup(backupPath) {
        if (!await fs.pathExists(backupPath)) {
            throw new Error('ملف النسخ الاحتياطي غير موجود');
        }

        await this.createBackup();
        this.db.close();

        try {
            await fs.copy(backupPath, this.dbPath, { overwrite: true });
            this.db = new Database(this.dbPath);
            this.db.pragma('foreign_keys = ON');
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('cache_size = 10000');
            this.db.pragma('synchronous = NORMAL');

            this.db.prepare(`
                INSERT INTO activity_log (user, action, target_table, new_data)
                VALUES ('system', 'restore_backup', 'backups', ?)
            `).run(JSON.stringify({ backup_path: backupPath }));

            console.log('✅ تم استعادة النسخة الاحتياطية بنجاح');
            return true;
        } catch (error) {
            console.error('❌ فشل استعادة النسخة الاحتياطية:', error);
            throw error;
        }
    }

    async cleanupOldBackups() {
        const retention = this.db.prepare(
            "SELECT value FROM settings WHERE key = 'backup_retention'"
        ).get();

        const retentionDays = retention ? parseInt(retention.value) : 30;

        const oldBackups = this.db.prepare(`
            SELECT * FROM backups 
            WHERE type = 'auto' 
            AND created_at < datetime('now', '-' || ? || ' days')
            ORDER BY created_at
        `).all(retentionDays);

        for (const backup of oldBackups) {
            try {
                if (await fs.pathExists(backup.file_path)) {
                    await fs.remove(backup.file_path);
                }
                this.db.prepare('DELETE FROM backups WHERE id = ?').run(backup.id);
            } catch (error) {
                console.error('❌ فشل حذف نسخة احتياطية قديمة:', error);
            }
        }
    }

    // ========================================
    // عمليات قاعدة البيانات الأساسية
    // ========================================
    
    query(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.all(params);
        } catch (error) {
            console.error('❌ خطأ في الاستعلام:', error);
            throw error;
        }
    }

    run(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            const result = stmt.run(params);
            return {
                lastID: result.lastInsertRowid,
                changes: result.changes
            };
        } catch (error) {
            console.error('❌ خطأ في تنفيذ الاستعلام:', error);
            throw error;
        }
    }

    async transaction(operations) {
        if (this.isTransactionActive) {
            throw new Error('Transaction already in progress');
        }

        this.isTransactionActive = true;
        const transaction = this.db.transaction(() => {
            const results = [];
            for (const operation of operations) {
                const stmt = this.db.prepare(operation.sql);
                const result = stmt.run(operation.params);
                results.push({
                    lastID: result.lastInsertRowid,
                    changes: result.changes
                });
            }
            return results;
        });

        try {
            const results = transaction();
            this.isTransactionActive = false;
            return results;
        } catch (error) {
            this.isTransactionActive = false;
            console.error('❌ فشل تنفيذ المعاملة:', error);
            throw error;
        }
    }

    // ========================================
    // دوال مساعدة للاستعلامات الشائعة
    // ========================================

    getWorker(id) {
        return this.db.prepare('SELECT * FROM workers WHERE id = ?').get(id);
    }

    getWorkersByFactory(factoryId) {
        return this.db.prepare('SELECT * FROM workers WHERE factory_id = ? AND is_active = 1').all(factoryId);
    }

    getDailyOperations(date) {
        return this.db.prepare(`
            SELECT 
                w.*,
                d.hours_worked,
                d.pieces_produced,
                d.status,
                d.notes
            FROM daily_operations d
            JOIN workers w ON w.id = d.worker_id
            WHERE d.date = ?
        `).all(date);
    }

    getWorkerPayroll(workerId, periodStart, periodEnd) {
        return this.db.prepare(`
            SELECT 
                SUM(hours_worked) as total_hours,
                SUM(pieces_produced) as total_pieces,
                COUNT(*) as work_days
            FROM daily_operations
            WHERE worker_id = ?
            AND date BETWEEN ? AND ?
        `).get(workerId, periodStart, periodEnd);
    }

    getAdvances(workerId, isDeducted = false) {
        return this.db.prepare(`
            SELECT * FROM advances 
            WHERE worker_id = ? 
            AND is_deducted = ?
            ORDER BY date DESC
        `).all(workerId, isDeducted ? 1 : 0);
    }

    getExpensesByDateRange(startDate, endDate) {
        return this.db.prepare(`
            SELECT * FROM expenses 
            WHERE date BETWEEN ? AND ?
            ORDER BY date DESC
        `).all(startDate, endDate);
    }

    getTotalExpensesByCategory(startDate, endDate) {
        return this.db.prepare(`
            SELECT 
                category,
                SUM(amount) as total,
                COUNT(*) as count
            FROM expenses
            WHERE date BETWEEN ? AND ?
            GROUP BY category
            ORDER BY total DESC
        `).all(startDate, endDate);
    }

    async close() {
        if (this.backupInterval) {
            clearInterval(this.backupInterval);
        }
        
        if (this.db) {
            this.db.close();
            console.log('🗄️ تم إغلاق قاعدة البيانات');
        }
    }
}

module.exports = { DatabaseService };