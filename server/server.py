import os
import re
import json
import base64
import hmac
import time
import shutil
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT = int(os.environ.get('PORT', 3000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('MARKET_DATA_DIR') or os.path.join(BASE_DIR, 'data')
UPLOADS_DIR = os.environ.get('MARKET_UPLOADS_DIR') or os.path.join(BASE_DIR, 'uploads')
PRESETS_FILE = os.path.join(DATA_DIR, 'presets.json')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
DATA_LOCK = threading.Lock()

INITIAL_PRESETS = []

# ── 安全：服务端私有字段，绝不出现在任何公开响应里 ──
PRIVATE_FIELDS = ('creatorKey', 'liked_by')
MAX_TITLE = 50
MAX_AUTHOR = 30
MAX_DESCRIPTION = 200
MAX_PROMPT = 8000
MAX_TAGS = 15
MAX_TAG_LEN = 30
MAX_KEY = 64
ALLOWED_MODELS = ('v5', 'v4.5', 'v3', 'sdxl', 'general')
PARAM_NUMBER_KEYS = ('scale', 'steps', 'cfgRescale')
PARAM_STRING_KEYS = ('sampler', 'noiseSchedule')
DEFAULT_PREVIEW_URL = 'https://market.rbq.my/previews/kami-greenhouse-girl.webp'


def get_admin_key():
    """管理员密钥只来自环境变量 MARKET_ADMIN_KEY；未设置/为空时所有管理员能力关闭。"""
    return str(os.environ.get('MARKET_ADMIN_KEY', '') or '').strip()


def keys_equal(a, b):
    """常数时间比较，两边都非空才可能相等。"""
    a = str(a or '').strip()
    b = str(b or '').strip()
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode('utf-8'), b.encode('utf-8'))


def is_admin_key(req_admin_key):
    admin_key = get_admin_key()
    return bool(admin_key) and keys_equal(req_admin_key, admin_key)


# ── 防 HTML 注入（保护仍在用 1.1.30 及更早、直接 innerHTML 渲染的旧客户端） ──
# 提示词里的 <artist> … </artist>、<style> … </style> 这类“不带属性的纯标签”是 NAI 提示词语法，照常放行；
# 下面这些才算危险片段：上传 / 编辑时直接 400 拒绝；已存量数据在公开响应里做“中和”处理。
DANGEROUS_TAGS = (
    'script', 'iframe', 'img', 'svg', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button',
    'video', 'audio', 'source', 'base', 'math', 'details', 'marquee', 'body', 'html', 'a',
    'textarea', 'select', 'option', 'frame', 'frameset', 'applet', 'template', 'noscript', 'xmp',
    'plaintext', 'isindex', 'image', 'picture', 'track', 'dialog', 'portal', 'title', 'keygen', 'head',
)
DANGEROUS_PATTERNS = (
    # 黑名单标签（开始或结束标签；<a 只匹配独立的 a，不会误伤 <artist>）
    ('危险 HTML 标签', re.compile(r'<\s*/?\s*(?:%s)(?![\w-])' % '|'.join(DANGEROUS_TAGS), re.I)),
    # 任何带属性的标签：<style media=…>、<artist onclick=…>、<x data-y=…>；纯 <style> / <artist> 不受影响
    ('带属性的 HTML 标签', re.compile(r'<\s*/?\s*[a-z][\w:-]*(?:\s+|/)[^<>]*=', re.I)),
    ('<style> 标签带属性或自闭合', re.compile(r'<\s*style(?![\w-])(?!\s*>)', re.I)),
    # 事件处理器 onxxx=
    ('事件处理器 (on…=)', re.compile(r'(?<![\w-])on[a-z]+\s*=', re.I)),
    ('javascript: / vbscript: 链接', re.compile(r'(?:java|vb)script\s*:', re.I)),
    ('data:text 链接', re.compile(r'data\s*:\s*text/', re.I)),
    ('srcdoc 属性', re.compile(r'srcdoc\s*=', re.I)),
    ('HTML 实体编码混淆 (&#…)', re.compile(r'&#x?[0-9a-f]+;?', re.I)),
)
# <style> … </style> 段落内若出现可执行 / 外链 CSS 写法也拒绝（旧客户端会把它当真正的样式表）
STYLE_BLOCK_RE = re.compile(r'<\s*style\s*>(.*?)(?:<\s*/\s*style\s*>|$)', re.I | re.S)
DANGEROUS_CSS_RE = re.compile(r'url\s*\(|@import|expression\s*\(|-moz-binding|behavior\s*:', re.I)
TEXT_FIELDS = ('title', 'author', 'description', 'positive', 'negative', 'model')


def iter_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from iter_strings(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from iter_strings(v)


def find_dangerous(text):
    """返回第一处危险片段的说明 (label, 片段)；安全则返回 None。"""
    if not isinstance(text, str) or not text:
        return None
    for label, rx in DANGEROUS_PATTERNS:
        m = rx.search(text)
        if m:
            return label, text[m.start():m.end() + 20]
    for block in STYLE_BLOCK_RE.finditer(text):
        m = DANGEROUS_CSS_RE.search(block.group(1) or '')
        if m:
            return '<style> 中的外链/脚本 CSS', m.group(0)
    return None


def find_dangerous_in_payload(data):
    """检查上传 / 编辑请求里所有会被展示的文本字段。返回 (字段名, label) 或 None。"""
    for field in TEXT_FIELDS + ('tags', 'params'):
        if field not in data:
            continue
        value = data.get(field)
        if field == 'params':
            value = clean_params(value)  # 只检查真正会保存的参数键，其余键本来就会被丢弃
        for s in iter_strings(value):
            hit = find_dangerous(s)
            if hit:
                return field, hit[0]
    return None


def dangerous_payload_error(hit):
    field, label = hit
    return (f'内容包含不安全的 HTML/脚本片段（字段 {field}：{label}），请删除后再提交。'
            '提示词里不带属性的 <artist>、<style> 等标签写法不受影响。')


def _neutralize_match(seg):
    return (seg.replace('<', '\uff1c').replace('>', '\uff1e').replace('=', '\uff1d')
               .replace(':', '\uff1a').replace('&', '\uff06').replace('(', '\uff08'))


def neutralize_text(text):
    """把已存量数据里的危险片段换成全角字符（＜ ＞ ＝ ： ＆ （），其余文本（含纯 <artist>/<style>）保持原样。"""
    if not isinstance(text, str) or not find_dangerous(text):
        return text
    out = text
    for _label, rx in DANGEROUS_PATTERNS:
        out = rx.sub(lambda m: _neutralize_match(m.group(0)), out)
    # <style> 段内含外链/脚本 CSS：连同开头的 <style> 一起中和，旧客户端就不会生成真正的样式表
    def _fix_style(b):
        body = b.group(1) or ''
        if not DANGEROUS_CSS_RE.search(body):
            return b.group(0)
        return '\uff1c' + b.group(0)[1:].replace(body, DANGEROUS_CSS_RE.sub(lambda m: _neutralize_match(m.group(0)), body), 1)
    out = STYLE_BLOCK_RE.sub(_fix_style, out)
    return out


def neutralize_value(value):
    if isinstance(value, str):
        return neutralize_text(value)
    if isinstance(value, list):
        return [neutralize_value(v) for v in value]
    if isinstance(value, dict):
        return {k: neutralize_value(v) for k, v in value.items()}
    return value


def public_preset(p):
    """对外公开的预设视图：去掉 creatorKey / liked_by，只给出是否已绑定创作者 (hasOwner)；
    文本字段里已存量的危险 HTML 片段被中和，图片地址只保留 http(s)。"""
    out = {k: v for k, v in dict(p).items() if k not in PRIVATE_FIELDS and not str(k).startswith('_')}
    for field in TEXT_FIELDS + ('tags', 'params'):
        if field in out:
            out[field] = neutralize_value(out[field])
    out['previewUrl'] = safe_http_url(out.get('previewUrl', ''), DEFAULT_PREVIEW_URL)
    out['referenceUrl'] = safe_http_url(out.get('referenceUrl', ''), '')
    out['hasOwner'] = bool(str(p.get('creatorKey', '') or '').strip())
    return out


def clean_text(value, max_len):
    return str(value if value is not None else '').strip()[:max_len]


def clean_tags(value):
    if not isinstance(value, list):
        return []
    tags = []
    for t in value:
        t = str(t if t is not None else '').strip()[:MAX_TAG_LEN]
        if t and t not in tags:
            tags.append(t)
        if len(tags) >= MAX_TAGS:
            break
    return tags


def clean_params(value):
    if not isinstance(value, dict):
        return {}
    out = {}
    for k in PARAM_NUMBER_KEYS:
        v = value.get(k)
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            out[k] = v
        elif isinstance(v, str):
            try:
                out[k] = float(v) if '.' in v else int(v)
            except ValueError:
                pass
    for k in PARAM_STRING_KEYS:
        v = value.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()[:40]
    return out


def safe_http_url(value, fallback=''):
    v = str(value or '').strip()
    if v.lower().startswith(('https://', 'http://')) and len(v) <= 2048 and not any(c in v for c in '"\'<>\\ '):
        return v
    return fallback


# ── 换码 (rotate-key) 轻量限流：每个 IP 每 10 分钟最多 10 次 ──
ROTATE_WINDOW_SEC = 600
ROTATE_MAX_PER_WINDOW = 10
MIN_NEW_KEY_LEN = 8
_ROTATE_HITS = {}
_ROTATE_LOCK = threading.Lock()


def rotate_rate_limited(client_ip, now=None):
    now = time.time() if now is None else now
    with _ROTATE_LOCK:
        hits = [t for t in _ROTATE_HITS.get(client_ip, []) if now - t < ROTATE_WINDOW_SEC]
        if len(hits) >= ROTATE_MAX_PER_WINDOW:
            _ROTATE_HITS[client_ip] = hits
            return True
        hits.append(now)
        _ROTATE_HITS[client_ip] = hits
        if len(_ROTATE_HITS) > 5000:
            for ip in [k for k, v in _ROTATE_HITS.items() if not v or now - v[-1] >= ROTATE_WINDOW_SEC]:
                _ROTATE_HITS.pop(ip, None)
        return False


def valid_new_key(key):
    """新码：8~64 位，只允许字母数字与 - _ (推荐 RBQ-U- + 16 位 hex)。"""
    if not isinstance(key, str):
        return False
    if not (MIN_NEW_KEY_LEN <= len(key) <= MAX_KEY):
        return False
    return all(c.isascii() and (c.isalnum() or c in '-_') for c in key)


def find_presets_by_creator(presets, creator_key):
    return [p for p in presets if keys_equal(p.get('creatorKey', ''), creator_key)]

def load_presets():
    if not os.path.exists(PRESETS_FILE):
        save_presets([])
        return []
    try:
        with open(PRESETS_FILE, 'r', encoding='utf-8') as f:
            presets = json.load(f)
            if not isinstance(presets, list):
                presets = []
            return presets
    except Exception:
        return []

def save_presets(data):
    with open(PRESETS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

class MarketHandler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.do_GET()

    def send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Creator-Key')

    def finish_json(self, status, payload):
        try:
            resp = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(resp)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(resp)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print(f"Error in finish_json: {e}")

    def client_ip(self):
        raw_ip = self.headers.get('CF-Connecting-IP') or self.headers.get('X-Forwarded-For', '').split(',')[0] or self.client_address[0]
        return str(raw_ip).strip()

    def read_creator_key_header(self):
        auth = str(self.headers.get('Authorization', '') or '').strip()
        if auth.lower().startswith('bearer '):
            return auth[7:].strip()[:MAX_KEY]
        return str(self.headers.get('X-Creator-Key', '') or '').strip()[:MAX_KEY]

    def respond_my_presets(self, creator_key):
        if not creator_key:
            self.finish_json(401, {'success': False, 'error': '缺少创作者个人码'})
            return
        presets = load_presets()
        mine = find_presets_by_creator(presets, creator_key)
        self.finish_json(200, {'success': True, 'ids': [p.get('id') for p in mine]})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/health':
            self.finish_json(200, {'status': 'ok', 'service': 'RBQ Prompt Market Node'})
            return

        if path in ('/', '/index.html'):
            index_path = os.path.join(BASE_DIR, 'index.html')
            if os.path.exists(index_path):
                with open(index_path, 'rb') as f:
                    content = f.read()
                try:
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Content-Length', str(len(content)))
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(content)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            else:
                self.finish_json(200, {'status': 'ok', 'service': 'RBQ Prompt Market Node'})
                return

        if path == '/favicon.ico':
            svg_fav = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="#a855f7"/><path d="M30 50 L45 65 L72 35" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'''
            try:
                self.send_response(200)
                self.send_header('Content-Type', 'image/svg+xml')
                self.send_header('Cache-Control', 'public, max-age=86400')
                self.send_cors()
                self.end_headers()
                self.wfile.write(svg_fav)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        if path == '/api/presets':
            presets = load_presets()
            self.finish_json(200, [public_preset(p) for p in presets])
            return

        # ── 我的作品：凭创作者个人码 (Authorization: Bearer <key> 或 X-Creator-Key) 查询自己名下的预设 ID ──
        if path == '/api/my-presets':
            self.respond_my_presets(self.read_creator_key_header())
            return

        if path.startswith('/previews/'):
            filename = os.path.basename(path)
            file_path = os.path.join(UPLOADS_DIR, filename)
            if os.path.exists(file_path):
                ext = os.path.splitext(filename)[1].lower()
                mime = 'image/webp' if ext == '.webp' else ('image/png' if ext == '.png' else 'image/jpeg')
                try:
                    with open(file_path, 'rb') as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', mime)
                    self.send_header('Content-Length', str(len(content)))
                    self.send_header('Cache-Control', 'public, max-age=604800, immutable')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(content)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            else:
                self.finish_json(404, {'error': 'Image not found'})
                return

        self.finish_json(404, {'error': 'Not Found'})

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 15 * 1024 * 1024:
            self.finish_json(413, {'error': 'Payload Too Large'})
            return

        if content_length > 0:
            chunks = []
            bytes_read = 0
            while bytes_read < content_length:
                chunk = self.rfile.read(min(65536, content_length - bytes_read))
                if not chunk:
                    break
                chunks.append(chunk)
                bytes_read += len(chunk)
            raw_body = b''.join(chunks)
            if len(raw_body) < content_length:
                print(f"[Warning] Premature EOF: expected {content_length} bytes, received {len(raw_body)} bytes")
                self.finish_json(400, {'error': '网络传输中断：客户端连接提前断开，数据未完整接收'})
                return
        else:
            raw_body = b'{}'

        try:
            data = json.loads(raw_body.decode('utf-8'))
        except Exception as e:
            self.finish_json(400, {'error': f'JSON 解析失败: {e}'})
            return

        if parsed.path == '/api/my-presets':
            self.respond_my_presets(str(data.get('creatorKey', '') or '').strip()[:MAX_KEY])
            return

        # ── 换码：把旧个人码名下的全部预设迁移到新个人码 ──
        if parsed.path == '/api/rotate-key':
            old_key = str(data.get('oldKey', '') or '').strip()[:MAX_KEY] or self.read_creator_key_header()
            new_key = str(data.get('newKey', '') or '').strip()
            if rotate_rate_limited(self.client_ip()):
                self.finish_json(429, {'success': False, 'error': '换码请求过于频繁，请 10 分钟后再试'})
                return
            if not old_key:
                self.finish_json(400, {'success': False, 'error': '缺少旧的创作者个人码'})
                return
            if not valid_new_key(new_key):
                self.finish_json(400, {'success': False, 'error': f'新个人码无效：需 {MIN_NEW_KEY_LEN}~{MAX_KEY} 位字母/数字/-/_（推荐 RBQ-U- + 16 位十六进制）'})
                return
            if keys_equal(old_key, new_key):
                self.finish_json(200, {'success': True, 'moved': 0, 'message': '新旧个人码相同，无需迁移'})
                return
            with DATA_LOCK:
                presets = load_presets()
                moved = 0
                likes_moved = 0
                for p in presets:
                    if keys_equal(p.get('creatorKey', ''), old_key):
                        p['creatorKey'] = new_key
                        moved += 1
                    # 插件把个人码当作点赞 clientId，一并迁移，避免换码后“已点赞”状态丢失
                    liked_by = p.get('liked_by')
                    if isinstance(liked_by, list) and any(keys_equal(v, old_key) for v in liked_by):
                        rest = [v for v in liked_by if not keys_equal(v, old_key)]
                        if new_key not in rest:
                            rest.append(new_key)
                        else:
                            p['likes'] = max(0, int(p.get('likes', 0)) - 1)
                        p['liked_by'] = rest
                        likes_moved += 1
                if moved or likes_moved:
                    save_presets(presets)
            self.finish_json(200, {'success': True, 'moved': moved})
            return

        # ── 点赞 / 取消点赞 API (Toggle 收藏防刷) ──
        if parsed.path == '/api/like':
            target_id = str(data.get('id', '')).strip()
            if not target_id:
                self.finish_json(400, {'error': '缺少预设 ID'})
                return

            client_id = str(data.get('clientId', '')).strip()
            raw_ip = self.headers.get('CF-Connecting-IP') or self.headers.get('X-Forwarded-For', '').split(',')[0] or self.client_address[0]
            client_ip = str(raw_ip).strip()
            voter_id = client_id if client_id else f"ip:{client_ip}"

            with DATA_LOCK:
                presets = load_presets()
                found = None
                for p in presets:
                    if p.get('id') == target_id:
                        found = p
                        break
                if found:
                    liked_by = found.setdefault('liked_by', [])
                    if not isinstance(liked_by, list):
                        liked_by = []
                        found['liked_by'] = liked_by

                    current_likes = int(found.get('likes', 0))
                    if voter_id in liked_by:
                        # 已经点过赞 -> 取消点赞 (Toggle Unlike / 取消收藏)
                        liked_by.remove(voter_id)
                        found['likes'] = max(0, current_likes - 1)
                        save_presets(presets)
                        self.finish_json(200, {
                            'success': True,
                            'action': 'unliked',
                            'isLiked': False,
                            'id': target_id,
                            'likes': found['likes']
                        })
                    else:
                        # 未点赞 -> 增加点赞 (Toggle Like / 收藏)
                        liked_by.append(voter_id)
                        found['likes'] = current_likes + 1
                        save_presets(presets)
                        self.finish_json(200, {
                            'success': True,
                            'action': 'liked',
                            'isLiked': True,
                            'id': target_id,
                            'likes': found['likes']
                        })
                    return
                else:
                    self.finish_json(404, {'error': '未找到对应预设'})
                    return

        # ── 下载/安装计数 API ──
        if parsed.path == '/api/download':
            target_id = str(data.get('id', '')).strip()
            if not target_id:
                self.finish_json(400, {'error': '缺少预设 ID'})
                return

            with DATA_LOCK:
                presets = load_presets()
                found = None
                for p in presets:
                    if p.get('id') == target_id:
                        p['downloads'] = int(p.get('downloads', 0)) + 1
                        found = p
                        break
                if found:
                    save_presets(presets)
                    self.finish_json(200, {'success': True, 'id': target_id, 'downloads': found['downloads']})
                    return
                else:
                    self.finish_json(404, {'error': '预设不存在'})
                    return

        # ── 历史预设无感自动认领/补绑 API ──
        if parsed.path == '/api/claim':
            target_id = str(data.get('id', '')).strip()
            req_creator_key = str(data.get('creatorKey', '')).strip()
            req_author = str(data.get('author', '')).strip()
            req_admin_key = str(data.get('adminKey', '')).strip()

            if not target_id or not req_creator_key:
                self.finish_json(400, {'error': '缺少预设 ID 或创作者个人码'})
                return

            is_admin = is_admin_key(req_admin_key)

            with DATA_LOCK:
                presets = load_presets()
                target_preset = next((p for p in presets if p.get('id') == target_id), None)
                if not target_preset:
                    self.finish_json(404, {'error': '预设不存在'})
                    return

                existing_key = str(target_preset.get('creatorKey', '') or '').strip()
                if existing_key and not is_admin:
                    if keys_equal(existing_key, req_creator_key):
                        self.finish_json(200, {'success': True, 'message': '已属于当前创作者', 'id': target_id})
                    else:
                        self.finish_json(403, {'success': False, 'error': '该预设已被其他创作者绑定', 'id': target_id})
                    return

                target_preset['creatorKey'] = req_creator_key[:MAX_KEY]
                if req_author and target_preset.get('author') in ('匿名', '匿名社友', ''):
                    target_preset['author'] = req_author[:30]

                save_presets(presets)

            self.finish_json(200, {'success': True, 'message': '成功认领并固化创作者个人码', 'id': target_id})
            return

        # ── 编辑/更新预设 API (修改标签、标题、署名、提示词等) ──
        if parsed.path == '/api/update':
            target_id = str(data.get('id', '')).strip()
            req_creator_key = str(data.get('creatorKey', '')).strip()
            req_admin_key = str(data.get('adminKey', '')).strip()

            if not target_id:
                self.finish_json(400, {'error': '缺少预设 ID'})
                return

            is_admin = is_admin_key(req_admin_key)

            with DATA_LOCK:
                presets = load_presets()
                target_preset = next((p for p in presets if p.get('id') == target_id), None)
                if not target_preset:
                    self.finish_json(404, {'error': '预设不存在'})
                    return

                # 鉴权：管理员、创作者码匹配、或历史未绑定者作者名匹配
                item_creator_key = target_preset.get('creatorKey', '')
                authorized = False
                if is_admin:
                    authorized = True
                elif item_creator_key and keys_equal(req_creator_key, item_creator_key):
                    authorized = True
                elif not item_creator_key:
                    req_author = str(data.get('author', '')).strip()
                    orig_author = str(data.get('originalAuthor', '')).strip() or req_author
                    if orig_author and orig_author == target_preset.get('author'):
                        authorized = True

                if not authorized:
                    self.finish_json(403, {'error': '鉴权失败：无权修改他人作品。请检查创作者个人码。'})
                    return

                hit = find_dangerous_in_payload(data)
                if hit:
                    self.finish_json(400, {'success': False, 'error': dangerous_payload_error(hit)})
                    return

                # 更新允许修改的字段
                if 'title' in data and clean_text(data['title'], MAX_TITLE):
                    target_preset['title'] = clean_text(data['title'], MAX_TITLE)
                if 'author' in data and clean_text(data['author'], MAX_AUTHOR):
                    target_preset['author'] = clean_text(data['author'], MAX_AUTHOR)
                if 'tags' in data and isinstance(data['tags'], list):
                    target_preset['tags'] = clean_tags(data['tags'])
                if 'description' in data:
                    target_preset['description'] = clean_text(data['description'], MAX_DESCRIPTION)
                if 'positive' in data and clean_text(data['positive'], MAX_PROMPT):
                    target_preset['positive'] = clean_text(data['positive'], MAX_PROMPT)
                if 'negative' in data:
                    target_preset['negative'] = clean_text(data['negative'], MAX_PROMPT)
                if 'model' in data and str(data['model']).strip():
                    m = str(data['model']).strip().lower()
                    if m in ALLOWED_MODELS:
                        target_preset['model'] = m
                if 'params' in data and isinstance(data['params'], dict):
                    target_preset['params'] = clean_params(data['params'])

                # 更新自制参考图 (可选伴生图)
                if 'referenceBase64' in data:
                    ref_b64 = data.get('referenceBase64')
                    if ref_b64 and isinstance(ref_b64, str) and len(ref_b64) > 100:
                        ref_ext = 'webp'
                        if ',' in ref_b64:
                            ref_header, ref_b64_data = ref_b64.split(',', 1)
                            if 'jpeg' in ref_header or 'jpg' in ref_header:
                                ref_ext = 'jpg'
                            elif 'png' in ref_header:
                                ref_ext = 'png'
                        else:
                            ref_b64_data = ref_b64
                        try:
                            ref_bytes = base64.b64decode(ref_b64_data)
                            ref_name = f'{target_id}_ref.{ref_ext}'
                            with open(os.path.join(UPLOADS_DIR, ref_name), 'wb') as f:
                                f.write(ref_bytes)
                            host = self.headers.get('Host', 'market.rbq.my')
                            proto = self.headers.get('X-Forwarded-Proto', 'https')
                            target_preset['referenceUrl'] = f'{proto}://{host}/previews/{ref_name}'
                        except Exception as e:
                            print('Error saving updated reference image:', e)
                    elif ref_b64 == '' or ref_b64 is None:
                        target_preset['referenceUrl'] = ''

                # 更新基准测试图 (封面)
                if 'previewBase64' in data:
                    prev_b64 = data.get('previewBase64')
                    if prev_b64 and isinstance(prev_b64, str) and len(prev_b64) > 100:
                        prev_ext = 'webp'
                        if ',' in prev_b64:
                            prev_header, prev_b64_data = prev_b64.split(',', 1)
                            if 'jpeg' in prev_header or 'jpg' in prev_header:
                                prev_ext = 'jpg'
                            elif 'png' in prev_header:
                                prev_ext = 'png'
                        else:
                            prev_b64_data = prev_b64
                        try:
                            prev_bytes = base64.b64decode(prev_b64_data)
                            prev_name = f'{target_id}.{prev_ext}'
                            with open(os.path.join(UPLOADS_DIR, prev_name), 'wb') as f:
                                f.write(prev_bytes)
                            host = self.headers.get('Host', 'market.rbq.my')
                            proto = self.headers.get('X-Forwarded-Proto', 'https')
                            target_preset['previewUrl'] = f'{proto}://{host}/previews/{prev_name}'
                        except Exception as e:
                            print('Error saving updated preview image:', e)

                save_presets(presets)

            self.finish_json(200, {'success': True, 'item': public_preset(target_preset)})
            return

        # ── 删除预设 API (支持创作者身份码与管理员密钥严格鉴权) ──
        if parsed.path == '/api/delete':
            target_id = str(data.get('id', '')).strip()
            req_creator_key = str(data.get('creatorKey', '')).strip()
            req_admin_key = str(data.get('adminKey', '')).strip()

            if not target_id:
                self.finish_json(400, {'error': '缺少预设 ID'})
                return

            is_admin = is_admin_key(req_admin_key)

            with DATA_LOCK:
                presets = load_presets()
                if target_id == '__ALL__':
                    if not is_admin:
                        self.finish_json(403, {'error': '清空全部工坊预设需要正确的管理员密钥（服务器未配置 MARKET_ADMIN_KEY 时此功能关闭）'})
                        return
                    presets = []
                    save_presets(presets)
                    self.finish_json(200, {'success': True, 'remaining': 0})
                    return

                target_preset = next((p for p in presets if p.get('id') == target_id), None)
                if not target_preset:
                    self.finish_json(404, {'error': '预设不存在或已被删除'})
                    return

                # 权限鉴权逻辑：
                # 1. 管理员密钥正确 -> 允许
                # 2. 预设绑定了 creatorKey，且请求匹配 -> 允许
                # 3. 历史无 creatorKey 的早期测试预设：若作者声明一致或为管理员 -> 允许
                item_creator_key = target_preset.get('creatorKey', '')
                authorized = False
                if is_admin:
                    authorized = True
                elif item_creator_key and keys_equal(req_creator_key, item_creator_key):
                    authorized = True
                elif not item_creator_key:
                    req_author = str(data.get('author', '')).strip()
                    if req_author and req_author == target_preset.get('author'):
                        authorized = True
                    elif is_admin:
                        authorized = True

                if not authorized:
                    self.finish_json(403, {'error': '鉴权失败：无权删除他人作品。请在设置中检查创作者个人码或管理员密钥。'})
                    return

                presets = [p for p in presets if p.get('id') != target_id]
                save_presets(presets)

                # 同步清理服务器磁盘上的图片文件，杜绝孤儿占盘
                try:
                    for f in os.listdir(UPLOADS_DIR):
                        if f.startswith(f"{target_id}.") or f.startswith(f"{target_id}_ref."):
                            try:
                                os.remove(os.path.join(UPLOADS_DIR, f))
                            except Exception:
                                pass
                except Exception as e:
                    print('Error cleaning image files on delete:', e)

            self.finish_json(200, {'success': True, 'remaining': len(presets), 'deletedId': target_id})
            return

        # ── 上传发布 API ──
        if parsed.path == '/api/upload':
            title = clean_text(data.get('title', ''), MAX_TITLE)
            positive = clean_text(data.get('positive', ''), MAX_PROMPT)
            creator_key = clean_text(data.get('creatorKey', ''), MAX_KEY)
            if not title or not positive:
                self.finish_json(400, {'error': '标题与正面提示词不能为空'})
                return

            hit = find_dangerous_in_payload(data)
            if hit:
                self.finish_json(400, {'success': False, 'error': dangerous_payload_error(hit)})
                return

            model = str(data.get('model', 'v5')).strip().lower()
            if model not in ALLOWED_MODELS:
                model = 'v5'

            preset_id = 'pm-' + hex(int(time.time() * 1000))[2:] + os.urandom(2).hex()

            # 1. 官方基准测试图 (封面 · 必填)
            preview_url = safe_http_url(data.get('previewUrl', ''), DEFAULT_PREVIEW_URL)
            preview_b64 = data.get('previewBase64')
            if preview_b64 and isinstance(preview_b64, str) and len(preview_b64) > 100:
                ext = 'webp'
                if ',' in preview_b64:
                    header, b64_data = preview_b64.split(',', 1)
                    if 'jpeg' in header or 'jpg' in header:
                        ext = 'jpg'
                    elif 'png' in header:
                        ext = 'png'
                else:
                    b64_data = preview_b64

                try:
                    # 磁盘安全熔断防御：剩余空间低于 80MB 时拒绝落盘，防止打崩服务器
                    _, _, free_bytes = shutil.disk_usage(BASE_DIR)
                    if free_bytes < 80 * 1024 * 1024:
                        print('[Warning] Disk space below 80MB safe threshold. Skipped preview persistence.')
                    else:
                        img_bytes = base64.b64decode(b64_data)
                        img_name = f'{preset_id}.{ext}'
                        with open(os.path.join(UPLOADS_DIR, img_name), 'wb') as f:
                            f.write(img_bytes)
                        host = self.headers.get('Host', 'market.rbq.my')
                        proto = self.headers.get('X-Forwarded-Proto', 'https')
                        preview_url = f'{proto}://{host}/previews/{img_name}'
                except Exception as e:
                    print('Error saving benchmark image:', e)

            # 2. 作者自制参考图 (可选伴生图)
            reference_url = safe_http_url(data.get('referenceUrl', ''), '')
            ref_b64 = data.get('referenceBase64')
            if ref_b64 and isinstance(ref_b64, str) and len(ref_b64) > 100:
                ref_ext = 'webp'
                if ',' in ref_b64:
                    ref_header, ref_b64_data = ref_b64.split(',', 1)
                    if 'jpeg' in ref_header or 'jpg' in ref_header:
                        ref_ext = 'jpg'
                    elif 'png' in ref_header:
                        ref_ext = 'png'
                else:
                    ref_b64_data = ref_b64

                try:
                    _, _, free_bytes = shutil.disk_usage(BASE_DIR)
                    if free_bytes >= 80 * 1024 * 1024:
                        ref_bytes = base64.b64decode(ref_b64_data)
                        ref_name = f'{preset_id}_ref.{ref_ext}'
                        with open(os.path.join(UPLOADS_DIR, ref_name), 'wb') as f:
                            f.write(ref_bytes)
                        host = self.headers.get('Host', 'market.rbq.my')
                        proto = self.headers.get('X-Forwarded-Proto', 'https')
                        reference_url = f'{proto}://{host}/previews/{ref_name}'
                except Exception as e:
                    print('Error saving reference image:', e)

            item = {
                'id': preset_id,
                'title': title,
                'author': clean_text(data.get('author', '匿名社友'), MAX_AUTHOR) or '匿名社友',
                'model': model,
                'creatorKey': creator_key,
                'description': clean_text(data.get('description', ''), MAX_DESCRIPTION),
                'tags': clean_tags(data.get('tags', [])),
                'positive': positive,
                'negative': clean_text(data.get('negative', ''), MAX_PROMPT),
                'params': clean_params(data.get('params', {})),
                'previewUrl': preview_url,
                'referenceUrl': reference_url or '',
                'likes': 0,
                'downloads': 0,
                'createdAt': time.strftime('%Y-%m-%d %H:%M:%S')
            }

            with DATA_LOCK:
                presets = load_presets()
                presets.insert(0, item)
                save_presets(presets)

            self.finish_json(200, {'success': True, 'item': public_preset(item)})
            return

        self.finish_json(404, {'error': 'Not Found'})

if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', PORT), MarketHandler)
    print(f'RBQ Prompt Market Server running on port {PORT}...')
    if not get_admin_key():
        print('[Info] MARKET_ADMIN_KEY 未设置：管理员功能（强制下架/编辑他人作品/清空工坊）已关闭。')
    server.serve_forever()
