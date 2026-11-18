(function () {
  "use strict";

  var TRANSITION_KEY = "profolio:transition";
  var TRANSITION_MS = 520;
  var FLASH_MS = 40; // neon wavefront thickness, in ms
  var BLOCK_CSS_PX = 20;
  var SKILL_STAGGER_MS = 120;

  var isTransitioning = false;
  // Cancel functions for running transitions. Each run owns its own rAF id, so a
  // finishing reveal can never cancel an in-flight cover (that froze the page).
  var activeRuns = [];

  // --- Shared Helpers ---

  function readToken(name, fallback) {
    if (!document.documentElement) return fallback;
    var val = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }


  // The flag stores the wave origin as viewport fractions, so the next page's
  // reveal starts from the same spot the cover started from.
  function getTransitionFlag() {
    try {
      var raw = window.sessionStorage.getItem(TRANSITION_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      var ok = o && typeof o.fx === "number" && typeof o.fy === "number";
      return ok ? o : { fx: 0.5, fy: 0.5 };
    } catch (e) {
      return null;
    }
  }

  function setTransitionFlag(x, y) {
    try {
      var fx = Math.min(1, Math.max(0, x / window.innerWidth));
      var fy = Math.min(1, Math.max(0, y / window.innerHeight));
      window.sessionStorage.setItem(TRANSITION_KEY, JSON.stringify({ fx: fx, fy: fy }));
    } catch (e) { /* storage unavailable: skip reveal on next page */ }
  }

  function clearTransitionFlag() {
    try {
      window.sessionStorage.removeItem(TRANSITION_KEY);
    } catch (e) { /* ignore storage errors */ }
  }

  // --- Pixel Page Transitions ---

  function removeTransitionCanvases() {
    activeRuns.slice().forEach(function (cancel) { cancel(); });
    activeRuns = [];
    isTransitioning = false;

    var canvases = document.querySelectorAll("canvas.pixel-transition");
    for (var i = 0; i < canvases.length; i++) {
      if (canvases[i].parentNode) {
        canvases[i].parentNode.removeChild(canvases[i]);
      }
    }
  }

  function createTransitionCanvas(pointerEvents) {
    var parent = document.body || document.documentElement;
    if (!parent) return null;

    var canvas = document.createElement("canvas");
    canvas.className = "pixel-transition";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.zIndex = "1000";
    canvas.style.display = "block";
    canvas.style.pointerEvents = pointerEvents;

    var width = Math.max(1, window.innerWidth);
    var height = Math.max(1, window.innerHeight);
    var dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    var ctx = canvas.getContext ? canvas.getContext("2d") : null;
    if (!ctx) return null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;

    parent.appendChild(canvas);

    return {
      canvas: canvas,
      ctx: ctx,
      width: width,
      height: height,
      dpr: dpr
    };
  }

  /**
   * Animate a pixel wave either covering the viewport ("cover")
   * or dissolving a solid void overlay away ("reveal").
   */
  function runPixelTransition(mode, onDone, originX, originY) {
    var isReveal = mode === "reveal";
    var surface = createTransitionCanvas(isReveal ? "none" : "auto");
    if (!surface) {
      if (onDone) onDone(null);
      return;
    }

    var canvas = surface.canvas;
    var ctx = surface.ctx;
    var dpr = surface.dpr;
    var colorVoid = readToken("--c-void", "#020202");
    var colorNeon = readToken("--c-neon", "#16DB65");

    if (isReveal) {
      ctx.fillStyle = colorVoid;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    var cols = Math.max(1, Math.ceil(surface.width / BLOCK_CSS_PX));
    var rows = Math.max(1, Math.ceil(surface.height / BLOCK_CSS_PX));
    var total = cols * rows;
    // Wave expands from the given point (e.g. the clicked link), else screen center.
    var ox = typeof originX === "number" ? originX : surface.width / 2;
    var oy = typeof originY === "number" ? originY : surface.height / 2;
    var wave = window.PixelFX.waveOrder(cols, rows, BLOCK_CSS_PX, ox, oy);
    var order = wave.order;
    function timeAt(k) {
      return wave.times[k];
    }

    function drawBlock(blockIdx, fillColor) {
      var col = blockIdx % cols;
      var row = Math.floor(blockIdx / cols);
      var x0 = Math.round(col * BLOCK_CSS_PX * dpr);
      var y0 = Math.round(row * BLOCK_CSS_PX * dpr);
      var x1 = col === cols - 1 ? canvas.width : Math.round((col + 1) * BLOCK_CSS_PX * dpr);
      var y1 = row === rows - 1 ? canvas.height : Math.round((row + 1) * BLOCK_CSS_PX * dpr);

      if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      } else {
        ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    var flashSpan = Math.max(1, TRANSITION_MS - FLASH_MS);
    var flashCursor = 0;
    var settleCursor = 0;
    var startTime = 0;
    var finished = false;
    var rafId = 0;
    // Safety net: if frames stall (e.g. background tab), complete anyway instead of freezing.
    var watchdog = window.setTimeout(finish, TRANSITION_MS + FLASH_MS + 800);

    function cancel() {
      finished = true;
      window.clearTimeout(watchdog);
      window.removeEventListener("resize", handleResize);
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = 0;
      var at = activeRuns.indexOf(cancel);
      if (at !== -1) activeRuns.splice(at, 1);
    }
    activeRuns.push(cancel);

    function finish() {
      if (finished) return;
      cancel();
      if (onDone) onDone(canvas);
    }

    function handleResize() {
      finish();
    }

    if (isReveal) {
      window.addEventListener("resize", handleResize, { once: true });
    }

    function tick(now) {
      if (finished) return;
      if (!startTime) startTime = now;

      var elapsed = now - startTime;

      while (flashCursor < total) {
        var flashAt = timeAt(flashCursor) * flashSpan;
        if (elapsed < flashAt) break;

        if (elapsed < flashAt + FLASH_MS) {
          drawBlock(order[flashCursor], colorNeon);
        }
        flashCursor++;
      }

      while (settleCursor < total) {
        var settleAt = timeAt(settleCursor) * flashSpan + FLASH_MS;
        if (elapsed < settleAt) break;

        drawBlock(order[settleCursor], isReveal ? null : colorVoid);
        settleCursor++;
      }

      if (settleCursor >= total) {
        finish();
        return;
      }

      rafId = window.requestAnimationFrame(tick);
    }

    rafId = window.requestAnimationFrame(tick);
  }

  function initRevealTransition() {
    var origin = getTransitionFlag();
    clearTransitionFlag();

    if (!origin || prefersReducedMotion()) return;

    runPixelTransition("reveal", function (canvas) {
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    }, origin.fx * window.innerWidth, origin.fy * window.innerHeight);
  }

  function isTransitionableHtmlLink(link) {
    if (!link) return null;

    var rawHref = (link.getAttribute("href") || "").trim();
    if (!rawHref || rawHref.charAt(0) === "#") return null;

    var target = (link.getAttribute("target") || "").trim().toLowerCase();
    if (target && target !== "_self") return null;
    if (link.hasAttribute("download")) return null;

    var url;
    try {
      url = new URL(link.href, window.location.href);
    } catch (e) {
      return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "file:") {
      return null;
    }
    if (url.protocol !== "file:" && url.origin !== window.location.origin) {
      return null;
    }
    if (!/\.html$/i.test(url.pathname)) return null;

    return url.href;
  }

  function initLinkTransitions() {
    document.addEventListener("click", function (event) {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      var target = event.target;
      var link = target && typeof target.closest === "function" ? target.closest("a[href]") : null;
      var dest = isTransitionableHtmlLink(link);
      if (!dest) return;

      if (prefersReducedMotion()) return;

      event.preventDefault();
      if (isTransitioning) return;
      isTransitioning = true;

      // Keyboard-activated clicks report detail 0 and no pointer position: use the link's center.
      var originX, originY;
      if (event.detail > 0) {
        originX = event.clientX;
        originY = event.clientY;
      } else {
        var r = link.getBoundingClientRect();
        originX = r.left + r.width / 2;
        originY = r.top + r.height / 2;
      }

      runPixelTransition("cover", function () {
        setTransitionFlag(originX, originY);
        window.location.href = dest;
      }, originX, originY);
    });

    window.addEventListener("pageshow", function (event) {
      if (event && event.persisted) {
        removeTransitionCanvases();
      }
    });
  }

  // --- Main Menu Keyboard & Hover Navigation ---

  function initMainMenu() {
    var menuList = document.querySelector(".menu__list");
    if (!menuList) return;

    var items = menuList.querySelectorAll(".menu__item");
    if (!items.length) return;

    var selectedIndex = 0;

    function isBooting() {
      return Boolean(document.body && document.body.classList.contains("is-booting"));
    }

    function selectItem(index, shouldFocus) {
      selectedIndex = ((index % items.length) + items.length) % items.length;
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle("is-selected", i === selectedIndex);
      }
      if (shouldFocus && !isBooting()) {
        items[selectedIndex].focus({ preventScroll: true });
      }
    }

    // Default to the first menu item without stealing focus during boot.
    selectItem(0, false);

    menuList.addEventListener("mouseover", function (event) {
      var target = event.target;
      var item = target && typeof target.closest === "function" ? target.closest(".menu__item") : null;
      if (!item || !menuList.contains(item)) return;

      var idx = Array.prototype.indexOf.call(items, item);
      if (idx !== -1) {
        selectItem(idx, true);
      }
    });

    menuList.addEventListener("focusin", function (event) {
      var target = event.target;
      var item = target && typeof target.closest === "function" ? target.closest(".menu__item") : null;
      if (!item || !menuList.contains(item)) return;

      var idx = Array.prototype.indexOf.call(items, item);
      if (idx !== -1) {
        selectItem(idx, false);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (isBooting()) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      var key = event.key;
      if (key === "ArrowUp" || key === "w" || key === "W") {
        event.preventDefault();
        selectItem(selectedIndex - 1, true);
      } else if (key === "ArrowDown" || key === "s" || key === "S") {
        event.preventDefault();
        selectItem(selectedIndex + 1, true);
      } else if (key === "Enter") {
        // If focus sits on <main> (e.g. right after boot finishes), follow the selected item.
        var active = document.activeElement;
        var isInteractive = active && typeof active.closest === "function" &&
          active.closest("a, button, input, select, textarea");
        if (!isInteractive && items[selectedIndex]) {
          event.preventDefault();
          items[selectedIndex].click();
        }
      }
    });
  }

  // --- Skill Bar Scroll Reveal ---

  function initSkillBars() {
    var bars = document.querySelectorAll(".skills__bar");
    if (!bars.length) return;

    if (typeof window.IntersectionObserver !== "function") {
      for (var i = 0; i < bars.length; i++) {
        bars[i].classList.add("is-visible");
      }
      return;
    }

    var reduced = prefersReducedMotion();
    var observer = new window.IntersectionObserver(
      function (entries) {
        var batchIndex = 0;
        for (var j = 0; j < entries.length; j++) {
          var entry = entries[j];
          if (!entry.isIntersecting) continue;

          observer.unobserve(entry.target);

          var delay = reduced ? 0 : batchIndex * SKILL_STAGGER_MS;
          batchIndex++;

          if (delay === 0) {
            entry.target.classList.add("is-visible");
          } else {
            (function (el, ms) {
              window.setTimeout(function () {
                el.classList.add("is-visible");
              }, ms);
            })(entry.target, delay);
          }
        }
      },
      { threshold: 0.3 }
    );

    for (var k = 0; k < bars.length; k++) {
      observer.observe(bars[k]);
    }
  }

  // --- Inner Page Game-Style Keyboard Navigation ---

  function initInnerPageNav() {
    var body = document.body;
    if (!body || body.classList.contains("page-menu")) return;

    var INNER_PAGES = [
      { cls: "page-about", href: "about.html" },
      { cls: "page-projects", href: "projects.html" },
      { cls: "page-skills", href: "skills.html" },
      { cls: "page-contact", href: "contact.html" }
    ];

    var pageIndex = -1;
    for (var i = 0; i < INNER_PAGES.length; i++) {
      if (body.classList.contains(INNER_PAGES[i].cls)) {
        pageIndex = i;
        break;
      }
    }
    if (pageIndex === -1) return;

    var mainEl = document.querySelector("main");
    var INTERACTIVE_SELECTOR = "a[href], button, summary";
    var DEAD_SELECTOR = ".skills > li:not(.skills__group), .skills--detail > li, .stats > div";
    var SELECTABLE_SELECTOR = INTERACTIVE_SELECTOR + ", " + DEAD_SELECTOR;
    var SPAM_WINDOW_MS = 1500;
    var SPAM_THRESHOLD = 3;
    var POPUP_AUTO_MS = 2500;

    // 16x16 pixel angry face: # = void, N = neon, M = moss, L = leaf.
    var ANGRY_FACE_GRID = [
      "....########.L.L",
      "..##NNNNNNNN##L.",
      ".#NNNNNNNNNNNN#L",
      ".#N##NNNNNN##N#.",
      "#NNN##NNNN##NNN#",
      "#NNNN##NN##NNNN#",
      "#NNNNNNNNNNNNNN#",
      "#NNN##NNNN##NNN#",
      "#NNN##NNNN##NNN#",
      "#NNNNNNNNNNNNNN#",
      "#NNNN######NNNN#",
      "#NNN##NNNN##NNN#",
      ".#NN#NNNNNN#NN#.",
      ".#MNNNNNNNNNNM#.",
      "..##MMMMMMMM##..",
      "....########...."
    ];

    var PIXEL_FILLS = {
      "#": "var(--c-void)",
      "N": "var(--c-neon)",
      "M": "var(--c-moss)",
      "L": "var(--c-leaf)"
    };

    var selectedEl = null;
    var deadPressTimes = [];
    var popupEl = null;
    var popupTimer = 0;
    var isPopupOpen = false;

    if (mainEl) {
      var deadRows = mainEl.querySelectorAll(DEAD_SELECTOR);
      for (var d = 0; d < deadRows.length; d++) {
        deadRows[d].setAttribute("tabindex", "-1");
      }
    }

    function isDeadItem(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = el.tagName;
      if (tag === "A" && el.hasAttribute("href")) return false;
      if (tag === "BUTTON" || tag === "SUMMARY") return false;
      return typeof el.matches === "function" ? el.matches(DEAD_SELECTOR) : true;
    }

    function buildAngryFaceSvg() {
      var ns = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "angry-popup__face");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("width", "96");
      svg.setAttribute("height", "96");
      svg.setAttribute("shape-rendering", "crispEdges");
      svg.setAttribute("aria-hidden", "true");

      for (var y = 0; y < ANGRY_FACE_GRID.length; y++) {
        var row = ANGRY_FACE_GRID[y];
        for (var x = 0; x < row.length; x++) {
          var fill = PIXEL_FILLS[row.charAt(x)];
          if (!fill) continue;
          var rect = document.createElementNS(ns, "rect");
          rect.setAttribute("x", String(x));
          rect.setAttribute("y", String(y));
          rect.setAttribute("width", "1");
          rect.setAttribute("height", "1");
          rect.setAttribute("fill", fill);
          svg.appendChild(rect);
        }
      }
      return svg;
    }

    function onPopupKeydown(event) {
      if (!isPopupOpen) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      if (!event.repeat) {
        hideAngryPopup();
      }
    }

    function onPopupClick(event) {
      if (!isPopupOpen) return;
      event.preventDefault();
      event.stopPropagation();
      hideAngryPopup();
    }

    function hideAngryPopup() {
      if (popupTimer) {
        window.clearTimeout(popupTimer);
        popupTimer = 0;
      }
      window.removeEventListener("keydown", onPopupKeydown, true);
      window.removeEventListener("click", onPopupClick, true);
      if (!isPopupOpen) return;
      isPopupOpen = false;
      if (popupEl) {
        popupEl.classList.remove("is-open");
        popupEl.hidden = true;
      }
    }

    function getOrCreateAngryPopup() {
      if (popupEl) return popupEl;

      var box = document.createElement("div");
      box.className = "angry-popup";
      box.setAttribute("role", "alert");
      box.hidden = true;

      box.appendChild(buildAngryFaceSvg());

      var title = document.createElement("p");
      title.className = "angry-popup__title";
      title.textContent = "NOTHING THERE!";
      box.appendChild(title);

      var sub = document.createElement("p");
      sub.className = "angry-popup__sub";
      sub.textContent = "STOP PRESSING ME >:(";
      box.appendChild(sub);

      body.appendChild(box);
      popupEl = box;
      return popupEl;
    }

    function showAngryPopup() {
      if (isTransitioning) return;
      var box = getOrCreateAngryPopup();
      if (popupTimer) {
        window.clearTimeout(popupTimer);
      }
      box.classList.remove("is-open");
      box.hidden = false;
      // Force reflow so the pop-in animation replays on reuse.
      void box.offsetWidth;
      box.classList.add("is-open");
      isPopupOpen = true;
      window.addEventListener("keydown", onPopupKeydown, true);
      window.addEventListener("click", onPopupClick, true);
      popupTimer = window.setTimeout(hideAngryPopup, POPUP_AUTO_MS);
    }

    function activateDeadItem(el) {
      if (!el || isTransitioning) return;

      el.classList.remove("is-shaking");
      // Force reflow to restart keyframe if pressed again mid-animation.
      void el.offsetWidth;
      el.classList.add("is-shaking");

      var now = Date.now();
      var cutoff = now - SPAM_WINDOW_MS;
      while (deadPressTimes.length && deadPressTimes[0] < cutoff) {
        deadPressTimes.shift();
      }
      deadPressTimes.push(now);

      if (deadPressTimes.length >= SPAM_THRESHOLD) {
        deadPressTimes.length = 0;
        showAngryPopup();
      }
    }

    function isEditable(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.isContentEditable) return true;
      var tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return typeof el.closest === "function" &&
        Boolean(el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
    }

    function isInsideClosedDetails(el) {
      var cur = el;
      while (cur && cur !== body) {
        var parent = cur.parentElement;
        var details = parent && typeof parent.closest === "function" ? parent.closest("details") : null;
        if (!details) break;
        var isOwnSummary = cur.tagName === "SUMMARY" && parent === details;
        if (!details.open && !isOwnSummary) return true;
        cur = details;
      }
      return false;
    }

    function isVisibleSelectable(el) {
      if (!el || el.disabled) return false;
      if (isInsideClosedDetails(el)) return false;
      var style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return el.getClientRects().length > 0;
    }

    function computeSelectables() {
      if (!mainEl) return [];
      var nodes = mainEl.querySelectorAll(SELECTABLE_SELECTOR);
      var list = [];
      for (var j = 0; j < nodes.length; j++) {
        if (isVisibleSelectable(nodes[j])) {
          list.push(nodes[j]);
        }
      }
      return list;
    }

    var selectables = computeSelectables();

    function setSelected(el, shouldFocus) {
      if (selectedEl && selectedEl !== el) {
        selectedEl.classList.remove("is-kb-selected");
      }
      selectedEl = el || null;
      if (!selectedEl) return;

      selectedEl.classList.add("is-kb-selected");
      if (shouldFocus) {
        selectedEl.focus({ preventScroll: true });
        selectedEl.scrollIntoView({
          block: "nearest",
          behavior: prefersReducedMotion() ? "auto" : "smooth"
        });
      }
    }

    function moveSelection(delta) {
      selectables = computeSelectables();
      if (!selectables.length) return false;

      var idx = selectedEl ? selectables.indexOf(selectedEl) : -1;
      var nextIdx;
      if (idx === -1) {
        nextIdx = delta > 0 ? 0 : selectables.length - 1;
      } else {
        nextIdx = (idx + delta + selectables.length) % selectables.length;
      }

      setSelected(selectables[nextIdx], true);
      return true;
    }

    function findSelectableTarget(target) {
      if (!mainEl || !target || typeof target.closest !== "function") return null;
      var match = target.closest(SELECTABLE_SELECTOR);
      if (!match || !mainEl.contains(match)) return null;
      return isVisibleSelectable(match) ? match : null;
    }

    document.addEventListener("focusin", function (event) {
      var match = findSelectableTarget(event.target);
      if (match) {
        setSelected(match, false);
      } else if (selectedEl) {
        setSelected(null, false);
      }
    });

    if (mainEl) {
      mainEl.addEventListener("click", function (event) {
        var match = findSelectableTarget(event.target);
        if (match) {
          setSelected(match, false);
        }
      });

      // <details> toggle events do not bubble, so listen in the capture phase.
      mainEl.addEventListener("toggle", function (event) {
        var details = event.target;
        if (!details || details.tagName !== "DETAILS") return;

        if (!details.open && selectedEl && details.contains(selectedEl)) {
          var ownSummary = details.querySelector(":scope > summary");
          if (ownSummary && selectedEl !== ownSummary) {
            setSelected(ownSummary, false);
          }
        }
        selectables = computeSelectables();
      }, true);

      mainEl.addEventListener("animationend", function (event) {
        var target = event.target;
        if (
          target &&
          target.classList &&
          target.classList.contains("is-shaking") &&
          (event.animationName === "dead-row-shake" || event.animationName === "dead-row-flash")
        ) {
          target.classList.remove("is-shaking");
        }
      });
    }

    window.addEventListener("pageshow", function (event) {
      if (event && event.persisted) {
        hideAngryPopup();
      }
    });

    function clickNavPage(offset) {
      var targetPage = INNER_PAGES[(pageIndex + offset + INNER_PAGES.length) % INNER_PAGES.length];
      var link = document.querySelector('.nav__links a[href="' + targetPage.href + '"]');
      if (link) {
        link.click();
        return true;
      }
      return false;
    }

    document.addEventListener("keydown", function (event) {
      if (isTransitioning || isPopupOpen) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.target) || isEditable(document.activeElement)) return;

      var key = event.key;

      if (key === "ArrowLeft" || key === "a" || key === "A") {
        if (event.repeat) return;
        if (clickNavPage(-1)) {
          event.preventDefault();
        }
        return;
      }

      if (key === "ArrowRight" || key === "d" || key === "D") {
        if (event.repeat) return;
        if (clickNavPage(1)) {
          event.preventDefault();
        }
        return;
      }

      if (key === "ArrowUp" || key === "w" || key === "W") {
        if (moveSelection(-1)) {
          event.preventDefault();
        }
        return;
      }

      if (key === "ArrowDown" || key === "s" || key === "S") {
        if (moveSelection(1)) {
          event.preventDefault();
        }
        return;
      }

      if (key === "Enter" || key === " " || key === "Spacebar") {
        var active = document.activeElement;
        var focusedInteractive =
          active &&
          active !== selectedEl &&
          typeof active.matches === "function" &&
          active.matches(INTERACTIVE_SELECTOR);

        if (!focusedInteractive && selectedEl && isDeadItem(selectedEl) && isVisibleSelectable(selectedEl)) {
          event.preventDefault();
          if (!event.repeat) {
            activateDeadItem(selectedEl);
          }
          return;
        }

        if ((key === " " || key === "Spacebar") && !event.repeat) {
          if (active && active.tagName === "A" && active.hasAttribute("href")) {
            event.preventDefault();
            active.click();
          }
          return;
        }
      }

      if ((key === "Escape" || key === "Backspace") && !event.repeat) {
        var backLink = document.querySelector(".nav__back");
        if (backLink) {
          event.preventDefault();
          backLink.click();
        }
      }
    });
  }

  // Run reveal immediately at script execution to minimize flash on page load.
  initRevealTransition();
  initLinkTransitions();
  initMainMenu();
  initInnerPageNav();
  initSkillBars();
})();
