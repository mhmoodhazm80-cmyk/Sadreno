class ExpensesController {
    constructor() {
        this.expenses = [];
        this.filterStart = null;
        this.filterEnd = null;
        this.filterCategory = '';
        this.filterPaymentMethod = '';
        this.filterSearch = '';
        this.readOnlyMode = false;
        this.editMode = false;
        this.currentExpenseId = null;
        this.isLoading = false;
        this.db = window.__db || null;
    }

    async initialize() {
        try {
            if (!this.db) {
                this.db = new DatabaseHelper();
                await this.db.initialize();
                window.__db = this.db;
            }

            await this.checkReadOnlyMode();
            this.setDefaultFilters();
            this.setupEventListeners();
            this.setupModalEvents();
            await this.loadExpenses();
            this.updateStats();
            this.setupTableAnimations();
            return true;
        } catch (error) {
            console.error('فشل تهيئة المصروفات:', error);
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
                document.getElementById('addExpenseBtn').disabled = true;
                document.getElementById('importBtn').disabled = true;
                document.getElementById('exportBtn').disabled = true;
                document.querySelectorAll('.btn-action.edit, .btn-action.delete').forEach(btn => {
                    btn.disabled = true;
                });
            }
        } catch (error) {
            console.error('خطأ في التحقق من وضع القراءة فقط:', error);
        }
    }

    setDefaultFilters() {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        
        document.getElementById('filterStart').value = firstDay.toISOString().slice(0, 10);
        document.getElementById('filterEnd').value = now.toISOString().slice(0, 10);
        
        this.filterStart = firstDay;
        this.filterEnd = now;
    }

    setupEventListeners() {
        const addBtn = document.getElementById('addExpenseBtn');
        if (!this.readOnlyMode) {
            addBtn.addEventListener('click', () => {
                this.openModal();
            });
        }

        document.getElementById('exportBtn').addEventListener('click', async () => {
            await this.exportExpenses();
        });

        document.getElementById('importBtn').addEventListener('click', async () => {
            if (!this.readOnlyMode) {
                await this.importExpenses();
            }
        });

        document.getElementById('filterStart').addEventListener('change', (e) => {
            this.filterStart = e.target.value ? new Date(e.target.value) : null;
            this.loadExpenses();
        });

        document.getElementById('filterEnd').addEventListener('change', (e) => {
            this.filterEnd = e.target.value ? new Date(e.target.value) : null;
            this.loadExpenses();
        });

        document.getElementById('filterCategory').addEventListener('change', (e) => {
            this.filterCategory = e.target.value;
            this.loadExpenses();
        });

        document.getElementById('filterPaymentMethod').addEventListener('change', (e) => {
            this.filterPaymentMethod = e.target.value;
            this.loadExpenses();
        });

        document.getElementById('filterSearch').addEventListener('input', (e) => {
            this.filterSearch = e.target.value;
            this.loadExpenses();
        });

        document.getElementById('expensePaymentMethod').addEventListener('change', (e) => {
            const checkNumberGroup = document.getElementById('checkNumberGroup');
            if (e.target.value === 'check') {
                checkNumberGroup.style.display = 'block';
            } else {
                checkNumberGroup.style.display = 'none';
            }
        });
    }

    setupModalEvents() {
        const modal = document.getElementById('expenseModal');
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

        document.getElementById('expenseForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveExpense();
        });
    }

    setupTableAnimations() {
        const rows = document.querySelectorAll('.expenses-table tbody tr');
        rows.forEach(row => {
            row.addEventListener('mouseenter', () => {
                row.style.transform = 'scale(1.01)';
                row.style.backgroundColor = 'rgba(43, 45, 66, 0.05)';
            });
            
            row.addEventListener('mouseleave', () => {
                row.style.transform = 'scale(1)';
                row.style.backgroundColor = 'transparent';
            });
        });
    }

    async loadExpenses() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            let query = 'SELECT * FROM expenses WHERE 1=1';
            const params = [];

            if (this.filterStart) {
                query += ' AND date >= ?';
                params.push(this.filterStart.toISOString().slice(0, 10));
            }

            if (this.filterEnd) {
                query += ' AND date <= ?';
                params.push(this.filterEnd.toISOString().slice(0, 10));
            }

            if (this.filterCategory) {
                query += ' AND category = ?';
                params.push(this.filterCategory);
            }

            if (this.filterPaymentMethod) {
                query += ' AND payment_method = ?';
                params.push(this.filterPaymentMethod);
            }

            if (this.filterSearch) {
                query += ' AND (description LIKE ? OR category LIKE ? OR vendor_name LIKE ?)';
                const searchPattern = `%${this.filterSearch}%`;
                params.push(searchPattern, searchPattern, searchPattern);
            }

            query += ' ORDER BY date DESC, created_at DESC';

            this.expenses = await window.electronAPI.dbQuery(query, params);
            this.renderTable();
            this.updateStats();
        } catch (error) {
            console.error('خطأ في تحميل المصروفات:', error);
            this.showToast('❌ حدث خطأ في تحميل البيانات', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    renderTable() {
        const tbody = document.getElementById('expensesTableBody');
        tbody.innerHTML = '';

        if (!this.expenses || this.expenses.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #9BA5AF; padding: 40px;">
                        <div style="font-size: 48px; margin-bottom: 10px;">💸</div>
                        لا توجد مصروفات مسجلة
                    </td>
                </tr>
            `;
            return;
        }

        const isReadOnly = this.readOnlyMode;

        for (const expense of this.expenses) {
            const tr = document.createElement('tr');
            
            const paymentMethods = {
                'cash': 'نقدي',
                'bank': 'تحويل بنكي',
                'check': 'شيك'
            };

            const paymentClass = expense.payment_method || 'cash';

            tr.innerHTML = `
                <td>${expense.id}</td>
                <td><span style="color: #E8EDF2; font-weight: 600;">${expense.category}</span></td>
                <td>${expense.description || '-'}</td>
                <td><strong style="color: #E8EDF2;">${this.formatCurrency(expense.amount)}</strong></td>
                <td>${this.formatDate(expense.date)}</td>
                <td><span class="status-badge ${paymentClass}">${paymentMethods[expense.payment_method] || expense.payment_method}</span></td>
                <td>${expense.vendor_name || '-'}</td>
                <td>
                    <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                        <button class="btn-action edit" data-id="${expense.id}" ${isReadOnly ? 'disabled' : ''}>✏️ تعديل</button>
                        <button class="btn-action delete" data-id="${expense.id}" ${isReadOnly ? 'disabled' : ''}>🗑️ حذف</button>
                    </div>
                </td>
            `;

            tbody.appendChild(tr);
        }

        tbody.querySelectorAll('.btn-action.edit:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => this.editExpense(parseInt(btn.dataset.id)));
        });

        tbody.querySelectorAll('.btn-action.delete:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => this.deleteExpense(parseInt(btn.dataset.id)));
        });
    }

    updateStats() {
        if (!this.expenses || this.expenses.length === 0) {
            document.getElementById('totalExpenses').textContent = '0 ج.م';
            document.getElementById('averageExpenses').textContent = '0 ج.م';
            document.getElementById('maxExpense').textContent = '0 ج.م';
            document.getElementById('expenseCount').textContent = '0';
            return;
        }

        const total = this.expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const average = total / this.expenses.length;
        const max = Math.max(...this.expenses.map(exp => exp.amount));

        document.getElementById('totalExpenses').textContent = this.formatCurrency(total);
        document.getElementById('averageExpenses').textContent = this.formatCurrency(average);
        document.getElementById('maxExpense').textContent = this.formatCurrency(max);
        document.getElementById('expenseCount').textContent = this.expenses.length;
    }

    openModal(expense = null) {
        if (this.readOnlyMode) {
            this.showToast('⚠️ وضع القراءة فقط - لا يمكن إضافة أو تعديل المصروفات', 'error');
            return;
        }

        const modal = document.getElementById('expenseModal');
        const title = document.getElementById('modalTitle');
        const submitBtn = document.getElementById('submitBtn');
        
        if (expense) {
            title.textContent = '✏️ تعديل المصروف';
            submitBtn.textContent = 'تحديث';
            this.editMode = true;
            this.currentExpenseId = expense.id;
            
            document.getElementById('expenseCategory').value = expense.category || 'أخرى';
            document.getElementById('expenseAmount').value = expense.amount || '';
            document.getElementById('expenseDescription').value = expense.description || '';
            document.getElementById('expenseDate').value = expense.date || new Date().toISOString().slice(0, 10);
            document.getElementById('expensePaymentMethod').value = expense.payment_method || 'cash';
            document.getElementById('expenseVendor').value = expense.vendor_name || '';
            document.getElementById('expenseCheckNumber').value = expense.check_number || '';

            const checkNumberGroup = document.getElementById('checkNumberGroup');
            if (expense.payment_method === 'check') {
                checkNumberGroup.style.display = 'block';
            } else {
                checkNumberGroup.style.display = 'none';
            }
        } else {
            title.textContent = '➕ إضافة مصروف جديد';
            submitBtn.textContent = 'حفظ';
            this.editMode = false;
            this.currentExpenseId = null;
            this.resetForm();
        }

        modal.classList.add('active');
        setTimeout(() => {
            document.getElementById('expenseAmount').focus();
        }, 100);
    }

    resetForm() {
        document.getElementById('expenseId').value = '';
        document.getElementById('expenseCategory').value = 'أخرى';
        document.getElementById('expenseAmount').value = '';
        document.getElementById('expenseDescription').value = '';
        document.getElementById('expenseDate').value = new Date().toISOString().slice(0, 10);
        document.getElementById('expensePaymentMethod').value = 'cash';
        document.getElementById('expenseVendor').value = '';
        document.getElementById('expenseCheckNumber').value = '';
        
        document.getElementById('checkNumberGroup').style.display = 'none';
    }

    async saveExpense() {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن إجراء تغييرات', 'error');
                return;
            }

            const data = {
                category: document.getElementById('expenseCategory').value,
                amount: parseFloat(document.getElementById('expenseAmount').value) || 0,
                description: document.getElementById('expenseDescription').value.trim(),
                date: document.getElementById('expenseDate').value || new Date().toISOString().slice(0, 10),
                payment_method: document.getElementById('expensePaymentMethod').value,
                vendor_name: document.getElementById('expenseVendor').value.trim(),
                check_number: document.getElementById('expenseCheckNumber').value.trim()
            };

            if (!data.amount || data.amount <= 0) {
                this.showToast('⚠️ الرجاء إدخال مبلغ صحيح', 'error');
                document.getElementById('expenseAmount').focus();
                return;
            }

            if (!data.category) {
                this.showToast('⚠️ الرجاء اختيار الفئة', 'error');
                return;
            }

            let result;
            if (this.editMode && this.currentExpenseId) {
                result = await window.electronAPI.dbRun(`
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
                    data.description,
                    data.date,
                    data.payment_method,
                    data.vendor_name,
                    data.check_number,
                    this.currentExpenseId
                ]);

                await this.db.logActivity('update', 'expenses', this.currentExpenseId, data);
                this.showToast('✅ تم تحديث المصروف بنجاح', 'success');
            } else {
                result = await window.electronAPI.dbRun(`
                    INSERT INTO expenses (
                        category, amount, description, date, payment_method,
                        vendor_name, check_number, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    data.category,
                    data.amount,
                    data.description,
                    data.date,
                    data.payment_method,
                    data.vendor_name,
                    data.check_number
                ]);

                await this.db.logActivity('insert', 'expenses', result.lastID, data);
                this.showToast('✅ تم إضافة المصروف بنجاح', 'success');
            }

            document.getElementById('expenseModal').classList.remove('active');
            await this.loadExpenses();

        } catch (error) {
            console.error('خطأ في حفظ المصروف:', error);
            this.showToast('❌ حدث خطأ في حفظ البيانات', 'error');
        }
    }

    async editExpense(expenseId) {
        try {
            const expense = this.expenses.find(e => e.id === expenseId);
            if (expense) {
                this.openModal(expense);
            }
        } catch (error) {
            console.error('خطأ في فتح بيانات المصروف:', error);
        }
    }

    async deleteExpense(expenseId) {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن حذف المصروفات', 'error');
                return;
            }

            const confirmDelete = confirm('⚠️ هل أنت متأكد من حذف هذا المصروف؟');
            if (!confirmDelete) return;

            await window.electronAPI.dbRun('DELETE FROM expenses WHERE id = ?', [expenseId]);

            await this.db.logActivity('delete', 'expenses', expenseId, {});
            await this.loadExpenses();
            this.showToast('🗑️ تم حذف المصروف بنجاح', 'success');
        } catch (error) {
            console.error('خطأ في حذف المصروف:', error);
            this.showToast('❌ حدث خطأ في حذف المصروف', 'error');
        }
    }

    async exportExpenses() {
        try {
            if (!this.expenses || this.expenses.length === 0) {
                this.showToast('⚠️ لا توجد بيانات للتصدير', 'warning');
                return;
            }

            const exportData = this.expenses.map(exp => ({
                'المعرف': exp.id,
                'الفئة': exp.category,
                'الوصف': exp.description || '',
                'المبلغ': exp.amount,
                'التاريخ': this.formatDate(exp.date),
                'طريقة الدفع': exp.payment_method || 'نقدي',
                'المورد': exp.vendor_name || '',
                'رقم الشيك': exp.check_number || ''
            }));

            const result = await this.db.exportExcel(exportData, {
                title: 'تقرير المصروفات'
            });

            if (result.success) {
                this.showToast('📊 تم تصدير التقرير بنجاح', 'success');
            } else {
                this.showToast('❌ فشل تصدير التقرير: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('خطأ في تصدير المصروفات:', error);
            this.showToast('❌ حدث خطأ في تصدير البيانات', 'error');
        }
    }

    async importExpenses() {
        if (this.readOnlyMode) {
            this.showToast('⚠️ وضع القراءة فقط - لا يمكن استيراد البيانات', 'error');
            return;
        }

        try {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.xlsx,.xls';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const data = new Uint8Array(event.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const sheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[sheetName];
                        const jsonData = XLSX.utils.sheet_to_json(worksheet);

                        let importedCount = 0;
                        for (const row of jsonData) {
                            if (row.category && row.amount) {
                                await window.electronAPI.dbRun(`
                                    INSERT INTO expenses (
                                        category, amount, description, date, payment_method,
                                        vendor_name, created_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                                `, [
                                    row.category,
                                    parseFloat(row.amount) || 0,
                                    row.description || '',
                                    row.date || new Date().toISOString().slice(0, 10),
                                    row.payment_method || 'cash',
                                    row.vendor_name || ''
                                ]);
                                importedCount++;
                            }
                        }

                        await this.loadExpenses();
                        this.showToast(`✅ تم استيراد ${importedCount} مصروف بنجاح`, 'success');
                    } catch (error) {
                        console.error('خطأ في معالجة الملف:', error);
                        this.showToast('❌ حدث خطأ في معالجة الملف', 'error');
                    }
                };
                reader.readAsArrayBuffer(file);
            };
            input.click();
        } catch (error) {
            console.error('خطأ في استيراد المصروفات:', error);
            this.showToast('❌ حدث خطأ في استيراد البيانات', 'error');
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
        `;
        
        document.getElementById('toastContainer').appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideDown 0.4s ease forwards';
            setTimeout(() => {
                toast.remove();
            }, 400);
        }, 3000);
    }

    formatDate(date) {
        if (!date) return '-';
        return new Date(date).toLocaleDateString('ar-EG');
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

document.addEventListener('DOMContentLoaded', async () => {
    const expenses = new ExpensesController();
    await expenses.initialize();
    window.__expenses = expenses;
});