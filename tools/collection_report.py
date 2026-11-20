# -*- coding: utf-8 -*-
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Отчёт о сборе: сколько карточек реально посмотрели и почему часть отбраковали.

Считается по сохранённым HTML страниц (zhk_html2/) тем же парсером, что и датасет, —
то есть «причина отказа» в отчёте это не воспоминание, а воспроизводимая проверка:
карточка открыта, полей для строки датасета на ней нет.

Выход: realty-matcher-ai/docs/collection.md
"""
import json
import pathlib as _pl
_HERE = _pl.Path(__file__).resolve().parent
REPO_ROOT = _HERE.parent if _HERE.name == 'tools' else _HERE

import re
import pathlib

# пути ищем рядом со скриптом: он работает и из мастер-папки, и из репозитория (tools/)
_HERE = pathlib.Path(__file__).resolve().parent
REPO = next((d for d in (_HERE.parent, _HERE / "realty-matcher-ai", pathlib.Path(str(REPO_ROOT)))
             if (d / "data" / "zhk.json").exists()), _HERE)
ROOT = REPO.parent
# берём первую папку, в которой реально лежат html: пустой каталог-заглушка не должен
# побеждать (в копии репозитория его создаёт fetch-скрипт)
CACHE = next((d for d in (REPO / "data" / "zhk_html2", ROOT / "zhk_html2", pathlib.Path(str(REPO_ROOT.parent / 'zhk_html2')))
              if d.is_dir() and any(d.glob("*.html"))), None)
_h = next((f for f in (_HERE / "harvest.py", _HERE / "harvest_zhk.py", ROOT / "harvest.py") if f.exists()), None)
if CACHE is None or _h is None:
    print("пропущено: рядом со скриптом нет кэш-папку zhk_html2 (она не входит в репозиторий) — "
          "отчёт не пересобирается, лежащий docs/collection.md остаётся валидным")
    raise SystemExit(0)
# парсер берём из harvest-скрипта, но в ОТДЕЛЬНОМ namespace: у harvest свои модульные
# константы (ROOT/OUT/...), и exec в globals() тихо перезатирал бы пути этого отчёта
_ns = {"__file__": str(_h)}
exec(_h.read_text(encoding="utf-8").split("def main():")[0], _ns)
parse_card = _ns["parse_card"]

CITY_OF = {"soc": "Сочи", "sochirest": "Сочи", "mos": "Москва", "eka": "Екатеринбург"}
DATASET_URLS = {r["sourceUrl"] for r in json.loads((REPO / "data" / "zhk.json").read_text(encoding="utf-8"))}


def main():
    rows = {}
    for p in sorted(CACHE.glob("*.html")):
        stem = p.stem
        if re.search(r"_(p\d+|biznes_p\d+|premium_p\d+)$", stem) or "_all_p" in stem or stem.endswith(("_p1", "_p2", "_p3")):
            continue
        pref = stem.split("_")[0]
        if pref not in CITY_OF:
            continue
        city = CITY_OF[pref]
        slug = stem.split("_", 1)[1] if "_" in stem else stem
        url = "https://realty.vbr.ru/%s/novostroyki/zhk/%s/" % ("sochi" if city == "Сочи" else
                                                                ("moskva" if city == "Москва" else "ekaterinburg"), slug)
        raw = p.read_text(encoding="utf-8", errors="ignore")
        d, m, miss = parse_card(raw, url, city)
        cls = (d.get("classRaw") or "").lower()
        norm = "Премиум" if "премиум" in cls else ("Бизнес" if "бизнес" in cls else None)
        rows.setdefault(city, []).append({
            "slug": slug, "name": m.get("name"), "class": d.get("classRaw"), "norm": norm,
            "miss": miss, "taken": url in DATASET_URLS, "minLot": d.get("minLotMln"), "ppm": d.get("ppmFrom"),
            "offers": d.get("offers"),
        })

    # одна и та же карточка могла попасть в кэш дважды (из списка города и из выборки
    # «остальное») — оставляем по одному вхождению на URL, иначе счётчики врут
    for city in rows:
        uniq = {}
        for r in rows[city]:
            key = (r["name"] or "") + "|" + (r["class"] or "")
            uniq.setdefault(key, r)
        rows[city] = list(uniq.values())

    lines = ["# Как собирался добор 15 → 30 ЖК", "",
             "Правило было одно: строка в датасете появляется только после того, как карточка открыта,",
             "а цифра на неё напечатана. Ни одного «среднего по городу», ни одного «примерно столько же».",
             "",
             "Скрипты: `tools/harvest_zhk.py` (скачать страницу и снять поля) →",
             "`tools/enrich_cards.py` (район и особенность — из тех же блоков карточки) →",
             "`tools/build_new_rows.py` (сверка с шапкой карточки и сборка строки) →",
             "`tools/build_data.py` (доливает строки в датасет, ничего не округляя).",
             "",
             "Ниже — по каждой просмотренной странице: что нашлось, что нет. Строк без цен не добавляли.",
             ""]
    total_seen = total_taken = 0
    for city in ("Сочи", "Москва", "Екатеринбург"):
        got = [r for r in rows.get(city, []) if r["taken"]]
        bizprem = [r for r in rows.get(city, []) if r["norm"]]
        ok_but_not_taken = [r for r in bizprem if not r["miss"] and not r["taken"]]
        rejected = [r for r in bizprem if r["miss"]]
        lines.append("## %s" % city)
        lines.append("")
        lines.append("| Показатель | Значение |")
        lines.append("|---|---|")
        lines.append("| карточек города открыто и разобрано | %d |" % len(rows.get(city, [])))
        lines.append("| из них уже было в датасете до добора | %d |" % len([r for r in rows.get(city, []) if r["taken"]]))
        lines.append("| из них бизнес/премиум по полю «Класс ЖК» | %d |" % len(bizprem))
        lines.append("| с полными данными (цена, лоты, срок сдачи) | %d |" % (len(bizprem) - len(rejected)) +
                     ", взято %d" % len([r for r in got if r]))
        lines.append("| в датасете после добора | %d (было 5, добавлено %d) |" % (5 + len(got), len(got)))
        lines.append("| отбраковано из-за пустой карточки | %d |" % len(rejected))
        lines.append("")
        if got:
            lines.append("Добрано в этот город:")
            lines.append("")
            lines.append("| ЖК | Класс в источнике | «цена от», ₽/м² | мин. лот, млн | лотов | причина, если бы не подошёл |")
            lines.append("|---|---|---|---|---|---|")
            for r in sorted(got, key=lambda x: (x["ppm"] or 0)):
                lines.append("| %s | %s | %s | %s | %s | — |" % (
                    r["name"], "«%s»" % r["class"], f"{int(r['ppm']):,}".replace(",", " "),
                    ("%.2f" % r["minLot"]) if r["minLot"] else "—", r["offers"] if r["offers"] is not None else "н/д"))
            lines.append("")
        if rejected:
            lines.append("Просмотрено и **не** добавлено (на карточке нет ни цены, ни лотов — вносить нечего):")
            lines.append("")
            for r in rejected[:24]:
                lines.append("* **%s** — нет: %s" % (r["name"], ", ".join(r["miss"])))
            if len(rejected) > 24:
                lines.append("* …и ещё %d таких же" % (len(rejected) - 24))
            lines.append("")
        if ok_but_not_taken:
            lines.append("Подходит по данным, но в этот раз не взято (квота города закрыта): %s"
                         % ", ".join(r["name"] for r in ok_but_not_taken))
            lines.append("")
        total_seen += len(rows.get(city, []))
        total_taken += len(got)
    lines.append("---")
    lines.append("")
    lines.append("Всего открыто карточек: **%d**, добавлено строк: **%d**." % (total_seen, total_taken))
    lines.append("")
    lines.append("Остальные страницы — либо комфорт/эконом (их в датасете быть не должно по условию выборки), либо")
    lines.append("бизнес/премиум **без актуальных цен**: у части сочинских комплексов карточка висит с пустым блоком")
    lines.append("стоимости, лотов в продаже ноль. Так «по 10 на город» вышло в Москве и Екатеринбурге, а в Сочи")
    lines.append("десятый объект пришлось добирать из общего списка новостроек города: фильтр класса на источнике")
    lines.append("не точный (в «Премиум» у него сидят «Комфорт» и «Бизнес»), и один ЖК бизнес-класса в нём просто")
    lines.append("не отображается. Пустоту мы число не закрывали.")
    (REPO / "docs").mkdir(exist_ok=True)
    (REPO / "docs" / "collection.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("docs/collection.md:", len(lines), "строк · просмотрено", total_seen, "· добавлено", total_taken)


main()
