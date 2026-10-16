"""Security regression tests for server/server.py (RBQ Prompt Market Node).

Run:  python3 test/test_market_server.py
Uses a temporary data directory and an ephemeral local port; never touches market.rbq.my.
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.dont_write_bytecode = True  # keep server/__pycache__ out of the repo
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix='rbq-market-test-')
os.environ['MARKET_DATA_DIR'] = os.path.join(TMP, 'data')
os.environ['MARKET_UPLOADS_DIR'] = os.path.join(TMP, 'uploads')
os.environ.pop('MARKET_ADMIN_KEY', None)

spec = importlib.util.spec_from_file_location('rbq_market_server', os.path.join(ROOT, 'server', 'server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

OWNER_KEY = 'RBQ-U-00112233aabbccdd'
OTHER_KEY = 'RBQ-U-ffffffffffffffff'


class QuietHandler(server.MarketHandler):
    def log_message(self, *args):
        pass


class MarketServerSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.httpd.daemon_threads = True
        cls.base = f'http://127.0.0.1:{cls.httpd.server_address[1]}'
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        shutil.rmtree(TMP, ignore_errors=True)

    def setUp(self):
        os.environ.pop('MARKET_ADMIN_KEY', None)
        server.save_presets([])
        server._ROTATE_HITS.clear()

    # ── helpers ──
    def request(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode('utf-8') if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers or {})
        if data is not None:
            req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                raw = res.read().decode('utf-8')
                return res.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8')
            return e.code, json.loads(raw) if raw else None

    def upload(self, **over):
        body = {
            'title': '<img src=x onerror=alert(1)> 测试',
            'author': '作者A',
            'positive': '<artist>wlop</artist>, 1girl',
            'negative': 'lowres',
            'model': 'v5',
            'tags': ['NAI V5', 'x' * 100],
            'creatorKey': OWNER_KEY,
            'previewUrl': 'javascript:alert(1)',
            'referenceUrl': 'data:text/html,<script>alert(1)</script>',
            'params': {'scale': 5.5, 'sampler': 'k_euler', 'steps': 28, 'cfgRescale': 0, 'evil': '<script>'},
        }
        body.update(over)
        status, data = self.request('POST', '/api/upload', body)
        self.assertEqual(status, 200, data)
        return data['item']

    def assert_no_secrets(self, obj):
        text = json.dumps(obj, ensure_ascii=False)
        self.assertNotIn('creatorKey', text)
        self.assertNotIn('liked_by', text)
        self.assertNotIn(OWNER_KEY, text)
        self.assertNotIn(OTHER_KEY, text)

    # ── creatorKey must never be public ──
    def test_upload_response_has_no_creator_key(self):
        item = self.upload()
        self.assert_no_secrets(item)
        self.assertTrue(item['hasOwner'])
        # stored server-side for auth
        stored = server.load_presets()[0]
        self.assertEqual(stored['creatorKey'], OWNER_KEY)

    def test_list_has_no_creator_key_or_liked_by(self):
        item = self.upload()
        # a like with the creator key as clientId must not surface either
        status, _ = self.request('POST', '/api/like', {'id': item['id'], 'clientId': OTHER_KEY})
        self.assertEqual(status, 200)
        status, data = self.request('GET', '/api/presets')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 1)
        self.assert_no_secrets(data)
        self.assertTrue(data[0]['hasOwner'])
        self.assertEqual(data[0]['likes'], 1)

    def test_legacy_unbound_preset_reports_has_owner_false(self):
        server.save_presets([{'id': 'legacy-1', 'title': 't', 'positive': 'p', 'author': '老作者'}])
        status, data = self.request('GET', '/api/presets')
        self.assertEqual(status, 200)
        self.assertFalse(data[0]['hasOwner'])

    def test_upload_sanitises_urls_and_limits_fields(self):
        item = self.upload(title='T' * 500, positive='P' * 20000)
        self.assertEqual(item['previewUrl'], server.DEFAULT_PREVIEW_URL)
        self.assertEqual(item['referenceUrl'], '')
        self.assertEqual(len(item['title']), server.MAX_TITLE)
        self.assertEqual(len(item['positive']), server.MAX_PROMPT)
        self.assertTrue(all(len(t) <= server.MAX_TAG_LEN for t in item['tags']))
        self.assertNotIn('evil', item['params'])
        # Text is stored as-is (escaping is the client's job); legit <artist> prompts survive.
        self.assertIn('<artist>wlop</artist>', self.upload()['positive'])

    # ── /api/my-presets ──
    def test_my_presets_endpoint(self):
        mine = self.upload()
        other = self.upload(creatorKey=OTHER_KEY, title='other')
        status, data = self.request('GET', '/api/my-presets', headers={'Authorization': f'Bearer {OWNER_KEY}'})
        self.assertEqual(status, 200)
        self.assertEqual(data, {'success': True, 'ids': [mine['id']]})
        status, data = self.request('GET', '/api/my-presets', headers={'X-Creator-Key': OTHER_KEY})
        self.assertEqual((status, data['ids']), (200, [other['id']]))
        status, data = self.request('POST', '/api/my-presets', {'creatorKey': OWNER_KEY})
        self.assertEqual((status, data['ids']), (200, [mine['id']]))
        status, data = self.request('GET', '/api/my-presets', headers={'Authorization': 'Bearer RBQ-U-nobody'})
        self.assertEqual((status, data['ids']), (200, []))
        status, data = self.request('GET', '/api/my-presets')
        self.assertEqual(status, 401)
        self.assertFalse(data['success'])

    # ── edit / delete still require the key ──
    def test_update_with_wrong_key_is_forbidden(self):
        item = self.upload()
        status, data = self.request('POST', '/api/update', {'id': item['id'], 'creatorKey': OTHER_KEY, 'title': 'hacked'})
        self.assertEqual(status, 403, data)
        status, data = self.request('POST', '/api/update', {'id': item['id'], 'creatorKey': '', 'title': 'hacked'})
        self.assertEqual(status, 403, data)
        self.assertEqual(server.load_presets()[0]['title'], item['title'])

    def test_update_with_right_key_works_and_hides_key(self):
        item = self.upload()
        status, data = self.request('POST', '/api/update', {'id': item['id'], 'creatorKey': OWNER_KEY, 'title': '新标题'})
        self.assertEqual(status, 200, data)
        self.assertEqual(data['item']['title'], '新标题')
        self.assert_no_secrets(data)

    def test_delete_with_wrong_key_is_forbidden_right_key_works(self):
        item = self.upload()
        status, _ = self.request('POST', '/api/delete', {'id': item['id'], 'creatorKey': OTHER_KEY, 'author': '作者A'})
        self.assertEqual(status, 403)
        status, data = self.request('POST', '/api/delete', {'id': item['id'], 'creatorKey': OWNER_KEY})
        self.assertEqual(status, 200, data)
        self.assertEqual(server.load_presets(), [])

    def test_claim_cannot_steal_bound_preset(self):
        item = self.upload()
        status, _ = self.request('POST', '/api/claim', {'id': item['id'], 'creatorKey': OTHER_KEY})
        self.assertEqual(status, 403)
        self.assertEqual(server.load_presets()[0]['creatorKey'], OWNER_KEY)

    # ── admin key: env only, disabled when unset ──
    def test_no_hardcoded_admin_key(self):
        with open(os.path.join(ROOT, 'server', 'server.py'), encoding='utf-8') as f:
            src = f.read()
        self.assertNotRegex(src, r"MARKET_ADMIN_KEY'\s*,\s*'[^']+'")
        self.assertEqual(server.get_admin_key(), '')

    def test_admin_disabled_without_env(self):
        self.upload()
        for key in ['', 'anything', '1200']:
            status, _ = self.request('POST', '/api/delete', {'id': '__ALL__', 'adminKey': key})
            self.assertEqual(status, 403)
        item = server.load_presets()[0]
        status, _ = self.request('POST', '/api/update', {'id': item['id'], 'adminKey': 'anything', 'title': 'x'})
        self.assertEqual(status, 403)
        self.assertEqual(len(server.load_presets()), 1)

    def test_admin_empty_env_is_disabled(self):
        os.environ['MARKET_ADMIN_KEY'] = '   '
        self.upload()
        status, _ = self.request('POST', '/api/delete', {'id': '__ALL__', 'adminKey': ''})
        self.assertEqual(status, 403)
        status, _ = self.request('POST', '/api/delete', {'id': '__ALL__', 'adminKey': '   '})
        self.assertEqual(status, 403)

    def test_admin_enabled_with_env(self):
        os.environ['MARKET_ADMIN_KEY'] = 'test-admin-secret-xyz'
        item = self.upload()
        status, _ = self.request('POST', '/api/update', {'id': item['id'], 'adminKey': 'wrong', 'title': 'x'})
        self.assertEqual(status, 403)
        status, data = self.request('POST', '/api/update', {'id': item['id'], 'adminKey': 'test-admin-secret-xyz', 'title': '管理改'})
        self.assertEqual(status, 200, data)
        self.assert_no_secrets(data)
        status, _ = self.request('POST', '/api/delete', {'id': '__ALL__', 'adminKey': 'test-admin-secret-xyz'})
        self.assertEqual(status, 200)
        self.assertEqual(server.load_presets(), [])

    def test_keys_equal_uses_constant_time_and_rejects_empty(self):
        self.assertTrue(server.keys_equal('abc', 'abc'))
        self.assertFalse(server.keys_equal('', ''))
        self.assertFalse(server.keys_equal(None, None))
        self.assertFalse(server.keys_equal('abc', 'abd'))
        with open(os.path.join(ROOT, 'server', 'server.py'), encoding='utf-8') as f:
            self.assertIn('hmac.compare_digest', f.read())

    # ── /api/rotate-key (换码) ──
    def my_ids(self, key):
        status, data = self.request('GET', '/api/my-presets', headers={'Authorization': f'Bearer {key}'})
        self.assertEqual(status, 200)
        return sorted(data['ids'])

    def test_rotate_moves_all_presets_to_new_key(self):
        a = self.upload(title='a')
        b = self.upload(title='b')
        c = self.upload(title='c', creatorKey=OTHER_KEY)
        new_key = 'RBQ-U-0123456789abcdef'
        status, data = self.request('POST', '/api/rotate-key', {'oldKey': OWNER_KEY, 'newKey': new_key})
        self.assertEqual(status, 200, data)
        self.assertEqual(data, {'success': True, 'moved': 2})
        self.assertEqual(self.my_ids(new_key), sorted([a['id'], b['id']]))
        self.assertEqual(self.my_ids(OWNER_KEY), [])
        self.assertEqual(self.my_ids(OTHER_KEY), [c['id']], 'other creators untouched')
        # old key can no longer edit or delete
        status, _ = self.request('POST', '/api/update', {'id': a['id'], 'creatorKey': OWNER_KEY, 'title': 'x'})
        self.assertEqual(status, 403)
        status, _ = self.request('POST', '/api/delete', {'id': a['id'], 'creatorKey': OWNER_KEY})
        self.assertEqual(status, 403)
        # new key can
        status, _ = self.request('POST', '/api/update', {'id': a['id'], 'creatorKey': new_key, 'title': '新'})
        self.assertEqual(status, 200)
        # the public list still hides keys
        status, listing = self.request('GET', '/api/presets')
        self.assertNotIn(new_key, json.dumps(listing))

    def test_rotate_wrong_old_key_moves_nothing(self):
        a = self.upload()
        status, data = self.request('POST', '/api/rotate-key', {'oldKey': OTHER_KEY, 'newKey': 'RBQ-U-aaaaaaaaaaaaaaaa'})
        self.assertEqual((status, data), (200, {'success': True, 'moved': 0}))
        self.assertEqual(self.my_ids(OWNER_KEY), [a['id']])
        self.assertEqual(self.my_ids('RBQ-U-aaaaaaaaaaaaaaaa'), [])

    def test_rotate_accepts_old_key_from_header(self):
        a = self.upload()
        status, data = self.request('POST', '/api/rotate-key', {'newKey': 'RBQ-U-bbbbbbbbbbbbbbbb'},
                                    headers={'Authorization': f'Bearer {OWNER_KEY}'})
        self.assertEqual((status, data['moved']), (200, 1))
        self.assertEqual(self.my_ids('RBQ-U-bbbbbbbbbbbbbbbb'), [a['id']])

    def test_rotate_same_key_is_noop(self):
        a = self.upload()
        status, data = self.request('POST', '/api/rotate-key', {'oldKey': OWNER_KEY, 'newKey': OWNER_KEY})
        self.assertEqual((status, data['success'], data['moved']), (200, True, 0))
        self.assertEqual(self.my_ids(OWNER_KEY), [a['id']])

    def test_rotate_rejects_bad_input(self):
        self.upload()
        for body in [{'oldKey': OWNER_KEY, 'newKey': ''}, {'oldKey': OWNER_KEY, 'newKey': 'short'},
                     {'oldKey': OWNER_KEY, 'newKey': 'RBQ-U-<script>xx'}, {'oldKey': OWNER_KEY, 'newKey': 'x' * 65},
                     {'oldKey': '', 'newKey': 'RBQ-U-cccccccccccccccc'}]:
            status, data = self.request('POST', '/api/rotate-key', body)
            self.assertEqual(status, 400, body)
            self.assertFalse(data['success'])
        self.assertEqual(len(self.my_ids(OWNER_KEY)), 1)
        # legacy 8-hex keys are still accepted as a target for compat
        status, data = self.request('POST', '/api/rotate-key', {'oldKey': OWNER_KEY, 'newKey': 'RBQ-U-d31879f4'})
        self.assertEqual((status, data['moved']), (200, 1))

    def test_rotate_migrates_likes_made_with_old_key(self):
        a = self.upload(creatorKey=OTHER_KEY)
        self.request('POST', '/api/like', {'id': a['id'], 'clientId': OWNER_KEY})
        status, _ = self.request('POST', '/api/rotate-key', {'oldKey': OWNER_KEY, 'newKey': 'RBQ-U-dddddddddddddddd'})
        self.assertEqual(status, 200)
        stored = server.load_presets()[0]
        self.assertEqual(stored['liked_by'], ['RBQ-U-dddddddddddddddd'])
        self.assertEqual(stored['likes'], 1)
        self.assertEqual(stored['creatorKey'], OTHER_KEY)

    def test_rotate_is_rate_limited(self):
        for i in range(server.ROTATE_MAX_PER_WINDOW):
            status, _ = self.request('POST', '/api/rotate-key', {'oldKey': f'RBQ-U-guess{i:04d}', 'newKey': 'RBQ-U-eeeeeeeeeeeeeeee'})
            self.assertEqual(status, 200)
        status, data = self.request('POST', '/api/rotate-key', {'oldKey': OWNER_KEY, 'newKey': 'RBQ-U-eeeeeeeeeeeeeeee'})
        self.assertEqual(status, 429)
        self.assertFalse(data['success'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
