/* =========================================================================
 * pdf.js — PURE, dependency-free PDF writer (text + simple tables).
 *
 *   TBS.pdf.build({ title, footer, blocks: [...] }) -> Uint8Array
 *
 * Blocks:
 *   { type: 'h1', text }            large heading
 *   { type: 'h2', text }            section heading (Helvetica-Bold)
 *   { type: 'p', text }             wrapped paragraph (Helvetica)
 *   { type: 'table', columns:[{label, align:'left'|'right'}], rows:[[...]] }
 *                                   monospace grid, columns auto-sized
 *   { type: 'space', size }         vertical gap in points
 *
 * Output is pure 7-bit ASCII (non-ASCII text is escaped as octal, characters
 * outside WinAnsi become "?"), so byte offsets in the xref table are exact.
 * Pages are A4, fonts are the 14 standard PDF fonts (no embedding needed).
 * Works in the browser (Blob) and in Node (Buffer.from(bytes)).
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 48;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  /* Unicode → WinAnsi (CP1252) for the punctuation we actually use. */
  const WIN = {
    0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
    0x2022: 0x95, 0x2026: 0x85, 0x20AC: 0x80, 0x2122: 0x99, 0x2212: 0x2D
  };

  function winCode(ch) {
    const cp = ch.codePointAt(0);
    if (cp < 128) return cp;
    if (WIN[cp] !== undefined) return WIN[cp];
    if (cp >= 0xA0 && cp <= 0xFF) return cp;
    return 0x3F; /* '?' */
  }

  /* Escape text for a PDF literal string; every byte becomes printable ASCII. */
  function pdfString(text) {
    let out = '(';
    Array.from(String(text === undefined || text === null ? '' : text)).forEach(ch => {
      const code = winCode(ch);
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else if (code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
      else out += String.fromCharCode(code);
    });
    return out + ')';
  }

  /* Average glyph widths (in 1/1000 em) are close enough for line wrapping. */
  const FONTS = {
    F1: { name: 'Helvetica', avg: 0.52 },
    F2: { name: 'Courier', avg: 0.6 },
    F3: { name: 'Helvetica-Bold', avg: 0.58 }
  };

  function charsFit(width, size, font) {
    return Math.max(1, Math.floor(width / (size * FONTS[font].avg)));
  }

  function wrap(text, width, size, font) {
    const max = charsFit(width, size, font);
    const out = [];
    String(text === undefined || text === null ? '' : text).split(/\r?\n/).forEach(paragraph => {
      let line = '';
      paragraph.split(/\s+/).forEach(word => {
        while (word.length > max) {
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, max));
          word = word.slice(max);
        }
        if (!line) line = word;
        else if ((line + ' ' + word).length <= max) line += ' ' + word;
        else { out.push(line); line = word; }
      });
      out.push(line);
    });
    return out;
  }

  /* Monospace table text lines, columns sized to the widest cell. */
  function tableLines(columns, rows, maxChars) {
    const widths = columns.map((c, i) => Math.max(String(c.label).length,
      ...rows.map(r => String(r[i] === undefined || r[i] === null ? '' : r[i]).length)));
    let total = widths.reduce((a, w) => a + w, 0) + (columns.length - 1) * 2;
    /* Shrink the first (name) column if the table would overflow the page. */
    if (total > maxChars && widths.length) {
      const over = total - maxChars;
      widths[0] = Math.max(8, widths[0] - over);
      total = widths.reduce((a, w) => a + w, 0) + (columns.length - 1) * 2;
    }
    const cell = (value, i) => {
      const text = String(value === undefined || value === null ? '' : value).slice(0, widths[i]);
      return columns[i].align === 'right' ? text.padStart(widths[i]) : text.padEnd(widths[i]);
    };
    const header = columns.map((c, i) => cell(c.label, i)).join('  ');
    const rule = widths.map(w => '-'.repeat(w)).join('  ');
    return [header, rule].concat(rows.map(r => columns.map((c, i) => cell(r[i], i)).join('  ')));
  }

  /* Lay out blocks into pages of drawing commands. */
  function layout(blocks) {
    const pages = [[]];
    let y = PAGE_H - MARGIN;
    let page = pages[0];

    function newPage() {
      page = [];
      pages.push(page);
      y = PAGE_H - MARGIN;
    }
    function need(h) {
      if (y - h < MARGIN + 18) newPage();
    }
    function text(str, font, size, gap) {
      need(size + gap);
      page.push({ font: font, size: size, x: MARGIN, y: y - size, text: str });
      y -= size + gap;
    }

    (blocks || []).forEach(b => {
      if (!b) return;
      if (b.type === 'h1') { text(b.text, 'F3', 18, 8); }
      else if (b.type === 'h2') { y -= 6; text(b.text, 'F3', 12, 5); }
      else if (b.type === 'p') {
        wrap(b.text, CONTENT_W, 10, 'F1').forEach(line => text(line, 'F1', 10, 3));
        y -= 3;
      } else if (b.type === 'space') { y -= b.size || 8; }
      else if (b.type === 'table') {
        const size = 7.5;
        tableLines(b.columns || [], b.rows || [], charsFit(CONTENT_W, size, 'F2'))
          .forEach(line => text(line, 'F2', size, 2.6));
        y -= 6;
      }
    });
    return pages;
  }

  function contentStream(page, pageNo, pageCount, footer) {
    const ops = [];
    page.forEach(cmd => {
      ops.push('BT /' + cmd.font + ' ' + cmd.size + ' Tf ' + cmd.x.toFixed(2) + ' ' +
        cmd.y.toFixed(2) + ' Td ' + pdfString(cmd.text) + ' Tj ET');
    });
    if (footer !== undefined) {
      const label = (footer ? footer + '   ' : '') + 'Page ' + pageNo + ' of ' + pageCount;
      ops.push('BT /F1 8 Tf ' + MARGIN.toFixed(2) + ' ' + (MARGIN - 20).toFixed(2) + ' Td ' +
        pdfString(label) + ' Tj ET');
    }
    return ops.join('\n');
  }

  function build(doc) {
    const d = doc || {};
    const pages = layout(d.blocks);
    const count = pages.length;
    /* Object numbering: 1 catalog, 2 pages, 3 info, 4 F1, 5 F2, 6 F3, then
     * for each page: page object + content stream. */
    const objects = [];
    const kids = [];
    const pageObjBase = 7;
    pages.forEach((page, i) => {
      const pageObj = pageObjBase + i * 2;
      const streamObj = pageObj + 1;
      kids.push(pageObj + ' 0 R');
      const stream = contentStream(page, i + 1, count, d.footer !== undefined ? d.footer : '');
      objects[pageObj] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W.toFixed(2) + ' ' + PAGE_H.toFixed(2) + '] ' +
        '/Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents ' + streamObj + ' 0 R >>';
      objects[streamObj] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
    });
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + count + ' >>';
    objects[3] = '<< /Title ' + pdfString(d.title || 'Report') + ' /Producer (TeamBallStats) /Creator (TeamBallStats) >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
    objects[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    const size = objects.length;
    let out = '%PDF-1.4\n%TBS\n';
    const offsets = [];
    for (let n = 1; n < size; n++) {
      offsets[n] = out.length;
      out += n + ' 0 obj\n' + objects[n] + '\nendobj\n';
    }
    const xref = out.length;
    out += 'xref\n0 ' + size + '\n';
    out += '0000000000 65535 f \n';
    for (let n = 1; n < size; n++) {
      out += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    }
    out += 'trailer\n<< /Size ' + size + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0x7f;
    return bytes;
  }

  TBS.pdf = {
    build: build,
    pdfString: pdfString,
    wrap: wrap,
    tableLines: tableLines,
    PAGE: { width: PAGE_W, height: PAGE_H, margin: MARGIN }
  };
})(window.TBS = window.TBS || {});
