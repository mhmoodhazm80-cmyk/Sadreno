// src/renderer/utils/database-helper.js

class DatabaseHelper {
    constructor() {
        this.isConnected = false;
        this.initialized = false;
    }

    async initialize() {
        try {
            if (!window.electronAPI) {
                console.error('❌ Electron API غير متاح');
                return false;
            }
            this.isConnected = true;
            this.initialized = true;
            console.log('✅ Database Helper initialized');
            return true;
        } catch (error) {
            console.error('❌ فشل تهيئة Database Helper:', error);
            return false;
        }
    }

    // ========================================
    // دوال العمال
    // ========================================

    async getWorkers(filters = {}) {
        try {
            let query = 'SELECT * FROM workers WHERE 1=1';
            const params = [];

            if (filters.search) {
                query += ' AND name LIKE ?';
                params.push(`%${filters.search}%`);
            }

            if (filters.status !== undefined && filters.status !== 'all') {
                query += ' AND is_active = ?';
                params.push(filters.status === 'active' ? 1 : 0);
            }

            query += ' ORDER BY created_at DESC';

            return await window.electronAPI.dbQuery(query, params);
        } catch (error) {
            console.error('خطأ في جلب العمال:', error);
            throw error;
        }
    }

    async getWorker(id) {
        try {
            const result = await window.electronAPI.dbQuery('SELECT * FROM workers WHERE id = ?', [id]);
            return result[0] || null;
        } catch (error) {
            console.error('خطأ في جلب العامل:', error);
            throw error;
        }
    }

    async addWorker(data) {
        try {
            const result = await window.electronAPI.dbRun(`
                INSERT INTO workers (
                    name, position, salary_type, salary_rate, piece_rate,
                    phone, national_id, address, hire_date, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                data.name,
                data.position || '',
                data.salary_type || 'monthly',
                data.salary_rate || 0,
                data.piece_rate || 0,
                data.phone || '',
                data.national_id || '',
                data.address || '',
                data.hire_date || new Date().toISOString().slice(0, 10),
                data.is_active !== undefined ? data.is_active : 1
            ]);

            await this.logActivity('insert', 'workers', result.lastID, data);
            return result;
        } catch (error) {
            console.error('خطأ في إضافة العامل:', error);
            throw error;
        }
    }

    async updateWorker(id, data) {
        try {
            const result = await window.electronAPI.dbRun(`
                UPDATE workers 
                SET 
                    name = ?,
                    position = ?,
                    salary_type = ?,
                    salary_rate = ?,
                    piece_rate = ?,
                    phone = ?,
                    national_id = ?,
                    address = ?,
                    hire_date = ?,
                    is_active = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                data.name,
                data.position || '',
                data.salary_type || 'monthly',
                data.salary_rate || 0,
                data.piece_rate || 0,
                data.phone || '',
                data.national_id || '',
                data.address || '',
                data.hire_date || new Date().toISOString().slice(0, 10),
                data.is_active !== undefined ? data.is_active : 1,
                id
            ]);

            await this.logActivity('update', 'workers', id, data);
            return result;
        } catch (error) {
            console.error('خطأ في تحديث العامل:', error);
            throw error;
        }
    }

    async deleteWorker(id) {
        try {
            const result = await window.electronAPI.dbRun(
                'UPDATE workers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [id]
            );
            await this.logActivity('delete', 'workers', id, {});
            return result;
        } catch (error) {
            console.error('خطأ في حذف العامل:', error);
            throw error;
        }
    }

    // ========================================
    // دوال المصروفات
    // ========================================

    async getExpenses(filters = {}) {
        try {
            let query = 'SELECT * FROM expenses WHERE 1=1';
            const params = [];

            if (filters.startDate) {
                query += ' AND date >= ?';
                params.push(filters.startDate);
            }

            if (filters.endDate) {
                query += ' AND date <= ?';
                params.push(filters.endDate);
            }

            if (filters.category) {
                query += ' AND category = ?';
                params.push(filters.category);
            }

            if (filters.search) {
                query += ' AND (description LIKE ? OR category LIKE ?)';
                const searchPattern = `%${filters.search}%`;
                params.push(searchPattern, searchPattern);
            }

            query += ' ORDER BY date DESC, created_at DESC';

            return await window.electronAPI.dbQuery(query, params);
        } catch (error) {
            console.error('خطأ في جلب المصروفات:', error);
            throw error;
        }
    }

    async addExpense(data) {
        try {
            const result = await window.electronAPI.dbRun(`
                INSERT INTO expenses (
                    category, amount, description, date, payment_method,
                    vendor_name, check_number, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                data.category,
                data.amount,
                data.description || '',
                data.date || new Date().toISOString().slice(0, 10),
                data.payment_method || 'cash',
                data.vendor_name || '',
                data.check_number || ''
            ]);

            await this.logActivity('insert', 'expenses', result.lastID, data);
            return result;
        } catch (error) {
            console.error('خطأ في إضافة المصروف:', error);
            throw error;
        }
    }

    async updateExpense(id, data) {
        try {
            const result = await window.electronAPI.dbRun(`
                UPDATE expenses 
                SET 
                    category = ?,
                    amount = ?,
                    description = ?,
                    date = ?,
                    payment_method = ?,
                    vendor_name = ?,
                    check_number = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                data.category,
                data.amount,
                data.description || '',
                data.date || new Date().toISOString().slice(0, 10),
                data.payment_method || 'cash',
                data.vendor_name || '',
                data.check_number || '',
                id
            ]);

            await this.logActivity('update', 'expenses', id, data);
            return result;
        } catch (error) {
            console.error('خطأ في تحديث المصروف:', error);
            throw error;
        }
    }

    async deleteExpense(id) {
        try {
            const result = await window.electronAPI.dbRun('DELETE FROM expenses WHERE id = ?', [id]);
            await this.logActivity('delete', 'expenses', id, {});
            return result;
        } catch (error) {
            console.error('خطأ في حذف المصروف:', error);
            throw error;
        }
    }

    // ========================================
    // دوال الرواتب والسلف
    // ========================================

    async getPayroll(filters = {}) {
        try {
            let query = `
                SELECT 
                    p.*,
                    w.name as worker_name,
                    w.salary_type,
                    w.salary_rate
                FROM payroll p
                JOIN workers w ON w.id = p.worker_id
                WHERE 1=1
            `;
            const params = [];

            if (filters.startDate) {
                query += ' AND p.period_start >= ?';
                params.push(filters.startDate);
            }

            if (filters.endDate) {
                query += ' AND p.period_end <= ?';
                params.push(filters.endDate);
            }

            query += ' ORDER BY p.created_at DESC';

            return await window.electronAPI.dbQuery(query, params);
        } catch (error) {
            console.error('خطأ في جلب الرواتب:', error);
            throw error;
        }
    }

    async getAdvances(workerId = null) {
        try {
            let query = `
                SELECT 
                    a.*,
                    w.name as worker_name
                FROM advances a
                JOIN workers w ON w.id = a.worker_id
                WHERE a.type = 'advance'
            `;
            const params = [];

            if (workerId) {
                query += ' AND a.worker_id = ?';
                params.push(workerId);
            }

            query += ' ORDER BY a.created_at DESC';

            return await window.electronAPI.dbQuery(query, params);
        } catch (error) {
            console.error('خطأ في جلب السلف:', error);
            throw error;
        }
    }

    async addAdvance(data) {
        try {
            const result = await window.electronAPI.dbRun(`
                INSERT INTO advances (
                    worker_id, amount, date, description, type,
                    is_deducted, created_at
                ) VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
            `, [
                data.worker_id,
                data.amount,
                data.date || new Date().toISOString().slice(0, 10),
                data.description || '',
                data.type || 'advance'
            ]);

            await this.logActivity('insert', 'advances', result.lastID, data);
            return result;
        } catch (error) {
            console.error('خطأ في إضافة السلفة:', error);
            throw error;
        }
    }

    async deductAdvance(id) {
        try {
            const result = await window.electronAPI.dbRun(`
                UPDATE advances 
                SET is_deducted = 1, deducted_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [id]);

            await this.logActivity('update', 'advances', id, { action: 'deduct' });
            return result;
        } catch (error) {
            console.error('خطأ في خصم السلفة:', error);
            throw error;
        }
    }

    // ========================================
    // دوال منطقة العمل (Workspace)
    // ========================================

    async getWorkspaceGroups() {
        try {
            return await window.electronAPI.dbQuery('SELECT * FROM workspace_groups ORDER BY created_at DESC');
        } catch (error) {
            console.error('خطأ في جلب مجموعات منطقة العمل:', error);
            return [];
        }
    }

    async getWorkspaceFields(groupId) {
        try {
            return await window.electronAPI.dbQuery(
                'SELECT * FROM workspace_fields WHERE group_id = ? ORDER BY position ASC',
                [groupId]
            );
        } catch (error) {
            console.error('خطأ في جلب حقول منطقة العمل:', error);
            return [];
        }
    }

    async getWorkspaceImages(groupId) {
        try {
            return await window.electronAPI.dbQuery(
                'SELECT * FROM workspace_images WHERE group_id = ? ORDER BY position ASC',
                [groupId]
            );
        } catch (error) {
            console.error('خطأ في جلب صور منطقة العمل:', error);
            return [];
        }
    }

    async createWorkspaceGroup(data) {
        try {
            const result = await window.electronAPI.dbRun(`
                INSERT INTO workspace_groups (name, icon, type, created_at, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [data.name, data.icon || '📁', data.type || 'fields']);
            await this.logActivity('insert', 'workspace_groups', result.lastID, data);
            return result;
        } catch (error) {
            console.error('خطأ في إنشاء مجموعة منطقة العمل:', error);
            throw error;
        }
    }

    async updateWorkspaceGroup(id, data) {
        try {
            const result = await window.electronAPI.dbRun(`
                UPDATE workspace_groups 
                SET name = ?, icon = ?, type = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `, [data.name, data.icon || '📁', data.type || 'fields', id]);
            await this.logActivity('update', 'workspace_groups', id, data);
            return result;
        } catch (error) {
            console.error('خطأ في تحديث مجموعة منطقة العمل:', error);
            throw error;
        }
    }

    async deleteWorkspaceGroup(id) {
        try {
            const result = await window.electronAPI.dbRun('DELETE FROM workspace_groups WHERE id = ?', [id]);
            await this.logActivity('delete', 'workspace_groups', id, {});
            return result;
        } catch (error) {
            console.error('خطأ في حذف مجموعة منطقة العمل:', error);
            throw error;
        }
    }

    async createWorkspaceField(data) {
        try {
            const result = await window.electronAPI.dbRun(`
                INSERT INTO workspace_fields (group_id, label, type, options, position, is_required, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [
                data.group_id, data.label, data.type || 'text',
                data.options || '', data.position || 0, data.is_required || 0
            ]);
            await this.logActivity('insert', 'workspace_fields', result.lastID, data);
            return result;
        } catch (error) {
            console.error('خطأ في إنشاء حقل منطقة العمل:', error);
            throw error;
        }
    }

    async updateWorkspaceField(id, data) {
        try {
            const result = await window.electronAPI.dbRun(`
                UPDATE workspace_fields 
                SET label = ?, type = ?, options = ?, position = ?, is_required = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `, [data.label, data.type, data.options, data.position, data.is_required, id]);
            await this.logActivity('update', 'workspace_fields', id, data);
            return result;
        } catch (error) {
            console.error('خطأ في تحديث حقل منطقة العمل:', error);
            throw error;
        }
    }

    async deleteWorkspaceField(id) {
        try {
            const result = await window.electronAPI.dbRun('DELETE FROM workspace_fields WHERE id = ?', [id]);
            await this.logActivity('delete', 'workspace_fields', id, {});
            return result;
        } catch (error) {
            console.error('خطأ في حذف حقل منطقة العمل:', error);
            throw error;
        }
    }

    async createWorkspaceImage(data) {
        try {
            const result = await window.electronAPI.dbRun(`
                INSERT INTO workspace_images (group_id, path, name, description, position, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [
                data.group_id, data.path, data.name || 'صورة',
                data.description || '', data.position || 0
            ]);
            await this.logActivity('insert', 'workspace_images', result.lastID, data);
            return result;
        } catch (error) {
            console.error('خطأ في إضافة صورة منطقة العمل:', error);
            throw error;
        }
    }

    async deleteWorkspaceImage(id) {
        try {
            const result = await window.electronAPI.dbRun('DELETE FROM workspace_images WHERE id = ?', [id]);
            await this.logActivity('delete', 'workspace_images', id, {});
            return result;
        } catch (error) {
            console.error('خطأ في حذف صورة منطقة العمل:', error);
            throw error;
        }
    }

    // ========================================
    // دوال النسخ الاحتياطي
    // ========================================

    async createBackup() {
        try {
            return await window.electronAPI.createBackup();
        } catch (error) {
            console.error('خطأ في إنشاء النسخة الاحتياطية:', error);
            throw error;
        }
    }

    async restoreBackup(backupPath) {
        try {
            return await window.electronAPI.restoreBackup(backupPath);
        } catch (error) {
            console.error('خطأ في استعادة النسخة الاحتياطية:', error);
            throw error;
        }
    }

    // ========================================
    // دوال التصدير والاستيراد
    // ========================================

    async exportExcel(data, options = {}) {
        try {
            return await window.electronAPI.exportExcel(data, options);
        } catch (error) {
            console.error('خطأ في تصدير Excel:', error);
            throw error;
        }
    }

    async exportPDF(data, options = {}) {
        try {
            return await window.electronAPI.exportPDF(data, options);
        } catch (error) {
            console.error('خطأ في تصدير PDF:', error);
            throw error;
        }
    }

    async importExcel(filePath) {
        try {
            return await window.electronAPI.importExcel(filePath);
        } catch (error) {
            console.error('خطأ في استيراد Excel:', error);
            throw error;
        }
    }

    // ========================================
    // سجل العمليات (Audit Log)
    // ========================================

    async logActivity(action, table, id, data = {}) {
        try {
            await window.electronAPI.auditLog(action, { table, id }, data);
        } catch (error) {
            console.error('خطأ في تسجيل النشاط:', error);
        }
    }

    async getActivityLogs(limit = 50) {
        try {
            return await window.electronAPI.getAuditLogs(limit);
        } catch (error) {
            console.error('خطأ في جلب سجل العمليات:', error);
            return [];
        }
    }

    // ========================================
    // دوال النظام
    // ========================================

    async getSystemInfo() {
        try {
            return await window.electronAPI.getSystemInfo();
        } catch (error) {
            console.error('خطأ في جلب معلومات النظام:', error);
            return null;
        }
    }

    async getHWID() {
        try {
            return await window.electronAPI.getHWID();
        } catch (error) {
            console.error('خطأ في جلب HWID:', error);
            return null;
        }
    }

    async getReadOnly() {
        try {
            return await window.electronAPI.getReadOnly();
        } catch (error) {
            console.error('خطأ في جلب حالة القراءة فقط:', error);
            return true;
        }
    }

    async activateLicense(licenseKey) {
        try {
            return await window.electronAPI.activateLicense(licenseKey);
        } catch (error) {
            console.error('خطأ في تفعيل الترخيص:', error);
            return { success: false, message: error.message };
        }
    }

    async getLicenseStatus() {
        try {
            return await window.electronAPI.getLicenseStatus();
        } catch (error) {
            console.error('خطأ في جلب حالة الترخيص:', error);
            return null;
        }
    }

    // ========================================
    // دوال التشفير المتقدم
    // ========================================

    async encryptAdvanced(data) {
        try {
            return await window.electronAPI.encryptAdvanced(data);
        } catch (error) {
            console.error('خطأ في التشفير المتقدم:', error);
            return null;
        }
    }

    async decryptAdvanced(encryptedData) {
        try {
            return await window.electronAPI.decryptAdvanced(encryptedData);
        } catch (error) {
            console.error('خطأ في فك التشفير المتقدم:', error);
            return null;
        }
    }

    async generateLicense(data) {
        try {
            return await window.electronAPI.generateLicense(data);
        } catch (error) {
            console.error('خطأ في توليد كود الترخيص:', error);
            return null;
        }
    }

    async verifyLicense(licenseKey, deviceHWID) {
        try {
            return await window.electronAPI.verifyLicense(licenseKey, deviceHWID);
        } catch (error) {
            console.error('خطأ في التحقق من كود الترخيص:', error);
            return null;
        }
    }

    // ========================================
    // دوال الإحصائيات
    // ========================================

    async getDashboardStats() {
        try {
            const stats = {};
            
            const workersResult = await window.electronAPI.dbQuery(
                'SELECT COUNT(*) as total FROM workers WHERE is_active = 1'
            );
            stats.totalWorkers = workersResult[0]?.total || 0;
            
            const currentMonth = new Date().toISOString().slice(0, 7);
            const expensesResult = await window.electronAPI.dbQuery(
                'SELECT SUM(amount) as total FROM expenses WHERE strftime("%Y-%m", date) = ?',
                [currentMonth]
            );
            stats.monthlyExpenses = expensesResult[0]?.total || 0;
            
            const today = new Date().toISOString().slice(0, 10);
            const productionResult = await window.electronAPI.dbQuery(
                'SELECT SUM(pieces_produced) as total FROM daily_operations WHERE date = ?',
                [today]
            );
            stats.dailyProduction = productionResult[0]?.total || 0;
            
            const attendanceResult = await window.electronAPI.dbQuery(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present
                FROM daily_operations WHERE date = ?
            `, [today]);
            const total = attendanceResult[0]?.total || 1;
            const present = attendanceResult[0]?.present || 0;
            stats.todayAttendance = Math.round((present / total) * 100);
            
            const payrollResult = await window.electronAPI.dbQuery(
                'SELECT SUM(net_salary) as total FROM payroll WHERE is_paid = 0'
            );
            stats.pendingPayroll = payrollResult[0]?.total || 0;
            
            const advancesResult = await window.electronAPI.dbQuery(
                'SELECT COUNT(*) as total FROM advances WHERE is_deducted = 0'
            );
            stats.activeAdvances = advancesResult[0]?.total || 0;
            
            return stats;
        } catch (error) {
            console.error('خطأ في جلب إحصائيات لوحة التحكم:', error);
            return null;
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const db = new DatabaseHelper();
    await db.initialize();
    window.__db = db;
});