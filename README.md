# Pomodoro Timer

A tiny single-file Pomodoro timer. Open `index.html` in any browser — no build step, no dependencies, no network calls.

## Features

- Classic 25 / 5 / 15 minute cycle: focus, short break, long break
- Long break after every 4th completed focus session
- Start, pause/resume, skip, and reset controls
- Progress bar and completed-session counter
- Dark theme, keyboard-free, works offline

## Usage

Open `index.html` in a browser. Click **Start** to begin focusing; **Skip** ends the current phase early; **Reset** returns to a fresh session.

## Tests

The timer's core state machine is unit-tested with Node's built-in test runner (Node 18+):

```
node --test
```

(Or run the file directly: `node --test test/pomodoro.test.js`.)

The suite:

- compiles the page's inline script with `vm.Script` (syntax gate for the whole page)
- loads it in a DOM-less sandbox and exercises the timer: phase transitions, overshoot carry-over, pause/resume, skip, reset, formatting, progress, and config validation
- sweeps long-break cadence for every value 1–8
- drives the full UI wiring through a fake DOM

## License

MIT
