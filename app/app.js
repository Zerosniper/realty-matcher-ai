/*
 * app/app.js — интерфейс «НовостройкиПро».
 * Только DOM: вся логика подбора живёт в app/calc.js (и покрыта tests/calc.test.js).
 *
 * Как обновляется экран:
 *  · карточки создаются один раз на ЖК и переиспользуются (cardCache) — <img> не пересоздаётся,
 *    поэтому перерисовка на каждое изменение бюджета/метража не парсит заново фото;
 *  · меняются только textContent / className / style.width;
 *  · тяжёлые блоки (таблица, шпаргалка) пересобираются по событию, а не на каждый тик.
 */
(function () {
  "use strict";

  var DATA = window.ZHK_DATA || [];
  var C = window.ZHK_CALC;
  var $ = function (id) { return document.getElementById(id); };
  var CITY_PREP = { "Сочи": "в Сочи", "Москва": "в Москве", "Екатеринбург": "в Екатеринбурге" };
  var CLASS_FILTERS = ["Все", "Бизнес", "Премиум"];
  /* Настроение города: одна короткая строка про характер места + акцент в интерфейс.
     Числа рядом сервис берёт из данных, а не из этого словаря. */
  var CITY_MOOD = {
    "Сочи": {
      slug: "sochi", accent: "#0d7d6b", soft: "#e6f4f0", lit: "#4ad6ae",
      mood: "море, горы и субтропическая зелень",
      lead: "Сочи — это курорт в узкой полосе между морем и горами: кварталы здесь читаются по виду: море, парк, панорама, а не по этажности. Дворы чаще закрытые, часть объектов — уже сданные.",
      hint: "Смотрите Хостинский и Уч-Дере — там тише и зеленее; Курортный Городок — если хочется дойти до пляжа пешком."
    },
    "Москва": {
      slug: "msk", accent: "#1a4fd6", soft: "#e8eefc", lit: "#8fb0ff",
      mood: "деловой центр, набережные и крупные квартальные операторы",
      lead: "Москва в этом срезе — про плотную городскую ткань: крупные девелоперы, дворы без машин, рядом парки и вода. Метр здесь дороже, чем в двух других городах среза, и это единственный город, где премиум уходит за 2 млн ₽/м².",
      hint: "Печатники и Хорошёво-Мнёвники — кварталы у воды; ЦАО — если важен адрес, а не метраж: там вход от 161 млн."
    },
    "Екатеринбург": {
      slug: "ekb", accent: "#9a5a12", soft: "#f8efe4", lit: "#e8b268",
      mood: "суровый климат, красивые зимы и набережные Исети",
      lead: "Екатеринбург — город крепких квартальных структур: набережные, парки, виды на воду и самый доступный метр в нашем срезе. Здесь реально взять 60 м² за 16 млн и получить готовый дом.",
      hint: "Чкаловский (м. Чкаловская) и ВИЗ — набережная и транспорт; Октябрьский — выход в ЦПКиО прямо из двора."
    }
  };
  function theme(c) { return CITY_MOOD[c] || { slug: "", accent: "#1766e0", soft: "#eef3fb", lit: "#7fa8ff", mood: "", lead: "", hint: "" }; }
  /* lit — светлый вариант акцента: на тёмном фоне аналитической графики --city-accent нечитаем. */

  /* state — то, что пользователь набирает в панели (черновик).
     V     — то, что подтверждено кнопкой «Подобрать новостройку»: по ней нарисованы
             вердикт, карточки и список. Пока кнопки не было, V = null и результаты скрыты:
             ввод параметров никуда не ведёт и ничего не перематывает. */
  var state = { city: "Сочи", budget: 25, budgetRub: 25000000, area: 45, klass: "Все", query: "", district: "", intents: [] };
  var V = null;
  var cardCache = new Map();
  var saved = [];      // «В подборку» — сравнение + заявка
  var last = null;     // последний результат match()

  /* ------------------------------------------------------------------ утилиты */
  function parseNum(v) { return typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); }
  function clamp(v, a, b) { v = parseNum(v); return isNaN(v) ? a : Math.min(b, Math.max(a, v)); }
  function money(v) {
    var s = dec(v);
    if (s.indexOf(",") < 0) return s;               // целое: 140 -> "140", не "14"
    return s.replace(/0+$/, "").replace(/,$/, "");  // 27,50 -> "27,5"
  }
  function num(v, d) { return (d ? Number(v).toFixed(d) : String(Math.round(v))).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function mln(v) { return (Math.round(v * 100) / 100).toFixed(2).replace(".", ",") + " млн ₽"; }
  function dec(v) { return String(Math.round(v * 100) / 100).replace(".", ","); }
  function icon(name) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cityList(c) { return DATA.filter(function (z) { return z.city === c; }); }
  function cities() { var s = []; DATA.forEach(function (z) { if (s.indexOf(z.city) < 0) s.push(z.city); }); return s; }
  function capBudget() {
    var v = V || state;
    var q = C.parseQuery(v.query);
    return q.budgetMax ? Math.min(v.budget, q.budgetMax) : v.budget;
  }

  /* Параметры для calc.js из набора p (черновика или применённого).
     Галочки расширенных настроек попадают в тот же q.intents, что и слова запроса, —
     поэтому чип «у метро» и напечатанное «у метро» дают ровно один и тот же фильтр. */
  function params(p) {
    var q = C.parseQuery(p.query || "");
    (p.intents || []).forEach(function (k) { if (q.intents.indexOf(k) < 0) q.intents.push(k); });
    return { city: p.city, budgetMln: p.budget, areaM2: p.area, klass: p.klass, district: p.district || "", query: q };
  }

  /* поле бюджета живёт в рублях, модель — в миллионах */
  function parseRub(v) { var d = String(v == null ? "" : v).replace(/[^0-9]/g, ""); return d ? parseInt(d, 10) : 0; }
  function snapRub(v) { return Math.round(clamp(v, 1000000, 400000000) / 100000) * 100000; }
  function rubToMln(v) { return Math.round(clamp(v, 1000000, 400000000) / 10000) / 100; }
  function rubTxt(v) { return num(v); }

  /* ------------------------------------------------------------------ шапка: город */
  function buildCityUI() {
    var tabs = $("cityTabs"), menu = $("cityDDMenu");
    tabs.innerHTML = ""; menu.innerHTML = "";
    cities().forEach(function (c) {
      var list = cityList(c), t = theme(c);
      var entry = list.length ? Math.min.apply(null, list.map(function (z) { return z.minLotMln; })) : 0;
      var b = document.createElement("button");
      b.type = "button"; b.className = "city-card"; b.dataset.city = c;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(c === state.city));
      b.tabIndex = c === state.city ? 0 : -1;
      b.style.setProperty("--cc", t.accent); b.style.setProperty("--cc-soft", t.soft);
      b.innerHTML =
        '<span class="city-art" aria-hidden="true">' + artCity(c) + '</span>' +
        '<span class="city-name">' + esc(c) + "</span>" +
        '<span class="city-mood">' + esc(t.mood) + "</span>" +
        '<span class="city-meta"><i>' + list.length + " ЖК</i><i>вход от " + dec(entry) + " млн</i></span>";
      b.addEventListener("click", function () { setCity(c); });
      tabs.appendChild(b);

      var m = document.createElement("button");
      m.type = "button"; m.setAttribute("role", "menuitem"); m.dataset.city = c;
      m.innerHTML = "<span>" + esc(c) + "</span><small>" + list.length + " ЖК · вход от " + dec(entry) + " млн</small>";
      m.addEventListener("click", function () { setCity(c); cityMenu(false); });
      menu.appendChild(m);
    });
    syncCityUI();
    tabs.addEventListener("keydown", function (e) {
      var list = [].slice.call(tabs.querySelectorAll("button"));
      var i = list.indexOf(document.activeElement);
      if (i < 0 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      e.preventDefault();
      var j = (i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length;
      list[j].focus(); list[j].click();
    });
  }

  /* Кнопки класса: состояние «нажата» берётся из state.klass — один источник правды. */
  function markKlass() {
    [].forEach.call(document.querySelectorAll("[data-klass]"), function (x) {
      x.setAttribute("aria-pressed", String(x.dataset.klass === state.klass));
    });
  }

  function syncCityUI() {
    [].forEach.call($("cityTabs").querySelectorAll("button"), function (b) {
      var on = b.dataset.city === state.city;
      b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
    });
    [].forEach.call($("cityDDMenu").querySelectorAll("button"), function (b) {
      b.setAttribute("aria-current", String(b.dataset.city === state.city));
    });
    $("cityDDLabel").textContent = state.city;
    renderCityChipsList();
  }

  /* ------------------------------------------------------------------ режимы (вкладки)
     «Подбор по бюджету» — форма и результат подбора; «Все новостройки» — список, который можно
     смотреть совсем без подбора; «Сохранённое» — сравнение и готовые сценарии. Переключение режима
     ничего не считает, никуда не прокручивает и не трогает введённые значения. */
  var pane = "pick";
  var appliedOnce = false;                    /* подбор ещё не нажимали — показывать нечего */
  var PANE_TARGETS = { pick: ["results"], list: ["market"], saved: ["savedBlock"] };
  function setPane(name) {
    if (!PANE_TARGETS[name]) return;
    pane = name;
    var fnd = $("finder");
    if (fnd) fnd.hidden = (name !== "pick");     /* в списке и в сохранённом форма не мешает */
    [].forEach.call(["pick", "list", "saved"], function (n) {
      (PANE_TARGETS[n] || []).forEach(function (id) {
        var e = $(id);
        if (!e) return;
        var show = (n === name) && (id !== "results" || appliedOnce);
        e.hidden = !show;
      });
      var tab = $("tab" + n.charAt(0).toUpperCase() + n.slice(1));
      if (tab) { tab.classList.toggle("is-on", n === name); tab.setAttribute("aria-selected", String(n === name)); }
    });
  }
  function syncTabs() {
    var t = $("tabListCount");
    if (t) t.textContent = String(mktAll ? DATA.length : cityList(state.city).length);
    var t2 = $("tabSavedCount");
    if (t2) t2.textContent = String(saved.length);
  }
  /* Если панель-результат уехала за экран — мягко подтягиваем её край; с места не прыгаем. */
  function revealPane(id) {
    var el = $(id);
    if (!el || el.hidden) return;                 /* показывать нечего — страницу не трогаем */
    var r = el.getBoundingClientRect();
    if (!r.height) return;
    if (r.top < 60 && r.bottom > 160) return;
    if (r.top > window.innerHeight * 0.7 || r.bottom < 80) {
      window.scrollTo({ top: Math.max(0, r.top + window.scrollY - 74), behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }
  function bindPanes() {
    ["pick", "list", "saved"].forEach(function (n) {
      var tab = $("tab" + n.charAt(0).toUpperCase() + n.slice(1));
      if (tab) tab.addEventListener("click", function () {
        if (n === "list") renderMarket();
        setPane(n);
        revealPane(PANE_TARGETS[n][0]);
      });
    });
  }

  /* Тот же выбор города, но чипами — внутри списка: переключать город можно, не возвращаясь в панель. */
  function renderCityChipsList() {
    var host = $("cityTabsList");
    if (!host) return;
    host.innerHTML = cities().map(function (c) {
      return '<button class="chip" type="button" data-city="' + esc(c) + '" aria-pressed="' + (c === state.city) + '">' +
        esc(c) + " · " + cityList(c).length + " ЖК</button>";
    }).join("");
  }

  var moodCity = null;
  /* Клик по городу = только выбор: подсветка, тема, сводка, районы. Никакой прокрутки —
     список вариантов появится по кнопке «Подобрать новостройку». */
  function setCity(c) {
    var changed = c !== state.city;
    state.city = c;
    state.district = "";                 // районы другого города не имеют смысла
    syncCityUI();
    renderDistrictChips();
    renderIntentToggles();
    if (changed) {
      $("panel").classList.add("city-switch");
      setTimeout(function () { $("panel").classList.remove("city-switch"); }, 620);
    }
    preview();
  }

  /* Настроение города: 3 факта из данных + до 3 «выгодных» сценария. */
  function cityFacts(c) {
    var list = cityList(c);
    if (!list.length) return { facts: [], deals: [] };
    var ppms = list.map(function (z) { return z.pricePerM2; });
    var done = list.filter(function (z) { return z.deliveryYearTo && z.deliveryYearTo <= 2026; });
    var cheap = list.slice().sort(function (a, b) { return a.minLotMln - b.minLotMln; })[0];
    var wide = list.slice().sort(function (a, b) { return (b.offers || 0) - (a.offers || 0); })[0];
    var facts = [
      { k: "метр в срезе", v: num(Math.min.apply(null, ppms) / 1000) + "–" + num(Math.max.apply(null, ppms) / 1000) + " тыс. ₽" },
      { k: "самый дешёвый вход", v: mln(cheap.minLotMln) + " · " + cheap.name.replace(/^(ЖК|ГК) /, "") },
      { k: "выбор лотов", v: (wide.offers || "н/д") + " лотов · " + wide.name.replace(/^(ЖК|ГК) /, "") },
      { k: "сдано до конца 2026", v: done.length + " из " + list.length }
    ];
    var deals = list.slice().sort(function (a, b) { return a.minLotMln - b.minLotMln; }).slice(0, 3).map(function (z) {
      var a = z.lots && z.lots.length ? z.lots[0] : null;
      return {
        label: z.name.replace(/^(ЖК|ГК) /, "") + " · " + mln(z.minLotMln) + (a ? " · " + dec(a.minAreaM2) + " м²" : ""),
        scene: { city: c, budget: Math.max(1, Math.ceil(z.minLotMln * 1.35)), area: a ? Math.round(a.minAreaM2 + 6) : 45, klass: "Все", q: "" }
      };
    });
    return { facts: facts, deals: deals };
  }

  function renderMood() {
    var c = state.city, t = theme(c), host = $("cityMood");
    if (!host) return;
    document.body.dataset.city = t.slug || "";
    document.documentElement.style.setProperty("--city-accent", t.accent);
    document.documentElement.style.setProperty("--city-soft", t.soft);
    var f = cityFacts(c);
    $("moodLead").textContent = t.lead;
    var mhHint = $("moodHint"); if (mhHint) mhHint.textContent = t.hint;
    $("moodFacts").innerHTML = f.facts.map(function (x) {
      return '<span class="fact"><i>' + esc(x.k) + "</i><b>" + esc(x.v) + "</b></span>";
    }).join("");
    $("moodDeals").innerHTML = f.deals.length
      ? "<b>Что выгодно посмотреть:</b>" + f.deals.map(function (d, i) {
          return '<button class="chip deal" type="button" data-deal="' + i + '">' + esc(d.label) + "</button>";
        }).join("") + '<span class="field-note" style="margin:0">бюджет в сценарии = вход + 35% запаса</span>'
      : "";
    host._deals = f.deals;
    renderHeroArt();
    if (moodCity !== c) {
      moodCity = c;
      host.classList.remove("in");
      void host.offsetWidth;
      host.classList.add("in");
    }
  }

  /* Подсказка под полем бюджета: на сколько ЖК хватает уже на входе. */
  function renderBudgetHint() {
    var el = $("budgetTypeHint");
    if (!el) return;
    var list = cityList(state.city);
    if (!list.length) { el.textContent = ""; return; }
    var min = Math.min.apply(null, list.map(function (z) { return z.minLotMln; }));
    var fit = list.filter(function (z) { return z.minLotMln <= state.budget; }).length;
    el.textContent = state.budget < min
      ? "В " + (CITY_PREP[state.city] || state.city) + " самый дешёвый вход — " + rubTxt(min * 1000000) + " ₽.Ниже напишу, на сколько не хватает."
      : "На вход этого хватает уже в " + fit + " из " + list.length + " ЖК — дальше решает площадь и срок сдачи.";
  }

  function bindMood() {
    var host = $("cityMood");
    if (!host) return;
    $("moodDeals").addEventListener("click", function (e) {
      var b = e.target.closest("[data-deal]");
      if (!b || !host._deals) return;
      var d = host._deals[parseInt(b.dataset.deal, 10)];
      if (d) applyScene(d.scene, true);
    });
  }

  function cityMenu(open) {
    $("cityDD").dataset.open = String(open);
    $("cityDDBtn").setAttribute("aria-expanded", String(open));
  }

  /* ------------------------------------------------------------------ карточка ЖК */
  function cardMarkup() {
    return '' +
      '<div class="card-media">' +
        '<div class="card-art" data-r="art" role="img"></div>' +
        '<div class="card-ribbon"><span class="badge" data-r="cls"></span><span class="badge" data-r="state"></span></div>' +
        '<div class="card-loc">' + icon("pin") + '<span data-r="loc"></span></div>' +
      "</div>" +
      '<div class="card-body">' +
        '<h3 class="card-name" data-r="name"></h3>' +
        '<p class="card-dev" data-r="dev"></p>' +
        '<div class="price-box">' +
          '<div class="price-line"><b data-r="price"></b><em data-r="priceCap"></em></div>' +
          '<div class="price-range" data-r="range"></div>' +
          '<div class="meter"><i data-r="meter"></i></div>' +
          '<div class="thermo-legend"><span>0</span><span data-r="meterLabel"></span><span data-r="meterBudget"></span></div>' +
          '<details class="price-how"><summary>' + icon("info") + " Как считали эту цену</summary><p data-r=\"how\"></p></details>" +
        "</div>" +
        '<div class="verdict-line"><span data-r="vicon"></span><span data-r="verdict"></span></div>' +
        '<div class="mortgage" data-r="mortWrap">' +
          "<div>" + icon("ruble") + ' Ипотека: <b data-r="mort"></b> · <span data-r="mortNote"></span></div>' +
          '<div class="fine" data-r="mortFine"></div>' +
        "</div>" +
        '<dl class="specs">' +
          "<dt>Срок сдачи</dt><dd data-r=\"delivery\"></dd>" +
          "<dt>Максимум на ваш бюджет</dt><dd data-r=\"maxarea\"></dd>" +
          "<dt>Лотов в продаже</dt><dd data-r=\"offers\"></dd>" +
          "<dt>Цена зафиксирована</dt><dd data-r=\"asof\"></dd>" +
          "<dt>Особенность</dt><dd data-r=\"feature\"></dd>" +
        "</dl>" +
        '<div class="score" data-r="scoreWrap"><b data-r="score"></b><span class="score-bar"><i data-r="scoreBar"></i></span><span data-r="scoreWhy"></span></div>' +
        '<div class="card-actions">' +
          '<a class="btn-src" target="_blank" rel="noopener" data-r="link" href="#">' + icon("link") + '<span data-r="src"></span></a>' +
          '<button class="btn-lead" type="button" data-r="save">' + icon("check") + " В подборку</button>" +
        "</div>" +
      "</div>";
  }

  function createCard(z) {
    var el = document.createElement("article");
    el.className = "card";
    el.dataset.id = z.id;
    el.innerHTML = cardMarkup();
    var refs = { root: el };
    [].forEach.call(el.querySelectorAll("[data-r]"), function (n) { refs[n.dataset.r] = n; });
    return refs;
  }

  function updateCard(refs, r, isBest) {
    var z = r.zhk, e = r.estimate, k = refs;

    k.root.className = "card" +
      (isBest && r.status === "fits" ? " card--best" : "") +
      (z.zhkClass === "Премиум" ? " card--premium" : "") +
      (r.status === "fits" || r.status === "tight" ? "" : " card--excluded");

    /* Вместо фотографии дома — рисованная аналитика: цены по типам лотов и календарь
       срока сдачи. Обе части собраны из полей источника, ни одна цифра не придумана. */
    var artKey = z.id + "|" + (V ? V.area : V.area) + "|" + r.status;
    if (k.art.dataset.key !== artKey) {
      k.art.dataset.key = artKey;
      k.art.innerHTML = artCard(z, r);
      k.art.setAttribute("aria-label", z.name + ": аналитика — цены по типам лотов и срок сдачи (данные " + z.sourceName + ")");
    }

    k.cls.textContent = (z.zhkClass === "Премиум" ? "Премиум" : "Бизнес") + "-класс";
    k.cls.className = "badge" + (z.zhkClass === "Премиум" ? " badge--brass" : "");

    k.state.className = "badge" + (r.status === "fits" ? " badge--ok" : r.status === "tight" ? " badge--warn" : " badge--bad");
    k.state.textContent = isBest && r.status === "fits" ? "Оптимальный выбор"
      : r.status === "fits" ? "Проходит в бюджет"
      : r.status === "tight" ? "На пределе бюджета"
      : r.status === "over" ? "Дороже вашего бюджета"
      : "Нет таких площадей";

    k.loc.textContent = z.district;
    k.name.textContent = z.name;
    k.dev.textContent = "Застройщик: " + z.developer + " · " + (z.offers ? z.offers + " лотов в продаже" : "наличие уточняется в отделе продаж");

    if (e.available) {
      k.price.textContent = "от " + mln(e.costMln);
      k.priceCap.textContent = "за " + V.area + " м² · " + e.group.type.toLowerCase();
      k.range.innerHTML = "до " + mln(e.costToMln) + " по верхней границе" +
        (z.pricePerM2Avg ? " · средняя цена метра по ЖК " + num(z.pricePerM2Avg) + " ₽" : "");
      k.how.innerHTML =
        "Считаем не по «цене от за м²» комплекса: так агрегатор показывает метр самого дешёвого лота (обычно большого, углового или без вида). " +
        "Берём цену метра фактического минимального лота нужной категории: в «" + esc(z.name) + "» " + esc(e.group.type).toLowerCase() +
        " — от " + dec(e.group.minAreaM2) + " м² за " + mln(e.group.fromMln) + ", то есть <b>" + num(e.entryPpm) + " ₽/м²</b>. Ваш метраж: " +
        V.area + " м² × " + num(e.entryPpm) + " ₽ = <b>" + mln(e.costMln) + "</b>." +
        (e.understatePct > 3
          ? "<br /><br />По формуле «цена от × площадь» получилось бы <b>" + mln(e.naiveMln) + "</b> — на " + e.understatePct +
            "% ниже реальной цены входа. Таких квартир в продаже нет, поэтому мы так не обещаем."
          : "") +
        " Точную цену лота подтверждает застройщик по ссылке ниже.";
      var pct = Math.round(e.costMln / capBudget() * 100);
      k.meter.style.width = Math.max(3, Math.min(100, pct)) + "%";
      k.meter.className = pct > 100 ? "bad" : pct > 85 ? "warn" : "";
      k.meterLabel.textContent = pct + "% бюджета";
    } else {
      var floorPrice = z.minLotMln || e.minLotPriceMln || 0;
      k.price.textContent = "от " + mln(floorPrice);
      k.priceCap.textContent = "минимальный лот в ЖК";
      k.range.innerHTML = "Квартир " + V.area + " м² и меньше в продаже <b>нет</b>: самая маленькая — " +
        (e.minAreaM2 ? dec(e.minAreaM2) + " м²" : "—") + " за " + mln(floorPrice);
      k.how.textContent = "Мы не показываем цену несуществующей квартиры: " + e.reason + ". Источник: " + z.sourceName + ", цена зафиксирована " + z.priceAsOf + ".";
      k.meter.style.width = "100%";
      k.meter.className = "bad";
      k.meterLabel.textContent = "не влезает";
    }
    k.meterBudget.textContent = "бюджет " + money(capBudget()) + " млн ₽";

    var verdict = k.verdict, mark = k.vicon;
    k.verdict.parentNode.className = "verdict-line " +
      (r.status === "fits" ? "ok" : r.status === "tight" ? "warn" : r.status === "over" ? "bad" : "na");
    if (r.status === "fits") {
      mark.innerHTML = icon("check");
      verdict.innerHTML = "Хватает: в запасе <b>" + mln(r.reserve) + "</b> — например, на ремонт, мебель или паркинг";
    } else if (r.status === "tight") {
      mark.innerHTML = icon("warn");
      verdict.innerHTML = "Проходит впритык: <b>" + mln(r.cost) + "</b> из " + capBudget() + " млн ₽ — запаса нет, торговаться придётся сразу";
    } else if (r.status === "over") {
      mark.innerHTML = icon("x");
      verdict.innerHTML = "Не хватает <b>" + mln(r.need) + "</b> — " + C.budgetVerdict(capBudget(), r.need) + "." +
        (r.naiveTrap ? " По «цена от × площадь» прошло бы (" + mln(r.estimate.naiveMln) + "), но такого лота нет в продаже." : "");
    } else {
      mark.innerHTML = icon("info");
      verdict.innerHTML = capFirst(esc(r.reason)) + ". Значит, " + V.area + " м² здесь купить нельзя — и мы не рисуем «вам хватает».";
    }

    if (e.available && r.cost) {
      var m = C.mortgage(r.cost, { downPct: 20, ratePct: 6, years: 20 });
      k.mortWrap.hidden = false;
      k.mort.textContent = num(m.monthly) + " ₽/мес";
      k.mortNote.textContent = "взнос " + mln(r.cost * 0.2) + ", срок 20 лет";
      k.mortFine.textContent = "Аннуитет, ставка 6% (льготная из карточки источника: «Ипотека для ИТ-специалистов от 6%»). Переплата " +
        num(m.overpay / 1e6) + " млн ₽. Рыночную ставку и доступность льготы уточняйте в банке.";
    } else {
      k.mortWrap.hidden = true;
    }

    k.delivery.textContent = z.delivery || "—";
    k.maxarea.textContent = e.available
      ? "до " + Math.floor(capBudget() * 1e6 / Math.max(e.entryPpm, 1)) + " м² по цене метра этого лота"
      : "— (минимум " + (e.minAreaM2 ? dec(e.minAreaM2) + " м²" : "н/д") + ")";
    k.offers.textContent = (z.offers ? z.offers + " лотов" : "уточняется") + " · класс в источнике: «" + (z.classSource || "—") + "»";
    k.asof.textContent = z.priceAsOf || "15.11.2026";
    k.feature.textContent = z.feature;

    if (r.score) {
      k.scoreWrap.hidden = false;
      k.score.textContent = "совпадение " + r.score + "%";
      k.scoreBar.style.width = r.score + "%";
      k.scoreWhy.textContent = scoreWhy(r);
    } else {
      k.scoreWrap.hidden = true;
    }

    k.link.href = z.sourceUrl;
    k.src.textContent = "Квартиры на " + z.sourceName;
    var inList = saved.indexOf(z.name) >= 0;
    k.save.innerHTML = icon(inList ? "check" : "scale") + (inList ? " В подборке" : " В подборку");
    k.save.onclick = function () { toggleSaved(z.name); };
  }

  function floorOf(z) { return z.minLotMln || (z.lots[0] && z.lots[0].fromMln) || 0; }
  function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function scoreWhy(r) {
    var best = r.scoreParts.slice().sort(function (a, b) { return b.points / b.weight - a.points / a.weight; })[0];
    var weak = r.scoreParts.slice().sort(function (a, b) { return a.points / a.weight - b.points / b.weight; })[0];
    return "Сильнее всего — " + best.label.toLowerCase() + " (" + Math.round(best.points) + "/" + best.weight +
      "), слабее — " + weak.label.toLowerCase() + " (" + Math.round(weak.points) + "/" + weak.weight + ")";
  }

  /* ------------------------------------------------------------------ вердикт + термометр */
  function renderVerdict(res) {
    var v = $("verdict"), prep = CITY_PREP[V.city] || ("в " + V.city);
    var capNote = res.queryCapApplied
      ? " Считаю по потолку из запроса: " + money(res.capMln) + " млн ₽ (в поле бюджета указано " + money(V.budget) + " млн)." : "";
    var head, sub;
    var narrowed = res.cityCountAll > res.cityCount
      ? "Ваши слова оставили " + res.cityCount + " из " + res.cityCountAll + " ЖК " + prep + " — остальные не подходят по тексту карточки. " : "";
    if (!res.cityCount && res.cityCountAll) {
      head = "Со словами запроса не совпал ни один ЖК " + prep;
      sub = "Всего в базе по этому городу " + res.cityCountAll + " ЖК, но в их описаниях нет того, что вы написали. " +
        "Нажмите «Сбросить» — расчёт останется на обычных полях бюджета и метража, или попробуйте слова, которые в карточках встречаются: " +
        "море, парк, метро, «сдан», отделка.";
    } else if (!res.cityCount) {
      head = "Нет данных по городу «" + V.city + "»";
      sub = "В базе 15 ЖК: " + cities().join(", ") + ".";
    } else if (res.fittingCount === 0) {
      var cheap = res.cheapest ? res.cheapest.entryFloor : null;
      head = "В бюджете " + money(res.capMln) + " млн ₽ подходящих ЖК " + prep + " нет";
      var off = [];
      if (V.klass !== "Все") off.push('класс «' + V.klass.toLowerCase() + '»');
      if (V.district) off.push('район «' + V.district + '»');
      if (V.intents && V.intents.length) off.push('галочки «что важно рядом»');
      if (V.query) off.push('слова запроса');
      sub = "Самый дешёвый вход " + prep + (V.klass !== "Все" ? " в классе «" + V.klass.toLowerCase() + "»" : "") +
        (V.district ? ", район " + V.district : "") + " — " +
        (cheap ? mln(cheap) + " (" + esc(res.cheapest.zhk.name) + ")" : "не найден") +
        "." + capNote + " " + narrowed +
        (off.length ? " Снимите фильтр — " + off.join(", ") + " — или увеличьте бюджет."
                    : " Увеличьте бюджет или выберите другой город.");
    } else if (res.fittingCount >= res.cityCount) {
      head = "Все " + res.fittingCount + " ЖК " + prep +
        (res.cityCountAll > res.cityCount ? " (из " + res.cityCountAll + " в базе — остальные отсекает запрос)" : "") +
        " проходят в бюджет " + money(res.capMln) + " млн ₽";
      sub = "Зелёным помечены комплексы, где квартир нужной площади хватает и цена входа ниже бюджета. Лидер отобран по скорингу, а не по цене: см. «совпадение» в карточке.";
    } else {
      head = res.fittingCount + " из " + res.cityCount + " ЖК " + prep + " реально проходят в бюджет " + money(res.capMln) + " млн ₽";
      sub = narrowed + "Остальные — ниже, с причиной: «не хватает N млн» или «нет квартир такой площади». " +
        "Цена входа в карточках посчитана по реальному лоту, а не по «цене от за м²»." + capNote;
    }

    /* Не подошло ничего? Предлагаем одно конкретное действие, которое действительно что-то меняет. */
    var lift = null, areaFix = null;
    if (res.fittingCount === 0) {
      var overRows = res.all.filter(function (r) { return r.status === "over" && r.cost; });
      var unavRows = res.all.filter(function (r) { return r.status === "unavailable"; });
      if (overRows.length) {
        var need = Math.ceil(Math.min.apply(null, overRows.map(function (r) { return r.cost; })) * 1.08);
        if (need > res.capMln && need <= 400) lift = need;
      } else if (unavRows.length) {
        var minA = Math.min.apply(null, cityList(V.city).map(function (z) { return z.minAreaM2 || 999; }));
        if (minA < V.area) areaFix = Math.round(minA + 2);
      }
    }
    var leader = res.top[0];
    var pct = leader ? Math.min(100, Math.round(leader.cost / res.capMln * 100)) : 100;
    var reserve = leader ? leader.reserve : 0;
    v.innerHTML = '<div><h2>' + esc(head) + "</h2><p>" + sub + "</p>" +
      '<div class="v-pills">' +
        '<div class="v-pill"><span>Ваш запрос</span><b>' + V.area + " м² · " + money(res.capMln) + " млн ₽" + (V.klass !== "Все" ? " · " + V.klass.toLowerCase() : "") + "</b></div>" +
        '<div class="v-pill"><span>Проходит в бюджет</span><b>' + res.fittingCount + " из " + res.cityCount + " ЖК</b></div>" +
        (lift ? '<button class="v-pill lift" type="button" id="liftBudget" data-to="' + lift + '">' +
                "<span>Поднять бюджет до</span><b>" + lift + " млн ₽</b></button>" : "") +
        (areaFix ? '<button class="v-pill lift" type="button" id="fixArea" data-area-to="' + areaFix + '">' +
                "<span>Искать метраж от</span><b>" + areaFix + " м²</b></button>" : "") +
        '<div class="v-pill"><span>Ваш порог за м²</span><b>до ' + num(res.maxAffordablePpm) + " ₽</b></div>" +
      "</div></div>" +
      '<div class="thermo">' +
        '<div class="thermo-top"><span>Термометр бюджета' + (leader ? " · " + esc(leader.zhk.name) : "") + "</span><b>" + pct + "%</b></div>" +
        '<div class="thermo-track"><div class="thermo-fill ' + (pct >= 100 ? "bad" : pct > 85 ? "warn" : "") + '" style="width:' + pct + '%"></div>' +
          '<div class="thermo-ticks"><i style="left:25%"></i><i style="left:50%"></i><i style="left:75%"></i></div></div>' +
        '<div class="thermo-legend"><span>0</span><span>' + money(res.capMln / 2) + " млн</span><span>" + money(res.capMln) + " млн (100%)</span></div>" +
        '<div style="font-size:11.8px;color:var(--text-muted);margin-top:7px">' +
          (leader
            ? (reserve > 0.001 ? "После покупки останется <b>" + mln(reserve) + "</b> — на ремонт, мебель или паркинг." : "Ни копейки запаса — берите следующий вариант по списку.")
            : "Ни один вариант не уложился в бюджет — шкала показывает, насколько пришлось бы её перегрузить.") +
        "</div>" +
      "</div>";
  }

  /* ------------------------------------------------------------------ карточки */
  function syncCards(host, list, makeBest) {
    var keep = new Set();
    list.forEach(function (r, i) {
      keep.add(r.zhk.id);
      var refs = cardCache.get(r.zhk.id);
      if (!refs) { refs = createCard(r.zhk); cardCache.set(r.zhk.id, refs); }
      updateCard(refs, r, makeBest && i === 0);
      host.appendChild(refs.root);
    });
    [].slice.call(host.children).forEach(function (el) { if (!keep.has(el.dataset.id)) host.removeChild(el); });
  }

  /* ------------------------------------------------------------------ подсказки панели */
  function intentLabel(k) {
    for (var i = 0; i < C.INTENTS.length; i++) if (C.INTENTS[i].key === k) return C.INTENTS[i].label;
    return INTENT_LABELS[k] || k;
  }

  function renderPanelHints(res) {
    var list = cityList(state.city);
    var ppms = list.map(function (z) { return z.pricePerM2; });
    $("cityCountHint").textContent = list.length + " ЖК в базе";
    $("cityPriceNote").textContent = "Цены " + (CITY_PREP[state.city] || state.city) + ": от " + num(Math.min.apply(null, ppms) / 1000) +
      " тыс. до " + num(Math.max.apply(null, ppms) / 1000) + " тыс. ₽/м² · класс у 15 из 15 ЖК взят из поля источника";
    var minA = Math.min.apply(null, list.map(function (z) { return z.minAreaM2 || 999; }));
    $("maxPpmHint").textContent = minA && minA < 900 ? "в базе есть лоты от " + dec(minA) + " м²" : "";
    $("budgetPctHint").textContent = "при " + state.area + " м² это " + num(res.capMln * 1e6 / state.area) + " ₽ за м²";
    if (document.activeElement !== $("budgetRub")) $("budgetRub").value = rubTxt(state.budgetRub);   // не перетирать, пока печатают
    $("budgetEcho").textContent = "= " + money(state.budget) + " млн ₽";

    var fit = res.fittingCount;
    $("goCount").textContent = fit;
    $("ctaCount").textContent = fit ? "Есть подходящие варианты: " + fit + " из " + res.cityCount : "Подходящих не нашлось: 0 из " + res.cityCount;
    var want = (state.intents || []).map(intentLabel);
    $("ctaNote").textContent = state.city + " · " + rubTxt(state.budgetRub) + " ₽ · " + state.area + " м²" +
      (state.district ? " · " + state.district : "") + (want.length ? " · " + want.join(" + ") : "") +
      (state.klass !== "Все" ? " · " + state.klass.toLowerCase() : "");
    $("marketBtnCount").textContent = list.length;
    renderMood();
    renderBudgetHint();
    renderIntent(res.query, res);
  }

  var INTENT_LABELS = { sea: "у моря", park: "у парка", school: "школа и сад рядом", metro: "у метро", done: "уже сданные", soon: "сдача в 2026", studio: "студия", one: "1 комната", two: "2 комнаты", three: "3 комнаты", premium: "премиум", business: "бизнес", finishing: "с отделкой" };

  function renderIntent(q, res) {
    var host = $("intentChips");
    var bits = [];
    (q.intents || []).forEach(function (k) { if (INTENT_LABELS[k]) bits.push(INTENT_LABELS[k]); });
    if (q.city) bits.push(q.city);
    if (q.budgetMax) bits.push("бюджет до " + q.budgetMax + " млн");
    if (q.budgetMin) bits.push("бюджет от " + q.budgetMin + " млн");
    if (q.rooms != null && !q.areaStated) {
      bits.push((q.rooms === 0 ? "студия" : q.rooms + "-комн.") + " — значит до " + q.areaMax + " м²");
    } else if (q.areaMax) {
      bits.push("площадь до " + q.areaMax + " м² (вы написали)");
    }
    if (q.klass) bits.push("класс " + q.klass.toLowerCase() + " (из запроса)");
    if (res.params && res.params.district) bits.push("район: " + res.params.district);
    if (!bits.length) { host.innerHTML = state.query ? "<b>Ничего конкретного в запросе не нашёл — считаются поля бюджета и метража.</b>" : ""; return; }
    host.innerHTML = "<b>Понял запрос так:</b>" + bits.map(function (b) { return '<span class="chip">' + esc(b) + "</span>"; }).join("") +
      '<span class="chip" style="border-style:dashed">подошло ' + res.fittingCount + " из " + res.cityCount + " ЖК" +
        (res.cityCountAll > res.cityCount ? " (в городе " + res.cityCountAll + ", остальным не соответствуют слова запроса)" : "") + "</span>";
  }

  /* ------------------------------------------------------------------ аналитика */
  function renderSheet() {
    $("sheet").innerHTML = cities().map(function (c) {
      var l = cityList(c);
      var p = l.map(function (z) { return z.pricePerM2; });
      var avg = function (arr) { return arr.length ? Math.round(arr.reduce(function (s, z) { return s + z.pricePerM2; }, 0) / arr.length) : 0; };
      var biz = l.filter(function (z) { return z.zhkClass === "Бизнес"; });
      var prem = l.filter(function (z) { return z.zhkClass === "Премиум"; });
      var entry = Math.min.apply(null, l.map(function (z) { return z.minLotMln; }));
      var minA = Math.min.apply(null, l.map(function (z) { return z.minAreaM2 || 999; }));
      var spread = Math.max.apply(null, p) / Math.min.apply(null, p);
      return '<div class="box"><span class="tag">' + esc(c) + "</span><h3>" + num(Math.min.apply(null, p) / 1000) + "–" + num(Math.max.apply(null, p) / 1000) + " тыс. ₽/м²</h3>" +
        "<p>Бизнес в среднем " + num(avg(biz) / 1000) + " тыс., премиум — " + num(avg(prem) / 1000) + " тыс. ₽/м². " +
        "Самый дешёвый вход в квартиру — " + mln(entry) + ", минимальная площадь лота в срезе — " + dec(minA) + " м².</p>" +
        '<div class="nums"><div><span>ЖК в срезе</span><b>' + l.length + '</b></div><div><span>вход от</span><b>' + entry + " млн</b></div><div><span>разброс цен</span><b>" + spread.toFixed(1) + "×</b></div></div></div>";
    }).join("");
  }

  function renderMethod() {
    var worst = { ratio: 0, name: "" };
    DATA.forEach(function (z) {
      if (!z.minLotImpliedPpm) return;
      var ratio = z.minLotImpliedPpm / z.pricePerM2;
      if (ratio > worst.ratio) worst = { ratio: ratio, name: z.name, city: z.city };
    });
    $("methodList").innerHTML = [
      "<b>«Цена от» за м² — не цена вашей квартиры.</b> Так агрегатор показывает метр самого дешёвого лота комплекса (обычно большого, углового или без вида). Умножать её на желаемую площадь нельзя: в маленьких лотах метр дороже. Считаем от цены метра фактического минимального лота нужной категории и показываем разброс. В худшем ЖК среза («" + esc(worst.name) + "», " + esc(worst.city) + "») реальная цена входа за метр выше объявленной на <b>" + Math.round((worst.ratio - 1) * 100) + "%</b>.",
      "<b>Если квартиры такой площади нет — так и написано.</b> Пример из аудита: «Чистые Пруды» (Sminex, ЦАО) — минимум 115 м² за 161,11 млн ₽. Старая формула обещала «85 м² за 119 млн, хватает» и была бы неправдой. Правило закреплено тестом: <code>node tests/calc.test.js</code> (18 проверок).",
      "<b>«Лучший» — это скоринг, а не «самый дорогой из влезших».</b> Веса: использование бюджета 40, срок сдачи 20, выбор планировок 20, цена метра в городе 20. Процент совпадения и разбор по критериям видны в каждой карточке.",
      "<b>Класс ЖК взят из источника.</b> В карточке realty.vbr.ru / m2.ru есть поле «Класс ЖК»: у 15 из 15 объектов оно заполнено. Правило переноса: «Бизнес премиум» относим в «Премиум», «Бизнес» остаётся «Бизнесом». Совпадение с нашей разметкой — 15/15 (колонка «класс в источнике» в таблице).",
      "<b>Выборка — срез из 5 проектов на город, а не рынок.</b> Структура одинаковая везде: 2 премиум + 3 бизнес. Среднее по 3 ЖК — иллюстрация, а не статистика.",
      "<b>Чувствительность вывода «бизнес в Сочи дороже московского».</b> 507 718 против 447 326 ₽/м² получается только потому, что в срезе есть «Белые Ночи» (827 999 ₽/м², формально «Бизнес» в источнике). Без одной строки средний бизнес Сочи = <b>347 578 ₽/м²</b>, то есть ниже Москвы. Честная формулировка: на 5 объектах вывод не проверить.",
      "<b>Рынок — долевое строительство по 214-ФЗ.</b> Цена «от» и наличие лотов действуют до следующей стадии продаж: у объектов в срезе срок сдачи — с 2023 по 2027 год, и сравнивать «котлован» со «сданным» по цене метра напрямую некорректно — поэтому срок сдачи показан у каждой карточки, а проектная декларация проверяется на наш.дом.рф до сделки.",
      "<b>У каждой строки есть дата фиксации цены</b> (15.11.2026) и ссылка. Цена «от» у агрегатора живёт неделями и может относиться к уже проданному лоту.",
      "<b>Чего модель не учитывает:</b> этаж, вид, отделку, торг, рассрочку, скидку за 100% оплату, условия эскроу. Это не оценка рыночной стоимости квартиры, а отсечка «когда идти смотреть»."
    ].map(function (s) { return "<li>" + s + "</li>"; }).join("");
  }

  var tableDirty = true;
  var WIDE_COLS = { "Застройщик": 1, "макс. ₽/м²": 1, "лотов": 1 };

  function renderTable() {
    if (!tableDirty || $("tableWrap").hidden) return;
    var fit = {};
    (last ? last.all : []).forEach(function (r) { fit[r.zhk.id] = r.status; });
    var rows = DATA.map(function (z) {
      var st = z.city === (V ? V.city : state.city) ? (fit[z.id] || "na") : "na";
      var badge = st === "fits" ? "проходит в бюджет" : st === "tight" ? "на пределе" : st === "over" ? "не хватает" : st === "unavailable" ? "нет такой площади" : "";
      var tone = st === "fits" ? 1 : st === "tight" ? 2 : (st === "over" || st === "unavailable") ? 0 : "";
      return '<tr data-fits="' + tone + '">' +
        '<td data-label="№">' + z.n + "</td><td data-label=\"Город\">" + esc(z.city) + "</td>" +
        '<td data-label="ЖК"><b>' + esc(z.name) + "</b>" + (badge ? "<br /><small>" + badge + "</small>" : "") + "</td>" +
        '<td class="wide" data-label="Застройщик">' + esc(z.developer) + "</td><td data-label=\"Район\">" + esc(z.district) + "</td>" +
        '<td data-label="Класс в источнике">' + esc(z.classSource || "—") + "</td>" +
        '<td data-label="Класс (наш)">' + esc(z.zhkClass) + "</td>" +
        '<td class="num" data-label="цена от, ₽/м²">' + num(z.pricePerM2) + "</td>" +
        '<td class="num wide" data-label="макс. ₽/м²">' + num(z.pricePerM2Max) + "</td>" +
        '<td class="num" data-label="мин. лот">' + mln(z.minLotMln) + "</td>" +
        '<td class="num" data-label="мин. площадь">' + (z.minAreaM2 ? dec(z.minAreaM2) + " м²" : "—") + "</td>" +
        '<td class="num wide" data-label="лотов">' + (z.offers || "н/д") + "</td>" +
        '<td data-label="Срок сдачи">' + esc(z.delivery) + "</td>" +
        '<td data-label="Дата цены">' + esc((z.priceAsOf || "").split(",")[0]) + "</td>" +
        '<td data-label="Источник"><a class="src-link" target="_blank" rel="noopener" href="' + esc(z.sourceUrl) + '">' + esc(z.sourceName) + "</a></td></tr>";
    }).join("");
    $("tableWrap").innerHTML = '<table><caption>Срез из 15 новостроек (Сочи, Москва, Екатеринбург, цены от ' +
      "15.11.2026): объявленная «цена от» за м², реальная верхняя граница ₽/м², минимальный лот и минимальная площадь в продаже. " +
      "Подсветка слева — результат текущего подбора по городу «" + esc(V ? V.city : state.city) + "». " +
      '<span class="only-mobile">На телефоне скрыты три второстепенные колонки (застройщик, макс. ₽/м², число лотов) — ' +
      "они есть в CSV и на широком экране.</span></caption>" +
      "<thead><tr>" + ["№", "Город", "ЖК", "Застройщик", "Район", "Класс в источнике", "Класс (наш)", "цена от ₽/м²", "макс. ₽/м²", "мин. лот", "мин. площадь", "лотов", "Срок сдачи", "Дата цены", "Источник"]
        .map(function (h) { return '<th scope="col"' + (WIDE_COLS[h] ? ' class="wide"' : "") + ">" + h + "</th>"; }).join("") + "</tr></thead><tbody>" + rows + "</tbody></table>";
    tableDirty = false;
  }

  /* ------------------------------------------------------------------ аналитическая графика */
  /* Что рисуется — только поля источника: цены лотов, ₽/м², срок сдачи.
     «Готовность» — это НЕ данные о ходе работ: календарная шкала от заявленного срока сдачи,
     она так и подписана. Отдельных строек с этапами в карточке агрегатора нет. */
  var ART_A = 2021, ART_B = 2028, ART_TODAY = 2026.87;   // границы шкалы и дата среза (15-16.11.2026)

  function lotName(t) { return /^студ/i.test(t) ? "студ" : (String(t).charAt(0) + "к"); }

  function artLots(z, lit, x0, w, top, base) {
    var lots = (z.lots || []).slice(0, 5);
    if (!lots.length) return "";
    var max = Math.max.apply(null, lots.map(function (l) { return Math.max(l.toMln || 0, l.fromMln || 0); }));
    if (!(max > 0)) return "";
    var gap = 5, span = base - top;
    var bw = Math.max(9, (w - gap * (lots.length + 1)) / lots.length);
    var out = "";
    lots.forEach(function (l, i) {
      var x = x0 + gap + i * (bw + gap);
      var a = Math.min((l.fromMln || 0) / max, 1), b = Math.min(Math.max(l.toMln || l.fromMln || 0, 0) / max, 1);
      var ya = base - span * a, yb = base - span * Math.max(b, a);
      out += '<rect x="' + x.toFixed(1) + '" y="' + top + '" width="' + bw.toFixed(1) + '" height="' + span.toFixed(1) + '" rx="4" fill="rgba(255,255,255,.07)"/>' +
             '<rect class="a-bar" style="animation-delay:' + (i * 90) + 'ms" x="' + x.toFixed(1) + '" y="' + yb.toFixed(1) +
             '" width="' + bw.toFixed(1) + '" height="' + Math.max(2.5, ya - yb).toFixed(1) + '" rx="3" fill="' + lit + '"/>' +
             '<text class="a-lbl" x="' + (x + bw / 2).toFixed(1) + '" y="' + (top - 5) + '" text-anchor="middle">' + lotName(l.type) + "</text>" +
             '<text class="a-val" x="' + (x + bw / 2).toFixed(1) + '" y="' + (base + 13) + '" text-anchor="middle">' + dec(l.fromMln) + "</text>";
    });
    return out;
  }

  function artTimeline(z, lit, x0, w, y) {
    var y0 = z.deliveryYearFrom || z.deliveryYearTo || ART_TODAY;
    var y1 = z.deliveryYearTo || y0;
    var fx = function (yy) { return x0 + (Math.min(Math.max(yy, ART_A), ART_B) - ART_A) / (ART_B - ART_A) * w; };
    var a = fx(y0), b = fx(Math.min(y1, ART_TODAY)), today = fx(ART_TODAY);
    var ready = y1 <= 2026;
    return '<text class="a-cap" x="' + x0 + '" y="' + (y - 12) + '">СРОК СДАЧИ · СРЕЗ 15.11.2026</text>' +
      '<line x1="' + x0 + '" y1="' + y + '" x2="' + (x0 + w) + '" y2="' + y + '" stroke="rgba(255,255,255,.16)" stroke-width="2" stroke-linecap="round"/>' +
      '<line class="a-line" x1="' + a.toFixed(1) + '" y1="' + y + '" x2="' + Math.max(b, a + 2).toFixed(1) + '" y2="' + y +
      '" stroke="' + lit + '" stroke-width="5" stroke-linecap="round" style="--len:' + (w + 4) + '"/>' +
      '<line x1="' + today.toFixed(1) + '" y1="' + (y - 9) + '" x2="' + today.toFixed(1) + '" y2="' + (y + 9) + '" stroke="#fff" stroke-width="1.4" opacity=".72"/>' +
      '<text class="a-val" x="' + x0 + '" y="' + (y + 17) + '">' + esc(z.delivery || "срок сдачи в источнике не указан") + "</text>" +
      '<text class="a-note" x="' + x0 + '" y="' + (y + 29) + '">' + (ready ? "заявленный срок уже прошёл" : "заявленный срок ещё не наступил") + "</text>";
  }

  function artCard(z, r) {
    var t = theme(z.city);
    return '<svg viewBox="0 0 320 150" aria-hidden="true">' +
      artLots(z, t.lit, 6, 120, 48, 106) +
      artTimeline(z, t.lit, 142, 172, 66) +
      "</svg>";
  }

  /* Компактная версия той же аналитики — левая колонка карточки в списке «как в Авито». */
  /* Компактная аналитика для узкой колонки (158px) карточки в списке «как в Авито».
     Свои отступы и подписи цен ПОД планками: на этом масштабе обычный artLots
     сталкивает цифры соседних столбцов. */
  /* Ширина колонки с графикой в товарной карточке: на десктопе 158px, на мобилке —
     вся карточка. Возвращаем ширину вьюбокса, чтобы 1 его единица = 1 CSS-пиксель. */
  /* Размер колонки графики + сколько по высоте можно залить данными,
     чтобы не осталось пустого тёмного прямоугольника. */
  function artBox() {
    var el = document.getElementById("marketList");
    /* Пробная карточка в тот же грид: браузер сам считает, какой при текущей
       ширине окна будет колонка графики (158px на десктопе, вся карточка на мобилке). */
    var probe = document.createElement("div");
    probe.className = "mk-card";
    probe.style.cssText = "visibility:hidden;position:absolute;top:0;left:-9999px;height:0";
    var art = document.createElement("div");
    art.className = "mk-art";
    probe.appendChild(art);
    el.appendChild(probe);
    var w = Math.round(art.getBoundingClientRect().width) || (innerWidth <= 770 ? Math.min(360, innerWidth - 48) : 158);
    /* рост колонки = рост тела карточки в этом же ряду грида: так viewBox совпадает
       с тем, сколько реально закрашено тёмным, и подписи не обрезаются */
    probe.remove();
    return w >= 96 ? w : Math.round(el.clientWidth);
  }

  /* Компактная аналитика для карточки в списке «как в Авито»: лоты по типам,
     окно сдачи и цена входа. Подписи рисуем здесь свои (не через artLots): в узкой
     колонке цены соседних столбцов слипались. */
  function artMini(z) {
    var t = theme(z.city);
    var lots = (z.lots || []).slice(0, 5);
    var y1 = z.deliveryYearTo || z.deliveryYearFrom || 0;
    var dl = String(z.delivery || "срок не указан").replace(/^Сдача\s*/i, "");
    var W = artBox();
    var off = Math.max(10, Math.round((W - 150) / 2) + 4);
    var right = Math.max(off + 150 - 8, W - 10);
    var fs = 150 / Math.max(120, W);
    var st = function (px) { return ' data-k="' + px + '" style="font-size:' + (px * fs).toFixed(2) + 'px"'; };
    var s = '<svg viewBox="0 0 ' + W + ' 242" aria-hidden="true" preserveAspectRatio="xMidYMid meet">';
    if (lots.length) {
      var max = Math.max.apply(null, lots.map(function (l) { return Math.max(l.toMln || 0, l.fromMln || 0); }));
      var top = 34, base = 118, gap = 4, span = base - top;
      var bw = Math.max(10, (150 - 8 - gap * (lots.length + 1)) / lots.length);
      s += '<text class="a-cap"' + st(9.6) + ' x="' + off + '" y="16">ЛОТЫ ПО ТИПАМ · млн ₽</text>';
      lots.forEach(function (l, i2) {
        var x = off + gap + i2 * (bw + gap);
        var a = Math.min((l.fromMln || 0) / max, 1), b = Math.min(Math.max(l.toMln || l.fromMln || 0, 0) / max, 1);
        var ya = base - span * a, yb = base - span * Math.max(b, a);
        s += '<rect x="' + x.toFixed(1) + '" y="' + top + '" width="' + bw.toFixed(1) + '" height="' + span + '" rx="3" fill="rgba(255,255,255,.07)"/>' +
             '<rect class="a-bar" style="animation-delay:' + (i2 * 90) + 'ms" x="' + x.toFixed(1) + '" y="' + yb.toFixed(1) +
             '" width="' + bw.toFixed(1) + '" height="' + Math.max(2.5, ya - yb).toFixed(1) + '" rx="2" fill="' + t.lit + '"/>' +
             '<text class="a-lbl"' + st(13) + ' x="' + (x + bw / 2).toFixed(1) + '" y="' + (top - 6) + '" text-anchor="middle">' + lotName(l.type) + "</text>";
      });
      s += '<text class="a-val"' + st(11.4) + ' x="' + off + '" y="136">' +
           esc(dec(lots[0].fromMln) + " – " + dec(Math.max.apply(null, lots.map(function (l) { return l.toMln || l.fromMln || 0; }))) + " млн ₽") + "</text>";
    } else {
      s += '<text class="a-cap"' + st(9.6) + ' x="' + off + '" y="16">ЛОТЫ ПО ТИПАМ</text>' +
           '<text class="a-note"' + st(10.4) + ' x="' + off + '" y="40">источник не отдаёт разбивку</text>' +
           '<text class="a-note"' + st(10.4) + ' x="' + off + '" y="56">по типам квартир</text>';
    }
    s += '<line x1="' + off + '" y1="150" x2="' + right + '" y2="150" stroke="rgba(255,255,255,.14)"/>' +
      '<text class="a-cap"' + st(9.6) + ' x="' + off + '" y="164">СРОК СДАЧИ</text>' +
      '<text class="a-val"' + st(11.4) + ' x="' + off + '" y="181">' + esc(dl) + "</text>" +
      '<text class="a-note"' + st(10.4) + ' x="' + off + '" y="198">' + (y1 && y1 <= 2026 ? "срок уже прошёл" : "срок ещё не наступил") + "</text>" +
      '<text class="a-val"' + st(11.4) + ' x="' + off + '" y="215">' + esc("вход " + mln(z.minLotMln)) + "</text>" +
      '<text class="a-note"' + st(10.4) + ' x="' + off + '" y="232">' + esc("цена " + String(z.priceAsOf || "15.11.2026").split(",")[0]) + "</text>";
    s += "</svg>";
    return s;
  }

  /* Полоски ₽/м² по городу — та же логика, что в плитках: «цена от» по каждому ЖК среза. */
  function artCity(c) {
    var list = cityList(c);
    if (!list.length) return "";
    var max = Math.max.apply(null, list.map(function (z) { return z.pricePerM2; }));
    var n = list.length, bw = 120 / n - 6;
    var bars = list.map(function (z, i) {
      var hpx = Math.max(3, 26 * (z.pricePerM2 / max));
      return '<rect class="a-bar" style="animation-delay:' + (i * 70) + 'ms" x="' + (3 + i * (bw + 6)).toFixed(1) +
        '" y="' + (30 - hpx).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hpx.toFixed(1) + '" rx="2" fill="currentColor"/>';
    }).join("");
    return '<svg viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true">' + bars + "</svg>";
  }

  function renderHeroArt() {
    var host = $("heroArt");
    if (!host) return;
    var list = cityList(state.city), t = theme(state.city);
    if (!list.length) { host.innerHTML = ""; return; }
    var max = Math.max.apply(null, list.map(function (z) { return Math.max(z.minLotImpliedPpm || 0, z.pricePerM2); }));
    var rows = list.slice().sort(function (a, b) { return a.pricePerM2 - b.pricePerM2; }).map(function (z, i) {
      var w1 = 118 * (z.pricePerM2 / max), w2 = 118 * ((z.minLotImpliedPpm || z.pricePerM2) / max);
      var name = z.name.replace(/^(ЖК|ГК) /, "").replace(/[«»]/g, "");
      return '<g class="a-fade" style="animation-delay:' + (i * 80) + 'ms">' +
        '<text class="h-name" x="0" y="' + (16 + i * 30) + '">' + esc(name.slice(0, 17)) + "</text>" +
        '<rect class="a-barx" style="animation-delay:' + (i * 80) + 'ms" x="96" y="' + (7 + i * 30) + '" width="' + Math.max(2, w1).toFixed(1) +
        '" height="7" rx="3.5" fill="rgba(255,255,255,.28)"/>' +
        '<rect class="a-barx" style="animation-delay:' + (i * 80 + 120) + 'ms" x="96" y="' + (16 + i * 30) + '" width="' + Math.max(2, w2).toFixed(1) +
        '" height="7" rx="3.5" fill="' + t.lit + '"/>' +
        '<text class="h-num" x="' + (100 + Math.max(w1, w2)).toFixed(1) + '" y="' + (17 + i * 30) + '">' + num(z.pricePerM2 / 1000) + "→" + num((z.minLotImpliedPpm || z.pricePerM2) / 1000) + "</text>" +
        "</g>";
    }).join("");
    host.innerHTML =
      "<h3>" + esc(state.city) + ": сколько стоит метр <span>15 ЖК среза · " + esc(t.mood.split(",")[0]) + "</span></h3>" +
      '<svg viewBox="0 0 320 ' + (18 + list.length * 30) + '" aria-hidden="false" role="img" aria-label="Сравнение объявленной цены метра и фактической цены входа за метр по пяти ЖК">' + rows + "</svg>" +
      '<div class="ha-legend"><span><i style="background:rgba(255,255,255,.28)"></i>«цена от» за м² в источнике</span>' +
      "<span><i style=\"background:" + t.lit + '"></i>фактически за метр минимального лота</span>' +
      "<span>· тыс. ₽/м²</span></div>";
  }

  /* ------------------------------------------------------------------ расширенные настройки */
  function renderDistrictChips() {
    var host = $("districtChips");
    if (!host) return;
    var list = cityList(state.city), ds = C.districts(DATA, state.city);
    var html = ['<button class="chip" type="button" data-district="" aria-pressed="' + (state.district ? "false" : "true") +
      '">любой · ' + list.length + "</button>"];
    ds.forEach(function (d) {
      var n = list.filter(function (z) { return String(z.district || "").toLowerCase().indexOf(d.toLowerCase()) >= 0; }).length;
      html.push('<button class="chip" type="button" data-district="' + esc(d) + '" aria-pressed="' + (state.district === d ? "true" : "false") +
        '" title="' + esc(list.filter(function (z) { return z.district === d || String(z.district || "").indexOf(d) === 0; }).map(function (z) { return z.name; }).join(", ")) +
        '">' + esc(d) + " · " + n + "</button>");
    });
    host.innerHTML = html.join("");
    var note = $("districtNote");
    if (note) note.textContent = "Районы взяты из поля «Район» карточки источника — ничего не придумано. " +
      "Число рядом — сколько ЖК этого района попало в срез (в базе 5 на город).";
  }

  function renderIntentToggles() {
    var host = $("intentToggles");
    if (!host) return;
    var list = cityList(state.city);
    host.innerHTML = C.INTENTS.map(function (it) {
      var n = list.filter(function (z) { return C.intentHit(z, it.key); }).length;
      var on = state.intents.indexOf(it.key) >= 0;
      var head = '<button class="chip" type="button" data-intent="' + it.key + '" aria-pressed="' + on + '"';
      head += n ? ' title="' + esc(it.hint) + '"' : ' disabled title="в карточках этого города такого признака нет"';
      return head + '><i aria-hidden="true"></i>' + esc(it.label) + '<span class="n">' + n + '/' + list.length + '</span></button>';
    }).join("");
  }

  /* ------------------------------------------------------------------ список «как в Авито» */
  var mktSort = "entry", mktAll = false;
  var MKT_SORTS = [["entry", "по цене входа"], ["ppm", "по ₽/м²"], ["offers", "по выбору лотов"],
    ["area", "по мин. метражу"], ["delivery", "по сроку сдачи"]];

  /* Поворот экрана или изменение ширины окна: колонка графики меняет размер,
     а с ней и масштаб подписей — перерисовываем список, если он открыт. */
  var artTimer = 0;
  function watchArtBox() {
    window.addEventListener("resize", function () {
      clearTimeout(artTimer);
      artTimer = setTimeout(function () {
        if (!$("market").hidden) renderMarket();
      }, 220);
    });
  }

  /* Метр ₽/м² этого ЖК относительно разброса по срезу города — HTML-строка под графиком,
     чтобы занимать ровно столько, сколько осталось в колонке, и ничего не обрезалось. */
  function artMeter(z) {
    var list = cityList(z.city).filter(function (x) { return x.pricePerM2 > 0; });
    if (list.length < 2 || !(z.pricePerM2 > 0)) return "";
    var lo = Math.min.apply(null, list.map(function (x) { return x.pricePerM2; }));
    var hi = Math.max.apply(null, list.map(function (x) { return x.pricePerM2; }));
    var f = Math.round(Math.min(Math.max((z.pricePerM2 - lo) / (hi - lo || 1), 0), 1) * 100);
    return '<div class="mk-meter"><span class="mlab">МЕТР В ГОРОДЕ, ₽/м²</span>' +
      '<b class="mval">' + esc(num(z.pricePerM2)) + "</b>" +
      '<span class="mk-track"><span class="mk-dot" style="left:' + f + '%"></span></span>' +
      '<span class="mmin">' + esc(num(lo / 1000) + " тыс.") + '</span><span class="mmax">' + esc(num(hi / 1000) + " тыс.") + "</span>" +
      '<small>шкала по ' + list.length + " ЖК среза, не по рынку</small></div>";
  }

  function renderMarketSort() {
    var host = $("marketSort");
    if (!host) return;
    host.innerHTML = MKT_SORTS.map(function (x) {
      return '<button class="chip" type="button" data-sort="' + x[0] + '" aria-pressed="' + (mktSort === x[0]) + '">' + x[1] + "</button>";
    }).join("");
  }

  function renderMarket() {
    if (!$("marketList")) return;
    paintMarket();
  }

  /* Колонка графики известна по размеру только когда список в потоке: после вставки
     пересчитываем viewBox по факту (одним кадром), иначе scale = 1 и подписи плывут. */
  function renderMarket() {
    if (!$("marketList")) return;
    paintMarket();
  }

  /* Колонка графики известна по размеру только когда список в потоке: после вставки
     пересчитываем viewBox по факту (одним кадром), иначе scale = 1 и подписи плывут. */
  var artSyncLeft = 0;
  function syncArtView() {
    requestAnimationFrame(function () {
      [].forEach.call(document.querySelectorAll("#marketList .mk-card"), function (card) {
        var art = card.querySelector(".mk-art"), svg = card.querySelector(".mk-art svg");
        if (!art || !svg) return;
        var w = Math.round(art.getBoundingClientRect().width), h = Math.round(art.getBoundingClientRect().height);
        if (w < 96 || h < 60) return;
        var cur = (svg.getAttribute("viewBox") || "").split(" ");
        if (cur[2] === String(w) && cur[3] === String(h)) return;
        /* блок «метр в городе» рисуется только если под него есть место; при первом
           рендере место было оценкой — дорисовываем один раз по факту */
        if (cur[3] !== "242" && h < +cur[3] && artSyncLeft > 0) { artSyncLeft--; paintMarket(); return; }
        svg.setAttribute("viewBox", "0 0 " + w + " " + h);
        svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
        [].forEach.call(svg.querySelectorAll("text"), function (t) {
          var k = +t.getAttribute("data-k") || 1;
          t.setAttribute("style", "font-size:" + (k * (150 / Math.max(120, w))).toFixed(2) + "px");
        });
      });
    });
  }

  function paintMarket() {
    var host = $("marketList");
    if (!host) return;
    var p = params(V || state);
    var cap = p.query.budgetMax ? Math.min(p.budgetMln, p.query.budgetMax) : p.budgetMln;
    var rows = (mktAll ? DATA.slice() : cityList(p.city)).map(function (z) {
      var r = C.evaluate(z, p, cap);
      return { z: z, r: r };
    });
    var key = {
      entry: function (x) { return x.z.minLotMln; },
      ppm: function (x) { return x.z.pricePerM2; },
      offers: function (x) { return -(x.z.offers || 0); },
      area: function (x) { return x.z.minAreaM2 || 999; },
      delivery: function (x) { return -(x.z.deliveryYearTo || 0); }
    }[mktSort];
    rows.sort(function (a, b) { return key(a) - key(b); });
    host.innerHTML = rows.map(function (x) {
      var z = x.z, r = x.r, ok = r.status === "fits" || r.status === "tight";
      var price = r.estimate && r.estimate.available ? "от " + mln(r.estimate.costMln) : "от " + mln(z.minLotMln);
      var what = r.estimate && r.estimate.available
        ? "за " + p.areaM2 + " м² · " + r.estimate.group.type.toLowerCase()
        : "минимальный лот ЖК · " + (z.minAreaM2 ? dec(z.minAreaM2) + " м²" : "—");
      var badge = r.status === "fits" ? "проходит в бюджет" : r.status === "tight" ? "впритык"
        : r.status === "over" ? "не хватает " + mln(r.need) : "нет такой площади";
      return '<article class="mk-card' + (ok ? " is-fit" : "") + '">' +
        '<div class="mk-art">' + artMini(z) + artMeter(z) + "</div>" +
        '<div class="mk-body">' +
          '<h3 class="mk-name">' + esc(z.name) + "<em>" + esc(z.zhkClass) + "</em><em>" + esc(badge) + "</em></h3>" +
          '<div class="mk-price">' + price + '</div><div class="mk-ppm">' + esc(what) + " · метр " + num(z.pricePerM2) +
          "–" + num(z.pricePerM2Max || z.pricePerM2) + " ₽" + (z.pricePerM2Avg ? " · средн. " + num(z.pricePerM2Avg) : "") + "</div>" +
          '<ul class="mk-facts">' +
            "<li>" + esc(z.developer) + "</li><li>" + esc(z.district) + "</li>" +
            "<li>лотов " + (z.offers || "уточняется") + "</li>" +
            "<li>" + esc(String(z.delivery || "срок не указан").replace(/^Сдача\s*/i, "")) + "</li>" +
            "<li>цена от " + esc((z.priceAsOf || "15.11.2026").split(",")[0]) + "</li>" +
          "</ul>" +
          '<div class="mk-foot"><a target="_blank" rel="noopener" href="' + esc(z.sourceUrl) + '">' + icon("link") + " Квартиры на " + esc(z.sourceName) +
          '</a><button class="chip" type="button" data-save="' + esc(z.name) + '">' + icon(saved.indexOf(z.name) >= 0 ? "check" : "scale") +
          (saved.indexOf(z.name) >= 0 ? " В подборке" : " В подборку") + "</button></div>" +
        "</div></article>";
    }).join("");
    var n = (V || state).city;
    $("marketH").textContent = mktAll ? "Все новостройки среза: 15 ЖК, три города" : "Все новостройки: " + n;
    $("marketNote").textContent = "Срез исследования — 5 ЖК на город (не весь рынок). Сортировка: " +
      (MKT_SORTS.filter(function (x) { return x[0] === mktSort; })[0] || ["", "—"])[1] +
      " · цена " + (r_asOf()) + " · метр и лоты — из карточки источника";
    $("marketAll").setAttribute("aria-pressed", String(mktAll));
    $("marketAll").textContent = mktAll ? "Только " + n + " — 5 ЖК" : "Показать весь срез — 15 ЖК";
    syncTabs();
  }

  function r_asOf() { return "15-16.11.2026"; }

  function showMarket() { renderMarket(); setPane("list"); revealPane("market"); }

  /* ------------------------------------------------------------------ заявка / сравнение */
  function toggleSaved(name) {
    var i = saved.indexOf(name);
    if (i < 0) saved.push(name); else saved.splice(i, 1);
    $("compareBtn").textContent = saved.length ? "Сравнить " + saved.length + " ЖК" : "Сравнить 0 ЖК";
    $("leadNote").textContent = saved.length
      ? "Локально собрано " + saved.length + " ЖК. Отправка не подключена (демо без бэкенда)."
      : "Демо-форма: отправка не подключена (нет бэкенда). В проде — CRM или Telegram-бот застройщика.";
    (last ? last.top.concat(last.rest) : []).forEach(function (r) { updateCard(cardCache.get(r.zhk.id), r, last.top[0] === r); });
    if ($("market") && !$("market").hidden) renderMarket();
    syncTabs();
  }

  /* ------------------------------------------------------------------ URL */
  function syncUrl() {
    if (location.protocol === "file:") return;
    try {
      var u = new URL(location.href);
      u.search = "";
      u.searchParams.set("city", state.city);
      u.searchParams.set("budget", state.budget);          // млн — старый формат ссылки остаётся валидным
      u.searchParams.set("rub", state.budgetRub);          // и рубли, если делитесь из новой панели
      u.searchParams.set("area", state.area);
      if (state.klass !== "Все") u.searchParams.set("klass", state.klass);
      if (state.district) u.searchParams.set("district", state.district);
      if (state.intents.length) u.searchParams.set("want", state.intents.join(","));
      if (state.query) u.searchParams.set("q", state.query);
      history.replaceState(null, "", u.pathname + "?" + u.searchParams.toString());
    } catch (e) { /* file:// и урезанные браузеры — не критично */ }
  }

  var deepLinked = false;
  function readUrl() {
    if (!location.search) return;
    var p = new URLSearchParams(location.search);
    var any = false;
    if (p.get("city") && cities().indexOf(p.get("city")) >= 0) { state.city = p.get("city"); any = true; }
    if (p.get("rub")) { state.budgetRub = snapRub(parseRub(p.get("rub"))); state.budget = rubToMln(state.budgetRub); any = true; }
    else if (p.get("budget")) { state.budget = clamp(p.get("budget"), 1, 400); state.budgetRub = Math.round(state.budget * 1e6); any = true; }
    if (p.get("area")) { state.area = clamp(p.get("area"), 12, 400); any = true; }
    if (["Бизнес", "Премиум"].indexOf(p.get("klass")) >= 0) { state.klass = p.get("klass"); any = true; }
    if (p.get("district")) {
      var dd = String(p.get("district")).slice(0, 60);
      if (C.districts(DATA, state.city).some(function (d) { return d.toLowerCase() === dd.toLowerCase(); })) { state.district = dd; any = true; }
    }
    if (p.get("want")) {
      state.intents = String(p.get("want")).split(",").map(function (x) { return x.trim(); })
        .filter(function (k) { return C.INTENTS.some(function (i) { return i.key === k; }); });
      if (state.intents.length) any = true;
    }
    if (p.get("q")) { state.query = String(p.get("q")).slice(0, 120); any = true; }
    if (p.get("tab") === "list") pane = "list";    /* «пришли и смотрите список», подбор не запускаем */
    deepLinked = any;   // по ссылке с параметрами результат показываем сразу — человек уже всё выбрал
  }

  /* ------------------------------------------------------------------ рендер */
  /* Превью: тихий пересчёт. Обновляются только счётчики, подсказки, графика и сама панель —
     страница никуда не прокручивается, список внизу не меняется, пока не нажата кнопка. */
  function preview() {
    if (!DATA.length || !C) { fatal(); return; }
    var res;
    try { res = C.match(DATA, params(state)); }
    catch (err) { $("verdict").innerHTML = "<div><h2>Ошибка расчёта</h2><p>" + esc(err.message) + "</p></div>"; return; }
    renderPanelHints(res);
    if (V) setDirty(true);
  }

  function setDirty(on) {
    var bar = $("ctaBar");
    if (bar) bar.classList.toggle("is-dirty", !!on);
    var hint = $("ctaHint");
    if (hint) hint.hidden = !on;
  }

  /* Применить набранное — единственный момент, когда под панелью появляется список. */
  function apply(scroll) {
    if (!DATA.length || !C) { fatal(); return; }
    var res;
    try { res = C.match(DATA, params(state)); }
    catch (err) { $("verdict").innerHTML = "<div><h2>Ошибка расчёта</h2><p>" + esc(err.message) + "</p></div>"; return; }
    V = { city: state.city, budget: state.budget, budgetRub: state.budgetRub, area: state.area,
          klass: state.klass, query: state.query, district: state.district, intents: state.intents.slice() };
    last = res;
    tableDirty = true;
    appliedOnce = true;
    $("results").hidden = false;
    setPane("pick");
    renderPanelHints(res);
    renderVerdict(res);
    $("cardsH").textContent = (res.fittingCount ? "Топ-" + res.top.length : "Варианты") + " новостроек " +
      (CITY_PREP[V.city] || ("в " + V.city)) + " · " + V.area + " м² · бюджет " + rubTxt(V.budget * 1e6) + " ₽";
    syncCards($("topCards"), res.top, true);
    syncCards($("excludedCards"), res.rest, false);
    $("excludedWrap").hidden = res.rest.length === 0;
    if (!res.top.length) { $("excludedWrap").open = true; $("cardsH").textContent = "Ни один ЖК " + (CITY_PREP[V.city] || V.city) + " не подошло — ниже причины по каждому"; }
    if (res.rest.length) $("excludedTitle").textContent = "Почему ещё " + res.rest.length + " ЖК " + (CITY_PREP[V.city] || V.city) + " не подошли";
    renderSheet();
    renderMethod();
    renderTable();
    renderMarket();
    setDirty(false);
    syncUrl();
    if (scroll !== false) {
      var y = $("results").getBoundingClientRect().top + window.scrollY - 74;
      window.scrollTo({ top: Math.max(0, y), behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  /* Список уже показан? Тогда кнопка честно называется «Подобрать ещё раз». */
  function applied() { return !!V; }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function fatal() {
    $("verdict").innerHTML = '<div><h2>Данные не загрузились</h2><p>Не найден <code>app/data.js</code> или <code>app/calc.js</code>. ' +
      "Открывайте <code>index.html</code> из папки репозитория целиком (все файлы рядом) — или используйте <code>index-standalone.html</code>, где всё уже внутри.</p></div>";
  }

  /* ------------------------------------------------------------------ события */
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  /* Единая точка применения готового сценария: чипсы-сцены и «выгодные предложения». */
  /* Единая точка применения готового сценария: чипсы-сцены и «выгодные предложения».
     Сценарий = набор параметров: ставим в черновик и сразу показываем результат (это явное действие). */
  function applyScene(s, scroll) {
    if (!s) return;
    var changedCity = s.city && s.city !== state.city;
    state.city = s.city || state.city;
    state.budget = clamp(s.budget, 1, 400);
    state.budgetRub = Math.round(state.budget * 1000000);
    state.area = clamp(s.area, 12, 400);
    state.klass = s.klass || "Все";
    state.query = s.q || "";
    state.district = s.district || "";
    state.intents = (s.intents || []).slice();
    $("queryInput").value = state.query;
    $("budgetRub").value = rubTxt(state.budgetRub);
    $("areaInput").value = state.area;
    [].forEach.call(document.querySelectorAll("[data-budget]"), function (x) { x.setAttribute("aria-pressed", String(parseNum(x.dataset.budget) === state.budget)); });
    [].forEach.call(document.querySelectorAll("[data-area]"), function (x) { x.setAttribute("aria-pressed", String(parseNum(x.dataset.area) === state.area)); });
    markKlass();
    if (changedCity) $("panel").classList.add("city-switch");
    syncCityUI();
    renderDistrictChips();
    renderIntentToggles();
    if (changedCity) setTimeout(function () { $("panel").classList.remove("city-switch"); }, 620);
    apply(scroll);
  }
  function bind() {
    var bi = $("budgetRub"), ai = $("areaInput");
    var raf = 0;
    function queue() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; preview(); }); }

    /* ------------------------------------------------------------------ бюджет: полные рубли */
    var BUDGETS = [1, 3, 5, 10, 15, 20, 30, 50, 100, 200, 400];
    var AREAS = [[18, "студия с кухней"], [28, "студия"], [45, "1-комн."], [65, "2-комн."], [95, "3-комн."], [130, "4-комн."], [180, "просторно"]];
    $("budgetPresets").innerHTML = BUDGETS.map(function (v) {
      return '<button class="chip" type="button" data-budget="' + v + '" aria-pressed="false">до ' +
        num(v * 1000000) + " ₽<small>" + v + " млн</small></button>";
    }).join("");
    $("areaPresets").innerHTML = AREAS.map(function (a) {
      return '<button class="chip" type="button" data-area="' + a[0] + '" aria-pressed="false">' + a[1] + " " + a[0] + " м²</button>";
    }).join("");

    function mark(kind, v) {
      [].forEach.call(document.querySelectorAll("[data-" + kind + "]"), function (b) {
        b.setAttribute("aria-pressed", String(parseNum(b.dataset[kind]) === v));
      });
    }
    /* Пока человек печатает, сумму не клампим: «15» — это 15 ₽, а не «миллион». Ограничения
       (1–400 млн) наводим на blur, чтобы поле и расчёт не расходились. */
    function budgetFromInput() {
      var raw = parseRub(bi.value);
      state.budgetRub = raw;
      state.budget = Math.max(0.01, Math.round(raw / 10000) / 100);
      mark("budget", state.budget);
      queue();
    }
    function setBudgetRub(r) {
      stripCaps();
      state.budgetRub = snapRub(r);
      state.budget = rubToMln(state.budgetRub);
      bi.value = rubTxt(state.budgetRub);
      mark("budget", state.budget);
      queue();
    }
    function setArea(v) {
      stripCaps();
      state.area = clamp(v, 12, 400);
      ai.value = state.area;
      mark("area", state.area);
      queue();
    }
    function stripCaps() {   // пользователь сам правит цифры -> снимаем числовые ограничения из слов
      if (!state.query) return;
      var clean = state.query
        .replace(/(до|не дороже|не больше|от)\s*\d+([.,]\d+)?\s*(млн|м\b|м²)/gi, "")
        .replace(/\d+\s*(м2|м²)/gi, "").replace(/\s{2,}/g, " ").trim();
      if (clean !== state.query) { state.query = clean; $("queryInput").value = clean; }
    }

    bi.value = rubTxt(state.budgetRub); ai.value = state.area; $("queryInput").value = state.query;
    bi.addEventListener("input", function () {
      var digits = bi.value.slice(0, bi.selectionStart == null ? bi.value.length : bi.selectionStart).replace(/[^0-9]/g, "").length;
      budgetFromInput();
      bi.value = rubTxt(parseRub(bi.value));            // «15000000» -> «15 000 000» на глазах
      var seen = 0, pos = 0;
      while (pos < bi.value.length && seen < digits) { if (bi.value.charAt(pos) >= "0" && bi.value.charAt(pos) <= "9") seen++; pos++; }
      try { bi.setSelectionRange(pos, pos); } catch (e) { }
    });
    bi.addEventListener("blur", function () { setBudgetRub(state.budgetRub || 1000000); });
    bi.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); setBudgetRub(state.budgetRub); apply(); } });
    ai.addEventListener("input", function () { state.area = parseNum(ai.value) || state.area; mark("area", state.area); queue(); });
    ai.addEventListener("blur", function () { setArea(ai.value); });
    ai.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); setArea(ai.value); apply(); } });
    on($("budgetMore"), "click", function () { setBudgetRub((state.budgetRub || 0) + 500000); });
    on($("budgetLess"), "click", function () { setBudgetRub((state.budgetRub || 0) - 500000); });
    [].forEach.call(document.querySelectorAll("[data-budget]"), function (b) {
      b.addEventListener("click", function () { setBudgetRub(parseNum(b.dataset.budget) * 1000000); });
    });
    [].forEach.call(document.querySelectorAll("[data-area]"), function (b) {
      b.addEventListener("click", function () { setArea(b.dataset.area); });
    });
    mark("budget", state.budget); mark("area", state.area);

    /* ------------------------------------------------------------------ расширенные настройки */
    $("districtChips").addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-district]") : null;
      if (!b) return;
      state.district = b.dataset.district || "";
      renderDistrictChips();
      preview();
    });
    $("intentToggles").addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-intent]") : null;
      if (!b) return;
      var k = b.dataset.intent, i = state.intents.indexOf(k);
      if (i < 0) state.intents.push(k); else state.intents.splice(i, 1);
      renderIntentToggles();
      preview();
    });
    [].forEach.call(document.querySelectorAll("[data-klass]"), function (b) {
      b.addEventListener("click", function () {
        state.klass = b.dataset.klass;
        markKlass();
        preview();
      });
    });

    /* ------------------------------------------------------------------ кнопка «подобрать» */
    $("goBtn").addEventListener("click", function () { apply(); });
    $("shareBtn").addEventListener("click", function () {
      syncUrl();
      var label = $("shareLabel"), txt = location.href;
      var ok = function () { label.textContent = "Ссылка скопирована"; setTimeout(function () { label.textContent = "Скопировать ссылку"; }, 2200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () { fallback(); });
      else fallback();
      function fallback() { window.prompt("Скопируйте ссылку на подбор:", txt); }
    });
    $("printBtn").addEventListener("click", function () { window.print(); });

    /* Словами: «понять запрос» — тоже осознанное действие пользователя, поэтому показываем результат. */
    function runQuery() {
      state.query = $("queryInput").value.trim();
      var q = C.parseQuery(state.query);
      if (q.city) state.city = q.city;
      if (q.budgetMax) { state.budget = clamp(q.budgetMax, 1, 400); state.budgetRub = Math.round(state.budget * 1000000); }
      if (q.areaMax) state.area = clamp(q.areaMax, 12, 400);
      if (q.klass) state.klass = q.klass;
      bi.value = rubTxt(state.budgetRub); ai.value = state.area;
      syncCityUI();
      renderDistrictChips();
      renderIntentToggles();
      markKlass();
      mark("budget", state.budget); mark("area", state.area);
      apply();
    }
    $("queryBtn").addEventListener("click", runQuery);
    $("queryInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); runQuery(); } });
    $("resetBtn").addEventListener("click", function () {
      state = { city: state.city, budget: 25, budgetRub: 25000000, area: 45, klass: "Все", query: "", district: "", intents: [] };
      $("queryInput").value = "";
      bi.value = rubTxt(state.budgetRub); ai.value = state.area;
      V = null;
      $("results").hidden = true;
      $("market").hidden = true;
      syncCityUI();
      renderDistrictChips();
      renderIntentToggles();
      markKlass();
      mark("budget", state.budget); mark("area", state.area);
      preview();
      window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    });
    [].forEach.call(document.querySelectorAll("[data-scene]"), function (b) {
      b.addEventListener("click", function () { applyScene(JSON.parse(b.getAttribute("data-scene")), true); });
    });
    bindMood();
    /* «Выгодное посмотреть» и готовые сценарии — тоже явное действие, поэтому список показываем сразу. */

    /* ------------------------------------------------------------------ рынок («как в Авито») */
    $("marketBtn").addEventListener("click", showMarket);
    $("marketSort").addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-sort]") : null;
      if (!b) return;
      mktSort = b.dataset.sort;
      renderMarketSort();
      renderMarket();
    });
    $("marketAll").addEventListener("click", function () { mktAll = !mktAll; renderMarket(); });
    var mcBtn = $("marketClose");
    if (mcBtn) mcBtn.addEventListener("click", function () { setPane("pick"); });
    var lb = $("listBack");                     /* из списка — обратно к подбору, без прокрутки вверх */
    if (lb) lb.addEventListener("click", function () { setPane("pick"); revealPane("finder"); });
    var chipsList = $("cityTabsList");
    if (chipsList) chipsList.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-city]") : null;
      if (!b || b.dataset.city === state.city) return;
      state.city = b.dataset.city;          /* только выбор города: без скролла и без подбора */
      state.district = "";
      syncCityUI(); renderDistrictChips(); renderIntentToggles(); renderMood();
      renderMarket(); preview(); syncUrl();
    });
    bindPanes();
    $("marketList").addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-save]") : null;
      if (!b) return;
      toggleSaved(b.dataset.save);
      renderMarket();
    });
    [].forEach.call(document.querySelectorAll(".nav a[data-open]"), function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        document.body.classList.remove("mobile-nav-open");
        $("burger").setAttribute("aria-expanded", "false");
        if (a.dataset.open === "market") showMarket();
      });
    });
    renderMarketSort();

    /* ------------------------------------------------------------------ остальное */
    document.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".v-pill.lift") : null;
      if (!b) return;
      if (b.dataset.to) {
        state.budgetRub = snapRub(parseInt(b.dataset.to, 10) * 1000000);
        state.budget = rubToMln(state.budgetRub);
        bi.value = rubTxt(state.budgetRub);
        mark("budget", state.budget);
      }
      if (b.dataset.areaTo) {
        state.area = clamp(b.dataset.areaTo, 12, 400);
        ai.value = state.area;
        mark("area", state.area);
      }
      apply(false);
    });
    $("cityDDBtn").addEventListener("click", function () { cityMenu($("cityDD").dataset.open !== "true"); });
    document.addEventListener("click", function (e) { if (!$("cityDD").contains(e.target)) cityMenu(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") cityMenu(false); });
    $("burger").addEventListener("click", function () {
      var open = document.body.classList.toggle("mobile-nav-open");
      $("burger").setAttribute("aria-expanded", String(open));
    });
    [].forEach.call(document.querySelectorAll(".nav a"), function (a) {
      a.addEventListener("click", function () { document.body.classList.remove("mobile-nav-open"); $("burger").setAttribute("aria-expanded", "false"); });
    });
    $("toggleTableBtn").addEventListener("click", function () {
      var show = $("tableWrap").hidden;
      $("tableWrap").hidden = !show;
      $("toggleTableBtn").setAttribute("aria-expanded", String(show));
      $("toggleTableBtn").textContent = show ? "Скрыть таблицу" : "Показать таблицу (15 строк)";
      renderTable();
    });
    $("compareBtn").addEventListener("click", function () {
      if (saved.length < 2) { $("leadMsg").textContent = "Для сравнения добавьте в подборку минимум 2 ЖК — кнопка «В подборку» на карточке."; $("results").scrollIntoView({ block: "start" }); return; }
      var rows = DATA.filter(function (z) { return saved.indexOf(z.name) >= 0; });
      var txt = "Сравнение ЖК (" + (V ? V.city : state.city) + ")\n\n" + rows.map(function (z) {
        return [z.name, z.zhkClass, "от " + num(z.pricePerM2) + " ₽/м²", "вход " + mln(z.minLotMln), "лотов: " + (z.offers || "н/д"), z.delivery].join(" · ");
      }).join("\n");
      $("compareOut").textContent = txt;
      $("compareOut").hidden = false;
      $("copyCompare").hidden = false;
      $("leadMsg").textContent = "Сравнение собрано ниже — его можно скопировать и отправить тому, кто решает вместе с вами.";
    });
    $("copyCompare").addEventListener("click", function () {
      var t = $("compareOut").textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { $("copyCompare").textContent = "Скопировано"; });
    });
    $("leadForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var n = $("leadName").value.trim(), c = $("leadContact").value.trim();
      if (!n || !c) { $("leadMsg").textContent = "Заполните имя и контакт — как в реальной форме с валидацией."; return; }
      var view = V || state;
      var list = (last ? last.top : []).map(function (r) { return r.zhk.name + " (" + mln(r.cost) + ")"; }).join("; ");
      $("leadMsg").textContent = "Спасибо, " + n + "! Подборка «" + view.city + " · " + rubTxt(view.budgetRub || view.budget * 1e6) + " ₽ · " + view.area +
        " м²» " + (list ? " — " + list : "") + " — готова к отправке на " + c + ". (Демо: бэкенда нет, письмо не уходит.)";
      $("leadForm").reset();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 720) { document.body.classList.remove("mobile-nav-open"); $("burger").setAttribute("aria-expanded", "false"); }
    });
  }

  /* ------------------------------------------------------------------ старт */
  function boot() {
    if (!DATA.length || !C || !C.match) { fatal(); return; }
    buildCityUI();
    readUrl();                       /* параметры ссылки важнее дефолтов, поэтому читаем до рендера чипов */
    renderDistrictChips();
    renderIntentToggles();
    syncCityUI();
    markKlass();
    bind();
    watchArtBox();
    $("compareBtn").textContent = saved.length ? "Сравнить " + saved.length + " ЖК" : "Сравнить 0 ЖК";
    syncTabs();
    var wantPane = pane;
    if (deepLinked) apply(false); else preview();
    if (wantPane === "list") { renderMarket(); setPane("list"); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
