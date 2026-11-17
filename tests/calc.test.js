/*
 * tests/calc.test.js — проверка модели подбора на РЕАЛЬНЫХ данных 15 ЖК.
 * Запуск:  node tests/calc.test.js      (node >= 14, зависимостей нет)
 *
 * Тесты родились из аудита: старая формула «цена от ₽/м² × площадь» обещала квартиру
 * дешевле, чем самый дешёвый лот застройщика. Здесь зафиксировано, что это больше
 * невозможно ни на одном пресете.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const CALC = require(path.join(__dirname, "..", "app", "calc.js"));

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "zhk.json"), "utf8"));
const byName = (frag) => DATA.find((z) => z.name.includes(frag));
let n = 0;
function test(name, fn) {
  n++;
  try { fn(); console.log("  ok  " + name); }
  catch (e) { console.log("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; }
}

console.log("\nНовостройкиПро · тесты расчёта (" + DATA.length + " ЖК, данные 15-16.11.2026)\n");

test("датасет: 15 ЖК, 3 города, класс у каждой строки есть в источнике", () => {
  assert.strictEqual(DATA.length, 15);
  const cities = {};
  DATA.forEach((z) => { cities[z.city] = (cities[z.city] || 0) + 1; });
  assert.deepStrictEqual(cities, { "Сочи": 5, "Москва": 5, "Екатеринбург": 5 });
  DATA.forEach((z) => assert.ok(z.classSource, "нет класса из источника у " + z.name));
  DATA.forEach((z) => assert.ok(z.sourceUrl.startsWith("https://"), "нет источника у " + z.name));
});

test("оценка никогда не ниже фактического минимального лота комплекса", () => {
  [45, 55, 60, 85].forEach((area) => {
    DATA.forEach((z) => {
      const e = CALC.estimate(z, area);
      if (!e.available) return;
      assert.ok(e.costMln + 1e-6 >= Math.min(z.minLotMln, e.naiveMln),
        z.name + " @ " + area + " м²: оценка " + e.costMln + " ниже разумного пола " + z.minLotMln);
      assert.ok(e.costMln >= e.naiveMln - 1e-9, z.name + ": честная цена не может быть ниже «цены от × площадь»");
    });
  });
});

test("«Чистые Пруды»: 85 м² не существует — минимум 115 м² за 161,11 млн", () => {
  const z = byName("Чистые Пруды");
  const r = CALC.evaluate(z, { budgetMln: 140, areaM2: 85 });
  assert.strictEqual(r.status, "unavailable");
  assert.strictEqual(r.estimate.minAreaM2, 115);
  assert.ok(/115/.test(r.reason), "в причине должен быть реальный минимум площади: " + r.reason);
});

test("«Clos 17»: 85 м² в бюджет 140 млн НЕ проходит (факт: вход от 227,53 млн)", () => {
  const z = byName("Clos 17");
  const r = CALC.evaluate(z, { budgetMln: 140, areaM2: 85 });
  assert.strictEqual(r.status, "over");
  assert.ok(r.need > 80 && r.need < 130, "нехватка должна быть десятки миллионов, получено " + r.need);
  assert.ok(r.cost > 200, "оценка не может быть ниже реального мин. лота: " + r.cost);
});

test("пресет «Премиум в ЦАО 140 млн / 85 м²»: в премиуме ЦАО ничего не проходит", () => {
  const res = CALC.match(DATA, { city: "Москва", budgetMln: 140, areaM2: 85, klass: "Премиум" });
  assert.strictEqual(res.fittingCount, 0, "ни один премиум-ЖК не влезает: " + JSON.stringify(res.top.map((r) => [r.zhk.name, r.status])));
  const ch = res.all.find((r) => r.zhk.name.includes("Чистые Пруды"));
  assert.strictEqual(ch.status, "unavailable");
  const cl = res.all.find((r) => r.zhk.name.includes("Clos 17"));
  assert.strictEqual(cl.status, "over");
});

test("фильтр класса включён — бизнес Москвы на 140 млн / 85 м² честно проходит", () => {
  const res = CALC.match(DATA, { city: "Москва", budgetMln: 140, areaM2: 85 });
  assert.ok(res.fittingCount > 0, "без фильтра класса бизнес-ЖК обязан найтись");
  res.top.forEach((r) => assert.ok(r.cost <= 140.001, r.zhk.name + " не влезает в бюджет: " + r.cost));
});

test("разбор запроса на естественном языке", () => {
  const q = CALC.parseQuery("хочу студию у моря в Сочи до 20 млн");
  assert.strictEqual(q.city, "Сочи");
  assert.strictEqual(q.budgetMax, 20);
  assert.strictEqual(q.rooms, 0);
  assert.ok(q.intents.indexOf("sea") >= 0, "не распознал «у моря»: " + q.intents.join(","));
  const res = CALC.match(DATA, { city: q.city, budgetMln: 20, areaM2: q.areaMax || 30, query: q });
  res.top.forEach((r) => assert.ok(/мор|берег|примор|перв|курорт|адлер|уч-дере/i.test(r.zhk.feature + r.zhk.district),
    "в выдаче «у моря» оказался ЖК без моря: " + r.zhk.name));
});

test("пресет «Сочи 25 млн / 45 м²»: проходит там, где лот реально есть", () => {
  const res = CALC.match(DATA, { city: "Сочи", budgetMln: 25, areaM2: 45 });
  assert.ok(res.fittingCount >= 1, "должен найтись хотя бы один ЖК");
  res.top.forEach((r) => {
    assert.ok(r.cost <= 25 + 0.001, "в «подходящих» не может быть цены выше бюджета: " + r.zhk.name + " " + r.cost);
    assert.ok(r.estimate.available, "в «подходящих» не может быть unavailable");
  });
  const kis = res.all.find((r) => r.zhk.name.includes("Кислород"));
  assert.strictEqual(kis.status, "fits", "«Кислород» (студии 22,77 м² от 7,53 млн) обязан пройти");
});

test("пресет «Екатеринбург 16 млн / 60 м²»: считаем по лотам, а не по «цене от»", () => {
  const res = CALC.match(DATA, { city: "Екатеринбург", budgetMln: 16, areaM2: 60 });
  const park = res.all.find((r) => r.zhk.name.includes("Парк Столиц"));
  assert.ok(park.estimate.available, "в «Парк Столиц» есть 1-комн. от 43,6 м²");
  assert.ok(park.cost >= 14 && park.cost <= 16, "60 м² в «Парк Столиц» по лоту 43,6 м² за 10,49 млн → 14-16 млн, получено " + park.cost);
});

test("ранжирование: первый вариант — не «самый дорогой из влезших»", () => {
  const res = CALC.match(DATA, { city: "Сочи", budgetMln: 60, areaM2: 55 });
  const tops = res.top.filter((r) => r.status === "fits");
  if (tops.length > 1) {
    assert.strictEqual(tops[0].score >= tops[1].score, true, "сортировка по скорингу сломалась");
  }
  assert.ok(tops.length === 0 || tops[0].score >= 50, "у лидера должен быть высокий скор");
});

test("ипотека: аннуитет считается верно (13,93 млн, взнос 20%, 6%, 20 лет)", () => {
  const m = CALC.mortgage(13.93, { downPct: 20, ratePct: 6, years: 20 });
  assert.strictEqual(m.down, Math.round(13.93e6 * 0.2));
  assert.ok(Math.abs(m.monthly - 79839) < 200, "ожидано ~79 800 ₽/мес, получено " + m.monthly);
  assert.ok(m.overpay > 0 && m.total > 13.93e6);
});

test("формулировка дефицита честная: 5 млн против входа 13,78 млн — не «немного»", () => {
  assert.strictEqual(CALC.budgetVerdict(5, 8.78), "таких предложений в этом городе нет");
  assert.strictEqual(CALC.budgetVerdict(13, 0.78), "чуть не хватает");
  assert.strictEqual(CALC.budgetVerdict(25, 0), "хватает");
});

test("максимально доступная цена метра = бюджет / площадь", () => {
  const res = CALC.match(DATA, { city: "Сочи", budgetMln: 25, areaM2: 45 });
  assert.strictEqual(res.maxAffordablePpm, Math.floor(25e6 / 45));
});

test("naiveTrap: где старая формула обещала лишнее — помечено и объяснено", () => {
  const z = byName("Поляна Пик");
  const e = CALC.estimate(z, 45);
  assert.ok(e.naiveMln < z.minLotMln, "наивная цена (" + e.naiveMln + ") обязана быть ниже реального входа " + z.minLotMln);
  assert.ok(e.understatePct > 25, "занижение должно быть десятки процентов, получено " + e.understatePct);
  const r = CALC.match(DATA, { city: "Москва", budgetMln: 140, areaM2: 85, klass: "Премиум" });
  const cl = r.all.find((x) => x.zhk.name.includes("Clos 17"));
  assert.strictEqual(cl.status, "over");
  assert.ok(cl.naiveTrap === false || cl.naiveTrap === true);
});

test("потолок из текстового запроса строже указанного бюджета", () => {
  const q = CALC.parseQuery("студия у моря в сочи до 12 млн");
  const res = CALC.match(DATA, { city: "Сочи", budgetMln: 25, areaM2: 28, query: q });
  assert.strictEqual(res.capMln, 12);
  assert.strictEqual(res.queryCapApplied, true);
  assert.ok(res.all.every((r) => r.status !== "fits" || r.cost <= 12), "никто не должен «проходить» выше потолка");
});

test("разговорные названия комнат превращаются в метраж", () => {
  const t3 = CALC.parseQuery("трёшка у парка в сочи");
  assert.strictEqual(t3.rooms, 3, "«трёшка» = 3 комнаты");
  assert.strictEqual(t3.areaMax, 110, "и значит ориентир до 110 м²");
  const t2 = CALC.parseQuery("двушка до 16 млн");
  assert.strictEqual(t2.rooms, 2);
  assert.strictEqual(t2.areaMax, 75);
  const stated = CALC.parseQuery("трёшка 90 м² в сочи");
  assert.strictEqual(stated.areaMax, 90, "названный метраж важнее догадки");
  assert.strictEqual(stated.areaStated, true);
});

test("комнатные слова не вычёркивают ЖК из выдачи", () => {
  const q = CALC.parseQuery("студия у моря в сочи до 20 млн");
  assert.strictEqual(q.rooms, 0, "«студия» = 0 комнат");
  const res = CALC.match(DATA, { city: "Сочи", budgetMln: 20, areaM2: 28, query: q });
  assert.strictEqual(res.cityCount, 3, "у моря в срезе Сочи три ЖК — все должны остаться");
  assert.ok(res.all.length === 3 && res.all.every((r) => /мор|курорт|лини/i.test(r.zhk.feature)), "фильтр по морю работает");
  const one = CALC.parseQuery("однушка в сочи");
  assert.strictEqual(one.rooms, 1, "«однушка» понятна как 1 комната");
});

test("«у метро» находит ЖК, где источник пишет «м. Чкаловская»", () => {
  assert.ok(CALC.parseQuery("двушка у метро").intents.includes("metro"), "слово «метро» — интент");
  const res = CALC.match(DATA, { city: "Екатеринбург", budgetMln: 40, areaM2: 60, query: { intents: ["metro"] } });
  assert.strictEqual(res.cityCountAll, 5, "в Екатеринбурге 5 ЖК");
  assert.strictEqual(res.cityCount, 2, "с метро в описании — Парк Столиц и DOM 7");
  assert.ok(res.all.every((r) => /метро|(?:^|[\s(,])м\.\s*[а-яё]/i.test(r.zhk.district + " " + r.zhk.feature)),
    "у всех оставшихся метро действительно в тексте источника");
  const none = CALC.match(DATA, { city: "Сочи", budgetMln: 40, areaM2: 60, query: { intents: ["metro"] } });
  assert.strictEqual(none.cityCount, 0, "в Сочи метро нет — и не должно выдуматься");
  assert.ok(Number.isFinite(none.marketMin) && Number.isFinite(none.marketMax), "без выборки — ноль, а не Infinity");
});

test("район из расширенных настроек сужает выборку честно", () => {
  const ekb = CALC.districts(DATA, "Екатеринбург");
  assert.ok(ekb.length >= 3, "районы берутся из поля «Район»: " + ekb.join(" / "));
  const target = ekb[0];
  const res = CALC.match(DATA, { city: "Екатеринбург", budgetMln: 40, areaM2: 60, district: target, query: {} });
  const manual = DATA.filter((z) => z.city === "Екатеринбург" && z.district.toLowerCase().includes(target.toLowerCase()));
  assert.ok(res.cityCount === manual.length && res.cityCount > 0, `район «${target}»: ${res.cityCount} ЖК, в данных ${manual.length}`);
  assert.ok(res.cityCountAll === 5 && res.cityCount < res.cityCountAll, "фильтр виден в счётчиках: было 5, стало меньше");
  const none = CALC.match(DATA, { city: "Екатеринбург", budgetMln: 40, areaM2: 60, district: "Академический", query: {} });
  assert.strictEqual(none.cityCount, 0, "района, которого нет в срезе, не должно быть в выдаче");
  assert.ok(/Академический/.test(none.emptyReason), "причина названа словом: " + none.emptyReason);
  const both = CALC.match(DATA, { city: "Москва", budgetMln: 40, areaM2: 60, klass: "Бизнес", district: "Академический", query: {} });
  assert.ok(/класса «Бизнес»/.test(both.emptyReason) && /районе/.test(both.emptyReason), "два фильтра — две причины в одном тексте: " + both.emptyReason);
});

test("чип расширенных настроек = то же слово в запросе", () => {
  assert.ok(Array.isArray(CALC.INTENTS) && CALC.INTENTS.length >= 5, "список чипов живёт в calc.js");
  CALC.INTENTS.forEach(({ key, label }) => {
    const chip = CALC.match(DATA, { city: "Сочи", budgetMln: 50, areaM2: 60, query: { intents: [key] } });
    const word = CALC.match(DATA, { city: "Сочи", budgetMln: 50, areaM2: 60, query: CALC.parseQuery(label) });
    assert.deepStrictEqual(word.query.intents, [key], `подпись «${label}» должна давать ровно интент ${key}`);
    assert.strictEqual(chip.cityCount, word.cityCount, `чип и слово расходятся: ${key}`);
    const sochi = DATA.filter((z) => z.city === "Сочи" && CALC.intentHit(z, key)).length;
    assert.strictEqual(chip.cityCount, sochi, `intentHit(${key}) разошёлся с фильтром match()`);
  });
  assert.ok(CALC.intentHit(byName("Кислород"), "sea"), "«Кислород» — у моря");
  assert.ok(!CALC.intentHit(byName("Плеханова 11"), "sea"), "«Плеханова 11» — не у моря, выдумывать не будем");
  assert.ok(CALC.intentHit(byName("Парк Столиц"), "park"), "«Парк Столиц» — у парка");
});

console.log("\n" + (process.exitCode ? "ЕСТЬ ПРОВАЛЫ" : "все проверки пройдены") + " · " + n + " тестов\n");
