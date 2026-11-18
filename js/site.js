(function () {
  "use strict";

  var TRANSITION_KEY = "profolio:transition";
  var TRANSITION_MS = 450;
  var FLASH_MS = 45;
  var BLOCK_CSS_PX = 28;
  var SKILL_STAGGER_MS = 120;

  var isTransitioning = false;
  var activeRafId = 0;

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

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function getTransitionFlag() {
    try {
      return window.sessionStorage.getItem(TRANSITION_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setTransitionFlag() {
    try {
      window.sessionStorage.setItem(TRANSITION_KEY, "1");
    } catch (e) { /* storage unavailable: skip reveal on next page */ }
  }

  function clearTransitionFlag() {
    try {
      window.sessionStorage.removeItem(TRANSITION_KEY);
    } catch (e) { /* ignore storage errors */ }
  }

  // --- Pixel Page Transitions ---

  function removeTransitionCanvases() {
    if (activeRafId) {
      window.cancelAnimationFrame(activeRafId);
      activeRafId = 0;
    }
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
   * Animate a shuffled block grid either covering the viewport ("cover")
   * or dissolving a solid void overlay away ("reveal").
   */
  function runPixelTransition(mode, onDone) {
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
    var colorLeaf = readToken("--c-leaf", "#058C42");

    if (isReveal) {
      ctx.fillStyle = colorVoid;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    var cols = Math.max(1, Math.ceil(surface.width / BLOCK_CSS_PX));
    var rows = Math.max(1, Math.ceil(surface.height / BLOCK_CSS_PX));
    var total = cols * rows;
    var order = new Array(total);
    for (var i = 0; i < total; i++) {
      order[i] = i;
    }
    shuffle(order);

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

    function finish() {
      if (finished) return;
      finished = true;
      window.removeEventListener("resize", handleResize);
      if (activeRafId) {
        window.cancelAnimationFrame(activeRafId);
        activeRafId = 0;
      }
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
        var flashAt = (flashCursor / total) * flashSpan;
        if (elapsed < flashAt) break;

        if (elapsed < flashAt + FLASH_MS) {
          drawBlock(order[flashCursor], flashCursor % 3 === 0 ? colorNeon : colorLeaf);
        }
        flashCursor++;
      }

      while (settleCursor < total) {
        var settleAt = (settleCursor / total) * flashSpan + FLASH_MS;
        if (elapsed < settleAt) break;

        drawBlock(order[settleCursor], isReveal ? null : colorVoid);
        settleCursor++;
      }

      if (settleCursor >= total) {
        finish();
        return;
      }

      activeRafId = window.requestAnimationFrame(tick);
    }

    activeRafId = window.requestAnimationFrame(tick);
  }

  function initRevealTransition() {
    var shouldReveal = getTransitionFlag();
    clearTransitionFlag();

    if (!shouldReveal || prefersReducedMotion()) return;

    runPixelTransition("reveal", function (canvas) {
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    });
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

      runPixelTransition("cover", function () {
        setTransitionFlag();
        window.location.href = dest;
      });
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

  // Run reveal immediately at script execution to minimize flash on page load.
  initRevealTransition();
  initLinkTransitions();
  initMainMenu();
  initSkillBars();
})();
