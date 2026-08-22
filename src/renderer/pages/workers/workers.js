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
        this.totalPages = 1;
        this.totalWorkers = 0;
        this.animations = [];
        this.isLoading = false;
    }

    async initialize() {
        try {
            await this.checkReadOnlyMode();
            await this.loadWorkers();
            this.setupEventListeners();
            this.setupModalEvents();
            this.setupAttendanceModalEvents();
            this.setupTableAnimations();
            this.setupPagination();
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
                document.getElementById('importBtn').disabled = true;
                document.querySelectorAll('.btn-action.edit, .btn-action.delete, .btn-action.attendance').forEach(btn => {
                    btn.disabled = true;
                });
            }
        } catch (error) {
            console.error('خطأ في التحقق من وضع القراءة فقط:', error);
        }
    }

    setupPagination() {
        document.getElementById('prevPage').addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.loadWorkers();
            }
        });

        document.getElementById('nextPage').addEventListener('click', () => {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                this.loadWorkers();
            }
        });
    }

    updatePagination() {
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageInfo = document.getElementById('pageInfo');

        prevBtn.disabled = this.currentPage <= 1;
        nextBtn.disabled = this.currentPage >= this.totalPages;
        pageInfo.textContent = `الصفحة ${this.currentPage} من ${this.totalPages || 1}`;
    }

    async loadWorkers() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            let query = 'SELECT * FROM workers WHERE 1=1';
            const params = [];

            if (this.searchTerm) {
                query += ' AND name LIKE ?';
                params.push(`%${this.searchTerm}%`);
            }

            if (this.filterStatus !== 'all') {
                if (this.filterStatus === 'active') {
                    query += ' AND is_active = 1';
                } else if (this.filterStatus === 'inactive') {
                    query += ' AND is_active = 0';
                } else if (this.filterStatus === 'on_leave') {
                    query += ' AND is_active = 2';
                }
            }

            // حساب العدد الإجمالي للصفحات
            const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
            const countResult = await window.electronAPI.dbQuery(countQuery, params);
            this.totalWorkers = countResult[0]?.total || 0;
            this.totalPages = Math.ceil(this.totalWorkers / this.pageSize) || 1;

            if (this.currentPage > this.totalPages) {
                this.currentPage = this.totalPages;
            }

            const offset = (this.currentPage - 1) * this.pageSize;
            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(this.pageSize, offset);

            this.workers = await window.electronAPI.dbQuery(query, params);
            this.renderTable();
            this.updatePagination();
        } catch (error) {
            console.error('خطأ في تحميل العمال:', error);
            this.showToast('❌ حدث خطأ في تحميل البيانات', 'error');
        } finally {
            this.isLoading = false;
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
                        ${!this.readOnlyMode ? '<br><small>اضغط على "إضافة عامل" للبدء</small>' : ''}
                    </td>
                </tr>
            `;
            return;
        }

        const isReadOnly = this.readOnlyMode;

        for (const worker of this.workers) {
            const tr = document.createElement('tr');
            
            let statusClass = 'active';
            let statusText = 'نشط';
            if (worker.is_active === 0) {
                statusClass = 'inactive';
                statusText = 'غير نشط';
            } else if (worker.is_active === 2) {
                statusClass = 'on_leave';
                statusText = 'في إجازة';
            }
            
            const salaryTypes = {
                'hourly': 'ساعي',
                'daily': 'يومي',
                'monthly': 'شهري',
                'piece': 'بالقطعة'
            };

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
                        <button class="btn-action edit" data-id="${worker.id}" ${isReadOnly ? 'disabled' : ''}>✏️ تعديل</button>
                        <button class="btn-action attendance" data-id="${worker.id}" ${isReadOnly ? 'disabled' : ''}>📋 حضور</button>
                        <button class="btn-action delete" data-id="${worker.id}" ${isReadOnly ? 'disabled' : ''}>🗑️ حذف</button>
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

        tbody.querySelectorAll('.btn-action.attendance:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => this.openAttendanceModal(parseInt(btn.dataset.id)));
        });
    }

    setupTableAnimations() {
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

        // استيراد
        const importBtn = document.getElementById('importBtn');
        if (!this.readOnlyMode) {
            importBtn.addEventListener('click', () => {
                this.importWorkers();
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

        // نموذج الحضور
        document.getElementById('attendanceForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveAttendance();
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

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeModal();
            }
        });
    }

    setupAttendanceModalEvents() {
        const modal = document.getElementById('attendanceModal');
        const closeBtn = document.getElementById('attendanceClose');
        const cancelBtn = document.getElementById('attendanceCancel');

        const closeModal = () => {
            modal.classList.remove('active');
            document.getElementById('attendanceForm').reset();
        };

        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeModal();
            }
        });
    }

    openModal(worker = null) {
        if (this.readOnlyMode) {
            this.showToast('⚠️ وضع القراءة فقط - لا يمكن إضافة أو تعديل البيانات', 'error');
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
            document.getElementById('workerStatus').value = worker.is_active !== undefined ? worker.is_active : 1;
            
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
        document.getElementById('workerStatus').value = '1';
        
        document.getElementById('pieceRateGroup').style.display = 'none';
        document.getElementById('pieceRate').required = false;
    }

    async saveWorker() {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن إجراء تغييرات', 'error');
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
                hire_date: document.getElementById('hireDate').value || new Date().toISOString().slice(0, 10),
                is_active: parseInt(document.getElementById('workerStatus').value) || 1
            };

            if (!data.name) {
                this.showToast('⚠️ الرجاء إدخال اسم العامل', 'error');
                document.getElementById('workerName').focus();
                return;
            }

            let result;
            if (this.editMode && this.currentWorkerId) {
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
                        is_active = ?,
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
                    data.is_active,
                    this.currentWorkerId
                ]);

                await window.electronAPI.auditLog('update', { table: 'workers', id: this.currentWorkerId }, data);
                this.showToast('✅ تم تحديث بيانات العامل بنجاح');
            } else {
                result = await window.electronAPI.dbRun(`
                    INSERT INTO workers (
                        name, position, salary_type, salary_rate, piece_rate,
                        phone, national_id, address, hire_date, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    data.is_active
                ]);

                await window.electronAPI.auditLog('insert', { table: 'workers', id: result.lastID }, data);
                this.showToast('✅ تم إضافة العامل بنجاح');
            }

            document.getElementById('workerModal').classList.remove('active');
            await this.loadWorkers();

        } catch (error) {
            console.error('خطأ في حفظ بيانات العامل:', error);
            this.showToast('❌ حدث خطأ في حفظ البيانات', 'error');
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
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن حذف البيانات', 'error');
                return;
            }

            const confirmDelete = confirm('⚠️ هل أنت متأكد من حذف هذا العامل؟');
            if (!confirmDelete) return;

            await window.electronAPI.dbRun(
                'UPDATE workers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [workerId]
            );

            await window.electronAPI.auditLog('delete', { table: 'workers', id: workerId }, {});
            await this.loadWorkers();
            this.showToast('🗑️ تم حذف العامل بنجاح');
        } catch (error) {
            console.error('خطأ في حذف العامل:', error);
            this.showToast('❌ حدث خطأ في حذف العامل', 'error');
        }
    }

    async openAttendanceModal(workerId) {
        if (this.readOnlyMode) {
            this.showToast('⚠️ وضع القراءة فقط - لا يمكن تسجيل الحضور', 'error');
            return;
        }

        try {
            const worker = this.workers.find(w => w.id === workerId);
            if (!worker) {
                this.showToast('⚠️ العامل غير موجود', 'error');
                return;
            }

            const modal = document.getElementById('attendanceModal');
            document.getElementById('attendanceWorkerId').value = workerId;
            document.getElementById('attendanceWorkerName').value = worker.name;
            document.getElementById('attendanceDate').value = new Date().toISOString().slice(0, 10);
            document.getElementById('attendanceStatus').value = 'present';
            document.getElementById('attendanceHours').value = 8;
            document.getElementById('attendanceOvertime').value = 0;
            document.getElementById('attendancePieces').value = 0;
            document.getElementById('attendanceDefective').value = 0;
            document.getElementById('attendanceNotes').value = '';

            modal.classList.add('active');
        } catch (error) {
            console.error('خطأ في فتح نموذج الحضور:', error);
            this.showToast('❌ حدث خطأ', 'error');
        }
    }

    async saveAttendance() {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن تسجيل الحضور', 'error');
                return;
            }

            const workerId = parseInt(document.getElementById('attendanceWorkerId').value);
            const date = document.getElementById('attendanceDate').value;
            const status = document.getElementById('attendanceStatus').value;
            const hoursWorked = parseFloat(document.getElementById('attendanceHours').value) || 0;
            const overtime = parseFloat(document.getElementById('attendanceOvertime').value) || 0;
            const pieces = parseInt(document.getElementById('attendancePieces').value) || 0;
            const defective = parseInt(document.getElementById('attendanceDefective').value) || 0;
            const notes = document.getElementById('attendanceNotes').value.trim();

            if (!date) {
                this.showToast('⚠️ الرجاء اختيار التاريخ', 'error');
                return;
            }

            // التحقق من وجود سجل مسبق لنفس اليوم
            const existing = await window.electronAPI.dbQuery(
                'SELECT id FROM daily_operations WHERE worker_id = ? AND date = ?',
                [workerId, date]
            );

            if (existing && existing.length > 0) {
                const confirmUpdate = confirm(`⚠️ يوجد سجل حضور لهذا العامل في تاريخ ${date}. هل تريد تحديثه؟`);
                if (!confirmUpdate) return;

                await window.electronAPI.dbRun(`
                    UPDATE daily_operations 
                    SET 
                        status = ?,
                        hours_worked = ?,
                        overtime_hours = ?,
                        pieces_produced = ?,
                        defective_pieces = ?,
                        notes = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE worker_id = ? AND date = ?
                `, [status, hoursWorked, overtime, pieces, defective, notes, workerId, date]);
            } else {
                await window.electronAPI.dbRun(`
                    INSERT INTO daily_operations (
                        worker_id, date, status, hours_worked, overtime_hours,
                        pieces_produced, defective_pieces, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [workerId, date, status, hoursWorked, overtime, pieces, defective, notes]);
            }

            await window.electronAPI.auditLog('insert', { table: 'daily_operations', id: workerId }, {
                date, status, hoursWorked, overtime, pieces, defective
            });

            document.getElementById('attendanceModal').classList.remove('active');
            document.getElementById('attendanceForm').reset();
            this.showToast('✅ تم تسجيل الحضور بنجاح');
            await this.loadWorkers();

        } catch (error) {
            console.error('خطأ في حفظ الحضور:', error);
            this.showToast('❌ حدث خطأ في حفظ الحضور', 'error');
        }
    }

    async importWorkers() {
        if (this.readOnlyMode) {
            this.showToast('⚠️ وضع القراءة فقط - لا يمكن استيراد البيانات', 'error');
            return;
        }

        try {
            // استخدام dialog لاختيار الملف
            const result = await window.electronAPI.importExcel();
            if (!result || result.length === 0) {
                this.showToast('⚠️ لا توجد بيانات للاستيراد', 'warning');
                return;
            }

            let importedCount = 0;
            for (const row of result) {
                if (row.name) {
                    await window.electronAPI.dbRun(`
                        INSERT INTO workers (
                            name, position, salary_type, salary_rate,
                            phone, address, hire_date, is_active
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    `, [
                        row.name,
                        row.position || '',
                        row.salary_type || 'monthly',
                        parseFloat(row.salary_rate) || 0,
                        row.phone || '',
                        row.address || '',
                        row.hire_date || new Date().toISOString().slice(0, 10)
                    ]);
                    importedCount++;
                }
            }

            await this.loadWorkers();
            this.showToast(`✅ تم استيراد ${importedCount} عامل بنجاح`);
        } catch (error) {
            console.error('خطأ في استيراد العمال:', error);
            this.showToast('❌ حدث خطأ في استيراد البيانات', 'error');
        }
    }

    showToast(message, type = 'success') {
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
        `;
        
        const icon = type === 'success' ? '✅' : (type === 'warning' ? '⚠️' : '❌');
        toast.textContent = `${icon} ${message}`;
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

// تشغيل إدارة العمال
document.addEventListener('DOMContentLoaded', async () => {
    const workers = new WorkersController();
    await workers.initialize();
    window.__workers = workers;
});