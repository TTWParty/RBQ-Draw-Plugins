/**
 * RBQ-Draw-Plugins: 服务端图库同步与存储管理 (Gallery Sync & Storage Manager)
 * 插件 ID: rbq-gallery-sync
 * 功能：
 * 1. 双轨省流云同步：生成图片后客户端后台静默生成 ~60KB WebP 预览图并上传至酒馆服务端，实现多端秒开且 98% 省流；
 * 2. 收藏自动原画上传：点击「⭐ 收藏」时自动提取无损原画上传至服务端持久化保存；
 * 3. 大图查看器存储状态指示点 (Storage Dot Badge)：微型圆点标注图片存储归属（本地浏览器/酒馆服务端/绘图后端/省流预览），点击弹出响应式详情卡片；
 * 4. 存储详情与一键操作浮窗：查看真实物理路径、尺寸与大小，支持「上传原图到服务端」、「复制路径」；
 * 5. 网络自适应保护：检测到移动蜂窝数据 (Save-Data) 时自动阻断高清原图加载，杜绝流量偷跑。
 */
(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Gallery Sync] RBQ Core API missing');

    const PLUGIN_ID = 'rbq-gallery-sync';
    const PLUGIN_NAME = '服务端图库同步与存储管理';
    const PLUGIN_VERSION = '1.1.0';
    const STORAGE_KEY = '_gallerySyncSettings';

    const DEFAULT_SETTINGS = {
        enabled: true,
        syncMode: 'stream_only', // 'local' | 'stream_only' | 'full'
        syncFavoritesOriginal: true, // ⭐ 收藏时自动上传高清原画至服务端
        previewQuality: 0.8,
        previewMaxDimension: 768,
        saveDataAware: true,
        enableViewerBadge: true,
        enableSyncToast: false,
    };

    // ── 1. Settings & Store ──
    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY]) s[STORAGE_KEY] = { ...DEFAULT_SETTINGS };
        const store = s[STORAGE_KEY];
        for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
            if (store[k] === undefined) store[k] = v;
        }
        return store;
    }

    function save() {
        RBQ.api.saveSettings();
    }

    // ── 2. Helpers: Network & Compression ──
    function isCellularOrSaveData() {
        try {
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (!conn) return false;
            if (conn.saveData) return true;
            if (conn.type === 'cellular' || conn.effectiveType === '2g' || conn.effectiveType === '3g') return true;
        } catch (_e) {}
        return false;
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const b64 = reader.result;
                if (typeof b64 === 'string') {
                    const commaIdx = b64.indexOf(',');
                    resolve(commaIdx >= 0 ? b64.slice(commaIdx + 1) : b64);
                } else {
                    reject(new Error('转换 Base64 失败'));
                }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function createOptimizedWebpBlob(imageSource, maxDimension = 768, quality = 0.8) {
        let bitmap = null;
        if (imageSource instanceof Blob) {
            try {
                bitmap = await createImageBitmap(imageSource);
            } catch (_e) {
                // Fallback to Image element
                const url = URL.createObjectURL(imageSource);
                bitmap = await new Promise((res, rej) => {
                    const img = new Image();
                    img.onload = () => res(img);
                    img.onerror = rej;
                    img.src = url;
                });
            }
        } else if (imageSource instanceof HTMLImageElement) {
            bitmap = imageSource;
        }

        if (!bitmap) return null;
        const width = bitmap.width || bitmap.naturalWidth || 0;
        const height = bitmap.height || bitmap.naturalHeight || 0;
        if (!width || !height) return null;

        const scale = Math.min(1, maxDimension / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        if (typeof bitmap.close === 'function') bitmap.close();

        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/webp', quality);
        });
    }

    // ── 3. Server Upload Pipeline ──
    async function uploadBlobToServer(blob, filename = 'rbq_preview.webp') {
        if (!(blob instanceof Blob) || !blob.size) throw new Error('无效的图片 Blob');

        // 尝试 1: POST /api/files/upload (FormData 模式)
        try {
            const formData = new FormData();
            formData.append('avatar', blob, filename);
            formData.append('file', blob, filename);
            const res = await fetch('/api/files/upload', {
                method: 'POST',
                body: formData,
            });
            if (res.ok) {
                const data = await res.json();
                const path = data.path || data.url || data.filepath;
                if (path) return path;
            }
        } catch (_e1) {}

        // 尝试 2: POST /api/files/upload (JSON base64 模式)
        try {
            const b64 = await blobToBase64(blob);
            const res = await fetch('/api/files/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: filename, content: b64 }),
            });
            if (res.ok) {
                const data = await res.json();
                const path = data.path || data.url || data.filepath;
                if (path) return path;
            }
        } catch (_e2) {}

        // 尝试 3: POST /api/images/upload
        try {
            const formData = new FormData();
            formData.append('avatar', blob, filename);
            const res = await fetch('/api/images/upload', {
                method: 'POST',
                body: formData,
            });
            if (res.ok) {
                const data = await res.json();
                const path = data.path || data.url || data.filepath;
                if (path) return path;
            }
        } catch (_e3) {}

        throw new Error('未找到可用的酒馆服务端图片上传接口 (/api/files/upload)');
    }

    // ── 4. Image Storage Inspector ──
    async function inspectImageStorage(item) {
        if (!item) return { type: 'unknown', text: '未知', title: '未知存储位置', color: '#94a3b8', details: {} };

        const url = String(item.displayUrl || item.url || '');
        const serverUrl = String(item.serverUrl || item.serverPreviewUrl || '');
        const serverOriginalUrl = String(item.serverOriginalUrl || '');
        const cacheId = item.cacheId || '';

        let inIndexedDb = false;
        let blobSize = 0;
        let blobType = '';

        if (cacheId && typeof RBQ?.api?.getCachedImageRecord === 'function') {
            try {
                const record = await RBQ.api.getCachedImageRecord(cacheId);
                if (record && record.blob instanceof Blob) {
                    inIndexedDb = true;
                    blobSize = record.blob.size;
                    blobType = record.blob.type;
                }
            } catch (_e) {}
        }

        // 判定 1: 绘图后端直连 (ComfyUI / SD WebUI)
        if (url.includes('/view?filename=') || url.includes(':8188') || url.includes(':7860') || (item.mode === 'comfyui' && !serverUrl && !serverOriginalUrl)) {
            return {
                type: 'backend',
                text: '绘图后端',
                title: '绘图工具输出目录 (ComfyUI / SD)',
                color: '#c084fc', // purple
                inIndexedDb,
                blobSize,
                blobType,
                path: url,
                canSync: inIndexedDb || !!url,
                canSyncOriginal: true,
                serverUrl,
                cacheId,
            };
        }

        // 判定 2: 酒馆服务端高清原画
        if (serverOriginalUrl || (serverUrl && !serverUrl.includes('_preview.webp'))) {
            const effectivePath = serverOriginalUrl || serverUrl;
            return {
                type: 'server',
                text: '酒馆服务端 (原图)',
                title: '酒馆服务器持久化高清原画 (已同步云端)',
                color: '#38bdf8', // sky blue
                inIndexedDb,
                blobSize,
                blobType,
                path: effectivePath,
                canSync: false,
                canSyncOriginal: false,
                serverUrl: effectivePath,
                cacheId,
            };
        }

        // 判定 3: 酒馆服务端轻量预览图
        if (serverUrl || item.serverPreviewUrl || url.includes('_preview.webp')) {
            const effectivePath = serverUrl || item.serverPreviewUrl || url;
            return {
                type: 'preview',
                text: '酒馆服务端 (预览)',
                title: '酒馆轻量 WebP 预览图 (~60KB 省流中)',
                color: '#facc15', // amber
                inIndexedDb,
                blobSize,
                blobType,
                path: effectivePath,
                canSync: inIndexedDb || !!item.url,
                canSyncOriginal: true, // 可补传无损原画
                serverUrl: effectivePath,
                cacheId,
            };
        }

        // 判定 4: 仅本地浏览器 (IndexedDB 缓存)
        if (inIndexedDb || url.startsWith('blob:')) {
            return {
                type: 'local',
                text: '本地浏览器',
                title: '仅保存在当前设备浏览器中 (IndexedDB)',
                color: '#4ade80', // green
                inIndexedDb: true,
                blobSize,
                blobType,
                path: `IndexedDB: ${cacheId || 'blob'}`,
                canSync: true,
                canSyncOriginal: true,
                serverUrl,
                cacheId,
            };
        }

        return {
            type: 'external',
            text: '外部链接',
            title: '外部网络资源',
            color: '#a855f7',
            inIndexedDb,
            blobSize,
            blobType,
            path: url,
            canSync: true,
            canSyncOriginal: true,
            serverUrl,
            cacheId,
        };
    }

    // ── 5. Background Auto-Sync on Image Generated ──
    window.addEventListener('st-scene-trigger:image-generated', async (event) => {
        const store = getStore();
        if (!store.enabled || store.syncMode === 'local') return;

        const item = event?.detail?.item;
        if (!item) return;

        // 避免重复同步
        if (item.serverPreviewUrl || item.serverUrl) return;

        // 蜂窝数据省流保护
        if (store.saveDataAware && isCellularOrSaveData() && store.syncMode === 'full') {
            console.info(`[${PLUGIN_NAME}] 移动数据网络已激活，自动降级为仅同步轻量预览图`);
        }

        // 空闲时段异步上传，绝不争抢主线程
        const scheduleUpload = window.requestIdleCallback || ((cb) => setTimeout(cb, 1000));
        scheduleUpload(async () => {
            try {
                let originalBlob = null;
                if (item.cacheId && typeof RBQ?.api?.getCachedImageRecord === 'function') {
                    const rec = await RBQ.api.getCachedImageRecord(item.cacheId);
                    if (rec?.blob instanceof Blob) originalBlob = rec.blob;
                }

                if (!originalBlob && item.url) {
                    try {
                        const res = await fetch(item.url);
                        if (res.ok) originalBlob = await res.blob();
                    } catch (_e) {}
                }

                if (!originalBlob) return;

                const now = Date.now();
                const mode = item.mode || 'rbq';

                if (store.syncMode === 'full') {
                    // 全量原图上传
                    let ext = 'png';
                    if (originalBlob.type === 'image/jpeg' || originalBlob.type === 'image/jpg') ext = 'jpg';
                    else if (originalBlob.type === 'image/webp') ext = 'webp';

                    const filename = `rbq_${mode}_${now}.${ext}`;
                    const uploadedPath = await uploadBlobToServer(originalBlob, filename);
                    if (uploadedPath) {
                        item.serverUrl = uploadedPath;
                        item.serverOriginalUrl = uploadedPath;
                        console.info(`[${PLUGIN_NAME}] ✅ 原画已同步至服务端: ${uploadedPath} (${formatBytes(originalBlob.size)})`);

                        if (item.messageId != null) {
                            const ctx = RBQ.api.getContext?.();
                            const msg = ctx?.chat?.[item.messageId];
                            if (msg) {
                                if (!msg.extra) msg.extra = {};
                                if (msg.extra.rbq_image) msg.extra.rbq_image.serverUrl = uploadedPath;
                                if (Array.isArray(msg.extra.rbq_images) && msg.extra.rbq_images[0]) {
                                    msg.extra.rbq_images[0].serverUrl = uploadedPath;
                                }
                                RBQ.api.saveChatDebounced?.();
                            }
                        }

                        if (store.enableSyncToast) {
                            toastr.info(`生图原画已同步至酒馆云端 (${formatBytes(originalBlob.size)})`, PLUGIN_NAME);
                        }
                    }
                    return;
                }

                // 默认 stream_only: 压制 50~80KB 预览图
                const previewFilename = `rbq_${mode}_${now}_preview.webp`;
                const previewBlob = await createOptimizedWebpBlob(
                    originalBlob,
                    store.previewMaxDimension || 768,
                    store.previewQuality || 0.8
                );

                if (!previewBlob) return;

                const uploadedPath = await uploadBlobToServer(previewBlob, previewFilename);
                if (uploadedPath) {
                    item.serverPreviewUrl = uploadedPath;
                    console.info(`[${PLUGIN_NAME}] ✅ 轻量预览图已同步至服务端: ${uploadedPath} (${formatBytes(previewBlob.size)})`);

                    // 同步到会话消息 extra
                    if (item.messageId != null) {
                        const ctx = RBQ.api.getContext?.();
                        const msg = ctx?.chat?.[item.messageId];
                        if (msg) {
                            if (!msg.extra) msg.extra = {};
                            if (msg.extra.rbq_image) msg.extra.rbq_image.serverPreviewUrl = uploadedPath;
                            if (Array.isArray(msg.extra.rbq_images) && msg.extra.rbq_images[0]) {
                                msg.extra.rbq_images[0].serverPreviewUrl = uploadedPath;
                            }
                            RBQ.api.saveChatDebounced?.();
                        }
                    }

                    if (store.enableSyncToast) {
                        toastr.info(`生图已同步至酒馆云端 (${formatBytes(previewBlob.size)})`, PLUGIN_NAME);
                    }
                }
            } catch (err) {
                console.warn(`[${PLUGIN_NAME}] 自动上传轻量图失败:`, err);
            }
        });
    });

    // ── 6. Favorite Auto-Upload Original Handler ──
    async function syncFavoriteOriginal(item) {
        const store = getStore();
        if (!store.enabled || !store.syncFavoritesOriginal) return;
        if (!item) return;

        // 如果已经是服务端原图，无需重复上传
        if (item.serverOriginalUrl) return;
        if (item.serverUrl && !item.serverUrl.includes('_preview.webp')) return;

        try {
            let originalBlob = null;
            if (item.cacheId && typeof RBQ?.api?.getCachedImageRecord === 'function') {
                const rec = await RBQ.api.getCachedImageRecord(item.cacheId);
                if (rec?.blob instanceof Blob) originalBlob = rec.blob;
            }

            if (!originalBlob && item.url) {
                try {
                    const res = await fetch(item.url);
                    if (res.ok) originalBlob = await res.blob();
                } catch (_e) {}
            }

            if (!originalBlob) {
                console.warn(`[${PLUGIN_NAME}] 收藏图片上传原图失败: 未能获取到原始图片二进制数据`);
                return;
            }

            toastr.info('正在将收藏的高清原画同步至酒馆服务端...', PLUGIN_NAME);

            const mode = item.mode || 'rbq';
            const now = Date.now();
            let ext = 'png';
            if (originalBlob.type === 'image/jpeg' || originalBlob.type === 'image/jpg') ext = 'jpg';
            else if (originalBlob.type === 'image/webp') ext = 'webp';

            const filename = `rbq_${mode}_fav_${now}.${ext}`;
            const uploadedPath = await uploadBlobToServer(originalBlob, filename);

            if (uploadedPath) {
                item.serverOriginalUrl = uploadedPath;
                item.serverUrl = uploadedPath;
                console.info(`[${PLUGIN_NAME}] ⭐ 收藏原画已成功同步至服务端: ${uploadedPath} (${formatBytes(originalBlob.size)})`);

                // 同步消息 extra
                if (item.messageId != null) {
                    const ctx = RBQ.api.getContext?.();
                    const msg = ctx?.chat?.[item.messageId];
                    if (msg) {
                        if (!msg.extra) msg.extra = {};
                        if (msg.extra.rbq_image) {
                            msg.extra.rbq_image.serverOriginalUrl = uploadedPath;
                            msg.extra.rbq_image.serverUrl = uploadedPath;
                        }
                        if (Array.isArray(msg.extra.rbq_images) && msg.extra.rbq_images[0]) {
                            msg.extra.rbq_images[0].serverOriginalUrl = uploadedPath;
                            msg.extra.rbq_images[0].serverUrl = uploadedPath;
                        }
                        RBQ.api.saveChatDebounced?.();
                    }
                }

                // 如果当前查看器正打开此图，刷新指示点状态
                if (currentViewerItem && (currentViewerItem === item || currentViewerItem.id === item.id)) {
                    const modal = document.getElementById('st-scene-trigger-image-viewer');
                    updateViewerBadge({ modal, current: item });
                }

                toastr.success(`⭐ 收藏原画已持久化至酒馆服务端 (${formatBytes(originalBlob.size)})`, PLUGIN_NAME);
            }
        } catch (err) {
            console.error(`[${PLUGIN_NAME}] 收藏原画同步失败:`, err);
            toastr.error(`收藏原画同步失败: ${err.message || err}`, PLUGIN_NAME);
        }
    }

    // 监听收藏事件 (st-scene-trigger 主扩展分发)
    window.addEventListener('st-scene-trigger:favorite-toggled', (event) => {
        const { item, isFavorite } = event.detail || {};
        if (item && isFavorite) {
            syncFavoriteOriginal(item);
        }
    });

    // 额外兜底监听：画廊或查看器内点击收藏按钮
    document.addEventListener('click', (e) => {
        const favBtn = e.target.closest?.('.st-scene-trigger-viewer-favorite, [data-action="toggle-fav"]');
        if (favBtn && currentViewerItem) {
            setTimeout(() => {
                if (currentViewerItem.isFavorite) {
                    syncFavoriteOriginal(currentViewerItem);
                }
            }, 100);
        }
    });

    // ── 7. Storage Badge & Popover in Image Viewer ──
    let currentViewerItem = null;

    function injectStyles() {
        if (document.getElementById('rbq-gallery-sync-style')) return;
        const style = document.createElement('style');
        style.id = 'rbq-gallery-sync-style';
        style.textContent = `
            .rbq-storage-badge-wrap {
                display: inline-flex;
                align-items: center;
                position: relative;
                margin-right: 4px;
                flex-shrink: 0;
            }
            .rbq-storage-badge-btn {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 32px !important;
                height: 32px !important;
                padding: 0 !important;
                border-radius: 50% !important;
                background: rgba(18, 20, 30, 0.72) !important;
                backdrop-filter: blur(12px) !important;
                -webkit-backdrop-filter: blur(12px) !important;
                border: 1px solid rgba(255, 255, 255, 0.12) !important;
                color: #f1f5f9 !important;
                cursor: pointer !important;
                transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24) !important;
                flex-shrink: 0 !important;
            }
            .rbq-storage-badge-btn:hover {
                background: rgba(30, 34, 48, 0.9) !important;
                border-color: rgba(255, 255, 255, 0.25) !important;
                transform: translateY(-1px);
            }
            .rbq-storage-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                display: inline-block;
                flex-shrink: 0;
                box-shadow: 0 0 8px currentColor;
                pointer-events: none;
                transition: background-color 0.25s ease;
            }
            .rbq-storage-popover {
                position: absolute;
                top: calc(100% + 8px);
                right: 0;
                width: 320px;
                background: rgba(15, 18, 28, 0.96);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 14px;
                padding: 14px 16px;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05);
                z-index: 1000000;
                display: none;
                flex-direction: column;
                gap: 10px;
                color: #e2e8f0;
                font-family: inherit;
                box-sizing: border-box;
                animation: rbqPopoverIn 0.2s ease-out;
            }
            @media (max-width: 768px) {
                .rbq-storage-popover {
                    position: fixed !important;
                    top: auto !important;
                    bottom: max(16px, env(safe-area-inset-bottom, 16px)) !important;
                    left: 12px !important;
                    right: 12px !important;
                    width: auto !important;
                    max-width: calc(100vw - 24px) !important;
                    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
                }
            }
            @keyframes rbqPopoverIn {
                from { opacity: 0; transform: translateY(-6px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .rbq-storage-popover.open {
                display: flex !important;
            }
            .rbq-storage-popover-title {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 13px;
                font-weight: 600;
                color: #f8fafc;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                padding-bottom: 8px;
            }
            .rbq-storage-info-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                font-size: 12px;
            }
            .rbq-storage-info-row {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 10px;
            }
            .rbq-storage-info-label {
                color: #94a3b8;
                flex-shrink: 0;
            }
            .rbq-storage-info-val {
                color: #f1f5f9;
                font-weight: 500;
                text-align: right;
                word-break: break-all;
            }
            .rbq-storage-path-box {
                background: rgba(0, 0, 0, 0.35);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 6px;
                padding: 6px 8px;
                font-size: 11px;
                font-family: ui-monospace, monospace;
                color: #38bdf8;
                max-height: 52px;
                overflow-y: auto;
                word-break: break-all;
            }
            .rbq-storage-actions {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-top: 4px;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                padding-top: 8px;
            }
            .rbq-storage-action-btn {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 6px !important;
                width: 100% !important;
                height: 30px !important;
                border-radius: 8px !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                transition: all 0.16s ease !important;
                box-sizing: border-box !important;
            }
            .rbq-storage-btn-sync {
                background: rgba(56, 189, 248, 0.16) !important;
                border: 1px solid rgba(56, 189, 248, 0.35) !important;
                color: #38bdf8 !important;
            }
            .rbq-storage-btn-sync:hover {
                background: rgba(56, 189, 248, 0.28) !important;
                border-color: #38bdf8 !important;
            }
            .rbq-storage-btn-copy {
                background: rgba(255, 255, 255, 0.06) !important;
                border: 1px solid rgba(255, 255, 255, 0.12) !important;
                color: #e2e8f0 !important;
            }
            .rbq-storage-btn-copy:hover {
                background: rgba(255, 255, 255, 0.12) !important;
            }
        `;
        document.head.appendChild(style);
    }

    async function updateViewerBadge(detail) {
        const store = getStore();
        if (!store.enableViewerBadge) return;

        const modal = detail?.modal || document.getElementById('st-scene-trigger-image-viewer');
        if (!modal) return;

        const actions = modal.querySelector('.st-scene-trigger-viewer-actions');
        if (!actions) return;

        const current = detail?.current;
        currentViewerItem = current;
        if (!current) return;

        injectStyles();

        let wrap = actions.querySelector('#rbq-storage-badge-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'rbq-storage-badge-wrap';
            wrap.className = 'rbq-storage-badge-wrap';

            wrap.innerHTML = `
                <button id="rbq-storage-badge-btn" class="rbq-storage-badge-btn menu_button" type="button" title="点击查阅存储归属与云端同步详情">
                    <span id="rbq-storage-dot" class="rbq-storage-dot" style="background:#94a3b8;"></span>
                </button>
                <div id="rbq-storage-popover" class="rbq-storage-popover"></div>
            `;

            // 挂在缩放倍率按钮前面
            const zoomPill = actions.querySelector('.st-scene-trigger-viewer-zoom-pill');
            if (zoomPill) {
                actions.insertBefore(wrap, zoomPill);
            } else {
                actions.prepend(wrap);
            }

            // 绑定点击事件
            const badgeBtn = wrap.querySelector('#rbq-storage-badge-btn');
            const popover = wrap.querySelector('#rbq-storage-popover');
            badgeBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                popover.classList.toggle('open');
            });

            // 点击外部关闭弹窗
            document.addEventListener('click', (e) => {
                if (!wrap.contains(e.target)) {
                    popover.classList.remove('open');
                }
            });
        }

        const badgeBtn = wrap.querySelector('#rbq-storage-badge-btn');
        const dot = wrap.querySelector('#rbq-storage-dot');
        const popover = wrap.querySelector('#rbq-storage-popover');

        // 检测存储物理归属
        const info = await inspectImageStorage(current);

        if (dot) dot.style.background = info.color;
        if (badgeBtn) badgeBtn.title = `存储状态: ${info.text} (${info.title}) - 点击查看详情`;

        const sizeStr = info.blobSize ? formatBytes(info.blobSize) : (current.url ? '云端流媒体' : '未知');
        const dimStr = (current.width && current.height) ? `${current.width} × ${current.height}` : '自适应';

        popover.innerHTML = `
            <div class="rbq-storage-popover-title">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="rbq-storage-dot" style="background:${info.color};"></span>
                    <span style="font-weight:600;color:#f8fafc;">${info.text}</span>
                </div>
                <button id="rbq-popover-close-btn" type="button" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:15px;padding:2px 6px;line-height:1;" title="关闭">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="rbq-storage-info-list">
                <div class="rbq-storage-info-row">
                    <span class="rbq-storage-info-label">存储归属：</span>
                    <span class="rbq-storage-info-val" style="color:${info.color};font-weight:600;">${info.title}</span>
                </div>
                <div class="rbq-storage-info-row">
                    <span class="rbq-storage-info-label">规格尺寸：</span>
                    <span class="rbq-storage-info-val">${dimStr} (${sizeStr})</span>
                </div>
                <div class="rbq-storage-info-row">
                    <span class="rbq-storage-info-label">多端状态：</span>
                    <span class="rbq-storage-info-val">${info.type === 'server' ? '✅ 高清原画已入库' : (info.type === 'preview' ? '⚡ 轻量预览图已同步' : '⚠️ 仅当前设备可用')}</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:3px;margin-top:2px;">
                    <span class="rbq-storage-info-label">物理路径 / URL：</span>
                    <div class="rbq-storage-path-box">${escapeHtml(info.path || '(内存链接)')}</div>
                </div>
            </div>
            <div class="rbq-storage-actions">
                ${info.canSync ? `
                    <button id="rbq-action-manual-sync" class="menu_button rbq-storage-action-btn rbq-storage-btn-sync" type="button">
                        <i class="fa-solid fa-cloud-arrow-up"></i> ${info.type === 'preview' ? '上传高清原画至酒馆' : '一键同步至酒馆服务端'}
                    </button>
                ` : ''}
                <button id="rbq-action-copy-path" class="menu_button rbq-storage-action-btn rbq-storage-btn-copy" type="button">
                    <i class="fa-solid fa-copy"></i> 复制物理路径 / 链接
                </button>
                <button id="rbq-action-open-settings" class="menu_button rbq-storage-action-btn rbq-storage-btn-copy" type="button">
                    <i class="fa-solid fa-sliders"></i> 打开云同步设置
                </button>
            </div>
        `;

        // 绑定关闭按钮
        popover.querySelector('#rbq-popover-close-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.classList.remove('open');
        });

        // 绑定弹窗内操作按钮
        popover.querySelector('#rbq-action-manual-sync')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const syncBtn = e.currentTarget;
            syncBtn.disabled = true;
            syncBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在上传服务端...';

            try {
                let blobToSync = null;
                if (current.cacheId && typeof RBQ?.api?.getCachedImageRecord === 'function') {
                    const rec = await RBQ.api.getCachedImageRecord(current.cacheId);
                    if (rec?.blob instanceof Blob) blobToSync = rec.blob;
                }
                if (!blobToSync && current.displayUrl) {
                    const res = await fetch(current.displayUrl);
                    if (res.ok) blobToSync = await res.blob();
                }
                if (!blobToSync && current.url) {
                    const res = await fetch(current.url);
                    if (res.ok) blobToSync = await res.blob();
                }

                if (!blobToSync) throw new Error('无法读取图片原始数据');

                const mode = current.mode || 'rbq';
                const now = Date.now();
                let ext = 'png';
                if (blobToSync.type === 'image/jpeg' || blobToSync.type === 'image/jpg') ext = 'jpg';
                else if (blobToSync.type === 'image/webp') ext = 'webp';

                const filename = `rbq_${mode}_manual_${now}.${ext}`;
                const path = await uploadBlobToServer(blobToSync, filename);

                current.serverUrl = path;
                current.serverOriginalUrl = path;

                // 同步消息 extra
                if (current.messageId != null) {
                    const ctx = RBQ.api.getContext?.();
                    const msg = ctx?.chat?.[current.messageId];
                    if (msg) {
                        if (!msg.extra) msg.extra = {};
                        if (msg.extra.rbq_image) {
                            msg.extra.rbq_image.serverUrl = path;
                            msg.extra.rbq_image.serverOriginalUrl = path;
                        }
                        if (Array.isArray(msg.extra.rbq_images) && msg.extra.rbq_images[0]) {
                            msg.extra.rbq_images[0].serverUrl = path;
                            msg.extra.rbq_images[0].serverOriginalUrl = path;
                        }
                        RBQ.api.saveChatDebounced?.();
                    }
                }

                toastr.success(`已成功同步高清原画到酒馆服务端: ${path}`, PLUGIN_NAME);
                popover.classList.remove('open');
                await updateViewerBadge(detail);
            } catch (syncErr) {
                toastr.error(`同步失败: ${syncErr.message || syncErr}`, PLUGIN_NAME);
                syncBtn.disabled = false;
                syncBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 重试同步';
            }
        });

        popover.querySelector('#rbq-action-copy-path')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const textToCopy = info.path || current.url || '';
            if (!textToCopy) return toastr.warning('没有可复制的有效路径', PLUGIN_NAME);
            navigator.clipboard.writeText(textToCopy).then(() => {
                toastr.success('路径已成功复制到剪贴板', PLUGIN_NAME);
            }).catch(() => {
                toastr.info(textToCopy, '路径复制');
            });
        });

        popover.querySelector('#rbq-action-open-settings')?.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.classList.remove('open');
            // 打开主控制台并切到该设置页
            const drawerBtn = document.getElementById('st-scene-trigger-open-from-drawer');
            if (drawerBtn) drawerBtn.click();
            setTimeout(() => {
                document.querySelector('[data-kite-tab="rbq-gallery-sync"]')?.click();
            }, 150);
        });
    }

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
    }

    window.addEventListener('st-scene-trigger:viewer-rendered', (event) => {
        updateViewerBadge(event?.detail);
    });

    // ── 8. Setting Panel Registration ──
    function renderSettings() {
        const store = getStore();
        return `
            <div id="rbq-gallery-sync-settings" style="display:flex; flex-direction:column; gap:16px; padding:6px 0;">
                <div class="st-scene-trigger-subpanel-title" style="margin-bottom:0;">
                    <i class="fa-solid fa-cloud-arrow-up"></i>
                    <span>服务端图库同步与存储管理 <small style="font-size:12px;opacity:0.75;font-weight:normal;">v${PLUGIN_VERSION}</small></span>
                </div>

                <div class="st-scene-trigger-section" style="background:var(--linear-bg-subtle); padding:14px; border-radius:12px; border:1px solid rgba(255,255,255,0.08);">
                    <div style="font-size:13px; font-weight:600; margin-bottom:6px; color:var(--linear-text-primary);">
                        <i class="fa-solid fa-sliders"></i> 同步策略选择
                    </div>
                    <div style="font-size:12px; color:var(--linear-text-secondary); line-height:1.45; margin-bottom:12px;">
                        控制生成的图片是否持久化至酒馆服务端磁盘，以及多端（手机/平板/电脑）同步时如何最节省流量与带宽。
                    </div>

                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;">
                            <input type="radio" name="rbq-sync-mode" value="stream_only" ${store.syncMode === 'stream_only' ? 'checked' : ''} style="margin-top:3px;">
                            <div>
                                <strong style="font-size:13px; color:#38bdf8;">⚡ 极速省流云同步 (强烈推荐)</strong>
                                <div style="font-size:11px; opacity:0.8; margin-top:2px; line-height:1.35;">
                                    客户端自动在出图后压制约 <strong>50~80KB 的超小 WebP 预览图</strong>上传至酒馆服务端。多端打开秒开秒显，100 张历史图总流量仅 ~6MB，手机流量 0 压力。
                                </div>
                            </div>
                        </label>

                        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;">
                            <input type="radio" name="rbq-sync-mode" value="local" ${store.syncMode === 'local' ? 'checked' : ''} style="margin-top:3px;">
                            <div>
                                <strong style="font-size:13px; color:#4ade80;">💻 纯本地模式 (不上云)</strong>
                                <div style="font-size:11px; opacity:0.8; margin-top:2px; line-height:1.35;">
                                    图片仅保留在当前设备的浏览器 IndexedDB 中，完全不占用服务端任何磁盘与上行带宽。换设备时无法跨端同步已生出的历史图片。
                                </div>
                            </div>
                        </label>

                        <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;">
                            <input type="radio" name="rbq-sync-mode" value="full" ${store.syncMode === 'full' ? 'checked' : ''} style="margin-top:3px;">
                            <div>
                                <strong style="font-size:13px; color:#c084fc;">💎 全量原画云存档 (适合千兆局域网)</strong>
                                <div style="font-size:11px; opacity:0.8; margin-top:2px; line-height:1.35;">
                                    预览图与数兆原始 PNG 原画双轨上传至酒馆服务器，原汁原味永久留存。适合家庭千兆局域网或服务器带宽充足环境。
                                </div>
                            </div>
                        </label>
                    </div>
                </div>

                <div class="st-scene-trigger-section" style="background:var(--linear-bg-subtle); padding:14px; border-radius:12px; border:1px solid rgba(255,255,255,0.08);">
                    <div style="font-size:13px; font-weight:600; margin-bottom:10px; color:var(--linear-text-primary);">
                        <i class="fa-solid fa-shield-halved"></i> 存储策略与智能上传
                    </div>

                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
                            <span style="font-size:12px;">⭐ 收藏时自动上传高清原画至服务端 (推荐)</span>
                            <input id="rbq-sync-fav-original" type="checkbox" ${store.syncFavoritesOriginal ? 'checked' : ''}>
                        </label>
                        <div style="font-size:11px; color:var(--linear-text-muted); margin-top:-6px;">
                            当在画廊或大图查看器中点击「⭐ 收藏」时，自动提取最高画质原图上传至酒馆服务端永久留存，兼顾日常省流与原图备份。
                        </div>

                        <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer; margin-top:6px;">
                            <span style="font-size:12px;">📱 移动蜂窝网络流量保护 (Save-Data 感知)</span>
                            <input id="rbq-sync-savedata" type="checkbox" ${store.saveDataAware ? 'checked' : ''}>
                        </label>
                        <div style="font-size:11px; color:var(--linear-text-muted); margin-top:-6px;">
                            检测到 4G/5G 移动数据时，自动阻断原图全量同步与拉取，防止流量意外消耗。
                        </div>

                        <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer; margin-top:6px;">
                            <span style="font-size:12px;">🏷️ 大图查看器显示「存储归属指示点」</span>
                            <input id="rbq-sync-badge-enable" type="checkbox" ${store.enableViewerBadge ? 'checked' : ''}>
                        </label>
                        <div style="font-size:11px; color:var(--linear-text-muted); margin-top:-6px;">
                            在大图查看器顶栏显示存储状态呼吸圆点（🟢本地 / 🔵云端原图 / 🟡省流预览 / 🟣绘图后端），点击展开详情卡片。
                        </div>
                    </div>
                </div>

                <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:8px;">
                    <button id="rbq-sync-save-btn" class="menu_button st-scene-trigger-icon-button st-scene-trigger-btn-primary" type="button" style="padding:6px 16px;">
                        <i class="fa-solid fa-check"></i> 保存同步配置
                    </button>
                </div>
            </div>
        `;
    }

    function initSettingsListeners() {
        const root = document.getElementById('rbq-gallery-sync-settings');
        if (!root) return;

        const saveBtn = root.querySelector('#rbq-sync-save-btn');
        if (!saveBtn) return;

        saveBtn.onclick = () => {
            const store = getStore();
            const selectedMode = root.querySelector('input[name="rbq-sync-mode"]:checked')?.value || 'stream_only';
            store.syncMode = selectedMode;
            store.syncFavoritesOriginal = !!root.querySelector('#rbq-sync-fav-original')?.checked;
            store.saveDataAware = !!root.querySelector('#rbq-sync-savedata')?.checked;
            store.enableViewerBadge = !!root.querySelector('#rbq-sync-badge-enable')?.checked;

            save();
            toastr.success('图库同步配置已保存', PLUGIN_NAME);
        };
    }

    // 注册到 RBQ 主控制台侧边栏
    if (RBQ?.ui?.addSettingPanel) {
        RBQ.ui.addSettingPanel('rbq-gallery-sync', '<i class="fa-solid fa-cloud-arrow-up"></i><span>图库云同步</span>', () => {
            setTimeout(initSettingsListeners, 50);
            return renderSettings();
        });
    }

    // 清理钩子
    if (typeof RBQ?.registerPluginCleanup === 'function') {
        RBQ.registerPluginCleanup(PLUGIN_ID, () => {
            document.getElementById('rbq-gallery-sync-style')?.remove();
            document.getElementById('rbq-storage-badge-wrap')?.remove();
            RBQ.ui.removeSettingPanel('rbq-gallery-sync');
        });
    }

    // 暴露 API
    RBQ.api.gallerySync = {
        inspectImageStorage,
        createOptimizedWebpBlob,
        uploadBlobToServer,
        syncFavoriteOriginal,
        getStore,
    };

    console.info(`☁️ [${PLUGIN_NAME} v${PLUGIN_VERSION}] loaded successfully. syncMode="${getStore().syncMode}"`);

})(window.RBQ, window.jQuery, window.toastr);
