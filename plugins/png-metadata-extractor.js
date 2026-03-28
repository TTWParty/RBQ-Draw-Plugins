(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('[PNG Metadata Extractor] RBQ Core API missing');

    const PLUGIN_NAME = 'PNG Metadata Extractor';

    /**
     * Parse NAI Data to pure UI display keys
     */
    function formatNaiData(data) {
        return {
            prompt: data.prompt || '',
            negative: data.uc || '',
            seed: data.seed ? String(data.seed) : '',
            steps: data.steps ? String(data.steps) : '',
            sampler: data.sampler || '',
            cfg: data.scale ? String(data.scale) : '',
            size: (data.width && data.height) ? `${data.width}x${data.height}` : '',
            raw: data
        };
    }

    /**
     * Beautiful Mobile-Friendly Modal for displaying extracted NAI info.
     * Utilizes a dark frosted glass aesthetic with distinct field chunks.
     */
    function showMetadataModal(dataObj) {
        const meta = formatNaiData(dataObj);
        
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 200000; 
            background: rgba(0,0,0,0.75); display: flex; 
            align-items: center; justify-content: center; backdrop-filter: blur(4px);
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #1e1e2e; border: 1px solid rgba(255,255,255,0.1); 
            border-radius: 12px; width: 94vw; max-width: 500px;
            max-height: 85vh; color: #eee;
            box-shadow: 0 16px 40px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; overflow: hidden;
            animation: rbq-fade-in 0.2s ease-out;
        `;

        const createField = (title, content) => {
            if (!content) return null;
            const box = document.createElement('div');
            box.style.cssText = 'margin-bottom: 12px; background: rgba(0,0,0,0.25); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);';
            
            const header = document.createElement('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;';
            
            const titleSpan = document.createElement('span');
            titleSpan.style.cssText = 'font-size:13px; font-weight:600; color:rgba(255,255,255,0.5);';
            titleSpan.textContent = title;
            
            const btn = document.createElement('button');
            btn.className = 'menu_button';
            btn.style.cssText = 'font-size:12px; padding:6px 12px; margin:0; display:flex; gap:6px; align-items:center; border-radius:6px; border:none; cursor:pointer; font-weight:bold; background:rgba(255,255,255,0.1); color:#fff; transition: background 0.2s;';
            btn.innerHTML = '<i class="fa-regular fa-copy"></i> 复制';
            
            btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.2)';
            btn.onmouseleave = () => btn.style.background = 'rgba(255,255,255,0.1)';
            
            btn.onclick = () => {
                navigator.clipboard.writeText(content).then(() => {
                    const old = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> 成功';
                    btn.style.color = '#88ff88';
                    setTimeout(() => { btn.innerHTML = old; btn.style.color = '#fff'; }, 2000);
                });
            };
            
            header.append(titleSpan, btn);
            
            const bodyContent = document.createElement('div');
            bodyContent.style.cssText = 'font-size:14px; word-break:break-all; white-space:pre-wrap; max-height: 150px; overflow-y:auto; padding-right:4px; line-height:1.5; font-family:var(--font-family, sans-serif); user-select:text;';
            bodyContent.textContent = content;
            
            box.append(header, bodyContent);
            return box;
        };

        const headerHTML = document.createElement('div');
        headerHTML.style.cssText = 'padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center; position:relative; background:rgba(30,30,46,0.95); z-index:2; flex-shrink:0;';
        headerHTML.innerHTML = `
            <div style="font-weight:bold; font-size:16px; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-photo-film" style="color:#ff99cc;"></i> NAI 数据提取结果
            </div>
            <button class="menu_button st-scene-trigger-icon-button modal-close" style="padding:6px; font-size:18px; margin:0; line-height:1; width:34px; height:34px; display:flex; justify-content:center; align-items:center; border-radius:50%; background:transparent; border:none; cursor:pointer; color:#eee;"><i class="fa-solid fa-xmark"></i></button>
        `;
        
        headerHTML.querySelector('.modal-close').onclick = () => overlay.remove();
        dialog.appendChild(headerHTML);

        const bodyDiv = document.createElement('div');
        bodyDiv.style.cssText = 'padding: 16px; flex:1; overflow-y:auto;';
        
        const subtitle = document.createElement('div');
        subtitle.style.cssText = 'font-size:12px; color:#ff99cc; margin-bottom:16px; text-align:center; opacity:0.8;';
        subtitle.innerHTML = '提示：如需复用，请手动点击一键复制然后粘贴至输入框。';
        bodyDiv.appendChild(subtitle);

        const fields = [
            createField('正向提示词 (Prompt)', meta.prompt),
            createField('反向提示词 (Undesired Content)', meta.negative)
        ];
        fields.forEach(f => f && bodyDiv.appendChild(f));

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom: 12px;';
        const smallFields = [
            createField('种子 (Seed)', meta.seed),
            createField('尺寸 (Size)', meta.size),
            createField('步数 (Steps)', meta.steps),
            createField('CFG (Scale)', meta.cfg),
            createField('采样器 (Sampler)', meta.sampler)
        ];
        smallFields.forEach(f => f && grid.appendChild(f));
        if (grid.children.length > 0) bodyDiv.appendChild(grid);

        dialog.appendChild(bodyDiv);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        
        // Add minimal animation css if not exists
        if (!document.getElementById('rbq-nai-modal-style')) {
            const style = document.createElement('style');
            style.id = 'rbq-nai-modal-style';
            style.textContent = `@keyframes rbq-fade-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`;
            document.head.appendChild(style);
        }
    }

    /**
     * Pure JavaScript PNG Chunk Decoder via Fetch & ArrayBuffer
     * Eliminates needs for big third-party libs like exifr
     */
    async function handleExtract(imgUrl) {
        if (!imgUrl) return toastr.warning('无法获取图片地址');
        try {
            toastr.info('正在解析图片元数据...', 'NAI 提取器');
            const res = await fetch(imgUrl);
            const blob = await res.blob();
            
            const arrayBuffer = await blob.arrayBuffer();
            const dataView = new DataView(arrayBuffer);
            
            // Check PNG Magic Bytes
            if (dataView.getUint32(0) !== 0x89504E47 || dataView.getUint32(4) !== 0x0D0A1A0A) {
                throw new Error('该图片不是无损 PNG 格式。可能已被平台压缩转换为 WebP 或 JPEG，元数据已丢失。');
            }
            
            let offset = 8;
            let foundJson = null;
            
            while (offset < dataView.byteLength) {
                const length = dataView.getUint32(offset);
                const type = String.fromCharCode(
                    dataView.getUint8(offset + 4),
                    dataView.getUint8(offset + 5),
                    dataView.getUint8(offset + 6),
                    dataView.getUint8(offset + 7)
                );
                
                if (type === 'tEXt' || type === 'iTXt') {
                    const chunkData = new Uint8Array(arrayBuffer, offset + 8, length);
                    const text = new TextDecoder().decode(chunkData);
                    
                    if (text.startsWith('Description\0') || text.startsWith('Comment\0')) {
                        const jsonStart = text.indexOf('{');
                        const jsonEnd = text.lastIndexOf('}');
                        if (jsonStart !== -1 && jsonEnd !== -1) {
                            try {
                                const jsonStr = text.slice(jsonStart, jsonEnd + 1);
                                foundJson = JSON.parse(jsonStr);
                                break;
                            } catch (e) {
                                console.warn('[PNG Metadata Extractor] JSON Parse failed in chunk:', e);
                            }
                        }
                    }
                }
                offset += length + 12; // block length + 4(type) + 4(crc)
            }
            
            if (foundJson) {
                toastr.success('成功提取并解析 NAI 元数据！');
                showMetadataModal(foundJson);
            } else {
                toastr.warning('未检测到有价值的 NAI 元数据。(该图可能已丢失附加信息或并非由 NAI 官方格式直接产出)', '解析失败');
            }
            
        } catch (err) {
            console.error('[PNG Metadata Extractor]', err);
            toastr.error('执行失败: ' + err.message);
        }
    }

    /**
     * UI Injection: Standard Chat Stream Image Viewer Hook
     */
    function injectChatButton(img) {
        if (img.dataset.rbqNaiInjected) return;
        img.dataset.rbqNaiInjected = 'true';
        
        const btn = document.createElement('div');
        btn.className = 'rbq-nai-extract-btn';
        btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> NAI 解析图片';
        
        // Touch friendly styling
        btn.style.cssText = `
            display: inline-flex; align-items: center; justify-content: center; gap: 6px;
            background: rgba(255, 105, 180, 0.15); color: #ffb3d9;
            padding: 10px 18px; margin: 4px 6px 12px 0;
            border-radius: 8px; font-size: 14px; font-weight: bold;
            cursor: pointer; border: 1px solid rgba(255, 105, 180, 0.3);
            transition: background 0.2s, transform 0.1s;
            user-select: none; -webkit-tap-highlight-color: transparent;
        `; 
        
        btn.onmouseenter = () => btn.style.background = 'rgba(255, 105, 180, 0.25)';
        btn.onmouseleave = () => btn.style.background = 'rgba(255, 105, 180, 0.15)';
        btn.onpointerdown = () => btn.style.transform = 'scale(0.97)';
        btn.onpointerup = () => btn.style.transform = 'scale(1)';
        btn.onpointerleave = () => btn.style.transform = 'scale(1)';
        
        btn.onclick = (e) => {
            e.stopPropagation();
            handleExtract(img.src);
        };
        
        let target = img;
        if (img.parentElement && img.parentElement.tagName === 'A') {
            target = img.parentElement;
        }
        
        const container = document.createElement('div');
        container.style.display = 'block';
        target.parentNode.insertBefore(container, target.nextSibling);
        container.appendChild(btn);
    }

    function scanAndInject() {
        const chat = document.getElementById('chat');
        if (!chat) return;
        const imgs = chat.querySelectorAll('.mes_img');
        imgs.forEach(injectChatButton);
    }

    // Set up chat observer for dynamic messages
    const chatObserver = new MutationObserver((mutations) => {
        let shouldScan = false;
        for (const m of mutations) {
            if (m.addedNodes.length) {
                shouldScan = true; break;
            }
        }
        if (shouldScan) {
            clearTimeout(window._rbqNaiInjectTimer);
            window._rbqNaiInjectTimer = setTimeout(scanAndInject, 300);
        }
    });

    /**
     * UI Injection: Handle Gallery / Fullscreen Viewer Hook
     */
    function handleGalleryBtn(dialog, img) {
        let btn = document.getElementById('rbq-nai-gallery-btn');
        if (!btn) {
            btn = document.createElement('div');
            btn.id = 'rbq-nai-gallery-btn';
            btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 提取 NAI 参数';
            btn.style.cssText = `
                position: fixed;
                bottom: max(5%, 30px); left: 50%; transform: translateX(-50%);
                background: rgba(0,0,0,0.85); color: #ffb3d9;
                padding: 14px 28px; border-radius: 30px;
                font-size: 16px; font-weight: bold; cursor: pointer; z-index: 200000;
                border: 1px solid rgba(255,105,180,0.5);
                display: flex; gap: 8px; align-items: center; justify-content: center;
                backdrop-filter: blur(8px);
                box-shadow: 0 8px 20px rgba(0,0,0,0.6);
                user-select: none; -webkit-tap-highlight-color: transparent;
                transition: transform 0.1s;
            `;
            
            btn.onpointerdown = () => btn.style.transform = 'translateX(-50%) scale(0.95)';
            btn.onpointerup = () => btn.style.transform = 'translateX(-50%) scale(1)';
            btn.onpointerleave = () => btn.style.transform = 'translateX(-50%) scale(1)';
            
            document.body.appendChild(btn);
        }
        
        // Always attach fresh onclick handler
        btn.onclick = (e) => {
            e.stopPropagation();
            handleExtract(img.src);
        };
    }

    function setupGalleryObserver() {
        const observer = new MutationObserver(() => {
            // Find common known viewer containers in modern ST or extensions
            const dialog = document.getElementById('zoom_dialog') 
                || document.getElementById('swipe_zoom_dialog') 
                || document.querySelector('.fancybox-container') // Fancybox 3
                || document.querySelector('.fancybox__container') // Fancybox 4
                || document.querySelector('.lg-container') // LightGallery
                || document.querySelector('.pswp'); // PhotoSwipe
                
            let img = null;
            
            // Check if dialog exists and is visible
            const isVisible = dialog && 
                window.getComputedStyle(dialog).display !== 'none' && 
                !dialog.classList.contains('lg-hide') &&
                dialog.style.opacity !== '0';
                
            if (isVisible) {
                // Find the active/current image inside the viewer
                // 1. #zoom_img (Old ST / Swipe)
                // 2. .fancybox-image / .fancybox__image (Fancybox)
                // 3. .lg-current .lg-image / .lg-current .lg-object (LightGallery)
                // 4. Any direct visible image taking up mostly the screen
                img = dialog.querySelector('#zoom_img') 
                   || dialog.querySelector('.fancybox-image') 
                   || dialog.querySelector('.fancybox__image')
                   || dialog.querySelector('.lg-current img.lg-object') 
                   || dialog.querySelector('.lg-current img.lg-image')
                   || dialog.querySelector('img.pswp__img');
                   
                if (!img) {
                    // Fallback to finding the largest image inside
                     const imgs = Array.from(dialog.querySelectorAll('img'));
                     img = imgs.find(i => i.clientWidth > window.innerWidth * 0.3);
                }
            }
            
            if (img && img.src) {
                handleGalleryBtn(dialog, img);
            } else {
                const btn = document.getElementById('rbq-nai-gallery-btn');
                if (btn) btn.remove();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    }

    // Initialization bindings
    $(document).ready(() => {
        const chat = document.getElementById('chat');
        if (chat) chatObserver.observe(chat, { childList: true, subtree: true });
        scanAndInject();
        setupGalleryObserver();
        console.info(`📋 ${PLUGIN_NAME} plugin loaded and observing DOM.`);
    });

})(RBQ, jQuery, toastr);
