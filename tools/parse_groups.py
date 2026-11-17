import re, json, pathlib, html
import pathlib as _pl
_HERE = _pl.Path(__file__).resolve().parent
REPO_ROOT = _HERE.parent if _HERE.name == 'tools' else _HERE
HTML_DIR = (REPO_ROOT / 'data' / 'zhk_html') if _HERE.name == 'tools' else (_HERE / 'zhk_html')
RAW_DIR = (REPO_ROOT / 'data' / 'raw') if _HERE.name == 'tools' else _HERE
HTML_DIR.mkdir(parents=True, exist_ok=True)


def clean(s):
    s = re.sub(r'<[^>]+>', '', s).replace('\xa0',' ').replace('&nbsp;',' ')
    return html.unescape(re.sub(r'\s+',' ',s)).strip()

def num(s):
    s = s.replace(' ','').replace(',','.')
    m = re.search(r'-?\d+(?:\.\d+)?', s)
    return float(m.group()) if m else None

OUT={}
for p in sorted(HTML_DIR.glob("*.html")):
    raw = p.read_text(encoding="utf-8", errors="ignore")
    raw = re.sub(r'<!--.*?-->','',raw,flags=re.S)
    groups=[]
    for gm in re.finditer(r'flat-group-title-module__[\w-]+__title">([^<]*)</div><div class="flat-group-title-module__[\w-]+__area">([^<]*)</div><div class="flat-group-title-module__[\w-]+__price">([^<]*)</div>', raw):
        typ=clean(gm.group(1)); area=clean(gm.group(2)); price=clean(gm.group(3))
        am=re.search(r'([\d.,]+)\s*м2',area); pm=re.search(r'([\d.,]+)\s*[–-]\s*([\d.,]+)',price)
        groups.append({"type":typ,"minAreaM2":num(am.group(1)) if am else None,
                       "fromMln":num(pm.group(1)) if pm else None,"toMln":num(pm.group(2)) if pm else None})
    m=re.search(r'Дата обновления:\s*([^<]+)<',raw)
    asOf=clean(m.group(1)) if m else None
    OUT[p.stem]={"asOf":asOf,"groups":groups}
print(json.dumps(OUT,ensure_ascii=False,indent=1))
RAW_DIR / "zhk_groups.json".write_text(json.dumps(OUT,ensure_ascii=False,indent=2),encoding="utf-8")
