import os
import json
import base64
import time
import shutil
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT = int(os.environ.get('PORT', 3000))
ADMIN_KEY = os.environ.get('MARKET_ADMIN_KEY', 'rbq_admin_secret')
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
UPLOADS_DIR = os.path.join(BASE_DIR, 'uploads')
PRESETS_FILE = os.path.join(DATA_DIR, 'presets.json')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
DATA_LOCK = threading.Lock()

INITIAL_PRESETS = []

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
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ('/', '/api/health'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_cors()
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok', 'service': 'RBQ Prompt Market Node'}).encode('utf-8'))
            return

        if path == '/api/presets':
            presets = load_presets()
            body = json.dumps(presets, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(body)
            return

        if path.startswith('/previews/'):
            filename = os.path.basename(path)
            file_path = os.path.join(UPLOADS_DIR, filename)
            if os.path.exists(file_path):
                ext = os.path.splitext(filename)[1].lower()
                mime = 'image/webp' if ext == '.webp' else ('image/png' if ext == '.png' else 'image/jpeg')
                with open(file_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Cache-Control', 'public, max-age=604800, immutable')
                self.send_cors()
                self.end_headers()
                self.wfile.write(content)
                return
            else:
                self.send_response(404)
                self.send_cors()
                self.end_headers()
                return

        self.send_response(404)
        self.send_cors()
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 15 * 1024 * 1024:
            self.send_response(413)
            self.send_cors()
            self.end_headers()
            return

        raw_body = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            data = json.loads(raw_body.decode('utf-8'))
        except Exception:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.send_cors()
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Invalid JSON'}).encode('utf-8'))
            return

        # ── 点赞 API ──
        if parsed.path == '/api/like':
            target_id = str(data.get('id', '')).strip()
            if not target_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': '缺少预设 ID'}).encode('utf-8'))
                return

            with DATA_LOCK:
                presets = load_presets()
                found = None
                for p in presets:
                    if p.get('id') == target_id:
                        p['likes'] = int(p.get('likes', 0)) + 1
                        found = p
                        break
                if found:
                    save_presets(presets)
                    resp = json.dumps({'success': True, 'id': target_id, 'likes': found['likes']}).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(resp)
                    return
                else:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': '预设不存在'}).encode('utf-8'))
                    return

        # ── 下载/安装计数 API ──
        if parsed.path == '/api/download':
            target_id = str(data.get('id', '')).strip()
            if not target_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': '缺少预设 ID'}).encode('utf-8'))
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
                    resp = json.dumps({'success': True, 'id': target_id, 'downloads': found['downloads']}).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(resp)
                    return
                else:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': '预设不存在'}).encode('utf-8'))
                    return

        # ── 删除预设 API (支持创作者身份码与管理员密钥严格鉴权) ──
        if parsed.path == '/api/delete':
            target_id = str(data.get('id', '')).strip()
            req_creator_key = str(data.get('creatorKey', '')).strip()
            req_admin_key = str(data.get('adminKey', '')).strip()

            if not target_id:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': '缺少预设 ID'}).encode('utf-8'))
                return

            is_admin = bool(req_admin_key and req_admin_key == ADMIN_KEY)

            with DATA_LOCK:
                presets = load_presets()
                if target_id == '__ALL__':
                    if not is_admin:
                        self.send_response(403)
                        self.send_header('Content-Type', 'application/json; charset=utf-8')
                        self.send_cors()
                        self.end_headers()
                        self.wfile.write(json.dumps({'error': '清空全部工坊预设需要正确的管理员密钥'}).encode('utf-8'))
                        return
                    presets = []
                    save_presets(presets)
                    resp = json.dumps({'success': True, 'remaining': 0}).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(resp)
                    return

                target_preset = next((p for p in presets if p.get('id') == target_id), None)
                if not target_preset:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': '预设不存在或已被删除'}).encode('utf-8'))
                    return

                # 权限鉴权逻辑：
                # 1. 管理员密钥正确 -> 允许
                # 2. 预设绑定了 creatorKey，且请求匹配 -> 允许
                # 3. 历史无 creatorKey 的早期测试预设：若作者声明一致或为管理员 -> 允许
                item_creator_key = target_preset.get('creatorKey', '')
                authorized = False
                if is_admin:
                    authorized = True
                elif item_creator_key and req_creator_key and req_creator_key == item_creator_key:
                    authorized = True
                elif not item_creator_key:
                    req_author = str(data.get('author', '')).strip()
                    if req_author and req_author == target_preset.get('author'):
                        authorized = True
                    elif is_admin:
                        authorized = True

                if not authorized:
                    self.send_response(403)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': '鉴权失败：无权删除他人作品。请在设置中检查创作者个人码或管理员密钥。'}).encode('utf-8'))
                    return

                presets = [p for p in presets if p.get('id') != target_id]
                save_presets(presets)

            resp = json.dumps({'success': True, 'remaining': len(presets), 'deletedId': target_id}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_cors()
            self.end_headers()
            self.wfile.write(resp)
            return

        # ── 上传发布 API ──
        if parsed.path == '/api/upload':
            title = str(data.get('title', '')).strip()[:50]
            positive = str(data.get('positive', '')).strip()
            creator_key = str(data.get('creatorKey', '')).strip()[:64]
            if not title or not positive:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': '标题与正面提示词不能为空'}).encode('utf-8'))
                return

            model = str(data.get('model', 'v5')).strip().lower()
            if model not in ('v5', 'v4.5', 'v3', 'sdxl', 'general'):
                model = 'v5'

            preset_id = 'pm-' + hex(int(time.time() * 1000))[2:] + os.urandom(2).hex()
            preview_url = str(data.get('previewUrl', '')).strip() or 'https://market.rbq.my/previews/kami-greenhouse-girl.webp'
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
                    print('Error saving image:', e)

            item = {
                'id': preset_id,
                'title': title,
                'author': str(data.get('author', '匿名社友')).strip()[:30] or '匿名社友',
                'model': model,
                'creatorKey': creator_key,
                'description': str(data.get('description', '')).strip()[:200],
                'tags': data.get('tags', []) if isinstance(data.get('tags'), list) else [],
                'positive': positive,
                'negative': str(data.get('negative', '')).strip(),
                'params': data.get('params', {}),
                'previewUrl': preview_url,
                'likes': 0,
                'downloads': 0,
                'createdAt': time.strftime('%Y-%m-%d %H:%M:%S')
            }

            with DATA_LOCK:
                presets = load_presets()
                presets.insert(0, item)
                save_presets(presets)

            resp = json.dumps({'success': True, 'item': item}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(resp)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(resp)
            return

        self.send_response(404)
        self.send_cors()
        self.end_headers()

if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', PORT), MarketHandler)
    print(f'RBQ Prompt Market Server running on port {PORT}...')
    server.serve_forever()
