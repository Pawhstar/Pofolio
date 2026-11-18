/* Shared pixel-wave ordering for the boot dissolve (boot.js) and page transitions (site.js). */
(function () {
  "use strict";

  // 4x4 Bayer matrix: classic ordered-dither thresholds that give the wave edge a retro, stepped texture.
  var BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var DITHER_WEIGHT = 0.14; // how ragged the wavefront is (0 = perfect circle)

  /**
   * Order grid blocks as a wave expanding from (originX, originY) in CSS px.
   * Returns { order: blockIndex[], times: number[] } where times[i] in [0, 1]
   * is when order[i] should change, sorted ascending.
   */
  function waveOrder(cols, rows, blockPx, originX, originY) {
    var total = cols * rows;
    var ox = originX / blockPx;
    var oy = originY / blockPx;
    // Farthest corner from the origin, so the wave always reaches every block.
    var maxDist = Math.max(
      Math.hypot(ox, oy), Math.hypot(cols - ox, oy),
      Math.hypot(ox, rows - oy), Math.hypot(cols - ox, rows - oy)
    ) || 1;

    var scores = new Array(total);
    var order = new Array(total);
    for (var i = 0; i < total; i++) {
      var col = i % cols;
      var row = (i / cols) | 0;
      var d = Math.hypot(col + 0.5 - ox, row + 0.5 - oy) / maxDist;
      var dither = BAYER4[(row % 4) * 4 + (col % 4)] / 16;
      scores[i] = d * (1 - DITHER_WEIGHT) + dither * DITHER_WEIGHT;
      order[i] = i;
    }
    order.sort(function (a, b) { return scores[a] - scores[b]; });

    var times = new Array(total);
    for (var j = 0; j < total; j++) times[j] = scores[order[j]];
    return { order: order, times: times };
  }

  // Times are kept linear on purpose: easing makes the wave crawl at the edges,
  // which thickens the neon wavefront into a solid band.
  window.PixelFX = { waveOrder: waveOrder };
})();
