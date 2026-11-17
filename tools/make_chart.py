#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/make_chart.py — график к Части 1 (пересобран под модель v3).

Панель A — средние «цены от» по классам в трёх городах + отметка о неустойчивости вывода.
Панель B — по каждому ЖК: объявленная «цена от» за м² против ФАКТИЧЕСКОЙ цены входа за м²
           (минимальный лот ÷ его площадь). Именно на эту разницу ведёт подпись под графиком
           на сайте — теперь картинка и текст соответствуют друг другу.

Запуск:  python3 tools/make_chart.py     (из корня репозитория)
"""
import json, pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

HERE = pathlib.Path(__file__).resolve().parent.parent
DATA = json.loads((HERE / "data" / "zhk.json").read_text(encoding="utf-8"))
CITIES = ["Москва", "Сочи", "Екатеринбург"]

plt.rcParams.update({
    "font.family": "DejaVu Sans", "axes.edgecolor": "#c9d3e6", "axes.linewidth": .8,
    "axes.labelcolor": "#33415c", "xtick.color": "#5b6880", "ytick.color": "#5b6880",
})


def avg(rows):
    return sum(r for r in rows) / len(rows) if rows else 0


def main():
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(15.5, 7.6), gridspec_kw={"width_ratios": [1, 1.25]})
    fig.patch.set_facecolor("white")

    # ---------------- панель A: средние по классам
    biz = [avg([z["pricePerM2"] for z in DATA if z["city"] == c and z["zhkClass"] == "Бизнес"]) / 1000 for c in CITIES]
    prm = [avg([z["pricePerM2"] for z in DATA if z["city"] == c and z["zhkClass"] == "Премиум"]) / 1000 for c in CITIES]
    x = range(len(CITIES))
    w = 0.36
    b1 = a1.bar([i - w / 2 for i in x], biz, w, color="#2f6fd0", label="Бизнес (средняя «цена от»)")
    b2 = a1.bar([i + w / 2 for i in x], prm, w, color="#12243f", label="Премиум (средняя «цена от»)")
    # отдельный столбик: Сочи-бизнес без «Белых Ночей» — чтобы показать неустойчивость вывода
    sochi_ex = avg([z["pricePerM2"] for z in DATA if z["city"] == "Сочи" and z["zhkClass"] == "Бизнес" and "Белые Ночи" not in z["name"]]) / 1000
    a1.bar([1 - w / 2], [sochi_ex], w, color="none", edgecolor="#c02b40", linewidth=1.8, linestyle="--")
    for bars in (b1, b2):
        for r in bars:
            a1.annotate(f"{r.get_height():.0f} тыс.", (r.get_x() + r.get_width() / 2, r.get_height()),
                        ha="center", va="bottom", fontsize=9.5, color="#101d31", weight="bold")
    a1.set_xticks(list(x)); a1.set_xticklabels(CITIES, fontsize=11)
    a1.set_ylabel("тыс. ₽ за м²", fontsize=10.5)
    a1.set_title("A. Средняя объявленная «цена от» за м² по классам\n(срез 5 ЖК на город, 2 премиум + 3 бизнес)",
                 fontsize=12.5, weight="bold", color="#101d31", loc="left")
    a1.set_ylim(0, max(max(biz), max(prm)) * 1.30)
    a1.legend(frameon=False, fontsize=9.5, loc="upper center", bbox_to_anchor=(0.5, -0.075), ncol=2)
    a1.grid(axis="y", color="#eaeef6"); a1.set_axisbelow(True)
    for sp in ("top", "right"):
        a1.spines[sp].set_visible(False)
    a1.annotate(
        "Пунктир = Сочи-бизнес БЕЗ одной строки\n(«Белые Ночи», 828 тыс. ₽/м²):\n"
        f"{avg([z['pricePerM2'] for z in DATA if z['city']=='Сочи' and z['zhkClass']=='Бизнес'])/1000:.0f} → {sochi_ex:.0f} тыс. ₽/м²,\n"
        "т.е. НИЖЕ Москвы. Вывод о «дорогом\nСочи» держится на одном объекте —\nэто гипотеза, а не закономерность.",
        xy=(1 - w / 2, sochi_ex), xytext=(0.02, 0.46), textcoords="axes fraction", fontsize=8.6, color="#8a2233",
        bbox=dict(boxstyle="round,pad=0.45", fc="#fdecef", ec="#e8b7c1", lw=.9),
        arrowprops=dict(arrowstyle="->", color="#c02b40", lw=1.1))

    # ---------------- панель B: объявленная цена против фактической цены входа
    rows = [z for z in DATA if z.get("minLotImpliedPpm") and z.get("minAreaM2")]
    rows.sort(key=lambda z: z["minLotImpliedPpm"] / z["pricePerM2"], reverse=True)
    labels, decl, real, gaps = [], [], [], []
    for z in rows:
        labels.append(f'{z["name"].replace("ЖК ", "").replace("ГК ", "")} ({z["city"][:3].upper()})')
        decl.append(z["pricePerM2"] / 1000)
        real.append(z["minLotImpliedPpm"] / 1000)
        gaps.append(z["minLotImpliedPpm"] / z["pricePerM2"] - 1)
    y = range(len(rows))[::-1]
    a2.barh(list(y), [max(d, r) for d, r in zip(decl, real)], 0.62, color="#eef2f8")
    a2.barh(list(y), decl, 0.62, color="#9db8e2", label="объявленная «цена от» за м²")
    a2.barh([i for i in y], real, 0.28, color="#12243f", label="фактическая цена входа за м² (мин. лот ÷ его площадь)")
    for i, d, r, g in zip(y, decl, real, gaps):
        a2.text(max(d, r) + 22, i, f"{r:,.0f} vs {d:,.0f}  (+{g*100:.0f}%)" if g > 0.01 else f"{r:,.0f} ≈ {d:,.0f}",
                va="center", fontsize=8.7, color="#c02b40" if g > 0.25 else "#5b6880")
    a2.set_yticks(list(y)); a2.set_yticklabels(labels, fontsize=9.2)
    a2.set_xlabel("тыс. ₽ за м²", fontsize=10.5)
    a2.set_xlim(0, max(max(decl), max(real)) * 1.42)
    a2.set_title("B. Почему «цена от × площадь» занижает стоимость\nВо скольких ЖК реальная цена входа за метр выше объявленной",
                 fontsize=12.5, weight="bold", color="#101d31", loc="left")
    a2.legend(frameon=False, fontsize=9, loc="upper right", bbox_to_anchor=(1.0, 1.0),
              facecolor="white", edgecolor="#e6ebf5", framealpha=.94)
    a2.grid(axis="x", color="#eaeef6"); a2.set_axisbelow(True)
    for sp in ("top", "right"):
        a2.spines[sp].set_visible(False)

    n_over = sum(1 for g in gaps if g > 0.05)
    fig.text(0.008, 0.015,
             f"Источники: realty.vbr.ru (14 ЖК) и m2.ru (1 ЖК), цены зафиксированы 15-16.11.2026. Класс — поле «Класс ЖК» карточки источника. "
             f"В {n_over} из {len(rows)} ЖК фактическая цена входа за м² выше объявленной «от» более чем на 5%: у агрегатора «цена от» относится к одному (обычно худшему) лоту, "
             f"а не к квартире любого метража. Расчёт подборщика: python3 -m http.server + tests/calc.test.js (15 проверок).",
             fontsize=8.2, color="#5b6880")
    a2.tick_params(axis="x", pad=2)
    fig.suptitle("Рынок новостроек бизнес- и премиум-класса: Москва, Сочи, Екатеринбург — данные 15-16 ноября 2026",
                 fontsize=14.5, weight="bold", color="#101d31", y=0.975)
    fig.tight_layout(rect=(0, 0.035, 1, 0.95))
    out = HERE / "chart_prices_2026.png"
    fig.savefig(out, dpi=180, facecolor="white")
    print("written", out, out.stat().st_size // 1024, "КБ", "| ЖК на панели B:", len(rows))


if __name__ == "__main__":
    main()
