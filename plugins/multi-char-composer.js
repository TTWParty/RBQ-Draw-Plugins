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
    // Strategy: from the full prompt, EXTRACT Char segments and UC segments.
    // Everything left behind stays as base_caption.
    function parseAndExtract(fullPrompt) {
        // Normalize alternate prompt formats to canonical form:
        //   "Character 1 Prompt:" → "Char1:"
        //   "Character 1 UC:"    → "Char1 UC:"
        //   "Scene Composition:"  → "Scene:"
        let normalized = fullPrompt
            .replace(/Character\s*(\d+)\s*Prompt:/gi, 'Char$1:')
            .replace(/Character\s*(\d+)\s*UC:/gi, 'Char$1 UC:')
            .replace(/Scene\s*Composition:/gi, 'Scene:');

        // Quick guard: must contain at least one Char with centers
        if (!/Char\d+:/i.test(normalized) || !/\|centers:/i.test(normalized)) {
            return null;
        }

        let remaining = normalized;
        const chars = {};
        const charUCs = {};

        // 1. Extract "Char{N} UC:...;" segments first (before Char{N}: to avoid partial match)
        //    Pattern: Char1 UC:content;  (terminated by semicolon)
        remaining = remaining.replace(/Char(\d+)\s+UC:([^;]*);?/gi, (match, idx, content) => {
            charUCs[idx] = content.trim();
            return ''; // remove from remaining
        });

        // 2. Extract "Char{N}:content|centers:XY;" segments
        //    Pattern: Char1:content|centers:C3;  (terminated by semicolon)
        remaining = remaining.replace(/Char(\d+):([^;]*\|centers:[A-Ea-e][1-5])\s*;?/gi, (match, idx, content) => {
            let caption = content.trim();
            let coord = { x: 0.5, y: 0.5 };

            const centersMatch = caption.match(/\|centers:([A-Ea-e][1-5])\s*$/i);
            if (centersMatch) {
                coord = parseCoord(centersMatch[1]);
                caption = caption.slice(0, centersMatch.index).trim();
            }

            chars[idx] = { caption: caption, centers: [coord] };
            return ''; // remove from remaining
        });

        const charIndices = Object.keys(chars).sort((a, b) => Number(a) - Number(b));
        if (charIndices.length === 0) return null;

        // 3. Clean up remaining: strip "Scene:" prefix label (keep content), clean double commas/semicolons
        remaining = remaining.replace(/Scene:/gi, '');
        remaining = remaining.replace(/image###/g, '').replace(/###/g, '');
        remaining = remaining.replace(/[;,]\s*[;,]/g, ','); // collapse double separators
        remaining = remaining.replace(/^[;,\s]+|[;,\s]+$/g, ''); // trim leading/trailing junk
        remaining = remaining.replace(/\s{2,}/g, ' ').trim();

        return { remaining, chars, charUCs, charIndices };
    }

    // ── Payload Hook ─────────────────────────────────────────
    RBQ.on('buildNaiV4Payload', (payload) => {
        const store = getStore();
        if (!store.enabled) return payload;

        const rawPrompt = payload.input || '';
        const parsed = parseAndExtract(rawPrompt);
        if (!parsed) return payload;

        const { remaining, chars, charUCs, charIndices } = parsed;

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

        // base_caption = everything that's left after extracting Char/UC segments
        // This preserves presets, quality tags, scene content, etc.
        const baseCaption = remaining;

        // Existing negative base stays intact
        const existingNegBase = payload.parameters?.v4_negative_prompt?.caption?.base_caption
            || payload.parameters?.negative_prompt
            || '';

        // Update payload
        payload.input = baseCaption;

        payload.parameters.v4_prompt = {
            caption: {
                base_caption: baseCaption,
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

        console.info('[' + PLUGIN_NAME + '] Payload rewritten: ' + charIndices.length + ' characters extracted');
        console.debug('[' + PLUGIN_NAME + '] base_caption:', baseCaption);
        console.debug('[' + PLUGIN_NAME + '] char_captions:', charCaptions);
        console.debug('[' + PLUGIN_NAME + '] neg char_captions:', negCharCaptions);

        toastr.info('多角色：' + charIndices.length + ' 个角色已映射', PLUGIN_NAME);

        return payload;
    });

    // ── UI: Toggle Switch ────────────────────────────────────
    function injectToggle() {
        if (document.getElementById('rbq-multi-char-enabled')) return;

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

    setInterval(() => {
        if (document.getElementById('rbq-multi-char-enabled')) return;
        const grid = document.querySelector('.st-scene-trigger-nai-checkbox-grid');
        if (grid && grid.offsetParent !== null) injectToggle();
    }, 800);

    console.info('[' + PLUGIN_NAME + '] Plugin loaded.');

})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
