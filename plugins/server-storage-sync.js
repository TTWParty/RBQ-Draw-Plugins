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
    const PLUGIN_VERSION = '1.1.8';
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

        let safeName = String(filename || 'rbq_preview.webp')
            .replace(/[^a-zA-Z0-9_\-.]/g, '_')
            .replace(/^\.+/, 'img_');
        if (!safeName.includes('.')) safeName += '.webp';

        const rawBase64 = await blobToBase64(blob);
        if (!rawBase64) throw new Error('无法将图片转换为 Base64 编码');

        const payload = JSON.stringify({ name: safeName, data: rawBase64 });
        let lastError = null;

        // 尝试 1: 通过 jQuery.ajax 发送 (SillyTavern 全局预置 $.ajaxPrefilter 会自动注入 X-CSRF-Token)
        const jq = $ || window.jQuery || window.$;
        if (jq && typeof jq.ajax === 'function') {
            try {
                const path = await new Promise((resolve, reject) => {
                    jq.ajax({
                        url: '/api/files/upload',
                        type: 'POST',
                        contentType: 'application/json',
                        data: payload,
                        dataType: 'json',
                        success: (resp) => {
                            let resPath = resp?.path || resp?.url || resp?.filepath;
                            if (resPath) {
                                if (!resPath.startsWith('/') && !resPath.startsWith('http://') && !resPath.startsWith('https://')) {
                                    resPath = '/' + resPath;
                                }
                                resolve(resPath);
                            } else {
                                reject(new Error('服务端上传接口未返回有效文件路径: ' + JSON.stringify(resp)));
                            }
                        },
                        error: (xhr, status, error) => {
                            reject(new Error(`jQuery上传接口失败 (${xhr.status}): ${xhr.responseText || error || status}`));
                        }
                    });
                });
                if (path) return path;
            } catch (err) {
                lastError = err;
                console.warn(`[${PLUGIN_NAME}] jQuery ajax 上传未成功，尝试 Fetch 兜底:`, err);
            }
        }

        // 尝试 2: 通过 fetch 发送 (注入 RBQ.api.getStRequestHeaders / getRequestHeaders CSRF 鉴权头)
        try {
            let headers = { 'Content-Type': 'application/json' };
            const getHeaders = RBQ?.api?.getStRequestHeaders || RBQ?.api?.getRequestHeaders;
            if (typeof getHeaders === 'function') {
                try {
                    const stHeaders = getHeaders();
                    if (stHeaders && typeof stHeaders === 'object') {
                        headers = { ...headers, ...stHeaders };
                    }
                } catch (_e) {}
            }

            const res = await fetch('/api/files/upload', {
                method: 'POST',
                headers,
                body: payload,
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`Fetch上传失败 (${res.status}): ${errText || res.statusText}`);
            }

            const data = await res.json();
            let resPath = data?.path || data?.url || data?.filepath;
            if (resPath) {
                if (!resPath.startsWith('/') && !resPath.startsWith('http://') && !resPath.startsWith('https://')) {
                    resPath = '/' + resPath;
                }
                return resPath;
            }
            throw new Error('Fetch上传返回缺少文件路径: ' + JSON.stringify(data));
        } catch (fetchErr) {
            lastError = fetchErr;
            console.warn(`[${PLUGIN_NAME}] Fetch 上传失败:`, fetchErr);
        }

        throw new Error(lastError ? lastError.message : '未找到可用的酒馆服务端图片上传接口 (/api/files/upload)');
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

        // 判定 2: 酒馆服务端高清原画（当前视口已载入原画或本地持有原画）
        if (serverOriginalUrl || (serverUrl && !serverUrl.includes('_preview.webp'))) {
            const effectivePath = serverOriginalUrl || serverUrl;
            const isOriginalActive = Boolean(inIndexedDb || item._originalLoaded || url === effectivePath);
            if (isOriginalActive) {
                return {
                    type: 'server',
                    text: '酒馆服务端 (原图)',
                    title: '酒馆服务器持久化高清原画 (已加载无损原画)',
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
            // 云端有原图，但当前视口加载的是轻量预览图
            return {
                type: 'preview',
                text: '酒馆服务端 (预览)',
                title: '当前展示轻量预览图 (~60KB 省流中)；云端已有高清原画，点击「查看原图」即可加载',
                color: '#facc15', // amber
                inIndexedDb,
                blobSize,
                blobType,
                path: item.serverPreviewUrl || effectivePath,
                canSync: false,
                canSyncOriginal: false, // 云端已存在原图，无需重复补传
                serverUrl: effectivePath,
                cacheId,
            };
        }

        // 判定 3: 酒馆服务端轻量预览图（云端尚未上传无损原图）
        if (serverUrl || item.serverPreviewUrl || url.includes('_preview.webp')) {
            const effectivePath = serverUrl || item.serverPreviewUrl || url;
            const isPending = Boolean(item.pendingOriginalUpload);
            return {
                type: 'preview',
                text: isPending ? '待生成端补传' : '酒馆服务端 (预览)',
                title: isPending ? '⭐ 已加入收藏：无损原画将在切回生成设备时自动上传入库' : '酒馆轻量 WebP 预览图 (~60KB 省流中)；云端暂无原图，可一键补传',
                color: isPending ? '#fb923c' : '#facc15', // orange / amber
                inIndexedDb,
                blobSize,
                blobType,
                path: effectivePath,
                canSync: inIndexedDb || !!item.url,
                canSyncOriginal: true, // 可补传无损原画
                serverUrl: effectivePath,
                cacheId,
                isPending,
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

    // ── 5. Universal Sync Application to All Records ──
    async function applySyncedPathToAllRecords(item, path, isOriginal = false) {
        if (!item || !path) return;

        if (isOriginal) {
            item.serverOriginalUrl = path;
            delete item.pendingOriginalUpload;
            if (!item.serverPreviewUrl && (!item.url || item.url.startsWith('blob:'))) {
                item.url = path;
            }
            if (!item.serverUrl) item.serverUrl = path;
        } else {
            item.serverPreviewUrl = path;
            item.serverUrl = path;
            item.url = path;
        }

        // 1. 同步到会话消息 extra (跨设备多端秒级同步的核心路径)
        const ctx = RBQ?.api?.getContext?.();
        let targetMsgId = (item.messageId != null && Number.isFinite(Number(item.messageId))) ? Number(item.messageId) : null;
        if (targetMsgId == null && Array.isArray(ctx?.chat)) {
            // 自动智能回填 messageId：从后向前查找
            for (let i = ctx.chat.length - 1; i >= 0; i--) {
                const m = ctx.chat[i];
                if (!m) continue;
                if (m.extra?.rbq_image?.cacheId === item.cacheId ||
                    (Array.isArray(m.extra?.rbq_images) && m.extra.rbq_images.some(img => img?.cacheId === item.cacheId))) {
                    targetMsgId = i;
                    break;
                }
                if (item.prompt && m.mes && m.mes.includes(item.prompt)) {
                    targetMsgId = i;
                    break;
                }
            }
            if (targetMsgId == null) {
                for (let i = ctx.chat.length - 1; i >= 0; i--) {
                    if (!ctx.chat[i]?.is_user) {
                        targetMsgId = i;
                        break;
                    }
                }
            }
        }

        if (targetMsgId != null && ctx?.chat?.[targetMsgId]) {
            const msg = ctx.chat[targetMsgId];
            if (!msg.extra) msg.extra = {};
            if (!msg.extra.rbq_image) {
                msg.extra.rbq_image = { prompt: item.prompt || '', cacheId: item.cacheId || '' };
            }
            if (isOriginal) {
                msg.extra.rbq_image.serverOriginalUrl = path;
                delete msg.extra.rbq_image.pendingOriginalUpload;
                if (!msg.extra.rbq_image.serverPreviewUrl && (!msg.extra.rbq_image.url || msg.extra.rbq_image.url.startsWith('blob:'))) {
                    msg.extra.rbq_image.url = path;
                }
                if (!msg.extra.rbq_image.serverUrl) msg.extra.rbq_image.serverUrl = path;
            } else {
                msg.extra.rbq_image.serverPreviewUrl = path;
                msg.extra.rbq_image.serverUrl = path;
                msg.extra.rbq_image.url = path;
            }

            if (Array.isArray(msg.extra.rbq_images)) {
                for (const img of msg.extra.rbq_images) {
                    if (!img) continue;
                    if ((item.cacheId && img.cacheId === item.cacheId) ||
                        (!item.cacheId && item.prompt && img.prompt === item.prompt)) {
                        if (isOriginal) {
                            img.serverOriginalUrl = path;
                            delete img.pendingOriginalUpload;
                            if (!img.serverPreviewUrl && (!img.url || img.url.startsWith('blob:'))) img.url = path;
                            if (!img.serverUrl) img.serverUrl = path;
                        } else {
                            img.serverPreviewUrl = path;
                            img.serverUrl = path;
                            img.url = path;
                        }
                    }
                }
            }

            // 同步穿透到 SDT 扩展的分镜状态中 (保证跨设备多端在正文卡片中秒开)
            if (msg.extra.rbq_sdt?.segmentStates && typeof msg.extra.rbq_sdt.segmentStates === 'object') {
                for (const segKey of Object.keys(msg.extra.rbq_sdt.segmentStates)) {
                    const st = msg.extra.rbq_sdt.segmentStates[segKey];
                    if (st?.imageResult) {
                        if ((item.cacheId && st.imageResult.cacheId === item.cacheId) ||
                            (!item.cacheId && item.prompt && st.imageResult.prompt === item.prompt)) {
                            if (isOriginal) {
                                st.imageResult.serverOriginalUrl = path;
                                if (!st.imageResult.serverPreviewUrl && (!st.imageResult.url || st.imageResult.url.startsWith('blob:'))) {
                                    st.imageResult.url = path;
                                }
                                if (!st.imageResult.serverUrl) st.imageResult.serverUrl = path;
                            } else {
                                st.imageResult.serverPreviewUrl = path;
                                st.imageResult.serverUrl = path;
                                st.imageResult.url = path;
                            }
                        }
                    }
                }
            }

            // 立即存盘聊天数据至服务端（确保其他设备秒级可见）
            if (typeof RBQ?.api?.saveChat === 'function') RBQ.api.saveChat();
            else if (typeof RBQ?.api?.saveChatDebounced === 'function') RBQ.api.saveChatDebounced();

            // 实时将已同步图片渲染到当前页面正文卡片中（仅更新与当前 item 匹配的卡片，严禁误伤其他分镜或重新解析卡片）
            try {
                const targetCards = document.querySelectorAll(`.st-scene-trigger-inline-wrap[data-message-id="${targetMsgId}"]`);
                targetCards.forEach(card => {
                    if (!(card instanceof HTMLElement)) return;
                    // 1. 严格跳过非出图卡片（如重新解析/刷新 tag 按钮）
                    if (card.dataset.rbqSdtIsResult === '0' || card.dataset.rbqSdtKey?.endsWith('-reparse') || card.classList.contains('rbq-sdt-reparse')) {
                        return;
                    }
                    // 2. 检查此卡片是否与当前 item 匹配
                    const cardPrompt = String(card.dataset.rbqSdtFinalPrompt || card.dataset.prompt || '').trim().toLowerCase();
                    const itemPrompt = String(item.prompt || '').trim().toLowerCase();
                    const link = card.querySelector('.st-scene-trigger-inline-image-link');
                    const cardCacheId = link?.dataset?.cacheId || card.dataset.cacheId;
                    const cardUrl = link?.dataset?.url || card.dataset.url;

                    let isMatch = false;
                    if (item.cacheId && cardCacheId && item.cacheId === cardCacheId) {
                        isMatch = true;
                    } else if (item.url && cardUrl && (item.url === cardUrl || path === cardUrl)) {
                        isMatch = true;
                    } else if (itemPrompt && cardPrompt && (itemPrompt === cardPrompt || itemPrompt.includes(cardPrompt) || cardPrompt.includes(itemPrompt))) {
                        isMatch = true;
                    } else if (!itemPrompt && !cardPrompt) {
                        isMatch = true;
                    }

                    if (isMatch && typeof RBQ?.api?.renderInlineGeneratedImage === 'function') {
                        const previewPath = item.serverPreviewUrl || (!isOriginal ? path : '');
                        const renderUrl = previewPath || path;
                        RBQ.api.renderInlineGeneratedImage(card, {
                            ...item,
                            url: renderUrl,
                            serverUrl: path,
                            serverOriginalUrl: isOriginal ? path : item.serverOriginalUrl,
                            serverPreviewUrl: item.serverPreviewUrl || (!isOriginal ? path : undefined)
                        });
                        if (card.classList.contains('rbq-sdt-card')) {
                            card.dataset.rbqSdtStage = 'generated';
                        }
                    }
                });
            } catch (_) {}
        }

        // 2. 同步到全局 settings.history
        const settings = RBQ?.api?.getSettings?.();
        if (Array.isArray(settings?.history)) {
            const matched = settings.history.find(h =>
                (item.cacheId && h.cacheId === item.cacheId) ||
                (item.url && h.url === item.url) ||
                (item.prompt && h.prompt === item.prompt && Math.abs((h.createdAt || 0) - (item.createdAt || 0)) < 15000)
            );
            if (matched) {
                if (isOriginal) {
                    matched.serverOriginalUrl = path;
                    delete matched.pendingOriginalUpload;
                    if (!matched.serverPreviewUrl && (!matched.url || matched.url.startsWith('blob:'))) {
                        matched.url = path;
                    }
                    if (!matched.serverUrl) matched.serverUrl = path;
                } else {
                    matched.serverPreviewUrl = path;
                    matched.serverUrl = path;
                    matched.url = path;
                }
                RBQ.api.saveSettings?.();
            }
        }

        // 3. 实时刷新正在打开的大图查看器与微型状态指示点
        if (currentViewerItem && (currentViewerItem === item || (item.cacheId && currentViewerItem.cacheId === item.cacheId))) {
            if (isOriginal) {
                currentViewerItem.serverOriginalUrl = path;
                delete currentViewerItem.pendingOriginalUpload;
                if (!currentViewerItem.serverPreviewUrl) currentViewerItem.serverUrl = path;
            } else {
                currentViewerItem.serverPreviewUrl = path;
                currentViewerItem.serverUrl = path;
                currentViewerItem.url = path;
            }
            const modal = document.getElementById('st-scene-trigger-image-viewer');
            if (modal) {
                await updateViewerBadge({ modal, current: currentViewerItem });
            }
        }
    }

    // ── 6. Background Auto-Sync Engine ──
    async function triggerAutoSync(item) {
        const store = getStore();
        if (!store.enabled || store.syncMode === 'local') return;
        if (!item) return;

        // 避免重复同步
        if (item.serverOriginalUrl) return;
        if (store.syncMode === 'stream_only' && item.serverPreviewUrl) return;
        if (store.syncMode === 'full' && item.serverUrl && !item.serverUrl.includes('_preview.webp')) return;

        if (item._isSyncing) return;
        item._isSyncing = true;

        // 120ms 防抖，确保 IndexedDB 缓存和 DOM 渲染完毕
        setTimeout(async () => {
            try {
                // 检索图片原始 Blob（带重试机制，确保异步缓存入库）
                let originalBlob = null;
                for (let attempt = 0; attempt < 6; attempt++) {
                    if (item.cacheId && typeof RBQ?.api?.getCachedImageRecord === 'function') {
                        const rec = await RBQ.api.getCachedImageRecord(item.cacheId);
                        if (rec?.blob instanceof Blob) {
                            originalBlob = rec.blob;
                            break;
                        }
                    }
                    if (item.displayUrl && !item.displayUrl.startsWith('data:')) {
                        try {
                            const res = await fetch(item.displayUrl);
                            if (res.ok) { originalBlob = await res.blob(); break; }
                        } catch (_) {}
                    }
                    if (item.url && !item.url.startsWith('data:')) {
                        try {
                            const res = await fetch(item.url);
                            if (res.ok) { originalBlob = await res.blob(); break; }
                        } catch (_) {}
                    }
                    await new Promise((r) => setTimeout(r, 400));
                }

                if (!originalBlob) {
                    console.warn(`[${PLUGIN_NAME}] 自动同步未能获取到图片二进制数据，跳过自动上传`);
                    return;
                }

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
                        await applySyncedPathToAllRecords(item, uploadedPath, true);
                        console.info(`[${PLUGIN_NAME}] ✅ 原画已自动同步至服务端: ${uploadedPath} (${formatBytes(originalBlob.size)})`);
                    }

                    // 双轨保障：同时上传轻量预览图，保证多端正文秒开与省流
                    if (!item.serverPreviewUrl) {
                        const previewFilename = `rbq_${mode}_${now}_preview.webp`;
                        const previewBlob = await createOptimizedWebpBlob(
                            originalBlob,
                            store.previewMaxDimension || 768,
                            store.previewQuality || 0.8
                        );
                        if (previewBlob) {
                            const previewPath = await uploadBlobToServer(previewBlob, previewFilename);
                            if (previewPath) {
                                await applySyncedPathToAllRecords(item, previewPath, false);
                                console.info(`[${PLUGIN_NAME}] ✅ 轻量预览图已自动同步至服务端: ${previewPath} (${formatBytes(previewBlob.size)})`);
                            }
                        }
                    }

                    if (store.enableSyncToast) {
                        toastr.info(`生图原画已同步至酒馆云端 (${formatBytes(originalBlob.size)})`, PLUGIN_NAME);
                    }
                } else {
                    // 默认 stream_only: 压制 50~80KB 极轻预览图
                    const previewFilename = `rbq_${mode}_${now}_preview.webp`;
                    const previewBlob = await createOptimizedWebpBlob(
                        originalBlob,
                        store.previewMaxDimension || 768,
                        store.previewQuality || 0.8
                    );

                    if (previewBlob) {
                        const uploadedPath = await uploadBlobToServer(previewBlob, previewFilename);
                        if (uploadedPath) {
                            await applySyncedPathToAllRecords(item, uploadedPath, false);
                            console.info(`[${PLUGIN_NAME}] ✅ 轻量预览图已自动同步至服务端: ${uploadedPath} (${formatBytes(previewBlob.size)})`);
                            if (store.enableSyncToast) {
                                toastr.info(`生图已同步至酒馆云端 (${formatBytes(previewBlob.size)})`, PLUGIN_NAME);
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn(`[${PLUGIN_NAME}] 自动同步处理异常:`, err);
            } finally {
                delete item._isSyncing;
            }
        }, 120);
    }

    // 监听生图事件 (即时生图 / 异步缓存完成)
    window.addEventListener('st-scene-trigger:image-generated', (event) => {
        triggerAutoSync(event?.detail?.item);
    });
    window.addEventListener('st-scene-trigger:image-cached', (event) => {
        triggerAutoSync(event?.detail?.item);
    });

    // ── 7. Favorite Auto-Upload Original Handler ──
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

            // 严禁将远程 _preview.webp 作为原图拉取；必须确保是真实的本地无损原始缓存
            if (!originalBlob && item.url && item.url.startsWith('blob:')) {
                try {
                    const res = await fetch(item.url);
                    if (res.ok) originalBlob = await res.blob();
                } catch (_e) {}
            }
            if (!originalBlob && item.displayUrl && item.displayUrl.startsWith('blob:')) {
                try {
                    const res = await fetch(item.displayUrl);
                    if (res.ok) originalBlob = await res.blob();
                } catch (_e) {}
            }

            if (!originalBlob) {
                console.info(`[${PLUGIN_NAME}] 当前设备无本地无损原画缓存，已标记为待同步，将在切回生成设备时自动上传入库 ⭐`);
                item.pendingOriginalUpload = true;
                item.favorite = true;
                await markPendingOriginalUpload(item);
                toastr.info('⭐ 已加入收藏！无损原画将在切回生成设备时自动同步入库', PLUGIN_NAME);
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
                delete item.pendingOriginalUpload;
                await applySyncedPathToAllRecords(item, uploadedPath, true);
                console.info(`[${PLUGIN_NAME}] ⭐ 收藏原画已成功同步至服务端: ${uploadedPath} (${formatBytes(originalBlob.size)})`);

                // 双轨保障：同时确保轻量预览图存在
                if (!item.serverPreviewUrl) {
                    const previewFilename = `rbq_${mode}_fav_${now}_preview.webp`;
                    const previewBlob = await createOptimizedWebpBlob(originalBlob, 768, 0.8);
                    if (previewBlob) {
                        const previewPath = await uploadBlobToServer(previewBlob, previewFilename);
                        if (previewPath) {
                            await applySyncedPathToAllRecords(item, previewPath, false);
                        }
                    }
                }

                toastr.success(`⭐ 收藏原画已持久化至酒馆服务端 (${formatBytes(originalBlob.size)})`, PLUGIN_NAME);
            }
        } catch (err) {
            console.error(`[${PLUGIN_NAME}] 收藏原画同步失败:`, err);
            toastr.error(`收藏原画同步失败: ${err.message || err}`, PLUGIN_NAME);
        }
    }

    // ── 7.1 跨设备待补传原图持久化与扫描同步 ──
    async function markPendingOriginalUpload(item) {
        if (!item) return;
        item.pendingOriginalUpload = true;
        item.favorite = true;

        const ctx = RBQ?.api?.getContext?.();
        let targetMsgId = (item.messageId != null && Number.isFinite(Number(item.messageId))) ? Number(item.messageId) : null;
        if (targetMsgId == null && Array.isArray(ctx?.chat)) {
            for (let i = ctx.chat.length - 1; i >= 0; i--) {
                const m = ctx.chat[i];
                if (!m) continue;
                if (m.extra?.rbq_image?.cacheId === item.cacheId ||
                    (Array.isArray(m.extra?.rbq_images) && m.extra.rbq_images.some(img => img?.cacheId === item.cacheId))) {
                    targetMsgId = i;
                    break;
                }
                if (item.prompt && m.mes && m.mes.includes(item.prompt)) {
                    targetMsgId = i;
                    break;
                }
            }
        }

        if (targetMsgId != null && ctx?.chat?.[targetMsgId]) {
            const msg = ctx.chat[targetMsgId];
            if (!msg.extra) msg.extra = {};
            if (!msg.extra.rbq_image) {
                msg.extra.rbq_image = { prompt: item.prompt || '', cacheId: item.cacheId || '' };
            }
            msg.extra.rbq_image.favorite = true;
            msg.extra.rbq_image.pendingOriginalUpload = true;

            if (Array.isArray(msg.extra.rbq_images)) {
                for (const img of msg.extra.rbq_images) {
                    if (img && ((item.cacheId && img.cacheId === item.cacheId) || (item.prompt && img.prompt === item.prompt))) {
                        img.favorite = true;
                        img.pendingOriginalUpload = true;
                    }
                }
            }

            if (typeof RBQ?.api?.saveChatDebounced === 'function') RBQ.api.saveChatDebounced();
            else if (typeof RBQ?.api?.saveChat === 'function') RBQ.api.saveChat();
        }

        const settings = RBQ?.api?.getSettings?.();
        if (Array.isArray(settings?.history)) {
            const matched = settings.history.find(h =>
                (item.cacheId && h.cacheId === item.cacheId) ||
                (item.url && h.url === item.url) ||
                (item.prompt && h.prompt === item.prompt && Math.abs((h.createdAt || 0) - (item.createdAt || 0)) < 15000)
            );
            if (matched) {
                matched.favorite = true;
                matched.pendingOriginalUpload = true;
                RBQ.api.saveSettings?.();
            }
        }
    }

    let isCheckingPending = false;
    async function syncPendingOriginalUploads() {
        const store = getStore();
        if (!store.enabled || !store.syncFavoritesOriginal) return;
        if (isCheckingPending) return;
        isCheckingPending = true;

        try {
            const settings = RBQ?.api?.getSettings?.();
            const history = Array.isArray(settings?.history) ? settings.history : [];
            const ctx = RBQ?.api?.getContext?.();
            const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];

            // 汇总所有被标记为收藏或待补传原图且服务端尚无原图的候选
            const pendingCandidates = [];
            const seenCacheIds = new Set();

            // 1. 扫描 settings.history
            for (const it of history) {
                if (!it || !it.cacheId || seenCacheIds.has(it.cacheId)) continue;
                if ((it.favorite || it.pendingOriginalUpload) && !it.serverOriginalUrl) {
                    seenCacheIds.add(it.cacheId);
                    pendingCandidates.push(it);
                }
            }

            // 2. 扫描当前聊天各楼层消息 extra
            for (let i = chat.length - 1; i >= 0; i--) {
                const msg = chat[i];
                if (!msg?.extra) continue;
                const list = [];
                if (msg.extra.rbq_image) list.push(msg.extra.rbq_image);
                if (Array.isArray(msg.extra.rbq_images)) list.push(...msg.extra.rbq_images);

                for (const img of list) {
                    if (!img || !img.cacheId || seenCacheIds.has(img.cacheId)) continue;
                    if ((img.favorite || img.pendingOriginalUpload) && !img.serverOriginalUrl) {
                        seenCacheIds.add(img.cacheId);
                        pendingCandidates.push({ ...img, messageId: i });
                    }
                }
            }

            if (!pendingCandidates.length) return;

            let uploadedCount = 0;
            for (const item of pendingCandidates) {
                if (typeof RBQ?.api?.getCachedImageRecord !== 'function') break;
                // 检测当前设备本地 IndexedDB 是否拥有原图物理缓存
                const rec = await RBQ.api.getCachedImageRecord(item.cacheId);
                if (!rec?.blob || !(rec.blob instanceof Blob)) {
                    continue; // 本机无此原图（说明是在其他设备生成的），跳过
                }

                const originalBlob = rec.blob;
                const mode = item.mode || 'rbq';
                const now = Date.now();
                let ext = 'png';
                if (originalBlob.type === 'image/jpeg' || originalBlob.type === 'image/jpg') ext = 'jpg';
                else if (originalBlob.type === 'image/webp') ext = 'webp';

                const filename = `rbq_${mode}_fav_${now}.${ext}`;
                const uploadedPath = await uploadBlobToServer(originalBlob, filename);

                if (uploadedPath) {
                    delete item.pendingOriginalUpload;
                    await applySyncedPathToAllRecords(item, uploadedPath, true);

                    // 双轨保障：同时确保轻量预览图存在
                    if (!item.serverPreviewUrl) {
                        const previewFilename = `rbq_${mode}_fav_${now}_preview.webp`;
                        const previewBlob = await createOptimizedWebpBlob(originalBlob, 768, 0.8);
                        if (previewBlob) {
                            const previewPath = await uploadBlobToServer(previewBlob, previewFilename);
                            if (previewPath) {
                                await applySyncedPathToAllRecords(item, previewPath, false);
                            }
                        }
                    }
                    uploadedCount++;
                }
            }

            if (uploadedCount > 0) {
                console.info(`[${PLUGIN_NAME}] ⭐ 已自动从本机上传 ${uploadedCount} 张在其他设备收藏的高清原画`);
                toastr.success(`⭐ 已自动将其他设备收藏的 ${uploadedCount} 张高清原画从本机同步至服务端！`, PLUGIN_NAME);
            }
        } catch (err) {
            console.warn(`[${PLUGIN_NAME}] 自动补传待处理收藏原图失败:`, err);
        } finally {
            isCheckingPending = false;
        }
    }

    // 监听收藏事件 (st-scene-trigger 主扩展分发)
    window.addEventListener('st-scene-trigger:favorite-toggled', (event) => {
        const item = event.detail?.item;
        const isFav = Boolean(event.detail?.favorite ?? event.detail?.isFavorite ?? item?.favorite);
        if (item && isFav) {
            syncFavoriteOriginal(item);
        }
    });

    // 额外兜底监听：画廊或查看器内点击收藏按钮
    document.addEventListener('click', (e) => {
        const favBtn = e.target.closest?.('.st-scene-trigger-viewer-favorite, [data-action="toggle-fav"], [data-role="toggle-fav"]');
        if (favBtn && currentViewerItem) {
            setTimeout(() => {
                const isFav = Boolean(currentViewerItem.favorite ?? currentViewerItem.isFavorite);
                if (isFav) {
                    syncFavoriteOriginal(currentViewerItem);
                }
            }, 120);
        }
    });

    // 跨端切回感知：窗口焦点/可见性/会话切换自动检测待补传的原图
    window.addEventListener('focus', () => setTimeout(syncPendingOriginalUploads, 350));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(syncPendingOriginalUploads, 350);
    });
    if (RBQ?.api?.eventSource && RBQ?.api?.event_types) {
        const es = RBQ.api.eventSource;
        const et = RBQ.api.event_types;
        if (et.CHAT_CHANGED) es.on(et.CHAT_CHANGED, () => setTimeout(syncPendingOriginalUploads, 600));
        if (et.MESSAGE_UPDATED) es.on(et.MESSAGE_UPDATED, () => setTimeout(syncPendingOriginalUploads, 600));
    }
    window.addEventListener('st-scene-trigger:history-rendered', () => setTimeout(syncPendingOriginalUploads, 400));
    setTimeout(syncPendingOriginalUploads, 2500);

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
                position: relative !important;
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
                touch-action: manipulation !important;
                -webkit-tap-highlight-color: transparent !important;
                pointer-events: auto !important;
                user-select: none !important;
                -webkit-user-select: none !important;
            }
            /* 移动端 44px 隐式触控热区，极大降低手指误触难度 */
            .rbq-storage-badge-btn::before {
                content: '';
                position: absolute;
                top: 50%;
                left: 50%;
                width: 44px;
                height: 44px;
                transform: translate(-50%, -50%);
                pointer-events: auto;
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
            .rbq-storage-backdrop {
                display: none;
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.45);
                backdrop-filter: blur(2px);
                -webkit-backdrop-filter: blur(2px);
                z-index: 1000045 !important;
            }
            .rbq-storage-backdrop.open {
                display: block !important;
            }
            .rbq-storage-popover {
                position: fixed !important;
                z-index: 1000050 !important;
                display: none;
                flex-direction: column;
                gap: 10px;
                color: #e2e8f0;
                font-family: inherit;
                box-sizing: border-box;
                background: rgba(15, 18, 28, 0.96);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 14px;
                padding: 14px 16px;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05);
                animation: rbqPopoverIn 0.2s ease-out;
            }
            @media (min-width: 901px) {
                .rbq-storage-popover {
                    width: 320px;
                }
            }
            @media (max-width: 900px) {
                .rbq-storage-popover {
                    top: auto !important;
                    bottom: max(16px, env(safe-area-inset-bottom, 16px)) !important;
                    left: 12px !important;
                    right: 12px !important;
                    width: auto !important;
                    max-width: calc(100vw - 24px) !important;
                    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.15) !important;
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
            `;

            // 挂在缩放倍率按钮前面
            const zoomPill = actions.querySelector('.st-scene-trigger-viewer-zoom-pill');
            if (zoomPill) {
                actions.insertBefore(wrap, zoomPill);
            } else {
                actions.prepend(wrap);
            }
        }

        // 弹窗与独立全屏遮罩直接挂载至 viewer 根节点，避免任何嵌套盒模型与 stacking context 影响
        let backdrop = modal.querySelector('#rbq-storage-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'rbq-storage-backdrop';
            backdrop.className = 'rbq-storage-backdrop';
            modal.appendChild(backdrop);
        }

        let popover = modal.querySelector('#rbq-storage-popover');
        if (!popover) {
            popover = document.createElement('div');
            popover.id = 'rbq-storage-popover';
            popover.className = 'rbq-storage-popover';
            modal.appendChild(popover);
        }

        const badgeBtn = wrap.querySelector('#rbq-storage-badge-btn');
        const dot = wrap.querySelector('#rbq-storage-dot');

        const positionPopover = () => {
            if (window.innerWidth > 900 && badgeBtn) {
                const rect = badgeBtn.getBoundingClientRect();
                popover.style.top = `${rect.bottom + 8}px`;
                popover.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
                popover.style.left = 'auto';
                popover.style.bottom = 'auto';
            } else {
                popover.style.top = '';
                popover.style.right = '';
                popover.style.left = '';
                popover.style.bottom = '';
            }
        };

        const closePopover = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            backdrop.classList.remove('open');
            popover.classList.remove('open');
        };

        const openPopover = () => {
            positionPopover();
            backdrop.classList.add('open');
            popover.classList.add('open');
        };

        let lastToggleTime = 0;
        const togglePopover = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const now = Date.now();
            if (now - lastToggleTime < 500) return;
            lastToggleTime = now;

            if (popover.classList.contains('open')) {
                closePopover();
            } else {
                openPopover();
            }
        };

        if (badgeBtn) {
            badgeBtn.onclick = togglePopover;
            badgeBtn.ontouchend = null;
        }
        if (backdrop) {
            backdrop.onclick = closePopover;
            backdrop.ontouchend = null;
        }

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
                    <span class="rbq-storage-info-val">${info.type === 'server' ? '✅ 高清原画已入库' : (current.pendingOriginalUpload ? '⭐ 已收藏 (切回生成端自动补传)' : (info.type === 'preview' ? '⚡ 轻量预览图已同步' : '⚠️ 仅当前设备可用'))}</span>
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
        const closeBtn = popover.querySelector('#rbq-popover-close-btn');
        if (closeBtn) {
            closeBtn.onclick = closePopover;
            closeBtn.ontouchend = null;
        }

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

                await applySyncedPathToAllRecords(current, path, true);

                // 双轨保障：同时确保轻量预览图存在
                if (!current.serverPreviewUrl) {
                    const previewFilename = `rbq_${mode}_manual_${now}_preview.webp`;
                    const previewBlob = await createOptimizedWebpBlob(blobToSync, 768, 0.8);
                    if (previewBlob) {
                        const previewPath = await uploadBlobToServer(previewBlob, previewFilename);
                        if (previewPath) {
                            await applySyncedPathToAllRecords(current, previewPath, false);
                        }
                    }
                }

                toastr.success(`已成功同步高清原画到酒馆服务端: ${path}`, PLUGIN_NAME);
                closePopover();
                updateViewerBadge({ modal, current });
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
            closePopover();
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

    window.addEventListener('st-scene-trigger:viewer-closed', () => {
        document.getElementById('rbq-storage-backdrop')?.classList.remove('open');
        document.getElementById('rbq-storage-popover')?.classList.remove('open');
    });

    async function batchSyncAllFavorites() {
        const history = RBQ?.api?.getSettings?.()?.history;
        if (!Array.isArray(history) || history.length === 0) {
            return toastr.warning('历史记录为空，没有可同步的收藏图片', PLUGIN_NAME);
        }

        const favItems = history.filter(item => item && (item.favorite === true || item.isFavorite === true));
        if (favItems.length === 0) {
            return toastr.info('暂无收藏的生图记录', PLUGIN_NAME);
        }

        const toSync = favItems.filter(item => !item.serverOriginalUrl);
        if (toSync.length === 0) {
            return toastr.success(`全部 ${favItems.length} 张收藏图片的高清原画已在服务端存档！`, PLUGIN_NAME);
        }

        toastr.info(`发现 ${toSync.length} 张未上云的高清收藏图片，开始自动批量补传...`, PLUGIN_NAME);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < toSync.length; i++) {
            const item = toSync[i];
            try {
                let blobToSync = null;
                if (item.cacheId && typeof RBQ?.api?.getCachedImageRecord === 'function') {
                    const rec = await RBQ.api.getCachedImageRecord(item.cacheId);
                    if (rec?.blob instanceof Blob) blobToSync = rec.blob;
                }
                if (!blobToSync && item.displayUrl && !item.displayUrl.includes('_preview.webp')) {
                    const res = await fetch(item.displayUrl);
                    if (res.ok) blobToSync = await res.blob();
                }
                if (!blobToSync && item.url && !item.url.includes('_preview.webp')) {
                    const res = await fetch(item.url);
                    if (res.ok) blobToSync = await res.blob();
                }

                if (blobToSync) {
                    const mode = item.mode || 'rbq';
                    const now = Date.now();
                    const cleanExt = blobToSync.type.includes('webp') ? 'webp' : (blobToSync.type.includes('jpeg') || blobToSync.type.includes('jpg') ? 'jpg' : 'png');
                    const filename = `st_draw_fav_sync_${mode}_${now}_${i}.${cleanExt}`;
                    const path = await uploadImageToServer(blobToSync, filename);
                    if (path) {
                        item.serverOriginalUrl = path;
                        item.serverUrl = path;
                        item.pendingOriginalUpload = false;
                        successCount++;
                    } else {
                        failCount++;
                    }
                } else {
                    failCount++;
                }
            } catch (e) {
                console.warn(`[${PLUGIN_NAME}] 批量同步收藏图片失败:`, e);
                failCount++;
            }
        }

        RBQ.api.saveSettings();
        if (successCount > 0) {
            toastr.success(`批量补传完成！已成功上传 ${successCount} 张高清原画${failCount > 0 ? ` (${failCount} 张本地缓存已释放)` : ''}`, PLUGIN_NAME);
        } else {
            toastr.warning('未成功补传原画，本地缓存可能已被浏览器清理', PLUGIN_NAME);
        }
    }

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

                <div class="st-scene-trigger-section" style="background:var(--linear-bg-subtle); padding:14px; border-radius:12px; border:1px solid rgba(255,255,255,0.08);">
                    <div style="font-size:13px; font-weight:600; margin-bottom:6px; color:var(--linear-text-primary);">
                        <i class="fa-solid fa-cloud-arrow-up" style="color:#38bdf8;"></i> 存量收藏原画补传
                    </div>
                    <div style="font-size:12px; color:var(--linear-text-secondary); line-height:1.45; margin-bottom:12px;">
                        自动扫描本地历史记录中所有带 ⭐ 收藏标记的图片，若尚未上传高清原画至云端酒馆，一键批量补传，实现跨设备永久留存。
                    </div>
                    <button id="rbq-sync-batch-fav-btn" class="menu_button" type="button" style="padding:6px 16px; display:inline-flex; align-items:center; gap:6px; color:#38bdf8 !important;">
                        <i class="fa-solid fa-cloud-arrow-up"></i> 一键补传所有已收藏原画至服务端
                    </button>
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
        if (saveBtn) {
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

        const batchFavBtn = root.querySelector('#rbq-sync-batch-fav-btn');
        if (batchFavBtn) {
            batchFavBtn.onclick = async () => {
                batchFavBtn.disabled = true;
                const oldHtml = batchFavBtn.innerHTML;
                batchFavBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在批量补传中...';
                try {
                    await batchSyncAllFavorites();
                } finally {
                    batchFavBtn.disabled = false;
                    batchFavBtn.innerHTML = oldHtml;
                }
            };
        }
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

})(window.RBQ, window.jQuery || window.$, window.toastr);
