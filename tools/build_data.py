#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v3 data pipeline — ЕДИНЫЙ ИСТОЧНИК ИСТИНЫ.

Вход:  zhk_lots.json + zhk_groups.json (снято скриптом extract_zhk.py / extract_groups.py
       со страниц realty.vbr.ru 16.11.2026) + ручная карточка ЖК «Клевер парк» (m2.ru)
Выход: realty-matcher-ai/data/zhk.json      — источник истины
       realty-matcher-ai/app/data.js         — то же, для <script> (работает по file://)
       realty-matcher-ai/zhk_dataset_15.csv  — для Google Sheets / отчёта
       realty-matcher-ai/zhk_dataset_15.xlsx — лист «Данные» + лист «Лоты»
       realty-matcher-ai/data/checks.json    — самопроверка данных (для README/отчёта)
"""
import json, re, csv, pathlib

# Пути от расположения скрипта: в репозитории копия лежит в tools/ и берёт корень репозитория.
_HERE = pathlib.Path(__file__).resolve().parent
REPO = _HERE.parent if _HERE.name == "tools" else _HERE / "realty-matcher-ai"
ROOT = _HERE if _HERE.name != "tools" else REPO
RAW = REPO / "data" / "raw"          # снятые с источников лоты (в мастер-копии — рядом со скриптом)


def _raw(name):
    for cand in (REPO / "data" / "raw" / name, ROOT / name):
        if cand.exists():
            return cand
    raise SystemExit(f"Нет файла {name}: положите его в data/raw/ (или рядом со скриптом)")

META = {
    # imgKey: (file_id, city, name, developer, district, feature, sourceName, sourceUrl)
    "sochi-polyana-pik": ("sochi-polyana", "Сочи", "ЖК «Поляна Пик»", "PARADE Development",
        "Адлерский р-н, Красная Поляна", "Горный курорт у подножия Роза Пик, SPA и бассейн",
        "realty.vbr.ru", "https://realty.vbr.ru/sochi/novostroyki/zhk/polyana-pik/"),
    "sochi-neskuchny-sad": ("sochi-neskuchny", "Сочи", "ГК «Нескучный сад»", "Неометрия",
        "Адлерский р-н, Курортный Городок", "Курортная зона в 900 м от моря, закрытый двор",
        "realty.vbr.ru", "https://realty.vbr.ru/sochi/novostroyki/zhk/gostinicnii-kompleks-neskycnii-sad/"),
    "sochi-belye-nochi": ("sochi-belye-noci", "Сочи", "ЖК «Белые Ночи»", "PARADE Development",
        "Лазаревский р-н, мкр Уч-Дере", "Субтропический парк на первой линии у моря",
        "realty.vbr.ru", "https://realty.vbr.ru/sochi/novostroyki/zhk/belie-noci-6/"),
    "sochi-svetsky-les": ("sochi-svetsky", "Сочи", "ЖК «Светский лес»", "ГК ТОЧНО",
        "Центральный р-н, ул. Краснодонская", "Набережная реки Сочи и лесопарк вокруг квартала",
        "realty.vbr.ru", "https://realty.vbr.ru/sochi/novostroyki/zhk/svetskii-les/"),
    "sochi-kislorod": ("sochi-kislorod", "Сочи", "ЖК «Кислород»", "AVA Group",
        "Хостинский р-н, склон мкр Бытха", "Своя школа и детский сад, панорама на море",
        "realty.vbr.ru", "https://realty.vbr.ru/sochi/novostroyki/zhk/kislorod-3/"),
    "msk-clos-17": ("msk-clos17", "Москва", "ЖК «Clos 17»", "MR Group",
        "ЦАО, Арбат (1 мин. до м. Арбатская)", "Камерный клубный особняк: 4 лота в продаже",
        "realty.vbr.ru", "https://realty.vbr.ru/moskva/novostroyki/zhk/clos-17--klo-17-/"),
    "msk-chistye-prudy": ("msk-chistye", "Москва", "ЖК «Чистые Пруды»", "Sminex",
        "ЦАО, Басманный (Потаповский пер.)", "Исторический клубный дом с приватным двором",
        "realty.vbr.ru", "https://realty.vbr.ru/moskva/novostroyki/zhk/cistie-prydi-1/"),
    "msk-plekhanova-11": ("msk-plehanova", "Москва", "ЖК «Плеханова 11»", "ПИК",
        "ВАО, Перово (3 мин. до м. Перово)", "Чистовая отделка «заезжай и живи», рядом Кусковский парк",
        "realty.vbr.ru", "https://realty.vbr.ru/moskva/novostroyki/zhk/plehanova-11/"),
    "msk-trilogiya-crystal": ("msk-trilogiya", "Москва", "ЖК «Трилогия CRYSTAL»", "Концерн КРОСТ",
        "СЗАО, Хорошёво-Мнёвники", "Башни с двором-парком без машин, рядом Москва-река",
        "realty.vbr.ru", "https://realty.vbr.ru/moskva/novostroyki/zhk/crystal-trilogiya--kristall-trilogiya-/"),
    "msk-admiral": ("msk-admiral", "Москва", "ЖК «Адмирал»", "Галс-Девелопмент",
        "ЮВАО, Печатники (3 мин. до метро)", "Квартал у Южного речного вокзала, 84 лота в выборе",
        "realty.vbr.ru", "https://realty.vbr.ru/moskva/novostroyki/zhk/admiral-21/"),
    "ekb-literaturny": ("ekb-literaturny", "Екатеринбург", "ЖК «Клубный дом Литературный»", "ДК Север",
        "Кировский р-н, Центр (ул. Первомайская)", "Малоэтажный клубный дом в тихом центре, 12 лотов",
        "realty.vbr.ru", "https://realty.vbr.ru/ekaterinburg/novostroyki/zhk/po-yl-pervomaiskaya-1/"),
    "ekb-dom-7": ("ekb-dom7", "Екатеринбург", "ЖК «DOM 7»", "Компания Практика",
        "Верх-Исетский р-н, ВИЗ (2 мин. до м. Динамо)", "Видовая башня рядом с набережной Исети",
        "realty.vbr.ru", "https://realty.vbr.ru/ekaterinburg/novostroyki/zhk/dom-7--dom-7-/"),
    "ekb-klever-park": ("ekb-klever", "Екатеринбург", "ЖК «Клевер парк»", "Acons Group",
        "Октябрьский р-н, Парковый (у ЦПКиО)", "Своя набережная Исети и прямой выход в парк",
        "m2.ru", "https://m2.ru/yekaterinburg/novostroyki/zhk-klever-park-3216/"),
    "ekb-nagorny": ("ekb-nagorniy", "Екатеринбург", "ЖК «Нагорный»", "УГМК-Застройщик",
        "Верх-Исетский р-н, ВИЗ-Правобережный", "Флагманский квартал рядом с пл. 1905 года",
        "realty.vbr.ru", "https://realty.vbr.ru/ekaterinburg/novostroyki/zhk/nagornii-1/"),
    "ekb-park-stolic": ("ekb-park-stolic", "Екатеринбург", "ЖК «Парк Столиц»", "Атлас Девелопмент",
        "Чкаловский р-н, Автовокзал (м. Чкаловская)", "Жилая экосистема с приватным парком и галереей",
        "realty.vbr.ru", "https://realty.vbr.ru/ekaterinburg/novostroyki/zhk/park-stolic/"),
}

# ЖК «Клевер парк» — источник m2.ru (структура страницы другая, данные внесены вручную со страницы)
KLEVER = {
    "minLotMln": 8.8, "maxLotMln": 32.0, "ppmFrom": 232197,
    # верхняя граница ₽/м² рассчитана автором из лота источника: 32,0 млн / 94,2 м²
    "ppmTo": 339700, "ppmToDerived": True, "ppmAvg": None,
    "classSource": "бизнес", "statusRaw": "Строится до 3 кв. 2027 г.", "unitsTotal": None,
    "offers": None, "asOf": "16.11.2026",
    "groups": [
        {"type": "Студии",      "minAreaM2": 28.2, "fromMln": 8.8,  "toMln": 10.8},
        {"type": "1-комнатные", "minAreaM2": 49.3, "fromMln": 12.9, "toMln": 17.0},
        {"type": "2-комнатные", "minAreaM2": 60.3, "fromMln": 15.8, "toMln": 24.7},
        {"type": "3-комнатные", "minAreaM2": 94.2, "fromMln": 23.0, "toMln": 32.0},
    ],
}

CLASS_MAP = {"Бизнес премиум": "Премиум", "Бизнес": "Бизнес", "бизнес": "Бизнес", "эконом": "Комфорт"}


def parse_years(text):
    ys = [int(y) for y in re.findall(r"(20\d{2})", text or "")]
    if not ys:
        return None, None
    return min(ys), max(ys)


def pretty_mln(v):
    return None if v is None else round(v, 2)


def build():
    lots = json.loads(_raw("zhk_lots.json").read_text(encoding="utf-8"))
    groups = json.loads(_raw("zhk_groups.json").read_text(encoding="utf-8"))
    rows = []
    for img_key, (fid, city, name, dev, district, feature, src_name, src_url) in META.items():
        if fid == "ekb-klever":
            d = dict(KLEVER)
            d["h1"] = "ЖК «Клевер парк» (m2.ru)"
        else:
            d = dict(lots[fid])
            d["asOf"] = groups.get(fid, {}).get("asOf") or "15.11.2026"
            d["groups"] = groups.get(fid, {}).get("groups") or []
        deadline_src = (d.get("deliveryRaw") or d.get("statusRaw") or "").strip(" ,")
        y_from, y_to = parse_years(deadline_src or d.get("statusRaw"))
        class_src = d.get("classRaw") or d.get("classSource")
        cls = CLASS_MAP.get((class_src or "").strip(), "Бизнес")
        min_area = min([g["minAreaM2"] for g in d["groups"] if g.get("minAreaM2")], default=None)
        rows.append({
            "id": img_key, "city": city, "name": name, "developer": dev, "district": district,
            "zhkClass": cls, "classSource": class_src,
            "pricePerM2": d["ppmFrom"], "pricePerM2Max": d["ppmTo"],
            "pricePerM2Avg": d.get("avgPerM2") or (d.get("avg") or {}).get("Средняя цена за м²"),
            "minLotMln": pretty_mln(d["minLotMln"]), "maxLotMln": pretty_mln(d["maxLotMln"]),
            "minAreaM2": min_area, "offers": d.get("offers"),
            "delivery": deadline_src, "deliveryYearFrom": y_from, "deliveryYearTo": y_to,
            "lots": [{k: v for k, v in g.items() if v is not None} for g in d["groups"]],
            "feature": feature, "imgKey": img_key,
            "sourceName": src_name, "sourceUrl": src_url, "priceAsOf": d.get("asOf"),
            "sourceTitle": d.get("h1"),
        })

    order = {c: i for i, c in enumerate(["Сочи", "Москва", "Екатеринбург"])}
    rows.sort(key=lambda r: (order[r["city"]], r["pricePerM2"]))
    for i, r in enumerate(rows, 1):
        r["n"] = i

    # ---- самопроверка: 15 строк, класс из источника, мин. лот / мин. площадь = фактическая цена входа за м²
    checks = {"rows": len(rows), "cities": {c: sum(1 for r in rows if r["city"] == c) for c in order},
              "classFromSource": sum(1 for r in rows if r["classSource"]),
              "classMatchesSource": sum(1 for r in rows if r["classSource"] and CLASS_MAP.get(r["classSource"].strip(), "?") == r["zhkClass"]),
              "withMinLotPrice": sum(1 for r in rows if r["minLotMln"]),
              "withLots": sum(1 for r in rows if r["lots"]),
              "maxImpliedPpm": None}
    worst = 0
    for r in rows:
        if r["minLotMln"] and r["minAreaM2"]:
            implied = r["minLotMln"] * 1e6 / r["minAreaM2"]
            r["minLotImpliedPpm"] = round(implied)
            worst = max(worst, implied / r["pricePerM2"] - 1)
    checks["maxImpliedPpm"] = round(worst, 3)
    checks["cityPrice"] = {}
    for c in order:
        ppms = sorted(r["pricePerM2"] for r in rows if r["city"] == c)
        checks["cityPrice"][c] = {"min": ppms[0], "max": ppms[-1], "avg": round(sum(ppms) / len(ppms))}
    biz = {c: [r["pricePerM2"] for r in rows if r["city"] == c and r["zhkClass"] == "Бизнес"] for c in order}
    prem = {c: [r["pricePerM2"] for r in rows if r["city"] == c and r["zhkClass"] == "Премиум"] for c in order}
    checks["businessAvg"] = {c: round(sum(v) / len(v)) for c, v in biz.items() if v}
    checks["premiumAvg"] = {c: round(sum(v) / len(v)) for c, v in prem.items() if v}
    sochi_biz_ex = [r["pricePerM2"] for r in rows if r["city"] == "Сочи" and r["zhkClass"] == "Бизнес" and r["id"] != "sochi-belye-nochi"]
    checks["sochiBusinessAvg_exBelyeNoci"] = round(sum(sochi_biz_ex) / len(sochi_biz_ex))

    (REPO / "data").mkdir(parents=True, exist_ok=True)
    (REPO / "data" / "zhk.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    (REPO / "data" / "checks.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding="utf-8")
    (REPO / "app").mkdir(parents=True, exist_ok=True)
    (REPO / "app" / "data.js").write_text(
        "// Сгенерировано из data/zhk.json скриптом tools/build_data.py — вручную не править.\n"
        "window.ZHK_DATA = " + json.dumps(rows, ensure_ascii=False) + ";\n"
        "window.ZHK_META = " + json.dumps({"builtAt": "2026-11-16", "priceAsOf": "15-16.11.2026",
                                           "sources": ["realty.vbr.ru", "m2.ru"]}, ensure_ascii=False) + ";\n",
        encoding="utf-8")

    with (REPO / "zhk_dataset_15.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["№", "Город", "ЖК", "Застройщик", "Район / локация", "Класс (источник)", "Класс (наш)",
                    "Цена от, ₽/м²", "Цена до, ₽/м²", "Средняя ₽/м²", "Мин. лот, млн ₽", "Макс. лот, млн ₽",
                    "Мин. площадь лота, м²", "Лотов в продаже", "Срок сдачи", "Дата фиксации цены",
                    "Источник", "URL"])
        for r in rows:
            w.writerow([r["n"], r["city"], r["name"], r["developer"], r["district"], r["classSource"], r["zhkClass"],
                        r["pricePerM2"], r["pricePerM2Max"], r["pricePerM2Avg"] or "", r["minLotMln"], r["maxLotMln"],
                        r["minAreaM2"] or "", r["offers"] or "", r["delivery"], r["priceAsOf"], r["sourceName"], r["sourceUrl"]])

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        wb = Workbook(); ws = wb.active; ws.title = "Данные 15 ЖК"
        hdr = ["№", "Город", "ЖК", "Застройщик", "Район", "Класс (источник)", "Класс (наш)", "от ₽/м²", "до ₽/м²",
               "средняя ₽/м²", "мин. лот, млн ₽", "макс. лот, млн ₽", "мин. площадь, м²", "лотов", "срок сдачи",
               "дата фиксации", "источник", "ссылка"]
        ws.append(hdr)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1F3A63")
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        for r in rows:
            ws.append([r["n"], r["city"], r["name"], r["developer"], r["district"], r["classSource"], r["zhkClass"],
                       r["pricePerM2"], r["pricePerM2Max"], r["pricePerM2Avg"], r["minLotMln"], r["maxLotMln"],
                       r["minAreaM2"], r["offers"], r["delivery"], r["priceAsOf"], r["sourceName"], r["sourceUrl"]])
        ws2 = wb.create_sheet("Лоты по площадкам")
        ws2.append(["Город", "ЖК", "Тип лота", "мин. площадь, м²", "от, млн ₽", "до, млн ₽", "₽/м² в мин. лоте"])
        for c in ws2[1]:
            c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="2A5285")
        for r in rows:
            for g in r["lots"]:
                ppm = round(g["fromMln"] * 1e6 / g["minAreaM2"]) if g.get("minAreaM2") else None
                ws2.append([r["city"], r["name"], g["type"], g.get("minAreaM2"), g.get("fromMln"), g.get("toMln"), ppm])
        for sh in (ws, ws2):
            for col, wdt in zip("ABCDEFGHIJKLMNOPQR", [5, 13, 30, 20, 34, 16, 12, 12, 12, 13, 14, 14, 12, 8, 22, 18, 14, 40]):
                sh.column_dimensions[col].width = wdt
            sh.freeze_panes = "A2"
        wb.save(REPO / "zhk_dataset_15.xlsx")
        print("xlsx: ok")
    except Exception as e:
        print("xlsx skipped:", repr(e)[:80])

    print(json.dumps(checks, ensure_ascii=False, indent=1))
    return rows


if __name__ == "__main__":
    rows = build()
    print("rows:", len(rows))
    for r in rows[:2]:
        print(r["name"], r["minLotMln"], r["minAreaM2"], r["classSource"], r["lots"][:1])
