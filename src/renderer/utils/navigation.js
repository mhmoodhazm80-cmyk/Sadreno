// src/renderer/utils/navigation.js

class NavigationSystem {
    constructor() {
        this.currentPage = 'dashboard';
        this.pages = [
            { id: 'dashboard', name: 'لوحة التحكم', icon: '📊', shortcut: 'D', path: 'dashboard/dashboard.html' },
            { id: 'workers', name: 'إدارة العمال', icon: '👷', shortcut: 'W', path: 'workers/workers.html' },
            { id: 'payroll', name: 'الرواتب والسلف', icon: '💰', shortcut: 'P', path: 'payroll/payroll.html' },
            { id: 'expenses', name: 'المصروفات', icon: '💸', shortcut: 'E', path: 'expenses/expenses.html' },
            { id: 'workspace', name: 'منطقة العمل', icon: '🔧', shortcut: 'A', path: 'workspace/workspace.html' },
            { id: 'tutorial', name: 'دليل الاستخدام', icon: '📖', shortcut: 'T', path: 'tutorial/tutorial.html' },
            { id: 'settings', name: 'الإعدادات', icon: '⚙️', shortcut: 'S', path: 'settings/settings.html' }
        ];
        this.isOpen = false;
        this.shortcuts = {};
        this.history = [];
        this.readOnlyMode = false;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            if (window.electronAPI?.getReadOnly) {
                this.readOnlyMode = await window.electronAPI.getReadOnly();
            }
            
            this.createHamburgerMenu();
            this.createNavSidebar();
            this.createShortcutsHint();
            this.setupKeyboardShortcuts();
            await this.loadCurrentPage();
            this.setupPageLoadListener();
            this.setupReadOnlyListener();
            this.setupWindowControls();
            
            this.isInitialized = true;
            console.log('✅ نظام التنقل جاهز');
        } catch (error) {
            console.error('❌ فشل تهيئة نظام التنقل:', error);
        }
    }

    setupWindowControls() {
        const minimizeBtn = document.getElementById('minimizeBtn');
        const maximizeBtn = document.getElementById('maximizeBtn');
        const closeBtn = document.getElementById('closeBtn');

        if (minimizeBtn && window.electronAPI?.minimizeWindow) {
            minimizeBtn.addEventListener('click', () => {
                window.electronAPI.minimizeWindow();
            });
        }

        if (maximizeBtn && window.electronAPI?.maximizeWindow) {
            maximizeBtn.addEventListener('click', () => {
                window.electronAPI.maximizeWindow();
            });
        }

        if (closeBtn && window.electronAPI?.closeWindow) {
            closeBtn.addEventListener('click', () => {
                window.electronAPI.closeWindow();
            });
        }
    }

    setupReadOnlyListener() {
        if (window.electronAPI?.on) {
            window.electronAPI.on('app:readonly-mode', (readOnly) => {
                this.readOnlyMode = readOnly;
                this.updateReadOnlyStatus(readOnly);
            });
        }
    }

    createHamburgerMenu() {
        const existing = document.querySelector('.hamburger-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'hamburger-menu';
        menu.innerHTML = `
            <button class="hamburger-btn" id="hamburgerBtn" title="القائمة">
                <span class="bar"></span>
                <span class="bar"></span>
                <span class="bar"></span>
            </button>
            <span class="app-name">س<span>ديم</span></span>
            <div style="flex:1;"></div>
            <span class="readonly-status" style="color: #9BA5AF; font-size: 12px; opacity: 0.5; -webkit-app-region: no-drag;">
                ${this.readOnlyMode ? '🔒 قراءة فقط' : ''}
            </span>
        `;
        document.body.prepend(menu);

        const btn = document.getElementById('hamburgerBtn');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSidebar();
        });

        document.addEventListener('click', (e) => {
            const sidebar = document.querySelector('.nav-sidebar');
            if (this.isOpen && sidebar && !sidebar.contains(e.target) && !btn.contains(e.target)) {
                this.closeSidebar();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.closeSidebar();
            }
        });
    }

    createNavSidebar() {
        const existing = document.querySelector('.nav-sidebar');
        if (existing) existing.remove();

        const sidebar = document.createElement('div');
        sidebar.className = 'nav-sidebar';
        sidebar.innerHTML = `
            <div class="overlay"></div>
            <div class="nav-header">
                <div class="logo">⭐ س<span>ديم</span></div>
                <div style="font-size: 11px; color: #9BA5AF; opacity: 0.5; margin-top: 4px;">
                    نظام إدارة المصانع المتكامل
                </div>
            </div>
            <nav>
                ${this.pages.map(page => `
                    <div class="nav-item" data-page="${page.id}" data-path="${page.path}">
                        <span class="icon">${page.icon}</span>
                        <span>${page.name}</span>
                        <span class="shortcut">Ctrl+Shift+${page.shortcut}</span>
                    </div>
                `).join('')}
                <div class="nav-divider"></div>
                <div class="nav-item" id="navReadOnly" style="cursor: default; opacity: 0.5;">
                    <span class="icon">🔒</span>
                    <span>${this.readOnlyMode ? 'وضع القراءة فقط - نشط' : 'وضع القراءة فقط - غير نشط'}</span>
                </div>
                <div class="nav-divider"></div>
                <div class="nav-item" style="cursor: default; opacity: 0.3; font-size: 12px;">
                    <span class="icon">📞</span>
                    <span>الدعم الفني: 01554567596</span>
                </div>
            </nav>
            <div class="nav-footer">
                الإصدار 2.0.0 | جميع الحقوق محفوظة © سديم 2024
            </div>
        `;
        document.body.appendChild(sidebar);

        sidebar.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                const path = item.dataset.path;
                this.navigateTo(page, path);
                this.closeSidebar();
            });
        });

        this.updateActiveNavItem();
    }

    createShortcutsHint() {
        const existing = document.querySelector('.shortcuts-hint');
        if (existing) existing.remove();

        const hint = document.createElement('div');
        hint.className = 'shortcuts-hint';
        hint.innerHTML = `
            <span>⌨️ اختصارات:</span>
            ${this.pages.map(p => `
                <span><span class="key">Ctrl+Shift+${p.shortcut}</span> ${p.icon}</span>
            `).join('')}
            <span><span class="key">F5</span> تحديث</span>
            <span><span class="key">Esc</span> إغلاق</span>
        `;
        document.body.appendChild(hint);

        setTimeout(() => {
            hint.classList.add('show');
        }, 3000);

        setTimeout(() => {
            hint.classList.remove('show');
        }, 12000);
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey) {
                const key = e.key.toUpperCase();
                const page = this.pages.find(p => p.shortcut === key);
                if (page) {
                    e.preventDefault();
                    this.navigateTo(page.id, page.path);
                }
            }

            if (e.key === 'F5') {
                e.preventDefault();
                window.location.reload();
            }

            if (e.ctrlKey && e.key === 'Backspace') {
                e.preventDefault();
                this.goBack();
            }

            if (e.ctrlKey && e.key === 'Home') {
                e.preventDefault();
                this.navigateTo('dashboard', 'dashboard/dashboard.html');
            }
        });
    }

    async loadCurrentPage() {
        const path = window.location.pathname;
        const pageName = path.split('/').pop().replace('.html', '');
        
        const page = this.pages.find(p => p.id === pageName);
        if (page) {
            this.currentPage = page.id;
            this.updateActiveNavItem();
        }
    }

    setupPageLoadListener() {
        const observer = new MutationObserver(() => {
            const path = window.location.pathname;
            const pageName = path.split('/').pop().replace('.html', '');
            const page = this.pages.find(p => p.id === pageName);
            if (page) {
                this.currentPage = page.id;
                this.updateActiveNavItem();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    navigateTo(pageId, path) {
        if (this.currentPage === pageId) return;
        
        this.history.push(this.currentPage);
        this.currentPage = pageId;
        
        const basePath = '../';
        const fullPath = basePath + path;
        
        if (window.electronAPI?.navigate) {
            window.electronAPI.navigate(pageId);
        } else {
            window.location.href = fullPath;
        }
        
        this.updateActiveNavItem();
    }

    goBack() {
        if (this.history.length > 0) {
            const previousPage = this.history.pop();
            const page = this.pages.find(p => p.id === previousPage);
            if (page) {
                this.navigateTo(page.id, page.path);
            }
        }
    }

    toggleSidebar() {
        if (this.isOpen) {
            this.closeSidebar();
        } else {
            this.openSidebar();
        }
    }

    openSidebar() {
        this.isOpen = true;
        const sidebar = document.querySelector('.nav-sidebar');
        const btn = document.getElementById('hamburgerBtn');
        if (sidebar) sidebar.classList.add('open');
        if (btn) btn.classList.add('active');
    }

    closeSidebar() {
        this.isOpen = false;
        const sidebar = document.querySelector('.nav-sidebar');
        const btn = document.getElementById('hamburgerBtn');
        if (sidebar) sidebar.classList.remove('open');
        if (btn) btn.classList.remove('active');
    }

    updateActiveNavItem() {
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.classList.toggle('active', item.dataset.page === this.currentPage);
        });
    }

    updateReadOnlyStatus(readOnly) {
        this.readOnlyMode = readOnly;
        
        const readOnlyItem = document.getElementById('navReadOnly');
        if (readOnlyItem) {
            readOnlyItem.innerHTML = `
                <span class="icon">🔒</span>
                <span>${readOnly ? 'وضع القراءة فقط - نشط' : 'وضع القراءة فقط - غير نشط'}</span>
            `;
        }
        
        const statusEl = document.querySelector('.readonly-status');
        if (statusEl) {
            statusEl.textContent = readOnly ? '🔒 قراءة فقط' : '';
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const nav = new NavigationSystem();
    await nav.initialize();
    window.__navigation = nav;
});