class PayrollController {
    constructor() {
        this.payrollData = [];
        this.advancesData = [];
        this.deductionsData = [];
        this.currentTab = 'payroll';
        this.periodStart = new Date();
        this.periodEnd = new Date();
        this.readOnlyMode = false;
        this.isCalculating = false;
    }

    async initialize() {
        try {
            await this.checkReadOnlyMode();
            this.setDefaultPeriod();
            this.setupEventListeners();
            await this.loadPayrollData();
            await this.loadAdvancesData();
            await this.loadDeductionsData();
            this.updateSummary();
            this.setupTabAnimations();
            return true;
        } catch (error) {
            console.error('فشل تهيئة الرواتب:', error);
            await window.electronAPI.logError(error);
            return false;
        }
    }

    async checkReadOnlyMode() {
        try {
            this.readOnlyMode = await window.electronAPI.getReadOnly();
            
            if (this.readOnlyMode) {
                document.getElementById('calculateBtn').disabled = true;
                document.querySelectorAll('.btn-pay').forEach(btn => {
                    btn.disabled = true;
                });
            }
        } catch (error) {
            console.error('خطأ في التحقق من وضع القراءة فقط:', error);
        }
    }

    setDefaultPeriod() {
        const now = new Date();
        this.periodEnd = now;
        this.periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        document.getElementById('periodStart').value = this.periodStart.toISOString().slice(0, 10);
        document.getElementById('periodEnd').value = this.periodEnd.toISOString().slice(0, 10);
    }

    setupEventListeners() {
        // تبديل التبويبات
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });

        // حساب الرواتب
        document.getElementById('calculateBtn').addEventListener('click', async () => {
            if (!this.readOnlyMode) {
                await this.calculatePayroll();
            }
        });

        // تغيير التاريخ
        document.getElementById('periodStart').addEventListener('change', (e) => {
            this.periodStart = new Date(e.target.value);
            this.loadPayrollData();
        });

        document.getElementById('periodEnd').addEventListener('change', (e) => {
            this.periodEnd = new Date(e.target.value);
            this.loadPayrollData();
        });
    }

    setupTabAnimations() {
        // تأثيرات التبويبات
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                if (!btn.classList.contains('active')) {
                    btn.style.transform = 'scale(1.05)';
                }
            });
            
            btn.addEventListener('mouseleave', () => {
                if (!btn.classList.contains('active')) {
                    btn.style.transform = 'scale(1)';
                }
            });
        });
    }

    switchTab(tab) {
        this.currentTab = tab;
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tab + 'Tab');
        });
    }

    async loadPayrollData() {
        try {
            const startDate = this.periodStart.toISOString().slice(0, 10);
            const endDate = this.periodEnd.toISOString().slice(0, 10);

            this.payrollData = await window.electronAPI.dbQuery(`
                SELECT 
                    p.*,
                    w.name as worker_name,
                    w.salary_type,
                    w.salary_rate
                FROM payroll p
                JOIN workers w ON w.id = p.worker_id
                WHERE p.period_start >= ? AND p.period_end <= ?
                ORDER BY p.created_at DESC
            `, [startDate, endDate]);

            this.renderPayrollTable();
            this.updateSummary();
        } catch (error) {
            console.error('خطأ في تحميل بيانات الرواتب:', error);
        }
    }

    renderPayrollTable() {
        const tbody = document.getElementById('payrollTableBody');
        tbody.innerHTML = '';

        if (!this.payrollData || this.payrollData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; color: #9BA5AF; padding: 40px;">
                        <div style="font-size: 48px; margin-bottom: 10px;">📊</div>
                        لا توجد رواتب محسوبة لهذه الفترة
                    </td>
                </tr>
            `;
            return;
        }

        for (const payroll of this.payrollData) {
            const tr = document.createElement('tr');
            
            const statusText = payroll.is_paid ? '✅ مسددة' : '⏳ قيد الانتظار';
            const isPaid = payroll.is_paid ? 1 : 0;
            const canPay = !this.readOnlyMode && !payroll.is_paid;

            tr.innerHTML = `
                <td><strong>${payroll.worker_name}</strong></td>
                <td>${this.formatDate(payroll.period_start)} - ${this.formatDate(payroll.period_end)}</td>
                <td>${payroll.total_hours || 0}</td>
                <td>${payroll.total_pieces || 0}</td>
                <td>${this.formatCurrency(payroll.base_salary || 0)}</td>
                <td>${this.formatCurrency(payroll.advances_deducted || 0)}</td>
                <td>${this.formatCurrency(payroll.deductions || 0)}</td>
                <td><strong>${this.formatCurrency(payroll.net_salary || 0)}</strong></td>
                <td><span class="status-badge ${payroll.is_paid ? 'active' : 'pending'}">${statusText}</span></td>
                <td>
                    ${canPay ? 
                        `<button class="btn-pay" data-id="${payroll.id}">💰 تسديد</button>` : 
                        payroll.is_paid ? '<span style="color: #4CAF50;">✓</span>' : '<span style="color: #9BA5AF;">🔒</span>'
                    }
                </td>
            `;

            tbody.appendChild(tr);
        }

        // إضافة أحداث لتسديد الرواتب
        tbody.querySelectorAll('.btn-pay:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => this.paySalary(parseInt(btn.dataset.id)));
        });
    }

    async loadAdvancesData() {
        try {
            this.advancesData = await window.electronAPI.dbQuery(`
                SELECT 
                    a.*,
                    w.name as worker_name
                FROM advances a
                JOIN workers w ON w.id = a.worker_id
                WHERE a.type = 'advance'
                ORDER BY a.created_at DESC
                LIMIT 100
            `);

            this.renderAdvancesTable();
        } catch (error) {
            console.error('خطأ في تحميل بيانات السلف:', error);
        }
    }

    renderAdvancesTable() {
        const tbody = document.getElementById('advancesTableBody');
        tbody.innerHTML = '';

        if (!this.advancesData || this.advancesData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: #9BA5AF; padding: 40px;">
                        <div style="font-size: 48px; margin-bottom: 10px;">💰</div>
                        لا توجد سلف مسجلة
                    </td>
                </tr>
            `;
            return;
        }

        for (const advance of this.advancesData) {
            const tr = document.createElement('tr');
            
            const statusText = advance.is_deducted ? '✅ مسددة' : '⏳ قيد الانتظار';
            const canDeduct = !this.readOnlyMode && !advance.is_deducted;

            tr.innerHTML = `
                <td><strong>${advance.worker_name}</strong></td>
                <td>${this.formatCurrency(advance.amount)}</td>
                <td>${this.formatDate(advance.date)}</td>
                <td>${advance.description || '-'}</td>
                <td><span class="status-badge ${advance.is_deducted ? 'active' : 'pending'}">${statusText}</span></td>
                <td>
                    ${canDeduct ? 
                        `<button class="btn-pay" data-id="${advance.id}" data-type="advance">📉 خصم</button>` : 
                        advance.is_deducted ? '<span style="color: #4CAF50;">✓</span>' : '<span style="color: #9BA5AF;">🔒</span>'
                    }
                </td>
            `;

            tbody.appendChild(tr);
        }

        // إضافة أحداث لخصم السلف
        tbody.querySelectorAll('.btn-pay[data-type="advance"]:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => this.deductAdvance(parseInt(btn.dataset.id)));
        });
    }

    async loadDeductionsData() {
        try {
            this.deductionsData = await window.electronAPI.dbQuery(`
                SELECT 
                    a.*,
                    w.name as worker_name
                FROM advances a
                JOIN workers w ON w.id = a.worker_id
                WHERE a.type = 'deduction'
                ORDER BY a.created_at DESC
                LIMIT 100
            `);

            this.renderDeductionsTable();
        } catch (error) {
            console.error('خطأ في تحميل بيانات الخصومات:', error);
        }
    }

    renderDeductionsTable() {
        const tbody = document.getElementById('deductionsTableBody');
        tbody.innerHTML = '';

        if (!this.deductionsData || this.deductionsData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: #9BA5AF; padding: 40px;">
                        <div style="font-size: 48px; margin-bottom: 10px;">📉</div>
                        لا توجد خصومات مسجلة
                    </td>
                </tr>
            `;
            return;
        }

        for (const deduction of this.deductionsData) {
            const tr = document.createElement('tr');
            
            const statusText = deduction.is_deducted ? '✅ تم الخصم' : '⏳ قيد الانتظار';

            tr.innerHTML = `
                <td><strong>${deduction.worker_name}</strong></td>
                <td>${this.formatCurrency(deduction.amount)}</td>
                <td>${this.formatDate(deduction.date)}</td>
                <td>${deduction.description || '-'}</td>
                <td><span class="status-badge ${deduction.is_deducted ? 'active' : 'pending'}">${statusText}</span></td>
            `;

            tbody.appendChild(tr);
        }
    }

    async calculatePayroll() {
        if (this.readOnlyMode) {
            alert('⚠️ وضع القراءة فقط - لا يمكن حساب الرواتب');
            return;
        }

        if (this.isCalculating) {
            return;
        }

        this.isCalculating = true;
        document.getElementById('calculateBtn').disabled = true;
        document.getElementById('calculateBtn').textContent = '⏳ جاري الحساب...';

        try {
            const startDate = this.periodStart.toISOString().slice(0, 10);
            const endDate = this.periodEnd.toISOString().slice(0, 10);

            const workers = await window.electronAPI.dbQuery(
                'SELECT * FROM workers WHERE is_active = 1'
            );

            if (!workers || workers.length === 0) {
                alert('⚠️ لا يوجد عمال نشطين لحساب الرواتب');
                this.isCalculating = false;
                document.getElementById('calculateBtn').disabled = false;
                document.getElementById('calculateBtn').textContent = '📊 حساب الرواتب';
                return;
            }

            const confirmCalculation = confirm(
                `سيتم حساب الرواتب للفترة من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}.\nعدد العمال: ${workers.length}\nهل أنت متأكد؟`
            );
            
            if (!confirmCalculation) {
                this.isCalculating = false;
                document.getElementById('calculateBtn').disabled = false;
                document.getElementById('calculateBtn').textContent = '📊 حساب الرواتب';
                return;
            }

            const operations = [];
            let calculatedCount = 0;

            for (const worker of workers) {
                const workData = await window.electronAPI.dbQuery(`
                    SELECT 
                        SUM(hours_worked) as total_hours,
                        SUM(pieces_produced) as total_pieces
                    FROM daily_operations
                    WHERE worker_id = ? AND date BETWEEN ? AND ?
                `, [worker.id, startDate, endDate]);

                const totalHours = workData[0]?.total_hours || 0;
                const totalPieces = workData[0]?.total_pieces || 0;

                let baseSalary = 0;
                if (worker.salary_type === 'hourly') {
                    baseSalary = totalHours * worker.salary_rate;
                } else if (worker.salary_type === 'daily') {
                    const daysWorked = Math.ceil(totalHours / 8);
                    baseSalary = daysWorked * worker.salary_rate;
                } else if (worker.salary_type === 'monthly') {
                    baseSalary = worker.salary_rate;
                } else if (worker.salary_type === 'piece') {
                    baseSalary = totalPieces * worker.piece_rate;
                }

                const advances = await window.electronAPI.dbQuery(`
                    SELECT SUM(amount) as total 
                    FROM advances 
                    WHERE worker_id = ? AND is_deducted = 0 AND type = 'advance'
                `, [worker.id]);

                const advancesTotal = advances[0]?.total || 0;

                const deductions = await window.electronAPI.dbQuery(`
                    SELECT SUM(amount) as total 
                    FROM advances 
                    WHERE worker_id = ? AND is_deducted = 0 AND type = 'deduction'
                `, [worker.id]);

                const deductionsTotal = deductions[0]?.total || 0;

                const netSalary = baseSalary - advancesTotal - deductionsTotal;

                operations.push({
                    sql: `
                        INSERT INTO payroll (
                            worker_id, period_start, period_end,
                            total_hours, total_pieces, base_salary,
                            advances_deducted, deductions, net_salary,
                            is_paid, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
                    `,
                    params: [
                        worker.id,
                        startDate,
                        endDate,
                        totalHours,
                        totalPieces,
                        baseSalary,
                        advancesTotal,
                        deductionsTotal,
                        netSalary
                    ]
                });

                if (advancesTotal > 0) {
                    operations.push({
                        sql: `
                            UPDATE advances 
                            SET is_deducted = 1, deducted_date = CURRENT_TIMESTAMP 
                            WHERE worker_id = ? AND is_deducted = 0 AND type = 'advance'
                        `,
                        params: [worker.id]
                    });
                }

                calculatedCount++;
            }

            if (operations.length > 0) {
                await window.electronAPI.dbTransaction(operations);
                alert(`✅ تم حساب الرواتب بنجاح\nعدد العمال: ${calculatedCount}`);
                await this.loadPayrollData();
                this.updateSummary();
            }

        } catch (error) {
            console.error('خطأ في حساب الرواتب:', error);
            alert('❌ حدث خطأ في حساب الرواتب. يرجى المحاولة مرة أخرى.');
        }

        this.isCalculating = false;
        document.getElementById('calculateBtn').disabled = false;
        document.getElementById('calculateBtn').textContent = '📊 حساب الرواتب';
    }

    async paySalary(payrollId) {
        if (this.readOnlyMode) {
            alert('⚠️ وضع القراءة فقط - لا يمكن تسديد الرواتب');
            return;
        }

        try {
            const confirmPayment = confirm('💰 هل أنت متأكد من تسديد هذا الراتب؟');
            if (!confirmPayment) return;

            await window.electronAPI.dbRun(`
                UPDATE payroll 
                SET is_paid = 1, paid_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [payrollId]);

            await window.electronAPI.dbRun(`
                INSERT INTO activity_log (user, action, target_table, target_id)
                VALUES ('system', 'update', 'payroll', ?)
            `, [payrollId]);

            await this.loadPayrollData();
            this.updateSummary();
            this.showToast('✅ تم تسديد الراتب بنجاح');
        } catch (error) {
            console.error('خطأ في تسديد الراتب:', error);
            alert('❌ حدث خطأ في تسديد الراتب. يرجى المحاولة مرة أخرى.');
        }
    }

    async deductAdvance(advanceId) {
        if (this.readOnlyMode) {
            alert('⚠️ وضع القراءة فقط - لا يمكن خصم السلف');
            return;
        }

        try {
            const confirmDeduction = confirm('📉 هل أنت متأكد من خصم هذه السلفة؟');
            if (!confirmDeduction) return;

            await window.electronAPI.dbRun(`
                UPDATE advances 
                SET is_deducted = 1, deducted_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [advanceId]);

            await window.electronAPI.dbRun(`
                INSERT INTO activity_log (user, action, target_table, target_id)
                VALUES ('system', 'update', 'advances', ?)
            `, [advanceId]);

            await this.loadAdvancesData();
            this.updateSummary();
            this.showToast('✅ تم خصم السلفة بنجاح');
        } catch (error) {
            console.error('خطأ في خصم السلفة:', error);
            alert('❌ حدث خطأ في خصم السلفة. يرجى المحاولة مرة أخرى.');
        }
    }

    async updateSummary() {
        try {
            const startDate = this.periodStart.toISOString().slice(0, 10);
            const endDate = this.periodEnd.toISOString().slice(0, 10);

            const totalPayroll = await window.electronAPI.dbQuery(`
                SELECT SUM(net_salary) as total 
                FROM payroll 
                WHERE period_start >= ? AND period_end <= ?
            `, [startDate, endDate]);

            document.getElementById('totalPayroll').textContent = 
                this.formatCurrency(totalPayroll[0]?.total || 0);

            const totalAdvances = await window.electronAPI.dbQuery(`
                SELECT SUM(amount) as total 
                FROM advances 
                WHERE type = 'advance' AND is_deducted = 0
            `);

            document.getElementById('totalAdvances').textContent = 
                this.formatCurrency(totalAdvances[0]?.total || 0);

            const paidPayroll = await window.electronAPI.dbQuery(`
                SELECT SUM(net_salary) as total 
                FROM payroll 
                WHERE period_start >= ? AND period_end <= ? AND is_paid = 1
            `, [startDate, endDate]);

            document.getElementById('paidPayroll').textContent = 
                this.formatCurrency(paidPayroll[0]?.total || 0);

            const total = totalPayroll[0]?.total || 0;
            const paid = paidPayroll[0]?.total || 0;
            const net = total - paid;

            document.getElementById('netPayable').textContent = 
                this.formatCurrency(net);

        } catch (error) {
            console.error('خطأ في تحديث الملخص:', error);
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

// تشغيل الرواتب
document.addEventListener('DOMContentLoaded', async () => {
    const payroll = new PayrollController();
    await payroll.initialize();
    
    window.__payroll = payroll;
});