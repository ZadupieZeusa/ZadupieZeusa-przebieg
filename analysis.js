// Przebieg — analizator: strefy, obciążenie, raporty treningów i kondycji, skład ciała.
// Czyste funkcje bez DOM. Teksty po polsku, liczone wyłącznie z danych użytkownika.
import { isRun, fmtPace, fmtDur, fmtKm, vdot, BEST_DISTANCES, newRecordsFor, currentForm, weekStart } from './core.js';

export const DEFAULT_SETTINGS = { lthr: 163, thrPace: 427, restHr: 60, maxHr: 187, height: null };
const DAY = 864e5;
const r1 = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const pct = v => Math.round(v * 100) + '%';
const median = arr => { const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; };
const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

// ── STREFY (jak w Zepp: procent tętna progu mleczanowego) ──────────────────
export const ZONE_DEFS = [
  { key: 1, name: 'Regeneracja', short: 'Z1', from: 0.65 },
  { key: 2, name: 'Spalanie tłuszczu', short: 'Z2', from: 0.81 },
  { key: 3, name: 'Wytrzymałość aerobowa', short: 'Z3', from: 0.88 },
  { key: 4, name: 'Próg mleczanowy', short: 'Z4', from: 0.93 },
  { key: 5, name: 'Wytrzymałość anaerobowa', short: 'Z5', from: 0.99 },
];
export function zonesFor(lthr) {
  return ZONE_DEFS.map((z, i) => {
    const lo = Math.floor(z.from * lthr);
    const hi = i < ZONE_DEFS.length - 1 ? Math.floor(ZONE_DEFS[i + 1].from * lthr) - 1 : Math.floor(1.09 * lthr);
    return { ...z, lo, hi };
  });
}
// sekundy w strefach: [poniżej Z1, Z1..Z5]
export function zoneTimes(a, lthr) {
  const out = [0, 0, 0, 0, 0, 0];
  if (!a.hrHist) return null;
  const zs = zonesFor(lthr);
  a.hrHist.s.forEach((sec, i) => {
    const h = a.hrHist.lo + i;
    let z = 0;
    for (let k = zs.length - 1; k >= 0; k--) if (h >= zs[k].lo) { z = k + 1; break; }
    out[z] += sec;
  });
  return out;
}
export const easyHrMax = s => Math.floor(0.88 * s.lthr) - 1;   // górna granica łatwego biegu (koniec Z2)

// ── OBCIĄŻENIE ─────────────────────────────────────────────────────────────
// hrTSS: godzina na progu = 100 pkt. Bez tętna — z tempa względem tempa progowego.
export function trainingLoad(a, s) {
  if (a.hrHist) {
    let load = 0;
    a.hrHist.s.forEach((sec, i) => { const f = (a.hrHist.lo + i) / s.lthr; load += sec * f * f; });
    return load / 3600 * 100;
  }
  if (isRun(a) && a.pace) { const f = s.thrPace / a.pace; return a.timer / 3600 * f * f * 100; }
  return a.timer / 3600 * 50;
}
// forma (CTL, 42 dni), zmęczenie (ATL, 7 dni), świeżość (TSB)
export function loadSeries(acts, s, days = 120, now = Date.now()) {
  const end = new Date(now); end.setHours(0, 0, 0, 0);
  const start = end.getTime() - (days - 1) * DAY;
  const daily = new Map();
  for (const a of acts) {
    const d = new Date(a.start); d.setHours(0, 0, 0, 0);
    daily.set(d.getTime(), (daily.get(d.getTime()) || 0) + trainingLoad(a, s));
  }
  // rozbieg od najstarszego treningu, żeby CTL nie startowało od zera w oknie
  const first = Math.min(start, ...[...daily.keys()]);
  let ctl = 0, atl = 0;
  const out = [];
  for (let t = first; t <= end.getTime(); t += DAY) {
    const tss = daily.get(t) || 0;
    const tsb = ctl - atl;   // świeżość = stan przed dzisiejszym treningiem
    ctl += (tss - ctl) / 42; atl += (tss - atl) / 7;
    if (t >= start) out.push({ day: t, tss, ctl, atl, tsb });
  }
  return out;
}
export function freshnessLabel(tsb) {
  if (tsb > 15) return { label: 'Wypoczęty', note: 'dużo świeżości, forma może lekko spadać', tone: 'ok' };
  if (tsb > 3) return { label: 'Świeży', note: 'dobry moment na mocniejszy trening', tone: 'ok' };
  if (tsb > -12) return { label: 'Optymalnie', note: 'trenujesz i budujesz formę', tone: 'ok' };
  if (tsb > -25) return { label: 'Zmęczony', note: 'pora na łatwiejsze dni', tone: 'warn' };
  return { label: 'Przeciążony', note: 'odpocznij, ryzyko kontuzji rośnie', tone: 'bad' };
}

// ── WYDAJNOŚĆ TLENOWA ──────────────────────────────────────────────────────
// minuty biegu bez pierwszych 5 (rozgrzewka, czujnik się stabilizuje) i bez marszu/postoju
function steadyMins(a) {
  return (a.mins || []).slice(5).filter(m => m[0] != null && m[1] >= 150);
}
// EF: metry na minutę na uderzenie serca; dryf (decoupling): spadek EF w drugiej połowie
export function efficiency(a) {
  const m = steadyMins(a);
  if (m.length < 10) return null;
  const ef = arr => mean(arr.map(x => x[1] * 0.6)) / mean(arr.map(x => x[0]));
  const half = m.length >> 1;
  const e1 = ef(m.slice(0, half)), e2 = ef(m.slice(half));
  return { ef: ef(m), drift: (e1 - e2) / e1 * 100 };
}
// tempo przy zadanym tętnie: regresja prędkość~tętno z minut wszystkich biegów w oknie
export function paceAtHr(acts, refHr, from, to) {
  const pts = [];
  for (const a of acts) {
    if (!isRun(a) || a.start < from || a.start >= to) continue;
    for (const m of steadyMins(a)) if (Math.abs(m[0] - refHr) <= 15) pts.push([m[0], m[1] / 100]);
  }
  if (pts.length < 12) return null;
  const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1]));
  let sxy = 0, sxx = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  let b = sxx > 0 ? sxy / sxx : 0;
  b = Math.max(0, Math.min(b, 0.05));   // fizjologicznie: szybciej = wyższe tętno
  const v = my + b * (refHr - mx);
  return v > 0.5 ? { pace: 1000 / v, n: pts.length } : null;
}

// ── KLASYFIKACJA TRENINGU ──────────────────────────────────────────────────
export const TYPES = {
  recovery: { label: 'Bieg regeneracyjny', tone: 'easy' },
  easy: { label: 'Łatwy bieg', tone: 'easy' },
  long: { label: 'Długi bieg', tone: 'easy' },
  tempo: { label: 'Bieg w tempie', tone: 'mid' },
  threshold: { label: 'Bieg progowy', tone: 'hard' },
  intervals: { label: 'Interwały', tone: 'hard' },
  race: { label: 'Bardzo mocny bieg', tone: 'hard' },
  other: { label: 'Aktywność', tone: 'easy' },
};
function countReps(a) {
  const sp = (a.mins || []).slice(3).map(m => m[1]);
  if (sp.length < 8) return 0;
  const med = median(sp);
  let reps = 0, inFast = false, slowRun = 2;
  for (const v of sp) {
    if (v > med * 1.12) { if (!inFast && slowRun >= 1) reps++; inFast = true; slowRun = 0; }
    else if (v < med * 1.0) { inFast = false; slowRun++; }
  }
  return reps;
}
export function classify(a, acts, s) {
  if (!isRun(a)) return 'other';
  const zt = zoneTimes(a, s.lthr);
  const recent = acts.filter(x => isRun(x) && x.id !== a.id && x.start < a.start && x.start > a.start - 42 * DAY);
  const avgDist = recent.length ? mean(recent.map(x => x.distance)) : a.distance;
  const isLong = a.timer >= 75 * 60 || (recent.length >= 3 && a.distance >= Math.max(10000, avgDist * 1.5));
  if (!zt || zt.reduce((x, y) => x + y, 0) < a.timer * 0.5) {
    const f = s.thrPace / (a.pace || 1e9);
    if (f >= 1.02) return a.timer < 50 * 60 ? 'race' : 'threshold';
    if (f >= 0.93) return 'tempo';
    return isLong ? 'long' : 'easy';
  }
  const tot = zt.reduce((x, y) => x + y, 0);
  const f = zt.map(v => v / tot);
  const hard = f[4] + f[5];
  const reps = countReps(a);
  if (reps >= 3 && hard >= 0.12) return 'intervals';
  if (f[5] >= 0.5 && a.avgHr >= 1.02 * s.lthr && a.timer <= 50 * 60) return 'race';
  if (hard >= 0.5) return 'threshold';
  if (isLong) return 'long';
  if (f[3] + hard >= 0.4) return 'tempo';
  if (f[0] + f[1] >= 0.6 && a.timer < 40 * 60) return 'recovery';
  return 'easy';
}

// ── RAPORT TRENINGU ────────────────────────────────────────────────────────
const TYPE_TEXT = {
  recovery: 'Spokojny, krótki bieg w niskich strefach. Pomaga się zregenerować i nie dokłada zmęczenia.',
  easy: 'Spokojny bieg tlenowy, fundament formy. Wzmacnia serce, uczy organizm spalać tłuszcz i przygotowuje do mocniejszych treningów.',
  long: 'Długi bieg buduje wytrzymałość: więcej naczyń krwionośnych w mięśniach, lepsze gospodarowanie paliwem i odporność nóg na zmęczenie.',
  tempo: 'Bieg w strefie „pomiędzy”: mocniej niż łatwo, słabiej niż próg. Rozwija wytrzymałość, ale męczy bardziej niż łatwy bieg.',
  threshold: 'Większość czasu na progu mleczanowym lub wyżej. Taki trening podnosi próg, czyli tempo, które utrzymasz długo, ale mocno męczy.',
  intervals: 'Trening interwałowy: powtarzane szybsze odcinki z odpoczynkiem. Rozwija szybkość i pułap tlenowy (VO₂max).',
  race: 'Bieg na granicy możliwości, jak zawody albo test. Świetny sprawdzian, ale wymaga 2–3 dni lżejszego biegania.',
  other: 'Aktywność inna niż bieg. Liczy się do obciążenia, ale nie do rekordów.',
};
function similarRuns(a, acts, type) {
  return acts.filter(x => isRun(x) && x.id !== a.id && x.start < a.start && x.start > a.start - 90 * DAY
    && Math.abs(x.distance - a.distance) <= a.distance * 0.3 && x._type === type);
}
export function workoutReport(a, acts, s, opts = {}) {
  const type = a._type || classify(a, acts, s);
  const T = TYPES[type];
  const zs = zonesFor(s.lthr);
  const zt = zoneTimes(a, s.lthr);
  const paras = [], facts = [];
  const load = trainingLoad(a, s);
  paras.push(TYPE_TEXT[type]);

  // intensywność
  if (zt) {
    const tot = zt.reduce((x, y) => x + y, 0) || 1;
    const easy = (zt[0] + zt[1] + zt[2]) / tot, hard = (zt[4] + zt[5]) / tot;
    const hrPct = a.avgHr ? Math.round(a.avgHr / s.lthr * 100) : null;
    let t = `Średnie tętno ${a.avgHr} bpm, czyli ${hrPct}% Twojego progu (${s.lthr}). `;
    if (easy >= 0.7) t += `${pct(easy)} czasu w strefach łatwych (do ${zs[1].hi} bpm), tak jak powinno być przy spokojnym bieganiu.`;
    else if (hard >= 0.5) t += `${pct(hard)} czasu na progu i wyżej (od ${zs[3].lo} bpm), a w strefach łatwych tylko ${pct(easy)}.`;
    else t += `Czas rozłożył się na strefy: łatwe ${pct(easy)}, umiarkowana ${pct(zt[3] / tot)}, próg i wyżej ${pct(hard)}.`;
    if ((type === 'easy' || type === 'long') && hard > 0.15) t += ` Jak na spokojny bieg to sporo mocnej pracy — zwolnij, gdy tętno przekracza ${zs[1].hi}.`;
    paras.push(t);
  } else if (isRun(a)) {
    paras.push(`Brak tętna w pliku, więc intensywność oceniam po tempie względem Twojego tempa progowego (${fmtPace(s.thrPace)}/km).`);
  }

  // rozkład tempa i dryf tętna
  const eff = efficiency(a);
  const sp = (a.splits || []).filter(x => x.dist >= 900);
  if (sp.length >= 3) {
    const half = Math.floor(sp.length / 2);
    const p1 = mean(sp.slice(0, half).map(x => x.pace)), p2 = mean(sp.slice(-half).map(x => x.pace));
    const diff = p2 - p1;
    let t = '';
    if (Math.abs(diff) < 8) t = 'Tempo równe od początku do końca — dobrze rozłożony wysiłek.';
    else if (diff > 0) t = `Druga połowa wolniejsza średnio o ${Math.round(diff)} s/km${diff > 25 ? ' — start był za szybki albo zabrakło sił' : ''}.`;
    else t = `Druga połowa szybsza o ${Math.round(-diff)} s/km (negative split) — wzorowo rozłożone siły.`;
    if (eff && eff.drift > 5) t += ` Dryf tętna ${r1(eff.drift)}%: pod koniec to samo tętno dawało wolniejsze tempo. To sygnał zmęczenia, ciepła lub odwodnienia; przy łatwym bieganiu powinien być poniżej 5%.`;
    else if (eff && eff.drift >= -2 && eff.ef) t += ` Tętno trzymało się tempa (dryf ${r1(Math.max(0, eff.drift))}%), czyli wytrzymałość tlenowa wystarczyła na ten dystans.`;
    paras.push(t);
  }

  // porównanie z podobnymi biegami
  const sim = similarRuns(a, acts, type);
  if (sim.length >= 2 && a.pace) {
    const sp2 = median(sim.map(x => x.pace)), sh = median(sim.filter(x => x.avgHr).map(x => x.avgHr));
    const dp = a.pace - sp2;
    let t = `Na tle ${sim.length} podobnych biegów z 3 miesięcy: tempo ${Math.abs(dp) < 5 ? 'takie samo' : (dp < 0 ? Math.round(-dp) + ' s/km szybciej' : Math.round(dp) + ' s/km wolniej')}`;
    if (sh && a.avgHr) {
      const dh = a.avgHr - sh;
      t += `, tętno ${Math.abs(dh) < 2 ? 'podobne' : (dh < 0 ? 'niższe o ' + Math.round(-dh) : 'wyższe o ' + Math.round(dh))}`;
      if (dp < -5 && dh <= 1) t += ' — szybciej przy tym samym wysiłku, czyli forma idzie w górę';
      else if (dp > 5 && dh >= 1) t += ' — gorszy dzień: zmęczenie, pogoda albo sen';
    }
    paras.push(t + '.');
  }

  // pogoda
  const w = a.weather;
  if (w && w.t != null) {
    let t = `Pogoda: ${Math.round(w.t)}°C${w.feels != null && Math.abs(w.feels - w.t) >= 2 ? ` (odczuwalna ${Math.round(w.feels)}°C)` : ''}, wiatr ${Math.round(w.wind)} km/h${w.rh != null ? `, wilgotność ${Math.round(w.rh)}%` : ''}.`;
    if (w.t >= 22) t += ' W cieple tętno rośnie o kilka uderzeń przy tym samym tempie — to normalne.';
    else if (w.t <= 0) t += ' Mróz: dłuższa rozgrzewka, tempo może być trochę wolniejsze.';
    if (w.wind >= 25) t += ' Silny wiatr wyraźnie spowalniał na odcinkach pod wiatr.';
    paras.push(t);
  }

  // notatka
  const nt = a.note;
  if (nt) {
    const bits = [];
    if (nt.coffee) bits.push('kawa przed biegiem (może podbić tętno o kilka uderzeń)');
    if (nt.sleep === 'bad') bits.push('słaby sen (tętno zwykle wyższe, tempo niższe)');
    if (bits.length) paras.push('Z Twojej notatki: ' + bits.join(', ') + '.');
    if (nt.rpe && zt) {
      const tot = zt.reduce((x, y) => x + y, 0) || 1, hard = (zt[4] + zt[5]) / tot;
      if (nt.rpe <= 4 && hard >= 0.5) paras.push(`Oceniłeś wysiłek na ${nt.rpe}/10, a tętno pokazuje bieg progowy. Na początku przygody z bieganiem to częste — odczucie zawodzi, kieruj się tętnem.`);
      if (nt.rpe >= 8 && hard < 0.2) paras.push(`Wysiłek ${nt.rpe}/10 przy niskim tętnie — możliwe zmęczenie nóg lub niedospanie. Warto dzień odpocząć.`);
    }
  }

  // rekordy
  const recs = newRecordsFor(a, acts);
  if (recs.length) facts.push(...recs.map(r => r.m === 'longest' ? `🏆 Najdłuższy bieg: ${fmtKm(r.distance)} km` : `🏆 ${r.label}: ${fmtDur(r.time)}${r.prev ? ` (−${fmtDur(r.prev - r.time)})` : ''}`));

  // co dalej
  const next = nextStep(a, acts, s, opts.now ?? a.start + DAY);
  const headline = `${T.label} · ${fmtKm(a.distance)} km w ${fmtDur(a.timer)}`;
  return { type, label: T.label, tone: T.tone, headline, summary: TYPE_TEXT[type].split('. ')[0] + '.', paras, facts, next, load: Math.round(load), zones: zt, eff };
}

// rekomendacja kolejnego treningu: na podstawie typu ostatnich biegów, świeżości i przyrostu kilometrów
export function nextStep(a, acts, s, now = Date.now()) {
  const zs = zonesFor(s.lthr);
  const easyMax = zs[1].hi;
  const runs = acts.filter(x => isRun(x) && x.start <= (a ? a.start : now)).sort((x, y) => y.start - x.start);
  const last = a || runs[0];
  if (!last) return 'Zacznij od łatwego biegu 20–30 minut, z tętnem poniżej ' + easyMax + ' bpm. Marsz w trakcie jest w porządku.';
  const series = loadSeries(acts, s, 60, now);
  const tsb = series.length ? series[series.length - 1].tsb : 0;
  const lastType = last._type || classify(last, acts, s);
  const hardTypes = new Set(['threshold', 'intervals', 'race', 'long', 'tempo']);
  const lastHard = runs.find(x => hardTypes.has(x._type || classify(x, acts, s)));
  const daysSinceHard = lastHard ? (now - lastHard.start) / DAY : 99;
  const ramp = mileageRamp(acts, now);
  let t;
  if (tsb < -25) t = `Dzień wolny albo 20–30 minut bardzo spokojnie (poniżej ${zs[0].hi} bpm). Zmęczenie się kumuluje.`;
  else if (hardTypes.has(lastType)) t = `Następny bieg: łatwy, 30–45 minut z tętnem poniżej ${easyMax} bpm. Po mocnym treningu organizm potrzebuje 1–2 dni lżej.`;
  else if (daysSinceHard >= 4 && tsb > -10) t = `Możesz dorzucić mocniejszy akcent: 10 min rozgrzewki, 3 × 8 min w strefie progu (${zs[3].lo}–${zs[3].hi} bpm) z 2 min truchtu, 10 min schłodzenia.`;
  else t = `Kolejny łatwy bieg: 30–50 minut poniżej ${easyMax} bpm. Raz w tygodniu wydłuż go o 10–15 minut.`;
  if (ramp && ramp.ratio > 1.3 && ramp.last7 > 10) t += ` Uwaga: w ostatnim tygodniu przebiegłeś ${r1(ramp.last7)} km, o ${pct(ramp.ratio - 1)} więcej niż średnio wcześniej — zwiększaj kilometraż o maks. ~10% tygodniowo.`;
  return t;
}
export function mileageRamp(acts, now = Date.now()) {
  const runs = acts.filter(isRun);
  const km = (a, b) => runs.filter(x => x.start >= a && x.start < b).reduce((s, x) => s + x.distance / 1000, 0);
  const last7 = km(now - 7 * DAY, now);
  const prev = km(now - 35 * DAY, now - 7 * DAY) / 4;
  if (prev < 1) return null;
  return { last7, prev, ratio: last7 / prev };
}

// rozkład intensywności tygodniowo: [łatwo, umiarkowanie, mocno] w sekundach
export function intensitySplit(acts, s, from, to) {
  const out = [0, 0, 0];
  for (const a of acts) {
    if (!isRun(a) || a.start < from || a.start >= to) continue;
    const zt = zoneTimes(a, s.lthr);
    if (!zt) continue;
    out[0] += zt[0] + zt[1] + zt[2]; out[1] += zt[3]; out[2] += zt[4] + zt[5];
  }
  return out;
}

// ── RAPORT KONDYCJI ────────────────────────────────────────────────────────
export function conditionReport(acts, s, now = Date.now()) {
  const runs = acts.filter(isRun);
  if (!runs.length) return null;
  const P = 28 * DAY;
  const win = (from, to) => runs.filter(a => a.start >= from && a.start < to);
  const cur = win(now - P, now), prev = win(now - 2 * P, now - P);
  const sum = arr => ({ km: arr.reduce((x, a) => x + a.distance / 1000, 0), n: arr.length, time: arr.reduce((x, a) => x + a.timer, 0) });
  const c = sum(cur), p = sum(prev);
  const ref = easyHrMax(s);
  const pc = paceAtHr(acts, ref, now - P, now), pp = paceAtHr(acts, ref, now - 2 * P, now - P);
  const series = loadSeries(acts, s, 60, now);
  const today = series[series.length - 1], ago = series[Math.max(0, series.length - 29)];
  const form = currentForm(acts, now);
  const formPrev = currentForm(acts.filter(a => a.start < now - P), now - P);
  const split = intensitySplit(acts, s, now - P, now);
  const splitTot = split[0] + split[1] + split[2];
  const lines = [];

  lines.push(`Ostatnie 4 tygodnie: ${r1(c.km)} km w ${c.n} ${c.n === 1 ? 'biegu' : 'biegach'} (${fmtDur(c.time)})` +
    (p.n ? `, wcześniej ${r1(p.km)} km w ${p.n}. ${c.km > p.km * 1.05 ? 'Kilometraż rośnie.' : c.km < p.km * 0.9 ? 'Biegałeś mniej niż miesiąc wcześniej.' : 'Kilometraż stabilny.'}` : '.'));
  if (pc && pp) {
    const d = pp.pace - pc.pace;
    lines.push(`Tempo przy ${ref} bpm: ${fmtPace(pc.pace)}/km, miesiąc temu ${fmtPace(pp.pace)}/km. ` +
      (d > 5 ? `To ${Math.round(d)} s/km szybciej przy tym samym tętnie — najlepszy dowód, że wydolność tlenowa rośnie.` : d < -5 ? `Wolniej o ${Math.round(-d)} s/km — może zmęczenie, ciepło albo przerwa w treningach.` : 'Bez wyraźnej zmiany — potrzeba jeszcze kilku tygodni regularnych, łatwych biegów.'));
  } else if (pc) lines.push(`Tempo przy ${ref} bpm: ${fmtPace(pc.pace)}/km. Za miesiąc zobaczysz tu porównanie.`);
  else lines.push(`Za mało łatwych minut w okolicy ${ref} bpm, żeby policzyć tempo przy stałym tętnie. Biegaj częściej spokojnie — to będzie Twój główny wskaźnik postępu.`);
  if (form) {
    let t = `Szacowana forma (VDOT): ${r1(form.vdot)} — na dziś to ok. ${fmtDur(form.predict[0].time)} na 5 km i ${fmtDur(form.predict[1].time)} na 10 km.`;
    if (formPrev && Math.abs(form.vdot - formPrev.vdot) >= 0.5) t += form.vdot > formPrev.vdot ? ` Wzrost o ${r1(form.vdot - formPrev.vdot)} w miesiąc.` : ` Spadek o ${r1(formPrev.vdot - form.vdot)} — zwykle przez brak mocnych biegów, nie utratę kondycji.`;
    lines.push(t);
  }
  if (splitTot > 0) {
    const e = split[0] / splitTot;
    lines.push(`Intensywność: ${pct(e)} czasu łatwo, ${pct(split[2] / splitTot)} na progu i wyżej. ` +
      (e >= 0.75 ? 'Świetne proporcje (cel to ok. 80/20).' : `Za mało spokojnego biegania — cel to ok. 80% czasu poniżej ${zonesFor(s.lthr)[2].lo} bpm. Zwolnij większość biegów; tempo przy niskim tętnie urośnie szybciej, niż myślisz.`));
  }
  if (today) {
    const fl = freshnessLabel(today.tsb);
    lines.push(`Forma treningowa ${Math.round(today.ctl)} pkt (miesiąc temu ${Math.round(ago.ctl)}), stan: ${fl.label.toLowerCase()} — ${fl.note}.`);
  }
  return { cur: c, prev: p, paceNow: pc, pacePrev: pp, refHr: ref, form, formPrev, split, load: today, lines };
}

// tempo przy stałym tętnie — tydzień po tygodniu (okno kroczące 3 tygodnie, żeby było stabilniej)
export function paceAtHrTrend(acts, s, weeks = 16, now = Date.now()) {
  const ref = easyHrMax(s), out = [];
  const end = weekStart(now) + 7 * DAY;
  for (let k = weeks - 1; k >= 0; k--) {
    const to = end - k * 7 * DAY;
    const r = paceAtHr(acts, ref, to - 21 * DAY, to);
    out.push({ week: to - 7 * DAY, pace: r ? r.pace : null });
  }
  return { ref, points: out };
}

// kawa: porównanie wydajności (EF) biegów z kawą i bez
export function coffeeEffect(acts) {
  const runs = acts.filter(a => isRun(a) && a.note && typeof a.note.coffee === 'boolean');
  const withC = [], without = [];
  for (const a of runs) { const e = efficiency(a); if (!e) continue; (a.note.coffee ? withC : without).push({ e, a }); }
  if (withC.length < 3 || without.length < 3) return { enough: false, withC: withC.length, without: without.length };
  const hrW = mean(withC.map(x => x.a.avgHr)), hrO = mean(without.map(x => x.a.avgHr));
  const efW = mean(withC.map(x => x.e.ef)), efO = mean(without.map(x => x.e.ef));
  return { enough: true, withC: withC.length, without: without.length, hrDiff: hrW - hrO, efDiff: (efW - efO) / efO * 100 };
}

// ── SKŁAD CIAŁA ────────────────────────────────────────────────────────────
const H = {
  ts: /^(timestamp|time|date|data|czas|datetime|measure.?time)$/i,
  weight: /^(weight|waga|masa ciała|weight ?\(kg\))$/i,
  fat: /fat.?rate|body.?fat|^fat$|tłuszcz|tluszcz|fat ?%/i,
  water: /water|woda|nawodn/i,
  muscle: /muscle|mięś|mies/i,
  bone: /bone|kość|kosc/i,
  visceral: /visceral|trzew/i,
  bmr: /metabolism|^bmr$|metabolizm|basal/i,
  bmi: /^bmi$/i,
  height: /^(height|wzrost)$/i,
  waist: /waist|talia|pas/i,
};
function parseTs(v) {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  if (/^\d{9,13}$/.test(t)) { const n = Number(t); return n < 1e11 ? n * 1000 : n; }
  const m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 8), +(m[5] || 0)).getTime();
  const d = Date.parse(t.replace(' ', 'T').replace(/\+0000$/, 'Z'));
  return Number.isFinite(d) ? d : null;
}
const num = v => { if (v == null) return null; const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) && n !== 0 ? n : null; };
export function parseBodyCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const delim = [';', '\t', ','].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const split = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === delim && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); };
  const head = split(lines[0]);
  const col = {};
  head.forEach((h, i) => { for (const [k, re] of Object.entries(H)) if (col[k] == null && re.test(h.trim())) { col[k] = i; break; } });
  if (col.ts == null || col.weight == null) return [];
  const out = [];
  for (const l of lines.slice(1)) {
    const c = split(l);
    const ts = parseTs(c[col.ts]), weight = num(c[col.weight]);
    if (!ts || !weight || weight < 25 || weight > 300) continue;
    const e = { ts, weight, source: 'csv' };
    for (const k of ['fat', 'water', 'muscle', 'bone', 'visceral', 'bmr', 'height', 'waist']) if (col[k] != null) { const v = num(c[col[k]]); if (v != null) e[k] = v; }
    // Zepp zapisuje „muscleRate” jako masę mięśni w kg; procenty przeliczamy na kg
    if (e.muscle != null && e.muscle / weight <= 0.55) e.muscle = Math.round(weight * e.muscle) / 100;
    out.push(e);
  }
  return out;
}
export const bodyId = ts => 'b' + Math.floor(ts / 60000).toString(36);

// średnia krocząca 7-dniowa dla wybranej miary
export function bodyTrend(entries, key = 'weight', days = 7) {
  const list = entries.filter(e => e[key] != null).sort((a, b) => a.ts - b.ts);
  return list.map(e => {
    const win = list.filter(x => x.ts > e.ts - days * DAY && x.ts <= e.ts);
    return { ts: e.ts, v: e[key], avg: mean(win.map(x => x[key])) };
  });
}
function slopePerWeek(points) {
  if (points.length < 3) return null;
  const xs = points.map(p => p.ts / (7 * DAY)), ys = points.map(p => p.v);
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  return sxx ? sxy / sxx : null;
}
export function bodyReport(entries, s, now = Date.now()) {
  const list = [...entries].sort((a, b) => a.ts - b.ts);
  if (!list.length) return null;
  const last = list[list.length - 1];
  const nearest = (ago, key) => { const t = now - ago * DAY; const c = list.filter(e => e[key] != null && e.ts <= t + 3 * DAY); return c.length ? c[c.length - 1] : null; };
  const avgAround = (t, key) => { const w = list.filter(e => e[key] != null && Math.abs(e.ts - t) <= 3.5 * DAY); return w.length ? mean(w.map(e => e[key])) : null; };
  const height = s.height || last.height || [...list].reverse().find(e => e.height)?.height || null;
  const lines = [];
  const recent = list.filter(e => e.ts >= now - 28 * DAY);
  const slope = slopePerWeek(recent.map(e => ({ ts: e.ts, v: e.weight })));
  const wNow = avgAround(last.ts, 'weight');
  const w30 = avgAround(now - 30 * DAY, 'weight');
  if (slope != null && recent.length >= 3) {
    const t = Math.abs(slope) < 0.1 ? 'Waga stabilna' : slope < 0 ? `Waga spada średnio ${r1(-slope)} kg/tydzień` : `Waga rośnie średnio ${r1(slope)} kg/tydzień`;
    lines.push(t + ` (trend z ${recent.length} pomiarów z 4 tygodni).` + (slope < -1 ? ' To szybko — przy takim tempie łatwo tracić też mięśnie; bezpieczniej 0,3–0,7 kg/tydz.' : slope < -0.1 ? ' Dobre, zdrowe tempo.' : ''));
  }
  const fNow = avgAround(last.ts, 'fat'), f30 = avgAround(now - 30 * DAY, 'fat');
  if (wNow && w30 && fNow != null && f30 != null) {
    const fm = wNow * fNow / 100, fm30 = w30 * f30 / 100, lm = wNow - fm, lm30 = w30 - fm30;
    const dF = fm - fm30, dL = lm - lm30;
    let t = `W ciągu miesiąca: masa tłuszczu ${dF <= 0 ? '−' : '+'}${r1(Math.abs(dF))} kg, masa beztłuszczowa ${dL <= 0 ? '−' : '+'}${r1(Math.abs(dL))} kg.`;
    if (dF < -0.3 && dL > -0.5) t += ' Tracisz tłuszcz, zachowując mięśnie — dokładnie o to chodzi.';
    else if (dF < 0 && dL < -0.8) t += ' Spora część ubytku to masa beztłuszczowa (woda/mięśnie) — dołóż białka i ćwiczenia siłowe 2× w tygodniu.';
    lines.push(t);
  }
  const waist = list.filter(e => e.waist != null);
  if (waist.length >= 2) {
    const d = waist[waist.length - 1].waist - waist[0].waist;
    lines.push(`Obwód pasa: ${r1(waist[waist.length - 1].waist)} cm (${d <= 0 ? '−' : '+'}${r1(Math.abs(d))} cm od ${new Date(waist[0].ts).toLocaleDateString('pl')}). Przy celu „mniej brzucha” to najlepszy pojedynczy wskaźnik.`);
  } else lines.push('Dodawaj co 1–2 tygodnie obwód pasa (na wysokości pępka, rano). Przy celu „mniej brzucha” mówi więcej niż sama waga.');
  if (last.visceral != null) lines.push(`Tłuszcz trzewny: poziom ${Math.round(last.visceral)} ${last.visceral <= 9 ? '(norma do 9)' : '(powyżej normy 9 — spada najszybciej przy regularnym ruchu)'}.`);
  lines.push('Wagi z analizą składu mierzą prądem i reagują na nawodnienie — pojedynczy pomiar potrafi skakać o 1–2%. Waż się rano, po toalecie, przed jedzeniem i porównuj średnie tygodniowe.');
  const bmi = height && wNow ? wNow / ((height / 100) ** 2) : null;
  return { last, slope, wNow, w30, fNow, bmi, height, lines };
}

// typ każdego treningu (pole pomocnicze _type, nie trafia na Drive)
export function annotateTypes(acts, s) {
  const sorted = [...acts].sort((a, b) => a.start - b.start);
  for (const a of sorted) a._type = classify(a, sorted, s);
  return acts;
}
