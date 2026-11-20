# -*- coding: utf-8 -*-
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Обход страниц ЖК на realty.vbr.ru и выгрузка НОВЫХ карточек в тот же формат,
что и extract_zhk.py (zhk_lots.json) + zhk_groups.json.

Принципы:
  * в датасет идёт только то, что напечатано на странице ЖК (JSON-LD, модуль цены,
    модуль «Доступно N предложений», группы лотов, параметр «Класс ЖК», дата обновления);
  * карточке не хватает обязательного поля — она НЕ попадает в выгрузку, причина пишется в лог;
  * квота на город: +3 бизнес и +2 премиум (структура выборки как в README).

Выход:
  realty-matcher-ai/data/raw/zhk_lots_new.json    — лоты/цены в формате extract_zhk.py
  realty-matcher-ai/data/raw/zhk_groups_new.json  — срок сдачи и дата актуальности
  realty-matcher-ai/data/raw/zhk_meta_new.json     — name/developer/district/feature/url с карточки
  /home/user/harvest_log.txt                       — журнал обхода (взято / пропущено и почему)
"""
import json
import pathlib as _pl
_HERE = _pl.Path(__file__).resolve().parent
REPO_ROOT = _HERE.parent if _HERE.name == 'tools' else _HERE

import re
import html
import time
import pathlib
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept-Language": "ru-RU,ru;q=0.9"}
ROOT = pathlib.Path(str(REPO_ROOT.parent))
CACHE = ROOT / "zhk_html2"
RAWOUT = ROOT / "realty-matcher-ai" / "data" / "raw"
LOG = []

CITIES = {"Сочи": "sochi", "Москва": "moskva", "Екатеринбург": "ekaterinburg"}
LISTS = {"Бизнес": "biznes", "Премиум": "premium"}
QUOTA = {"Бизнес": 3, "Премиум": 2}
MAX_PAGES = 6


def say(msg):
    LOG.append(msg)
    print(msg, flush=True)


def clean(s):
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("\xa0", " ")
    return html.unescape(re.sub(r"\s+", " ", s)).strip()


def num(s):
    if s is None:
        return None
    s = str(s).replace(" ", "").replace("\xa0", "").replace(",", ".")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def fetch(url, key):
    p = CACHE / (key + ".html")
    if p.exists() and p.stat().st_size > 30000:
        return p.read_text(encoding="utf-8", errors="ignore")
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45).read().decode("utf-8", "ignore")
            if len(raw) > 30000:
                p.write_text(raw, encoding="utf-8")
                time.sleep(0.4)
                return raw
            say("  ! %s: страница короче 30 КБ (%d б) — считаем, что карточки нет" % (key, len(raw)))
            return None
        except Exception as e:
            say("  ! %s: %s (попытка %d/3)" % (key, repr(e)[:70], attempt + 1))
            time.sleep(1.2)
    return None


def ld_escape(raw):
    """JSON-LD лежит внутри flight-данных в экранированном виде — приводим к читаемому."""
    s = raw.replace('\\\\n', ' ').replace('\\n', ' ')
    s = s.replace('\\\\"', '"').replace('\\"', '"')
    return re.sub(r"\s+", " ", s)


def list_slugs(city_slug, list_slug):
    """Слаг + название ЖК из карточек спискаfiltered по классу."""
    out, seen = [], set()
    for page in range(1, MAX_PAGES + 1):
        url = "https://realty.vbr.ru/%s/novostroyki/%s/" % (city_slug, list_slug) + ("" if page == 1 else "?page=%d" % page)
        raw = fetch(url, "%s_%s_p%d" % (city_slug, list_slug, page))
        if not raw:
            break
        got = list(dict.fromkeys(re.findall(r'href="https://realty\.vbr\.ru/%s/novostroyki/zhk/([a-z0-9_-]+)/"' % city_slug, raw)))
        fresh = [s for s in got if s not in seen]
        if not fresh:
            break
        seen.update(fresh)
        out.extend(fresh)
    return out


def parse_card(raw, url, city):
    """(lots-запись в формате extract_zhk, meta-запись, список пропущенных полей)."""
    miss = []
    esc = ld_escape(raw)
    txt = clean(raw)

    t = re.search(r"<title>(.*?)</title>", raw, re.S)
    title = clean(t.group(1)) if t else ""
    d = {"h1": title.split(" | ")[0] if title else None}
    if not title:
        miss.append("<title>")
        return d, {}, miss

    dev = None
    m = re.search(r"«(.+?)»", title)
    name = "ЖК «%s»" % m.group(1) if m else None
    m = re.search(r"от застройщика\s+(.+?)\s+в\s+[^—]{2,40}—", title)
    if m:
        dev = m.group(1).strip()
    if not name:
        miss.append("название")
    if not dev:
        m = re.search(r'"developer":\s*\{[^}]*"name":\s*"([^"]{3,80})"', esc)
        if m:
            dev = m.group(1).strip()
    if not dev:
        miss.append("застройщик")

    cands = [c.strip() for c in re.findall(r'"(?:streetAddress|address)":\s*"([^"]{4,150})"', esc)]
    stem = city.lower()
    stem = stem[:-1] if stem.endswith("й") else stem
    address = next((c for c in cands if (stem[:4] in c.lower() or "край" in c.lower())
                    and "офис" not in c.lower() and "набережная 11а" not in c.lower()), None)

    low = re.search(r'"lowPrice":\s*(\d+)', esc)
    high = re.search(r'"highPrice":\s*(\d+)', esc)
    cnt = re.search(r'"offerCount":\s*(\d+)', esc)
    if low:
        d["minLotMln"] = round(int(low.group(1)) / 1e6, 2)
    if high:
        d["maxLotMln"] = round(int(high.group(1)) / 1e6, 2)
    if not low:
        m = re.search(r"от ([\d.,]+) млн ₽", title)
        if m:
            d["minLotMln"] = num(m.group(1))
    if not d.get("minLotMln"):
        m = re.search(r'price-info-module__[\w-]+__price">([^<]+)<', raw)
        if m:
            mm = re.search(r"от\s*([\d.,]+)\s*млн", clean(m.group(1)))
            if mm:
                d["minLotMln"] = num(mm.group(1))
    if not d.get("minLotMln"):
        miss.append("цена лота «от»")
    if not d.get("maxLotMln"):
        miss.append("цена лота «до»")

    # ₽/м² из модуля цены
    ppm = re.search(r"от\s*([\d][\d ]{4,12})\s*₽/м²\s*до\s*([\d][\d ]{4,12})\s*₽/м²", txt)
    if ppm:
        d["ppmFrom"] = num(ppm.group(1))
        d["ppmTo"] = num(ppm.group(2))
    else:
        one = re.search(r"от\s*([\d][\d ]{4,12})\s*₽/м²", txt)
        if one:
            d["ppmFrom"] = num(one.group(1))
            d["ppmTo"] = None
            miss.append("верхняя граница ₽/м²")
        else:
            d["ppmFrom"] = None
            miss.append("₽/м² «от»")

    klass = re.search(r"Класс ЖК</div><div class=\"new-house-params-module__[\w-]+__value\">([^<]+)<", raw)
    if not klass:
        klass = re.search(r'"Класс",\s*"value":\s*"([^"]{2,40})"', esc)
    d["classRaw"] = clean(klass.group(1)) if klass else None
    if not d["classRaw"]:
        miss.append("Класс ЖК")

    st = re.search(r"Статус</div><div class=\"new-house-params-module__[\w-]+__value\">([^<]+)<", raw)
    d["statusRaw"] = clean(st.group(1)) if st else None

    ut = re.search(r"Количество квартир в жк</div><div class=\"new-house-params-module__[\w-]+__value\">([^<]+)<", raw)
    d["unitsTotal"] = clean(ut.group(1)) if ut else None

    dl = re.search(r"Сдача в (20\d\d(?:\s*(?:-|–|—)\s*20\d\d)?)", txt)
    if dl:
        d["deliveryRaw"] = clean(dl.group(0))
    else:
        dl = re.search(r"(Строится до [^<]{2,28}?)(?:\s+(?:Класс|Стоимость|Тип|Этажность|Паркинг|Отделка))", txt)
        d["deliveryRaw"] = clean(dl.group(1)) if dl else None
    if not d["deliveryRaw"]:
        miss.append("срок сдачи")

    prices = re.findall(r'average-prices-module__[\w-]+__price">([^<]+)<', raw)
    descs = re.findall(r'average-prices-module__[\w-]+__description">([^<]+)<', raw)
    d["avg"] = {}
    for v, ds in zip(prices, descs):
        d["avg"][clean(ds)] = num(v)
    d["avgPerM2"] = d["avg"].get("Средняя цена за м²") or next((v for k, v in d["avg"].items() if "м²" in k), None)

    m = re.search(r"Доступно\s*(\d+)", txt)
    d["offers"] = int(m.group(1)) if m else None
    if d["offers"] is None:
        m = re.search(r"«(\d+)» предложений", txt)
        d["offers"] = int(m.group(1)) if m else None
    if d["offers"] is None:
        miss.append("число предложений")

    # группы лотов: title / area (внутри <!-- -->) / price / счётчик
    groups = []
    for gm in re.finditer(r'flat-group-title-module__[\w-]+__title">([^<]+)</div>'
                          r'<div class="flat-group-title-module__[\w-]+__area">(.*?)</div>'
                          r'<div class="flat-group-title-module__[\w-]+__price">(.*?)</div>', raw, re.S):
        rooms = clean(gm.group(1))
        area_txt = clean(re.sub(r"<!--.*?-->", " ", gm.group(2)))
        price_txt = clean(re.sub(r"<!--.*?-->", " ", gm.group(3)))
        am = re.search(r"([\d.,]+)\s*м2", area_txt)
        pm = re.search(r"([\d.,]+)\s*[–—-]\s*([\d.,]+)", price_txt)
        one = re.search(r"([\d.,]+)\s*млн", price_txt)
        groups.append({"type": rooms,
                       "minAreaM2": num(am.group(1)) if am else None,
                       "fromMln": num(pm.group(1)) if pm else (num(one.group(1)) if one else None),
                       "toMln": num(pm.group(2)) if pm else None})
    d["groups"] = groups
    if not groups:
        miss.append("лоты по типам")

    upd = re.search(r"Дата обновления:\s*(\d{2}\.\d{2}\.\d{4}(?:,\s*\d{2}:\d{2})?)", txt)
    d["asOf"] = upd.group(1).strip() if upd else None

    meta = {"name": name, "developer": dev, "address": address,
            "classFromCard": d["classRaw"], "sourceUrl": url, "sourceName": "realty.vbr.ru",
            "featureParts": {}, "minLotMln": d.get("minLotMln"), "ppmFrom": d.get("ppmFrom")}
    for key in ("Этажность", "Отделка", "Паркинг"):
        m = re.search(r'"%s",\s*"value":\s*"([^"]{2,70})"' % key, esc)
        if m:
            meta["featureParts"][key] = m.group(1).strip()
    m = re.search(r"предлагает квартиры площадью от ([\d.,]+) м² до ([\d.,]+) м²", txt)
    if m:
        meta["featureParts"]["площадь"] = "%s-%s м²" % (num(m.group(1)), num(m.group(2)))
    return d, meta, miss


def main():
    known = set()
    zp = ROOT / "realty-matcher-ai" / "data" / "zhk.json"
    for r in json.loads(zp.read_text(encoding="utf-8")):
        u = r.get("sourceUrl") or ""
        if "/zhk/" in u:
            known.add(u.split("/zhk/")[1].strip("/"))
    say("в датасете уже %d ЖК, их слага исключены: %s" % (len(known), ", ".join(sorted(known))))

    lots, groups, meta = {}, {}, {}
    for city, cslug in CITIES.items():
        got = {k: 0 for k in LISTS}
        for klass, lslug in LISTS.items():
            slugs = [s for s in list_slugs(cslug, lslug) if s not in known]
            say("%s · %s: %d новых слаго в листе" % (city, klass, len(slugs)))
            for s in slugs:
                if got[klass] >= QUOTA[klass]:
                    break
                url = "https://realty.vbr.ru/%s/novostroyki/zhk/%s/" % (cslug, s)
                raw = fetch(url, "%s_%s" % (cslug[:3], s))
                if not raw:
                    say("   пропуск %-30s — страница не загрузилась" % s)
                    continue
                d, mm, miss = parse_card(raw, url, city)
                if miss:
                    say("   пропуск %-30s — нет: %s" % (s, ", ".join(miss)))
                    continue
                cls = d["classRaw"]
                norm = "Премиум" if "премиум" in cls.lower() else ("Бизнес" if "бизнес" in cls.lower() else None)
                if norm != klass:
                    say("   пропуск %-30s — в карточке класс «%s», лист обещал «%s»" % (s, cls, klass))
                    continue
                key = "%s-%s" % ({"Сочи": "sochi", "Москва": "msk", "Екатеринбург": "ekb"}[city], s.replace("--", "-").strip("-"))
                key = re.sub(r"[^a-z0-9-]", "", key.lower())
                lots[key] = d
                groups[key] = {"asOf": d["asOf"], "groups": d["groups"], "offers": d["offers"]}
                mm["city"] = city
                mm["classNorm"] = norm
                meta[key] = mm
                got[klass] += 1
                say("   + %-30s %s · от %.2f млн · %.0f ₽/м² · %s" % (s, mm["name"], d["minLotMln"], d["ppmFrom"], d["deliveryRaw"]))
        say("%s: взято %s" % (city, got))

    RAWOUT.mkdir(parents=True, exist_ok=True)
    for fn, obj in (("zhk_lots_new.json", lots), ("zhk_groups_new.json", groups), ("zhk_meta_new.json", meta)):
        (RAWOUT / fn).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "harvest_log.txt").write_text("\n".join(LOG) + "\n", encoding="utf-8")
    say("\nновых записей: %d" % len(lots))
    say("файлы: %s" % ", ".join(p.name for p in RAWOUT.glob("zhk_*_new.json")))


if __name__ == "__main__":
    main()
