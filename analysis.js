// Przebieg — analizator: strefy, obciążenie, raporty treningów i kondycji, skład ciała.
// Czyste funkcje bez DOM. Teksty po polsku, liczone wyłącznie z danych użytkownika.
import { isRun, fmtPace, fmtDur, fmtKm, vdot, BEST_DISTANCES, newRecordsFor, currentForm, weekStart } from './core.js?v=20261113d';

export const DEFAULT_SETTINGS = { lthr: 164, thrPace: 416, restHr: 60, maxHr: 187, height: null };
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
export function countReps(a) {
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
  // ── podsumowanie: kilka zdań „po ludzku” na górę raportu ──
  const ov = [];
  if (isRun(a)) {
    ov.push(`${T.label}: ${fmtKm(a.distance)} km w ${fmtDur(a.timer)}${a.pace ? `, średnio ${fmtPace(a.pace)}/km` : ''}${a.avgHr ? ` przy tętnie ${a.avgHr} bpm` : ''}.`);
    if (zt) {
      const tot = zt.reduce((x, y) => x + y, 0) || 1;
      const easy = (zt[0] + zt[1] + zt[2]) / tot, hardM = Math.round((zt[4] + zt[5]) / 60);
      if (T.tone === 'easy') ov.push(easy >= 0.8 ? `Naprawdę spokojnie — ${pct(easy)} czasu w strefach łatwych, tak buduje się wytrzymałość.` : easy >= 0.6 ? `Przeważnie spokojnie (${pct(easy)} czasu łatwo), ale tętno momentami uciekało powyżej ${zs[1].hi}.` : `Jak na spokojny bieg za mocno — tylko ${pct(easy)} czasu łatwo. Taki bieg męczy, a buduje mniej, niż mógłby.`);
      else ov.push(hardM >= 5 ? `${hardM} min na progu i wyżej — solidny bodziec dla progu mleczanowego.` : `Mocniejszy bieg, ale głównie w strefie pośredniej (${zs[2].lo}–${zs[2].hi}) — ani spokój, ani akcent.`);
    }
    if (sim.length >= 2 && a.pace) {
      const dp = a.pace - median(sim.map(x => x.pace)), sh = median(sim.filter(x => x.avgHr).map(x => x.avgHr)), dh = sh && a.avgHr ? a.avgHr - sh : 0;
      if (dp < -5 && dh <= 1) ov.push(`Na tle podobnych biegów o ${Math.round(-dp)} s/km szybciej przy tym samym lub niższym tętnie — forma rośnie.`);
      else if (dp > 5 && dh >= 1) ov.push(`Wolniej niż zwykle przy wyższym tętnie — słabszy dzień (zmęczenie, sen, pogoda).`);
      else if (Math.abs(dp) <= 5 && dh <= -3) ov.push(`To samo tempo co zwykle, ale tętno niższe o ${Math.round(-dh)} — serce pracuje oszczędniej.`);
    } else if (eff && eff.drift > 5) ov.push(`Tętno rosło pod koniec (dryf ${r1(eff.drift)}%) — zmęczenie albo za szybki start.`);
    if (a.cadence && a.cadence < 160 && a.cadence > 120) ov.push(`Kadencja ${a.cadence} kroków/min — krótszy, szybszy krok (165–175) odciąży kolana i ścięgna.`);
    const L = Math.round(load);
    ov.push(L < 40 ? 'Lekkie obciążenie — jutro możesz normalnie trenować.' : L < 80 ? 'Umiarkowane obciążenie — regeneracja ok. 24 h.' : L < 130 ? 'Duże obciążenie — następny mocny trening najwcześniej za 2 dni.' : 'Bardzo duże obciążenie — 2–3 dni luźno albo wolne.');
  }
  return { type, label: T.label, tone: T.tone, headline, overview: ov, summary: ov[1] || TYPE_TEXT[type].split('. ')[0] + '.', paras, facts, next, load: Math.round(load), zones: zt, eff };
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

// ══ WERSJA 3 ════════════════════════════════════════════════════════════════
import { isStrength, haversine, recordProgression, weekStreak } from './core.js?v=20261113d';

// ── AUTOMATYCZNY PRÓG ──────────────────────────────────────────────────────
// Najmocniejsze równe 20 minut biegu (bez rozgrzewki, bez postojów): średnie tętno ≈ próg
// (metoda Friela). Proponujemy tylko podniesienie progu — spadku z luźnych biegów nie da się ocenić.
export function estimateThreshold(acts, s, now = Date.now()) {
  let best = null;
  for (const a of acts) {
    if (!isRun(a) || a.start < now - 60 * DAY || !a.mins) continue;
    const m = a.mins;
    for (let i = 5; i + 20 <= m.length; i++) {
      const w = m.slice(i, i + 20);
      if (w.some(x => x[0] == null || x[1] < 160)) continue;
      const sp = w.map(x => x[1]), avg = mean(sp);
      const cv = Math.sqrt(mean(sp.map(v => (v - avg) ** 2))) / avg;
      if (cv > 0.12) continue;   // nierówne tempo (interwały, podbiegi) — pomijamy
      const hr = mean(w.map(x => x[0]));
      if (!best || hr > best.hr) best = { hr, pace: 100000 / avg, runId: a.id, start: a.start };
    }
  }
  if (!best || best.hr < 0.95 * s.lthr) return null;
  const lthr = Math.round(best.hr);
  if (lthr < s.lthr + 2 || best.runId === s.ltDismissed) return null;
  return { lthr, pace: Math.round(best.pace), runId: best.runId, start: best.start };
}

// ── PODSUMOWANIE TYGODNIA ──────────────────────────────────────────────────
export function weekSummary(acts, body, s, from, planSessions = null) {
  const to = from + 7 * DAY;
  const runs = acts.filter(a => isRun(a) && a.start >= from && a.start < to);
  const str = acts.filter(a => isStrength(a) && a.start >= from && a.start < to);
  const prevRuns = acts.filter(a => isRun(a) && a.start >= from - 7 * DAY && a.start < from);
  const km = runs.reduce((x, a) => x + a.distance / 1000, 0), prevKm = prevRuns.reduce((x, a) => x + a.distance / 1000, 0);
  const time = runs.reduce((x, a) => x + a.timer, 0);
  const split = intensitySplit(acts, s, from, to), tot = split[0] + split[1] + split[2];
  const easy = tot ? split[0] / tot : null;
  const avgW = (a, b) => { const w = body.filter(e => e.ts >= a && e.ts < b && e.weight); return w.length ? mean(w.map(e => e.weight)) : null; };
  const wNow = avgW(from, to), wPrev = avgW(from - 7 * DAY, from);
  let plan = null;
  if (planSessions) {
    const inW = planSessions.filter(x => x.planned >= from && x.planned < to);
    if (inW.length) plan = { total: inW.length, done: inW.filter(x => x.status === 'done').length, ok: inW.filter(x => x.status === 'done' && (!x.comp || x.comp.ok)).length, missed: inW.filter(x => x.status === 'missed' || x.status === 'skipped').length };
  }
  let tip;
  if (!runs.length) tip = 'Tydzień bez biegania — wróć spokojnie, 25–30 minut w strefie 2.';
  else if (easy != null && easy < 0.6) tip = `Tylko ${pct(easy)} czasu łatwo. W tym tygodniu zwolnij spokojne biegi — tętno do ${zonesFor(s.lthr)[1].hi}.`;
  else if (plan && plan.missed) tip = `Przepadło ${plan.missed} z ${plan.total} treningów planu. Jeśli to się powtarza, zmniejsz liczbę dni w planie — regularność ważniejsza niż objętość.`;
  else if (prevKm > 3 && km > prevKm * 1.3) tip = `Kilometraż skoczył o ${pct(km / prevKm - 1)}. W kolejnym tygodniu nie dokładaj więcej.`;
  else if (wNow && wPrev && wNow - wPrev > 0.6) tip = 'Waga w górę mimo treningów — często to woda po mocniejszych dniach lub słonym jedzeniu. Patrz na trend z kilku tygodni.';
  else tip = 'Dobry tydzień. Trzymaj ten rytm — postęp robi regularność.';
  return { from, runs: runs.length, strength: str.length, km, prevKm, time, easy, wNow, wPrev, plan, tip };
}

// ── CEL WAGI / PASA ────────────────────────────────────────────────────────
export function goalForecast(entries, key, goal, now = Date.now()) {
  const list = entries.filter(e => e[key] != null).sort((a, b) => a.ts - b.ts);
  if (!goal || !list.length) return null;
  const recent = key === 'weight' ? list.filter(e => e.ts >= now - 35 * DAY) : list;
  const pts = recent.map(e => ({ ts: e.ts, v: e[key] }));
  const slope = slopePerWeek(pts);
  const curVal = key === 'weight' ? mean(list.filter(e => e.ts >= list[list.length - 1].ts - 7 * DAY).map(e => e[key])) : list[list.length - 1][key];
  const left = curVal - goal;
  const first = list[0][key];
  const progress = first !== goal ? Math.max(0, Math.min(1, (first - curVal) / (first - goal))) : 1;
  if (left <= 0) return { cur: curVal, goal, left: 0, progress: 1, done: true, text: 'Cel osiągnięty 🎉' };
  if (slope == null || pts.length < 3 || slope >= -0.05) return { cur: curVal, goal, left, progress, eta: null, text: pts.length < 3 ? 'Za mało pomiarów na prognozę.' : 'Trend płaski — prognoza pojawi się, gdy wartość zacznie spadać.' };
  const weeks = left / -slope;
  const eta = now + weeks * 7 * DAY;
  return { cur: curVal, goal, left, progress, slope, eta, weeks, text: `Przy obecnym tempie (${r1(-slope)} ${key === 'weight' ? 'kg' : 'cm'}/tydz.) cel ok. ${new Date(eta).toLocaleDateString('pl', { day: 'numeric', month: 'long', year: weeks > 40 ? 'numeric' : undefined })}.` };
}

// ── TECHNIKA BIEGU ─────────────────────────────────────────────────────────
export const TECH = {
  cadence: { label: 'Kadencja', unit: 'kr/min', better: 'up', fmt: v => Math.round(v) },
  stepLen: { label: 'Długość kroku', unit: 'cm', better: null, fmt: v => Math.round(v / 10), scale: 0.1 },
  gct: { label: 'Kontakt z podłożem', unit: 'ms', better: 'down', fmt: v => Math.round(v) },
  vo: { label: 'Oscylacja pionowa', unit: 'cm', better: 'down', fmt: v => (v / 10).toFixed(1).replace('.', ','), scale: 0.1 },
  vr: { label: 'Współczynnik pionowy', unit: '%', better: 'down', fmt: v => v.toFixed(1).replace('.', ',') },
  power: { label: 'Moc', unit: 'W', better: null, fmt: v => Math.round(v) },
};
export function techValue(a, k) { return k === 'cadence' ? a.cadence : a.tech?.[k] ?? null; }
export function techniqueReport(acts, now = Date.now()) {
  const runs = acts.filter(a => isRun(a) && (a.tech || a.cadence)).sort((a, b) => a.start - b.start);
  if (runs.length < 2) return null;
  const cur = runs.filter(a => a.start >= now - 28 * DAY), prev = runs.filter(a => a.start < now - 28 * DAY && a.start >= now - 90 * DAY);
  const rows = Object.entries(TECH).map(([k, d]) => {
    const c = cur.map(a => techValue(a, k)).filter(v => v != null), p = prev.map(a => techValue(a, k)).filter(v => v != null);
    return { k, ...d, now: c.length ? mean(c) : null, prev: p.length ? mean(p) : null };
  }).filter(r => r.now != null || r.prev != null);
  const val = k => rows.find(r => r.k === k)?.now;
  const tips = [];
  const cad = val('cadence'), vr = val('vr'), gct = val('gct');
  if (cad != null && cad < 160) tips.push(`Kadencja ${Math.round(cad)} kr/min jest niska. Spróbuj o 5% więcej kroków (ok. ${Math.round(cad * 1.05)}) przy tym samym tempie — krótszy krok mniej obciąża kolana i zmniejsza podskakiwanie.`);
  else if (cad != null) tips.push(`Kadencja ${Math.round(cad)} kr/min — w dobrym zakresie.`);
  if (vr != null) tips.push(vr > 10 ? `Współczynnik pionowy ${r1(vr)}% — sporo energii idzie w górę zamiast do przodu. Pomaga wyższa kadencja i lekkie pochylenie z kostek.` : vr > 8 ? `Współczynnik pionowy ${r1(vr)}% — przeciętnie; poniżej 8% to ekonomiczny krok.` : `Współczynnik pionowy ${r1(vr)}% — bardzo ekonomiczny krok.`);
  if (gct != null) tips.push(gct > 300 ? `Kontakt z podłożem ${Math.round(gct)} ms jest długi — typowe przy wolnym biegu; skraca się z formą i przebieżkami.` : `Kontakt z podłożem ${Math.round(gct)} ms.`);
  tips.push('Technika zależy od tempa: porównuj biegi o podobnej prędkości. Przy spokojnym biegu kadencja i krok są naturalnie mniejsze.');
  return { rows, tips, series: runs.map(a => ({ id: a.id, start: a.start, pace: a.pace, ...Object.fromEntries(Object.keys(TECH).map(k => [k, techValue(a, k)])) })) };
}

// ── KIEDY BIEGASZ NAJLEPIEJ ────────────────────────────────────────────────
export function bestConditions(acts) {
  const rows = acts.filter(isRun).map(a => ({ a, e: efficiency(a) })).filter(x => x.e);
  if (rows.length < 4) return null;
  const all = mean(rows.map(x => x.e.ef));
  const group = (fn, labels) => {
    const m = new Map();
    for (const x of rows) { const k = fn(x.a); if (k == null) continue; (m.get(k) || m.set(k, []).get(k)).push(x.e.ef); }
    return labels.filter(([k]) => (m.get(k) || []).length >= 2).map(([k, l]) => ({ k, label: l, n: m.get(k).length, diff: (mean(m.get(k)) - all) / all * 100 }));
  };
  const time = group(a => { const h = new Date(a.start).getHours(); return h < 11 ? 'm' : h < 16 ? 'd' : 'e'; }, [['m', 'Rano (do 11)'], ['d', 'W dzień (11–16)'], ['e', 'Wieczorem (od 16)']]);
  const temp = group(a => a.weather?.t == null ? null : a.weather.t < 5 ? 'c' : a.weather.t < 15 ? 'm' : a.weather.t < 22 ? 'w' : 'h', [['c', 'Zimno (< 5°C)'], ['m', 'Chłodno (5–15°C)'], ['w', 'Ciepło (15–22°C)'], ['h', 'Gorąco (> 22°C)']]);
  const coffee = group(a => a.note?.coffee === true ? 'y' : a.note?.coffee === false ? 'n' : null, [['y', 'Z kawą'], ['n', 'Bez kawy']]);
  const sleep = group(a => a.note?.sleep || null, [['bad', 'Po słabym śnie'], ['ok', 'Po zwykłym śnie'], ['good', 'Po dobrym śnie']]);
  return { time, temp, coffee, sleep, n: rows.length };
}

// ── TRASY ──────────────────────────────────────────────────────────────────
function routeDist(r1p, r2p) {
  // średnia odległość punktów trasy 1 od najbliższego punktu trasy 2 (metry)
  const step = Math.max(1, Math.floor(r1p.length / 25));
  let sum = 0, n = 0;
  for (let i = 0; i < r1p.length; i += step) {
    let best = Infinity;
    for (const q of r2p) { const d = haversine(r1p[i][0], r1p[i][1], q[0], q[1]); if (d < best) best = d; }
    sum += best; n++;
  }
  return n ? sum / n : Infinity;
}
export function findRoutes(acts, names = {}) {
  const runs = acts.filter(a => isRun(a) && a.route && a.route.length > 3).sort((a, b) => a.start - b.start);
  const clusters = [];
  for (const a of runs) {
    let hit = null;
    for (const c of clusters) {
      const ref = c.ref;
      if (Math.abs(ref.distance - a.distance) > ref.distance * 0.12) continue;
      if (haversine(ref.route[0][0], ref.route[0][1], a.route[0][0], a.route[0][1]) > 300) continue;
      if (routeDist(a.route, ref.route) < 90 && routeDist(ref.route, a.route) < 90) { hit = c; break; }
    }
    if (hit) hit.runs.push(a); else clusters.push({ id: 'rt' + a.id, ref: a, runs: [a] });
  }
  return clusters.filter(c => c.runs.length >= 2).map((c, i) => {
    const byTime = [...c.runs].sort((x, y) => x.timer / x.distance - y.timer / y.distance);
    const dist = median(c.runs.map(x => x.distance));
    return { id: c.id, name: names[c.id] || `Trasa ${String.fromCharCode(65 + i)} · ${fmtKm(dist, 1)} km`, distance: dist, route: c.ref.route, runs: c.runs, best: byTime[0], ranking: byTime, last: c.runs[c.runs.length - 1] };
  }).sort((a, b) => b.runs.length - a.runs.length);
}
// porównanie km po km z najlepszym przejściem trasy
export function routeCompare(run, best) {
  const n = Math.min(run.splits?.length || 0, best.splits?.length || 0);
  let acc = 0;
  const rows = [];
  for (let i = 0; i < n; i++) { const d = run.splits[i].time - best.splits[i].time; acc += d; rows.push({ km: i + 1, d, acc }); }
  return rows;
}

// ── ODZNAKI I WYZWANIA ─────────────────────────────────────────────────────
export function badges(acts, body, s, planSched = null) {
  const runs = acts.filter(isRun).sort((a, b) => a.start - b.start);
  const at = (pred) => { for (const a of runs) if (pred(a)) return a.start; return null; };
  const cumAt = km => { let c = 0; for (const a of runs) { c += a.distance / 1000; if (c >= km) return a.start; } return null; };
  const nth = n => runs[n - 1]?.start ?? null;
  const totalKm = runs.reduce((x, a) => x + a.distance / 1000, 0);
  const streak = weekStreak(acts);
  const bodyL = [...body].sort((a, b) => a.ts - b.ts);
  const wDrop = bodyL.length ? bodyL[0].weight - Math.min(...bodyL.map(e => e.weight)) : 0;
  const waists = bodyL.filter(e => e.waist != null);
  const waistDrop = waists.length ? waists[0].waist - Math.min(...waists.map(e => e.waist)) : 0;
  const pr5 = recordProgression(acts, 5000).length;
  const okPlan = planSched ? planSched.sessions.filter(x => x.status === 'done' && x.comp?.ok).length : 0;
  const B = [
    ['first', '🏁', 'Pierwszy bieg', 'Pierwszy bieg w Przebiegu', nth(1), `${runs.length}/1`],
    ['r10', '🔟', '10 biegów', '10 biegów', nth(10), `${runs.length}/10`],
    ['r25', '🎽', '25 biegów', '25 biegów', nth(25), `${runs.length}/25`],
    ['r50', '🏅', '50 biegów', '50 biegów', nth(50), `${runs.length}/50`],
    ['r100', '💯', '100 biegów', '100 biegów', nth(100), `${runs.length}/100`],
    ['d5', '5️⃣', 'Pierwsze 5 km', 'Jeden bieg ≥ 5 km', at(a => a.distance >= 5000), null],
    ['d10', '🔥', 'Pierwsze 10 km', 'Jeden bieg ≥ 10 km', at(a => a.distance >= 10000), null],
    ['d21', '🦾', 'Półmaraton', 'Jeden bieg ≥ 21,1 km', at(a => a.distance >= 21097), null],
    ['k50', '🛣️', '50 km łącznie', 'Suma kilometrów', cumAt(50), `${Math.round(totalKm)}/50 km`],
    ['k100', '🗺️', '100 km łącznie', 'Suma kilometrów', cumAt(100), `${Math.round(totalKm)}/100 km`],
    ['k250', '🌍', '250 km łącznie', 'Suma kilometrów', cumAt(250), `${Math.round(totalKm)}/250 km`],
    ['k500', '🚀', '500 km łącznie', 'Suma kilometrów', cumAt(500), `${Math.round(totalKm)}/500 km`],
    ['s4', '📅', '4 tygodnie z rzędu', 'Co najmniej 1 bieg w każdym tygodniu', streak >= 4 ? Date.now() : null, `${streak}/4 tyg.`],
    ['s12', '🗓️', '12 tygodni z rzędu', 'Co najmniej 1 bieg w każdym tygodniu', streak >= 12 ? Date.now() : null, `${streak}/12 tyg.`],
    ['early', '🌅', 'Ranny ptaszek', 'Bieg przed 7:00', at(a => new Date(a.start).getHours() < 7), null],
    ['night', '🌙', 'Nocny marek', 'Bieg po 21:00', at(a => new Date(a.start).getHours() >= 21), null],
    ['frost', '🥶', 'Mróz niestraszny', 'Bieg przy 0°C lub mniej', at(a => a.weather?.t != null && a.weather.t <= 0), null],
    ['heat', '🥵', 'Upał', 'Bieg przy 25°C lub więcej', at(a => a.weather?.t != null && a.weather.t >= 25), null],
    ['wind', '🌬️', 'Pod wiatr', 'Bieg przy wietrze ≥ 30 km/h', at(a => a.weather?.wind != null && a.weather.wind >= 30), null],
    ['pr3', '🏆', 'Seria rekordów', '3 razy poprawiony rekord 5 km', pr5 >= 3 ? Date.now() : null, `${pr5}/3`],
    ['plan10', '✅', 'Zgodnie z planem', '10 treningów zgodnych z planem', okPlan >= 10 ? Date.now() : null, `${okPlan}/10`],
    ['kg3', '⚖️', 'Minus 3 kg', 'Od pierwszego pomiaru', wDrop >= 3 ? Date.now() : null, bodyL.length ? `${r1(Math.max(0, wDrop))}/3 kg` : 'brak pomiarów'],
    ['waist5', '📏', 'Minus 5 cm w pasie', 'Od pierwszego pomiaru pasa', waistDrop >= 5 ? Date.now() : null, waists.length ? `${r1(Math.max(0, waistDrop))}/5 cm` : 'brak pomiarów'],
  ];
  return B.map(([id, icon, name, desc, date, prog]) => ({ id, icon, name, desc, earned: date != null, date, prog }));
}
export function monthChallenges(acts, s, now = Date.now()) {
  const d = new Date(now), from = new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const runs = acts.filter(a => isRun(a) && a.start >= from && a.start < to);
  const km = runs.reduce((x, a) => x + a.distance / 1000, 0);
  const prevKm = [1, 2].map(k => acts.filter(a => isRun(a) && a.start >= new Date(d.getFullYear(), d.getMonth() - k, 1).getTime() && a.start < new Date(d.getFullYear(), d.getMonth() - k + 1, 1).getTime()).reduce((x, a) => x + a.distance / 1000, 0));
  const kmTarget = Math.max(20, Math.ceil(Math.max(...prevKm, 0) * 1.1 / 5) * 5);
  const split = intensitySplit(acts, s, from, to), tot = split[0] + split[1] + split[2];
  const easy = tot ? split[0] / tot : 0;
  const long = runs.filter(a => a.timer >= 60 * 60).length;
  const daysLeft = Math.ceil((to - now) / DAY);
  return { daysLeft, items: [
    { icon: '🛣️', name: `${kmTarget} km w miesiącu`, cur: km, target: kmTarget, text: `${r1(km)} / ${kmTarget} km` },
    { icon: '🐢', name: '80% czasu łatwo', cur: easy, target: 0.8, text: `${pct(easy)} / 80%` },
    { icon: '⏱️', name: '2 biegi powyżej godziny', cur: long, target: 2, text: `${long} / 2` },
    { icon: '📆', name: '12 biegów', cur: runs.length, target: 12, text: `${runs.length} / 12` },
  ] };
}

// ── BUTY ───────────────────────────────────────────────────────────────────
export function shoeStats(acts, s) {
  return (s.shoes || []).map(sh => {
    const runs = acts.filter(a => isRun(a) && a.shoe === sh.id);
    const km = (sh.startKm || 0) + runs.reduce((x, a) => x + a.distance / 1000, 0);
    const limit = sh.limit || 700;
    return { ...sh, km, runs: runs.length, limit, ratio: km / limit, warn: km >= limit * 0.9 };
  });
}
