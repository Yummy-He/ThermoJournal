"""Build the offline HTML from local UI assets. No personal data is an input."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "app" / "web"


def build():
    template = (WEB / "index.html").read_text(encoding="utf-8")
    css = (WEB / "ui.css").read_text(encoding="utf-8")
    scripts = []
    for name in ("archive", "bluetooth", "portable", "ui"):
        code = (WEB / f"{name}.js").read_text(encoding="utf-8")
        if "</script" in code.lower():
            raise ValueError(f"Inline script terminator in {name}.js")
        scripts.append("<script>\n" + code + "\n</script>")
    document = template.replace('<link rel="stylesheet" href="ui.css">',
                                "<style>\n" + css + "\n</style>")
    for name in ("archive", "bluetooth", "portable", "ui"):
        document = document.replace(f'<script defer src="{name}.js"></script>', "")
    document = document.replace('<head>', '''<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">''')
    document = document.replace("</body>", "\n".join(scripts) + "\n</body>")
    (ROOT / "ThermoJournal.html").write_bytes(document.encode("utf-8"))


if __name__ == "__main__":
    build()
