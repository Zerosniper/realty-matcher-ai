# -*- coding: utf-8 -*-
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Добор десятого ЖК Сочи + обогащение meta + сверка цифр с напечатанным текстом карточки.

1) добавляет в *_new.json недостающий десятый ЖК Сочи (берётся из отчёта harvest_sochi_rest,
   где карточка уже проверена на полноту данных);
2) вычищает из блока «Параметры ЖК» пары метка/значение — только то, что напечатано;
   из них же собираются district (адрес карточки минус регион/город) и feature;
3) сверяет каждое распарсенное число с текстом страницы и пишет
   realty-matcher-ai/data/raw/verify_new.txt.
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


def clean(s):
    s = re.sub(r"<[^>]+>", "|", s)
    s = re.sub(r"<!--[^>]*-->", "", s)
    s = s.replace("\xa0", " ")
    s = html.unescape(s)
    s = re.sub(r"\|+", " | ", s)
    return re.sub(r"\s+", " ", s).strip(" |")


def flat(s):
    return re.sub(r"\s+", " ", clean(s).replace("|", " ")).strip()


def params_of(raw):
    """Пары метка/значение из модуля «Параметры ЖК» — ровно то, что напечатано на карточке."""
    out = {}
    for lab, val in re.findall(r'new-house-params-module__[\w-]+__property">([^<]{2,40})</div>'
                               r'<div class="new-house-params-module__[\w-]+__value">((?:(?!</div>).){1,160}?)</div>', raw, re.S):
        v = flat(re.sub(r"<!--[^>]*-->", " ", val))
        if v and v not in ("—", "-"):
            out.setdefault(clean(lab), v)
    return out


def slug_of(url):
    return url.split("/zhk/")[1].strip("/")


def district_from(address, city):
    """Район/локация — из адреса карточки: убираем регион и название города."""
    if not address:
        return None
    a = address
    for d in ("Краснодарский край, ", "Свердловская область, ", "Россия, "):
        a = a.replace(d, "")
    a = re.sub(r"^%s,\s*" % re.escape(city), "", a)
    return a.strip(" ,.") or None


def feature_from(params, extra):
    """Строка «Особенность» — только из полей карточки, без домыслов."""
    bits = []
    mapping = {"Этажность": "этажность", "Количество корпусов": "корпусов", "Тип дома": "дом",
               "Варианты отделки": "отделка", "Высота потолков": "потолки"}
    for lab, pre in mapping.items():
        v = (params.get(lab) or "").strip()
        if v and v not in ("—", "-"):
            bits.append("%s %s" % (pre, v.lower().rstrip(".")))
    if extra.get("площадь"):
        bits.append("лоты %s" % extra["площадь"])
    return ", ".join(bits) or None


def main():
    lots = json.loads((RAW / "zhk_lots_new.json").read_text(encoding="utf-8"))
    groups = json.loads((RAW / "zhk_groups_new.json").read_text(encoding="utf-8"))
    meta = json.loads((RAW / "zhk_meta_new.json").read_text(encoding="utf-8"))

    # ---- 1) десятый ЖК Сочи ----------------------------------------------------
    per_city = {}
    for k, m in meta.items():
        per_city[m["city"]] = per_city.get(m["city"], 0) + 1
    used_urls = {m["sourceUrl"] for m in meta.values()}
    if per_city.get("Сочи", 0) < 5:
        for e in json.loads((ROOT / "harvest_sochi_rest.json").read_text(encoding="utf-8")):
            url = "https://realty.vbr.ru/sochi/novostroyki/zhk/%s/" % e["slug"]
            if url in used_urls:
                continue
            key = "sochi-" + re.sub(r"[^a-z0-9-]", "", slug_of(url).replace("--", "-").strip("-"))
            d = {k: v for k, v in e["lots"].items()}
            lots[key] = d
            groups[key] = {"asOf": d.get("asOf"), "groups": d["groups"], "offers": d.get("offers")}
            meta[key] = {"name": None, "developer": None, "address": None,
                         "classFromCard": d.get("classRaw"), "sourceUrl": url, "sourceName": "realty.vbr.ru",
                         "featureParts": {}, "minLotMln": d.get("minLotMln"), "ppmFrom": d.get("ppmFrom"),
                         "city": "Сочи", "classNorm": e["class"], "_cache": "sochirest_" + slug_of(url)}
            print("добран десятый Сочи:", key, "·", e["class"], "· от", d.get("minLotMln"), "млн")
            break
    else:
        print("Сочи уже набран (%s), добор не нужен" % per_city.get("Сочи"))

    # ---- 2) и 3) -------------------------------------------------------------
    lines, ok = [], 0
    for key in lots:
        mm = meta[key]
        slug = slug_of(mm["sourceUrl"])
        cand = [mm.pop("_cache", None)] + ["%s_%s" % (p, slug) for p in (PREFIX[mm["city"]], "sochirest", "mosrest", "ekbrest")]
        f = next((CACHE / (c + ".html") for c in cand if c and (CACHE / (c + ".html")).exists()), None)
        assert f, "нет сохранённой страницы для %s (пробовали: %s)" % (key, ", ".join(x for x in cand if x))
        raw = f.read_text(encoding="utf-8", errors="ignore")
        txt = flat(raw)
        d = lots[key]
        if not mm.get("name"):                      # доборанная карточка: название/застройщик из <title>
            t = re.search(r"<title>(.*?)</title>", raw, re.S)
            title = flat(t.group(1)) if t else ""
            nm = re.search(r"«(.+?)»", title)
            mm["name"] = "ЖК «%s»" % nm.group(1) if nm else None
            dev = re.search(r"от застройщика\s+(.+?)\s+в\s+[^—]{2,40}—", title)
            mm["developer"] = dev.group(1).strip() if dev else None
            esc = ld_escape(raw)
            cands = [c.strip() for c in re.findall(r'"(?:streetAddress|address)":\s*"([^"]{4,150})"', esc)]
            mm["address"] = next((c for c in cands if "сочи" in c.lower() and "офис" not in c.lower()), None)
        params = params_of(raw)
        mm["params"] = params
        mm["district"] = district_from(mm.get("address"), mm["city"])
        mm["feature"] = feature_from(params, mm.get("featureParts") or {})

        printed_ppm = {re.sub(r"\D", "", m) for m in re.findall(r"([\d][\d ]{5,12})\s*₽/м²", txt)}
        printed_mln = {float(x.replace(",", ".")) for x in re.findall(r"(\d+(?:[.,]\d{1,2})?)\s*млн", txt)}
        checks = [("₽/м² от", d["ppmFrom"], str(int(d["ppmFrom"])) in printed_ppm),
                  ("мин. лот", d["minLotMln"], any(abs(x - d["minLotMln"]) < 0.011 for x in printed_mln)),
                  ("лотов", d["offers"], str(d["offers"]) in re.findall(r"Доступно\s*(\d+)", txt)),
                  ("класс", d["classRaw"], bool(d["classRaw"] and d["classRaw"] in txt))]
        if d.get("ppmTo"):
            checks.append(("₽/м² до", d["ppmTo"], str(int(d["ppmTo"])) in printed_ppm))
        if d.get("maxLotMln"):
            checks.append(("макс. лот", d["maxLotMln"], any(abs(x - d["maxLotMln"]) < 0.011 for x in printed_mln)))
        bad = [c for c in checks if c[2] is False]
        ok += not bad
        lines.append("%-40s %s  %s" % (key, "OK " if not bad else "СПОРНО",
                     " · ".join("%s=%s%s" % (n, v, "" if g else " (нет в тексте)") for n, v, g in checks)))

    print("\n".join(lines))
    print("сверка совпала: %d из %d" % (ok, len(lots)))
    for fn, obj in (("zhk_lots_new.json", lots), ("zhk_groups_new.json", groups), ("zhk_meta_new.json", meta)):
        (RAW / fn).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    (RAW / "verify_new.txt").write_text("\n".join(lines) + "\n\nсовпало: %d из %d карточек\n" % (ok, len(lots)),
                                        encoding="utf-8")
    print("файлы обновлены:", len(lots))


main()
