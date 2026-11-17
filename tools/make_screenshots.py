from playwright.sync_api import sync_playwright
import pathlib, os

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8000") + "/index.html"  # запуск: python3 -m http.server 8000
OUT = str(pathlib.Path(__file__).resolve().parent.parent / "screenshots") + "/"

def shot_finder(pg, path):
    """Снимает панель подбора целиком: липкую шапку убираем, чтобы она не легла поверх кадра."""
    pg.evaluate("""() => { const bar = document.querySelector('.topbar'); if (bar) bar.style.display = 'none'; }""")
    pg.wait_for_timeout(200)
    pg.locator("#finder").screenshot(path=path)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1420, "height": 1120}, device_scale_factor=1.5)
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(400)

    # 1. Первый экран: шапка + герой + панель подбора + вердикт с «термометром бюджета»
    page.screenshot(path=OUT + "01_sochi_25mln_45m2.png")
    print("01 ok")

    # 2. Москва · 30 млн · 55 м² · бизнес — карточки с фото, ипотекой и скорингом
    page.click('button[data-scene]:has-text("Москва · 30 млн")')
    page.wait_for_timeout(350)
    page.evaluate("window.scrollTo(0, document.getElementById('results').offsetTop)")
    page.wait_for_timeout(250)
    page.screenshot(path=OUT + "02_moskva_30mln_55m2.png")
    print("02 ok")

    # 3. Екатеринбург · 16 млн · 60 м² + запрос словами + раскрытая таблица (вся страница)
    page.click("#adv"); page.wait_for_timeout(250)      # поле «словами» живёт под <details>
    page.fill("#queryInput", "2 комнаты в екатеринбурге до 16 млн")
    page.click('button[data-scene]:has-text("Екатеринбург · 16 млн")')
    page.wait_for_timeout(300)
    page.click("#queryBtn"); page.wait_for_timeout(300)
    page.click("#goBtn"); page.wait_for_timeout(500)     # результат — только по кнопке
    page.click("#toggleTableBtn")
    page.wait_for_timeout(250)
    page.screenshot(path=OUT + "03_ekaterinburg_16mln_60m2_table.png", full_page=True)
    print("03 ok")

    # 4. Проверка честности: «Премиум в ЦАО · 140 млн · 85 м²» -> пустое состояние
    page.goto(BASE, wait_until="networkidle"); page.wait_for_timeout(400)
    page.click('button[data-scene]:has-text("Премиум в ЦАО")')
    page.wait_for_timeout(400)
    page.evaluate("window.scrollTo(0, document.getElementById('results').offsetTop - 60)")
    page.wait_for_timeout(200)
    page.screenshot(path=OUT + "04_premium_tceo_empty_state.png")
    print("04 ok")

    # 4b. Карточка ЖК: нарисованная аналитика вместо фото (лоты, срок сдачи, полоска бюджета)
    page.goto(BASE, wait_until="networkidle"); page.wait_for_timeout(400)
    page.click("#goBtn"); page.wait_for_timeout(700)
    page.locator("#topCards .card").first.screenshot(path=OUT + "09_card_analytics.png")
    print("09 ok")

    # 4c. Список-витрина «Все новостройки города» (карточка как на маркетплейсе)
    page.click("#marketBtn"); page.wait_for_timeout(700)
    page.evaluate("window.scrollTo(0, document.getElementById('market').offsetTop - 10)")
    page.wait_for_timeout(400)
    page.screenshot(path=OUT + "10_market_list.png")
    print("10 ok")

    # 7. Шаг 1 «куда смотрим»: плитки городов + настроение города (акцент перекрашивается под Москву)
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(450)
    page.click('.city-card[data-city="Сочи"]')          # показываем смену города и перекраску акцента
    page.wait_for_timeout(450)
    page.click('.city-card[data-city="Москва"]')
    page.wait_for_timeout(900)
    shot_finder(page, OUT + "07_finder_city_step.png")
    print("07 ok")

    # 8. Мобильная панель подбора: плитки городов, рубли, готовые диапазоны и раскрытые «расширенные»
    mm = browser.new_page(viewport={"width": 390, "height": 1200}, device_scale_factor=2)
    mm.goto(BASE, wait_until="networkidle")
    mm.wait_for_timeout(600)
    shot_finder(mm, OUT + "08_mobile_finder.png")
    mm.click("#adv"); mm.wait_for_timeout(400)
    shot_finder(mm, OUT + "11_mobile_advanced.png")
    print("08/11 ok")

    # 5. Мобильная версия
    m = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    m.goto(BASE, wait_until="networkidle")
    m.wait_for_timeout(400)
    m.click("#burger")
    m.wait_for_timeout(200)
    m.screenshot(path=OUT + "05_mobile_menu_and_cards.png")
    m.click("#burger")
    m.evaluate("window.scrollTo(0, document.getElementById('results').offsetTop)")
    m.wait_for_timeout(300)
    m.screenshot(path=OUT + "06_mobile_cards.png")
    print("05/06 ok")
    browser.close()
