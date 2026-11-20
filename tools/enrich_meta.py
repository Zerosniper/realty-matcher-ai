# -*- coding: utf-8 -*-
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Доводит выгруженные карточки до вида, который ждёт v3_data.py.

Для каждого нового ЖК берёт с той же страницы:
  name/developer  — из <title> карточки;
  district        — адрес карточки (без региона и повтора города) + ближайшая станция
                    метро с временем, если карточка её печатает;
  feature         — только поля карточки: «Параметры ЖК» и блок «Расположение и
                    инфраструктура» (что перечислено у застройщика на объекте).
Никаких формулировок «от себя»: всё словами источника.
"""
import json
import pathlib as _pl
_HERE = _pl.Path(__file__).resolve().parent
REPO_ROOT = _HERE.parent if _HERE.name == 'tools' else _HERE

import re
import html
import pathlib

ROOT = pathlib.Path(str(REPO_ROOT.parent))
RAW = ROOT / "realty-matcher-ai" / "data" / "raw"
CACHE = ROOT / "zhk_html2"
PREFIX = {"Сочи": "soc", "Москва": "mos", "Екатеринбург": "eka"}


def flat(s):
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"<!--[^>]*-->", "", s)
    s = s.replace("\xa0", " ")
    s = html.unescape(s)
    s = re.sub(r"\|+", " | ", s)
    return re.sub(r"\s+", " ", s).strip(" |")


def find_html(mm, key):
    slug = mm["sourceUrl"].split("/zhk/")[1].strip("/")
    for pref in (PREFIX.get(mm["city"], ""), "sochirest", "mosrest", "ekbrest"):
        p = CACHE / ("%s_%s.html" % (pref, slug)) if pref else None
        if p and p.exists():
            return p
    p = CACHE / (key + ".html")
    assert p.exists(), "нет сохранённой страницы для %s" % key
    return p


def station_of(raw):
    """Ближайшая станция и время — как напечатано в модуле метро карточки."""
    m = re.search(r'metro-station-module__[\w-]+__name">([^<]{2,50})</span>'
                  r'<span class="metro-station-module__[\w-]+__comment">([^<]{2,40})<', raw)
    if not m:
        return None
    name, comment = flat(m.group(1)), flat(m.group(2))
    mode = "пешком" if "пешком" in comment.lower() else "транспортом"
    mins = re.search(r"\d+", comment)
    return "м. %s, %s мин %s" % (name, mins.group() if mins else "?", mode)


def nearby_of(raw):
    names = [flat(x) for x in re.findall(r'nearby-item-module__[\w-]+__name">([^<]{2,60})<', raw)]
    return list(dict.fromkeys([n for n in names if n]))


def params_of(raw):
    out = {}
    for lab, val in re.findall(r'new-house-params-module__[\w-]+__property">([^<]{2,40})</div>'
                               r'<div class="new-house-params-module__[\w-]+__value">((?:(?!</div>).){1,160}?)</div>', raw, re.S):
        v = flat(re.sub(r"<!--[^>]*-->", " ", val))
        if v and v not in ("—", "-"):
            out.setdefault(flat(lab), v)
    return out


def district_of(mm, raw):
    a = mm.get("address") or ""
    for d in ("Краснодарский край, ", "Свердловская область, ", "Россия, "):
        a = a.replace(d, "")
    a = re.sub(r"^%s,\s*" % re.escape(mm["city"]), "", a)
    a = a.strip(" ,.")
    st = station_of(raw)
    if st and "метро" not in a.lower():
        a = "%s (%s)" % (a, st) if a else st
    return a or None


def feature_of(params, nearby):
    bits = []
    v = params.get("Этажность")
    if v:
        bits.append("этажность %s" % v.lower())
    k = params.get("Количество корпусов")
    if k:
        bits.append("корпусов %s" % k)
    t = params.get("Тип дома")
    if t:
        bits.append("дом %s" % t.lower())
    o = params.get("Варианты отделки")
    if o:
        bits.append("отделка: %s" % o.lower())
    if nearby:
        keep = [n for n in nearby if n not in ("Коммерческие объекты", "Офисы")][:4]
        if keep:
            bits.append("на территории: " + ", ".join(x.lower() for x in keep))
    return ", ".join(bits) or None


def main():
    lots = json.loads((RAW / "zhk_lots_new.json").read_text(encoding="utf-8"))
    meta = json.loads((RAW / "zhk_meta_new.json").read_text(encoding="utf-8"))
    out = {}
    for key, mm in meta.items():
        raw = find_html(mm, key).read_text(encoding="utf-8", errors="ignore")
        params = params_of(raw)
        nearby = nearby_of(raw)
        name, dev = mm.get("name"), mm.get("developer")
        if not name:
            t = re.search(r"<title>(.*?)</title>", raw, re.S)
            title = flat(t.group(1)) if t else ""
            nm = re.search(r"«(.+?)»", title)
            name = "ЖК «%s»" % nm.group(1) if nm else None
            dv = re.search(r"от застройщика\s+(.+?)\s+в\s+[^—]{2,40}—", title)
            dev = dv.group(1).strip() if dv else None
        d = {
            "city": mm["city"], "name": name, "developer": dev,
            "district": district_of(mm, raw),
            "feature": feature_of(params, nearby),
            "classNorm": mm["classNorm"], "address": mm.get("address"),
            "params": params, "nearby": nearby,
            "sourceName": mm["sourceName"], "sourceUrl": mm["sourceUrl"],
            "asOfPrinted": lots[key].get("asOf"),
        }
        assert d["name"] and d["developer"] and d["district"] and d["feature"], "пустое поле в %s" % key
        out[key] = d
        print("%-40s %s" % (key, d["name"]))
        print("     район:   %s" % d["district"])
        print("     особен.:  %s" % d["feature"])
        print("     параметр: %s" % json.dumps(params, ensure_ascii=False)[:170])
    (RAW / "zhk_meta_new.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\nзаписей в zhk_meta_new.json:", len(out))


main()
