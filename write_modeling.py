from pathlib import Path
from textwrap import dedent

content = dedent("""
<REPLACE>
""")
Path("frontend/src/app/modeling/page.tsx").write_text(content, encoding="utf-8")
