/* Affinity Cart storefront. Vanilla JS, no dependencies. It inherits the theme's
 * typography and adds one signature: taste violet, plain-language reasons.
 *
 *  - Shop/home: "Picked for you in <city>" row + a badge on matching products.
 *  - Product page: "Complete the vibe", kits, and live picks as you browse.
 *  - Everywhere: a floating gift finder (Claude + Qloo, this shop's stock only).
 * Everything added from here is tagged, so the order line carries its source. */
(function () {
  "use strict";
  var cfg = window.AffinityCart;
  if (!cfg) return;
  var CO_PURCHASE = "Bought together by your customers";
  var CITIES = ["Madrid", "Barcelona", "Lisbon", "Berlin", "Valencia", "Bilbao"];

  // ---------- helpers ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function money(n) {
    return Math.round(n) + " " + (cfg.currency || "€");
  }
  function api(path, body) {
    return fetch(cfg.rest + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json", "X-WP-Nonce": cfg.nonce } : { "X-WP-Nonce": cfg.nonce },
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.message || d.error || "Request failed");
        return d;
      });
    });
  }
  // The first visit from a new city can outrun Qloo; the service then answers
  // "pending" while it warms its cache, so ask again a few seconds later.
  function live(body, tries) {
    return api("/live", body).then(function (res) {
      if (res.pending && (tries || 0) < 2) {
        return new Promise(function (r) { setTimeout(r, 5000); }).then(function () { return live(body, (tries || 0) + 1); });
      }
      return res;
    });
  }
  function path(u) {
    try { return new URL(u, location.href).pathname.replace(/\/$/, ""); } catch (e) { return ""; }
  }

  // Products viewed this session: the live signal. Kept in this browser only.
  var viewed = [];
  try { viewed = JSON.parse(sessionStorage.getItem("affinity_viewed") || "[]"); } catch (e) {}
  if (cfg.productId) {
    var me = String(cfg.productId);
    viewed = viewed.filter(function (id) { return id !== me; }).concat(me).slice(-8);
    try { sessionStorage.setItem("affinity_viewed", JSON.stringify(viewed)); } catch (e) {}
  }

  // ---------- cart ----------
  var toast;
  function notify(msg) {
    if (!toast) {
      toast = el("div", "ac-toast");
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.innerHTML = "";
    toast.appendChild(el("span", null, msg));
    var a = el("a", null, "View cart");
    a.href = cfg.cartUrl;
    toast.appendChild(a);
    toast.classList.add("is-on");
    clearTimeout(notify.t);
    notify.t = setTimeout(function () { toast.classList.remove("is-on"); }, 4000);
  }
  function addToCart(ids, source, button) {
    if (button) { button.disabled = true; button.textContent = "Adding…"; }
    return api("/cart", { items: ids, source: source })
      .then(function () {
        // Lets WooCommerce's mini-cart block refresh its count.
        document.body.dispatchEvent(new Event("wc-blocks_added_to_cart"));
        if (button) { button.textContent = "Added"; }
        notify(ids.length > 1 ? "Kit added to your cart." : "Added to your cart.");
      })
      .catch(function () {
        if (button) { button.disabled = false; button.textContent = "Add"; }
      });
  }

  // ---------- recommendation cards ----------
  function reason(r, about, city) {
    var b = r.because || [];
    if (!b.length) return "";
    if (b[0] === CO_PURCHASE) return "Often bought together here";
    if (city) return "People in " + city + " with your taste love " + b[0];
    return about ? about + " fans also love " + b[0] : "A pick for " + b[0].toLowerCase() + " fans";
  }
  function bar(score) {
    var w = el("div", "ac-bar");
    var f = el("span");
    f.style.width = Math.round(score * 100) + "%";
    w.appendChild(f);
    w.appendChild(el("em", null, Math.round(score * 100) + "% taste match"));
    return w;
  }
  function thumb(p) {
    var a = el("a", "ac-thumb");
    a.href = p.url || "#";
    if (p.image) {
      var img = el("img");
      img.src = p.image;
      img.alt = "";
      img.loading = "lazy";
      a.appendChild(img);
    } else {
      a.appendChild(el("span", null, p.brand || ""));
    }
    return a;
  }
  function card(r, src, about, city, why) {
    var p = r.product;
    var li = el("li", "ac-card");
    li.appendChild(thumb(p));
    var body = el("div", "ac-body");
    var name = el("a", "ac-name", p.name);
    name.href = p.url || "#";
    body.appendChild(name);
    body.appendChild(el("p", "ac-reason", why || reason(r, about, city)));
    if (r.score) body.appendChild(bar(r.score));
    li.appendChild(body);
    var buy = el("div", "ac-buy");
    buy.appendChild(el("span", "ac-price", money(p.price)));
    var add = el("button", "ac-add", "Add");
    add.type = "button";
    add.setAttribute("aria-label", "Add " + p.name + " to cart");
    add.addEventListener("click", function () { addToCart([p.id], src, add); });
    buy.appendChild(add);
    li.appendChild(buy);
    return li;
  }
  function block(root, title, lede, recs, src, about, city) {
    if (!recs || !recs.length) return null;
    var wrap = el("div", "ac-block");
    wrap.appendChild(el("h2", "ac-title", title));
    if (lede) wrap.appendChild(el("p", "ac-lede", lede));
    var ul = el("ul", "ac-list");
    recs.forEach(function (r) { ul.appendChild(card(r, src, about, city)); });
    wrap.appendChild(ul);
    root.appendChild(wrap);
    credit(root);
    return wrap;
  }
  function credit(root) {
    if (root.querySelector(".ac-credit")) return;
    root.appendChild(el("p", "ac-credit", "Taste matching by Affinity Cart, powered by Qloo"));
  }
  function waiting(root, text) {
    var w = el("p", "ac-wait", text);
    root.appendChild(w);
    return w;
  }

  // ---------- city (demo preview of CDN geolocation) ----------
  function cityPicker(current, source) {
    var wrap = el("div", "ac-city");
    var label = el("label", null, source === "cdn" ? "Your city: " : "Shopping from ");
    var sel = el("select");
    CITIES.forEach(function (c) {
      var o = el("option", null, c);
      if (c === current) o.selected = true;
      sel.appendChild(o);
    });
    if (current && CITIES.indexOf(current) < 0) {
      var o = el("option", null, current);
      o.selected = true;
      sel.insertBefore(o, sel.firstChild);
    }
    sel.addEventListener("change", function () {
      var u = new URL(location.href);
      u.searchParams.set("affinity_city", sel.value);
      location.href = u.toString();
    });
    label.appendChild(sel);
    wrap.appendChild(label);
    if (source !== "cdn") wrap.appendChild(el("small", null, "Demo: in production the city comes from your CDN."));
    return wrap;
  }

  // ---------- shop / home: picks row + badges ----------
  function markGrid(recs, city) {
    var byPath = {};
    recs.forEach(function (r) { byPath[path(r.product.url)] = r; });
    document.querySelectorAll("li.wc-block-product, li.product").forEach(function (li) {
      if (li.querySelector(".ac-badge")) return;
      var link = li.querySelector("a[href]");
      var r = link && byPath[path(link.href)];
      if (!r) return;
      li.classList.add("ac-picked");
      var badge = el("span", "ac-badge", "✦ Picked for you");
      badge.title = reason(r, null, city);
      var media = li.querySelector(".wc-block-components-product-image, .wc-block-components-product-image a, img");
      (media && media.parentElement ? media.parentElement : li).appendChild(badge);
      // The add-to-cart button on a picked card carries the source too.
      li.querySelectorAll("a.add_to_cart_button, button.add_to_cart_button, .wp-block-button__link").forEach(function (b) {
        b.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          addToCart([r.product.id], "live", null);
        }, true);
      });
    });
  }
  function shopPicks(root) {
    var w = waiting(root, "Finding picks for you…");
    live({ viewed: viewed }).then(function (res) {
      w.remove();
      var recs = (res.recs || []).slice(0, 4);
      if (!recs.length) return;
      var city = res.city;
      var head = el("div", "ac-shop-head");
      head.appendChild(el("h2", "ac-title", "Picked for you" + (city ? " in " + city : "")));
      head.appendChild(cityPicker(city, res.source));
      root.appendChild(head);
      root.appendChild(el("p", "ac-lede", viewed.length
        ? "Based on what you've looked at and what people in " + city + " love."
        : "You haven't looked at anything yet, so these are what people like you in " + city + " love. They change as you browse."));
      var ul = el("ul", "ac-list ac-list-row");
      recs.forEach(function (r) { ul.appendChild(card(r, "live", null, city)); });
      root.appendChild(ul);
      credit(root);
      markGrid(recs, city);
    }).catch(function () { w.remove(); });
  }

  // ---------- product page ----------
  function productPicks(root, pid) {
    var shown = {};
    shown[pid] = true;
    api("/recs/" + pid).then(function (res) {
      var recs = (res.recs || []).slice(0, 3);
      recs.forEach(function (r) { shown[r.productId] = true; });
      block(root, "Complete the vibe", "Not more of the same: what people who love this reach for next.", recs, "vibe", res.about);
      (res.kits || []).slice(0, 1).forEach(function (k) { kitBlock(root, k); });
      if (viewed.length > 1) {
        var w = waiting(root, "Updating picks for what you've looked at today…");
        live({ viewed: viewed }).then(function (live) {
          w.remove();
          var fresh = (live.recs || []).filter(function (r) { return !shown[r.productId]; }).slice(0, 3);
          block(root, "Picked for you" + (live.city ? " in " + live.city : ""), "Based on everything you've looked at today.", fresh, "live", null, live.city);
        }).catch(function () { w.remove(); });
      }
    });
  }
  function kitBlock(root, kit) {
    if (!kit.products || kit.products.length < 2) return;
    var wrap = el("div", "ac-block ac-kit");
    wrap.appendChild(el("h2", "ac-title", kit.name || "Better together"));
    if (kit.pitch) wrap.appendChild(el("p", "ac-lede", kit.pitch));
    var row = el("div", "ac-kit-row");
    kit.products.forEach(function (p) { row.appendChild(thumb(p)); });
    wrap.appendChild(row);
    var total = kit.products.reduce(function (s, p) { return s + p.price; }, 0);
    var buy = el("div", "ac-kit-buy");
    var price = el("span", "ac-price");
    if (kit.discount) {
      price.appendChild(el("s", null, money(total)));
      price.appendChild(document.createTextNode(" " + money(total * (1 - kit.discount))));
    } else {
      price.textContent = money(total);
    }
    buy.appendChild(price);
    var add = el("button", "ac-add ac-add-strong", "Add the kit");
    add.type = "button";
    add.addEventListener("click", function () { addToCart(kit.products.map(function (p) { return p.id; }), "kit", add); });
    buy.appendChild(add);
    wrap.appendChild(buy);
    root.appendChild(wrap);
  }

  // ---------- gift finder ----------
  var GIFT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22"><path fill="currentColor" d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Zm-6-2a1 1 0 1 1 0 2h-1V6a1 1 0 0 1 1-1ZM9 5a1 1 0 0 1 1 1v1H9a1 1 0 1 1 0-2ZM5 9h6v1H5V9Zm2 3h4v7H7v-7Zm10 7h-4v-7h4v7Zm2-9h-6V9h6v1Z"/></svg>';
  var EXAMPLES = ["Fleet Foxes", "Hayao Miyazaki", "Stranger Things", "Patti Smith"];

  function giftFinder() {
    var fab = el("button", "ac-gift-fab");
    fab.type = "button";
    fab.innerHTML = GIFT_ICON + "<span>Find a gift</span>";
    fab.setAttribute("aria-label", "Find a gift");
    document.body.appendChild(fab);

    var dlg = el("dialog", "ac-gift");
    dlg.setAttribute("aria-labelledby", "ac-gift-title");
    dlg.innerHTML =
      '<form method="dialog" class="ac-gift-close"><button aria-label="Close">×</button></form>' +
      '<h2 id="ac-gift-title">Find a gift</h2>' +
      "<p class=\"ac-lede\">Tell us what they love: bands, films, shows, books. We'll match their taste to what's on our shelves.</p>";
    var form = el("form", "ac-gift-form");
    var chips = el("div", "ac-chips");
    var input = el("input");
    input.placeholder = "e.g. Fleet Foxes, then Enter";
    input.setAttribute("aria-label", "Something they love");
    chips.appendChild(input);
    form.appendChild(chips);
    var ex = el("p", "ac-examples", "Try ");
    EXAMPLES.forEach(function (t, i) {
      var b = el("button", null, t);
      b.type = "button";
      b.addEventListener("click", function () { addChip(t); });
      ex.appendChild(b);
      if (i < EXAMPLES.length - 1) ex.appendChild(document.createTextNode(", "));
    });
    form.appendChild(ex);
    var row = el("div", "ac-gift-row");
    var budget = el("select");
    budget.setAttribute("aria-label", "Budget per gift");
    [["", "Any budget"], ["50", "Up to 50 €"], ["100", "Up to 100 €"], ["150", "Up to 150 €"]].forEach(function (o) {
      var opt = el("option", null, o[1]);
      opt.value = o[0];
      budget.appendChild(opt);
    });
    var go = el("button", "ac-add ac-add-strong", "Find a gift");
    go.type = "submit";
    row.appendChild(budget);
    row.appendChild(go);
    form.appendChild(row);
    dlg.appendChild(form);
    var out = el("div", "ac-gift-out");
    dlg.appendChild(out);
    dlg.appendChild(el("p", "ac-credit", "Gift finder by Affinity Cart, powered by Qloo and Claude. Only picks from this shop."));
    document.body.appendChild(dlg);

    var tastes = [];
    function addChip(t) {
      t = (t || "").trim();
      if (!t || tastes.indexOf(t) >= 0 || tastes.length >= 5) return;
      tastes.push(t);
      var c = el("button", "ac-chip", t + " ×");
      c.type = "button";
      c.addEventListener("click", function () { tastes.splice(tastes.indexOf(t), 1); c.remove(); });
      chips.insertBefore(c, input);
      input.value = "";
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addChip(input.value); }
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      addChip(input.value);
      if (!tastes.length) { input.focus(); return; }
      go.disabled = true;
      out.innerHTML = "";
      var steps = ["Looking up their taste in Qloo…", "Ranking our shelves for that taste…", "Choosing from what's in stock…"];
      var w = waiting(out, steps[0]);
      var i = 0;
      var t = setInterval(function () { if (i < steps.length - 1) w.textContent = steps[++i]; }, 5000);
      api("/gift", { tastes: tastes, budget: budget.value ? Number(budget.value) : null })
        .then(function (res) {
          out.innerHTML = "";
          out.appendChild(el("p", "ac-gift-summary", res.summary));
          var ul = el("ul", "ac-list");
          (res.picks || []).forEach(function (p) {
            if (p.product) ul.appendChild(card({ product: p.product }, "gift", null, null, p.why));
          });
          out.appendChild(ul);
          var how = el("details", "ac-trace");
          how.appendChild(el("summary", null, "How we picked these"));
          var ol = el("ol");
          (res.trace || []).forEach(function (s) { ol.appendChild(el("li", null, s.label)); });
          how.appendChild(ol);
          out.appendChild(how);
        })
        .catch(function (err) {
          out.innerHTML = "";
          out.appendChild(el("p", "ac-error", err.message));
        })
        .finally(function () { clearInterval(t); go.disabled = false; });
    });

    fab.addEventListener("click", function () {
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
      input.focus();
    });
  }

  // ---------- boot ----------
  document.querySelectorAll("section.affinity-cart").forEach(function (root) {
    var ctx = root.getAttribute("data-context");
    var pid = root.getAttribute("data-product");
    if (ctx === "product" && pid && pid !== "0") productPicks(root, pid);
    else if (ctx === "shop") shopPicks(root);
    else if (viewed.length) {
      live({ viewed: viewed }).then(function (res) {
        block(root, "Before you check out", "Picked for what you've looked at today.", (res.recs || []).slice(0, 3), "live", null, res.city);
      });
    }
  });
  if (cfg.giftFinder) giftFinder();
})();
