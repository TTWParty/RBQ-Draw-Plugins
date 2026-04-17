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
    // Worldbook 5x5 grid: A-E (col, left->right), 1-5 (row, top->bottom)
    const COL_MAP = { A: 0.1, B: 0.3, C: 0.5, D: 0.7, E: 0.9 };
    const ROW_MAP = { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 };

    function parseCoord(coordStr) {
        const s = (coordStr || '').trim().toUpperCase();
        const col = s.charAt(0);
        const row = s.charAt(1);
        if (COL_MAP[col] != null && ROW_MAP[row] != null) {
            return { x: COL_MAP[col], y: ROW_MAP[row] };
        }
        return { x: 0.5, y: 0.5 };
    }

    // ── Format Parser ────────────────────────────────────────
    // Directly detects Scene:/Char1:/Char1 UC: segments in the prompt.
    // Works with or without the image###...### wrapper.
    function parseMultiCharPrompt(rawPrompt) {
        let body = rawPrompt;

        // If wrapped in image###...###, unwrap it
        const wrapMatch = rawPrompt.match(/image###([\s\S]*?)###/);
        if (wrapMatch) {
            body = wrapMatch[1].trim();
        }

        // Quick check: must have at least "Scene:" and "Char" with "|centers:"
        if (!/Scene:/i.test(body) || !/Char\d+:/i.test(body)) {
            return null;
        }

        // Split by semicolons
        const segments = body.split(';').map(s => s.trim()).filter(Boolean);

        let scene = '';
        const chars = {};
        const charUCs = {};

        for (const seg of segments) {
            // Scene:
            if (/^Scene:/i.test(seg)) {
                scene = seg.replace(/^Scene:/i, '').trim();
                continue;
            }

            // Char{N} UC: (must check before Char{N}: since "Char1 UC" contains "Char1")
            const ucMatch = seg.match(/^Char(\d+)\s+UC:([\s\S]*)/i);
            if (ucMatch) {
                charUCs[ucMatch[1]] = ucMatch[2].trim();
                continue;
            }

            // Char{N}: with optional |centers:XY
            const charMatch = seg.match(/^Char(\d+):([\s\S]*)/i);
            if (charMatch) {
                const idx = charMatch[1];
                let content = charMatch[2].trim();
                let coord = { x: 0.5, y: 0.5 };

                // Extract |centers:XY
                const centersMatch = content.match(/\|centers:([A-Ea-e][1-5])\s*$/);
                if (centersMatch) {
                    coord = parseCoord(centersMatch[1]);
                    content = content.slice(0, centersMatch.index).trim();
                }

                chars[idx] = { caption: content, centers: [coord] };
                continue;
            }
        }

        const charIndices = Object.keys(chars).sort((a, b) => Number(a) - Number(b));
        if (charIndices.length === 0) return null;

        return { scene, chars, charUCs, charIndices, fullMatch: wrapMatch ? wrapMatch[0] : null };
    }

    // ── Payload Hook ─────────────────────────────────────────
    RBQ.on('buildNaiV4Payload', (payload) => {
        const store = getStore();
        if (!store.enabled) return payload;

        const rawPrompt = payload.input || '';
        const parsed = parseMultiCharPrompt(rawPrompt);
        if (!parsed) return payload;

        const { scene, chars, charUCs, charIndices, fullMatch } = parsed;

        // Build v4_prompt char_captions
        const charCaptions = charIndices.map(idx => ({
            char_caption: chars[idx].caption,
            centers: chars[idx].centers
        }));

        // Build v4_negative_prompt char_captions
        const negCharCaptions = charIndices.map(idx => ({
            char_caption: charUCs[idx] || '',
            centers: chars[idx].centers
        }));

        // Existing base negative prompt
        const existingNegBase = payload.parameters?.v4_negative_prompt?.caption?.base_caption
            || payload.parameters?.negative_prompt
            || '';

        // If there's text outside the image###...### block, prepend it to scene
        let finalScene = scene;
        if (fullMatch) {
            const outsideText = rawPrompt.replace(fullMatch, '').trim();
            if (outsideText) finalScene = outsideText + ', ' + scene;
        }

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

        console.info('[' + PLUGIN_NAME + '] Multi-char payload built: ' + charIndices.length + ' characters');
        console.debug('[' + PLUGIN_NAME + '] Scene:', finalScene);
        console.debug('[' + PLUGIN_NAME + '] Chars:', charCaptions);
        console.debug('[' + PLUGIN_NAME + '] Neg Chars:', negCharCaptions);

        toastr.info('多角色模式：' + charIndices.length + ' 个角色已映射', PLUGIN_NAME);

        return payload;
    });

    // ── UI: Toggle Switch ────────────────────────────────────
    function injectToggle() {
        if (document.getElementById('rbq-multi-char-enabled')) return;

        // Target: the checkbox grid next to Variety+ checkbox
        const checkboxGrid = document.querySelector('.st-scene-trigger-nai-checkbox-grid');
        if (!checkboxGrid) return;

        const store = getStore();

        const label = document.createElement('label');
        label.className = 'st-scene-trigger-nai-ck';
        label.innerHTML = '<input id="rbq-multi-char-enabled" type="checkbox"' + (store.enabled ? ' checked' : '') + '> 多角色';

        const checkbox = label.querySelector('#rbq-multi-char-enabled');
        checkbox.addEventListener('change', () => {
            const s = getStore();
            s.enabled = checkbox.checked;
            save();
            toastr.info(s.enabled ? '多角色模式已开启' : '多角色模式已关闭', PLUGIN_NAME);
        });

        checkboxGrid.appendChild(label);
    }

    // Poll for modal to appear (it's rendered lazily)
    setInterval(() => {
        if (document.getElementById('rbq-multi-char-enabled')) return;
        const grid = document.querySelector('.st-scene-trigger-nai-checkbox-grid');
        if (grid && grid.offsetParent !== null) {
            injectToggle();
        }
    }, 800);

    console.info('[' + PLUGIN_NAME + '] Plugin loaded.');

})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
