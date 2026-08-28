class DashboardController {
    constructor() {
        this.initialized = false;
        this.updateInterval = null;
        this.readOnlyMode = false;
        this.isRefreshing = false;
        this.db = window.__db || null;
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
            if (!this.db) {
                this.db = new DatabaseHelper();
                await this.db.initialize();
                window.__db = this.db;
            }

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
            await window.electronAPI?.logError(error);
            return false;
        }
    }

    setupEventListeners() {
        document.getElementById('refreshBtn').addEventListener('click', async () => {
            await this.refreshData();
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.loadDashboardData();
            }
        });
    }

    async checkReadOnlyMode() {
        try {
            if (this.db) {
                this.readOnlyMode = await this.db.getReadOnly();
            } else {
                this.readOnlyMode = await window.electronAPI.getReadOnly();
            }
            
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
            let stats;
            if (this.db) {
                stats = await this.db.getDashboardStats();
            } else {
                stats = await window.electronAPI.getDashboardStats();
            }
            
            if (stats) {
                this.stats = stats;
                this.animateNumber('totalWorkers', stats.totalWorkers);
                document.getElementById('monthlyExpenses').textContent = 
                    this.formatCurrency(stats.monthlyExpenses);
                this.animateNumber('dailyProduction', stats.dailyProduction);
                this.animateNumber('todayAttendance', stats.todayAttendance, '%');
                document.getElementById('pendingPayroll').textContent = 
                    this.formatCurrency(stats.pendingPayroll);
                this.animateNumber('activeAdvances', stats.activeAdvances);
            }

            await this.loadKPIs();
            await this.loadRecentActivities();
            await this.loadAlerts();
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
            let activities;
            if (this.db) {
                activities = await this.db.getActivityLogs(5);
            } else {
                activities = await window.electronAPI.getAuditLogs(5);
            }

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
            let licenseStatus;
            if (this.db) {
                licenseStatus = await this.db.getLicenseStatus();
            } else {
                licenseStatus = await window.electronAPI.getLicenseStatus();
            }
            
            if (licenseStatus && !licenseStatus.isValid) {
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
            } else if (licenseStatus && licenseStatus.isTrial && licenseStatus.daysRemaining <= 3) {
                alerts.push({
                    type: 'warning',
                    icon: '⏰',
                    text: 'الفترة التجريبية على وشك الانتهاء',
                    detail: `متبقي ${licenseStatus.daysRemaining} أيام - يرجى التفعيل`
                });
            }

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
            'machine_maintenance': 'صيانة',
            'workspace_groups': 'مجموعة عمل',
            'workspace_fields': 'حقل',
            'workspace_images': 'صورة'
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

document.addEventListener('DOMContentLoaded', async () => {
    const dashboard = new DashboardController();
    await dashboard.initialize();
    window.__dashboard = dashboard;
});