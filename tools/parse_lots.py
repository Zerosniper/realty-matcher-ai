import re, json, pathlib, html
import pathlib as _pl
_HERE = _pl.Path(__file__).resolve().parent
REPO_ROOT = _HERE.parent if _HERE.name == 'tools' else _HERE
HTML_DIR = (REPO_ROOT / 'data' / 'zhk_html') if _HERE.name == 'tools' else (_HERE / 'zhk_html')
RAW_DIR = (REPO_ROOT / 'data' / 'raw') if _HERE.name == 'tools' else _HERE
HTML_DIR.mkdir(parents=True, exist_ok=True)


def clean(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('\xa0', ' ').replace('&nbsp;', ' ')
    return html.unescape(re.sub(r'\s+', ' ', s)).strip()

def num(s):
    s = s.replace(' ', '').replace('\xa0', '').replace(',', '.')
    m = re.search(r'-?\d+(?:\.\d+)?', s)
    return float(m.group()) if m else None

OUT = {}
for p in sorted(HTML_DIR.glob("*.html")):
    raw = p.read_text(encoding="utf-8", errors="ignore")
    d = {}
    t = re.search(r'<title>(.*?)</title>', raw, re.S)
    d["h1"] = clean(t.group(1)).split(' | ')[0] if t else None
    m = re.search(r'от ([\d.,]+) млн ₽', t.group(1)) if t else None
    d["minLotMln"] = num(m.group(1)) if m else None

    m = re.search(r'price-info-module__[\w-]+__price">([^<]+)<', raw)
    if m:
        v = clean(m.group(1))
        mm = re.search(r'от\s*([\d.,]+)\s*млн\s*₽\s*до\s*([\d.,]+)\s*млн', v)
        if mm:
            d["minLotMln"] = num(mm.group(1)); d["maxLotMln"] = num(mm.group(2))
    m = re.search(r'от <!-- -->([\d  ]+?)<!-- -->\xa0₽/м²\s*до<!-- --> <!-- -->([\d  ]+?)<!-- -->\xa0₽/м²', raw)
    if m:
        d["ppmFrom"] = num(clean(m.group(1))); d["ppmTo"] = num(clean(m.group(2)))

    m = re.search(r'Класс ЖК</div><div class="new-house-params-module__[\w-]+__value">([^<]+)<', raw)
    d["classRaw"] = clean(m.group(1)) if m else None
    m = re.search(r'Статус</div><div class="new-house-params-module__[\w-]+__value">([^<]+)<', raw)
    d["statusRaw"] = clean(m.group(1)) if m else None
    m = re.search(r'Количество квартир в жк</div><div class="new-house-params-module__[\w-]+__value">([^<]+)<', raw)
    d["unitsTotal"] = clean(m.group(1)) if m else None

    m = re.search(r'Сдача в ([^<]{0,40}?)<!-- -->', raw)
    st = re.search(r'state">([^<]{0,80})', raw)
    d["deliveryRaw"] = clean(st.group(1)) if st else None

    prices = re.findall(r'average-prices-module__[\w-]+__price">([^<]+)<', raw)
    descs = re.findall(r'average-prices-module__[\w-]+__description">([^<]+)<', raw)
    d["avg"] = {}
    for v, ds in zip(prices, descs):
        k = clean(ds)
        d["avg"][k] = num(v)

    m = re.search(r'Доступно <strong>(\d+)</strong>', raw)
    d["offers"] = int(m.group(1)) if m else None
    m = re.search(r'Дата обновления:\\xa0<!-- -->([^<]+)<', raw)
    d["asOf"] = clean(m.group(1)) if m else None

    groups = []
    for gm in re.finditer(r'flat-group-title-module__[\w-]+__title">([^<]+)</div><div class="flat-group-title-module__[\w-]+__area">([^<]*)</div><div class="flat-group-title-module__[\w-]+__price">([^<]+)</div><div class="flat-group-title-module__[\w-]+__count"><div class="flat-group-title-module__[\w-]+__counters"><span>([^<]*)</span>', raw):
        rooms = clean(gm.group(1)); area_txt = clean(gm.group(2))
        am = re.search(r'([\d.,]+)\s*м2', area_txt)
        pm = re.search(r'([\d.,]+)\s*[–-]\s*([\d.,]+)', clean(gm.group(3)))
        groups.append({"type": rooms, "minAreaM2": num(am.group(1)) if am else None,
                       "priceFromMln": num(pm.group(1)) if pm else None,
                       "priceToMln": num(pm.group(2)) if pm else None,
                       "count": clean(gm.group(4))})
    d["groups"] = groups
    OUT[p.stem] = d

print(json.dumps(OUT, ensure_ascii=False, indent=1))
RAW_DIR / "zhk_lots.json".write_text(json.dumps(OUT, ensure_ascii=False, indent=2), encoding="utf-8")
