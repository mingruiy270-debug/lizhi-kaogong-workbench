from __future__ import annotations

import json
import sys
from pathlib import Path

from markitdown import MarkItDown


def main() -> int:
    if len(sys.argv) != 3:
        raise ValueError("usage: markitdown-worker.py <local-input> <markdown-output>")

    source = Path(sys.argv[1]).resolve(strict=True)
    output = Path(sys.argv[2]).resolve()
    if not source.is_file():
        raise ValueError("input must be a local regular file")

    output.parent.mkdir(parents=True, exist_ok=True)
    converter = MarkItDown(enable_plugins=False)
    result = converter.convert_local(source)
    text = result.text_content
    if not isinstance(text, str):
        raise ValueError("MarkItDown returned non-text content")

    output.write_text(text, encoding="utf-8")
    print(json.dumps({"characters": len(text)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
