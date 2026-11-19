/*!
 * Passport "Pay with a scholarship" button for a booking checkout (camps, schools, tutoring and similar vendors).
 *
 * Paste it where the button should appear on your checkout page:
 *
 *   <script src="https://YOUR-PASSPORT-HOST/embed/handoff.js"
 *     data-publishable-key="pk_test_..."
 *     data-booking-ref="BK-2027-0042"
 *     data-booking-description="Day camp, week 1"
 *     data-booking-amount-cents="45000"
 *     data-return-url="https://camp.example.org/booking/BK-2027-0042"
 *     data-mode="button"
 *     async></script>
 *
 * Attributes
 *   data-publishable-key       required  Your publishable key (pk_test_… / pk_live_…). Public by design: this page's
 *                                        origin must be on your allowed-origins list in the business portal.
 *                                        Alias: data-key.
 *   data-booking-ref           required  Your booking or order id (at most 100 characters).
 *   data-booking-description   optional  What is being booked, shown to the family (at most 300 characters).
 *                                        Alias: data-description.
 *   data-booking-amount-cents  optional  Booking total in whole cents ("45000"). Alias: data-amount, in dollars
 *                                        ("450" or "450.00"). An amount sent from the browser is recorded as
 *                                        unconfirmed; confirm it server-side when you complete the handoff.
 *   data-return-url            optional  Where the family goes back to. Must be on one of your allowed origins.
 *                                        "?handoff_id=…&status=…" is appended (a hint, never proof).
 *   data-mode                  optional  "button" (default): the family is sent to the hosted handoff page.
 *                                        "inline": the handoff page opens in a frame on this page and sizes itself.
 *   data-locale                optional  "en" (default) or "es".
 *   data-target                optional  Id of the element to render into. Default: right after this script tag.
 *   data-min-height            optional  Inline mode: frame height in CSS pixels before it reports its own (default 560).
 *
 * Events (dispatched on the script element; they bubble to document). Each also fires as "passport:handoff" with
 * `event.detail.type` set to the name in brackets, which is the form documented on /docs/handoffs:
 *   passport:handoff:created  [handoff.created]  { handoff_id, status, hold_expires_at }  store handoff_id with the booking
 *   passport:handoff:status   [handoff.status]   { handoff_id, status, hold_expires_at }  inline mode, a display hint only
 *   passport:handoff:closed   [handoff.closed]   { handoff_id, status }                   inline mode, the family left
 *   passport:handoff:error    [handoff.error]    { code, message }                        the handoff could not start
 * Confirm the real status on your server: webhooks (handoff.held, handoff.eligible, …) or GET /api/v1/handoffs/{id}.
 *
 * Security: the handoff is created by POST to this script's own host with your publishable key; that host checks the
 * page's Origin against your allowed origins. Messages from the inline frame are accepted only when they come from
 * that host (event.origin) and from that very frame (event.source). The frame is told this page's origin and posts
 * to it alone. No cookies, no dependencies, no data stored in the browser.
 */
(function () {
  "use strict";

  var SCRIPT_PATH = "/embed/handoff.js";
  var CREATE_PATH = "/embed/handoff/create";
  var ID = /^[A-Za-z][A-Za-z0-9_:.-]{0,99}$/;
  var KEY = /^pk_(test|live)_[A-Za-z0-9_-]{32}$/;
  var CENTS = /^[0-9]{1,9}$/;
  var DOLLARS = /^\$?([0-9]{1,7})(\.([0-9]{1,2}))?$/;
  var MIN_HEIGHT = 200;
  var MAX_HEIGHT = 20000;
  var DEFAULT_HEIGHT = 560;
  var SOURCE = "ecca-embed";

  var TEXT = {
    en: {
      button: "Pay with a scholarship",
      starting: "Starting…",
      hint: "Check if your family qualifies for a scholarship. Free for families.",
      failed: "We couldn't start the scholarship check. Please try again.",
      frameTitle: "Scholarship check",
    },
    es: {
      button: "Pagar con una beca",
      starting: "Iniciando…",
      hint: "Verifique si su familia califica para una beca. Gratis para las familias.",
      failed: "No pudimos iniciar la verificación de beca. Inténtelo de nuevo.",
      frameTitle: "Verificación de beca",
    },
  };

  function originOf(src) {
    var match = /^(https?:\/\/[^\/?#]+)/i.exec(src || "");
    return match ? match[1].toLowerCase() : null;
  }

  function attr(el, name, alias) {
    var v = el.getAttribute(name);
    if ((v === null || v === "") && alias) v = el.getAttribute(alias);
    return v === null ? "" : String(v).trim();
  }

  function toHeight(value, fallback) {
    var n = typeof value === "number" ? value : parseInt(String(value || ""), 10);
    if (!isFinite(n)) return fallback;
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(n)));
  }

  /** Amount in cents from data-booking-amount-cents, else data-amount in dollars. undefined = none, null = invalid. */
  function amountCents(el) {
    var cents = attr(el, "data-booking-amount-cents");
    if (cents !== "") return CENTS.test(cents) && Number(cents) > 0 ? Number(cents) : null;
    var dollars = attr(el, "data-amount").replace(/,/g, "");
    if (dollars === "") return undefined;
    var m = DOLLARS.exec(dollars);
    if (!m) return null;
    var frac = ((m[3] || "") + "00").slice(0, 2);
    var total = Number(m[1]) * 100 + Number(frac);
    return total > 0 ? total : null;
  }

  function emit(target, name, detail) {
    var doc = target.ownerDocument;
    var win = doc && doc.defaultView;
    function make(type, data) {
      if (win && typeof win.CustomEvent === "function") return new win.CustomEvent(type, { detail: data, bubbles: true, composed: true });
      var ev = doc.createEvent("CustomEvent");
      ev.initCustomEvent(type, true, false, data);
      return ev;
    }
    var detailed = {};
    for (var k in detail) if (Object.prototype.hasOwnProperty.call(detail, k)) detailed[k] = detail[k];
    detailed.type = "handoff." + name;
    target.dispatchEvent(make("passport:handoff:" + name, detail));
    target.dispatchEvent(make("passport:handoff", detailed));
  }

  function style(el, css) {
    for (var k in css) if (Object.prototype.hasOwnProperty.call(css, k)) el.style[k] = css[k];
  }

  function mount(script) {
    if (!script || script.getAttribute("data-passport-mounted") === "true") return null;
    script.setAttribute("data-passport-mounted", "true");
    var doc = script.ownerDocument;
    var win = doc.defaultView;
    var log = function (msg) {
      if (win && win.console) win.console.error("[Passport] handoff.js: " + msg);
    };

    var appOrigin = originOf(script.src);
    var key = attr(script, "data-publishable-key", "data-key");
    var bookingRef = attr(script, "data-booking-ref");
    var description = attr(script, "data-booking-description", "data-description");
    var amount = amountCents(script);
    var returnUrl = attr(script, "data-return-url");
    var mode = attr(script, "data-mode") === "inline" ? "inline" : "button";
    var locale = attr(script, "data-locale") === "es" ? "es" : "en";
    var t = TEXT[locale];

    var problem = !appOrigin
      ? "load the script from an absolute URL on your Passport host."
      : !KEY.test(key)
        ? 'data-publishable-key must be your publishable key ("pk_test_…" or "pk_live_…").'
        : bookingRef === ""
          ? "data-booking-ref is required."
          : amount === null
            ? "the booking amount must be whole cents (data-booking-amount-cents) or dollars (data-amount)."
            : null;
    if (problem) {
      log(problem);
      return null;
    }

    var container = doc.createElement("div");
    container.setAttribute("data-passport-handoff", bookingRef);
    container.setAttribute("lang", locale);
    style(container, { display: "block", maxWidth: "100%", fontFamily: "inherit" });

    var button = doc.createElement("button");
    button.type = "button";
    button.textContent = t.button;
    style(button, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "44px",
      padding: "0 20px",
      border: "0",
      borderRadius: "8px",
      background: "#1f4d3a",
      color: "#ffffff",
      font: "inherit",
      fontWeight: "600",
      cursor: "pointer",
    });

    var hint = doc.createElement("p");
    hint.textContent = t.hint;
    style(hint, { margin: "8px 0 0", fontSize: "14px", lineHeight: "1.4", color: "#4b5563" });

    var error = doc.createElement("p");
    error.setAttribute("role", "alert");
    style(error, { margin: "8px 0 0", fontSize: "14px", color: "#b42318", display: "none" });

    container.appendChild(button);
    container.appendChild(hint);
    container.appendChild(error);

    function place() {
      var targetId = attr(script, "data-target");
      var target = targetId && ID.test(targetId) ? doc.getElementById(targetId) : null;
      if (target) target.appendChild(container);
      else if (targetId && doc.readyState === "loading") return false;
      else if (script.parentNode && script.parentNode.nodeName !== "HEAD") script.parentNode.insertBefore(container, script.nextSibling);
      else if (doc.body) doc.body.appendChild(container);
      else return false;
      return true;
    }
    if (!place()) {
      if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", place);
      else log("could not find a place to render the button.");
    }

    var busy = false;
    var created = null;

    function fail(code, message) {
      busy = false;
      button.disabled = false;
      button.textContent = t.button;
      button.removeAttribute("aria-busy");
      error.textContent = t.failed;
      error.style.display = "block";
      emit(script, "error", { code: code, message: message });
    }

    function openInline(session) {
      var frame = doc.createElement("iframe");
      var src = session.embed_url + (session.embed_url.indexOf("?") === -1 ? "?" : "&") + "parent_origin=" + encodeURIComponent(win.location.origin) + (locale === "es" ? "&lang=es" : "");
      frame.src = src;
      frame.title = t.frameTitle;
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      frame.setAttribute("data-passport-frame", session.handoff_id);
      style(frame, { display: "block", width: "100%", maxWidth: "100%", border: "0", overflow: "hidden", colorScheme: "light" });
      frame.style.height = toHeight(script.getAttribute("data-min-height"), DEFAULT_HEIGHT) + "px";
      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(frame);
      win.addEventListener("message", function (event) {
        if (event.origin !== appOrigin || event.source !== frame.contentWindow) return;
        var data = event.data;
        if (!data || typeof data !== "object" || data.source !== SOURCE) return;
        if (data.type === "resize" && typeof data.height === "number") {
          frame.style.height = toHeight(data.height, DEFAULT_HEIGHT) + "px";
        } else if (data.type === "handoff.status" && data.handoff_id === session.handoff_id && typeof data.status === "string") {
          emit(script, "status", { handoff_id: data.handoff_id, status: data.status, hold_expires_at: typeof data.hold_expires_at === "string" ? data.hold_expires_at : null });
        } else if (data.type === "handoff.closed" && data.handoff_id === session.handoff_id) {
          emit(script, "closed", { handoff_id: data.handoff_id, status: typeof data.status === "string" ? data.status : null });
        }
      });
    }

    function open(session) {
      if (mode === "inline") openInline(session);
      else win.location.assign(session.url);
    }

    button.addEventListener("click", function () {
      if (busy) return;
      // A second click after success re-opens the same handoff instead of creating another one.
      if (created) {
        open(created);
        return;
      }
      busy = true;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = t.starting;
      error.style.display = "none";
      var body = { publishable_key: key, booking_ref: bookingRef, channel: mode === "inline" ? "embed" : "redirect", locale: locale };
      if (description !== "") body.booking_description = description;
      if (typeof amount === "number") body.booking_amount_cents = amount;
      if (returnUrl !== "") body.return_url = returnUrl;
      if (typeof win.fetch !== "function") {
        fail("unsupported", "This browser cannot start a scholarship check.");
        return;
      }
      win
        .fetch(appOrigin + CREATE_PATH, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify(body),
        })
        .then(function (res) {
          return res.json().then(
            function (json) {
              return { ok: res.ok, json: json };
            },
            function () {
              return { ok: false, json: null };
            },
          );
        })
        .then(
          function (r) {
            var j = r.json;
            if (!r.ok || !j || typeof j.handoff_id !== "string" || typeof j.url !== "string" || typeof j.embed_url !== "string") {
              var err = j && j.error ? j.error : { code: "internal", message: "Unexpected response" };
              return fail(String(err.code || "internal"), String(err.message || "Unexpected response"));
            }
            // Only same-host URLs are ever opened, whatever the response says.
            if (originOf(j.url) !== appOrigin || originOf(j.embed_url) !== appOrigin) return fail("internal", "Unexpected response");
            created = j;
            busy = false;
            button.disabled = false;
            button.removeAttribute("aria-busy");
            button.textContent = t.button;
            emit(script, "created", { handoff_id: j.handoff_id, status: j.status, hold_expires_at: j.hold_expires_at || null });
            open(j);
          },
          function () {
            fail("network", "The scholarship service could not be reached.");
          },
        );
    });

    return container;
  }

  var current = document.currentScript;
  if (current) {
    mount(current);
  } else {
    // Loaded in a way that hides currentScript: mount every handoff script on the page not mounted yet.
    var scripts = document.querySelectorAll('script[src*="' + SCRIPT_PATH + '"]');
    for (var i = 0; i < scripts.length; i++) mount(scripts[i]);
  }
})();
