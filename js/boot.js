(function () {
  "use strict";

  var LOADING_MS = 600;
  var FADE_MS = 1400;
  var SPARKLE_MS = 80; // neon wavefront thickness, in ms
  var BLOCK_CSS_PX = 20;

  var bootEl = document.getElementById("boot");
  var startBtn = document.getElementById("boot-start");
  var canvas = document.getElementById("pixel-fade");

  var SESSION_KEY = "profolio:booted";

  function hasBooted() {
    try { return window.sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) { return false; }
  }

  function markBooted() {
    try { window.sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) { /* storage blocked: boot again next time */ }
  }

  // Skip the start screen when it was already played this session (e.g. returning to the menu).
  if (!bootEl || !canvas || hasBooted()) {
    if (bootEl) bootEl.style.display = "none";
    if (canvas) canvas.remove();
    document.body.classList.remove("is-booting");
    return;
  }

  var started = false;
  var finished = false;
  var loadTimer = 0;
  var rafId = 0;

  function readToken(name, fallback) {
    var val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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

  function finish() {
    if (finished) return;
    finished = true;

    if (loadTimer) {
      window.clearTimeout(loadTimer);
      loadTimer = 0;
    }
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    window.removeEventListener("resize", handleResize);
    document.removeEventListener("keydown", handleKeydown);

    if (bootEl.parentNode) {
      bootEl.style.display = "none";
    }
    if (canvas.parentNode) {
      canvas.remove();
    }

    document.body.classList.remove("is-booting");
    markBooted();

    var mainEl = document.getElementById("portfolio") || document.querySelector("main");
    if (mainEl) {
      if (!mainEl.hasAttribute("tabindex")) {
        mainEl.setAttribute("tabindex", "-1");
      }
      mainEl.focus({ preventScroll: true });
    }
  }

  function handleResize() {
    // Finish cleanly instead of rebuilding the block grid mid-dissolve.
    finish();
  }

  function startPixelFade() {
    if (finished) return;

    var ctx = canvas.getContext("2d");
    if (!ctx) {
      finish();
      return;
    }

    var width = window.innerWidth;
    var height = window.innerHeight;
    var dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;

    var colorVoid = readToken("--c-void", "#020202");
    var colorNeon = readToken("--c-neon", "#16DB65");

    // Paint solid void before hiding #boot so the portfolio stays covered.
    ctx.fillStyle = colorVoid;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    canvas.classList.add("is-active");
    bootEl.style.display = "none";

    var cols = Math.max(1, Math.ceil(width / BLOCK_CSS_PX));
    var rows = Math.max(1, Math.ceil(height / BLOCK_CSS_PX));
    var total = cols * rows;

    // Wave origin: the START button, else screen center.
    var originX = width / 2;
    var originY = height / 2;
    var btnRect = startBtn ? startBtn.getBoundingClientRect() : null;
    if (btnRect && btnRect.width) {
      originX = btnRect.left + btnRect.width / 2;
      originY = btnRect.top + btnRect.height / 2;
    }
    var wave = window.PixelFX
      ? window.PixelFX.waveOrder(cols, rows, BLOCK_CSS_PX, originX, originY)
      : null;
    var order = wave ? wave.order : shuffle(Array.from({ length: total }, function (_, k) { return k; }));
    function timeAt(k) {
      return wave ? wave.times[k] : k / total;
    }

    // Precompute exact device-pixel block bounds to avoid subpixel seams.
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

    var flashSpan = Math.max(1, FADE_MS - SPARKLE_MS);
    var flashCursor = 0;
    var clearCursor = 0;
    var startTime = 0;

    function tick(now) {
      if (finished) return;
      if (!startTime) startTime = now;

      var elapsed = now - startTime;

      while (flashCursor < total) {
        var flashAt = timeAt(flashCursor) * flashSpan;
        if (elapsed < flashAt) break;

        var clearAtForFlash = flashAt + SPARKLE_MS;
        if (elapsed < clearAtForFlash) {
          drawBlock(order[flashCursor], colorNeon);
        }
        flashCursor++;
      }

      while (clearCursor < total) {
        var clearAt = timeAt(clearCursor) * flashSpan + SPARKLE_MS;
        if (elapsed < clearAt) break;

        drawBlock(order[clearCursor], null);
        clearCursor++;
      }

      if (clearCursor >= total) {
        finish();
        return;
      }

      rafId = window.requestAnimationFrame(tick);
    }

    rafId = window.requestAnimationFrame(tick);
  }

  function showLoadingState() {
    bootEl.classList.add("is-loading");
    if (startBtn) {
      startBtn.textContent = "LOADING...";
      startBtn.disabled = true;
    }

    var inner = bootEl.querySelector(".boot__inner");
    if (inner && !inner.querySelector(".boot__progress")) {
      var bar = document.createElement("div");
      bar.className = "boot__progress";
      bar.setAttribute("aria-hidden", "true");

      var fill = document.createElement("div");
      fill.className = "boot__progress-fill";
      bar.appendChild(fill);

      if (startBtn && startBtn.parentNode === inner) {
        inner.insertBefore(bar, startBtn.nextSibling);
      } else {
        inner.appendChild(bar);
      }
    }
  }

  function triggerStart() {
    if (started || finished) return;
    started = true;

    document.removeEventListener("keydown", handleKeydown);

    if (prefersReducedMotion()) {
      finish();
      return;
    }

    window.addEventListener("resize", handleResize, { once: true });
    showLoadingState();

    loadTimer = window.setTimeout(function () {
      loadTimer = 0;
      startPixelFade();
    }, LOADING_MS);
  }

  function handleKeydown(event) {
    if (started || finished) return;
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      triggerStart();
    }
  }

  bootEl.addEventListener("click", triggerStart);
  if (startBtn) {
    startBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      triggerStart();
    });
  }
  document.addEventListener("keydown", handleKeydown);
})();
