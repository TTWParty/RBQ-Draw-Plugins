import os
import json
import base64
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT = int(os.environ.get('PORT', 3000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
UPLOADS_DIR = os.path.join(BASE_DIR, 'uploads')
PRESETS_FILE = os.path.join(DATA_DIR, 'presets.json')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

INITIAL_PRESETS = [
    {
        'id': 'builtin-east-cg',
        'title': '次世代东方写实御姐 CG',
        'author': 'RBQ官方精选',
        'description': '纯正东方冷艳五官骨相，虚幻5电影级冷暖反差布光，细腻次表面散射肉质与真实水光。',
        'tags': ['3D写实', '御姐', '电影光影', '次世代'],
        'positive': 'high complexity, amazing quality, 2::game cg, 3d game graphics, cinematic movie still, unreal engine 5, ray tracing::, 1.5::mature asian woman, cool beauty, sharp facial features, defined nose bridge, realistic lips, dark eyes, detailed 3d face::, 1.4::cinematic lighting, dramatic shadows, dark atmosphere, cool blue tone, dramatic rim light, volumetric lighting::, 1.3::subsurface scattering, wet skin, skin sheen, sweat glisten, realistic skin texture::, 1.1::fabric texture, detailed clothing, depth of field, sharp focus, photo(medium)::',
        'negative': '2::2d, anime, cartoon, stylized, flat color, cute, chibi, big anime eyes, lineart, drawing, illustration::, 1.5::plastic skin, doll, toy, figurine, garage kit, oversaturated, bright daylight, flat lighting::, lowres, bad anatomy, bad hands, worst quality, blurry',
        'previewUrl': 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600&auto=format&fit=crop&q=80',
        'params': {'scale': 6.0, 'sampler': 'k_dpmpp_2m_sde', 'steps': 25},
        'likes': 128,
        'downloads': 360,
        'createdAt': '2026-10-09'
    },
    {
        'id': 'builtin-shiny-pantyhose',
        'title': '顶级油光高光透肉丝袜专精',
        'author': 'RBQ官方精选',
        'description': '专攻高开叉长腿、透肉丝袜与强镜面反光高光条，丝滑尼龙织物感拉满。',
        'tags': ['油光丝袜', '美腿', '高光反光', '御姐'],
        'positive': '1.4::shiny pantyhose, glossy pantyhose, oiled pantyhose, sheer pantyhose::, 1.3::beige pantyhose, sheer to waist, seamless pantyhose, red high heels::, 1.2::glossy legs, specular highlights on pantyhose, smooth nylon, light reflection on legs::, 1.1::skin-tight, tight pantyhose, long legs::, 0.65::artist:neroma_shin::',
        'negative': 'opaque pantyhose, thick tights, matte pantyhose, black pantyhose, fishnet, ripped pantyhose, lowres, bad anatomy, bad hands',
        'previewUrl': 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&auto=format&fit=crop&q=80',
        'params': {'scale': 5.5, 'sampler': 'k_euler_ancestral', 'steps': 23},
        'likes': 215,
        'downloads': 512,
        'createdAt': '2026-10-09'
    },
    {
        'id': 'builtin-thick-skin',
        'title': '顶级肉感厚涂与温润肉温',
        'author': 'RBQ官方精选',
        'description': '融合 Neroma Shin 与 Kazuhiro 黄金画师组，极具肉温与压痕触感，解剖严谨。',
        'tags': ['日系厚涂', '肉感', '微汗水光', '解剖学'],
        'positive': '2::masterpiece, best quality, very aesthetic, absurdres, ultra-detailed::, 2::lifelike, realistic_rendering, intricate_details::, {anatomical accuracy}, anatomically correct, 1.35::ultra-detailed skin texture, realistic skin pores::, 1.25::subsurface scattering, skin translucency::, 1.1::dermatological detail, skin indentation detail::, 1.15::dewy skin, sweat glisten, moist skin sheen, glossy skin highlights::, 0.65::neroma_shin::, 0.65::kazuhiro (tiramisu)::',
        'negative': 'lowres, bad anatomy, bad hands, worst quality, flat color, simplified',
        'previewUrl': 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80',
        'params': {'scale': 6.0, 'sampler': 'k_euler_ancestral', 'steps': 25},
        'likes': 189,
        'downloads': 430,
        'createdAt': '2026-10-09'
    }
]

def load_presets():
    if not os.path.exists(PRESETS_FILE):
        save_presets(INITIAL_PRESETS)
        return INITIAL_PRESETS
    try:
        with open(PRESETS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return INITIAL_PRESETS

def save_presets(data):
    with open(PRESETS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

class MarketHandler(BaseHTTPRequestHandler):
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
                self.send_header('Cache-Control', 'public, max-age=86400')
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
        if parsed.path == '/api/upload':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 15 * 1024 * 1024:
                self.send_response(413)
                self.send_cors()
                self.end_headers()
                return

            raw_body = self.rfile.read(content_length)
            try:
                data = json.loads(raw_body.decode('utf-8'))
            except Exception:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Invalid JSON'}).encode('utf-8'))
                return

            title = str(data.get('title', '')).strip()[:50]
            positive = str(data.get('positive', '')).strip()
            if not title or not positive:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({'error': '标题与正面提示词不能为空'}).encode('utf-8'))
                return

            preset_id = 'pm-' + hex(int(time.time() * 1000))[2:] + os.urandom(2).hex()
            preview_url = ''
            preview_b64 = data.get('previewBase64')
            if preview_b64 and isinstance(preview_b64, str):
                ext = 'webp'
                if 'data:image/' in preview_b64:
                    header, b64_data = preview_b64.split(',', 1)
                    if 'jpeg' in header or 'jpg' in header:
                        ext = 'jpg'
                    elif 'png' in header:
                        ext = 'png'
                else:
                    b64_data = preview_b64

                try:
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
