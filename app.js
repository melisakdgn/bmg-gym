/* BMG — Gym Tracker. Vanilla JS. Data is saved on the device using the browser's Cache Storage, so it works offline. */
(() => {
  'use strict';

  // ---------- Storage (on-device, offline) ----------
  const DATA_CACHE = 'bmg-data';
  const DATA_URL = './__bmg-data__.json';
  const blank = () => ({
    version: 1,
    current: null,
    users: {
      berke: { workouts: [], sessions: [], timer: null },
      melis: { workouts: [], sessions: [], timer: null },
    },
  });
  const hasCache = () => { try { return typeof caches !== 'undefined' && !!caches.open; } catch (e) { return false; } };
  async function load() {
    if (!hasCache()) return blank();
    try {
      const c = await caches.open(DATA_CACHE);
      const r = await c.match(DATA_URL);
      if (r) { const d = await r.json(); if (d && d.users && d.users.berke && d.users.melis) return d; }
    } catch (e) {}
    return blank();
  }
  // Writes are chained so they always land in order.
  let writing = Promise.resolve();
  function save() {
    if (!hasCache()) return;
    const body = JSON.stringify(db);
    writing = writing.then(async () => {
      try {
        const c = await caches.open(DATA_CACHE);
        await c.put(DATA_URL, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
      } catch (e) {}
    });
  }
  let db = blank();
  // Validate imported/loaded data: ids must be simple tokens.
  const okId = (v) => typeof v === 'string' && /^[a-z0-9]{1,40}$/i.test(v);
  function sanitize(d) {
    try {
      return ['berke', 'melis'].every((k) => {
        const u = d.users[k];
        if (!Array.isArray(u.workouts) || !Array.isArray(u.sessions)) return false;
        return u.workouts.every((w) => okId(w.id) && Array.isArray(w.exercises) && w.exercises.every((e) => okId(e.id)))
          && u.sessions.every((s) => okId(s.id));
      });
    } catch (e) { return false; }
  }

  const USERS = { berke: 'Berke', melis: 'Melis' };
  const TYPES = ['Full Body', 'Push Day', 'Pull Day', 'Leg Day', 'Cardio', 'Core'];
  const SUGGEST = {
    'Full Body': ['Squat', 'Deadlift', 'Bench Press', 'Overhead Press', 'Barbell Row', 'Lunges'],
    'Push Day': ['Bench Press', 'Incline DB Press', 'Overhead Press', 'Lateral Raise', 'Triceps Pushdown', 'Dips'],
    'Pull Day': ['Pull-up', 'Lat Pulldown', 'Barbell Row', 'Seated Cable Row', 'Face Pull', 'Biceps Curl'],
    'Leg Day': ['Squat', 'Romanian Deadlift', 'Leg Press', 'Leg Curl', 'Leg Extension', 'Calf Raise'],
    'Cardio': ['Treadmill', 'Rowing', 'Cycling', 'Stair Climber', 'Jump Rope', 'Elliptical'],
    'Core': ['Plank', 'Crunches', 'Hanging Leg Raise', 'Cable Crunch', 'Russian Twist', 'Ab Wheel'],
  };

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const me = () => db.users[db.current];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n >= 0 ? n : 0; };
  const fmtKg = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');
  const volOf = (exs) => exs.reduce((a, e) => a + num(e.kg) * num(e.sets) * num(e.reps), 0);
  const fmtBig = (n) => n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : fmtKg(n);
  const fmtDur = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (x) => String(x).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  };
  const fmtMin = (sec) => { const m = Math.round(sec / 60); return m >= 600 ? `${Math.floor(m / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtClock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const icon = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
  };

  // ---------- UI state ----------
  const ui = { tab: 'workouts', workoutId: null, range: 'week', offset: 0, metric: 'volume', exercise: null, timerWorkout: null };
  const $app = document.getElementById('app');
  const $tabbar = document.getElementById('tabbar');
  const $sheet = document.getElementById('sheet-root');
  let tick = null;

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- Sheets ----------
  function openSheet(html, mount) {
    $sheet.innerHTML = `<div class="sheet-backdrop" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
    $sheet.querySelector('[data-close]').onclick = closeSheet;
    mount && mount($sheet.querySelector('.sheet'));
  }
  function closeSheet() { $sheet.innerHTML = ''; }
  function confirmSheet(title, text, label, onYes) {
    openSheet(`<h2>${esc(title)}</h2><p class="muted" style="margin-top:-8px">${esc(text)}</p>
      <div class="sheet-actions"><button class="btn danger" data-yes>${esc(label)}</button><button class="btn ghost" data-no>Cancel</button></div>`,
      (s) => { s.querySelector('[data-yes]').onclick = () => { closeSheet(); onYes(); }; s.querySelector('[data-no]').onclick = closeSheet; });
  }

  // ---------- Router ----------
  function render() {
    clearInterval(tick); tick = null;
    if (!db.current || !db.users[db.current]) { $tabbar.hidden = true; return renderLogin(); }
    $tabbar.hidden = false;
    $tabbar.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    if (ui.tab === 'workouts') return ui.workoutId ? renderWorkout() : renderWorkouts();
    if (ui.tab === 'progress') return renderProgress();
    if (ui.tab === 'timer') return renderTimer();
  }
  $tabbar.addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    if (ui.tab === b.dataset.tab && b.dataset.tab === 'workouts') ui.workoutId = null;
    ui.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
  });

  function header(eyebrow, title, right = '') {
    return `<div class="top"><div><div class="eyebrow">${eyebrow}</div><h1 class="title">${title}</h1></div>${right}</div>`;
  }
  const avatarBtn = () => `<button class="avatar" data-profile aria-label="Switch user">${USERS[db.current][0]}</button>`;
  function bindAvatar() {
    const a = $app.querySelector('[data-profile]'); if (a) a.onclick = profileSheet;
  }

  // ---------- Login ----------
  function renderLogin() {
    $app.innerHTML = `<div class="login">
      <div><div class="brand">BMG.</div><div class="brand-sub">Train. Log. Progress.</div></div>
      <div><div class="who">Who's training?</div><div class="user-pick">
        ${Object.entries(USERS).map(([k, n]) => {
          const u = db.users[k];
          return `<button class="user-btn" data-user="${k}"><span>${n}<small>${u.workouts.length} workouts · ${u.sessions.length} sessions</small></span><span class="arrow">→</span></button>`;
        }).join('')}
      </div></div></div>`;
    $app.querySelectorAll('[data-user]').forEach((b) => b.onclick = () => {
      db.current = b.dataset.user; save(); ui.tab = 'workouts'; ui.workoutId = null; ui.exercise = null; ui.timerWorkout = null; render();
    });
  }

  function profileSheet() {
    const other = db.current === 'berke' ? 'melis' : 'berke';
    openSheet(`<h2>${USERS[db.current]}</h2>
      <div class="sheet-actions">
        <button class="btn" data-switch>Switch to ${USERS[other]}</button>
        <button class="btn ghost" data-out>Sign out</button>
        <button class="btn ghost" data-export>Export backup</button>
        <label class="btn ghost" style="cursor:pointer">Import backup<input type="file" accept="application/json" hidden data-import></label>
      </div>`, (s) => {
      s.querySelector('[data-switch]').onclick = () => { db.current = other; save(); closeSheet(); ui.workoutId = null; ui.exercise = null; ui.timerWorkout = null; render(); toast(`Hi ${USERS[other]}`); };
      s.querySelector('[data-out]').onclick = () => { db.current = null; save(); closeSheet(); render(); };
      s.querySelector('[data-export]').onclick = () => {
        const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `bmg-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
      s.querySelector('[data-import]').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (!data.users || !data.users.berke || !data.users.melis) throw new Error();
          if (!sanitize(data)) throw new Error();
          const cur = db.current; db = data; db.current = cur; save(); closeSheet(); render(); toast('Backup restored');
        } catch { toast('Invalid backup file'); }
      };
    });
  }

  // ---------- Workouts list ----------
  function renderWorkouts() {
    const u = me();
    const list = u.workouts.map((w) => {
      const last = u.sessions.filter((s) => s.workoutId === w.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      return `<button class="card" data-w="${esc(w.id)}">
        <div class="card-row"><span class="chip">${esc(w.type)}</span><span class="chev">›</span></div>
        <div class="card-title" style="margin-top:12px">${esc(w.name)}</div>
        <div class="card-meta">${w.exercises.length} exercise${w.exercises.length === 1 ? '' : 's'} · ${fmtBig(volOf(w.exercises))} kg volume${last ? ' · last ' + fmtDate(last.date) : ''}</div>
      </button>`;
    }).join('');
    $app.innerHTML = `<div class="screen">
      ${header(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), 'Workouts', avatarBtn())}
      ${u.workouts.length ? `<div class="list">${list}</div>` :
        `<div class="empty"><h4>No workouts yet</h4><p>Create your first split to start logging.</p><button class="btn sm" data-add style="margin:0 auto">New workout</button></div>`}
      </div>
      <button class="fab" data-add aria-label="Add workout">${icon.plus}</button>`;
    bindAvatar();
    $app.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => workoutSheet());
    $app.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => { ui.workoutId = b.dataset.w; render(); window.scrollTo(0, 0); });
  }

  function workoutSheet(w) {
    let type = w ? w.type : TYPES[0];
    openSheet(`<h2>${w ? 'Edit workout' : 'New workout'}</h2>
      <div class="field"><label>Type</label><div class="type-grid">${TYPES.map((t) => `<button class="type-opt ${t === type ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div></div>
      <div class="field"><label>Name</label><input class="input" data-name maxlength="40" placeholder="${esc(type)}" value="${w ? esc(w.name) : ''}"></div>
      <div class="sheet-actions"><button class="btn" data-save>${w ? 'Save changes' : 'Create workout'}</button>
      ${w ? '<button class="btn danger" data-del>Delete workout</button>' : '<button class="btn ghost" data-cancel>Cancel</button>'}</div>`, (s) => {
      const name = s.querySelector('[data-name]');
      s.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
        const prev = type; type = b.dataset.t;
        s.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
        name.placeholder = type; if (name.value === prev) name.value = '';
      });
      s.querySelector('[data-save]').onclick = () => {
        const nm = name.value.trim() || type;
        if (w) { w.name = nm; w.type = type; }
        else { const nw = { id: uid(), name: nm, type, createdAt: new Date().toISOString(), exercises: [] }; me().workouts.unshift(nw); ui.workoutId = nw.id; }
        save(); closeSheet(); render(); toast(w ? 'Saved' : 'Workout created');
      };
      const c = s.querySelector('[data-cancel]'); if (c) c.onclick = closeSheet;
      const d = s.querySelector('[data-del]'); if (d) d.onclick = () => confirmSheet('Delete workout?', `"${w.name}" and its exercises will be removed. Logged sessions stay in your history.`, 'Delete', () => {
        me().workouts = me().workouts.filter((x) => x.id !== w.id); ui.workoutId = null; save(); render(); toast('Workout deleted');
      });
    });
  }

  // ---------- Workout detail ----------
  function renderWorkout() {
    const w = me().workouts.find((x) => x.id === ui.workoutId);
    if (!w) { ui.workoutId = null; return render(); }
    const rows = w.exercises.map((e) => `<button class="card ex-row" data-e="${esc(e.id)}">
        <span class="ex-name">${esc(e.name)}</span>
        <span class="ex-stats"><span class="ex-stat"><b>${fmtKg(num(e.kg))}</b><i>kg</i></span><span class="ex-stat"><b>${num(e.sets)}</b><i>sets</i></span><span class="ex-stat"><b>${num(e.reps)}</b><i>reps</i></span></span>
      </button>`).join('');
    $app.innerHTML = `<div class="screen">
      <div class="top"><button class="icon-btn" data-back aria-label="Back">${icon.back}</button><button class="icon-btn" data-edit aria-label="Edit workout">${icon.more}</button></div>
      <span class="chip solid">${esc(w.type)}</span>
      <h1 class="title" style="margin-top:12px">${esc(w.name)}</h1>
      <div class="card-meta">${w.exercises.length} exercises · ${fmtBig(volOf(w.exercises))} kg total volume</div>
      <div class="row-gap mt"><button class="btn" data-start>Start timer</button></div>
      <div class="section-head"><h3>Exercises</h3><span>Tap to edit</span></div>
      <div class="list">${rows}<button class="add-btn" data-add>${'+'} Add exercise</button></div>
    </div>`;
    $app.querySelector('[data-back]').onclick = () => { ui.workoutId = null; render(); };
    $app.querySelector('[data-edit]').onclick = () => workoutSheet(w);
    $app.querySelector('[data-add]').onclick = () => exerciseSheet(w);
    $app.querySelector('[data-start]').onclick = () => { ui.timerWorkout = w.id; ui.tab = 'timer'; render(); };
    $app.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => exerciseSheet(w, w.exercises.find((x) => x.id === b.dataset.e)));
  }

  function stepper(key, val, step) {
    return `<div class="stepper"><button data-dec="${key}" data-step="${step}" aria-label="decrease">−</button><input data-f="${key}" inputmode="decimal" value="${val}"><button data-inc="${key}" data-step="${step}" aria-label="increase">+</button></div>`;
  }
  function exerciseSheet(w, e) {
    const sug = (SUGGEST[w.type] || []).filter((n) => !w.exercises.some((x) => x.name.toLowerCase() === n.toLowerCase()));
    openSheet(`<h2>${e ? 'Edit exercise' : 'Add exercise'}</h2>
      <div class="field"><label>Exercise</label><input class="input" data-f="name" maxlength="40" placeholder="e.g. Bench Press" value="${e ? esc(e.name) : ''}">
        ${!e && sug.length ? `<div class="suggest">${sug.map((n) => `<button data-sug="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}</div>
      <div class="grid3">
        <div class="field"><label>KG</label>${stepper('kg', e ? num(e.kg) : 20, 2.5)}</div>
        <div class="field"><label>Sets</label>${stepper('sets', e ? num(e.sets) : 3, 1)}</div>
        <div class="field"><label>Reps</label>${stepper('reps', e ? num(e.reps) : 10, 1)}</div>
      </div>
      <div class="sheet-actions"><button class="btn" data-save>${e ? 'Save changes' : 'Add to workout'}</button>
      ${e ? '<button class="btn danger" data-del>Delete exercise</button>' : '<button class="btn ghost" data-cancel>Cancel</button>'}</div>`, (s) => {
      const f = (k) => s.querySelector(`[data-f="${k}"]`);
      s.querySelectorAll('[data-sug]').forEach((b) => b.onclick = () => { f('name').value = b.dataset.sug; });
      s.querySelectorAll('[data-inc],[data-dec]').forEach((b) => b.onclick = () => {
        const k = b.dataset.inc || b.dataset.dec, st = parseFloat(b.dataset.step);
        const v = Math.max(0, num(f(k).value) + (b.dataset.inc ? st : -st));
        f(k).value = Math.round(v * 100) / 100;
      });
      s.querySelector('[data-save]').onclick = () => {
        const name = f('name').value.trim();
        if (!name) { f('name').focus(); toast('Add an exercise name'); return; }
        const vals = { name, kg: num(f('kg').value), sets: Math.round(num(f('sets').value)), reps: Math.round(num(f('reps').value)) };
        const changed = !e || e.kg !== vals.kg || e.sets !== vals.sets || e.reps !== vals.reps;
        const target = e || { id: uid(), history: [] };
        Object.assign(target, vals);
        target.history = target.history || [];
        if (changed) target.history.push({ d: new Date().toISOString(), kg: vals.kg, sets: vals.sets, reps: vals.reps });
        if (!e) w.exercises.push(target);
        save(); closeSheet(); render(); toast(e ? 'Saved' : 'Exercise added');
      };
      const c = s.querySelector('[data-cancel]'); if (c) c.onclick = closeSheet;
      const d = s.querySelector('[data-del]'); if (d) d.onclick = () => confirmSheet('Delete exercise?', `"${e.name}" will be removed from this workout.`, 'Delete', () => {
        w.exercises = w.exercises.filter((x) => x.id !== e.id); save(); render(); toast('Exercise deleted');
      });
    });
  }

  // ---------- Progress ----------
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  function periodInfo() {
    const now = new Date(), o = ui.offset;
    if (ui.range === 'week') {
      const s = startOfDay(now); const dow = (s.getDay() + 6) % 7; s.setDate(s.getDate() - dow + o * 7);
      const e = new Date(s); e.setDate(e.getDate() + 7);
      const buckets = Array.from({ length: 7 }, (_, i) => { const a = new Date(s); a.setDate(a.getDate() + i); const b = new Date(a); b.setDate(b.getDate() + 1); return { a, b, label: 'MTWTFSS'[i] }; });
      const last = new Date(e - 1);
      const label = o === 0 ? 'This week' : o === -1 ? 'Last week' : `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
      return { s, e, buckets, label };
    }
    if (ui.range === 'month') {
      const s = new Date(now.getFullYear(), now.getMonth() + o, 1); const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      const days = Math.round((e - s) / 864e5); const buckets = [];
      for (let d = 1; d <= days; d += 7) {
        const a = new Date(s.getFullYear(), s.getMonth(), d); const endD = Math.min(d + 6, days);
        buckets.push({ a, b: new Date(s.getFullYear(), s.getMonth(), endD + 1), label: `${d}–${endD}` });
      }
      return { s, e, buckets, label: s.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
    }
    const y = now.getFullYear() + o; const s = new Date(y, 0, 1), e = new Date(y + 1, 0, 1);
    const buckets = Array.from({ length: 12 }, (_, i) => ({ a: new Date(y, i, 1), b: new Date(y, i + 1, 1), label: 'JFMAMJJASOND'[i] }));
    return { s, e, buckets, label: String(y) };
  }
  const metricOf = (list) => ui.metric === 'volume' ? list.reduce((a, s) => a + (s.volume || 0), 0)
    : ui.metric === 'time' ? Math.round(list.reduce((a, s) => a + (s.duration || 0), 0) / 60) : list.length;

  function barChart(buckets, values) {
    const W = 340, H = 190, pl = 6, pr = 6, pt = 22, pb = 26;
    const max = Math.max(...values, 0);
    const n = buckets.length, gap = n > 8 ? 6 : 10, bw = (W - pl - pr - gap * (n - 1)) / n;
    const unit = ui.metric === 'volume' ? 'kg' : ui.metric === 'time' ? 'min' : '';
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress chart">`;
    [0.5, 1].forEach((f) => { const y = pt + (H - pt - pb) * (1 - f); out += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="#1f1f1f" stroke-dasharray="2 4"/>`; });
    buckets.forEach((b, i) => {
      const x = pl + i * (bw + gap), v = values[i], h = max ? (H - pt - pb) * v / max : 0;
      out += `<rect x="${x}" y="${pt}" width="${bw}" height="${H - pt - pb}" rx="${Math.min(6, bw / 2)}" fill="#141414"/>`;
      if (h > 0) out += `<rect class="bar" x="${x}" y="${H - pb - h}" width="${bw}" height="${h}" rx="${Math.min(6, bw / 2)}" fill="#fff"/>`;
      if (v > 0 && v === max) out += `<text x="${x + bw / 2}" y="${H - pb - h - 7}" fill="#fff" font-size="10" font-weight="700" text-anchor="middle">${fmtBig(v)}${unit && n <= 7 ? ' ' + unit : ''}</text>`;
      out += `<text x="${x + bw / 2}" y="${H - 8}" fill="#666" font-size="${n > 7 ? 9 : 10}" font-weight="600" text-anchor="middle">${b.label}</text>`;
    });
    return out + '</svg>';
  }

  function lineChart(points) {
    if (!points.length) return `<div class="nodata">No weight data for this period</div>`;
    const W = 340, H = 170, pl = 30, pr = 14, pt = 18, pb = 26;
    const xs = points.map((p) => +new Date(p.d)), ys = points.map((p) => p.kg);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y0 === y1) { y0 = Math.max(0, y0 - 5); y1 = y1 + 5; }
    const X = (t) => x1 === x0 ? (pl + W - pr) / 2 : pl + (W - pl - pr) * (t - x0) / (x1 - x0);
    const Y = (v) => pt + (H - pt - pb) * (1 - (v - y0) / (y1 - y0));
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(+new Date(p.d)).toFixed(1)},${Y(p.kg).toFixed(1)}`).join(' ');
    const area = `${path} L${X(xs[xs.length - 1]).toFixed(1)},${H - pb} L${X(xs[0]).toFixed(1)},${H - pb} Z`;
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Exercise weight chart"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`;
    [y0, (y0 + y1) / 2, y1].forEach((v) => { out += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1f1f1f" stroke-dasharray="2 4"/><text x="${pl - 6}" y="${Y(v) + 3}" fill="#666" font-size="9" text-anchor="end">${fmtKg(v)}</text>`; });
    if (points.length > 1) out += `<path d="${area}" fill="url(#g)"/><path d="${path}" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    points.forEach((p) => { out += `<circle cx="${X(+new Date(p.d))}" cy="${Y(p.kg)}" r="3.5" fill="#000" stroke="#fff" stroke-width="2"/>`; });
    const fd = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    out += `<text x="${pl}" y="${H - 6}" fill="#666" font-size="9">${fd(x0)}</text>`;
    if (x1 !== x0) out += `<text x="${W - pr}" y="${H - 6}" fill="#666" font-size="9" text-anchor="end">${fd(x1)}</text>`;
    return out + '</svg>';
  }

  function exerciseHistory(name) {
    const key = name.toLowerCase(), pts = [];
    me().workouts.forEach((w) => w.exercises.forEach((e) => { if (e.name.toLowerCase() === key) (e.history || []).forEach((h) => pts.push(h)); }));
    me().sessions.forEach((s) => (s.exercises || []).forEach((e) => { if (e.name.toLowerCase() === key) pts.push({ d: s.date, kg: num(e.kg) }); }));
    // one point per day: heaviest weight that day
    const byDay = {};
    pts.forEach((h) => { const k = new Date(h.d).toDateString(); if (!byDay[k] || h.kg > byDay[k].kg) byDay[k] = { d: h.d, kg: h.kg }; });
    return Object.values(byDay).sort((a, b) => a.d.localeCompare(b.d));
  }

  function renderProgress() {
    const u = me(), p = periodInfo();
    const inP = u.sessions.filter((s) => { const d = new Date(s.date); return d >= p.s && d < p.e; });
    const values = p.buckets.map((b) => metricOf(inP.filter((s) => { const d = new Date(s.date); return d >= b.a && d < b.b; })));
    const names = [...new Set([...u.workouts.flatMap((w) => w.exercises.map((e) => e.name)), ...u.sessions.flatMap((s) => (s.exercises || []).map((e) => e.name))])]
      .filter((n, i, a) => a.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i).sort();
    if (!ui.exercise || !names.some((n) => n.toLowerCase() === ui.exercise.toLowerCase())) ui.exercise = names[0] || null;
    const pts = ui.exercise ? exerciseHistory(ui.exercise).filter((h) => { const d = new Date(h.d); return d >= p.s && d < p.e; }) : [];
    const best = pts.length ? Math.max(...pts.map((x) => x.kg)) : 0;
    const delta = pts.length > 1 ? pts[pts.length - 1].kg - pts[0].kg : 0;
    const totalVol = inP.reduce((a, s) => a + (s.volume || 0), 0), totalTime = inP.reduce((a, s) => a + (s.duration || 0), 0);

    $app.innerHTML = `<div class="screen">
      ${header('Your stats', 'Progress', avatarBtn())}
      <div class="seg" data-seg="range">${[['week', 'Week'], ['month', 'Month'], ['year', 'Year']].map(([k, l]) => `<button data-v="${k}" class="${ui.range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="period"><button class="icon-btn" data-prev aria-label="Previous period">${icon.left}</button><b>${p.label}</b><button class="icon-btn" data-next aria-label="Next period" ${ui.offset >= 0 ? 'disabled style="opacity:.25"' : ''}>${icon.right}</button></div>
      <div class="stats">
        <div class="stat"><b>${inP.length}</b><i>Sessions</i></div>
        <div class="stat"><b>${fmtMin(totalTime)}</b><i>Time</i></div>
        <div class="stat"><b>${fmtBig(totalVol)}</b><i>KG lifted</i></div>
      </div>
      <div class="chart-card">
        <div class="ch-head"><span class="eyebrow">Activity</span>
          <div class="seg small" data-seg="metric" style="width:210px">${[['volume', 'Volume'], ['time', 'Time'], ['count', 'Sessions']].map(([k, l]) => `<button data-v="${k}" class="${ui.metric === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${inP.length ? barChart(p.buckets, values) : `<div class="nodata">No sessions logged in this period.<br>Finish a timer to log one.</div>`}
      </div>
      <div class="section-head"><h3>Exercise strength</h3></div>
      <div class="chart-card">
        ${names.length ? `<div class="ch-head"><select class="select" data-ex aria-label="Exercise">${names.map((n) => `<option ${n === ui.exercise ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
          <span class="muted" style="font-size:13px">Best <b style="color:#fff">${fmtKg(best)} kg</b>${delta ? ` · ${delta > 0 ? '+' : ''}${fmtKg(delta)}` : ''}</span></div>${lineChart(pts)}`
        : `<div class="nodata">Add exercises to track weight progress</div>`}
      </div>
    </div>`;
    bindAvatar();
    $app.querySelectorAll('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.onclick = () => {
      if (seg.dataset.seg === 'range') { ui.range = b.dataset.v; ui.offset = 0; } else ui.metric = b.dataset.v;
      render();
    }));
    $app.querySelector('[data-prev]').onclick = () => { ui.offset--; render(); };
    $app.querySelector('[data-next]').onclick = () => { if (ui.offset < 0) { ui.offset++; render(); } };
    const ex = $app.querySelector('[data-ex]'); if (ex) ex.onchange = () => { ui.exercise = ex.value; render(); };
  }

  // ---------- Timer ----------
  const elapsed = (t) => t ? (t.acc || 0) + (t.running ? (Date.now() - t.startedAt) / 1000 : 0) : 0;
  function renderTimer() {
    const u = me(), t = u.timer;
    if (t && t.workoutId) ui.timerWorkout = t.workoutId;
    if (!ui.timerWorkout || !u.workouts.some((w) => w.id === ui.timerWorkout)) ui.timerWorkout = u.workouts[0]?.id || null;
    const w = u.workouts.find((x) => x.id === ui.timerWorkout);
    const logs = [...u.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    const state = !t ? 'idle' : t.running ? 'running' : 'paused';
    const C = 2 * Math.PI * 120;

    $app.innerHTML = `<div class="screen">
      ${header('Session', 'Timer', avatarBtn())}
      ${!u.workouts.length ? `<div class="empty"><h4>No workouts to time</h4><p>Create a workout first, then start the timer.</p><button class="btn sm" data-goto style="margin:0 auto">Go to workouts</button></div>` : `
      <div class="wk-scroll">${u.workouts.map((x) => `<button class="wk-pill ${x.id === ui.timerWorkout ? 'on' : ''}" data-pick="${esc(x.id)}" ${t && x.id !== t.workoutId ? 'disabled style="opacity:.35"' : ''}>${esc(x.name)}</button>`).join('')}</div>
      <div class="timer-face">
        <div class="ring ${state === 'running' ? 'running' : ''}">
          <svg viewBox="0 0 260 260"><circle cx="130" cy="130" r="120" fill="none" stroke="#161616" stroke-width="2"/>
            <circle class="pulse" data-arc cx="130" cy="130" r="120" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 130 130)"/></svg>
          <div><div class="timer-digits" data-digits>${fmtDur(elapsed(t))}</div><div class="timer-sub">${state === 'idle' ? 'Ready' : state === 'running' ? 'Training' : 'Paused'} · ${esc(w ? w.type : '')}</div></div>
        </div>
      </div>
      <div class="timer-controls">
        ${state === 'idle' ? `<button class="btn" data-start style="grid-column:1/-1">Start ${esc(w ? w.name : '')}</button>` :
          `<button class="btn ghost" data-toggle>${state === 'running' ? 'Pause' : 'Resume'}</button><button class="btn" data-finish>Finish & save</button>
           <button class="btn ghost" data-discard style="grid-column:1/-1;height:44px;font-size:14px;color:#888">Discard</button>`}
      </div>`}
      <div class="section-head"><h3>Time log</h3><span>${u.sessions.length} total</span></div>
      ${logs.length ? `<div class="list">${logs.map((s) => `<button class="card log-row" data-log="${esc(s.id)}">
          <span><span class="ex-name">${esc(s.name)}</span><div class="card-meta">${fmtDate(s.date)} · ${fmtClock(s.date)} · ${fmtBig(s.volume || 0)} kg</div></span>
          <span class="log-time">${fmtDur(s.duration)}</span></button>`).join('')}</div>`
        : `<div class="empty" style="padding:32px 20px"><p style="margin:0">Finished sessions appear here.</p></div>`}
    </div>`;
    bindAvatar();
    const g = $app.querySelector('[data-goto]'); if (g) g.onclick = () => { ui.tab = 'workouts'; render(); };
    $app.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { if (!t) { ui.timerWorkout = b.dataset.pick; render(); } });
    const st = $app.querySelector('[data-start]'); if (st) st.onclick = () => { u.timer = { workoutId: ui.timerWorkout, startedAt: Date.now(), acc: 0, running: true, began: new Date().toISOString() }; save(); render(); };
    const tg = $app.querySelector('[data-toggle]'); if (tg) tg.onclick = () => {
      if (t.running) { t.acc = elapsed(t); t.running = false; } else { t.startedAt = Date.now(); t.running = true; }
      save(); render();
    };
    const fin = $app.querySelector('[data-finish]'); if (fin) fin.onclick = () => {
      const dur = Math.round(elapsed(t));
      if (dur < 1) { toast('Timer too short'); return; }
      const wk = u.workouts.find((x) => x.id === t.workoutId);
      const exs = wk ? wk.exercises.map((e) => ({ name: e.name, kg: num(e.kg), sets: num(e.sets), reps: num(e.reps) })) : [];
      u.sessions.push({ id: uid(), workoutId: t.workoutId, name: wk ? wk.name : 'Workout', type: wk ? wk.type : '', date: t.began || new Date().toISOString(), duration: dur, volume: volOf(exs), exercises: exs });
      u.timer = null; save(); render(); toast(`Saved · ${fmtDur(dur)}`);
    };
    const dc = $app.querySelector('[data-discard]'); if (dc) dc.onclick = () => confirmSheet('Discard timer?', 'This session will not be saved.', 'Discard', () => { u.timer = null; save(); render(); });
    $app.querySelectorAll('[data-log]').forEach((b) => b.onclick = () => {
      const s = u.sessions.find((x) => x.id === b.dataset.log);
      openSheet(`<h2>${esc(s.name)}</h2><p class="muted" style="margin-top:-10px">${fmtDate(s.date)} · ${fmtClock(s.date)} · ${fmtDur(s.duration)}</p>
        <div class="list">${(s.exercises || []).map((e) => `<div class="card ex-row"><span class="ex-name">${esc(e.name)}</span><span class="muted">${fmtKg(num(e.kg))} kg · ${num(e.sets)}×${num(e.reps)}</span></div>`).join('') || '<p class="muted">No exercises recorded.</p>'}</div>
        <div class="sheet-actions"><button class="btn ghost" data-close2>Close</button><button class="btn danger" data-dl>Delete log</button></div>`, (sh) => {
        sh.querySelector('[data-close2]').onclick = closeSheet;
        sh.querySelector('[data-dl]').onclick = () => confirmSheet('Delete log?', 'This session will be removed from your progress.', 'Delete', () => {
          u.sessions = u.sessions.filter((x) => x.id !== s.id); save(); render(); toast('Log deleted');
        });
      });
    });
    if (state !== 'idle') {
      const dg = $app.querySelector('[data-digits]'), arc = $app.querySelector('[data-arc]');
      const upd = () => { const e = elapsed(u.timer); dg.textContent = fmtDur(e); arc.setAttribute('stroke-dashoffset', C * (1 - (e % 60) / 60)); };
      upd(); if (state === 'running') tick = setInterval(upd, 250);
    }
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.tab === 'timer') render(); });

  load().then((d) => {
    db = d; render();
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
  }
})();
