import re, json, urllib.request, pathlib
import pathlib as _pl
_HERE = _pl.Path(__file__).resolve().parent
REPO_ROOT = _HERE.parent if _HERE.name == 'tools' else _HERE
HTML_DIR = (REPO_ROOT / 'data' / 'zhk_html') if _HERE.name == 'tools' else (_HERE / 'zhk_html')
RAW_DIR = (REPO_ROOT / 'data' / 'raw') if _HERE.name == 'tools' else _HERE
HTML_DIR.mkdir(parents=True, exist_ok=True)

URLS = {
 "sochi-polyana": "https://realty.vbr.ru/sochi/novostroyki/zhk/polyana-pik/",
 "sochi-neskuchny": "https://realty.vbr.ru/sochi/novostroyki/zhk/gostinicnii-kompleks-neskycnii-sad/",
 "sochi-belye-noci": "https://realty.vbr.ru/sochi/novostroyki/zhk/belie-noci-6/",
 "sochi-svetsky": "https://realty.vbr.ru/sochi/novostroyki/zhk/svetskii-les/",
 "sochi-kislorod": "https://realty.vbr.ru/sochi/novostroyki/zhk/kislorod-3/",
 "msk-clos17": "https://realty.vbr.ru/moskva/novostroyki/zhk/clos-17--klo-17-/",
 "msk-chistye": "https://realty.vbr.ru/moskva/novostroyki/zhk/cistie-prydi-1/",
 "msk-plehanova": "https://realty.vbr.ru/moskva/novostroyki/zhk/plehanova-11/",
 "msk-trilogiya": "https://realty.vbr.ru/moskva/novostroyki/zhk/crystal-trilogiya--kristall-trilogiya-/",
 "msk-admiral": "https://realty.vbr.ru/moskva/novostroyki/zhk/admiral-21/",
 "ekb-literaturny": "https://realty.vbr.ru/ekaterinburg/novostroyki/zhk/po-yl-pervomaiskaya-1/",
 "ekb-dom7": "https://realty.vbr.ru/ekaterinburg/novostroyki/zhk/dom-7--dom-7-/",
 "ekb-nagorniy": "https://realty.vbr.ru/ekaterinburg/novostroyki/zhk/nagornii-1/",
 "ekb-park-stolic": "https://realty.vbr.ru/ekaterinburg/novostroyki/zhk/park-stolic/",
}
opener = urllib.request.build_opener()
for k,u in URLS.items():
    p = HTML_DIR / f"{k}.html"
    if p.exists() and p.stat().st_size > 30000:
        print("cached", k); continue
    try:
        req = urllib.request.Request(u, headers={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"})
        raw = opener.open(req, timeout=30).read()
        p.write_bytes(raw)
        print("ok", k, len(raw))
    except Exception as e:
        print("FAIL", k, repr(e)[:120])
