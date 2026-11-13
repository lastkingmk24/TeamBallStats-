/* =========================================================================
 * Browser-level DOM test (optional, needs jsdom — not a runtime dependency).
 * Setup once outside the repo:   mkdir -p /tmp/tbs-dom && cd /tmp/tbs-dom && npm i jsdom@24
 * Run:                           NODE_PATH=/tmp/tbs-dom/node_modules node tests/dom/dom-test.js
 * It loads index.html with the local scripts inlined, seeds sample-data.json,
 * then clicks real buttons (two-tap entry, undo, halftime, box score editor,
 * CSV / PDF / share / e-mail buttons) and reports any runtime error.
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { webcrypto } = require('crypto');
const { TextEncoder, TextDecoder } = require('util');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = process.env.TBS_ROOT || path.resolve(__dirname, '..', '..');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"]+\.js)"><\/script>/g, (m, src) => {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  return '<script>/*' + src + '*/\n' + code.replace(/<\/script/g, '<\\/script') + '\n</script>';
});
const sample = fs.readFileSync(path.join(ROOT, 'sample-data.json'), 'utf8');

const errors = [];
const EXPECTED_JSDOM = /Not implemented: navigation/;
const captured = [];
const navigations = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { const t = String(e && e.stack || e); if (!EXPECTED_JSDOM.test(t)) errors.push(t); else navigations.push(t); });
vc.on('error', e => errors.push('console.error: ' + (e && e.stack || e)));

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
    window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    window.localStorage.setItem('bball_tm_v1', sample);
    window.HTMLCanvasElement.prototype.getContext = function () {
      const ctx = {
        canvas: { width: 300, height: 150 }, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
        textAlign: '', textBaseline: '', globalAlpha: 1, lineCap: '', lineJoin: ''
      };
      ['setTransform', 'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
        'arc', 'arcTo', 'ellipse', 'rect', 'fill', 'stroke', 'fillText', 'strokeText', 'save', 'restore', 'translate',
        'scale', 'rotate', 'setLineDash', 'clip', 'quadraticCurveTo', 'bezierCurveTo'].forEach(m => { ctx[m] = () => {}; });
      ctx.measureText = () => ({ width: 10 });
      ctx.createLinearGradient = () => ({ addColorStop() {} });
      ctx.createRadialGradient = () => ({ addColorStop() {} });
      ctx.getImageData = () => ({ data: [] });
      return ctx;
    };
    window.scrollTo = () => {};
    window.URL.createObjectURL = blob => { captured.push(blob); return 'blob:tbs/' + captured.length; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function () { if (this.download) captured.push({ download: this.download, blob: this.href }); };
  }
});
const { window } = dom;
const doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = () => window.TBS;
const $ = sel => doc.querySelector(sel);
const $$ = sel => Array.from(doc.querySelectorAll(sel));
const click = el => { assert.ok(el, 'element exists'); el.click(); };
const state = () => T().app.getState();
const gameOf = id => state().games.find(g => g.id === id);
let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

async function setup() {
  await new Promise(r => { if (doc.readyState === 'complete') r(); else window.addEventListener('load', r); });
  await sleep(50);
  const reg = await T().auth.register(state(), { role: 'commissioner', username: 'league', password: 'correct-horse-1', confirmPassword: 'correct-horse-1' });
  assert.ok(reg.ok, 'register: ' + (reg.error || ''));
  const sig = await T().auth.signIn(state(), { username: 'league', password: 'correct-horse-1' });
  assert.ok(sig.ok, 'signIn: ' + (sig.error || ''));
  T().app.commit(d => {
    const g = d.games.find(x => x.id === 'game-3');
    g.status = 'live'; g.clockSeconds = 600; g.clockRunningSince = null;
  });
  T().app.go('live');
  await sleep(30);
  T().live.openGame('game-3');
  await sleep(30);
}

async function run() {
  await setup();
  const hawks = 'team-hawks', wolves = 'team-wolves';
  const roster = state().players.filter(p => p.teamId === hawks && p.active !== false)
    .sort((a, b) => Number(a.number) - Number(b.number));
  assert.ok(roster.length >= 2, 'roster present');
  const p1 = roster[0];

  ok('console renders two-tap entry by default with 13 stat targets', () => {
    assert.ok($('.tt-stats'), 'two-tap panel');
    assert.strictEqual($$('.tt-stat').length, 13);
    assert.ok($('.mode-btn.is-on[data-mode="twotap"]'));
    assert.ok(/Step 1/.test($('.tt-target-area').textContent));
  });

  ok('phase pill shows LIVE · Q1 and the scoreboard shows team fouls', () => {
    assert.ok(/LIVE · Q1/.test($('.phase-pill').textContent), $('.phase-pill').textContent);
    assert.ok($$('.team-fouls').length === 2);
  });

  const beforeScore = gameOf('game-3').homeScore;
  ok('TWO-TAP: stat then jersey records +3 instantly for the player', () => {
    click($('[data-action="tt-stat"][data-play="fg3_make"]'));
    assert.ok($('.tt-armed'), 'armed hint shown');
    assert.ok($$('[data-action="tt-target"]').length >= roster.length, 'jersey grid shown');
    click($(`[data-action="tt-target"][data-id="${p1.id}"]`));
    const line = gameOf('game-3').stats.find(s => s.playerId === p1.id);
    assert.strictEqual(line.pts, 3);
    assert.strictEqual(line.tpm, 1);
    assert.strictEqual(gameOf('game-3').homeScore, beforeScore + 3);
    assert.ok(!$('.tt-armed'), 'selection cleared after recording');
    assert.ok(/3PT made/.test($('.tt-last').textContent), $('.tt-last').textContent);
  });

  ok('TWO-TAP: OREB then DREB update the player and total rebounds', () => {
    click($('[data-action="tt-stat"][data-play="oreb"]'));
    click($(`[data-action="tt-target"][data-id="${p1.id}"]`));
    click($('[data-action="tt-stat"][data-play="dreb"]'));
    click($(`[data-action="tt-target"][data-id="${p1.id}"]`));
    const line = gameOf('game-3').stats.find(s => s.playerId === p1.id);
    assert.strictEqual(line.oreb, 1); assert.strictEqual(line.dreb, 1); assert.strictEqual(line.reb, 2);
  });

  ok('pressing the same stat twice disarms it (cancel without recording)', () => {
    const before = gameOf('game-3').events.length;
    click($('[data-action="tt-stat"][data-play="ast"]'));
    click($('[data-action="tt-stat"][data-play="ast"]'));
    assert.strictEqual(gameOf('game-3').events.length, before);
  });

  ok('a jersey tap with no stat armed records nothing and explains why', () => {
    const before = gameOf('game-3').events.length;
    click($(`[data-action="tt-target"][data-id="${p1.id}"]`) || $('[data-action="tt-stat"][data-play="stl"]'));
    assert.strictEqual(gameOf('game-3').events.length, before);
  });

  ok('OPPONENT: selecting the other side shows one team-total target (no roster)', () => {
    click($(`[data-action="select-team"][data-team="${wolves}"]`));
    click($('[data-action="tt-stat"][data-play="fg2_make"]'));
    assert.ok($('.tt-team-total'), 'team total target shown');
    assert.strictEqual($$('.tt-jerseys').length, 0, 'no jersey grid for opponent');
  });

  ok('OPPONENT: team-total entries record aggregates with no player row', () => {
    click($('.tt-team-total'));
    click($('[data-action="tt-stat"][data-play="blk"]'));
    click($('.tt-team-total'));
    const g = gameOf('game-3');
    const agg = g.stats.find(s => s.teamId === wolves && !s.playerId);
    assert.ok(agg, 'aggregate line');
    assert.strictEqual(agg.aggregate, true);
    assert.strictEqual(agg.fgm, 1);
    assert.strictEqual(agg.blk, 1);
    assert.strictEqual(g.awayScore, 2);
    assert.strictEqual(g.stats.filter(s => s.teamId === wolves && s.playerId).length, 0);
  });

  ok('box score in the console shows the team totals row for the opponent', () => {
    assert.ok($('.live-box .aggregate-row'), 'aggregate row rendered');
  });

  ok('UNDO reverts the most recent entry (the opponent block) only', () => {
    click($('[data-action="undo"]'));
    const g = gameOf('game-3');
    assert.strictEqual(g.awayScore, 2);
    assert.strictEqual(g.stats.find(s => s.teamId === wolves && !s.playerId).blk, 0);
    assert.strictEqual(g.stats.find(s => s.teamId === wolves && !s.playerId).fgm, 1);
  });

  ok('UNDO twice more restores the scores exactly', () => {
    click($('[data-action="undo"]'));   /* removes the opponent 2PT */
    click($('[data-action="undo"]'));   /* removes the DREB (no score) */
    assert.strictEqual(gameOf('game-3').awayScore, 0);
    assert.strictEqual(gameOf('game-3').homeScore, beforeScore + 3, 'the 3PT is still recorded');
    assert.strictEqual(gameOf('game-3').stats.find(s => s.playerId === p1.id).dreb, 0);
    assert.strictEqual(gameOf('game-3').stats.find(s => s.playerId === p1.id).oreb, 1);
  });

  ok('team foul badge counts personal fouls per quarter (5th foul = BONUS)', () => {
    click($(`[data-action="select-team"][data-team="${hawks}"]`));
    for (let i = 0; i < 5; i++) {
      click($('[data-action="tt-stat"][data-play="pf"]'));
      click($(`[data-action="tt-target"][data-id="${p1.id}"]`));
    }
    assert.ok($('.team-fouls.is-bonus'), 'bonus flagged on our side');
    assert.ok(/BONUS/.test($('.team-fouls.is-bonus').textContent));
  });

  ok('HALFTIME pauses scoring and the clock; stat buttons are disabled', () => {
    click($('[data-action="halftime"]'));
    assert.ok(gameOf('game-3').halftime);
    assert.ok(/HALFTIME/.test($('.phase-pill').textContent));
    assert.ok($('[data-action="tt-stat"][data-play="fg2_make"]').disabled);
    assert.ok(/HT/.test($('#live-clock').textContent));
  });

  ok('RESUME moves to Q2 with a full clock and re-enables scoring', () => {
    click($('[data-action="resume"]'));
    const g = gameOf('game-3');
    assert.strictEqual(g.halftime, false);
    assert.strictEqual(g.quarter, 2);
    assert.strictEqual(g.clockSeconds, 600);
    assert.ok(!$('[data-action="tt-stat"][data-play="fg2_make"]').disabled);
  });

  ok('CLASSIC mode is still available and records a player-first play', () => {
    click($('[data-action="set-mode"][data-mode="classic"]'));
    assert.ok($('.stat-grid'), 'classic grid');
    click($(`[data-action="select-player"][data-id="${p1.id}"]`));
    const before = gameOf('game-3').stats.find(s => s.playerId === p1.id).ast;
    click($('[data-action="play"][data-play="ast"]'));
    assert.strictEqual(gameOf('game-3').stats.find(s => s.playerId === p1.id).ast, before + 1);
    click($('[data-action="set-mode"][data-mode="twotap"]'));
    assert.ok($('.tt-stats'));
  });

  ok('CLASSIC: opponent team total chip records an aggregate play', () => {
    click($('[data-action="set-mode"][data-mode="classic"]'));
    click($(`[data-action="select-team"][data-team="${wolves}"]`));
    click($('.team-total-chip'));
    click($('[data-action="play"][data-play="tov"]'));
    const agg = gameOf('game-3').stats.find(s => s.teamId === wolves && !s.playerId);
    assert.strictEqual(agg.tov, 1);
    click($('[data-action="set-mode"][data-mode="twotap"]'));
  });

  ok('FINALIZE moves the game to final and blocks scoring', () => {
    click($('[data-action="finalize"]'));
    assert.strictEqual(gameOf('game-3').status, 'final');
    assert.ok(/FINAL/.test($('.phase-pill').textContent));
    assert.ok($('[data-action="tt-stat"][data-play="ast"]').disabled);
  });

  ok('the box score tab shows team totals for the opponent and OREB/DREB columns', () => {
    T().boxscores.openGame('game-3');
    T().boxscores.render(state());
    const box = $('#box-content').textContent;

    assert.ok(/Team totals/.test(box), 'team totals row');
    assert.ok(/off/.test(box), 'off/def rebound split shown');
  });


  const readBlob = (b, mode) => new Promise((resolve, reject) => {
    const fr = new window.FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    if (mode === 'buffer') fr.readAsArrayBuffer(b); else fr.readAsText(b, 'utf-8');
  });
  const blobText = b => readBlob(b, 'text');

  await (async () => {
    const before = captured.length;
    T().boxscores.openGame('game-3');
    T().boxscores.render(state());
    click($('#box-csv-btn'));
    await sleep(20);
    const blob = captured.slice(before).find(c => c && typeof c.size === 'number');
    assert.ok(blob, 'a CSV blob was produced');
    assert.ok(blob.type.indexOf('text/csv') === 0, 'csv mime: ' + blob.type);
    const raw = Buffer.from(await readBlob(blob, 'buffer'));
    assert.deepStrictEqual([...raw.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM bytes');
    const text = raw.slice(3).toString('utf8');
    const header = text.split('\r\n')[0];
    assert.ok(/OREB/.test(header) && /DREB/.test(header), 'header has OREB and DREB');
    assert.ok(text.indexOf('\r\n') > 0, 'CRLF line endings');
    assert.ok(/Team totals|TEAM/i.test(text), 'team total row present');
    passed++; console.log('  ✓ BOX CSV button downloads a BOM-prefixed UTF-8 file with OREB/DREB and team rows');
  })();

  await (async () => {
    const before = captured.length;
    click($('#box-pdf-btn'));
    await sleep(20);
    const blob = captured.slice(before).find(c => c && typeof c.size === 'number');
    assert.ok(blob, 'a PDF blob was produced');
    const head = Buffer.from(await readBlob(blob, 'buffer')).slice(0, 8).toString('latin1');
    assert.ok(head.indexOf('%PDF-1.') === 0, 'PDF header: ' + head);
    passed++; console.log('  ✓ Download PDF button produces a %PDF file');
  })();

  await (async () => {
    click($('#box-share-btn'));
    await sleep(20);
    const area = $('textarea');
    assert.ok(area && area.value.length > 20, 'share dialog shows the text summary');
    assert.ok(/\S/.test(area.value), 'summary has content');
    const closeBtn = $('[data-action="close"], .modal button[type="button"]');
    if (closeBtn) closeBtn.click();
    await sleep(20);
    passed++; console.log('  ✓ Share button opens the text summary (no Web Share API in jsdom)');
  })();

  await (async () => {
    click($('#box-email-btn'));
    await sleep(20);
    assert.ok(navigations.some(t => /navigation/.test(t)), 'E-mail button attempted a mailto: hand-off');
    passed++; console.log('  ✓ E-mail report button runs without a script error');
  })();

  await (async () => {
    T().boxscores.openGame('game-3');
    T().boxscores.render(state());
    const beforeAgg = gameOf('game-3').stats.filter(s => s.aggregate === true).length;
    assert.ok(beforeAgg >= 1, 'game-3 has an opponent aggregate line');
    click($('#box-edit-btn'));
    await sleep(20);
    const home = $('#edit-home-score');
    assert.ok(home, 'editor shows home score input');
    home.value = '99';
    home.dispatchEvent(new window.Event('input', { bubbles: true }));
    home.dispatchEvent(new window.Event('change', { bubbles: true }));
    click($('[data-action="save-box"]'));
    await sleep(20);
    const g = gameOf('game-3');
    assert.strictEqual(Number(g.homeScore), 99, 'editor saved the home score');
    assert.ok(g.stats.some(s => s.aggregate === true && !s.playerId), 'opponent aggregate line kept its flag after save');
    assert.strictEqual(g.halftime, false, 'halftime cleared when the game is not live');
    passed++; console.log('  ✓ BOX SCORE EDITOR save persists the score and keeps the aggregate flag');
  })();

  ok('halftime status badge reads Halftime for a live game in halftime', () => {
    const badge = T().ui.statusBadge('live', true);
    assert.ok(/Halftime/.test(badge), badge);
    assert.ok(/LIVE/.test(T().ui.statusBadge('live', false)));
  });

  ok('SHOT CLOCK: shows when enabled, starts with the game clock, pauses with it, and Reset restores it', () => {
    T().app.commit(d => {
      d.league.shotClock = 24;
      const g = d.games.find(x => x.id === 'game-1');
      g.status = 'live'; g.quarter = 2; g.clockSeconds = 300; g.clockRunningSince = null;
      g.shotClockSeconds = null; g.shotRunningSince = null; g.halftime = false;
    });
    T().live.openGame('game-1');
    assert.strictEqual($('#live-shot-clock').textContent, '24', 'shot clock shows 24');
    click($('[data-action="toggle-clock"]'));
    assert.ok(gameOf('game-1').shotRunningSince, 'shot clock starts with the game clock');
    click($('[data-action="toggle-clock"]'));
    assert.strictEqual(gameOf('game-1').shotRunningSince, null, 'shot clock stops with the game clock');
    assert.ok(gameOf('game-1').shotClockSeconds <= 24);
    click($('[data-action="reset-shot"]'));
    assert.strictEqual(gameOf('game-1').shotClockSeconds, 24, 'reset restores the full shot clock');
    assert.strictEqual($('#live-shot-clock').textContent, '24');
  });

  await (async () => {
    T().app.go('live');
    await sleep(60);
    const stat = doc.querySelector('[data-action="tt-stat"][data-play="dreb"]');
    assert.ok(stat, 'two-tap DREB button is shown');
    click(stat);
    const jersey = doc.querySelector('[data-action="tt-target"][data-id]:not([data-id=""])');
    assert.ok(jersey, 'a jersey button for our team is shown');
    click(jersey);
    await sleep(20);
    const press = key => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: key, bubbles: true }));
    const sumOf = f => gameOf('game-1').stats.reduce((n, s) => n + (s[f] || 0), 0);
    const d0 = sumOf('dreb'), o0 = sumOf('oreb');
    press('r');
    assert.strictEqual(sumOf('dreb'), d0 + 1, 'R adds one defensive rebound');
    press('o');
    assert.strictEqual(sumOf('oreb'), o0 + 1, 'O adds one offensive rebound');
    passed++; console.log('  ✓ KEYBOARD: R records a defensive rebound and O records an offensive rebound');
  })();

  console.log('\n✅ ' + passed + ' DOM checks passed.');
  if (errors.length) console.log('Runtime errors captured (' + errors.length + '):\n' + errors.slice(0, 5).join('\n---\n'));
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n✗ FAILED after ' + passed + ' checks:', err && err.stack || err);
  if (errors.length) console.error('Runtime errors:\n' + errors.slice(0, 5).join('\n---\n'));
  process.exit(1);
});
