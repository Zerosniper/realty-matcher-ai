/*
 * app/calc.js — модель подбора «НовостройкиПро» (без DOM, без зависимостей).
 *
 * WHY: единственная «умная» часть продукта вынесена в отдельный модуль, чтобы её
 * можно было тестировать (tests/calc.test.js) и чтобы расчёт не зависел от вёрстки.
 *
 * ЧЕСТНОСТЬ МОДЕЛИ (см. README → «Методология и допущения»):
 *  1. «Цена от ₽/м²» у агрегатора — это метр САМОГО ДЕШЁВОГО (обычно самого большого
 *     или худшего по виду) лота. Умножать её на любую площадь нельзя: цена занижается.
 *     Поэтому нижняя граница считается от РЕАЛЬНОГО минимального лота нужной комнаты:
 *     ppmLot = minLotPrice / minLotArea — фактическая цена входа за метр.
 *  2. В комплексе может НЕ БЫТЬ квартир запрошенной площади (например, минимум 115 м²).
 *     Тогда вариант не показывается как подходящий — показываем причину и реальный минимум.
 *  3. Ранжирование — не «самый дорогой, который влез», а взвешенный скоринг
 *     (использование бюджета, готовность, выбор лотов, цена метра).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZHK_CALC = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WEIGHTS = { budgetUse: 40, readiness: 20, choice: 20, priceValue: 20 };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function fmtNum(v) { return String(Math.round(v * 100) / 100).replace(".", ","); }

  /** Самый дешёвый лот в комплексе (используется, когда запрошенной площади нет в продаже). */
  function group0min(zhk) {
    var arr = (zhk.lots || []).map(function (l) { return l.fromMln; }).filter(function (v) { return v != null; });
    return arr.length ? Math.min.apply(null, arr) : (zhk.minLotMln || null);
  }

  /** Группа лотов (студия/1к/2к...), в которую помещается запрошенная площадь. */
  function pickLotGroup(zhk, areaM2) {
    var lots = (zhk.lots || []).filter(function (l) {
      return l.minAreaM2 != null && l.minAreaM2 <= areaM2;
    });
    if (!lots.length) return null;
    lots.sort(function (a, b) { return b.minAreaM2 - a.minAreaM2; });
    return lots[0];
  }

  /** Есть ли в комплексе квартиры НЕ МЕНЬШЕ запрошенной площади. */
  function minAvailableArea(zhk) {
    var arr = (zhk.lots || []).map(function (l) { return l.minAreaM2; }).filter(function (v) { return v != null; });
    return arr.length ? Math.min.apply(null, arr) : (zhk.minAreaM2 || null);
  }

  /**
   * Оценка стоимости квартиры нужной площади в конкретном ЖК.
   *
   * Две границы, обе с опорой на реальные лоты источника:
   *   naiveMln — то, что даёт «цена от ₽/м² × площадь». Показываем её только чтобы
   *              объяснить пользователю, почему агрегаторы врут про «от».
   *   costMln  — честная цена входа: цена метра фактического минимального лота нужной
   *              категории, пересчитанная на ваш метраж.
   */
  function estimate(zhk, areaM2) {
    var group = pickLotGroup(zhk, areaM2);
    if (!group) {
      return {
        available: false, group: null, minAreaM2: minAvailableArea(zhk),
        minLotPriceMln: group0min(zhk),
        reason: group0min(zhk) ? "нет квартир меньше " + fmtNum(minAvailableArea(zhk)) + " м² — вход от " + mlnTxt(group0min(zhk)) : "нет данных о лотах в продаже"
      };
    }
    var ppmFrom = zhk.pricePerM2, ppmTo = zhk.pricePerM2Max || zhk.pricePerM2;
    var entryPpm = Math.round(group.fromMln * 1e6 / group.minAreaM2);   // ₽/м² как у самого дешёвого лота категории
    var naive = areaM2 * ppmFrom / 1e6;
    var cost = Math.max(naive, group.fromMln * Math.max(1, areaM2 / group.minAreaM2));
    var costTo = Math.max(areaM2 * ppmTo / 1e6, cost);
    return {
      available: true, group: group, entryPpm: entryPpm,
      naiveMln: round2(naive), costMln: round2(cost), costToMln: round2(costTo),
      understatePct: naive > 0 ? Math.round((cost / naive - 1) * 100) : 0,
      floorMln: round2(Math.max(cost, zhk.minLotMln || 0))
    };
  }

  function mlnTxt(v) { return (Math.round(v * 100) / 100).toFixed(2).replace(".", ",") + " млн ₽"; }

  /**
   * Итог по одному ЖК: проходит / впритык / не проходит + прозрачный скоринг.
   * capMln — «потолок» из текстового запроса («до 20 млн»), он строже указанного бюджета.
   */
  function evaluate(zhk, params, capMln) {
    var budget = params.budgetMln, area = params.areaM2, cap = capMln || params.budgetMln;
    var est = estimate(zhk, area);
    var out = { zhk: zhk, estimate: est, available: est.available, status: "unavailable", score: 0, scoreParts: [], reason: est.reason || "" };
    if (!est.available) { out.entryFloor = zhk.minLotMln || est.minLotPriceMln || 0; return out; }

    var cost = est.costMln;
    out.cost = cost;
    out.entryFloor = est.floorMln;
    out.naiveTrap = est.naiveMln <= cap && cost > cap;   // старая формула пообещала бы, что хватает
    out.reserve = round2(cap - cost);
    if (cost <= cap) { out.status = (cap - cost) / cap < 0.05 ? "tight" : "fits"; }
    else { out.status = "over"; out.need = round2(cost - cap); }

    var used = cost / cap;
    var pBudget = out.status === "fits"
      ? WEIGHTS.budgetUse * clamp(0.35 + used * 0.65, 0, 1)
      : out.status === "tight" ? WEIGHTS.budgetUse * 0.8 : out.naiveTrap ? WEIGHTS.budgetUse * 0.15 : 0;
    var year = zhk.deliveryYearFrom || 2027;
    var pReady = WEIGHTS.readiness * clamp(1 - Math.max(0, year - 2026) * 0.22 - (zhk.deliveryYearTo && zhk.deliveryYearTo > year ? 0.1 : 0), 0.15, 1);
    var nMatch = (zhk.lots || []).filter(function (l) { return l.minAreaM2 <= area; }).length;
    var pChoice = WEIGHTS.choice * clamp(0.25 + nMatch * 0.15 + Math.min(zhk.offers || 8, 60) / 120, 0, 1);
    var minP = zhk._cityMinPpm || zhk.pricePerM2, maxP = zhk._cityMaxPpm || zhk.pricePerM2;
    var pValue = maxP > minP ? WEIGHTS.priceValue * (1 - clamp((zhk.pricePerM2 - minP) / (maxP - minP), 0, 1) * 0.85) : WEIGHTS.priceValue * 0.7;
    if (out.status === "over") pValue *= 0.4;

    out.scoreParts = [
      { key: "budgetUse", label: "Использование бюджета", weight: WEIGHTS.budgetUse, points: pBudget },
      { key: "readiness", label: "Срок сдачи", weight: WEIGHTS.readiness, points: pReady },
      { key: "choice", label: "Выбор планировок", weight: WEIGHTS.choice, points: pChoice },
      { key: "priceValue", label: "Цена метра в городе", weight: WEIGHTS.priceValue, points: pValue }
    ];
    out.score = Math.round(out.scoreParts.reduce(function (s2, x) { return s2 + x.points; }, 0));
    return out;
  }

  var CITY_WORDS = { "сочи": "Сочи", "москва": "Москва", "москве": "Москва", "мск": "Москва",
    "екатеринбург": "Екатеринбург", "екб": "Екатеринбург", "ека": "Екатеринбург" };

  var INTENT_MAP = {
    sea: /мор[еяе]|берег|пляж|примор|перв\w* лин|курорт|адлер|уч-дере|имерет/i,
    park: /парк|лес|зелен|зелён/i,
    school: /школ|детсад|детск\w* сад|сад\n?|секц/i,
    // «\b» с кириллицей без флага u не работает (граница слова определяется по ASCII), поэтому разделитель задаём явно:
    metro: /метро|пешком до|(^|[\s(,])м\.\s*[а-яё]|станц[аи]/i,
    done: /сдан|готов\w*|уже постро/i,
    soon: /2026|в этом году|скор/i,
    studio: /студи/i,
    one: /1-комн|однокомн|однушк/i,
    two: /2-комн|двухкомн/i,
    three: /3-комн|трёхкомн|трехкомн/i,
    premium: /премиум|клубн|элит/i,
    business: /бизнес/i
  };

  /**
   * Разбор свободного запроса («студия у моря до 20 млн в Сочи»).
   * Это правила + словарь, а не «магия»: каждый извлечённый критерий возвращается
   * в виде чипов, чтобы пользователь видел, как именно его поняли.
   */
  function parseQuery(text) {
    var t = (text || "").trim();
    var out = { raw: t, city: null, budgetMax: null, budgetMin: null, areaMax: null, areaMin: null,
      klass: null, rooms: null, areaStated: false, intents: [] };
    if (!t) return out;
    var lower = t.toLowerCase();
    // \b не работает с кириллицей без флага u — используем подстроку: слова короткие, ложных срабатываний нет
    Object.keys(CITY_WORDS).forEach(function (w) { if (!out.city && lower.indexOf(w) >= 0) out.city = CITY_WORDS[w]; });
    var m = lower.match(/(?:до|не дороже|max|макс)\s*(\d+(?:[.,]\d+)?)\s*(млн|м\b)/);
    if (m) out.budgetMax = parseFloat(m[1].replace(",", "."));
    var m2 = t.match(/(\d{1,3})\s*(?:м2|м²|квадрат)/i);
    if (m2) { out.areaMax = parseInt(m2[1], 10); out.areaStated = true; }
    var m3 = t.match(/от\s*(\d{2,3})\s*(?:млн)/i);
    if (m3) out.budgetMin = parseFloat(m3[1]);
    var rooms = t.match(/(\d)\s*-?\s*(?:комн|к\b)/i);
    if (rooms) out.rooms = parseInt(rooms[1], 10);
    // разговорные названия: «трёшка», «двушка» — тот же смысл, что и «3-комн»
    if (out.rooms == null) {
      var WORD_ROOMS = { "однуш": 1, "однок": 1, "двуш": 2, "двухк": 2, "трёш": 3, "треш": 3, "четвер": 4, "пятач": 5 };
      Object.keys(WORD_ROOMS).forEach(function (w) { if (out.rooms == null && lower.indexOf(w) >= 0) out.rooms = WORD_ROOMS[w]; });
    }
    Object.keys(INTENT_MAP).forEach(function (k) {
      if (INTENT_MAP[k].test(t)) out.intents.push(k);
    });
    if (out.intents.indexOf("premium") >= 0) out.klass = "Премиум";
    else if (out.intents.indexOf("business") >= 0) out.klass = "Бизнес";
    if (out.intents.indexOf("studio") >= 0) { out.rooms = 0; if (!out.areaMax) out.areaMax = 32; }
    if (out.rooms == null) {
      if (out.intents.indexOf("one") >= 0) out.rooms = 1;
      else if (out.intents.indexOf("two") >= 0) out.rooms = 2;
      else if (out.intents.indexOf("three") >= 0) out.rooms = 3;
    }
    if (out.rooms === 1 && !out.areaMax) out.areaMax = 50;
    if (out.rooms === 2 && !out.areaMax) out.areaMax = 75;
    if (out.rooms === 3 && !out.areaMax) out.areaMax = 110;
    if (/без отделки|с отделкой/.test(lower)) out.intents.push("finishing");
    return out;
  }

  function textOf(z) { return [z.district, z.feature, z.developer, z.name, z.delivery].join(" ").toLowerCase(); }

  /** Основной API: подобрать N вариантов в городе. */
  function match(data, params) {
    var opts = params.opts || {};
    var topN = opts.topN || 3;
    var q = params.query || {};
    var city = data.filter(function (z) { return z.city === params.city; });
    var cityCountAll = city.length;
    if (params.klass && params.klass !== "Все") city = city.filter(function (z) { return z.zhkClass === params.klass; });
    if (!city.length) {
      return { city: params.city, params: params, query: q, all: [], top: [], rest: [], fittingCount: 0,
        cityCount: 0, cheapest: null, capMln: params.budgetMln, queryCapApplied: false,
        emptyReason: params.klass && params.klass !== "Все"
          ? "в базе нет ЖК класса «" + params.klass + "» в этом городе" : "город не найден",
        marketMin: 0, marketMax: 0, maxAffordablePpm: Math.floor(params.budgetMln * 1e6 / params.areaM2) };
    }
    if (q.intents && q.intents.length) {
      city = city.filter(function (z) {
        var txt = textOf(z);
        return q.intents.every(function (k) {
          if (k === "finishing") return true;
          // «студия / 1-комн / 2-комн / 3-комн» — это про лоты, а не про текст карточки ЖК:
          // их обрабатывает фильтр по rooms, здесь их делать нечего (иначе ЖК исчезал из выдачи).
          if (k === "studio" || k === "one" || k === "two" || k === "three") return true;
          if (k === "done") return /сдан/.test((z.delivery || "").toLowerCase());
          if (k === "premium" || k === "business") return true;
          if (INTENT_MAP[k]) return INTENT_MAP[k].test(txt);
          return true;
        });
      });
    }
    if (q.rooms != null) {
      var need = q.rooms === 0 ? 20 : q.rooms * 22;
      city = city.filter(function (z) { return !!pickLotGroup(z, Math.max(need, q.areaMax || need)); });
    }
    var ppms = city.map(function (z) { return z.pricePerM2; });
    // если слова запроса отсеяли всё — Math.min([]) вернул бы Infinity и он утёк бы в интерфейс
    var minP = ppms.length ? Math.min.apply(null, ppms) : 0;
    var maxP = ppms.length ? Math.max.apply(null, ppms) : 0;
    city.forEach(function (z) { z._cityMinPpm = minP; z._cityMaxPpm = maxP; });

    var cap = q.budgetMax ? Math.min(params.budgetMln, q.budgetMax) : params.budgetMln;
    var res = city.map(function (z) { return evaluate(z, params, cap); });
    res.forEach(function (r) {
      if (r.status === "fits") r.sortRank = 0;
      else if (r.status === "tight") r.sortRank = 1;
      else if (r.status === "over") r.sortRank = 2;
      else r.sortRank = 3;
    });
    res.sort(function (a, b) {
      if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
      if (b.score !== a.score) return b.score - a.score;
      return a.cost - b.cost; // при равном скоре — честнее тот, что дешевле
    });
    var fitting = res.filter(function (r) { return r.status === "fits" || r.status === "tight"; });
    var others = res.filter(function (r) { return r.status !== "fits" && r.status !== "tight"; });
    return {
      city: params.city, params: params, query: q,
      all: res, top: fitting.slice(0, topN), rest: fitting.slice(topN).concat(others),
      fittingCount: fitting.length, cityCount: city.length, cityCountAll: cityCountAll,
      cheapest: res.slice().sort(function (a, b) { return (a.entryFloor || 1e9) - (b.entryFloor || 1e9); })[0],
      marketMin: minP, marketMax: maxP, capMln: cap, queryCapApplied: cap < params.budgetMln,
      maxAffordablePpm: Math.floor(cap * 1e6 / params.areaM2)
    };
  }

  /** Аннуитетный платёж. totalMln — цена квартиры, downPct — взнос, ratePct — годовых, years — срок. */
  function mortgage(totalMln, opts) {
    var downPct = opts.downPct != null ? opts.downPct : 20;
    var ratePct = opts.ratePct != null ? opts.ratePct : 6;
    var years = opts.years != null ? opts.years : 20;
    var principal = Math.max(0, totalMln * 1e6 * (1 - downPct / 100));
    var r = ratePct / 100 / 12, n = years * 12;
    var monthly = r > 0 ? principal * r / (1 - Math.pow(1 + r, -n)) : principal / n;
    var overpay = monthly * n - principal;
    return {
      principal: Math.round(principal), down: Math.round(totalMln * 1e6 * downPct / 100),
      monthly: Math.round(monthly), overpay: Math.round(overpay),
      total: Math.round(totalMln * 1e6 * downPct / 100 + monthly * n), years: years, ratePct: ratePct, downPct: downPct
    };
  }

  /** Человеческая формулировка дефицита бюджета (без «немного маловат» при нехватке в 2,8 раза). */
  function budgetVerdict(money, need) {
    if (need <= 0) return "хватает";
    var ratio = money / (money + need);
    if (ratio >= 0.85) return "чуть не хватает";
    if (ratio >= 0.6) return "не хватает";
    return "таких предложений в этом городе нет";
  }

  return {
    WEIGHTS: WEIGHTS, match: match, evaluate: evaluate, estimate: estimate, parseQuery: parseQuery,
    mortgage: mortgage, budgetVerdict: budgetVerdict, pickLotGroup: pickLotGroup,
    minAvailableArea: minAvailableArea, fmtNum: fmtNum, mlnTxt: mlnTxt
  };
});
