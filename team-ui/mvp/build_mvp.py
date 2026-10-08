import re, base64
base = open('../v2_head.html', encoding='utf-8').read()
css = base[base.index('<style>') + 7:base.index('</style>')]
css = re.sub(r'@media \(max-width:(1100|640)px\)\{.*?\n\}\n', '', css, flags=re.S)  # STRIPPED old responsive blocks
extra = open('mvp_extra.css', encoding='utf-8').read()
skeleton = open('mvp_skeleton.html', encoding='utf-8').read()
src = open('orig_dashboard.html', encoding='utf-8').read()
raw = src.replace('</script', '</scr@@ipt').replace('<!--', '<!@@--')
import json

# ---- one palette: every stray color maps onto it, so the product cannot drift ----
import re as _re
_GREYS = [0x0A0A0A, 0x3A3A3F, 0x6A6A70, 0x9A9AA0, 0xCFCFD4, 0xE4E4E8, 0xF1F1F3, 0xF8F8F8, 0xFFFFFF]
_MAP = {
 # green
 '15a34a':'17A05B','2fa85a':'17A05B','4cc38a':'17A05B','0f6b3b':'0B7A41',
 # red
 'dc2626':'D93A43','e5173f':'D93A43','ff7a80':'D93A43','a31515':'B3262F',
 # amber
 'd99a00':'E2A100','e0a100':'E2A100','f5a524':'E2A100','e8b04a':'E2A100','f0b93a':'E2A100','7a5a12':'8A5A00',
 # blue and navy become ink
 '2f7cf6':'3A3A3F','1a6fdb':'0A0A0A','2563eb':'0A0A0A','0f5bbf':'0A0A0A','7db4ff':'0A0A0A','16204a':'0A0A0A',
 # teal
 '14b8a6':'6A6A70',
}
def _fix(m):
    h = m.group(1).lower()
    if h in _MAP: return '#' + _MAP[h]
    r, g, bb = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
    if max(r,g,bb) - min(r,g,bb) <= 24:
        avg = (r+g+bb)/3
        best = max([p for p in _GREYS if ((p>>16)+((p>>8)&255)+(p&255))/3 <= avg+0.5] or [_GREYS[0]], key=lambda p: ((p>>16)+((p>>8)&255)+(p&255))/3)
        return '#%06X' % best
    return m.group(0)
def normalize(text):
    return _re.sub(r'#([0-9a-fA-F]{6})\b', _fix, text)
def lighten(text):
    # one lighter weight scale: 500 for titles, bold stays for <b> only
    return _re.sub(r'font-weight:\s*(600|650|700)\b', 'font-weight:500', text)
icons = 'var ICONS=' + open('icons/uris.json', encoding='utf-8').read() + ';' + chr(10)
logo = 'var LOGO=' + json.dumps(open('icons/logo.txt', encoding='utf-8').read()) + ';' + chr(10)
_logic_raw = icons + logo + open('mvp_main.js', encoding='utf-8').read() + open('mvp_canvas.js', encoding='utf-8').read() + open('mvp_onb.js', encoding='utf-8').read() + open('mvp_live.js', encoding='utf-8').read() + open('mvp_boot.js', encoding='utf-8').read()
logic = lighten(normalize(_logic_raw))
head = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Botlien Team</title><link rel="icon" href="' + open('icons/logo.txt', encoding='utf-8').read().strip() + '"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap">\n<style>' + lighten(normalize(css + extra)) + '</style></head><body>\n'
out = head + skeleton + '<script>\n' + logic + '\n</script>\n<script id="samsrc" type="text/plain">' + raw + '</script>\n</body></html>'
assert '</script' not in logic.lower().replace('</script>','')
open('botlien_team_mvp.html', 'w', encoding='utf-8').write(out)
out2 = out.replace('<title>Botlien Team</title>', '<title>Botlien Onboarding</title><script>window.__ONB=true;</script>', 1)
assert 'window.__ONB=true' in out2
open('botlien_team_onboarding.html', 'w', encoding='utf-8').write(out2)
open('check_mvp.js', 'w', encoding='utf-8').write(logic)
print(len(out) // 1024, 'KB')
