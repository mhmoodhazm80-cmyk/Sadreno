class DashboardController {
    constructor() {
        this.initialized = false;
        this.updateInterval = null;
        this.readOnlyMode = false;
        this.isRefreshing = false;
        this.stats = {
            totalWorkers: 0,
            monthlyExpenses: 0,
            dailyProduction: 0,
            todayAttendance: 0,
            pendingPayroll: 0,
            activeAdvances: 0,
            productivityRate: 0,
            defectRate: 0,
            costPerUnit: 0,
            criticalStock: 0
        };
        this.animationFrame = null;
        this.chartAnimations = [];
        this.activities = [];
        this.alerts = [];
    }

    async initialize() {
        try {
            await this.checkReadOnlyMode();
            await this.loadDashboardData();
            this.setupAutoRefresh();
            this.updateDateTime();
            this.setupChartAnimations();
            this.setupEventListeners();
            this.initialized = true;
            console.log('✅ تم تهيئة لوحة التحكم بنجاح');
            return true;
        } catch (error) {
            console.error('فشل تهيئة لوحة التحكم:', error);
            await window.electronAPI.logError(error);
            return false;
        }
    }

    setupEventListeners() {
        // زر التحديث
        document.getElementById('refreshBtn').addEventListener('click', async () => {
            await this.refreshData();
        });

        // تحديث تلقائي عند العودة للصفحة
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.loadDashboardData();
            }
        });
    }

    async checkReadOnlyMode() {
        try {
            this.readOnlyMode = await window.electronAPI.getReadOnly();
            
            const banner = document.getElementById('readonlyBanner');
            if (this.readOnlyMode) {
                banner.style.display = 'flex';
                document.querySelectorAll('.btn-add, .btn-edit, .btn-delete').forEach(btn => {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'not-allowed';
                });
            } else {
                banner.style.display = 'none';
            }
        } catch (error) {
            console.error('خطأ في التحقق من وضع القراءة فقط:', error);
        }
    }

    async refreshData() {
        if (this.isRefreshing) return;
        this.isRefreshing = true;
        
        const btn = document.getElementById('refreshBtn');
        const icon = btn.querySelector('span');
        icon.classList.add('spinning');
        btn.disabled = true;

        try {
            await this.loadDashboardData();
            this.showToast('🔄 تم تحديث البيانات بنجاح');
        } catch (error) {
            console.error('خطأ في تحديث البيانات:', error);
            this.showToast('❌ فشل تحديث البيانات', 'error');
        }

        icon.classList.remove('spinning');
        btn.disabled = false;
        this.isRefreshing = false;
    }

    async loadDashboardData() {
        try {
            // تحميل إجمالي العمال
            const workersResult = await window.electronAPI.dbQuery(
                'SELECT COUNT(*) as total FROM workers WHERE is_active = 1'
            );
            if (workersResult && workersResult.length > 0) {
                this.stats.totalWorkers = workersResult[0].total || 0;
                this.animateNumber('totalWorkers', this.stats.totalWorkers);
            }

            // تحميل مصروفات الشهر
            const currentMonth = new Date().toISOString().slice(0, 7);
            const expensesResult = await window.electronAPI.dbQuery(
                'SELECT SUM(amount) as total FROM expenses WHERE strftime("%Y-%m", date) = ?',
                [currentMonth]
            );
            if (expensesResult && expensesResult.length > 0) {
                this.stats.monthlyExpenses = expensesResult[0].total || 0;
                document.getElementById('monthlyExpenses').textContent = 
                    this.formatCurrency(this.stats.monthlyExpenses);
            }

            // تحميل الإنتاج اليومي
            const today = new Date().toISOString().slice(0, 10);
            const productionResult = await window.electronAPI.dbQuery(
                'SELECT SUM(pieces_produced) as total FROM daily_operations WHERE date = ?',
                [today]
            );
            if (productionResult && productionResult.length > 0) {
                this.stats.dailyProduction = productionResult[0].total || 0;
                this.animateNumber('dailyProduction', this.stats.dailyProduction);
            }

            // تحميل نسبة الحضور اليوم
            const attendanceResult = await window.electronAPI.dbQuery(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present
                FROM daily_operations 
                WHERE date = ?
            `, [today]);
            
            if (attendanceResult && attendanceResult.length > 0) {
                const total = attendanceResult[0].total || 1;
                const present = attendanceResult[0].present || 0;
                this.stats.todayAttendance = Math.round((present / total) * 100);
                this.animateNumber('todayAttendance', this.stats.todayAttendance, '%');
            }

            // تحميل الرواتب المستحقة
            const payrollResult = await window.electronAPI.dbQuery(
                'SELECT SUM(net_salary) as total FROM payroll WHERE is_paid = 0'
            );
            if (payrollResult && payrollResult.length > 0) {
                this.stats.pendingPayroll = payrollResult[0].total || 0;
                document.getElementById('pendingPayroll').textContent = 
                    this.formatCurrency(this.stats.pendingPayroll);
            }

            // تحميل السلف النشطة
            const advancesResult = await window.electronAPI.dbQuery(
                'SELECT COUNT(*) as total FROM advances WHERE is_deducted = 0'
            );
            if (advancesResult && advancesResult.length > 0) {
                this.stats.activeAdvances = advancesResult[0].total || 0;
                this.animateNumber('activeAdvances', this.stats.activeAdvances);
            }

            // تحميل مؤشرات الأداء الإضافية
            await this.loadKPIs();

            // تحميل النشاطات الأخيرة
            await this.loadRecentActivities();

            // تحميل التنبيهات
            await this.loadAlerts();

            // تحديث الرسم البياني
            await this.updateChart();

        } catch (error) {
            console.error('خطأ في تحميل بيانات لوحة التحكم:', error);
            throw error;
        }
    }

    async loadKPIs() {
        try {
            const today = new Date().toISOString().slice(0, 10);
            const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

            // نسبة الإنتاجية
            const productivityResult = await window.electronAPI.dbQuery(`
                SELECT 
                    SUM(pieces_produced) as total_produced,
                    COUNT(DISTINCT worker_id) as workers_count
                FROM daily_operations
                WHERE date BETWEEN ? AND ?
            `, [monthStart, today]);

            if (productivityResult && productivityResult.length > 0) {
                const total = productivityResult[0].total_produced || 0;
                const workers = productivityResult[0].workers_count || 1;
                this.stats.productivityRate = Math.round(total / workers);
                document.getElementById('productivityRate').textContent = 
                    this.stats.productivityRate + ' وحدة/عامل';
            }

            // نسبة العيوب
            const defectResult = await window.electronAPI.dbQuery(`
                SELECT 
                    SUM(pieces_produced) as total_produced,
                    SUM(defective_pieces) as total_defective
                FROM daily_operations
                WHERE date BETWEEN ? AND ?
            `, [monthStart, today]);

            if (defectResult && defectResult.length > 0) {
                const total = defectResult[0].total_produced || 1;
                const defective = defectResult[0].total_defective || 0;
                this.stats.defectRate = (defective / total) * 100;
                document.getElementById('defectRate').textContent = 
                    this.stats.defectRate.toFixed(1) + '%';
            }

            // تكلفة القطعة
            const costResult = await window.electronAPI.dbQuery(`
                SELECT 
                    SUM(amount) as total_cost,
                    SUM(pieces_produced) as total_pieces
                FROM expenses, daily_operations
                WHERE expenses.date BETWEEN ? AND ?
                AND daily_operations.date BETWEEN ? AND ?
            `, [monthStart, today, monthStart, today]);

            if (costResult && costResult.length > 0) {
                const cost = costResult[0].total_cost || 0;
                const pieces = costResult[0].total_pieces || 1;
                this.stats.costPerUnit = cost / pieces;
                document.getElementById('costPerUnit').textContent = 
                    this.formatCurrency(this.stats.costPerUnit);
            }

            // المخزون الحرج
            const stockResult = await window.electronAPI.dbQuery(`
                SELECT COUNT(*) as total
                FROM inventory
                WHERE quantity <= min_quantity AND min_quantity > 0
            `);

            if (stockResult && stockResult.length > 0) {
                this.stats.criticalStock = stockResult[0].total || 0;
                document.getElementById('criticalStock').textContent = this.stats.criticalStock;
            }

        } catch (error) {
            console.error('خطأ في تحميل مؤشرات الأداء:', error);
        }
    }

    async loadRecentActivities() {
        try {
            const activities = await window.electronAPI.dbQuery(`
                SELECT 
                    action,
                    target_table,
                    created_at
                FROM activity_log 
                ORDER BY created_at DESC 
                LIMIT 5
            `);

            const container = document.getElementById('recentActivities');
            container.innerHTML = '';

            if (activities && activities.length > 0) {
                for (const activity of activities) {
                    const item = document.createElement('div');
                    item.className = 'activity-item';
                    
                    const timeAgo = this.getTimeAgo(new Date(activity.created_at));
                    const status = this.getActivityStatus(activity.action);
                    
                    item.innerHTML = `
                        <div class="activity-info">
                            <div class="activity-title">${this.getActivityText(activity)}</div>
                            <div class="activity-time">${timeAgo}</div>
                        </div>
                        <span class="activity-status ${status.class}">${status.text}</span>
                    `;
                    
                    container.appendChild(item);
                }
            } else {
                container.innerHTML = `
                    <div class="activity-item">
                        <div class="activity-info">
                            <div class="activity-title">لا توجد نشاطات حديثة</div>
                            <div class="activity-time">قم بإضافة بيانات جديدة</div>
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('خطأ في تحميل النشاطات:', error);
        }
    }

    async loadAlerts() {
        try {
            const alerts = [];

            // التحقق من حالة الترخيص
            const licenseStatus = await window.electronAPI.getLicenseStatus();
            
            if (!licenseStatus.isValid) {
                if (licenseStatus.isExpired) {
                    alerts.push({
                        type: 'danger',
                        icon: '🚫',
                        text: 'انتهت صلاحية الترخيص',
                        detail: 'يرجى تجديد الترخيص للاستمرار في استخدام النظام'
                    });
                } else {
                    alerts.push({
                        type: 'warning',
                        icon: '⚠️',
                        text: 'الترخيص غير مفعل',
                        detail: 'يرجى تفعيل البرنامج باستخدام كود التفعيل'
                    });
                }
            } else if (licenseStatus.isTrial && licenseStatus.daysRemaining <= 3) {
                alerts.push({
                    type: 'warning',
                    icon: '⏰',
                    text: 'الفترة التجريبية على وشك الانتهاء',
                    detail: `متبقي ${licenseStatus.daysRemaining} أيام - يرجى التفعيل`
                });
            }

            // التحقق من السلف غير المسددة
            const advancesCount = await window.electronAPI.dbQuery(
                'SELECT COUNT(*) as total FROM advances WHERE is_deducted = 0 AND date < date("now", "-30 days")'
            );
            if (advancesCount && advancesCount[0] && advancesCount[0].total > 0) {
                alerts.push({
                    type: 'danger',
                    icon: '💰',
                    text: `سلف غير مسددة منذ أكثر من 30 يوم`,
                    detail: `عدد ${advancesCount[0].total} سلف بحاجة للمراجعة`
                });
            }

            // التحقق من المخزون الحرج
            const stockAlerts = await window.electronAPI.dbQuery(`
                SELECT name, quantity, min_quantity
                FROM inventory
                WHERE quantity <= min_quantity AND min_quantity > 0
                LIMIT 3
            `);
            
            if (stockAlerts && stockAlerts.length > 0) {
                const items = stockAlerts.map(item => item.name).join('، ');
                alerts.push({
                    type: 'warning',
                    icon: '📦',
                    text: 'مواد خام منخفضة المخزون',
                    detail: `المواد: ${items} - يرجى إعادة التوريد`
                });
            }

            // عرض التنبيهات
            const container = document.getElementById('alerts');
            container.innerHTML = '';

            if (alerts.length > 0) {
                for (const alert of alerts) {
                    const item = document.createElement('div');
                    item.className = `alert-item ${alert.type}`;
                    item.innerHTML = `
                        <div class="alert-icon">${alert.icon}</div>
                        <div class="alert-content">
                            <div class="alert-text">${alert.text}</div>
                            <div class="alert-detail">${alert.detail}</div>
                        </div>
                    `;
                    container.appendChild(item);
                }
            } else {
                container.innerHTML = `
                    <div class="alert-item success">
                        <div class="alert-icon">✅</div>
                        <div class="alert-content">
                            <div class="alert-text">لا توجد تنبيهات</div>
                            <div class="alert-detail">جميع الأنظمة تعمل بشكل طبيعي</div>
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('خطأ في تحميل التنبيهات:', error);
        }
    }

    async updateChart() {
        try {
            const days = 7;
            const data = [];
            const today = new Date();
            
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().slice(0, 10);
                
                const result = await window.electronAPI.dbQuery(
                    'SELECT SUM(pieces_produced) as total FROM daily_operations WHERE date = ?',
                    [dateStr]
                );
                
                const total = result[0]?.total || 0;
                data.push(total);
            }

            const bars = document.querySelectorAll('.chart-bar-item');
            const maxValue = Math.max(...data, 1);
            
            bars.forEach((bar, index) => {
                if (index < data.length) {
                    const percentage = (data[index] / maxValue) * 100;
                    bar.style.height = Math.max(percentage, 5) + '%';
                    const tooltip = bar.querySelector('.tooltip');
                    if (tooltip) {
                        tooltip.textContent = `${data[index]} وحدة`;
                    }
                }
            });
        } catch (error) {
            console.error('خطأ في تحديث الرسم البياني:', error);
        }
    }

    animateNumber(elementId, targetValue, suffix = '') {
        const element = document.getElementById(elementId);
        if (!element) return;

        const startValue = 0;
        const duration = 1000;
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            const eased = 1 - Math.pow(1 - progress, 3);
            const currentValue = Math.floor(startValue + (targetValue - startValue) * eased);
            
            element.textContent = currentValue + suffix;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                element.textContent = targetValue + suffix;
            }
        };

        requestAnimationFrame(animate);
    }

    setupChartAnimations() {
        const bars = document.querySelectorAll('.chart-bar-item');
        bars.forEach((bar, index) => {
            bar.addEventListener('mouseenter', () => {
                bar.style.transform = 'scaleY(1.1)';
                bar.style.transformOrigin = 'bottom';
            });
            
            bar.addEventListener('mouseleave', () => {
                bar.style.transform = 'scaleY(1)';
            });
        });
    }

    getActivityText(activity) {
        const actions = {
            'insert': 'تم إضافة',
            'update': 'تم تحديث',
            'delete': 'تم حذف',
            'login': 'تسجيل دخول',
            'logout': 'تسجيل خروج',
            'export': 'تصدير بيانات',
            'import': 'استيراد بيانات'
        };

        const actionText = actions[activity.action] || activity.action;
        const tableText = this.getTableText(activity.target_table);
        
        return `${actionText} ${tableText}`;
    }

    getTableText(table) {
        const tables = {
            'workers': 'عامل',
            'daily_operations': 'حضور',
            'expenses': 'مصروف',
            'payroll': 'راتب',
            'advances': 'سلفة',
            'factories': 'مصنع',
            'settings': 'إعدادات',
            'inventory': 'مخزون',
            'production_orders': 'أمر إنتاج',
            'machine_maintenance': 'صيانة'
        };
        return tables[table] || table;
    }

    getActivityStatus(action) {
        const statuses = {
            'insert': { class: 'success', text: 'تم' },
            'update': { class: 'info', text: 'تحديث' },
            'delete': { class: 'danger', text: 'حذف' },
            'login': { class: 'success', text: 'دخول' },
            'logout': { class: 'warning', text: 'خروج' },
            'export': { class: 'success', text: 'تصدير' },
            'import': { class: 'success', text: 'استيراد' }
        };
        return statuses[action] || { class: 'warning', text: 'جاري' };
    }

    getTimeAgo(date) {
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);

        if (diff < 60) return 'منذ لحظات';
        if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقائق`;
        if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعات`;
        if (diff < 604800) return `منذ ${Math.floor(diff / 86400)} أيام`;
        if (diff < 2592000) return `منذ ${Math.floor(diff / 604800)} أسابيع`;
        
        return date.toLocaleDateString('ar-EG');
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

    updateDateTime() {
        const now = new Date();
        const options = { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            weekday: 'long'
        };
        document.getElementById('currentDate').textContent = 
            now.toLocaleDateString('ar-EG', options);
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
        
        const icon = type === 'success' ? '✅' : '❌';
        toast.textContent = `${icon} ${message}`;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideDown 0.4s ease forwards';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 400);
        }, 3000);
    }

    setupAutoRefresh() {
        this.updateInterval = setInterval(() => {
            this.loadDashboardData();
            this.updateDateTime();
        }, 60000);
    }

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }
}

// تشغيل لوحة التحكم
document.addEventListener('DOMContentLoaded', async () => {
    const dashboard = new DashboardController();
    await dashboard.initialize();
    
    window.__dashboard = dashboard;
});