const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  let now = 100000, timerId = 0, sessionId = 0;
  const timers = new Map(), requests = [], calls = [];
  const clock = { textContent: '' }, status = { textContent: '' };
  const display = {
    html: '',
    set innerHTML(value) {
      this.html = value;
      clock.textContent = value.match(/id="aiLiveClock"[^>]*>([^<]*)/)?.[1] || '';
    }
  };
  const nodes = { aiLiveClock: clock, aiLiveStatus: status, aiLiveDisplay: display };
  const addTimer = (callback, delay = 0, repeat = false) => {
    const id = ++timerId;
    timers.set(id, { callback, at: now + delay, interval: repeat ? delay : 0 });
    return id;
  };
  const response = (body, ok = true) => ({ ok, json: async () => body });
  const context = {
    window: {}, AbortController, structuredClone,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    performance: { now: () => now },
    setTimeout: (cb, delay) => addTimer(cb, delay), clearTimeout: id => timers.delete(id),
    setInterval: (cb, delay) => addTimer(cb, delay, true), clearInterval: id => timers.delete(id),
    LiveDetectionModel: { sceneGate: () => ({}) }, OCRRuntime: { stability: () => ({}) },
    localStorage: { getItem: () => '' }, console: { warn() {} }, esc: value => String(value ?? ''),
    document: {
      getElementById: id => nodes[id] || null,
      createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,fixture' })
    },
    fetch: async (url, options) => {
      if (url === '/assets/catalog.json') return response({ heroes: [], items: [] });
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (url === '/api/detection/start') return response({ session: 'ai-' + ++sessionId });
      if (url !== '/api/detection/ai-live') return response({});
      return new Promise(resolve => requests.push({ body, signal: options.signal, resolve }));
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/live-detection.js'), 'utf8'), context);
  const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
  async function advance(ms) {
    const target = now + ms;
    await flush();
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      if (timer.interval) timer.at += timer.interval;
      else timers.delete(id);
      timer.callback();
      await flush();
    }
    now = target;
    await flush();
  }
  async function finish(index, { mode = 'game', seconds = 120, kills = 3, error } = {}) {
    const req = requests[index], sampledAt = req.body.sampledAt;
    const gameTime = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    const patch = mode === 'draft'
      ? { draftTimer: { remaining: seconds, endAt: req.body.live ? sampledAt + seconds * 1000 : null } }
      : { gameTime, gameClock: { running: req.body.live, seconds, syncedAt: sampledAt }, blue: { kills } };
    req.resolve(response(error ? { error } : { mode, patch, applied: req.body.autoApply, clockExpiresAt: now + 15000 }, !error));
    await flush();
  }
  return { api: context.window.LiveDetection, source: { width: 1920, height: 1080 }, requests, calls, clock, status, display, advance, finish, flush };
}

test('AI scans use a one-second start cadence and immediately follow slow responses without overlapping', async () => {
  const h = harness();
  h.api.startAiLoop({ getSource: () => h.source });
  await h.advance(200);
  assert.equal(h.requests.length, 1);
  await h.finish(0);
  await h.advance(799);
  assert.equal(h.requests.length, 1);
  await h.advance(1);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].body.sampledAt - h.requests[0].body.sampledAt, 1000);
  await h.advance(2400);
  assert.equal(h.requests.length, 2);
  assert.equal(await h.api.scanAi({ source: h.source }), null);
  await h.finish(1);
  await h.advance(0);
  assert.equal(h.requests.length, 3);
  h.api.stopAiLoop();
});

test('game and draft clocks include recognition latency and tick while the next scan is pending', async () => {
  for (const [mode, seconds, immediate, later] of [['game', 120, '02:02', '02:03'], ['draft', 60, '00:58', '00:57']]) {
    const h = harness();
    h.api.startAiLoop({ getSource: () => h.source });
    await h.advance(2400);
    await h.finish(0, { mode, seconds });
    assert.equal(h.clock.textContent, immediate);
    await h.advance(600);
    assert.equal(h.clock.textContent, later);
    assert.equal(h.requests.length, 2);
    h.api.stopAiLoop();
  }
});

test('single-frame scans and disabled smoothing leave clocks fixed', async () => {
  for (const options of [{}, { live: true, smoothClock: false }]) {
    const h = harness();
    const scan = h.api.scanAi({ source: h.source, ...options });
    await h.advance(2400);
    assert.equal(h.requests[0].body.live, false);
    await h.finish(0);
    await scan;
    await h.advance(10000);
    assert.equal(h.clock.textContent, '02:00');
    h.api.stopAiLoop();
  }
});

test('live options are evaluated for each captured frame', async () => {
  const h = harness();
  let enabled = true;
  h.api.startAiLoop({ getSource: () => h.source, autoApply: () => enabled, switchScene: () => enabled, smoothClock: () => enabled });
  await h.flush();
  assert.equal(h.requests[0].body.autoApply, true);
  await h.finish(0);
  enabled = false;
  await h.advance(1000);
  for (const field of ['autoApply', 'switchScene', 'live']) assert.equal(h.requests[1].body[field], false);
  h.api.stopAiLoop();
});

test('stop and restart ignore a late response without reviving the old loop or clock', async () => {
  const h = harness();
  h.api.startAiLoop({ getSource: () => h.source });
  await h.flush();
  h.api.stopAiLoop();
  assert.equal(h.requests[0].signal.aborted, true);
  h.api.startAiLoop({ getSource: () => h.source });
  await h.flush();
  await h.finish(1, { seconds: 600 });
  const currentHud = h.display.html;
  await h.finish(0, { seconds: 120 });
  assert.equal(h.display.html, currentHud);
  assert.equal(h.clock.textContent, '10:00');
  await h.advance(1000);
  assert.equal(h.requests.length, 3);
  h.api.stopAiLoop();
  await h.finish(2);
  await h.advance(10000);
  assert.equal(h.requests.length, 3);
  assert.equal(h.api.isAiLoopRunning(), false);
});

test('failed scans back off and recover to the normal cadence', async () => {
  const h = harness();
  h.api.startAiLoop({ getSource: () => h.source });
  await h.flush();
  await h.finish(0, { error: 'Rate limited' });
  await h.advance(4499);
  assert.equal(h.requests.length, 1);
  await h.advance(1);
  assert.equal(h.requests.length, 2);
  await h.finish(1);
  await h.advance(1000);
  assert.equal(h.requests.length, 3);
  h.api.stopAiLoop();
});

test('missing capture holds clocks and resumes promptly when a source returns', async () => {
  const h = harness();
  let source = h.source;
  h.api.startAiLoop({ getSource: () => source });
  await h.flush();
  await h.finish(0);
  source = null;
  await h.advance(1000);
  assert.ok(h.calls.some(call => call.url === '/api/detection/hold'));
  const held = h.clock.textContent;
  await h.advance(5000);
  assert.equal(h.clock.textContent, held);
  source = h.source;
  await h.advance(250);
  assert.equal(h.requests.length, 2);
  h.api.stopAiLoop();
});

test('a stalled AI response cannot leave the monitor clock running indefinitely', async () => {
  const h = harness();
  h.api.startAiLoop({ getSource: () => h.source });
  await h.flush();
  await h.finish(0);
  await h.advance(16000);
  assert.equal(h.clock.textContent, '02:15');
  assert.match(h.status.textContent, /clock held/);
  await h.advance(10000);
  assert.equal(h.clock.textContent, '02:15');
  h.api.stopAiLoop();
});
