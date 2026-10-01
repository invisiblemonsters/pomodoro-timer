'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractInlineScripts(source) {
  const scripts = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(source)) !== null) {
    const openTag = match[0].slice(0, match[0].indexOf('>'));
    if (/\bsrc\s*=/i.test(openTag)) continue;
    scripts.push(match[1]);
  }
  return scripts;
}

const inlineScripts = extractInlineScripts(HTML);

// Load the page's inline script into a DOM-less sandbox: the script must
// parse cleanly and define its API without touching a browser environment.
const sandbox = { console };
vm.createContext(sandbox);
for (const src of inlineScripts) {
  new vm.Script(src, { filename: 'index.html#inline' }).runInContext(sandbox);
}
const { PomodoroTimer, PomodoroUI } = sandbox;

// Snapshots come from the sandbox realm, so compare plain fields instead of
// deep-comparing cross-realm objects.
function plain(s) {
  return {
    phase: s.phase,
    remainingMs: s.remainingMs,
    running: s.running,
    completedWork: s.completedWork,
    phaseDurationMs: s.phaseDurationMs
  };
}

function tiny() {
  return new PomodoroTimer({ workMs: 1000, shortBreakMs: 200, longBreakMs: 500, longBreakEvery: 2 });
}

test('index.html contains inline scripts that compile', () => {
  assert.ok(inlineScripts.length >= 1, 'expected at least one inline script');
  for (const src of inlineScripts) {
    assert.doesNotThrow(() => new vm.Script(src, { filename: 'index.html#inline' }));
  }
});

test('inline script defines the timer API with no DOM present', () => {
  assert.equal(typeof PomodoroTimer, 'function');
  assert.equal(typeof PomodoroUI, 'object');
  assert.equal(typeof PomodoroUI.initUI, 'function');
});

test('initial state is a fresh 25-minute focus phase', () => {
  const t = new PomodoroTimer();
  assert.deepEqual(plain(t.snapshot()), {
    phase: 'work', remainingMs: 1500000, running: false, completedWork: 0, phaseDurationMs: 1500000
  });
  assert.equal(t.progress(), 0);
});

test('start / tick / pause / resume track elapsed time', () => {
  const t = tiny();
  t.start(0);
  assert.equal(t.snapshot().running, true);

  t.tick(300);
  assert.equal(t.snapshot().remainingMs, 700);

  t.pause(500);
  assert.equal(t.snapshot().remainingMs, 500);
  assert.equal(t.snapshot().running, false);

  t.tick(999999);
  assert.equal(t.snapshot().remainingMs, 500, 'paused timers must not advance');

  t.start(100000);
  t.tick(100400);
  assert.equal(t.snapshot().remainingMs, 100);
});

test('phase completion carries the overshoot into the next phase', () => {
  const t = tiny();
  t.start(0);
  t.tick(1000); // work expires exactly
  assert.deepEqual(plain(t.snapshot()), {
    phase: 'shortBreak', remainingMs: 200, running: true, completedWork: 1, phaseDurationMs: 200
  });
  t.tick(1150);
  assert.equal(t.snapshot().remainingMs, 50);
  t.tick(1200); // break expires
  assert.deepEqual(plain(t.snapshot()), {
    phase: 'work', remainingMs: 1000, running: true, completedWork: 1, phaseDurationMs: 1000
  });
});

test('a long break replaces the short break every N work sessions', () => {
  const t = tiny();
  t.start(0);
  t.tick(1000); // work #1 -> short break
  assert.equal(t.snapshot().phase, 'shortBreak');
  t.tick(1200); // short break -> work
  assert.equal(t.snapshot().phase, 'work');
  t.tick(2200); // work #2 -> long break (every = 2)
  assert.deepEqual(plain(t.snapshot()), {
    phase: 'longBreak', remainingMs: 500, running: true, completedWork: 2, phaseDurationMs: 500
  });
  t.tick(2700); // long break -> work
  assert.equal(t.snapshot().phase, 'work');
});

test('one large tick can cross several phases without drifting', () => {
  const t = tiny();
  t.start(0);
  t.tick(5000);
  // 4 work + 2 short + 1 long = 4900ms elapsed; 100ms into the second long break.
  assert.deepEqual(plain(t.snapshot()), {
    phase: 'longBreak', remainingMs: 400, running: true, completedWork: 4, phaseDurationMs: 500
  });
});

test('skip ends the current phase immediately', () => {
  const t = tiny();
  t.start(0);
  t.tick(100);
  assert.deepEqual(plain(t.skip(100)), {
    phase: 'shortBreak', remainingMs: 200, running: true, completedWork: 1, phaseDurationMs: 200
  });
  assert.deepEqual(plain(t.skip()), {
    phase: 'work', remainingMs: 1000, running: true, completedWork: 1, phaseDurationMs: 1000
  });
});

test('skip at the exact expiry moment advances only once', () => {
  const t = tiny();
  t.start(0);
  assert.deepEqual(plain(t.skip(1000)), {
    phase: 'shortBreak', remainingMs: 200, running: true, completedWork: 1, phaseDurationMs: 200
  });
});

test('reset restores the initial state', () => {
  const t = tiny();
  t.start(0);
  t.tick(400);
  t.skip(400);
  t.reset();
  assert.deepEqual(plain(t.snapshot()), {
    phase: 'work', remainingMs: 1000, running: false, completedWork: 0, phaseDurationMs: 1000
  });
});

test('formatRemaining renders mm:ss with ceiling seconds', () => {
  assert.equal(PomodoroTimer.formatRemaining(1500000), '25:00');
  assert.equal(PomodoroTimer.formatRemaining(1499000), '24:59');
  assert.equal(PomodoroTimer.formatRemaining(59999), '01:00');
  assert.equal(PomodoroTimer.formatRemaining(1), '00:01');
  assert.equal(PomodoroTimer.formatRemaining(0), '00:00');
  assert.equal(PomodoroTimer.formatRemaining(-5), '00:00');
  assert.equal(PomodoroTimer.formatRemaining(61 * 60 * 1000), '61:00');
});

test('progress is the elapsed fraction, clamped to [0, 1]', () => {
  const t = tiny();
  assert.equal(t.progress(), 0);
  t.start(0);
  t.tick(250);
  assert.ok(Math.abs(t.progress() - 0.25) < 1e-9, 'expected 25% progress');
  t.tick(975); // 975ms elapsed of 1000ms
  assert.ok(Math.abs(t.progress() - 0.975) < 1e-9);
});

test('invalid configuration is rejected', () => {
  const isRangeError = (err) => err.name === 'RangeError';
  assert.throws(() => new PomodoroTimer({ workMs: 0 }), isRangeError);
  assert.throws(() => new PomodoroTimer({ shortBreakMs: -1 }), isRangeError);
  assert.throws(() => new PomodoroTimer({ longBreakMs: 0 }), isRangeError);
  assert.throws(() => new PomodoroTimer({ longBreakEvery: 0 }), isRangeError);
  assert.throws(() => new PomodoroTimer({ longBreakEvery: 2.5 }), isRangeError);
});

test('long-break cadence is correct for every value 1..8 (sweep)', () => {
  for (let every = 1; every <= 8; every++) {
    const t = new PomodoroTimer({ workMs: 1000, shortBreakMs: 200, longBreakMs: 500, longBreakEvery: every });
    for (let i = 1; i <= 4 * every; i++) {
      t.skip(0); // end the work phase -> enter a break
      assert.equal(
        t.snapshot().phase,
        i % every === 0 ? 'longBreak' : 'shortBreak',
        `every=${every}, completed work #${i}`
      );
      t.skip(0); // end the break -> back to work
      assert.equal(t.snapshot().phase, 'work', `every=${every}, after break #${i}`);
    }
  }
});

test('two timers driven identically stay in lockstep (determinism)', () => {
  const a = tiny();
  const b = tiny();
  for (const t of [a, b]) {
    t.start(0);
    t.tick(700);
    t.pause(750);
    t.start(1000);
    t.tick(1300);
  }
  assert.deepEqual(plain(a.snapshot()), plain(b.snapshot()));
});

function makeElement() {
  const listeners = {};
  return {
    textContent: '',
    className: '',
    style: {},
    addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
    click() { (listeners.click || []).forEach((cb) => cb({})); }
  };
}

function makeFakeDoc(ids) {
  const els = {};
  for (const id of ids) els[id] = makeElement();
  return {
    els,
    getElementById(id) { return els[id] || null; }
  };
}

test('UI wiring drives a fake DOM through a full cycle', () => {
  const UI_IDS = ['time', 'phase', 'sessions', 'progress', 'start-pause', 'reset', 'skip'];
  const doc = makeFakeDoc(UI_IDS);
  let fakeNow = 0;
  let intervalFn = null;
  const ui = PomodoroUI.initUI(doc, {
    now: () => fakeNow,
    setInterval: (fn) => { intervalFn = fn; return 1; },
    clearInterval: () => {}
  });

  // Initial paint.
  assert.equal(doc.els.time.textContent, '25:00');
  assert.equal(doc.els.phase.textContent, 'Focus');
  assert.equal(doc.els['start-pause'].textContent, 'Start');
  assert.equal(doc.els.sessions.textContent, 'Completed sessions: 0');
  assert.equal(doc.els.progress.style.width, '0.00%');

  // Start, then let the UI interval repaint one second in.
  doc.els['start-pause'].click();
  assert.equal(doc.els['start-pause'].textContent, 'Pause');
  fakeNow = 1000;
  intervalFn();
  assert.equal(doc.els.time.textContent, '24:59');
  assert.equal(doc.els.progress.style.width, '0.07%');

  // Pause mid-phase: label flips to Resume, display freezes.
  doc.els['start-pause'].click();
  assert.equal(doc.els['start-pause'].textContent, 'Resume');
  fakeNow = 60000;
  intervalFn();
  assert.equal(doc.els.time.textContent, '24:59');

  // Skip the rest of the focus block -> short break.
  doc.els.skip.click();
  assert.equal(doc.els.phase.textContent, 'Short break');
  assert.equal(doc.els.time.textContent, '05:00');
  assert.equal(doc.els.sessions.textContent, 'Completed sessions: 1');
  assert.equal(doc.els['start-pause'].textContent, 'Start');

  // Reset returns everything to the fresh state.
  doc.els.reset.click();
  assert.equal(doc.els.time.textContent, '25:00');
  assert.equal(doc.els.phase.textContent, 'Focus');
  assert.equal(doc.els.sessions.textContent, 'Completed sessions: 0');
  assert.equal(doc.els['start-pause'].textContent, 'Start');
  assert.equal(doc.els.progress.style.width, '0.00%');

  ui.stop();
});
