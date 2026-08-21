class ExpensesController {
    constructor() {
        this.expenses = [];
        this.filterStart = null;
        this.filterEnd = null;
        this.filterCategory = '';
        this.filterSearch = '';
        this.readOnlyMode = false;
    }

    async initialize() {
        try {
            await this.checkReadOnlyMode();
            this.setDefaultFilters();
            this.setupEventListeners();
            await this.loadExpenses();
            this.updateStats();
            this.setupTableAnimations();
            return true;
        } catch (error) {
            console.error('فشل تهيئة المصروفات:', error);
            await window.electronAPI.logError(error);
            return false;
        }
    }

    async checkReadOnlyMode() {
        try {
            this.readOnlyMode = await window.electronAPI.getReadOnly();
            
            if (this.readOnlyMode) {
                document.getElementById('addExpenseBtn').disabled = true;
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
        // إضافة مصروف
        const addBtn = document.getElementById('addExpenseBtn');
        if (!this.readOnlyMode) {
            addBtn.addEventListener('click', () => {
                this.showAddExpenseDialog();
            });
        }

        // تصدير
        document.getElementById('exportBtn').addEventListener('click', async () => {
            await this.exportExpenses();
        });

        // الفلاتر
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

        document.getElementById('filterSearch').addEventListener('input', (e) => {
            this.filterSearch = e.target.value;
            this.loadExpenses();
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

            if (this.filterSearch) {
                query += ' AND (description LIKE ? OR category LIKE ?)';
                const searchPattern = `%${this.filterSearch}%`;
                params.push(searchPattern, searchPattern);
            }

            query += ' ORDER BY date DESC, created_at DESC';

            this.expenses = await window.electronAPI.dbQuery(query, params);
            this.renderTable();
            this.updateStats();
        } catch (error) {
            console.error('خطأ في تحميل المصروفات:', error);
        }
    }

    renderTable() {
        const tbody = document.getElementById('expensesTableBody');
        tbody.innerHTML = '';

        if (!this.expenses || this.expenses.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: #9BA5AF; padding: 40px;">
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

            tr.innerHTML = `
                <td>${expense.id}</td>
                <td><span style="color: #E8EDF2; font-weight: 600;">${expense.category}</span></td>
                <td>${expense.description || '-'}</td>
                <td><strong style="color: #E8EDF2;">${this.formatCurrency(expense.amount)}</strong></td>
                <td>${this.formatDate(expense.date)}</td>
                <td>${paymentMethods[expense.payment_method] || expense.payment_method}</td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn-action edit" data-id="${expense.id}" ${isReadOnly ? 'disabled' : ''}>✏️ تعديل</button>
                        <button class="btn-action delete" data-id="${expense.id}" ${isReadOnly ? 'disabled' : ''}>🗑️ حذف</button>
                    </div>
                </td>
            `;

            tbody.appendChild(tr);
        }

        // إضافة أحداث للأزرار
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

    showAddExpenseDialog() {
        if (this.readOnlyMode) {
            alert('⚠️ وضع القراءة فقط - لا يمكن إضافة مصروفات');
            return;
        }

        const description = prompt('📝 وصف المصروف:');
        if (description === null) return;

        const amount = prompt('💰 المبلغ:');
        if (amount === null) return;

        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum <= 0) {
            alert('⚠️ الرجاء إدخال مبلغ صحيح');
            return;
        }

        const category = prompt('📂 الفئة (مواد خام, صيانة, رواتب, نثريات, فواتير, آلات, أخرى):');
        if (category === null) return;

        this.addExpense({
            description: description,
            amount: amountNum,
            category: category || 'أخرى',
            date: new Date().toISOString().slice(0, 10)
        });
    }

    async addExpense(data) {
        try {
            const result = await window.electronAPI.dbRun(`
                INSERT INTO expenses (
                    category, description, amount, date, payment_method, created_at
                ) VALUES (?, ?, ?, ?, 'cash', CURRENT_TIMESTAMP)
            `, [data.category, data.description, data.amount, data.date]);

            await window.electronAPI.dbRun(`
                INSERT INTO activity_log (user, action, target_table, target_id, new_data)
                VALUES ('system', 'insert', 'expenses', ?, ?)
            `, [result.lastID, JSON.stringify(data)]);

            await this.loadExpenses();
            this.showToast('✅ تم إضافة المصروف بنجاح');
        } catch (error) {
            console.error('خطأ في إضافة المصروف:', error);
            alert('❌ حدث خطأ في إضافة المصروف. يرجى المحاولة مرة أخرى.');
        }
    }

    async editExpense(expenseId) {
        if (this.readOnlyMode) {
            alert('⚠️ وضع القراءة فقط - لا يمكن تعديل المصروفات');
            return;
        }

        try {
            const expense = this.expenses.find(e => e.id === expenseId);
            if (!expense) {
                alert('المصروف غير موجود');
                return;
            }

            const newDescription = prompt('📝 الوصف الجديد:', expense.description) || expense.description;
            const newAmount = prompt('💰 المبلغ الجديد:', expense.amount);
            if (newAmount === null) return;

            const amountNum = parseFloat(newAmount);
            if (isNaN(amountNum) || amountNum <= 0) {
                alert('⚠️ الرجاء إدخال مبلغ صحيح');
                return;
            }

            const newCategory = prompt('📂 الفئة الجديدة:', expense.category) || expense.category;

            await window.electronAPI.dbRun(`
                UPDATE expenses 
                SET 
                    description = ?,
                    amount = ?,
                    category = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [newDescription, amountNum, newCategory, expenseId]);

            await window.electronAPI.dbRun(`
                INSERT INTO activity_log (user, action, target_table, target_id, new_data)
                VALUES ('system', 'update', 'expenses', ?, ?)
            `, [expenseId, JSON.stringify({description: newDescription, amount: amountNum, category: newCategory})]);

            await this.loadExpenses();
            this.showToast('✅ تم تعديل المصروف بنجاح');
        } catch (error) {
            console.error('خطأ في تعديل المصروف:', error);
            alert('❌ حدث خطأ في تعديل المصروف. يرجى المحاولة مرة أخرى.');
        }
    }

    async deleteExpense(expenseId) {
        if (this.readOnlyMode) {
            alert('⚠️ وضع القراءة فقط - لا يمكن حذف المصروفات');
            return;
        }

        try {
            const confirmDelete = confirm('⚠️ هل أنت متأكد من حذف هذا المصروف؟');
            if (!confirmDelete) return;

            await window.electronAPI.dbRun('DELETE FROM expenses WHERE id = ?', [expenseId]);

            await window.electronAPI.dbRun(`
                INSERT INTO activity_log (user, action, target_table, target_id)
                VALUES ('system', 'delete', 'expenses', ?)
            `, [expenseId]);

            await this.loadExpenses();
            this.showToast('🗑️ تم حذف المصروف بنجاح');
        } catch (error) {
            console.error('خطأ في حذف المصروف:', error);
            alert('❌ حدث خطأ في حذف المصروف. يرجى المحاولة مرة أخرى.');
        }
    }

    async exportExpenses() {
        try {
            if (!this.expenses || this.expenses.length === 0) {
                alert('⚠️ لا توجد بيانات للتصدير');
                return;
            }

            const exportData = this.expenses.map(exp => ({
                'المعرف': exp.id,
                'الفئة': exp.category,
                'الوصف': exp.description || '',
                'المبلغ': exp.amount,
                'التاريخ': this.formatDate(exp.date),
                'طريقة الدفع': exp.payment_method || 'نقدي'
            }));

            const result = await window.electronAPI.exportExcel(exportData, {
                title: 'تقرير المصروفات'
            });

            if (result.success) {
                this.showToast('📊 تم تصدير التقرير بنجاح');
            } else {
                alert('❌ فشل تصدير التقرير: ' + result.message);
            }
        } catch (error) {
            console.error('خطأ في تصدير المصروفات:', error);
            alert('❌ حدث خطأ في تصدير البيانات. يرجى المحاولة مرة أخرى.');
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

// تشغيل المصروفات
document.addEventListener('DOMContentLoaded', async () => {
    const expenses = new ExpensesController();
    await expenses.initialize();
    
    window.__expenses = expenses;
});