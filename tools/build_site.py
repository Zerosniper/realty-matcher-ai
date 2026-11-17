#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v3_site.py — сборка «НовостройкиПро» v3 (исправления по аудиту).

Артефакты:
  realty-matcher-ai/app/styles.css        — стили (отдельным файлом: кэшируются, правятся без HTML)
  realty-matcher-ai/index.html            — ~25 КБ, подключает app/*.js и images/*.jpg (GitHub Pages, быстро)
  realty-matcher-ai/index-standalone.html — один файл со всеми данными, расчётом, стилями и фото (открывается двойным кликом офлайн)

Запуск: python3 v3_site.py        (после v3_data.py, который готовит data/zhk.json и app/data.js)
"""
import json, base64, re, pathlib, sys

# Пути определяются от расположения скрипта: в мастер-копии это /home/user, в репозитории — tools/.
_HERE = pathlib.Path(__file__).resolve().parent
REPO = _HERE.parent if _HERE.name == "tools" else _HERE / "realty-matcher-ai"
ROOT = _HERE if _HERE.name != "tools" else REPO


def _load_b64():
    """base64-фото для standalone-версии: из images_b64.json, а если его нет (копия в репозитории) — из папки images/."""
    p = ROOT / "images_b64.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8")), True
    out = {}
    img = REPO / "images"
    if img.exists():
        for f in sorted(list(img.glob("*.jpg")) + list(img.glob("*.png"))):
            mime = "png" if f.suffix == ".png" else "jpeg"
            out[f.stem] = f"data:image/{mime};base64," + base64.b64encode(f.read_bytes()).decode()
    return out, False


B64, B64_IS_SOURCE = _load_b64()

# ---------------------------------------------------------------- фотографии файлами (925 КБ → ~25 КБ HTML)
def materialize_images():
    out = REPO / "images"
    out.mkdir(parents=True, exist_ok=True)
    if not B64_IS_SOURCE:
        # фото уже лежат файлами в images/ — пересоздавать их не нужно, только перечисляем
        return [(f.name, f.stat().st_size) for f in sorted(out.glob("*.jpg")) + sorted(out.glob("*.png"))]
    done = []
    for key, uri in B64.items():
        m = re.match(r"data:image/(\w+);base64,(.+)", uri, re.S)
        if not m:
            continue
        ext = "jpg" if m.group(1) in ("jpeg", "jpg") else m.group(1)
        p = out / f"{key}.{ext}"
        p.write_bytes(base64.b64decode(m.group(2)))
        done.append((p.name, p.stat().st_size))
    return done


CSS = r"""
:root {
  --ink:#0b1729; --ink-2:#12243f; --surface:#f2f5fa; --card:#fff;
  --line:#dde4f0; --line-2:#eaeef6;
  --text:#101d31; --text-secondary:#45526b; --text-muted:#4a5670;
  --brand-blue:#1766e0; --brand-blue-dark:#0f4bb0;
  --brass:#a97f35; --brass-soft:#f6efe2; --graphite:#1b2534;
  --ok:#0f8a5f; --ok-soft:#e6f6ee; --warn:#b25a00; --warn-soft:#fdf1e2;
  --bad:#c02b40; --bad-soft:#fdecef;
  --radius:18px; --shadow:0 1px 2px rgba(11,23,41,.05),0 12px 32px -18px rgba(11,23,41,.22);
  --font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --font-display:"Playfair Display",Georgia,"Times New Roman",serif;
  --maxw:1220px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:var(--font-ui);background:var(--surface);color:var(--text);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
button,input,select{font:inherit;color:inherit}
a{color:inherit}
img{display:block;max-width:100%}
.ic{width:18px;height:18px;flex:none;fill:currentColor}
.ic--in{width:16px;height:16px}
.skip{position:fixed;top:-64px;left:12px;background:#fff;color:var(--brand-blue);padding:10px 16px;border-radius:10px;z-index:99;font-weight:700}
.skip:focus{top:12px}
:focus-visible{outline:3px solid #7fb0ff;outline-offset:2px;border-radius:8px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
code{background:#eef2f8;padding:1px 5px;border-radius:6px;font-size:.92em}

/* ---------- шапка ---------- */
.topbar{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.95);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.topbar-inner{max-width:var(--maxw);margin:0 auto;padding:0 22px;min-height:66px;display:flex;align-items:center;gap:14px}
.brand{display:flex;align-items:center;gap:11px;text-decoration:none;flex:none}
.brand-mark{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,var(--brand-blue),#3f8bff);display:grid;place-items:center;color:#fff;box-shadow:0 6px 16px -8px rgba(23,102,224,.9)}
.brand-mark .ic{width:20px;height:20px}
.brand-name{display:block;font-size:19px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.brand-name span{color:var(--brand-blue)}
.brand-tag{display:block;font-size:11px;color:var(--text-muted);font-weight:600}
.nav{display:flex;align-items:center;gap:18px;margin-left:6px}
.nav a{font-size:13.5px;font-weight:600;color:var(--text-secondary);text-decoration:none;white-space:nowrap}
.nav a:hover{color:var(--brand-blue)}
.topbar-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.stamp{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--ok-soft);color:#0a6b49;font-size:12px;font-weight:700;white-space:nowrap}
.citydd{position:relative}
.citydd-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 13px;border-radius:999px;border:1px solid var(--line);background:#fff;font-weight:700;font-size:13px;cursor:pointer;min-height:40px}
.citydd-btn:hover{border-color:#c4d4ee}
.citydd-menu{position:absolute;right:0;top:calc(100% + 8px);min-width:220px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:6px;display:none;z-index:40}
.citydd[data-open="true"] .citydd-menu{display:block}
.citydd-menu button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:0;background:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:13.5px;min-height:44px;text-align:left}
.citydd-menu button:hover{background:#f2f6fd}
.citydd-menu button[aria-current="true"]{background:#eaf2ff;color:var(--brand-blue-dark);font-weight:800}
.citydd-menu small{color:var(--text-muted);font-weight:600}
.burger{display:none;width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:#fff;cursor:pointer;place-items:center}

/* ---------- герой ---------- */
.hero{position:relative;overflow:hidden;background:var(--ink);color:#fff;isolation:isolate}
.hero-bg{position:absolute;inset:0;background-size:cover;background-position:center 60%;opacity:.28;filter:saturate(.85);z-index:-2}
.hero::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(115deg,rgba(7,17,35,.97) 30%,rgba(9,22,45,.72) 60%,rgba(11,25,48,.95))}
.hero-inner{max-width:var(--maxw);margin:0 auto;padding:38px 22px 46px;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:34px;align-items:start}
.hero-eyebrow{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.26);background:rgba(255,255,255,.08);font-size:12.5px;font-weight:700;color:#e7efff}
.hero h1{margin:18px 0 0;font-family:var(--font-display);font-size:clamp(29px,3.4vw,45px);line-height:1.14;letter-spacing:-.015em;font-weight:700}
.hero-sub{margin:15px 0 0;font-size:16.2px;color:#cbd9f2;max-width:64ch}
.hero-sub b{color:#fff}
.hero-fine{margin:14px 0 0;font-size:12.5px;color:#a9bddd;display:grid;gap:6px}
.hero-fine span{display:inline-flex;align-items:center;gap:7px}
.steps{background:rgba(9,20,40,.6);border:1px solid rgba(255,255,255,.16);border-radius:var(--radius);padding:20px 22px;backdrop-filter:blur(6px)}
.steps-title{margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#9db8e2}
.step-row{display:flex;gap:12px;padding:10px 0;border-top:1px solid rgba(255,255,255,.1)}
.step-row:first-of-type{border-top:0}
.step-num{width:25px;height:25px;border-radius:9px;background:var(--brand-blue);display:grid;place-items:center;font-size:12.5px;font-weight:800;flex:none;margin-top:1px}
.step-row p{margin:0;font-size:13.8px;color:#e2ebf9}
.step-row p b{color:#fff}

/* ---------- панель подбора ---------- */
.finder-wrap{max-width:var(--maxw);margin:-28px auto 0;padding:0 22px 8px;position:relative;z-index:5}
.finder{background:var(--card);border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow);padding:20px 22px 18px}
.finder-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px}
.finder-head h2{margin:0;font-size:18px;font-weight:800;display:flex;align-items:center;gap:8px}
.finder-head p{margin:0;font-size:12.8px;color:var(--text-muted)}
.fields{display:grid;grid-template-columns:1.02fr 1fr 1fr 224px;gap:14px;align-items:stretch}
.field{border:1px solid var(--line);border-radius:var(--radius);padding:13px 14px 14px;background:#fbfcfe;display:flex;flex-direction:column;gap:10px;min-height:196px}
.field-top{display:flex;align-items:center;justify-content:space-between;gap:6px;white-space:nowrap}
.step-tag{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary);display:inline-flex;align-items:center}
.step-tag i{display:inline-grid;place-items:center;width:17px;height:17px;border-radius:6px;margin-right:6px;background:var(--brand-blue);color:#fff;font-style:normal;font-size:10.5px}
.field-hint{font-size:11.5px;font-weight:700;color:var(--brand-blue);text-align:right}
.field-note{margin-top:auto;font-size:11.8px;color:var(--text-muted)}
.seg{display:flex;gap:6px;background:#eef2f8;padding:4px;border-radius:12px}
.seg button{flex:1;border:0;background:none;border-radius:9px;padding:8px 6px;font-size:13px;font-weight:600;cursor:pointer;min-height:40px;color:var(--text-secondary)}
.seg button[aria-selected="true"]{background:#fff;color:var(--brand-blue-dark);font-weight:800;box-shadow:0 1px 4px rgba(16,29,49,.13)}
.amount{display:flex;align-items:baseline;gap:8px}
.amount input{width:100%;border:0;background:none;padding:0;font-size:26px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;min-width:0}
.amount span{font-size:12.5px;color:var(--text-muted);font-weight:700;flex:none}
input[type=range]{width:100%;accent-color:var(--brand-blue);height:28px;margin:0;cursor:pointer;padding:0}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:600;cursor:pointer;min-height:36px;color:var(--text-secondary)}
.chip[aria-pressed="true"]{border-color:var(--brand-blue);color:var(--brand-blue-dark);background:#eef5ff;font-weight:800}
.field-cta{background:linear-gradient(170deg,var(--brand-blue),#1049b4);color:#fff;border:0;border-radius:var(--radius);padding:18px 16px;display:flex;flex-direction:column;gap:10px;justify-content:center;align-items:stretch;min-height:196px;text-align:center}
.field-cta .big{font-size:19px;font-weight:800;letter-spacing:-.01em}
.field-cta .small{font-size:12.5px;opacity:.9}
.btn-go{border:0;border-radius:12px;background:#fff;color:var(--brand-blue-dark);font-weight:800;padding:12px 10px;cursor:pointer;min-height:46px;font-size:14px}
.btn-ghost-light{border:1px solid rgba(255,255,255,.42);background:rgba(255,255,255,.1);color:#fff;border-radius:12px;padding:10px;cursor:pointer;font-weight:700;min-height:42px;font-size:12.8px}
.nl{margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px dashed var(--line);padding-top:14px}
.nl label{font-size:12.5px;font-weight:800;color:var(--text-secondary);display:inline-flex;align-items:center;gap:6px}
.nl input[type=search]{flex:1 1 300px;min-width:200px;border:1px solid var(--line);border-radius:999px;padding:11px 16px;background:#fbfcfe;min-height:44px;font-size:14px}
.nl .btn-query{border:0;background:var(--ink-2);color:#fff;border-radius:999px;padding:0 20px;font-weight:700;cursor:pointer;min-height:44px}
.intent{display:flex;gap:6px;flex-wrap:wrap;align-items:center;width:100%}
.intent b{font-size:12px;color:var(--text-muted);font-weight:700}
.intent .chip{cursor:default;background:#eef5ff;border-color:#cfe0fb;color:var(--brand-blue-dark)}
.classbar{margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px dashed var(--line);padding-top:12px}
.classbar>b{font-size:12.5px;color:var(--text-muted)}
.classbar .grow{margin-left:auto}
.compare-out{margin-top:10px;width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.4px;white-space:pre-wrap;background:#fbfcfe;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.scenes{margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.scenes>b{font-size:12.5px;color:var(--text-muted)}

/* ---------- результаты ---------- */
.results{max-width:var(--maxw);margin:0 auto;padding:26px 22px 10px;scroll-margin-top:84px}
.verdict{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--brand-blue);border-radius:var(--radius);padding:18px 20px;box-shadow:var(--shadow);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,330px);gap:22px;align-items:center}
.verdict h2{margin:0 0 6px;font-size:19px;font-weight:800;letter-spacing:-.01em}
.verdict p{margin:0;font-size:13.6px;color:var(--text-secondary);max-width:66ch}
.v-pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.v-pill{border:1px solid var(--line);background:#fbfcfe;border-radius:12px;padding:8px 12px}
.v-pill span{display:block;font-size:10.8px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.v-pill b{font-size:15px;font-variant-numeric:tabular-nums}
.thermo{border:1px solid var(--line);border-radius:14px;padding:13px 15px 11px;background:#fbfcfe}
.thermo-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:11.5px;color:var(--text-muted);font-weight:700}
.thermo-top b{font-size:21px;color:var(--text);font-variant-numeric:tabular-nums}
.thermo-track{position:relative;height:12px;border-radius:999px;background:#e6ebf4;margin:9px 0 6px;overflow:hidden}
.thermo-fill{position:absolute;inset:0 auto 0 0;border-radius:999px;background:linear-gradient(90deg,#12805a,#25a878);transition:width .25s ease}
.thermo-fill.warn{background:linear-gradient(90deg,#b25a00,#e08a25)}
.thermo-fill.bad{background:linear-gradient(90deg,#a2243a,#d3455f)}
.thermo-ticks i{position:absolute;top:0;bottom:0;width:1px;background:rgba(16,29,49,.18)}
.thermo-legend{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums}

.cards-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:22px 0 0}
.cards-head h2{margin:0;font-size:17px;letter-spacing:-.01em}
.cards-head p{margin:0;font-size:12.4px;color:var(--text-muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(316px,1fr));gap:16px;margin-top:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column}
.card--best{border:1px solid #b9d3ff;box-shadow:0 0 0 3px rgba(23,102,224,.1),var(--shadow)}
.card--premium{border-color:#e3d9c4}
.card--premium .card-name{font-family:var(--font-display);letter-spacing:-.01em}
.card--premium .price-line b{color:var(--brass)}
.card--premium .badge--brass{background:var(--brass-soft);color:#6d4a12}
.card--excluded{background:#fbfcfe;box-shadow:none}
.card--excluded .card-photo{filter:grayscale(.55) opacity(.75)}
.no-photo .card-photo{display:none}
.no-photo .card-media{height:126px;background:linear-gradient(135deg,#243856,#0f2340)}
.card-media{position:relative}
.card-photo{width:100%;aspect-ratio:8/5;object-fit:cover;background:#e6ebf4}
.card-ribbon{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:10px;background:linear-gradient(180deg,rgba(6,15,32,.66),rgba(6,15,32,0))}
.badge{display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;background:rgba(255,255,255,.96);color:var(--graphite)}
.badge--ok{color:#0a6b49}.badge--warn{color:var(--warn)}.badge--bad{color:var(--bad)}
.card-loc{position:absolute;left:0;right:0;bottom:0;padding:26px 12px 10px;color:#fff;font-size:12.5px;font-weight:700;text-shadow:0 1px 6px rgba(0,0,0,.7);display:flex;align-items:center;gap:6px}
.card-body{padding:15px 16px 16px;display:flex;flex-direction:column;gap:11px;flex:1}
.card-name{margin:0;font-size:18.5px;font-weight:800;letter-spacing:-.015em;line-height:1.25}
.card-dev{margin:-6px 0 0;font-size:12.5px;color:var(--text-muted)}
.price-box{border:1px solid var(--line);border-radius:14px;padding:12px 13px;background:#fbfcfe}
.price-line{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.price-line b{font-size:25px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.price-line em{font-style:normal;font-size:12.5px;color:var(--text-muted);font-weight:700}
.price-range{font-size:12.4px;color:var(--text-secondary);margin-top:5px}
.price-range b{color:var(--text)}
.meter{height:8px;border-radius:999px;background:#e6ebf4;margin-top:9px;overflow:hidden}
.meter i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#12805a,#25a878)}
.meter i.warn{background:linear-gradient(90deg,#b25a00,#e08a25)}
.meter i.bad{background:linear-gradient(90deg,#a2243a,#d3455f)}
.price-how{margin-top:8px;font-size:11.8px;color:var(--text-muted)}
.price-how summary{cursor:pointer;font-weight:700;color:var(--brand-blue-dark);display:inline-flex;gap:5px;align-items:center;list-style:none;min-height:24px}
.price-how summary::-webkit-details-marker{display:none}
.price-how p{margin:6px 0 0}
.price-how b{color:var(--text)}
.verdict-line{display:flex;gap:8px;align-items:flex-start;border-radius:12px;padding:10px 12px;font-size:12.9px;font-weight:600}
.verdict-line .ic{margin-top:2px}
.verdict-line.ok{background:var(--ok-soft);color:#0a6b49}
.verdict-line.warn{background:var(--warn-soft);color:#8c4700}
.verdict-line.bad{background:var(--bad-soft);color:#96202f}
.verdict-line.na{background:#eef1f6;color:var(--text-secondary)}
.verdict-line b{font-weight:800}
.mortgage{border:1px dashed #cfdcf1;border-radius:12px;padding:10px 12px;background:#f7faff;font-size:12.6px}
.mortgage b{font-size:15.5px;font-variant-numeric:tabular-nums}
.mortgage .fine{color:var(--text-muted);font-size:11.4px;margin-top:4px}
.specs{display:grid;grid-template-columns:124px minmax(0,1fr);gap:6px 10px;font-size:12.7px;margin:0}
.specs dt{color:var(--text-muted);font-weight:600}
.specs dd{margin:0;color:var(--text);font-weight:600;text-align:left;overflow-wrap:anywhere}
.score{display:flex;align-items:center;gap:8px;font-size:11.8px;color:var(--text-muted)}
.score b{color:var(--brand-blue-dark);font-size:12.6px;font-variant-numeric:tabular-nums;white-space:nowrap}
.score-bar{height:6px;width:56px;flex:none;border-radius:999px;background:#e6ebf4;overflow:hidden}
.score-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--brand-blue),#4c93ff);border-radius:999px}
.card-actions{display:flex;gap:8px;margin-top:auto;padding-top:3px}
.card-actions a,.card-actions button{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;border-radius:11px;padding:11px 8px;font-size:12.8px;font-weight:700;cursor:pointer;min-height:44px}
.btn-src{border:1px solid var(--line);background:#fff;color:var(--brand-blue-dark)}
.btn-src:hover{background:#f3f8ff;border-color:#c4d9fa}
.btn-lead{border:1px solid var(--line);background:#fff;color:var(--text)}
.btn-lead:hover{background:#f7f9fd}
.excluded{margin-top:16px}
.excluded summary{cursor:pointer;font-size:13.8px;font-weight:800;color:var(--text-secondary);padding:13px 16px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);list-style:none;display:flex;gap:8px;align-items:center;min-height:48px}
.excluded summary::-webkit-details-marker{display:none}
.excluded summary .ic{transition:transform .2s}
.excluded[open] summary{border-radius:var(--radius) var(--radius) 0 0;border-bottom:0}
.excluded[open] summary .ic{transform:rotate(180deg)}
.excluded .cards{padding:16px;background:#f7f9fd;border:1px solid var(--line);border-top:0;border-radius:0 0 var(--radius) var(--radius)}

/* ---------- аналитика ---------- */
.sheet{max-width:var(--maxw);margin:16px auto 0;padding:0 22px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.sheet .box{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 17px;box-shadow:var(--shadow)}
.box .tag{font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--brand-blue)}
.box h3{margin:8px 0 6px;font-size:15.5px;letter-spacing:-.01em}
.box p{margin:0;font-size:13.1px;color:var(--text-secondary)}
.box .nums{display:flex;gap:16px;margin-top:12px;flex-wrap:wrap}
.box .nums span{display:block;font-size:10.8px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.box .nums b{font-size:16px;font-variant-numeric:tabular-nums}
.block{max-width:var(--maxw);margin:16px auto 0;padding:0 22px}
.block .inner{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;box-shadow:var(--shadow)}
.block h3{margin:0 0 8px;font-size:17px;letter-spacing:-.01em}
.block .lede{margin:0 0 12px;font-size:13.2px;color:var(--text-secondary)}
.block img{width:100%;border-radius:12px;border:1px solid var(--line-2)}
.method ul{margin:6px 0 0;padding-left:20px;font-size:13.3px;color:var(--text-secondary)}
.method li{margin-bottom:7px}
.method b,.method code{color:var(--text)}
.tbl-wrap{overflow-x:auto;margin-top:12px}
.only-mobile{display:none;font-weight:600;color:var(--text-muted)}
table{border-collapse:collapse;width:100%;font-size:12.5px}
caption{text-align:left;font-size:12.3px;color:var(--text-muted);padding-bottom:8px}
th,td{border-bottom:1px solid var(--line-2);padding:9px 10px;text-align:left;vertical-align:top}
th{background:#f6f8fc;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-secondary);white-space:nowrap;position:sticky;top:0}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
tr[data-fits="1"] td:first-child{box-shadow:inset 3px 0 0 var(--ok)}
tr[data-fits="2"] td:first-child{box-shadow:inset 3px 0 0 var(--warn)}
tr[data-fits="0"] td:first-child{box-shadow:inset 3px 0 0 var(--bad)}
.src-link{font-size:12px;font-weight:700;color:var(--brand-blue-dark);text-decoration:none;white-space:nowrap}
.src-link:hover{text-decoration:underline}

/* ---------- заявка + футер ---------- */
.lead .inner{background:linear-gradient(135deg,var(--ink-2),#17355f);color:#fff;border-radius:20px;padding:20px 22px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,340px);gap:20px;align-items:center}
.lead h3{margin:0 0 6px;font-size:19px;font-family:var(--font-display)}
.lead p{margin:0;font-size:13.3px;color:#cddcf3}
.lead form{display:flex;gap:8px;flex-wrap:wrap}
.lead input{flex:1 1 150px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);padding:12px 14px;color:#fff;min-height:44px}
.lead input::placeholder{color:#b8c9e6}
.lead button{border:0;border-radius:12px;background:#fff;color:var(--ink-2);font-weight:800;padding:12px 18px;cursor:pointer;min-height:44px}
.lead .fine{font-size:11.3px;color:#a8bde0;margin-top:8px}
.foot{max-width:var(--maxw);margin:22px auto 34px;padding:16px 22px 0;border-top:1px solid var(--line);color:var(--text-muted);font-size:12.3px;display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}
.foot a{color:var(--brand-blue-dark)}
.legal{font-size:11.5px;max-width:96ch}

/* ---------- адаптива ---------- */
@media (max-width:1180px){
  .nav{display:none}.burger{display:grid}
  .fields{grid-template-columns:1fr 1fr}
  .field-cta{grid-column:span 2;min-height:0;flex-direction:row;justify-content:space-between;align-items:center;flex-wrap:wrap;text-align:left}
  .field-cta>div{flex:1 1 200px}
  .btn-go,.btn-ghost-light{width:auto;flex:1 1 180px}
  .hero-inner{grid-template-columns:1fr}.verdict{grid-template-columns:1fr}.sheet{grid-template-columns:1fr}
  .lead .inner{grid-template-columns:1fr}
}
@media (max-width:720px){
  body{font-size:14.5px}
  .fields{grid-template-columns:1fr}.field-cta{grid-column:auto}.field{min-height:0}
  .hero h1{font-size:26px}
  .topbar-inner{padding:0 12px;gap:8px}.stamp{display:none}
  .brand-name,.brand-tag{display:none}.brand{gap:0}
  .citydd{flex:1;min-width:0}.citydd-btn{width:100%;justify-content:space-between;min-height:44px}
  .citydd-btn>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hero-inner,.finder-wrap,.results,.sheet,.block,.lead,.foot{padding-left:14px;padding-right:14px}
  .finder{padding:16px 14px 14px}
  .cards{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;margin:14px -14px 0;padding:2px 14px 8px}
  .card{min-width:86vw;scroll-snap-align:start}
  .chip{min-height:44px;padding:11px 14px;font-size:13px}
  .seg button{min-height:44px}.price-how summary{min-height:32px}
  .v-pills{display:grid;grid-template-columns:1fr 1fr}
  .mobile-nav-open .nav{display:flex;position:absolute;top:66px;left:0;right:0;background:#fff;border-bottom:1px solid var(--line);padding:8px 16px 12px;flex-direction:column;align-items:stretch;gap:0;box-shadow:var(--shadow)}
  .mobile-nav-open .nav a{padding:12px 0;width:100%;min-height:44px;display:flex;align-items:center;border-top:1px solid var(--line-2)}
  table{font-size:13px}
  thead{display:none}
  tbody tr{display:block;border:1px solid var(--line);border-radius:14px;padding:4px 12px;margin-bottom:10px;background:#fbfcfe}
  tbody td{display:flex;justify-content:space-between;gap:12px;border:0;padding:7px 0;text-align:right}
  table td.wide,table th.wide{display:none!important}
  .only-mobile{display:block}
  tbody td::before{content:attr(data-label);font-weight:700;color:var(--text-muted);text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
  td.num{white-space:normal}
  tr[data-fits] td:first-child{box-shadow:none}
}
@media print{.topbar,.finder-wrap,.hero-bg,.lead,.burger{display:none}.card,.verdict,.block .inner{box-shadow:none}}
"""

BODY = r"""
  <a class="skip" href="#finder">Перейти к подбору квартиры</a>

  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="#" aria-label="НовостройкиПро — на главную">
        <span class="brand-mark" aria-hidden="true"><svg class="ic"><use href="#i-home"/></svg></span>
        <span><span class="brand-name">Новостройки<span>Про</span></span><span class="brand-tag">подбор новостроек по бюджету</span></span>
      </a>
      <div class="citydd" id="cityDD" data-open="false">
        <button class="citydd-btn" id="cityDDBtn" aria-haspopup="true" aria-expanded="false" aria-controls="cityDDMenu">
          <svg class="ic" aria-hidden="true"><use href="#i-pin"/></svg><span id="cityDDLabel">Сочи</span>
          <svg class="ic" aria-hidden="true" style="width:14px;height:14px"><use href="#i-chev"/></svg>
        </button>
        <div class="citydd-menu" id="cityDDMenu" role="menu" aria-label="Выбор города"></div>
      </div>
      <nav class="nav" id="main-nav" aria-label="Разделы">
        <a href="#finder">Подобрать квартиру</a>
        <a href="#results">Ваши 3 ЖК</a>
        <a href="#sheet">Сравнение городов</a>
        <a href="#chart">График цен</a>
        <a href="#catalog">Все 15 ЖК</a>
      </nav>
      <div class="topbar-right">
        <span class="stamp"><svg class="ic" aria-hidden="true" style="width:14px;height:14px"><use href="#i-check"/></svg> Цены сверены с источниками 15-16.11.2026</span>
        <button class="burger" id="burger" aria-expanded="false" aria-controls="main-nav" aria-label="Меню раздела"><svg class="ic"><use href="#i-menu"/></svg></button>
      </div>
    </div>
  </header>

  <section class="hero">
    <div class="hero-bg" id="heroBg" aria-hidden="true"></div>
    <div class="hero-inner">
      <div>
        <span class="hero-eyebrow"><svg class="ic" aria-hidden="true"><use href="#i-scale"/></svg> Бесплатно · без регистрации · 15 ЖК в срезе</span>
        <h1>Какие новостройки вам по бюджету — и что в них реально можно купить за эти деньги</h1>
        <p class="hero-sub">Не нужно открывать десятки вкладок и умножать «цену от» на метраж. Укажите город, бюджет и площадь — сервис
          подберёт <b>3 ЖК по реальным лотам</b>: цена входа, остаток бюджета, ипотечный платёж и объяснение, почему вариант лучше.
          Если квартир такой площади в комплексе нет — <b>скажем прямо</b>, а не нарисуем «вам хватает».</p>
        <div class="hero-fine">
          <span><svg class="ic ic--in" aria-hidden="true"><use href="#i-check"/></svg> 15 из 15 цен сверены вручную: realty.vbr.ru (14) и m2.ru (1), 15-16.11.2026</span>
          <span><svg class="ic ic--in" aria-hidden="true"><use href="#i-key"/></svg> Считаем по минимальному лоту нужной комнаты, а не по «цене от за м²»</span>
          <span><svg class="ic ic--in" aria-hidden="true"><use href="#i-share"/></svg> Подбор копируется ссылкой и собирается в сравнение</span>
        </div>
      </div>
      <aside class="steps" aria-label="Как пользоваться сервисом">
        <p class="steps-title">Как это работает — 3 шага</p>
        <div class="step-row"><span class="step-num" aria-hidden="true">1</span><p>Выберите <b>город</b>: Сочи, Москва или Екатеринбург</p></div>
        <div class="step-row"><span class="step-num" aria-hidden="true">2</span><p>Укажите <b>бюджет</b> и <b>площадь</b> — или напишите словами: «студия у моря до 20 млн»</p></div>
        <div class="step-row"><span class="step-num" aria-hidden="true">3</span><p>Сравните <b>3 варианта</b> с фото домов и откройте карточку застройщика по ссылке</p></div>
      </aside>
    </div>
  </section>

  <div class="finder-wrap">
    <section class="finder" id="finder" aria-labelledby="finderTitle">
      <div class="finder-head">
        <h2 id="finderTitle"><svg class="ic" aria-hidden="true"><use href="#i-search"/></svg> Параметры вашей будущей квартиры</h2>
        <p>Двигайте ползунки или вводите цифры — результат под панелью обновляется мгновенно</p>
      </div>

      <div class="fields">
        <div class="field">
          <div class="field-top"><span class="step-tag"><i aria-hidden="true">1</i>Город</span><span class="field-hint" id="cityCountHint"></span></div>
          <div class="seg" role="tablist" aria-label="Город" id="cityTabs"></div>
          <span class="field-note" id="cityPriceNote"></span>
        </div>

        <div class="field">
          <div class="field-top"><span class="step-tag"><i aria-hidden="true">2</i>Бюджет на покупку</span><span class="field-hint" id="budgetPctHint"></span></div>
          <div class="amount"><input type="number" id="budgetInput" inputmode="decimal" min="5" max="400" step="0.5" value="25" aria-label="Бюджет, миллионов рублей" /><span aria-hidden="true">млн ₽</span></div>
          <input type="range" id="budgetRange" min="5" max="400" step="0.5" value="25" aria-label="Ползунок бюджета, миллионов рублей" />
          <div class="chips" role="group" aria-label="Быстрый выбор бюджета">
            <button class="chip" type="button" data-budget="10" aria-pressed="false">10 млн</button>
            <button class="chip" type="button" data-budget="25" aria-pressed="true">25 млн</button>
            <button class="chip" type="button" data-budget="40" aria-pressed="false">40 млн</button>
            <button class="chip" type="button" data-budget="80" aria-pressed="false">80 млн</button>
            <button class="chip" type="button" data-budget="150" aria-pressed="false">150 млн</button>
          </div>
        </div>

        <div class="field">
          <div class="field-top"><span class="step-tag"><i aria-hidden="true">3</i>Желаемая площадь</span><span class="field-hint" id="maxPpmHint"></span></div>
          <div class="amount"><input type="number" id="areaInput" inputmode="numeric" min="18" max="250" step="1" value="45" aria-label="Площадь, квадратных метров" /><span aria-hidden="true">м²</span></div>
          <input type="range" id="areaRange" min="18" max="250" step="1" value="45" aria-label="Ползунок площади, квадратных метров" />
          <div class="chips" role="group" aria-label="Типовая квартира">
            <button class="chip" type="button" data-area="28" aria-pressed="false">студия ~28 м²</button>
            <button class="chip" type="button" data-area="45" aria-pressed="true">1-комн ~45 м²</button>
            <button class="chip" type="button" data-area="65" aria-pressed="false">2-комн ~65 м²</button>
            <button class="chip" type="button" data-area="95" aria-pressed="false">3-комн ~95 м²</button>
          </div>
        </div>

        <div class="field field-cta">
          <div><span class="big" id="ctaCount">Подобрано 3 ЖК</span><br /><span class="small" id="ctaNote">цена входа, остаток, ипотека</span></div>
          <button class="btn-go" type="button" id="goBtn">Показать варианты <svg class="ic" aria-hidden="true" style="width:15px;height:15px"><use href="#i-chev"/></svg></button>
          <button class="btn-ghost-light" type="button" id="shareBtn"><svg class="ic" aria-hidden="true" style="width:15px;height:15px;vertical-align:-3px"><use href="#i-link"/></svg> <span id="shareLabel">Скопировать ссылку</span></button>
          <button class="btn-ghost-light" type="button" id="printBtn"><svg class="ic" aria-hidden="true" style="width:15px;height:15px;vertical-align:-3px"><use href="#i-scale"/></svg> На печать / в PDF</button>
        </div>
      </div>

      <div class="nl">
        <label for="queryInput"><svg class="ic" aria-hidden="true"><use href="#i-spark"/></svg> Можно словами</label>
        <input type="search" id="queryInput" placeholder="например: студия у моря до 20 млн в Сочи" aria-describedby="intentChips" />
        <button class="btn-query" type="button" id="queryBtn">Понять запрос</button>
        <button class="chip" type="button" id="resetBtn">Сбросить</button>
        <div class="intent" id="intentChips" aria-live="polite"></div>
      </div>

      <div class="classbar">
        <b>Класс ЖК:</b>
        <span class="chips" role="group" aria-label="Фильтр по классу">
          <button class="chip" type="button" data-klass="Все" aria-pressed="true">все</button>
          <button class="chip" type="button" data-klass="Бизнес" aria-pressed="false">бизнес</button>
          <button class="chip" type="button" data-klass="Премиум" aria-pressed="false">премиум</button>
        </span>
        <span class="field-note" style="margin:0">Класс в базе взят из поля «Класс ЖК» карточки источника — не наша догадка</span>
        <button class="chip grow" type="button" id="compareBtn">Сравнить 0 ЖК</button>
        <button class="chip" type="button" id="copyCompare" hidden>Скопировать сравнение</button>
        <pre class="compare-out" id="compareOut" hidden></pre>
      </div>

      <div class="scenes">
        <b>Нет идей? Нажмите готовый сценарий:</b>
        <button class="chip" type="button" data-scene='{"city":"Сочи","budget":25,"area":45,"klass":"Все","q":"студия у моря до 20 млн в сочи"}'>Сочи · 25 млн · ищем у моря</button>
        <button class="chip" type="button" data-scene='{"city":"Москва","budget":30,"area":55,"klass":"Бизнес","q":""}'>Москва · 30 млн · бизнес</button>
        <button class="chip" type="button" data-scene='{"city":"Екатеринбург","budget":16,"area":60,"klass":"Все","q":"2 комнаты в екатеринбурге до 16 млн"}'>Екатеринбург · 16 млн · 2 комнаты</button>
        <button class="chip" type="button" data-scene='{"city":"Москва","budget":140,"area":85,"klass":"Премиум","q":""}'>Премиум в ЦАО · 140 млн · 85 м²</button>
      </div>
    </section>
  </div>

  <main class="results" id="results">
    <section class="verdict" id="verdict" aria-live="polite"></section>

    <div class="cards-head">
      <h2 id="cardsH">Подходящие новостройки</h2>
      <p>Цена = площадь × ₽/м² фактического минимального лота нужной комнаты · <svg class="ic" aria-hidden="true" style="width:13px;height:13px;vertical-align:-2px"><use href="#i-info"/></svg> «Как считали» — в каждой карточке</p>
    </div>
    <div class="cards" id="topCards"></div>

    <details class="excluded" id="excludedWrap">
      <summary><svg class="ic" aria-hidden="true"><use href="#i-chev"/></svg> <span id="excludedTitle">Почему остальные ЖК не подошли</span></summary>
      <div class="cards" id="excludedCards"></div>
    </details>
  </main>

  <section class="sheet" id="sheet" aria-label="Сравнение трёх городов"></section>

  <div class="block" id="chart">
    <div class="inner">
      <h3>Сколько стоит метр: разброс в трёх городах</h3>
      <p class="lede">Те же 15 ЖК, что и в подборе (срез на 15-16.11.2026). Слева — объявленная «цена от» за м² по каждому комплексу; справа — насколько фактическая цена входа за метр (минимальный лот ÷ его площадь) выше объявленной.</p>
      <img src="chart_prices_2026.png" alt="График: минимальная цена квадратного метра по 15 ЖК и разрыв между объявленной ценой от и фактической ценой входа" loading="lazy" />
    </div>
  </div>

  <div class="block method">
    <div class="inner">
      <h3>Как считаем — и чему здесь нельзя верить</h3>
      <ul id="methodList"></ul>
    </div>
  </div>

  <div class="block" id="catalog">
    <div class="inner">
      <h3>Полный каталог: 15 новостроек, лоты, даты цен, источники</h3>
      <p class="lede" style="margin-bottom:10px">Таблица генерируется из того же файла <code>data/zhk.json</code>, что и подбор, — разойтись в цифрах нельзя.</p>
      <button class="chip" type="button" id="toggleTableBtn" aria-expanded="false" aria-controls="tableWrap">Показать таблицу (15 строк)</button>
      <div class="tbl-wrap" id="tableWrap" hidden></div>
    </div>
  </div>

  <div class="block lead">
    <div class="inner">
      <div>
        <h3>Забирайте подборку с собой</h3>
        <p>Оставьте контакт — так выглядит путь к заявке: список сохраняется и уходит вам, а не теряется на переходе на агрегатор.</p>
        <p class="fine" id="leadNote">Демо-форма: отправка не подключена (нет бэкенда). В проде — CRM или Telegram-бот застройщика.</p>
      </div>
      <form id="leadForm" novalidate>
        <label class="sr" for="leadName">Имя</label>
        <input id="leadName" name="name" placeholder="Как к вам обращаться" autocomplete="name" />
        <label class="sr" for="leadContact">Телефон или Telegram</label>
        <input id="leadContact" name="contact" placeholder="Телефон или @telegram" autocomplete="tel" />
        <button type="submit">Получить подборку</button>
        <p class="fine" id="leadMsg" aria-live="polite"></p>
      </form>
    </div>
  </div>

  <footer class="foot">
    <div class="legal">
      <b>НовостройкиПро</b> — учебно-демонстрационный сервис подбора новостроек. Не является офертой, рекламой объекта долевого строительства или рекомендацией к покупке:
      решение принимается после проверки проектной декларации на <a href="https://наш.дом.рф" target="_blank" rel="noopener">наш.дом.рф</a> и договора с застройщиком.
      Все 15 объектов продаются по 214-ФЗ (ДДУ, счета эскроу): цена «от» и состав лотов меняются вместе со стадией строительства,
      поэтому сравнивать комплексы разной стадии («котлован» против «сдан») по цене метра напрямую некорректно — сервис показывает срок сдачи у каждого ЖК.
      Расчёт справочный и опирается на минимальные лоты в продаже на дату фиксации цены. Цены, лоты и классы:
      <a href="https://realty.vbr.ru/" target="_blank" rel="noopener">realty.vbr.ru</a>, <a href="https://m2.ru/" target="_blank" rel="noopener">m2.ru</a> (15-16.11.2026).
    </div>
    <div style="text-align:right;white-space:nowrap">
      15 ЖК · 3 города · v3 (лоты + скоринг)<br />18 тестов расчёта: <code>node tests/calc.test.js</code><br />
      <a href="https://github.com/Zerosniper/realty-matcher-ai" target="_blank" rel="noopener">код и датасет на GitHub</a>
    </div>
  </footer>
"""

ICONS = r"""
  <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
    <symbol id="i-home" viewBox="0 0 24 24"><path d="M12 3 2 10.5V21h7v-6h6v6h7V10.5z"/></symbol>
    <symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.6A2.6 2.6 0 1 1 12 6.4a2.6 2.6 0 0 1 0 5.2Z"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="M9.2 16.5 4.6 11.9l-1.5 1.5 6.1 6.1L20.9 7.9l-1.5-1.5z"/></symbol>
    <symbol id="i-x" viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4L10.6 10.6l6.3-6.3z"/></symbol>
    <symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 2 1 21h22Zm1 14h-2v2h2Zm0-7h-2v5h2Z"/></symbol>
    <symbol id="i-info" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2Zm0-8h-2V7h2Z"/></symbol>
    <symbol id="i-ruble" viewBox="0 0 24 24"><path d="M7 2v5H5v2h2v3H5v7h7.5c2.8 0 5-2.1 5-4.8S15.3 12 12.5 12H9V9h3.5c1.6 0 2.8 1 2.8 2.4S14.1 14 12.5 14H9v3h3.5c1 0 1.8.7 1.8 1.8s-.8 1.7-1.8 1.7H7V2H5v20h2V2Z"/></symbol>
    <symbol id="i-cal" viewBox="0 0 24 24"><path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2Zm12 8v10H5V10Z"/></symbol>
    <symbol id="i-metro" viewBox="0 0 24 24"><path d="M12 2C8 2 5 4.6 5 8.6v8.9A2.5 2.5 0 0 0 7.5 20h1v-2h7v2h1a2.5 2.5 0 0 0 2.5-2.5V8.6C19 4.6 16 2 12 2ZM7.6 15.4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm8.8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM17 9H7V8c0-2.4 1.9-4 5-4s5 1.6 5 4Z"/></symbol>
    <symbol id="i-wave" viewBox="0 0 24 24"><path d="M2 15.5c1.8 0 2.6 1.5 4.4 1.5s2.6-1.5 4.4-1.5 2.6 1.5 4.4 1.5 2.6-1.5 4.4-1.5V18c-1.8 0-2.6 1.5-4.4 1.5S13 18 11.2 18s-2.6 1.5-4.4 1.5S2.6 18 2 18Zm0-6c1.8 0 2.6 1.5 4.4 1.5S9 11 10.8 11s2.6 1.5 4.4 1.5 2.6-1.5 4.4-1.5V8c-1.8 0-2.6 1.5-4.4 1.5S13 8 11.2 8 8.6 6.5 6.8 6.5 2.6 8 2 8Z"/></symbol>
    <symbol id="i-tree" viewBox="0 0 24 24"><path d="M12 2 5.5 11H9l-4 6h6v5h2v-5h6l-4-6h3.5Z"/></symbol>
    <symbol id="i-share" viewBox="0 0 24 24"><path d="M18 16.1a3 3 0 0 0-2.1.8L8.9 13a3 3 0 0 0 0-2.1l7-3.8A3 3 0 1 0 15 5l-7 3.8a3 3 0 1 0 0 6.3l7 3.9a3 3 0 1 0 3-2.9Z"/></symbol>
    <symbol id="i-link" viewBox="0 0 24 24"><path d="M8.9 13.5h6.2v-2H8.9Zm11.3-4.3h-4v1.9h4a3.1 3.1 0 1 1 0 6.2h-4V19h4a5 5 0 0 0 0-10ZM7.8 15.3H4a3.1 3.1 0 0 1 0-6.2h3.8V7.2H4a5 5 0 0 0 0 10h3.8Z"/></symbol>
    <symbol id="i-chev" viewBox="0 0 24 24"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6Z"/></symbol>
    <symbol id="i-menu" viewBox="0 0 24 24"><path d="M3 6h18v2H3Zm0 5h18v2H3Zm0 5h18v2H3Z"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><path d="M10 2a8 8 0 1 0 4.9 14.3l5 5 1.4-1.4-5-5A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z"/></symbol>
    <symbol id="i-spark" viewBox="0 0 24 24"><path d="m12 2 1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9Zm6.5 10.5.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9Z"/></symbol>
    <symbol id="i-scale" viewBox="0 0 24 24"><path d="M12 3 3 7v2.4L12 13l9-3.6V7Zm-9 9.4V17l9 3.6 9-3.6v-4.6L12 16Z"/></symbol>
    <symbol id="i-key" viewBox="0 0 24 24"><path d="M14 2a6 6 0 0 0-5.6 8.2L2 16.6V22h5.4l1.5-1.5v-2h2l1.5-1.5v-2.2A6 6 0 1 0 14 2Zm3.5 6.5a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z"/></symbol>
  </svg>
"""

HEAD = """
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>НовостройкиПро — подбор новостроек под бюджет: Сочи, Москва, Екатеринбург</title>
  <meta name="description" content="Укажите город, бюджет и площадь — сервис покажет 3 ЖК с реальными лотами: цена входа, остаток бюджета, ипотечный платёж и причина отказа. 15 новостроек, цены и лоты сверены с realty.vbr.ru и m2.ru 15-16.11.2026." />
  <meta name="theme-color" content="#0d1c3a" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="НовостройкиПро" />
  <meta property="og:title" content="НовостройкиПро — какие новостройки вам по бюджету" />
  <meta property="og:description" content="Подбор по реальным лотам: цена входа, остаток бюджета, ипотечный платёж. 15 ЖК в Сочи, Москве и Екатеринбурге." />
  <meta property="og:image" content="https://zerosniper.github.io/realty-matcher-ai/images/sochi-polyana-pik.jpg" />
  <meta property="og:image:alt" content="ЖК «Поляна Пик», Сочи — фото фасада из карточки источника" />
  <meta property="og:site_name" content="НовостройкиПро" />
  <meta property="og:url" content="https://zerosniper.github.io/realty-matcher-ai/" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="canonical" href="https://zerosniper.github.io/realty-matcher-ai/" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231766e0'/%3E%3Cpath d='M8 22V12l8-5 8 5v10h-6v-6h-4v6z' fill='white'/%3E%3C/svg%3E" />
"""


def build():
    imgs = materialize_images()
    css = CSS
    data_js = (REPO / "app" / "data.js").read_text(encoding="utf-8")
    calc_js = (REPO / "app" / "calc.js").read_text(encoding="utf-8")
    app_js = (REPO / "app" / "app.js").read_text(encoding="utf-8")
    (REPO / "app" / "styles.css").write_text(css.strip() + "\n", encoding="utf-8")

    def wrap(scripts_css, scripts_js, photos_js=""):
        return ("<!DOCTYPE html>\n<html lang=\"ru\">\n<head>" + HEAD +
                "\n" + scripts_css + "\n</head>\n<body>\n" + ICONS + photos_js + BODY +
                "\n" + scripts_js + "\n</body>\n</html>\n")

    # 1) обычный сайт: внешние файлы (кэш, LCP, вес страницы)
    ext = wrap("<style>" + css + "</style>",
               "<script>\n" + data_js + "\n" + calc_js + "\n" + app_js + "\n</script>")
    (REPO / "index.html").write_text(ext, encoding="utf-8")

    # 2) standalone: всё внутри одного файла — открывается двойным кликом офлайн
    inline = wrap('<style>' + css + "</style>",
                  "<script>\n" + data_js + "\n" + calc_js + "\n" + app_js + "\n</script>",
                  "<script>window.ZHK_PHOTOS=" + json.dumps(B64, ensure_ascii=False) + ";</script>")
    (REPO / "index-standalone.html").write_text(inline, encoding="utf-8")

    print(f"images: {len(imgs)} файлов, {sum(s for _, s in imgs) // 1024} КБ суммарно")
    print(f"index.html          : {(REPO / 'index.html').stat().st_size / 1024:.1f} КБ")
    print(f"app/app.js          : {(REPO / 'app' / 'app.js').stat().st_size / 1024:.1f} КБ")
    print(f"app/calc.js         : {(REPO / 'app' / 'calc.js').stat().st_size / 1024:.1f} КБ")
    print(f"app/data.js         : {(REPO / 'app' / 'data.js').stat().st_size / 1024:.1f} КБ")
    print(f"app/styles.css      : {(REPO / 'app' / 'styles.css').stat().st_size / 1024:.1f} КБ")
    print(f"index-standalone.html: {(REPO / 'index-standalone.html').stat().st_size / 1024 / 1024:.2f} МБ")


if __name__ == "__main__":
    if not (REPO / "data" / "zhk.json").exists():
        sys.exit("Сначала соберите данные: python3 tools/build_data.py (или python3 v3_data.py в мастер-копии)")
    build()
