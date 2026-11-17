/*
 * app/app.js — интерфейс «НовостройкиПро».
 * Только DOM: вся логика подбора живёт в app/calc.js (и покрыта tests/calc.test.js).
 *
 * Как обновляется экран:
 *  · карточки создаются один раз на ЖК и переиспользуются (cardCache) — <img> не пересоздаётся,
 *    поэтому перерисовка на каждое движение ползунка не парсит заново фото;
 *  · меняются только textContent / className / style.width;
 *  · тяжёлые блоки (таблица, шпаргалка) пересобираются по событию, а не на каждый тик.
 */
(function () {
  "use strict";

  var DATA = window.ZHK_DATA || [];
  var C = window.ZHK_CALC;
  var PHOTOS = window.ZHK_PHOTOS || null; // заполнен только в index-standalone.html
  var $ = function (id) { return document.getElementById(id); };
  var CITY_PREP = { "Сочи": "в Сочи", "Москва": "в Москве", "Екатеринбург": "в Екатеринбурге" };
  var CLASS_FILTERS = ["Все", "Бизнес", "Премиум"];

  var state = { city: "Сочи", budget: 25, area: 45, klass: "Все", query: "" };
  var cardCache = new Map();
  var saved = [];      // «В подборку» — сравнение + заявка
  var last = null;     // последний результат match()

  /* ------------------------------------------------------------------ утилиты */
  function clamp(v, a, b) { v = typeof v === "number" ? v : parseFloat(v); return isNaN(v) ? a : Math.min(b, Math.max(a, v)); }
  function num(v, d) { return (d ? Number(v).toFixed(d) : String(Math.round(v))).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function mln(v) { return (Math.round(v * 100) / 100).toFixed(2).replace(".", ",") + " млн ₽"; }
  function dec(v) { return String(Math.round(v * 100) / 100).replace(".", ","); }
  function icon(name) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function photoFor(key) { return PHOTOS ? PHOTOS[key] : "images/" + key + ".jpg"; }
  function cityList(c) { return DATA.filter(function (z) { return z.city === c; }); }
  function cities() { var s = []; DATA.forEach(function (z) { if (s.indexOf(z.city) < 0) s.push(z.city); }); return s; }
  function capBudget() {
    var q = C.parseQuery(state.query);
    return q.budgetMax ? Math.min(state.budget, q.budgetMax) : state.budget;
  }

  function params() {
    return { city: state.city, budgetMln: state.budget, areaM2: state.area, klass: state.klass, query: C.parseQuery(state.query) };
  }

  /* ------------------------------------------------------------------ шапка: город */
  function buildCityUI() {
    var tabs = $("cityTabs"), menu = $("cityDDMenu");
    tabs.innerHTML = ""; menu.innerHTML = "";
    cities().forEach(function (c) {
      var n = cityList(c).length;
      var b = document.createElement("button");
      b.type = "button"; b.dataset.city = c; b.textContent = c;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(c === state.city));
      b.tabIndex = c === state.city ? 0 : -1;
      b.addEventListener("click", function () { setCity(c, true); });
      tabs.appendChild(b);

      var m = document.createElement("button");
      m.type = "button"; m.setAttribute("role", "menuitem"); m.dataset.city = c;
      m.innerHTML = "<span>" + esc(c) + "</span><small>" + n + " ЖК в базе</small>";
      m.addEventListener("click", function () { setCity(c, true); cityMenu(false); });
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

  function syncCityUI() {
    [].forEach.call($("cityTabs").querySelectorAll("button"), function (b) {
      var on = b.dataset.city === state.city;
      b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
    });
    [].forEach.call($("cityDDMenu").querySelectorAll("button"), function (b) {
      b.setAttribute("aria-current", String(b.dataset.city === state.city));
    });
    $("cityDDLabel").textContent = state.city;
  }

  function setCity(c, scroll) {
    state.city = c;
    syncCityUI();
    render();
    if (scroll) $("finder").scrollIntoView({ block: "start" });
  }

  function cityMenu(open) {
    $("cityDD").dataset.open = String(open);
    $("cityDDBtn").setAttribute("aria-expanded", String(open));
  }

  /* ------------------------------------------------------------------ карточка ЖК */
  function cardMarkup() {
    return '' +
      '<div class="card-media">' +
        '<img class="card-photo" alt="" loading="lazy" />' +
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
    refs.photo = el.querySelector(".card-photo");
    return refs;
  }

  function updateCard(refs, r, isBest) {
    var z = r.zhk, e = r.estimate, k = refs;

    k.root.className = "card" +
      (isBest && r.status === "fits" ? " card--best" : "") +
      (z.zhkClass === "Премиум" ? " card--premium" : "") +
      (r.status === "fits" || r.status === "tight" ? "" : " card--excluded");

    if (k.photo.dataset.key !== z.imgKey) {
      k.photo.dataset.key = z.imgKey;
      k.photo.onerror = function () { k.root.classList.add("no-photo"); };
      k.photo.onload = function () { k.root.classList.remove("no-photo"); };
      k.photo.src = photoFor(z.imgKey);
      k.photo.alt = z.name + " — фото жилого комплекса (" + z.sourceName + ")";
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
      k.priceCap.textContent = "за " + state.area + " м² · " + e.group.type.toLowerCase();
      k.range.innerHTML = "до " + mln(e.costToMln) + " по верхней границе" +
        (z.pricePerM2Avg ? " · средняя цена метра по ЖК " + num(z.pricePerM2Avg) + " ₽" : "");
      k.how.innerHTML =
        "Считаем не по «цене от за м²» комплекса: так агрегатор показывает метр самого дешёвого лота (обычно большого, углового или без вида). " +
        "Берём цену метра фактического минимального лота нужной категории: в «" + esc(z.name) + "» " + esc(e.group.type).toLowerCase() +
        " — от " + dec(e.group.minAreaM2) + " м² за " + mln(e.group.fromMln) + ", то есть <b>" + num(e.entryPpm) + " ₽/м²</b>. Ваш метраж: " +
        state.area + " м² × " + num(e.entryPpm) + " ₽ = <b>" + mln(e.costMln) + "</b>." +
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
      k.range.innerHTML = "Квартир " + state.area + " м² и меньше в продаже <b>нет</b>: самая маленькая — " +
        (e.minAreaM2 ? dec(e.minAreaM2) + " м²" : "—") + " за " + mln(floorPrice);
      k.how.textContent = "Мы не показываем цену несуществующей квартиры: " + e.reason + ". Источник: " + z.sourceName + ", цена зафиксирована " + z.priceAsOf + ".";
      k.meter.style.width = "100%";
      k.meter.className = "bad";
      k.meterLabel.textContent = "не влезает";
    }
    k.meterBudget.textContent = "бюджет " + capBudget() + " млн ₽";

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
      verdict.innerHTML = capFirst(esc(r.reason)) + ". Значит, " + state.area + " м² здесь купить нельзя — и мы не рисуем «вам хватает».";
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
    var v = $("verdict"), prep = CITY_PREP[state.city] || ("в " + state.city);
    var capNote = res.queryCapApplied
      ? " Считаю по потолку из запроса: " + res.capMln + " млн ₽ (в поле бюджета указано " + state.budget + " млн)." : "";
    var head, sub;
    var narrowed = res.cityCountAll > res.cityCount
      ? "Ваши слова оставили " + res.cityCount + " из " + res.cityCountAll + " ЖК " + prep + " — остальные не подходят по тексту карточки. " : "";
    if (!res.cityCount && res.cityCountAll) {
      head = "Со словами запроса не совпал ни один ЖК " + prep;
      sub = "Всего в базе по этому городу " + res.cityCountAll + " ЖК, но в их описаниях нет того, что вы написали. " +
        "Нажмите «Сбросить» — расчёт останется на ползунках, или попробуйте слова, которые в карточках встречаются: " +
        "море, парк, метро, «сдан», отделка.";
    } else if (!res.cityCount) {
      head = "Нет данных по городу «" + state.city + "»";
      sub = "В базе 15 ЖК: " + cities().join(", ") + ".";
    } else if (res.fittingCount === 0) {
      var cheap = res.cheapest ? res.cheapest.entryFloor : null;
      head = "В бюджете " + res.capMln + " млн ₽ подходящих ЖК " + prep + " нет";
      sub = "Самый дешёвый вход " + prep + (state.klass !== "Все" ? " в классе «" + state.klass.toLowerCase() + "»" : "") + " — " +
        (cheap ? mln(cheap) + " (" + esc(res.cheapest.zhk.name) + ")" : "не найден") +
        "." + capNote + " " + narrowed + "Увеличьте бюджет, снимите фильтр класса или выберите другой город.";
    } else if (res.fittingCount >= res.cityCount) {
      head = "Все " + res.fittingCount + " ЖК " + prep +
        (res.cityCountAll > res.cityCount ? " (из " + res.cityCountAll + " в базе — остальные отсекает запрос)" : "") +
        " проходят в бюджет " + res.capMln + " млн ₽";
      sub = "Зелёным помечены комплексы, где квартир нужной площади хватает и цена входа ниже бюджета. Лидер отобран по скорингу, а не по цене: см. «совпадение» в карточке.";
    } else {
      head = res.fittingCount + " из " + res.cityCount + " ЖК " + prep + " реально проходят в бюджет " + res.capMln + " млн ₽";
      sub = narrowed + "Остальные — ниже, с причиной: «не хватает N млн» или «нет квартир такой площади». " +
        "Цена входа в карточках посчитана по реальному лоту, а не по «цене от за м²»." + capNote;
    }

    var leader = res.top[0];
    var pct = leader ? Math.min(100, Math.round(leader.cost / res.capMln * 100)) : 100;
    var reserve = leader ? leader.reserve : 0;
    v.innerHTML = '<div><h2>' + esc(head) + "</h2><p>" + sub + "</p>" +
      '<div class="v-pills">' +
        '<div class="v-pill"><span>Ваш запрос</span><b>' + state.area + " м² · " + res.capMln + " млн ₽" + (state.klass !== "Все" ? " · " + state.klass.toLowerCase() : "") + "</b></div>" +
        '<div class="v-pill"><span>Проходит в бюджет</span><b>' + res.fittingCount + " из " + res.cityCount + " ЖК</b></div>" +
        '<div class="v-pill"><span>Ваш порог за м²</span><b>до ' + num(res.maxAffordablePpm) + " ₽</b></div>" +
      "</div></div>" +
      '<div class="thermo">' +
        '<div class="thermo-top"><span>Термометр бюджета' + (leader ? " · " + esc(leader.zhk.name) : "") + "</span><b>" + pct + "%</b></div>" +
        '<div class="thermo-track"><div class="thermo-fill ' + (pct >= 100 ? "bad" : pct > 85 ? "warn" : "") + '" style="width:' + pct + '%"></div>' +
          '<div class="thermo-ticks"><i style="left:25%"></i><i style="left:50%"></i><i style="left:75%"></i></div></div>' +
        '<div class="thermo-legend"><span>0</span><span>' + num(res.capMln / 2) + " млн</span><span>" + res.capMln + " млн (100%)</span></div>" +
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
  function renderPanelHints(res) {
    var list = cityList(state.city);
    var ppms = list.map(function (z) { return z.pricePerM2; });
    $("cityCountHint").textContent = list.length + " ЖК в базе";
    $("cityPriceNote").textContent = "Цены в " + state.city + ": от " + num(Math.min.apply(null, ppms) / 1000) +
      " тыс. до " + num(Math.max.apply(null, ppms) / 1000) + " тыс. ₽/м² · класс у 15 из 15 ЖК взят из поля источника";
    $("maxPpmHint").textContent = "ваш порог: до " + num(res.maxAffordablePpm) + " ₽/м²";
    $("budgetPctHint").textContent = "доступно " + num(res.capMln * 1e6 / state.area) + " ₽/м²";
    $("ctaCount").textContent = "Подобрано " + res.top.length + " из " + res.cityCount +
      (state.klass !== "Все" ? " ЖК класса «" + state.klass.toLowerCase() + "»" : "");
    $("ctaNote").textContent = res.fittingCount ? "цена входа, остаток, ипотека" : "увеличьте бюджет или снимите фильтр";
    var bg = list[0] ? photoFor(list[0].imgKey) : "";
    $("heroBg").style.backgroundImage = bg ? "url('" + bg + "')" : "none";
    var q = res.query || {};
    renderIntent(q, res);
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
    if (!bits.length) { host.innerHTML = state.query ? "<b>Ничего конкретного в запросе не нашёл — работают ползунки.</b>" : ""; return; }
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
      var st = z.city === state.city ? (fit[z.id] || "na") : "na";
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
      "Подсветка слева — результат текущего подбора по городу «" + esc(state.city) + "». " +
      '<span class="only-mobile">На телефоне скрыты три второстепенные колонки (застройщик, макс. ₽/м², число лотов) — ' +
      "они есть в CSV и на широком экране.</span></caption>" +
      "<thead><tr>" + ["№", "Город", "ЖК", "Застройщик", "Район", "Класс в источнике", "Класс (наш)", "цена от ₽/м²", "макс. ₽/м²", "мин. лот", "мин. площадь", "лотов", "Срок сдачи", "Дата цены", "Источник"]
        .map(function (h) { return '<th scope="col"' + (WIDE_COLS[h] ? ' class="wide"' : "") + ">" + h + "</th>"; }).join("") + "</tr></thead><tbody>" + rows + "</tbody></table>";
    tableDirty = false;
  }

  /* ------------------------------------------------------------------ заявка / сравнение */
  function toggleSaved(name) {
    var i = saved.indexOf(name);
    if (i < 0) saved.push(name); else saved.splice(i, 1);
    $("compareBtn").textContent = saved.length ? "Сравнить " + saved.length + " ЖК" : "Сравнить 0 ЖК";
    $("leadNote").textContent = saved.length
      ? "Локально собрано " + saved.length + " ЖК. Отправка не подключена (демо без бэкенда)."
      : "Демо-форма: отправка не подключена (нет бэкенда). В проде — CRM или Telegram-бот застройщика.";
    (last ? last.top.concat(last.rest) : []).forEach(function (r) { updateCard(cardCache.get(r.zhk.id), r, last.top[0] === r); });
  }

  /* ------------------------------------------------------------------ URL */
  function syncUrl() {
    if (location.protocol === "file:") return;
    try {
      var u = new URL(location.href);
      u.search = "";
      u.searchParams.set("city", state.city);
      u.searchParams.set("budget", state.budget);
      u.searchParams.set("area", state.area);
      if (state.klass !== "Все") u.searchParams.set("klass", state.klass);
      if (state.query) u.searchParams.set("q", state.query);
      history.replaceState(null, "", u.pathname + "?" + u.searchParams.toString());
    } catch (e) { /* file:// и урезанные браузеры — не критично */ }
  }

  function readUrl() {
    if (!location.search) return;
    var p = new URLSearchParams(location.search);
    if (p.get("city") && cities().indexOf(p.get("city")) >= 0) state.city = p.get("city");
    if (p.get("budget")) state.budget = clamp(p.get("budget"), 5, 400);
    if (p.get("area")) state.area = clamp(p.get("area"), 18, 250);
    if (["Бизнес", "Премиум"].indexOf(p.get("klass")) >= 0) state.klass = p.get("klass");
    if (p.get("q")) state.query = String(p.get("q")).slice(0, 120);
  }

  /* ------------------------------------------------------------------ рендер */
  function render() {
    if (!DATA.length || !C) { fatal(); return; }
    var res;
    try { res = C.match(DATA, params()); }
    catch (err) { $("verdict").innerHTML = "<div><h2>Ошибка расчёта</h2><p>" + esc(err.message) + "</p></div>"; return; }
    last = res;
    tableDirty = true;

    renderPanelHints(res);
    renderVerdict(res);
    $("cardsH").textContent = (res.fittingCount ? "Топ-" + res.top.length : "Варианты") + " новостроек " + (CITY_PREP[state.city] || ("в " + state.city)) +
      " · " + state.area + " м² · бюджет " + res.capMln + " млн ₽";
    syncCards($("topCards"), res.top, true);
    syncCards($("excludedCards"), res.rest, false);
    $("excludedWrap").hidden = res.rest.length === 0;
    if (!res.top.length) { $("excludedWrap").open = true; $("cardsH").textContent = "Ни один ЖК " + (CITY_PREP[state.city] || state.city) + " не подошло — ниже причины по каждому"; }
    if (res.rest.length) $("excludedTitle").textContent = "Почему ещё " + res.rest.length + " ЖК " + (CITY_PREP[state.city] || state.city) + " не подошли";
    renderSheet();
    renderMethod();
    renderTable();
    syncUrl();
  }

  function fatal() {
    $("verdict").innerHTML = '<div><h2>Данные не загрузились</h2><p>Не найден <code>app/data.js</code> или <code>app/calc.js</code>. ' +
      "Открывайте <code>index.html</code> из папки репозитория целиком (все файлы рядом) — или используйте <code>index-standalone.html</code>, где всё уже внутри.</p></div>";
  }

  /* ------------------------------------------------------------------ события */
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function bind() {
    var bi = $("budgetInput"), br = $("budgetRange"), ai = $("areaInput"), ar = $("areaRange");
    bi.value = br.value = state.budget; ai.value = ar.value = state.area; $("queryInput").value = state.query;
    var raf = 0;
    function queue() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; render(); }); }
    function stripCaps() {   // пользователь двигает ползунок сам -> убираем числовые ограничения из слов запроса
      if (!state.query) return;
      var clean = state.query
        .replace(/(до|не дороже|не больше|от)\s*\d+([.,]\d+)?\s*(млн|м\b|м²)/gi, "")
        .replace(/\d+\s*(м2|м²)/gi, "").replace(/\s{2,}/g, " ").trim();
      if (clean !== state.query) { state.query = clean; $("queryInput").value = clean; }
    }
    function setBudget(v) { stripCaps(); state.budget = clamp(v, 5, 400); bi.value = state.budget; br.value = state.budget; mark("budget", state.budget); queue(); }
    function setArea(v) { stripCaps(); state.area = clamp(v, 18, 250); ai.value = state.area; ar.value = state.area; mark("area", state.area); queue(); }
    function mark(kind, v) {
      [].forEach.call(document.querySelectorAll("[data-" + kind + "]"), function (b) {
        b.setAttribute("aria-pressed", String(parseFloat(b.dataset[kind]) === v));
      });
    }
    bi.addEventListener("input", function () { setBudget(bi.value); });
    br.addEventListener("input", function () { setBudget(br.value); });
    ai.addEventListener("input", function () { setArea(ai.value); });
    ar.addEventListener("input", function () { setArea(ar.value); });
    [bi, ai].forEach(function (inp) { inp.addEventListener("change", function () { inp.blur(); render(); }); });
    mark("budget", state.budget); mark("area", state.area);

    [].forEach.call(document.querySelectorAll("[data-budget]"), function (b) { b.addEventListener("click", function () { setBudget(b.dataset.budget); }); });
    [].forEach.call(document.querySelectorAll("[data-area]"), function (b) { b.addEventListener("click", function () { setArea(b.dataset.area); }); });
    [].forEach.call(document.querySelectorAll("[data-klass]"), function (b) {
      b.addEventListener("click", function () {
        state.klass = b.dataset.klass;
        [].forEach.call(document.querySelectorAll("[data-klass]"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        render();
      });
    });

    $("goBtn").addEventListener("click", function () { $("results").scrollIntoView({ block: "start" }); });
    $("shareBtn").addEventListener("click", function () {
      syncUrl();
      var label = $("shareLabel"), txt = location.href;
      var ok = function () { label.textContent = "Ссылка скопирована"; setTimeout(function () { label.textContent = "Скопировать ссылку"; }, 2200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () { fallback(); });
      else fallback();
      function fallback() { window.prompt("Скопируйте ссылку на подбор:", txt); }
    });
    $("printBtn").addEventListener("click", function () { window.print(); });

    function runQuery() {
      state.query = $("queryInput").value.trim();
      var q = C.parseQuery(state.query);
      if (q.city) state.city = q.city;
      if (q.budgetMax) state.budget = clamp(q.budgetMax, state.budget, 400);
      if (q.areaMax) state.area = clamp(q.areaMax, 18, 250);
      if (q.klass) state.klass = q.klass;
      syncCityUI();
      [].forEach.call(document.querySelectorAll("[data-klass]"), function (x) { x.setAttribute("aria-pressed", String(x.dataset.klass === state.klass)); });
      render();
      $("results").scrollIntoView({ block: "start" });
    }
    $("queryBtn").addEventListener("click", runQuery);
    $("queryInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); runQuery(); } });
    $("resetBtn").addEventListener("click", function () {
      state = { city: state.city, budget: 25, area: 45, klass: "Все", query: "" };
      $("queryInput").value = "";
      syncCityUI();
      [].forEach.call(document.querySelectorAll("[data-klass]"), function (x) { x.setAttribute("aria-pressed", String(x.dataset.klass === "Все")); });
      render();
    });
    [].forEach.call(document.querySelectorAll("[data-scene]"), function (b) {
      b.addEventListener("click", function () {
        var s = JSON.parse(b.getAttribute("data-scene"));
        state.city = s.city; state.budget = s.budget; state.area = s.area;
        state.klass = s.klass || "Все"; state.query = s.q || "";
        $("queryInput").value = state.query;
        syncCityUI();
        [].forEach.call(document.querySelectorAll("[data-klass]"), function (x) { x.setAttribute("aria-pressed", String(x.dataset.klass === state.klass)); });
        render();
        $("results").scrollIntoView({ block: "start" });
      });
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
      var txt = "Сравнение ЖК (" + state.city + ")\n\n" + rows.map(function (z) {
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
      var list = (last ? last.top : []).map(function (r) { return r.zhk.name + " (" + mln(r.cost) + ")"; }).join("; ");
      $("leadMsg").textContent = "Спасибо, " + n + "! Подборка «" + state.city + " · " + state.budget + " млн · " + state.area +
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
    readUrl();
    syncCityUI();
    bind();
    [].forEach.call(document.querySelectorAll("[data-klass]"), function (x) { x.setAttribute("aria-pressed", String(x.dataset.klass === state.klass)); });
    $("compareBtn").textContent = saved.length ? "Сравнить " + saved.length + " ЖК" : "Сравнить 0 ЖК";
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
