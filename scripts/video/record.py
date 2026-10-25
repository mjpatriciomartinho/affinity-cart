"""Records each browser scene of the demo video against the local Playground store.
Writes <id>.webm plus <id>.json with timing marks (seconds from page creation)."""
import json, os, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
B = "http://127.0.0.1:9400"
ADMIN = B + "/wp-admin/admin.php?page=affinity-cart"
W, H = 1440, 900

CURSOR = """
(() => {
  const put = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    Object.assign(c.style, {position:'fixed', width:'24px', height:'24px', borderRadius:'50%', background:'rgba(106,61,240,.28)',
      border:'2px solid #6a3df0', zIndex:2147483647, pointerEvents:'none', transform:'translate(-50%,-50%)',
      transition:'width .12s, height .12s', left: (sessionStorage.cx||720)+'px', top: (sessionStorage.cy||450)+'px'});
    document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX+'px'; c.style.top = e.clientY+'px'; sessionStorage.cx = e.clientX; sessionStorage.cy = e.clientY; }, true);
    addEventListener('mousedown', () => { c.style.width = c.style.height = '14px'; }, true);
    addEventListener('mouseup', () => { c.style.width = c.style.height = '24px'; }, true);
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', put) : put();
})();
"""


class Scene:
    def __init__(self, browser, sid):
        self.sid = sid
        self.ctx = browser.new_context(viewport={"width": W, "height": H}, record_video_dir=os.path.join(HERE, "raw"),
                                       record_video_size={"width": W, "height": H})
        self.ctx.add_init_script(CURSOR)
        self.pg = self.ctx.new_page()
        self.t0 = time.time()
        self.marks = {}

    def mark(self, name):
        self.marks[name] = round(time.time() - self.t0, 2)

    def hold(self, s):
        self.pg.wait_for_timeout(int(s * 1000))

    def move_to(self, locator, steps=28):
        box = locator.bounding_box()
        self.pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=steps)
        return box

    def click(self, locator):
        locator.scroll_into_view_if_needed()
        self.move_to(locator)
        self.hold(0.25)
        locator.click()

    def scroll(self, dy, steps=20, pause=0.03):
        for _ in range(steps):
            self.pg.mouse.wheel(0, dy / steps)
            self.pg.wait_for_timeout(int(pause * 1000))

    def done(self, dur):
        # Keep the scene on screen at least as long as its voiceover.
        start = self.marks.get("ready", 0)
        cut = sum(e - s for s, e in self.marks.get("cuts", []))
        remaining = dur - (time.time() - self.t0 - start - cut)
        if remaining > 0:
            self.hold(remaining + 0.2)
        self.mark("end")
        path = self.pg.video.path()
        self.ctx.close()
        os.replace(path, os.path.join(HERE, f"{self.sid}.webm"))
        json.dump(self.marks, open(os.path.join(HERE, f"{self.sid}.json"), "w"))
        print(self.sid, self.marks)


def clear_cart(browser):
    ctx = browser.new_context(); pg = ctx.new_page()
    pg.goto(B + "/", timeout=120000)
    pg.evaluate("""async () => {
      const r = await fetch('/wp-json/wc/store/v1/cart'); const nonce = r.headers.get('Nonce');
      await fetch('/wp-json/wc/store/v1/cart/items', {method: 'DELETE', headers: {Nonce: nonce}});
    }""")
    ctx.close()


def scene_shop(s, dur):
    s.pg.goto(B + "/?affinity_city=Bilbao", timeout=120000)
    s.pg.wait_for_selector(".ac-shop-head", timeout=60000); s.pg.wait_for_timeout(600)
    s.pg.evaluate("sessionStorage.removeItem('affinity_viewed')")
    s.pg.evaluate("window.scrollTo(0, 0)")
    s.mark("ready")
    s.hold(1.2)
    s.scroll(560, steps=30)
    s.hold(1.5)
    s.move_to(s.pg.locator(".affinity-cart .ac-card").first); s.hold(1.2)
    s.move_to(s.pg.locator(".affinity-cart .ac-reason").nth(1)); s.hold(1.0)
    s.scroll(620, steps=30); s.hold(0.8)
    badge = s.pg.locator(".ac-badge").first
    if badge.count():
        badge.scroll_into_view_if_needed(); s.move_to(badge)


def scene_city(s, dur):
    s.pg.goto(B + "/?affinity_city=Bilbao", timeout=120000)
    s.pg.wait_for_selector(".ac-shop-head", timeout=60000)
    s.pg.evaluate("document.querySelector('.affinity-cart').scrollIntoView({block: 'start'}); window.scrollBy(0, -40)")
    s.mark("ready")
    s.hold(0.8)
    sel = s.pg.locator(".ac-city select")
    s.move_to(sel); s.hold(0.4)
    a = round(time.time() - s.t0, 2) + 0.4
    sel.select_option("Berlin")
    s.pg.wait_for_selector(".ac-shop-head", timeout=60000)
    b = round(time.time() - s.t0, 2) - 0.2
    if b - a > 1.5:
        s.marks["cuts"] = [[a, b]]  # page reload + Qloo wait, cut in the edit
    s.pg.evaluate("document.querySelector('.affinity-cart').scrollIntoView({block: 'start'}); window.scrollBy(0, -40)")
    s.hold(0.6)
    s.move_to(s.pg.locator(".affinity-cart .ac-card").nth(1))


def scene_product(s, dur):
    s.pg.goto(B + "/product/for-emma-forever-ago-bon-iver-lp/", timeout=120000)
    s.pg.wait_for_selector(".affinity-cart .ac-card", timeout=60000)
    s.pg.wait_for_timeout(800)
    s.mark("ready")
    s.hold(1.5)
    top = s.pg.locator(".affinity-cart").first.bounding_box()["y"]
    s.scroll(top - 120, steps=40)
    s.hold(0.8)
    s.move_to(s.pg.locator(".affinity-cart .ac-reason").first); s.hold(1.4)
    s.move_to(s.pg.locator(".affinity-cart .ac-reason").nth(2)); s.hold(1.2)
    kit = s.pg.locator(".ac-kit")
    if kit.count():
        kit.scroll_into_view_if_needed(); s.hold(0.6)
        s.move_to(kit.locator(".ac-title")); s.hold(1.6)
        s.click(kit.locator("button")); s.pg.wait_for_selector(".ac-toast.is-on", timeout=20000)


def scene_gift(s, dur):
    s.pg.goto(B + "/", timeout=120000)
    s.pg.wait_for_selector(".ac-gift-fab", timeout=60000); s.pg.wait_for_timeout(600)
    s.mark("ready")
    s.hold(0.8)
    s.click(s.pg.locator(".ac-gift-fab")); s.hold(0.6)
    s.pg.locator(".ac-gift input").type("Fleet Foxes", delay=70); s.pg.keyboard.press("Enter"); s.hold(0.4)
    s.pg.locator(".ac-gift input").type("Wes Anderson films", delay=60); s.pg.keyboard.press("Enter"); s.hold(0.5)
    s.click(s.pg.locator(".ac-gift button[type=submit]"))
    s.hold(1.8)
    a = round(time.time() - s.t0, 2)
    s.pg.wait_for_selector(".ac-gift .ac-gift-summary", timeout=180000)
    b = round(time.time() - s.t0, 2) - 0.3
    s.marks["cuts"] = [[a, b]]  # the agent's thinking time is cut in the edit
    s.hold(1.2)
    s.move_to(s.pg.locator(".ac-gift .ac-reason").first); s.hold(1.6)
    s.move_to(s.pg.locator(".ac-gift .ac-reason").nth(1)); s.hold(1.0)
    s.click(s.pg.locator(".ac-gift .ac-card .ac-add").first)


def scene_checkout(s, dur):
    s.pg.goto(B + "/checkout/", timeout=120000)
    s.pg.wait_for_selector("text=Place order", timeout=60000); s.pg.wait_for_timeout(1200)
    s.mark("ready")
    s.hold(1.0)
    s.scroll(300, steps=20); s.hold(0.8)
    s.click(s.pg.get_by_role("button", name="Place order"))
    s.pg.wait_for_url("**/order-received/**", timeout=60000)
    s.hold(1.0)


def admin(s, tab, sel):
    s.pg.goto(f"{ADMIN}#{tab}", timeout=120000)
    s.pg.wait_for_selector(sel, timeout=60000); s.pg.wait_for_timeout(1500)


def scene_overview(s, dur):
    admin(s, "overview", ".ac-overview")
    s.mark("ready")
    s.hold(1.0)
    s.move_to(s.pg.locator(".ac-figure")); s.hold(1.8)
    s.move_to(s.pg.locator(".ac-sources")); s.hold(2.0)
    s.move_to(s.pg.locator(".ac-switch").first); s.hold(1.8)
    s.move_to(s.pg.locator(".ac-pipeline")); s.hold(1.5)
    s.move_to(s.pg.locator(".ac-log")); s.hold(1.0)


def scene_dna(s, dur):
    admin(s, "dna", ".ac-table")
    s.mark("ready")
    s.hold(1.2)
    row = s.pg.locator("tr", has_text="Leather Hiking Boots")
    box = row.bounding_box()
    s.scroll(box["y"] - 260, steps=40); s.hold(0.6)
    s.move_to(row.locator(".ac-chip").first); s.hold(1.5)
    s.move_to(row.locator(".ac-note")); s.hold(1.2)
    s.move_to(s.pg.locator(".ac-inspector")); s.hold(1.5)


def scene_tribes(s, dur):
    admin(s, "tribes", ".ac-tribe")
    s.mark("ready")
    s.hold(1.0)
    t = s.pg.locator(".ac-tribe").first
    s.move_to(t.locator("h3")); s.hold(1.2)
    s.move_to(t.locator(".ac-culture")); s.hold(2.0)
    s.move_to(t.get_by_role("button", name="Export for a campaign")); s.hold(0.8)


def scene_ghost(s, dur):
    admin(s, "ghost", ".ac-ghost li")
    s.mark("ready")
    s.hold(1.0)
    g = s.pg.locator(".ac-ghost li").first
    s.move_to(g.locator("h3")); s.hold(1.0)
    s.move_to(g.locator(".ac-chip-evidence").first); s.hold(1.2)
    btn = g.get_by_role("button", name="Create draft product")
    if btn.count():
        s.click(btn); s.pg.wait_for_selector("text=Edit draft product", timeout=60000)


SCENES = {"03-shop": scene_shop, "04-city": scene_city, "05-product": scene_product, "06-gift": scene_gift,
          "07-checkout": scene_checkout, "08-overview": scene_overview, "09-dna": scene_dna,
          "10-tribes": scene_tribes, "11-ghost": scene_ghost}

if __name__ == "__main__":
    segs = {s["id"]: s for s in json.load(open(os.path.join(HERE, "script.json")))}
    only = sys.argv[1:] or list(SCENES)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        if "05-product" in only or "06-gift" in only:
            clear_cart(browser)
        for sid in only:
            s = Scene(browser, sid)
            SCENES[sid](s, segs[sid]["dur"])
            s.done(segs[sid]["dur"])
        browser.close()
