#!/usr/bin/env python3
"""Save ima credentials locally using hidden terminal input; never call the API."""
import argparse
import getpass
import os
from pathlib import Path
import re
import sys
import tempfile
import warnings


def literal(value, label, maximum, credential=False):
    if (not value or len(value) > maximum or "'" in value
            or any(ord(char) < 32 or ord(char) == 127 for char in value)
            or credential and any(char.isspace() for char in value)):
        raise SystemExit(f'{label} 为空、过长或含不能安全保存的字符，未修改配置。')
    placeholder = re.sub(r'[^a-z0-9]', '', value.casefold())
    if credential and placeholder in {
        'yourclientid', 'clientid', 'yourapikey', 'apikey', 'skyourapikey',
        'imaclientid', 'imaapikey', 'placeholder', 'example', 'replaceme',
        'replacewithyourclientid', 'replacewithyourapikey',
    }:
        raise SystemExit(f'{label} 仍为占位值，未修改配置。')
    # dotenv single quotes preserve #, $, double quotes and backslashes literally.
    return "'" + value + "'"


def replace_assignments(content, updates):
    # Walk complete dotenv assignments, including unrelated multiline values.
    # This prevents a line inside another quoted value being mistaken for a key.
    assignment = re.compile(
        r"^[ \t]*(?:export[ \t]+)?([\w.-]+)(?:[ \t]*=[ \t]*|:[ \t]+)"
        r"(?:'(?:\\'|[^'])*'|\"(?:\\\"|[^\"])*\"|`(?:\\`|[^`])*`|[^#\r\n]*)"
        r"[ \t]*(?:#[^\r\n]*)?(?:\r\n|\r|\n|$)", re.MULTILINE)
    spans = [(match.start(), match.end()) for match in assignment.finditer(content)
             if match.group(1) in updates]
    cursor, kept = 0, []
    for start, end in spans:
        kept.append(content[cursor:start])
        cursor = end
    kept.append(content[cursor:])
    result = ''.join(kept)
    if result and not result.endswith(('\r', '\n')):
        result += '\n'
    return result + ''.join(f'{name}={value}\n' for name, value in updates.items())


def main():
    argparse.ArgumentParser(description='隐藏录入 ima 凭证并保存到项目 .env.local；不调用外部服务。').parse_args()
    if not sys.stdin.isatty():
        raise SystemExit('请在交互式终端运行；无法保证隐藏输入，未修改配置。')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            client = literal(getpass.getpass('ima Client ID（隐藏输入）：'), 'Client ID', 300, True)
            key = literal(getpass.getpass('ima API Key（隐藏输入）：'), 'API Key', 500, True)
        kb_name = input('知识库名称（留空保留现有配置；未配置则用项目默认库）：').strip()
    except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
        raise SystemExit('输入未完成，未修改配置。') from None
    updates = {
        'IMA_CLIENT_ID': client, 'IMA_OPENAPI_CLIENTID': client,
        'IMA_API_KEY': key, 'IMA_OPENAPI_APIKEY': key,
    }
    if kb_name:
        updates['IMA_KB_NAME'] = literal(kb_name, '知识库名称', 120)

    target = Path(__file__).resolve().parent.parent / '.env.local'
    if target.is_symlink() or target.exists() and not target.is_file():
        raise SystemExit('.env.local 必须是普通文件，未修改配置。')
    original = target.read_bytes() if target.exists() else None
    content = original.decode('utf-8') if original is not None else ''
    bom = '\ufeff' if content.startswith('\ufeff') else ''
    updated = bom + replace_assignments(content[len(bom):], updates)
    fd, temporary = tempfile.mkstemp(prefix='.env.local.', dir=target.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(updated)
            output.flush()
            os.fsync(output.fileno())
        if target.is_symlink() or (target.read_bytes() if target.exists() else None) != original:
            raise SystemExit('配置文件已被其他进程更改，请重新运行；本次未写入。')
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('ima 配置已保存到项目 .env.local，权限600；未调用 ima。')
    print('请在现有任务完成后重启后端，再验证连接。无需发送凭证。')


if __name__ == '__main__':
    try:
        main()
    except (OSError, UnicodeError):
        raise SystemExit('无法安全读写本地配置文件，未完成保存；请检查权限及 UTF-8 编码。') from None
