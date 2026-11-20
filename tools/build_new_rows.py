# -*- coding: utf-8 -*-
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собирает zhk_dataset_new.json — 15 новых строк в финальном формате датасета.

Каждое поле either пришло со страницы ЖК (harvest.py), либо вычислено из полей той же
страницы (district — из адреса карточки, feature — из «Параметров ЖК» и блока
«Расположение и инфраструктура»). Ничего не добавлено из головы: если поля на карточке
нет, его нет и в строке.
"""
import json
import pathlib as _pl
_HERE = _pl.Path(__file__).resolve().parent
REPO_ROOT = _HERE.parent if _HERE.name == 'tools' else _HERE

import re
import html
import pathlib

RAW = pathlib.Path("/home/user/realty-matcher-ai/data/raw")
CACHE = pathlib.Path(str(REPO_ROOT.parent / 'zhk_html2'))
PREFIX = {"Сочи": "soc", "Москва": "mos", "Екатеринбург": "eka"}


def flat(s):
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"<!--[^>]*-->", "", s)
    s = s.replace("\xa0", " ")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def page_html(meta_row, key):
    slug = meta_row["sourceUrl"].split("/zhk/")[1].strip("/")
    for pref in (PREFIX.get(meta_row["city"], ""), "sochirest", "mosrest", "ekbrest"):
        p = CACHE / ("%s_%s.html" % (pref, slug)) if pref else None
        if p and p.exists():
            return p.read_text(encoding="utf-8", errors="ignore")
    p = CACHE / (key + ".html")
    assert p.exists(), "нет сохранённой страницы для %s" % key
    return p.read_text(encoding="utf-8", errors="ignore")


HDR = re.compile(r"ЖК «[^»]+»[^Ж]{0,40}?от ([\d.,]+) млн ₽ до ([\d.,]+) млн ₽\s*"
                 r"от ([\d ,]+) ₽/м² до ([\d ,]+) ₽/м²\s*(Сдача в [^КМ]{2,40}?)(?=\s*(?:Краснодарский край|Свердловская область|Москва,|Сочи,))")


def header_line(meta_row, key):
    """Шапка карточки: «от X млн ₽ до Y млн ₽ от A ₽/м² до B ₽/м² Сдача в …» — одной строкой.

    Берём её целиком, а не «Сдача в…» по всему тексту: в теле страницы таких фраз
    несколько (по корпусам и по другим ЖК застройщика), а нужна строка самого ЖК.
    """
    t = flat(page_html(meta_row, key))
    m = HDR.search(t)
    if not m:
        return None
    return {"minLotMln": float(m.group(1).replace(",", ".")), "maxLotMln": float(m.group(2).replace(",", ".")),
            "ppmFrom": int(re.sub(r"\D", "", m.group(3))), "ppmTo": int(re.sub(r"\D", "", m.group(4))),
            "delivery": re.sub(r"\s+", " ", m.group(5)).strip(" ,")}
lots = json.loads((RAW / "zhk_lots_new.json").read_text(encoding="utf-8"))
groups = json.loads((RAW / "zhk_groups_new.json").read_text(encoding="utf-8"))
meta = json.loads((RAW / "zhk_meta_new.json").read_text(encoding="utf-8"))
CLASS_MAP = {"Бизнес премиум": "Премиум", "Бизнес": "Бизнес", "бизнес": "Бизнес", "эконом": "Комфорт"}


def parse_years(text):
    ys = [int(y) for y in re.findall(r"(20\d{2})", text or "")]
    return (min(ys), max(ys)) if ys else (None, None)


def pretty(v):
    return None if v is None else round(v, 2)


rows = []
for key, d in lots.items():
    m = meta[key]
    g = groups[key]
    grp = g["groups"]
    min_area = min([x["minAreaM2"] for x in grp if x.get("minAreaM2")], default=None)
    hdr = header_line(m, key)
    # шапка карточки — более прямой источник, чем разбор по кускам: проверяем, что цифры
    # из неё совпали с распарсенными, и берём срок сдачи из неё (с уточнением «сдан/строится»)
    if hdr:
        for f_ in ("minLotMln", "maxLotMln", "ppmFrom", "ppmTo"):
            if hdr[f_] is not None and d.get(f_) is not None:
                assert abs(float(hdr[f_]) - float(d[f_])) < (0.011 if "Mln" in f_ else 1.0), \
                    "%s: %s — в шапке %s, распарсилось %s" % (key, f_, hdr[f_], d[f_])
        d["deliveryRaw"] = hdr["delivery"]
    deadline = (d.get("deliveryRaw") or d.get("statusRaw") or "").strip(" ,")
    y_from, y_to = parse_years(deadline or d.get("statusRaw"))
    cls_src = d.get("classRaw")
    assert CLASS_MAP.get((cls_src or "").strip(), "Бизнес") == m["classNorm"], (key, cls_src, m["classNorm"])
    rows.append({
        "id": key, "city": m["city"], "name": m["name"], "developer": m["developer"],
        "district": m["district"], "zhkClass": m["classNorm"], "classSource": cls_src,
        "pricePerM2": d["ppmFrom"], "pricePerM2Max": d["ppmTo"], "pricePerM2Avg": d.get("avgPerM2"),
        "minLotMln": pretty(d["minLotMln"]), "maxLotMln": pretty(d.get("maxLotMln")),
        "minAreaM2": min_area, "offers": d.get("offers"),
        "delivery": deadline, "deliveryYearFrom": y_from, "deliveryYearTo": y_to,
        "lots": [{k: v for k, v in x.items() if v is not None} for x in grp],
        "feature": m["feature"], "imgKey": key,
        "sourceName": m["sourceName"], "sourceUrl": m["sourceUrl"],
        "priceAsOf": g.get("asOf") or d.get("asOf"),
        "sourceTitle": d.get("h1"),
    })

hdr_ok = sum(1 for key in lots if header_line(meta[key], key))
print("шапка карточки найдена и сошлась с парсером: %d из %d" % (hdr_ok, len(lots)))

need = ("city", "name", "developer", "district", "zhkClass", "pricePerM2", "minLotMln", "delivery", "lots", "feature")
for r in rows:
    bad = [k for k in need if r.get(k) in (None, "", [])]
    assert not bad, "%s: пусто %s" % (r["id"], bad)

rows.sort(key=lambda r: (r["city"], r["pricePerM2"]))
(RAW / "zhk_dataset_new.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
print("готово строк:", len(rows))
for c in ("Сочи", "Москва", "Екатеринбург"):
    sub = [r for r in rows if r["city"] == c]
    print("  %-13s %d · классы %s · ₽/м² %s" % (c, len(sub), sorted({r["zhkClass"] for r in sub}),
          [int(r["pricePerM2"]) for r in sub]))
print("\n%-38s %-9s %10s %8s %8s %6s %s" % ("ЖК", "класс", "от ₽/м²", "мин лот", "макс лот", "лотов", "сдача"))
for r in rows:
    print("%-38s %-9s %10s %8s %8s %6s %s" % (r["name"][:36], r["zhkClass"], f"{int(r['pricePerM2']):,}".replace(",", " "),
          r["minLotMln"], r["maxLotMln"], r["offers"], r["delivery"]))
print("\nснимок цен:", sorted({str(r["priceAsOf"])[:10] for r in rows}))
