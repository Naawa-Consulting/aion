from pathlib import Path
text = Path('docs/README.md').read_text(encoding='utf-8')
import unicodedata
for line in text.splitlines():
    if 'Summary contributions' in line:
        print([hex(ord(ch)) for ch in line])
