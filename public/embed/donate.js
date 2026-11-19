/*!
 * Passport giving widget. Paste on your organization's site where the giving form should appear:
 *
 *   <script src="https://YOUR-PASSPORT-HOST/embed/donate.js" data-sgo="your-organization-slug" async></script>
 *
 * Optional attributes:
 *   data-target="element-id"   mount inside that element instead of right after the script tag
 *   data-min-height="640"      height in CSS pixels before the form reports its own (default 640)
 *   data-title="Give to ..."   accessible title of the frame (default "Giving form")
 *
 * The script adds one full-width iframe pointing at /embed/give/{slug} on the host it was loaded from. The page in
 * the frame posts its content height ({ source: "ecca-embed", type: "resize", height }) and the frame is resized to
 * it. A message is only accepted when it comes from that host (event.origin) and from this very frame
 * (event.source), so other scripts on the page or other frames cannot resize it. No cookies, no dependencies.
 */
(function () {
  "use strict";

  var SLUG = /^[a-z0-9-]{1,100}$/;
  var ID = /^[A-Za-z][A-Za-z0-9_:.-]{0,99}$/;
  var MIN_HEIGHT = 200;
  var MAX_HEIGHT = 20000;
  var DEFAULT_HEIGHT = 640;

  function toHeight(value, fallback) {
    var n = typeof value === "number" ? value : parseInt(String(value || ""), 10);
    if (!isFinite(n)) return fallback;
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(n)));
  }

  function originOf(src) {
    var match = /^(https?:\/\/[^\/?#]+)/i.exec(src || "");
    return match ? match[1].toLowerCase() : null;
  }

  function mount(script) {
    if (!script || script.getAttribute("data-ecca-mounted") === "true") return null;
    script.setAttribute("data-ecca-mounted", "true");
    var doc = script.ownerDocument;
    var win = doc.defaultView;
    var slug = String(script.getAttribute("data-sgo") || "").trim().toLowerCase();
    var origin = originOf(script.src);
    if (!SLUG.test(slug) || !origin) {
      if (win && win.console) win.console.error("[Passport] donate.js needs data-sgo=\"organization-slug\" and an absolute src.");
      return null;
    }

    var frame = doc.createElement("iframe");
    frame.src = origin + "/embed/give/" + encodeURIComponent(slug);
    frame.title = script.getAttribute("data-title") || "Giving form";
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("allow", "payment");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.setAttribute("data-ecca-widget", slug);
    frame.style.display = "block";
    frame.style.width = "100%";
    frame.style.maxWidth = "100%";
    frame.style.border = "0";
    frame.style.overflow = "hidden";
    frame.style.colorScheme = "light";
    frame.style.height = toHeight(script.getAttribute("data-min-height"), DEFAULT_HEIGHT) + "px";

    var targetId = script.getAttribute("data-target");
    var target = targetId && ID.test(targetId) ? doc.getElementById(targetId) : null;
    if (target) target.appendChild(frame);
    else script.parentNode.insertBefore(frame, script.nextSibling);

    win.addEventListener("message", function (event) {
      if (event.origin !== origin || event.source !== frame.contentWindow) return;
      var data = event.data;
      if (!data || data.source !== "ecca-embed" || data.type !== "resize" || typeof data.height !== "number") return;
      frame.style.height = toHeight(data.height, DEFAULT_HEIGHT) + "px";
    });
    return frame;
  }

  var current = document.currentScript;
  if (current) {
    mount(current);
  } else {
    // Loaded in a way that hides currentScript: mount every widget script on the page not mounted yet.
    var scripts = document.querySelectorAll('script[data-sgo][src*="/embed/donate.js"]');
    for (var i = 0; i < scripts.length; i++) mount(scripts[i]);
  }
})();
