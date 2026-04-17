(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('[Multi-Char Composer] RBQ Core API missing');

    const PLUGIN_NAME = 'Multi-Char Composer';
    const STORAGE_KEY = '_multiCharComposer';

    // ── Storage ──────────────────────────────────────────────
    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY]) s[STORAGE_KEY] = { enabled: false };
        return s[STORAGE_KEY];
    }
    function save() { RBQ.api.saveSettings(); }

    // ── Coordinate Mapping ───────────────────────────────────
    // Worldbook 5×5 grid: A-E (col, left→right), 1-5 (row, top→bottom)
    const COL_MAP = { A: 0.1, B: 0.3, C: 0.5, D: 0.7, E: 0.9 };
    const ROW_MAP = { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 };

    function parseCoord(coordStr) {
        // coordStr e.g. "C3", "B2", "D4"
        const s = (coordStr || '').trim().toUpperCase();
        const col = s.charAt(0);
        const row = s.charAt(1);
        if (COL_MAP[col] != null && ROW_MAP[row] != null) {
            return { x: COL_MAP[col], y: ROW_MAP[row] };
        }
        return { x: 0.5, y: 0.5 }; // fallback center
    }

    // ── Format Parser ────────────────────────────────────────
    // Parses: image###Scene:...;Char1:...|centers:C3;Char2:...|centers:B2;Char1 UC:...;Char2 UC:...;###
    function parseMultiCharPrompt(rawPrompt) {
        // Extract the content between image### and ###
        const match = rawPrompt.match(/image###([\s\S]*?)###/);
        if (!match) return null;

        const body = match[1].trim();

        // Split by semicolons, but preserve content within each segment
        // We need to be careful: tags themselves can contain colons (e.g. "source#fellatio")
        // Strategy: split on ";" then identify segment type by prefix
        const segments = body.split(';').map(s => s.trim()).filter(Boolean);

        let scene = '';
        const chars = {};    // { '1': { caption: '...', centers: [{x,y}] }, '2': ... }
        const charUCs = {};  // { '1': '...', '2': '...' }

        for (const seg of segments) {
            // Match "Scene:" prefix
            if (/^Scene:/i.test(seg)) {
                scene = seg.replace(/^Scene:/i, '').trim();
                continue;
            }

            // Match "Char{N} UC:" prefix (must check before Char{N}: because "Char1 UC" contains "Char")
            const ucMatch = seg.match(/^Char(\d+)\s+UC:([\s\S]*)/i);
            if (ucMatch) {
                const idx = ucMatch[1];
                charUCs[idx] = ucMatch[2].trim();
                continue;
            }

            // Match "Char{N}:" prefix with optional |centers:XY
            const charMatch = seg.match(/^Char(\d+):([\s\S]*)/i);
            if (charMatch) {
                const idx = charMatch[1];
                let content = charMatch[2].trim();
                let coord = { x: 0.5, y: 0.5 };

                // Extract |centers:XY from the end
                const centersMatch = content.match(/\|centers:([A-Ea-e][1-5])\s*$/);
                if (centersMatch) {
                    coord = parseCoord(centersMatch[1]);
                    content = content.slice(0, centersMatch.index).trim();
                }

                chars[idx] = {
                    caption: content,
                    centers: [coord]
                };
                continue;
            }
        }

        if (!scene && Object.keys(chars).length === 0) return null;

        return { scene, chars, charUCs, fullMatch: match[0] };
    }

    // ── Payload Hook ─────────────────────────────────────────
    RBQ.on('buildNaiV4Payload', (payload) => {
        const store = getStore();
        if (!store.enabled) return payload;

        const rawPrompt = payload.input || '';
        const parsed = parseMultiCharPrompt(rawPrompt);
        if (!parsed) return payload; // Not multi-char format, pass through

        const { scene, chars, charUCs, fullMatch } = parsed;
        const charIndices = Object.keys(chars).sort((a, b) => Number(a) - Number(b));

        if (charIndices.length === 0) return payload; // No characters found

        // Build v4_prompt char_captions
        const charCaptions = charIndices.map(idx => ({
            char_caption: chars[idx].caption,
            centers: chars[idx].centers
        }));

        // Build v4_negative_prompt char_captions (reuse same centers from positive)
        const negCharCaptions = charIndices.map(idx => ({
            char_caption: charUCs[idx] || '',
            centers: chars[idx].centers
        }));

        // Get the existing base negative prompt
        const existingNegBase = payload.parameters?.v4_negative_prompt?.caption?.base_caption
            || payload.parameters?.negative_prompt
            || '';

        // Replace the raw prompt: strip the image###...### block, use Scene as base_caption
        // If there's text outside of image###...###, keep it as prefix to scene
        const outsideText = rawPrompt.replace(fullMatch, '').trim();
        const finalScene = outsideText ? (outsideText + ', ' + scene) : scene;

        // Overwrite payload
        payload.input = finalScene;

        payload.parameters.v4_prompt = {
            caption: {
                base_caption: finalScene,
                char_captions: charCaptions
            },
            use_coords: true,
            use_order: true,
            legacy_uc: false
        };

        payload.parameters.v4_negative_prompt = {
            caption: {
                base_caption: existingNegBase,
                char_captions: negCharCaptions
            },
            use_coords: false,
            use_order: false,
            legacy_uc: false
        };

        console.info(`[${PLUGIN_NAME}] Multi-char payload built: ${charIndices.length} characters, coords enabled`);
        console.debug(`[${PLUGIN_NAME}] Scene:`, finalScene);
        console.debug(`[${PLUGIN_NAME}] Char captions:`, charCaptions);
        console.debug(`[${PLUGIN_NAME}] Neg char captions:`, negCharCaptions);

        toastr.info(`多角色模式：${charIndices.length} 个角色已映射`, PLUGIN_NAME);

        return payload;
    });

    // ── UI: Toggle Switch ────────────────────────────────────
    function injectToggle() {
        // Find the NAI settings section in the RBQ modal
        const naiSection = document.querySelector('.st-scene-trigger-modal-main');
        if (!naiSection) return;

        // Avoid duplicate injection
        if (document.getElementById('rbq-multi-char-toggle-wrap')) return;

        // Find a good injection point: after the variety+ checkbox or at the end of NAI config
        const varietyRow = document.getElementById('st-scene-trigger-nai-variety-plus')?.closest('.st-scene-trigger-slider-row')
            || document.getElementById('st-scene-trigger-nai-variety-plus')?.closest('label');

        const wrapper = document.createElement('div');
        wrapper.id = 'rbq-multi-char-toggle-wrap';
        wrapper.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid rgba(255,255,255,0.06); margin-top:4px;';

        const store = getStore();

        wrapper.innerHTML = `
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none; flex:1;">
                <input type="checkbox" id="rbq-multi-char-enabled" ${store.enabled ? 'checked' : ''} 
                    style="width:16px; height:16px; accent-color:#ff69b4; cursor:pointer;">
                <span style="font-size:13px; color:rgba(255,255,255,0.85); font-weight:600;">
                    <i class="fa-solid fa-users" style="color:#ff99cc; margin-right:4px;"></i>
                    多角色模式 (Multi-Char)
                </span>
            </label>
            <span style="font-size:11px; color:rgba(255,255,255,0.35);">
                摸鱼世界书格式
            </span>
        `;

        const checkbox = wrapper.querySelector('#rbq-multi-char-enabled');
        checkbox.addEventListener('change', () => {
            const s = getStore();
            s.enabled = checkbox.checked;
            save();
            toastr.info(s.enabled ? '多角色模式已开启' : '多角色模式已关闭', PLUGIN_NAME);
        });

        if (varietyRow && varietyRow.parentNode) {
            varietyRow.parentNode.insertBefore(wrapper, varietyRow.nextSibling);
        } else {
            // Fallback: append to the NAI config area
            const naiConfig = document.getElementById('st-scene-trigger-nai-config');
            if (naiConfig) {
                naiConfig.appendChild(wrapper);
            }
        }
    }

    // Poll for modal DOM readiness (control panel may not be open at load time)
    let _toggleInjected = false;
    setInterval(() => {
        if (_toggleInjected && document.getElementById('rbq-multi-char-toggle-wrap')) return;
        const modal = document.querySelector('.st-scene-trigger-modal-main');
        if (modal && modal.offsetParent !== null) {
            injectToggle();
            _toggleInjected = !!document.getElementById('rbq-multi-char-toggle-wrap');
        }
    }, 1000);

    console.info(`[${PLUGIN_NAME}] Plugin loaded. Toggle will appear in NAI settings.`);

})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
