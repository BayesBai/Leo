#!/usr/bin/env python3
"""Configure independent image/Canva credentials without printing secrets."""
from pathlib import Path
import argparse, getpass, os, re, tempfile

parser = argparse.ArgumentParser()
parser.add_argument('service', choices=['image', 'canva', 'canva-proxy', 'all'], default='all', nargs='?')
args = parser.parse_args()
p = Path(__file__).resolve().parent.parent / '.env.local'
updates = {}
if args.service in ('image', 'all'):
    key = getpass.getpass('生图网关 API Key（隐藏输入）：').strip()
    if not re.fullmatch(r'sk-[A-Za-z0-9._~+/-]+={0,2}', key) or key == 'sk-your-api-key':
        raise SystemExit('Key 格式异常，未修改配置。')
    updates.update(IMAGE_BASE_URL='https://relay.styxgate.top/v1', IMAGE_MODEL='gpt-image-2.5', IMAGE_API_KEY=key)
if args.service in ('canva', 'all'):
    client = getpass.getpass('Canva 开发应用 Client ID（隐藏输入）：').strip()
    secret = getpass.getpass('Canva 开发应用 Client Secret（隐藏输入）：').strip()
    if not client or not secret or any(c in client + secret for c in '\r\n\x00'):
        raise SystemExit('Canva 应用凭证为空或格式异常，未修改配置。')
    updates.update(CANVA_CLIENT_ID=client, CANVA_CLIENT_SECRET=secret, CANVA_REDIRECT_URI='http://127.0.0.1:3000/api/integrations/canva/callback')
if args.service == 'canva-proxy':
    port = input('Canva 本机 HTTP 代理端口（留空停用，仅影响 Canva）：').strip()
    if port and (not port.isascii() or not port.isdecimal() or not 1 <= int(port) <= 65535):
        raise SystemExit('代理端口无效，未修改配置。')
    updates['CANVA_PROXY_URL'] = f'http://127.0.0.1:{int(port)}' if port else ''
old = p.read_text(encoding='utf-8') if p.exists() else ''
pattern = r'^\s*(?:export\s+)?(?:' + '|'.join(updates) + r')\s*='
lines = [line for line in old.splitlines() if not re.match(pattern, line)]
lines += [f'{name}={value}' for name, value in updates.items()]
fd, tmp = tempfile.mkstemp(prefix='.env.local.', dir=p.parent)
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n'); f.flush(); os.fsync(f.fileno())
    os.chmod(tmp, 0o600); os.replace(tmp, p)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
print('配置已保存，权限600；原文本模型及其他配置保留。请告知已配置，不要发送凭证。')
