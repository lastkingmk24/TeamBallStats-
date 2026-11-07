/* =========================================================================
 * shotchart.js — canvas charts drawn with plain 2D context calls.
 *
 *   drawShots(canvas, shots, opts)   half-court shot chart (makes / misses)
 *   drawFlow(canvas, flow, opts)     game-flow line chart (cumulative score)
 *   drawSparkline(canvas, series)    tiny form line for cards and profiles
 *
 * Colours come from the CSS custom properties of the active theme, so the
 * charts follow dark/light mode without any external asset. No images, no
 * fonts, no network: everything is vectors and system fonts.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const FALLBACK = {
    line: '#c9d1da',
    court: '#f4f6f8',
    ink: '#101722',
    muted: '#667181',
    accent: '#c8102e',
    blue: '#1d4ed8',
    green: '#0f7a4d'
  };

  function colors() {
    let css = null;
    try { css = getComputedStyle(document.documentElement); } catch (_) { css = null; }
    const read = (name, fallback) => {
      if (!css) return fallback;
      const value = css.getPropertyValue(name);
      return value && value.trim() ? value.trim() : fallback;
    };
    return {
      line: read('--chart-line', FALLBACK.line),
      court: read('--chart-court', FALLBACK.court),
      ink: read('--text', FALLBACK.ink),
      muted: read('--muted', FALLBACK.muted),
      accent: read('--accent', FALLBACK.accent),
      blue: read('--blue', FALLBACK.blue),
      green: read('--green', FALLBACK.green),
      grid: read('--chart-grid', 'rgba(128,140,160,.25)')
    };
  }

  function prepare(canvas, aspect) {
    if (!canvas || !canvas.getContext) return null;
    const parent = canvas.parentElement;
    const cssWidth = Math.max(220, Math.round(
      canvas.clientWidth || (parent && parent.clientWidth) || 480
    ));
    const cssHeight = Math.round(cssWidth * (aspect || 0.72));
    const dpr = Math.min(3, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = cssHeight + 'px';
    let ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (_) { ctx = null; }
    /* Canvas can be unavailable (old browser, blocked canvas, headless run).
     * A missing 2D context must never stop a view from rendering. */
    if (!ctx || typeof ctx.setTransform !== 'function') return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, width: cssWidth, height: cssHeight };
  }

  function font(size, weight) {
    return (weight || 600) + ' ' + size + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  }

  /* ------------------------------- shot chart ----------------------------- */

  const COURT = { widthFt: 50, lengthFt: 47, hoopFt: 5.25, pad: 12 };

  function drawCourt(ctx, width, height, col) {
    const pad = COURT.pad;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const sx = w / COURT.widthFt;
    const sy = h / COURT.lengthFt;
    const px = x => pad + x * w;
    const py = y => height - pad - y * h; /* y = 0 is the baseline */

    ctx.fillStyle = col.court;
    ctx.fillRect(pad, pad, w, h);
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pad, pad, w, h);

    const hoopX = 0.5;
    const hoopY = COURT.hoopFt / COURT.lengthFt;

    /* Paint (16 ft wide, 19 ft deep) + free-throw circle */
    const paintHalf = 8 / COURT.widthFt;
    ctx.strokeRect(px(hoopX - paintHalf), py(19 / COURT.lengthFt),
      (paintHalf * 2) * w, (19 / COURT.lengthFt) * h);
    ctx.beginPath();
    ctx.ellipse(px(hoopX), py(19 / COURT.lengthFt), 6 * sx, 6 * sy, 0, 0, Math.PI * 2);
    ctx.stroke();

    /* Backboard + rim + restricted area */
    ctx.beginPath();
    ctx.moveTo(px(hoopX - 3 / COURT.widthFt), py(4 / COURT.lengthFt));
    ctx.lineTo(px(hoopX + 3 / COURT.widthFt), py(4 / COURT.lengthFt));
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(px(hoopX), py(hoopY), 0.75 * sx, 0.75 * sy, 0, 0, Math.PI * 2);
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(px(hoopX), py(hoopY), 4 * sx, 4 * sy, 0, Math.PI, Math.PI * 2);
    ctx.stroke();

    /* Three-point line: corner lines + 23.75 ft arc */
    const cornerHalf = 22 / COURT.widthFt;
    const cornerTop = (COURT.hoopFt + Math.sqrt(23.75 * 23.75 - 22 * 22)) / COURT.lengthFt;
    ctx.beginPath();
    ctx.moveTo(px(hoopX - cornerHalf), py(0));
    ctx.lineTo(px(hoopX - cornerHalf), py(cornerTop));
    ctx.moveTo(px(hoopX + cornerHalf), py(0));
    ctx.lineTo(px(hoopX + cornerHalf), py(cornerTop));
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(px(hoopX), py(hoopY), 23.75 * sx, 23.75 * sy, 0,
      Math.PI + Math.acos(cornerHalf / (23.75 / COURT.widthFt)), Math.PI * 2 -
      Math.acos(cornerHalf / (23.75 / COURT.widthFt)));
    ctx.stroke();

    /* Half-court centre circle (only the half inside our end of the floor) */
    ctx.beginPath();
    ctx.ellipse(px(0.5), py(1), 6 * sx, 6 * sy, 0, 0, Math.PI);
    ctx.stroke();

    return { px: px, py: py };
  }

  function drawShots(canvas, shots, opts) {
    const prepared = prepare(canvas, 0.92);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    const col = colors();
    const o = opts || {};
    const list = Array.isArray(shots) ? shots : [];
    const map = drawCourt(ctx, width, height, col);

    const teamColor = o.color || col.accent;
    const total = list.length;
    const made = list.filter(s => s.made).length;

    list.forEach(shot => {
      const x = map.px(Math.min(1, Math.max(0, Number(shot.x) || 0.5)));
      const y = map.py(Math.min(1, Math.max(0, Number(shot.y) || 0.11)));
      const isMade = !!shot.made;
      const color = shot.teamId && o.teamColorMap && o.teamColorMap[shot.teamId]
        ? o.teamColorMap[shot.teamId]
        : teamColor;
      ctx.beginPath();
      if (isMade) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.88;
        ctx.arc(x, y, 5.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,.75)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.8;
        ctx.moveTo(x - 3.6, y - 3.6);
        ctx.lineTo(x + 3.6, y + 3.6);
        ctx.moveTo(x + 3.6, y - 3.6);
        ctx.lineTo(x - 3.6, y + 3.6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });

    /* Legend */
    ctx.font = font(11, 600);
    ctx.fillStyle = col.muted;
    ctx.textAlign = 'left';
    const label = total
      ? made + ' / ' + total + ' shown · ' + Math.round((made / total) * 100) + '% · ● make ✕ miss'
      : 'No shot locations recorded yet';
    ctx.fillText(label, COURT.pad, height - 1.5);
    ctx.textAlign = 'right';
    ctx.fillText('half court · hoop at the bottom', width - COURT.pad, height - 1.5);
  }

  /* ------------------------------ game flow ------------------------------- */

  function drawFlow(canvas, flow, opts) {
    const prepared = prepare(canvas, 0.42);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    const col = colors();
    const o = opts || {};
    const data = (flow && flow.points) || [];
    const padL = 34;
    const padR = 12;
    const padT = 12;
    const padB = 22;
    const plotW = Math.max(10, width - padL - padR);
    const plotH = Math.max(10, height - padT - padB);
    const maxAbs = Math.max(1, (flow && flow.maxAbs) || 1);
    const mid = padT + plotH / 2;
    const xAt = i => padL + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const yAt = margin => mid - (margin / maxAbs) * (plotH / 2);

    ctx.fillStyle = col.court;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(padL, padT, plotW, plotH);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = -2; g <= 2; g++) {
      const value = (maxAbs / 2) * g;
      const y = yAt(value);
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
    }
    ctx.stroke();

    ctx.strokeStyle = col.muted;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, mid);
    ctx.lineTo(padL + plotW, mid);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!data.length) {
      ctx.font = font(12, 600);
      ctx.fillStyle = col.muted;
      ctx.textAlign = 'center';
      ctx.fillText('No scoring plays recorded yet', width / 2, height / 2);
      ctx.textAlign = 'left';
      return;
    }

    /* Margin area + margin line */
    ctx.beginPath();
    ctx.moveTo(xAt(0), mid);
    data.forEach((p, i) => ctx.lineTo(xAt(i), yAt(p.margin)));
    ctx.lineTo(xAt(data.length - 1), mid);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, hexAlpha(o.homeColor || col.accent, 0.22));
    grad.addColorStop(1, hexAlpha(o.awayColor || col.blue, 0.22));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 2.4;
    ctx.strokeStyle = o.lineColor || col.ink;
    ctx.beginPath();
    data.forEach((p, i) => {
      if (i === 0) ctx.moveTo(xAt(i), yAt(p.margin));
      else ctx.lineTo(xAt(i), yAt(p.margin));
    });
    ctx.stroke();

    /* Quarter markers */
    let lastQuarter = data[0].quarter;
    data.forEach((p, i) => {
      if (p.quarter !== lastQuarter) {
        lastQuarter = p.quarter;
        const x = xAt(i);
        ctx.strokeStyle = col.grid;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
      }
    });

    /* Axis labels */
    ctx.font = font(10, 700);
    ctx.fillStyle = col.muted;
    ctx.textAlign = 'right';
    ctx.fillText('+' + Math.round(maxAbs), padL - 4, padT + 9);
    ctx.fillText('0', padL - 4, mid + 3);
    ctx.fillText('−' + Math.round(maxAbs), padL - 4, padT + plotH);
    ctx.textAlign = 'left';
    const qCount = Math.max(1, Math.min(8, o.quarters || 4));
    for (let q = 1; q <= qCount; q++) {
      const x = padL + ((q - 1) / qCount) * plotW + 4;
      ctx.fillText('Q' + q, x, height - 6);
    }
    ctx.textAlign = 'right';
    ctx.fillText('margin', padL + plotW, height - 6);
    ctx.textAlign = 'left';
  }

  function drawSparkline(canvas, series, opts) {
    const prepared = prepare(canvas, 0.32);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    const col = colors();
    const o = opts || {};
    const values = Array.isArray(series) ? series.map(Number) : [];
    const color = o.color || col.accent;
    const pad = 4;
    const max = Math.max(1, ...values);
    const min = Math.min(0, ...values);

    ctx.clearRect(0, 0, width, height);
    if (!values.length) {
      ctx.font = font(10, 600);
      ctx.fillStyle = col.muted;
      ctx.fillText('No games yet', pad, height / 2 + 4);
      return;
    }
    const xAt = i => pad + (values.length <= 1 ? 0 : (i / (values.length - 1)) * (width - pad * 2));
    const yAt = v => height - pad - ((v - min) / Math.max(1, max - min)) * (height - pad * 2);

    ctx.beginPath();
    values.forEach((v, i) => {
      if (i === 0) ctx.moveTo(xAt(i), yAt(v));
      else ctx.lineTo(xAt(i), yAt(v));
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    values.forEach((v, i) => {
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(xAt(i), yAt(v), 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /* #rrggbb → rgba() with alpha; falls back to the raw colour. */
  function hexAlpha(color, alpha) {
    const value = String(color || '').trim();
    const m = /^#([0-9a-f]{6})$/i.exec(value);
    if (!m) return value;
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /* Redraw a canvas that has already been mounted (used after a theme swap). */
  function redraw(canvas, kind, data, opts) {
    if (!canvas) return;
    if (kind === 'shots') drawShots(canvas, data, opts);
    else if (kind === 'flow') drawFlow(canvas, data, opts);
    else if (kind === 'spark') drawSparkline(canvas, data, opts);
  }

  TBS.shotchart = {
    drawShots: drawShots,
    drawFlow: drawFlow,
    drawSparkline: drawSparkline,
    redraw: redraw,
    hexAlpha: hexAlpha,
    COURT: COURT
  };
})(window.TBS = window.TBS || {});
