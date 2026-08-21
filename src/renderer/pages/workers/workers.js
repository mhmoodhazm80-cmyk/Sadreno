class WorkersController {
    constructor() {
        this.workers = [];
        this.currentPage = 1;
        this.pageSize = 10;
        this.searchTerm = '';
        this.filterStatus = 'all';
        this.editMode = false;
        this.currentWorkerId = null;
        this.readOnlyMode = false;
        this.animations = [];
    }

    async initialize() {
        try {
            await this.checkReadOnlyMode();
            await this.loadWorkers();
            this.setupEventListeners();
            this.setupModalEvents();
            this.setupTableAnimations();
            return true;
        } catch (error) {
            console.error('فشل تهيئة إدارة العمال:', error);
            await window.electronAPI.logError(error);
            return false;
        }
    }

    async checkReadOnlyMode() {
        try {
            this.readOnlyMode = await window.electronAPI.getReadOnly();
            
            if (this.readOnlyMode) {
                document.getElementById('addWorkerBtn').disabled = true;
                document.querySelectorAll('.btn-action.edit, .btn-action.delete').forEach(btn => {
                    btn.disabled = true;
                });
            }
        } catch (error) {
            console.error('خطأ في التحقق من وضع القراءة فقط:', error);
        }
    }

    async loadWorkers() {
        try {
            let query = 'SELECT * FROM workers WHERE 1=1';
            const params = [];

            if (this.searchTerm) {
                query += ' AND name LIKE ?';
                params.push(`%${this.searchTerm}%`);
            }

            if (this.filterStatus !== 'all') {
                query += ' AND is_active = ?';
                params.push(this.filterStatus === 'active' ? 1 : 0);
            }

            query += ' ORDER BY created_at DESC';

            this.workers = await window.electronAPI.dbQuery(query, params);
            this.renderTable();
        } catch (error) {
            console.error('خطأ في تحميل العمال:', error);
            throw error;
        }
    }

    renderTable() {
        const tbody = document.getElementById('workersTableBody');
        tbody.innerHTML = '';

        if (!this.workers || this.workers.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #9BA5AF; padding: 40px;">
                        <div style="font-size: 48px; margin-bottom: 10px;">👷</div>
                        لا يوجد عمال. قم بإضافة عامل جديد.
                    </td>
                </tr>
            `;
            return;
        }

        const start = (this.currentPage - 1) * this.pageSize;
        const end = Math.min(start + this.pageSize, this.workers.length);
        const pageData = this.workers.slice(start, end);

        for (const worker of pageData) {
            const tr = document.createElement('tr');
            
            const statusClass = worker.is_active ? 'active' : 'inactive';
            const statusText = worker.is_active ? 'نشط' : 'غير نشط';
            
            const salaryTypes = {
                'hourly': 'ساعي',
                'daily': 'يومي',
                'monthly': 'شهري',
                'piece': 'بالقطعة'
            };

            const isReadOnly = this.readOnlyMode ? 'disabled' : '';

            tr.innerHTML = `
                <td>${worker.id}</td>
                <td><strong>${worker.name}</strong></td>
                <td>${worker.position || 'غير محدد'}</td>
                <td>${salaryTypes[worker.salary_type] || worker.salary_type}</td>
                <td>${this.formatCurrency(worker.salary_rate)}</td>
                <td>${worker.phone || '-'}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action edit" data-id="${worker.id}" ${isReadOnly}>✏️ تعديل</button>
                        <button class="btn-action delete" data-id="${worker.id}" ${isReadOnly}>🗑️ حذف</button>
                    </div>
                </td>
            `;

            tbody.appendChild(tr);
        }

        // إضافة أحداث للأزرار
        tbody.querySelectorAll('.btn-action.edit:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => this.editWorker(parseInt(btn.dataset.id)));
        });

        tbody.querySelectorAll('.btn-action.delete:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => this.deleteWorker(parseInt(btn.dataset.id)));
        });
    }

    setupTableAnimations() {
        // تأثيرات عند تمرير الماوس على الصفوف
        const rows = document.querySelectorAll('.workers-table tbody tr');
        rows.forEach(row => {
            row.addEventListener('mouseenter', () => {
                row.style.transform = 'scale(1.01)';
                row.style.backgroundColor = 'rgba(43, 45, 66, 0.1)';
            });
            
            row.addEventListener('mouseleave', () => {
                row.style.transform = 'scale(1)';
                row.style.backgroundColor = 'transparent';
            });
        });
    }

    setupEventListeners() {
        // بحث
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchTerm = e.target.value;
            this.currentPage = 1;
            this.loadWorkers();
        });

        // فلتر
        document.getElementById('filterSelect').addEventListener('change', (e) => {
            this.filterStatus = e.target.value;
            this.currentPage = 1;
            this.loadWorkers();
        });

        // إضافة عامل
        const addBtn = document.getElementById('addWorkerBtn');
        if (!this.readOnlyMode) {
            addBtn.addEventListener('click', () => {
                this.openModal();
            });
        }

        // نموذج العامل
        document.getElementById('workerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveWorker();
        });

        // تغيير نظام الأجر
        document.getElementById('salaryType').addEventListener('change', (e) => {
            const pieceRateGroup = document.getElementById('pieceRateGroup');
            if (e.target.value === 'piece') {
                pieceRateGroup.style.display = 'block';
                document.getElementById('pieceRate').required = true;
            } else {
                pieceRateGroup.style.display = 'none';
                document.getElementById('pieceRate').required = false;
            }
        });
    }

    setupModalEvents() {
        const modal = document.getElementById('workerModal');
        const closeBtn = document.getElementById('modalClose');
        const cancelBtn = document.getElementById('cancelBtn');

        const closeModal = () => {
            modal.classList.remove('active');
            this.resetForm();
        };

        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        // إغلاق بالضغط على ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeModal();
            }
        });
    }

    openModal(worker = null) {
        if (this.readOnlyMode) {
            alert('⚠️ وضع القراءة فقط - لا يمكن إضافة أو تعديل البيانات');
            return;
        }

        const modal = document.getElementById('workerModal');
        const title = document.getElementById('modalTitle');
        const submitBtn = document.getElementById('submitBtn');
        
        if (worker) {
            title.textContent = '✏️ تعديل بيانات العامل';
            submitBtn.textContent = 'تحديث';
            this.editMode = true;
            this.currentWorkerId = worker.id;
            
            document.getElementById('workerName').value = worker.name || '';
            document.getElementById('workerPosition').value = worker.position || '';
            document.getElementById('salaryType').value = worker.salary_type || 'monthly';
            document.getElementById('salaryRate').value = worker.salary_rate || '';
            document.getElementById('pieceRate').value = worker.piece_rate || '';
            document.getElementById('workerPhone').value = worker.phone || '';
            document.getElementById('nationalId').value = worker.national_id || '';
            document.getElementById('workerAddress').value = worker.address || '';
            document.getElementById('hireDate').value = worker.hire_date || '';
            
            // إظهار/إخفاء سعر القطعة
            const pieceRateGroup = document.getElementById('pieceRateGroup');
            if (worker.salary_type === 'piece') {
                pieceRateGroup.style.display = 'block';
                document.getElementById('pieceRate').required = true;
            } else {
                pieceRateGroup.style.display = 'none';
                document.getElementById('pieceRate').required = false;
            }
        } else {
            title.textContent = '➕ إضافة عامل جديد';
            submitBtn.textContent = 'حفظ';
            this.editMode = false;
            this.currentWorkerId = null;
            this.resetForm();
        }

        modal.classList.add('active');
        // تركيز على أول حقل
        setTimeout(() => {
            document.getElementById('workerName').focus();
        }, 100);
    }

    resetForm() {
        document.getElementById('workerId').value = '';
        document.getElementById('workerName').value = '';
        document.getElementById('workerPosition').value = '';
        document.getElementById('salaryType').value = 'monthly';
        document.getElementById('salaryRate').value = '';
        document.getElementById('pieceRate').value = '';
        document.getElementById('workerPhone').value = '';
        document.getElementById('nationalId').value = '';
        document.getElementById('workerAddress').value = '';
        document.getElementById('hireDate').value = new Date().toISOString().slice(0, 10);
        
        document.getElementById('pieceRateGroup').style.display = 'none';
        document.getElementById('pieceRate').required = false;
    }

    async saveWorker() {
        try {
            if (this.readOnlyMode) {
                alert('⚠️ وضع القراءة فقط - لا يمكن إجراء تغييرات');
                return;
            }

            const data = {
                name: document.getElementById('workerName').value.trim(),
                position: document.getElementById('workerPosition').value.trim(),
                salary_type: document.getElementById('salaryType').value,
                salary_rate: parseFloat(document.getElementById('salaryRate').value) || 0,
                piece_rate: parseFloat(document.getElementById('pieceRate').value) || 0,
                phone: document.getElementById('workerPhone').value.trim(),
                national_id: document.getElementById('nationalId').value.trim(),
                address: document.getElementById('workerAddress').value.trim(),
                hire_date: document.getElementById('hireDate').value || new Date().toISOString().slice(0, 10)
            };

            // التحقق من البيانات
            if (!data.name) {
                alert('⚠️ الرجاء إدخال اسم العامل');
                document.getElementById('workerName').focus();
                return;
            }

            let result;
            if (this.editMode && this.currentWorkerId) {
                // تحديث عامل موجود
                result = await window.electronAPI.dbRun(`
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
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [
                    data.name,
                    data.position,
                    data.salary_type,
                    data.salary_rate,
                    data.piece_rate,
                    data.phone,
                    data.national_id,
                    data.address,
                    data.hire_date,
                    this.currentWorkerId
                ]);

                // تسجيل النشاط
                await window.electronAPI.dbRun(`
                    INSERT INTO activity_log (user, action, target_table, target_id, new_data)
                    VALUES ('system', 'update', 'workers', ?, ?)
                `, [this.currentWorkerId, JSON.stringify(data)]);

            } else {
                // إضافة عامل جديد
                result = await window.electronAPI.dbRun(`
                    INSERT INTO workers (
                        name, position, salary_type, salary_rate, piece_rate,
                        phone, national_id, address, hire_date, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                `, [
                    data.name,
                    data.position,
                    data.salary_type,
                    data.salary_rate,
                    data.piece_rate,
                    data.phone,
                    data.national_id,
                    data.address,
                    data.hire_date
                ]);

                // تسجيل النشاط
                await window.electronAPI.dbRun(`
                    INSERT INTO activity_log (user, action, target_table, target_id, new_data)
                    VALUES ('system', 'insert', 'workers', ?, ?)
                `, [result.lastID, JSON.stringify(data)]);
            }

            // إغلاق المودال وتحديث القائمة
            document.getElementById('workerModal').classList.remove('active');
            await this.loadWorkers();

            // عرض رسالة نجاح
            this.showToast(this.editMode ? '✅ تم تحديث بيانات العامل بنجاح' : '✅ تم إضافة العامل بنجاح');

        } catch (error) {
            console.error('خطأ في حفظ بيانات العامل:', error);
            alert('❌ حدث خطأ في حفظ البيانات. يرجى المحاولة مرة أخرى.');
        }
    }

    async editWorker(workerId) {
        try {
            const worker = this.workers.find(w => w.id === workerId);
            if (worker) {
                this.openModal(worker);
            }
        } catch (error) {
            console.error('خطأ في فتح بيانات العامل:', error);
        }
    }

    async deleteWorker(workerId) {
        try {
            if (this.readOnlyMode) {
                alert('⚠️ وضع القراءة فقط - لا يمكن حذف البيانات');
                return;
            }

            const confirmDelete = confirm('⚠️ هل أنت متأكد من حذف هذا العامل؟');
            if (!confirmDelete) return;

            // حذف العامل (تعطيله بدلاً من الحذف الفعلي)
            await window.electronAPI.dbRun(
                'UPDATE workers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [workerId]
            );

            // تسجيل النشاط
            await window.electronAPI.dbRun(`
                INSERT INTO activity_log (user, action, target_table, target_id)
                VALUES ('system', 'delete', 'workers', ?)
            `, [workerId]);

            await this.loadWorkers();
            this.showToast('🗑️ تم حذف العامل بنجاح');
        } catch (error) {
            console.error('خطأ في حذف العامل:', error);
            alert('❌ حدث خطأ في حذف العامل. يرجى المحاولة مرة أخرى.');
        }
    }

    showToast(message) {
        // إنشاء توست مؤقت
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
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideDown 0.4s ease forwards';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 400);
        }, 3000);
    }

    formatCurrency(amount) {
        if (!amount) return '0 ج.م';
        return new Intl.NumberFormat('ar-EG', {
            style: 'currency',
            currency: 'EGP',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    }
}

// إضافة أنيميشن slideDown
const style = document.createElement('style');
style.textContent = `
    @keyframes slideDown {
        from {
            opacity: 1;
            transform: translateY(0);
        }
        to {
            opacity: 0;
            transform: translateY(20px);
        }
    }
`;
document.head.appendChild(style);

// تشغيل إدارة العمال
document.addEventListener('DOMContentLoaded', async () => {
    const workers = new WorkersController();
    await workers.initialize();
    
    window.__workers = workers;
});