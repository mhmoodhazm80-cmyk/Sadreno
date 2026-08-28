class WorkspaceController {
    constructor() {
        this.groups = [];
        this.readOnlyMode = false;
        this.db = window.__db || null;
        this.currentGroupId = null;
        this.draggedItem = null;
        this.initialized = false;
    }

    async initialize() {
        try {
            if (!this.db) {
                this.db = new DatabaseHelper();
                await this.db.initialize();
                window.__db = this.db;
            }

            this.readOnlyMode = await this.db.getReadOnly();
            await this.loadWorkspaceData();
            this.setupEventListeners();
            this.setupDragAndDrop();
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('فشل تهيئة منطقة العمل:', error);
            await window.electronAPI?.logError(error);
            return false;
        }
    }

    async loadWorkspaceData() {
        try {
            const groups = await this.db.getWorkspaceGroups();
            this.groups = groups || [];
            
            for (const group of this.groups) {
                const fields = await this.db.getWorkspaceFields(group.id);
                const images = await this.db.getWorkspaceImages(group.id);
                group.fields = fields || [];
                group.images = images || [];
            }
            
            this.renderGroups();
        } catch (error) {
            console.error('خطأ في تحميل بيانات منطقة العمل:', error);
            this.groups = [];
            this.renderGroups();
        }
    }

    renderGroups() {
        const container = document.getElementById('workspaceGrid');
        container.innerHTML = '';

        if (this.groups.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 60px; color: #9BA5AF;">
                    <div style="font-size: 48px; margin-bottom: 15px;">🔧</div>
                    <div style="font-size: 18px; margin-bottom: 10px;">لا توجد مجموعات عمل</div>
                    <div style="font-size: 14px; opacity: 0.6;">اضغط على "إضافة مجموعة" لبدء تخصيص منطقة العمل</div>
                </div>
            `;
            return;
        }

        for (const group of this.groups) {
            const card = document.createElement('div');
            card.className = 'workspace-card';
            card.dataset.groupId = group.id;
            
            const isReadOnly = this.readOnlyMode ? 'disabled' : '';
            
            let fieldsHtml = '';
            if (group.type === 'images' || group.type === 'mixed') {
                fieldsHtml += this.renderImages(group);
            }
            if (group.type === 'fields' || group.type === 'mixed') {
                fieldsHtml += this.renderFields(group);
            }

            card.innerHTML = `
                <div class="card-header">
                    <div class="card-title">${group.icon || '📁'} ${group.name}</div>
                    <div class="card-actions">
                        <button class="btn-edit" data-id="${group.id}" ${isReadOnly}>✏️</button>
                        <button class="btn-delete" data-id="${group.id}" ${isReadOnly}>🗑️</button>
                    </div>
                </div>
                ${fieldsHtml}
                ${group.type !== 'images' ? `<button class="add-field-btn" data-group="${group.id}" ${isReadOnly}>+ إضافة حقل</button>` : ''}
                ${group.type !== 'fields' ? `<button class="add-image-btn" data-group="${group.id}" ${isReadOnly}>+ إضافة صورة</button>` : ''}
            `;
            
            container.appendChild(card);
        }

        // إضافة أحداث للأزرار
        document.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => this.editGroup(parseInt(btn.dataset.id)));
        });

        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => this.deleteGroup(parseInt(btn.dataset.id)));
        });

        document.querySelectorAll('.add-field-btn').forEach(btn => {
            btn.addEventListener('click', () => this.openFieldModal(parseInt(btn.dataset.group)));
        });

        document.querySelectorAll('.add-image-btn').forEach(btn => {
            btn.addEventListener('click', () => this.addImage(parseInt(btn.dataset.group)));
        });

        document.querySelectorAll('.field-actions .btn-delete-field').forEach(btn => {
            btn.addEventListener('click', () => this.deleteField(parseInt(btn.dataset.id)));
        });

        document.querySelectorAll('.field-actions .btn-edit-field').forEach(btn => {
            btn.addEventListener('click', () => this.editField(parseInt(btn.dataset.id)));
        });

        document.querySelectorAll('.image-overlay .btn-delete-image').forEach(btn => {
            btn.addEventListener('click', () => this.deleteImage(parseInt(btn.dataset.id)));
        });
    }

    renderFields(group) {
        if (!group.fields || group.fields.length === 0) {
            return `
                <div class="empty-state">
                    <span class="empty-icon">📋</span>
                    <div class="empty-text">لا توجد حقول في هذه المجموعة</div>
                </div>
            `;
        }

        let html = '<div class="field-group">';
        for (const field of group.fields) {
            html += `
                <div class="field-item" draggable="true" data-field-id="${field.id}" data-group-id="${group.id}">
                    <span class="drag-handle">⠿</span>
                    <span class="field-label">${field.label}</span>
                    <span class="field-type">${field.type}</span>
                    <div class="field-actions">
                        <button class="btn-edit-field" data-id="${field.id}" title="تعديل">✏️</button>
                        <button class="btn-delete-field" data-id="${field.id}" title="حذف">🗑️</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    }

    renderImages(group) {
        const images = group.images || [];
        if (images.length === 0) {
            return `
                <div class="empty-state">
                    <span class="empty-icon">🖼️</span>
                    <div class="empty-text">لا توجد صور في هذه المجموعة</div>
                </div>
            `;
        }

        let html = '<div class="image-grid">';
        for (const image of images) {
            html += `
                <div class="image-item">
                    <img src="${image.path}" alt="${image.name || 'صورة'}">
                    <div class="image-overlay">
                        <button class="btn-delete-image" data-id="${image.id}">🗑️</button>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    }

    setupEventListeners() {
        document.getElementById('addWorkspaceBtn').addEventListener('click', () => {
            this.openWorkspaceModal();
        });

        document.getElementById('exportWorkspaceBtn').addEventListener('click', async () => {
            await this.exportWorkspace();
        });

        document.getElementById('printWorkspaceBtn').addEventListener('click', () => {
            this.printWorkspace();
        });

        // Modal events
        const workspaceModal = document.getElementById('workspaceModal');
        document.getElementById('modalClose').addEventListener('click', () => {
            workspaceModal.classList.remove('active');
        });
        document.getElementById('cancelBtn').addEventListener('click', () => {
            workspaceModal.classList.remove('active');
        });
        workspaceModal.addEventListener('click', (e) => {
            if (e.target === workspaceModal) {
                workspaceModal.classList.remove('active');
            }
        });

        document.getElementById('workspaceForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveWorkspaceGroup();
        });

        // Field modal events
        const fieldModal = document.getElementById('fieldModal');
        document.getElementById('fieldModalClose').addEventListener('click', () => {
            fieldModal.classList.remove('active');
        });
        document.getElementById('fieldCancelBtn').addEventListener('click', () => {
            fieldModal.classList.remove('active');
        });
        fieldModal.addEventListener('click', (e) => {
            if (e.target === fieldModal) {
                fieldModal.classList.remove('active');
            }
        });

        document.getElementById('fieldForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveField();
        });

        document.getElementById('fieldType').addEventListener('change', (e) => {
            const optionsGroup = document.getElementById('fieldOptionsGroup');
            if (e.target.value === 'select') {
                optionsGroup.style.display = 'block';
            } else {
                optionsGroup.style.display = 'none';
            }
        });
    }

    setupDragAndDrop() {
        document.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.field-item');
            if (item) {
                this.draggedItem = {
                    id: parseInt(item.dataset.fieldId),
                    groupId: parseInt(item.dataset.groupId)
                };
                e.dataTransfer.effectAllowed = 'move';
            }
        });

        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.target.closest('.workspace-card');
            if (target) {
                target.style.borderColor = 'rgba(200, 213, 224, 0.3)';
            }
        });

        document.addEventListener('dragleave', (e) => {
            const target = e.target.closest('.workspace-card');
            if (target) {
                target.style.borderColor = '';
            }
        });

        document.addEventListener('drop', async (e) => {
            e.preventDefault();
            const target = e.target.closest('.workspace-card');
            if (target) {
                target.style.borderColor = '';
                if (this.draggedItem) {
                    const newGroupId = parseInt(target.dataset.groupId);
                    if (this.draggedItem.groupId !== newGroupId) {
                        await this.moveField(this.draggedItem.id, newGroupId);
                    }
                    this.draggedItem = null;
                }
            }
        });
    }

    openWorkspaceModal(editData = null) {
        const modal = document.getElementById('workspaceModal');
        const title = document.getElementById('modalTitle');
        const submitBtn = modal.querySelector('.btn-submit');
        
        if (editData) {
            title.textContent = '✏️ تعديل المجموعة';
            submitBtn.textContent = 'تحديث';
            document.getElementById('groupName').value = editData.name;
            document.getElementById('groupType').value = editData.type;
            document.getElementById('workspaceForm').dataset.editId = editData.id;
        } else {
            title.textContent = '➕ إضافة مجموعة جديدة';
            submitBtn.textContent = 'إنشاء';
            document.getElementById('groupName').value = '';
            document.getElementById('groupType').value = 'fields';
            document.getElementById('workspaceForm').dataset.editId = '';
        }
        
        modal.classList.add('active');
        setTimeout(() => {
            document.getElementById('groupName').focus();
        }, 100);
    }

    async saveWorkspaceGroup() {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن إجراء تغييرات', 'warning');
                return;
            }

            const name = document.getElementById('groupName').value.trim();
            const type = document.getElementById('groupType').value;
            const editId = document.getElementById('workspaceForm').dataset.editId;

            if (!name) {
                this.showToast('⚠️ الرجاء إدخال اسم المجموعة', 'warning');
                return;
            }

            if (editId) {
                await this.db.updateWorkspaceGroup(parseInt(editId), { name, type });
                this.showToast('✅ تم تحديث المجموعة بنجاح', 'success');
            } else {
                await this.db.createWorkspaceGroup({ name, type });
                this.showToast('✅ تم إضافة المجموعة بنجاح', 'success');
            }

            document.getElementById('workspaceModal').classList.remove('active');
            await this.loadWorkspaceData();
        } catch (error) {
            console.error('خطأ في حفظ المجموعة:', error);
            this.showToast('❌ حدث خطأ في حفظ البيانات', 'error');
        }
    }

    async editGroup(id) {
        try {
            const group = this.groups.find(g => g.id === id);
            if (group) {
                this.openWorkspaceModal(group);
            }
        } catch (error) {
            console.error('خطأ في فتح بيانات المجموعة:', error);
        }
    }

    async deleteGroup(id) {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن حذف البيانات', 'warning');
                return;
            }

            const confirmDelete = confirm('⚠️ هل أنت متأكد من حذف هذه المجموعة وجميع محتوياتها؟');
            if (!confirmDelete) return;

            await this.db.deleteWorkspaceGroup(id);
            this.showToast('🗑️ تم حذف المجموعة بنجاح', 'success');
            await this.loadWorkspaceData();
        } catch (error) {
            console.error('خطأ في حذف المجموعة:', error);
            this.showToast('❌ حدث خطأ في حذف المجموعة', 'error');
        }
    }

    openFieldModal(groupId, editData = null) {
        const modal = document.getElementById('fieldModal');
        const title = document.getElementById('fieldModalTitle');
        const submitBtn = modal.querySelector('.btn-submit');
        
        document.getElementById('fieldGroupId').value = groupId;
        
        if (editData) {
            title.textContent = '✏️ تعديل الحقل';
            submitBtn.textContent = 'تحديث';
            document.getElementById('fieldName').value = editData.label;
            document.getElementById('fieldType').value = editData.type;
            document.getElementById('fieldOptions').value = editData.options || '';
            document.getElementById('fieldForm').dataset.editId = editData.id;
            
            const optionsGroup = document.getElementById('fieldOptionsGroup');
            if (editData.type === 'select') {
                optionsGroup.style.display = 'block';
            } else {
                optionsGroup.style.display = 'none';
            }
        } else {
            title.textContent = '➕ إضافة حقل جديد';
            submitBtn.textContent = 'إضافة';
            document.getElementById('fieldName').value = '';
            document.getElementById('fieldType').value = 'text';
            document.getElementById('fieldOptions').value = '';
            document.getElementById('fieldForm').dataset.editId = '';
            document.getElementById('fieldOptionsGroup').style.display = 'none';
        }
        
        modal.classList.add('active');
        setTimeout(() => {
            document.getElementById('fieldName').focus();
        }, 100);
    }

    async saveField() {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن إجراء تغييرات', 'warning');
                return;
            }

            const groupId = parseInt(document.getElementById('fieldGroupId').value);
            const label = document.getElementById('fieldName').value.trim();
            const type = document.getElementById('fieldType').value;
            const options = document.getElementById('fieldOptions').value.trim();
            const editId = document.getElementById('fieldForm').dataset.editId;

            if (!label) {
                this.showToast('⚠️ الرجاء إدخال اسم الحقل', 'warning');
                return;
            }

            const fieldData = {
                group_id: groupId,
                label: label,
                type: type,
                options: options
            };

            if (editId) {
                await this.db.updateWorkspaceField(parseInt(editId), fieldData);
                this.showToast('✅ تم تحديث الحقل بنجاح', 'success');
            } else {
                await this.db.createWorkspaceField(fieldData);
                this.showToast('✅ تم إضافة الحقل بنجاح', 'success');
            }

            document.getElementById('fieldModal').classList.remove('active');
            await this.loadWorkspaceData();
        } catch (error) {
            console.error('خطأ في حفظ الحقل:', error);
            this.showToast('❌ حدث خطأ في حفظ البيانات', 'error');
        }
    }

    async editField(id) {
        try {
            let field = null;
            for (const group of this.groups) {
                const found = group.fields?.find(f => f.id === id);
                if (found) {
                    field = found;
                    break;
                }
            }
            if (field) {
                this.openFieldModal(field.group_id, field);
            }
        } catch (error) {
            console.error('خطأ في فتح بيانات الحقل:', error);
        }
    }

    async deleteField(id) {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن حذف البيانات', 'warning');
                return;
            }

            const confirmDelete = confirm('⚠️ هل أنت متأكد من حذف هذا الحقل؟');
            if (!confirmDelete) return;

            await this.db.deleteWorkspaceField(id);
            this.showToast('🗑️ تم حذف الحقل بنجاح', 'success');
            await this.loadWorkspaceData();
        } catch (error) {
            console.error('خطأ في حذف الحقل:', error);
            this.showToast('❌ حدث خطأ في حذف الحقل', 'error');
        }
    }

    async moveField(fieldId, newGroupId) {
        try {
            if (this.readOnlyMode) return;

            await window.electronAPI.dbRun(`
                UPDATE workspace_fields 
                SET group_id = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `, [newGroupId, fieldId]);
            
            await this.loadWorkspaceData();
            this.showToast('✅ تم نقل الحقل بنجاح', 'success');
        } catch (error) {
            console.error('خطأ في نقل الحقل:', error);
            this.showToast('❌ حدث خطأ في نقل الحقل', 'error');
        }
    }

    async addImage(groupId) {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن إضافة صور', 'warning');
                return;
            }

            const imageUrl = prompt('أدخل رابط الصورة أو اختر ملف:');
            if (!imageUrl) return;

            await this.db.createWorkspaceImage({
                group_id: groupId,
                path: imageUrl,
                name: 'صورة ' + new Date().toLocaleDateString()
            });
            
            this.showToast('✅ تم إضافة الصورة بنجاح', 'success');
            await this.loadWorkspaceData();
        } catch (error) {
            console.error('خطأ في إضافة الصورة:', error);
            this.showToast('❌ حدث خطأ في إضافة الصورة', 'error');
        }
    }

    async deleteImage(id) {
        try {
            if (this.readOnlyMode) {
                this.showToast('⚠️ وضع القراءة فقط - لا يمكن حذف الصور', 'warning');
                return;
            }

            const confirmDelete = confirm('⚠️ هل أنت متأكد من حذف هذه الصورة؟');
            if (!confirmDelete) return;

            await this.db.deleteWorkspaceImage(id);
            this.showToast('🗑️ تم حذف الصورة بنجاح', 'success');
            await this.loadWorkspaceData();
        } catch (error) {
            console.error('خطأ في حذف الصورة:', error);
            this.showToast('❌ حدث خطأ في حذف الصورة', 'error');
        }
    }

    async exportWorkspace() {
        try {
            if (!this.groups || this.groups.length === 0) {
                this.showToast('⚠️ لا توجد بيانات للتصدير', 'warning');
                return;
            }

            const exportData = [];
            for (const group of this.groups) {
                const row = {
                    'المجموعة': group.name,
                    'النوع': group.type
                };
                if (group.fields) {
                    for (const field of group.fields) {
                        row[field.label] = '';
                    }
                }
                exportData.push(row);
            }

            const result = await window.electronAPI.exportExcel(exportData, {
                title: 'منطقة العمل'
            });

            if (result.success) {
                this.showToast('📊 تم تصدير منطقة العمل بنجاح', 'success');
            } else {
                this.showToast('❌ فشل تصدير منطقة العمل', 'error');
            }
        } catch (error) {
            console.error('خطأ في تصدير منطقة العمل:', error);
            this.showToast('❌ حدث خطأ في التصدير', 'error');
        }
    }

    printWorkspace() {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            this.showToast('⚠️ الرجاء السماح بالنوافذ المنبثقة', 'warning');
            return;
        }

        let html = `
            <html>
            <head>
                <title>منطقة العمل - سديم</title>
                <style>
                    body { font-family: Arial, sans-serif; direction: rtl; padding: 20px; }
                    h1 { color: #2B2D42; }
                    .group { margin-bottom: 30px; border: 1px solid #ddd; padding: 15px; border-radius: 8px; }
                    .group h2 { color: #2B2D42; margin-bottom: 10px; }
                    .field { padding: 5px 0; border-bottom: 1px solid #eee; }
                    .field-label { font-weight: bold; color: #333; }
                    .images { display: flex; gap: 10px; flex-wrap: wrap; }
                    .images img { max-width: 100px; max-height: 100px; border-radius: 4px; }
                    .no-data { color: #999; font-style: italic; }
                </style>
            </head>
            <body>
                <h1>🔧 منطقة العمل - سديم</h1>
                <p>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</p>
        `;

        for (const group of this.groups) {
            html += `<div class="group"><h2>📁 ${group.name}</h2>`;
            html += `<p>النوع: ${group.type === 'fields' ? 'حقول' : group.type === 'images' ? 'صور' : 'مختلط'}</p>`;
            
            if (group.fields && group.fields.length > 0) {
                for (const field of group.fields) {
                    html += `<div class="field"><span class="field-label">${field.label}:</span> <span>_____</span> <span style="color: #999; font-size: 12px;">(${field.type})</span></div>`;
                }
            } else {
                html += `<div class="no-data">لا توجد حقول</div>`;
            }
            
            if (group.images && group.images.length > 0) {
                html += `<div class="images">`;
                for (const image of group.images) {
                    html += `<img src="${image.path}" alt="${image.name}">`;
                }
                html += `</div>`;
            }
            
            html += '</div>';
        }

        html += `
            <p style="text-align: center; color: #999; margin-top: 30px;">تم الطباعة بواسطة نظام سديم - جميع الحقوق محفوظة</p>
            <script>
                setTimeout(() => { window.print(); }, 500);
            <\/script>
            </body>
            </html>
        `;

        printWindow.document.write(html);
        printWindow.document.close();
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
}

document.addEventListener('DOMContentLoaded', async () => {
    const workspace = new WorkspaceController();
    await workspace.initialize();
    window.__workspace = workspace;
});