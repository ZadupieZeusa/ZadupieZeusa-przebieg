// Przebieg — rdzeń: odczyt FIT i wszystkie obliczenia biegowe.
// Bez DOM i bez sieci, żeby dało się to testować i przeliczać w dowolnym miejscu.

export const ENGINE_VERSION = 1; // podbij, gdy zmienia się sposób liczenia → aplikacja zaproponuje przeliczenie

// Dystanse, dla których szukamy najlepszych odcinków (w metrach)
export const BEST_DISTANCES = [
  { m: 400, label: '400 m' },
  { m: 1000, label: '1 km' },
  { m: 1609.344, label: '1 mila' },
  { m: 3000, label: '3 km' },
  { m: 5000, label: '5 km' },
  { m: 10000, label: '10 km' },
  { m: 15000, label: '15 km' },
  { m: 21097.5, label: 'Półmaraton' },
  { m: 30000, label: '30 km' },
  { m: 42195, label: 'Maraton' },
];

const SEMI = 180 / 2 ** 31;
const RUN_SPORTS = new Set(['running', 'trailRunning', 'treadmillRunning']);

export function isRun(a) { return a && (a.sport === 'running' || RUN_SPORTS.has(a.sport)); }

// ── ODCZYT FIT ──────────────────────────────────────────────────────────────
// fit = moduł @garmin/fitsdk ({Decoder, Stream}); podawany z zewnątrz.
export function parseFit(arrayBuffer, fit) {
  const stream = fit.Stream.fromArrayBuffer(arrayBuffer);
  const dec = new fit.Decoder(stream);
  if (!dec.isFIT()) throw new Error('To nie jest plik FIT');
  const { messages, errors } = dec.read({ includeUnknownData: false, mergeHeartRates: true });
  const recs = (messages.recordMesgs || []).filter(r => r.timestamp instanceof Date);
  if (!recs.length) throw new Error(errors?.[0]?.message || 'Plik FIT nie zawiera zapisu trasy ani czasu');
  const ses = (messages.sessionMesgs || [])[0] || {};
  const fileId = (messages.fileIdMesgs || [])[0] || {};
  const sportMsg = (messages.sportMesgs || [])[0] || {};
  const start = (ses.startTime instanceof Date ? ses.startTime : recs[0].timestamp).getTime();

  // Przerwy stopera (auto-pauza, ręczne zatrzymanie) z eventów timer
  const pauses = [];
  let stopAt = null;
  for (const e of messages.eventMesgs || []) {
    if (e.event !== 'timer' || !(e.timestamp instanceof Date)) continue;
    const ts = e.timestamp.getTime();
    if (e.eventType === 'stop' || e.eventType === 'stopAll' || e.eventType === 'stopDisable' || e.eventType === 'stopDisableAll') {
      if (stopAt == null) stopAt = ts;
    } else if (e.eventType === 'start' && stopAt != null) {
      if (ts > stopAt) pauses.push([stopAt, ts]);
      stopAt = null;
    }
  }

  const n = recs.length;
  const P = { ts: new Float64Array(n), lat: new Array(n), lon: new Array(n), d: new Array(n), ele: new Array(n), hr: new Array(n), cad: new Array(n), spd: new Array(n) };
  for (let i = 0; i < n; i++) {
    const r = recs[i];
    P.ts[i] = r.timestamp.getTime();
    P.lat[i] = Number.isFinite(r.positionLat) ? r.positionLat * SEMI : null;
    P.lon[i] = Number.isFinite(r.positionLong) ? r.positionLong * SEMI : null;
    P.d[i] = Number.isFinite(r.distance) ? r.distance : null;
    const alt = Number.isFinite(r.enhancedAltitude) ? r.enhancedAltitude : r.altitude;
    P.ele[i] = Number.isFinite(alt) ? alt : null;
    P.hr[i] = Number.isFinite(r.heartRate) && r.heartRate > 0 ? r.heartRate : null;
    // kadencja biegowa w FIT jest "na nogę" → kroki/min = ×2 (+ część ułamkowa)
    const c = Number.isFinite(r.cadence) ? r.cadence + (Number.isFinite(r.fractionalCadence) ? r.fractionalCadence : 0) : null;
    P.cad[i] = c;
    const s = Number.isFinite(r.enhancedSpeed) ? r.enhancedSpeed : r.speed;
    P.spd[i] = Number.isFinite(s) ? s : null;
  }

  return {
    start,
    sport: ses.sport || sportMsg.sport || 'generic',
    subSport: ses.subSport || sportMsg.subSport || null,
    device: [fileId.manufacturer, fileId.garminProduct || fileId.product].filter(Boolean).join(' '),
    session: {
      elapsed: ses.totalElapsedTime, timer: ses.totalTimerTime, distance: ses.totalDistance,
      ascent: ses.totalAscent, descent: ses.totalDescent, avgHr: ses.avgHeartRate, maxHr: ses.maxHeartRate,
      calories: ses.totalCalories, avgCad: ses.avgRunningCadence ?? ses.avgCadence,
    },
    laps: (messages.lapMesgs || []).map(l => ({
      start: l.startTime instanceof Date ? l.startTime.getTime() : null,
      time: l.totalTimerTime, distance: l.totalDistance, avgHr: l.avgHeartRate,
    })),
    pauses,
    points: P,
  };
}

// ── POMOCNICZE ──────────────────────────────────────────────────────────────
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Czas „stopera” w każdym punkcie: czas od startu minus przerwy (auto-pauza itp.)
function timerClock(ts, pauses) {
  const n = ts.length, tt = new Float64Array(n);
  const t0 = ts[0];
  if (pauses.length) {
    let pi = 0, paused = 0;
    for (let i = 0; i < n; i++) {
      while (pi < pauses.length && pauses[pi][1] <= ts[i]) { paused += pauses[pi][1] - pauses[pi][0]; pi++; }
      let inside = 0;
      if (pi < pauses.length && pauses[pi][0] < ts[i]) inside = ts[i] - pauses[pi][0];
      tt[i] = (ts[i] - t0 - paused - inside) / 1000;
    }
  } else {
    // brak eventów — heurystyka: długa dziura w zapisie bez ruchu = postój
    for (let i = 1; i < n; i++) {
      const dt = (ts[i] - ts[i - 1]) / 1000;
      tt[i] = tt[i - 1] + (dt > 30 ? Math.min(dt, 5) : dt);
    }
  }
  return tt;
}

// Uzupełnia dziury w dystansie (brak pola distance → z GPS)
function fillDistance(P) {
  const n = P.ts.length, d = new Float64Array(n);
  const hasD = P.d.filter(v => v != null).length > n * 0.5;
  if (hasD) {
    let last = 0;
    for (let i = 0; i < n; i++) { if (P.d[i] != null && P.d[i] >= last) last = P.d[i]; d[i] = last; }
    return d;
  }
  let lastLat = null, lastLon = null;
  for (let i = 0; i < n; i++) {
    d[i] = i ? d[i - 1] : 0;
    if (P.lat[i] != null && P.lon[i] != null) {
      if (lastLat != null) {
        const step = haversine(lastLat, lastLon, P.lat[i], P.lon[i]);
        if (step < 100) d[i] += step;   // skoki GPS ignorujemy
      }
      lastLat = P.lat[i]; lastLon = P.lon[i];
    }
  }
  return d;
}

// Przewyższenie z histerezą — filtruje szum wysokości
export function elevationGain(ele, threshold = 2) {
  let up = 0, down = 0, ref = null;
  for (const e of ele) {
    if (e == null) continue;
    if (ref == null) { ref = e; continue; }
    if (e - ref >= threshold) { up += e - ref; ref = e; }
    else if (ref - e >= threshold) { down += ref - e; ref = e; }
  }
  return { up, down };
}

// Czas (na zegarze tt) w miejscu, gdzie dystans osiąga wartość x — interpolacja między punktami
function timeAtDistance(d, tt, x, hint = 0) {
  let i = hint;
  while (i < d.length - 1 && d[i + 1] < x) i++;
  if (i >= d.length - 1) return { t: tt[d.length - 1], i: d.length - 1 };
  const span = d[i + 1] - d[i];
  const f = span > 0 ? (x - d[i]) / span : 0;
  return { t: tt[i] + f * (tt[i + 1] - tt[i]), i };
}

// ── NAJLEPSZE ODCINKI ───────────────────────────────────────────────────────
// Dla każdego dystansu: najszybszy fragment w całym biegu (okno przesuwne, O(n)).
export function bestEfforts(d, tt, distances = BEST_DISTANCES) {
  const total = d[d.length - 1];
  const out = {};
  for (const { m } of distances) {
    if (total + 0.5 < m) continue;
    let best = Infinity, bestStart = 0, bestEnd = 0;
    let i = 0;
    for (let j = 1; j < d.length; j++) {
      if (d[j] - d[0] < m) continue;
      const startDist = d[j] - m;
      while (i < j - 1 && d[i + 1] <= startDist) i++;
      const span = d[i + 1] - d[i];
      const f = span > 0 ? (startDist - d[i]) / span : 0;
      const tStart = tt[i] + f * (tt[i + 1] - tt[i]);
      const dur = tt[j] - tStart;
      if (dur > 0 && dur < best) { best = dur; bestStart = i; bestEnd = j; }
    }
    if (Number.isFinite(best)) out[m] = { time: Math.round(best * 10) / 10, i0: bestStart, i1: bestEnd };
  }
  return out;
}

// ── MIĘDZYCZASY ─────────────────────────────────────────────────────────────
export function computeSplits(d, tt, ele, hr, step = 1000) {
  const total = d[d.length - 1];
  const splits = [];
  let prevT = 0, prevI = 0, prevD = 0;
  for (let k = step; prevD < total; k += step) {
    const target = Math.min(k, total);
    const { t, i } = timeAtDistance(d, tt, target, prevI);
    const segEle = ele.slice(prevI, i + 2);
    const segHr = hr.slice(prevI, i + 2).filter(v => v != null);
    const { up, down } = elevationGain(segEle);
    const dist = target - prevD;
    splits.push({
      n: splits.length + 1,
      dist: Math.round(dist),
      time: Math.round((t - prevT) * 10) / 10,
      pace: dist > 0 ? ((t - prevT) / dist) * 1000 : null,
      hr: segHr.length ? Math.round(segHr.reduce((a, b) => a + b, 0) / segHr.length) : null,
      up: Math.round(up), down: Math.round(down),
    });
    prevT = t; prevI = i; prevD = target;
    if (target >= total) break;
  }
  // ostatni, bardzo krótki fragment (<50 m) dokładamy do poprzedniego
  if (splits.length > 1 && splits[splits.length - 1].dist < 50) {
    const last = splits.pop(), p = splits[splits.length - 1];
    p.time += last.time; p.dist += last.dist; p.pace = (p.time / p.dist) * 1000;
  }
  return splits;
}

// Douglas–Peucker na płasko (do miniaturek i map zbiorczych)
export function simplifyRoute(pts, tolerance) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const dd = ex * ex + ey * ey;
      if (dd > maxD) { maxD = dd; idx = i; }
    }
    if (idx > 0 && maxD > tolerance * tolerance) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ── PRZETWORZENIE CAŁEGO TRENINGU ───────────────────────────────────────────
// Zwraca { summary, streams }: summary trafia do bazy na Drive, streams tylko do lokalnego cache.
export function buildActivity(parsed, extra = {}) {
  const P = parsed.points;
  const n = P.ts.length;
  const tt = timerClock(P.ts, parsed.pauses);
  const d = fillDistance(P);
  const total = d[n - 1];

  // wygładzona wysokość (średnia krocząca 5 pkt)
  const ele = P.ele.map((_, i) => {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (P.ele[k] != null) { s += P.ele[k]; c++; }
    return c ? s / c : null;
  });
  const gain = elevationGain(ele);
  const S = parsed.session || {};
  const timer = Number.isFinite(S.timer) ? S.timer : tt[n - 1];
  const elapsed = Number.isFinite(S.elapsed) ? S.elapsed : (P.ts[n - 1] - P.ts[0]) / 1000;
  const distance = Number.isFinite(S.distance) && S.distance > 0 ? S.distance : total;

  const hrs = P.hr.filter(v => v != null);
  const cads = P.cad.filter(v => v != null && v > 30);
  const run = RUN_SPORTS.has(parsed.sport);

  const efforts = run ? bestEfforts(d, tt) : {};
  const splits = computeSplits(d, tt, ele, P.hr);

  // trasa uproszczona (stopnie) — miniaturki, mapa zbiorcza
  const gps = [];
  for (let i = 0; i < n; i++) if (P.lat[i] != null && P.lon[i] != null) gps.push([P.lon[i], P.lat[i]]);
  const route = simplifyRoute(gps, 0.00012).map(([x, y]) => [Math.round(y * 1e5) / 1e5, Math.round(x * 1e5) / 1e5]);

  const id = 'r' + parsed.start.toString(36);
  const summary = {
    id,
    start: parsed.start,
    sport: parsed.sport,
    subSport: parsed.subSport,
    device: parsed.device || null,
    distance: Math.round(distance),
    timer: Math.round(timer),
    elapsed: Math.round(elapsed),
    pace: distance > 0 ? (timer / distance) * 1000 : null,
    ascent: Math.round(Number.isFinite(S.ascent) ? S.ascent : gain.up),
    descent: Math.round(Number.isFinite(S.descent) ? S.descent : gain.down),
    avgHr: Number.isFinite(S.avgHr) ? S.avgHr : hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: Number.isFinite(S.maxHr) ? S.maxHr : hrs.length ? Math.max(...hrs) : null,
    cadence: cads.length ? Math.round((cads.reduce((a, b) => a + b, 0) / cads.length) * (run ? 2 : 1)) : null,
    calories: Number.isFinite(S.calories) ? S.calories : null,
    hasGps: gps.length > 10,
    bests: Object.fromEntries(Object.entries(efforts).map(([m, e]) => [m, e.time])),
    splits,
    route,
    engine: ENGINE_VERSION,
    ...extra,
  };

  // strumienie do wykresów: co ok. 2 s, max ~3000 punktów
  const stride = Math.max(1, Math.ceil(n / 3000));
  const idx = [];
  for (let i = 0; i < n; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  // tempo: prędkość z okna ±15 s czasu stopera
  const pace = idx.map(i => {
    let a = i, b = i;
    while (a > 0 && tt[i] - tt[a] < 15) a--;
    while (b < n - 1 && tt[b] - tt[i] < 15) b++;
    const dd = d[b] - d[a], dt = tt[b] - tt[a];
    return dd > 3 && dt > 0 ? (dt / dd) * 1000 : null;
  });
  const effortIdx = Object.fromEntries(Object.entries(efforts).map(([m, e]) => [m, [e.i0, e.i1]]));
  const streams = {
    id,
    t: idx.map(i => Math.round(tt[i])),
    d: idx.map(i => Math.round(d[i])),
    lat: idx.map(i => P.lat[i] != null ? Math.round(P.lat[i] * 1e6) / 1e6 : null),
    lon: idx.map(i => P.lon[i] != null ? Math.round(P.lon[i] * 1e6) / 1e6 : null),
    ele: idx.map(i => ele[i] != null ? Math.round(ele[i] * 10) / 10 : null),
    hr: idx.map(i => P.hr[i]),
    cad: idx.map(i => P.cad[i] != null ? Math.round(P.cad[i] * (run ? 2 : 1)) : null),
    pace: pace.map(p => p != null ? Math.round(p) : null),
    // indeksy najlepszych odcinków przeliczone na indeksy próbkowanych strumieni
    efforts: Object.fromEntries(Object.entries(effortIdx).map(([m, [a, b]]) => [m, [Math.floor(a / stride), Math.min(idx.length - 1, Math.ceil(b / stride))]])),
    engine: ENGINE_VERSION,
  };
  return { summary, streams };
}

// ── ANALIZY NA CAŁEJ BAZIE ──────────────────────────────────────────────────
// Ranking najlepszych odcinków dla każdego dystansu (top N, jeden wpis na trening)
export function recordTables(acts, topN = 10) {
  const runs = acts.filter(isRun);
  const out = {};
  for (const { m } of BEST_DISTANCES) {
    const list = [];
    for (const a of runs) { const t = a.bests?.[m]; if (t) list.push({ id: a.id, start: a.start, time: t }); }
    list.sort((x, y) => x.time - y.time);
    out[m] = list.slice(0, topN);
  }
  return out;
}

// Historia poprawiania rekordu: kolejne treningi, które pobiły dotychczasowy najlepszy czas
export function recordProgression(acts, m) {
  const runs = acts.filter(a => isRun(a) && a.bests?.[m]).sort((a, b) => a.start - b.start);
  const prog = [];
  let best = Infinity;
  for (const a of runs) if (a.bests[m] < best) { best = a.bests[m]; prog.push({ id: a.id, start: a.start, time: best }); }
  return prog;
}

// Które rekordy pobił dany trening (w porównaniu z treningami wcześniejszymi)
export function newRecordsFor(act, acts) {
  if (!isRun(act)) return [];
  const earlier = acts.filter(a => isRun(a) && a.start < act.start && a.id !== act.id);
  const res = [];
  for (const { m, label } of BEST_DISTANCES) {
    const t = act.bests?.[m]; if (!t) continue;
    const prev = Math.min(...earlier.map(a => a.bests?.[m] || Infinity));
    if (t < prev) res.push({ m, label, time: t, prev: Number.isFinite(prev) ? prev : null });
  }
  const longest = Math.max(0, ...earlier.map(a => a.distance));
  if (earlier.length && act.distance > longest) res.push({ m: 'longest', label: 'Najdłuższy bieg', distance: act.distance, prevDistance: longest });
  return res;
}

// VDOT (Daniels) z wyniku: dystans w m, czas w s
export function vdot(meters, seconds) {
  const t = seconds / 60, v = meters / t;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pct;
}

// Czas na dystansie dla danego VDOT (odwrotność — szukanie binarne)
export function timeForVdot(v, meters) {
  let lo = meters / 7, hi = meters / 1.2; // 7 m/s … 1.2 m/s
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (vdot(meters, mid) > v) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// Aktualna forma: najlepszy VDOT z odcinków ≥ 3 km z ostatnich `days` dni
export function currentForm(acts, now = Date.now(), days = 90) {
  const from = now - days * 864e5;
  let best = null;
  for (const a of acts) {
    if (!isRun(a) || a.start < from) continue;
    for (const { m, label } of BEST_DISTANCES) {
      if (m < 3000) continue;
      const t = a.bests?.[m]; if (!t) continue;
      const v = vdot(m, t);
      if (!best || v > best.vdot) best = { vdot: v, m, label, time: t, id: a.id, start: a.start };
    }
  }
  if (!best) return null;
  const predict = [5000, 10000, 21097.5, 42195].map(m => ({ m, time: timeForVdot(best.vdot, m) }));
  return { ...best, predict };
}

// Klucz tygodnia (poniedziałek, czas lokalny)
export function weekStart(ts) {
  const dt = new Date(ts); dt.setHours(0, 0, 0, 0);
  const wd = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - wd);
  return dt.getTime();
}

export function weeklyTotals(acts, weeks = 26, now = Date.now()) {
  const runs = acts.filter(isRun);
  const end = weekStart(now);
  const res = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const ws = new Date(end); ws.setDate(ws.getDate() - 7 * k);
    const s = ws.getTime(), e = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7).getTime();
    const inW = runs.filter(a => a.start >= s && a.start < e);
    res.push({ week: s, km: inW.reduce((x, a) => x + a.distance, 0) / 1000, count: inW.length, time: inW.reduce((x, a) => x + a.timer, 0) });
  }
  return res;
}

export function totalsBy(acts, keyFn) {
  const m = new Map();
  for (const a of acts.filter(isRun)) {
    const k = keyFn(a);
    const o = m.get(k) || { key: k, km: 0, count: 0, time: 0, ascent: 0 };
    o.km += a.distance / 1000; o.count++; o.time += a.timer; o.ascent += a.ascent || 0;
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

// Seria: ile tygodni z rzędu (do bieżącego) był co najmniej jeden bieg
export function weekStreak(acts, now = Date.now()) {
  const weeks = new Set(acts.filter(isRun).map(a => weekStart(a.start)));
  let cur = weekStart(now), n = 0;
  if (!weeks.has(cur)) { const p = new Date(cur); p.setDate(p.getDate() - 7); cur = p.getTime(); }
  while (weeks.has(cur)) { n++; const p = new Date(cur); p.setDate(p.getDate() - 7); cur = p.getTime(); }
  return n;
}

// ── FORMATOWANIE ────────────────────────────────────────────────────────────
export function fmtDur(s, alwaysH = false) {
  if (s == null || !Number.isFinite(s)) return '–';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h || alwaysH ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
export function fmtPace(sPerKm) {
  if (sPerKm == null || !Number.isFinite(sPerKm) || sPerKm <= 0 || sPerKm > 3600) return '–';
  const s = Math.round(sPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtKm(m, dec = 2) { return m == null ? '–' : (m / 1000).toFixed(dec).replace('.', ','); }
