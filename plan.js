// Przebieg — plan treningowy, który sam się przesuwa.
// Plan to kolejka treningów w ustalonej kolejności. Daty nie są zapisane na sztywno:
// liczymy je za każdym razem od ostatniego wykonanego treningu, więc opuszczony dzień
// nigdy nie przepada — trening przechodzi na najbliższy możliwy dzień, a reszta planu za nim.
import { isRun, fmtDur, fmtPace, vdot as vdotOf, timeForVdot, currentForm, weekStart } from './core.js';
import { zonesFor, zoneTimes, TYPES, intensitySplit, paceAtHr, easyHrMax } from './analysis.js';

const DAY = 864e5;
export const DAY_NAMES = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
export const DAY_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
export const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return dayStart(d.getTime()); };

// ── SZABLON: „Kondycja i mniej brzucha” — 12 tygodni, co 4. tydzień lżejszy ─
// kind: easy | long | quality | strides | test;  min = czas całkowity w minutach
const BASE_WEEKS = [
  { E: 30, Q: { kind: 'strides', min: 30, reps: 4 }, L: 40 },
  { E: 30, Q: { kind: 'strides', min: 35, reps: 6 }, L: 45 },
  { E: 35, Q: { kind: 'quality', reps: 3, work: 5, rest: 2 }, L: 50 },
  { E: 30, Q: { kind: 'strides', min: 30, reps: 4 }, L: 40, light: true },
  { E: 35, Q: { kind: 'quality', reps: 3, work: 7, rest: 2 }, L: 55 },
  { E: 40, Q: { kind: 'quality', reps: 3, work: 8, rest: 2 }, L: 60 },
  { E: 40, Q: { kind: 'fartlek', reps: 6, work: 2, rest: 2 }, L: 65 },
  { E: 30, Q: { kind: 'quality', reps: 2, work: 8, rest: 2 }, L: 45, light: true },
  { E: 40, Q: { kind: 'quality', reps: 3, work: 10, rest: 2 }, L: 70 },
  { E: 45, Q: { kind: 'quality', reps: 2, work: 12, rest: 3 }, L: 75 },
  { E: 45, Q: { kind: 'quality', reps: 1, work: 20, rest: 0 }, L: 80 },
  { E: 30, Q: { kind: 'strides', min: 25, reps: 4 }, L: 0, test: true, light: true },
];
export const GOALS = {
  base: { label: 'Kondycja i mniej brzucha', weeks: BASE_WEEKS.length },
  '5k': { label: 'Szybsze 5 km', dist: 5000 },
  '10k': { label: '10 km', dist: 10000 },
  hm: { label: 'Półmaraton', dist: 21097.5 },
};
export const planWeeks = plan => plan.sessions ? Math.max(...plan.sessions.map(s => s.week)) : BASE_WEEKS.length;
export const planLabel = plan => plan.label || GOALS[plan.goal]?.label || 'Plan';

// lista treningów planu; kolejność w tygodniu zależy od liczby dni
export function planSessions(plan) {
  if (plan.sessions) return plan.sessions.map(x => ({ ...x }));
  const per = plan.days.length;
  const out = [];
  BASE_WEEKS.forEach((w, wi) => {
    const E = { kind: 'easy', min: w.E };
    const L = w.test ? { kind: 'test', min: 40 } : { kind: 'long', min: w.L };
    const Q = { ...w.Q, min: w.Q.min ?? (20 + w.Q.reps * w.Q.work + Math.max(0, w.Q.reps - 1) * w.Q.rest) };
    const order = per <= 2 ? [Q, L] : per === 3 ? [E, Q, L] : per === 4 ? [E, Q, { kind: 'easy', min: Math.max(25, w.E - 5) }, L] : [E, Q, { kind: 'easy', min: w.E }, { kind: 'easy', min: Math.max(25, w.E - 5) }, L];
    order.forEach((s, i) => out.push({ id: `w${wi + 1}-${i + 1}`, week: wi + 1, light: !!w.light, ...s }));
  });
  return out;
}

// opis treningu z tętnem liczonym z aktualnego progu
export function sessionInfo(s, set, plan = null) {
  const z = zonesFor(set.lthr);
  const easy = `${z[1].lo}–${z[1].hi}`, thr = `${z[3].lo}–${z[3].hi}`, z5 = `${z[4].lo}+`;
  const P = plan?.meta?.paces;
  const ep = P?.easy ? ` (ok. ${fmtPace(P.easy[0])}–${fmtPace(P.easy[1])}/km)` : '';
  const tp = P ? `, tempo ok. ${fmtPace(P.thr)}/km` : '';
  const ip = P ? `, tempo ok. ${fmtPace(P.int)}/km` : '';
  switch (s.kind) {
    case 'tempo': return { title: `Bieg w tempie progowym ${s.work} min`, tone: 'hard', short: `${s.work} min na progu`,
      steps: ['10–15 min rozgrzewki w strefie 2.', `${s.work} min ciągle w strefie progu: ${thr} bpm${tp}.`, '10 min schłodzenia.', 'Równo od początku do końca — lepiej trochę za wolno niż za szybko.'] };
    case 'progression': return { title: `Bieg narastający ${s.min} min`, tone: 'mid', short: `${s.min} min, końcówka mocniej`,
      steps: [`${s.min - s.work} min spokojnie, tętno ${easy} bpm${ep}.`, `Ostatnie ${s.work} min stopniowo szybciej, aż do strefy progu (${thr} bpm).`, 'Uczy kończyć mocno na zmęczonych nogach.'] };
    case 'intervals': return { title: `Interwały ${s.reps} × ${s.work} min`, tone: 'hard', short: `${s.reps}×${s.work} min szybko`,
      steps: ['15 min rozgrzewki + 3 przebieżki.', `${s.reps} × ${s.work} min szybko (tętno dochodzi do ${z5})${ip}, przerwa ${s.rest} min truchtu.`, '10 min schłodzenia.', 'Wszystkie odcinki w tym samym tempie — ostatni ma być równy pierwszemu.'] };
    case 'race': return { title: `Sprawdzian: ${s.label}`, tone: 'hard', short: `${s.label} na czas`,
      steps: ['15 min rozgrzewki + 3 przebieżki.', `${s.label} równym, mocnym tempem${s.targetPace ? ` — cel ok. ${fmtPace(s.targetPace)}/km` : ''}. Pierwszy km nie szybciej niż średnio.`, 'Po biegu 2–3 dni luźno.'] };
    case 'easy': return { title: `Łatwy bieg ${s.min} min`, tone: 'easy', short: `${s.min} min spokojnie`,
      steps: [`${s.min} min spokojnie, tętno ${easy} bpm (strefa 2)${ep}.`, 'Jeśli tętno ucieka wyżej — zwolnij albo przejdź 1–2 min marszem. To normalne.'] };
    case 'long': return { title: `Długi bieg ${s.min} min`, tone: 'easy', short: `${s.min} min spokojnie`,
      steps: [`${s.min} min w równym, spokojnym tempie, tętno ${easy} bpm${ep}.`, 'Zacznij wolniej, niż masz ochotę. Ten trening najmocniej buduje wytrzymałość i spala tłuszcz.', 'Woda przed biegiem; przy 60+ min weź łyk w połowie.'] };
    case 'strides': return { title: `Bieg z przebieżkami ${s.min} min`, tone: 'mid', short: `${s.min} min + ${s.reps}×20 s`,
      steps: [`${s.min - 5} min spokojnie, tętno ${easy} bpm.`, `Potem ${s.reps} × 20 s szybciej (luźno, nie sprint), między nimi 1 min marszu lub truchtu.`, 'Przebieżki uczą nogi szybszego kroku bez zmęczenia.'] };
    case 'quality': return { title: s.reps === 1 ? `Bieg progowy ${s.work} min` : `Interwały progowe ${s.reps} × ${s.work} min`, tone: 'hard', short: s.reps === 1 ? `${s.work} min na progu` : `${s.reps}×${s.work} min na progu`,
      steps: ['10 min rozgrzewki w strefie 2.', s.reps === 1 ? `${s.work} min ciągle w strefie progu: ${thr} bpm${tp}.` : `${s.reps} × ${s.work} min w strefie progu: ${thr} bpm${tp}, między nimi ${s.rest} min truchtu.`, '10 min schłodzenia spokojnie.', 'Tempo „komfortowo ciężkie” — mówisz pojedyncze słowa, ale nie walczysz o oddech.'] };
    case 'fartlek': return { title: `Fartlek ${s.reps} × ${s.work} min`, tone: 'hard', short: `${s.reps}×${s.work} min mocniej`,
      steps: ['10 min rozgrzewki w strefie 2.', `${s.reps} × ${s.work} min mocno (tętno dochodzi do ${z5}), po każdym ${s.rest} min truchtu.`, '10 min schłodzenia.'] };
    case 'test': return { title: 'Sprawdzian: 5 km na czas', tone: 'hard', short: '5 km najszybciej, jak dasz radę',
      steps: ['15 min rozgrzewki + 3 krótkie przebieżki.', '5 km równym, mocnym tempem — pierwszy km nie szybciej niż średnio.', 'Porównaj wynik z rekordem z zakładki Postęp. Potem nowy plan albo powtórka z wyższego poziomu.'] };
  }
  return { title: 'Trening', tone: 'easy', short: '', steps: [] };
}

// czy bieg zgadza się z planem
export function compliance(s, run, set) {
  if (!run) return { ok: true, label: 'Oznaczony ręcznie' };
  const notes = [];
  let ok = true;
  const zt = zoneTimes(run, set.lthr);
  const tot = zt ? zt.reduce((a, b) => a + b, 0) : 0;
  const hard = zt && tot ? (zt[4] + zt[5]) / tot : null;
  const aboveEasy = zt && tot ? (zt[3] + zt[4] + zt[5]) / tot : null;
  const mins = run.timer / 60;
  if (s.kind === 'easy' || s.kind === 'long') {
    if (aboveEasy != null && aboveEasy > 0.3) { ok = false; notes.push(`za mocno — ${Math.round(aboveEasy * 100)}% czasu powyżej strefy 2`); }
  } else if (['quality', 'fartlek', 'tempo', 'intervals'].includes(s.kind)) {
    if (hard != null && hard < 0.1) { ok = false; notes.push('za lekko — mało czasu na progu'); }
  }
  if (s.kind === 'race') { const b = run.bests?.[s.dist]; if (b) notes.push(`${s.label} w ${fmtDur(b)}`); else { ok = false; notes.push(`krócej niż ${s.label}`); } }
  else if (s.kind !== 'test') {
    if (mins < s.min * 0.75) { ok = false; notes.push(`krócej (${Math.round(mins)} z ${s.min} min)`); }
    else if (mins > s.min * 1.35) notes.push(`dłużej (${Math.round(mins)} min)`);
  } else if (run.bests?.[5000]) notes.push(`5 km w ${fmtDur(run.bests[5000])}`);
  return { ok, label: ok ? (notes.length ? 'Zrobione · ' + notes.join(', ') : 'Zgodnie z planem') : notes.join(', ') };
}

// ── HARMONOGRAM ────────────────────────────────────────────────────────────
// Każdy trening ma swój stały dzień (np. wt / czw / nd). Opuszczony trening przesuwa się
// SAM — można go nadrobić do dnia przed kolejnym treningiem z planu. Reszta planu stoi.
const mondayOf = ts => { const d = dayStart(ts); const wd = (new Date(d).getDay() + 6) % 7; return addDays(d, -wd); };
const offsetOf = day => (day + 6) % 7;   // pn=0 … nd=6
export function datedSessions(plan) {
  const mon = mondayOf(plan.start), startDay = dayStart(plan.start);
  const days = [...plan.days].sort((a, b) => offsetOf(a) - offsetOf(b));
  return planSessions(plan).map(s => {
    const idx = Number(s.id.split('-')[1]) - 1;
    const day = s.day ?? days[idx];   // dzień ustawiony na stałe (po zmianie dni) albo z kolejności
    return { ...s, planned: addDays(mon, (s.week - 1) * 7 + offsetOf(day)) };
  }).filter(s => s.planned >= startDay);
}
export function planSchedule(plan, acts, set, now = Date.now()) {
  const list = datedSessions(plan);
  const marks = plan.marks || {}, moves = plan.moves || {};
  const today = dayStart(now);
  list.forEach((s, i) => {
    s.date = moves[s.id] != null ? dayStart(moves[s.id]) : s.planned;
    const nextPlanned = i + 1 < list.length ? list[i + 1].planned : addDays(s.planned, 4);
    s.deadline = Math.max(s.date, addDays(nextPlanned, -1));   // do kiedy można nadrobić
    s.moved = s.date !== s.planned;
  });
  for (const s of list) {
    const m = marks[s.id];
    if (!m) continue;
    s.status = m.s === 'skip' ? 'skipped' : m.s === 'missed' ? 'missed' : 'done'; s.at = m.ts; s.manual = !m.runId;
    if (m.runId) { s.runId = m.runId; const r = acts.find(a => a.id === m.runId); if (r) s.comp = compliance(s, r, set); }
  }
  // dopasowanie biegów: bieg z dnia D zalicza trening zaplanowany na D (albo dzień później),
  // a jeśli takiego nie ma — najstarszy zaległy, którego termin nadrobienia jeszcze trwa
  const startDay = dayStart(plan.start);
  const usedRuns = new Set(Object.values(marks).map(m => m.runId).filter(Boolean));
  const runs = acts.filter(a => isRun(a) && a.start >= startDay && !usedRuns.has(a.id)).sort((a, b) => a.start - b.start);
  for (const r of runs) {
    const D = dayStart(r.start);
    const cands = list.filter(s => !s.status && addDays(s.date, -1) <= D && D <= s.deadline);
    if (!cands.length) continue;
    const pick = cands.find(s => s.date === D) || cands.sort((a, b) => a.date - b.date)[0];
    pick.status = 'done'; pick.at = r.start; pick.runId = r.id; pick.comp = compliance(pick, r, set);
  }
  for (const s of list) {
    if (s.status) continue;
    s.status = today > s.deadline ? 'missed' : s.date < today ? 'overdue' : s.date === today ? 'today' : 'upcoming';
  }
  const open = list.filter(s => ['overdue', 'today', 'upcoming'].includes(s.status)).sort((a, b) => a.date - b.date || a.planned - b.planned);
  const done = list.filter(s => s.status === 'done').length;
  const closed = list.filter(s => ['done', 'skipped', 'missed'].includes(s.status)).length;
  const next = open[0] || null;
  return { sessions: list, open, done, closed, total: list.length, next, week: next ? next.week : list[list.length - 1]?.week, finished: !next };
}
export function newPlan(days, now = Date.now()) {
  return { goal: 'base', days: [...days].sort((a, b) => offsetOf(a) - offsetOf(b)), start: dayStart(now), marks: {}, moves: {}, updated: Date.now() };
}

// ══ GENERATOR PLANU ═════════════════════════════════════════════════════════
const r5 = v => Math.max(5, Math.round(v / 5) * 5);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
// prędkość (m/min) dla danego % VO2max — odwrotność wzoru Danielsa
function velAt(vd, frac) { const vo2 = vd * frac, a = 0.000104, b = 0.182258, c = -4.6 - vo2; return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); }
export function pacesFor(vd) {  // tempa Danielsa (nieużywane w planie — tylko pomocniczo)
  const p = f => 60000 / velAt(vd, f);   // s/km
  return { easy: [p(0.74), p(0.62)], thr: p(0.88), int: p(0.98) };
}

// Co mówią ostatnie tygodnie biegania
export function analyzeHistory(acts, s, now = Date.now()) {
  const W = 8, from = now - W * 7 * 864e5;
  const runs = acts.filter(a => isRun(a) && a.start >= from && a.start <= now);
  const weeks = new Map();
  for (const a of runs) { const k = weekStart(a.start); const o = weeks.get(k) || { n: 0, min: 0, km: 0 }; o.n++; o.min += a.timer / 60; o.km += a.distance / 1000; weeks.set(k, o); }
  const active = [...weeks.values()];
  const last4 = runs.filter(a => a.start >= now - 28 * 864e5);
  const longest = Math.max(0, ...(last4.length ? last4 : runs).map(a => a.timer / 60));
  const split = intensitySplit(acts, s, from, now), tot = split[0] + split[1] + split[2];
  const easyShare = tot ? split[0] / tot : null;
  const form = currentForm(acts, now);
  const lastRun = runs.length ? Math.max(...runs.map(a => a.start)) : null;
  const h = {
    runs: runs.length, weeksActive: active.length,
    perWeek: active.length ? mean(active.map(w => w.n)) : 0,
    weekMin: active.length ? mean(active.map(w => w.min)) : 0,
    weekKm: active.length ? mean(active.map(w => w.km)) : 0,
    longest, easyShare, vdot: form ? form.vdot : null, daysSince: lastRun ? (now - lastRun) / 864e5 : null,
    easyPace: paceAtHr(acts, easyHrMax(s), now - 42 * 864e5, now + 1)?.pace ?? null,
  };
  const L = [];
  const c1 = v => v.toFixed(1).replace('.', ',');
  if (!runs.length) L.push('Brak biegów z ostatnich 8 tygodni — plan zacznie od bardzo spokojnego wprowadzenia.');
  else {
    L.push(`Ostatnie 8 tygodni: ${runs.length} biegów w ${active.length} tyg., średnio ${c1(h.perWeek)} biegu, ${Math.round(h.weekMin)} min i ${c1(h.weekKm)} km tygodniowo.`);
    L.push(`Najdłuższy bieg z 4 tygodni: ${Math.round(longest)} min — od tego startuje długi bieg w planie.`);
    if (easyShare != null) L.push(easyShare < 0.6 ? `Tylko ${Math.round(easyShare * 100)}% czasu biegałeś łatwo. Pierwsze tygodnie planu uczą spokojnego biegu — to najszybsza droga do poprawy.` : `${Math.round(easyShare * 100)}% czasu łatwo — dobra baza pod mocniejsze treningi.`);
    if (form) L.push(`Forma (VDOT) ${c1(form.vdot)}: dziś ok. ${fmtDur(timeForVdot(form.vdot, 5000))} na 5 km i ${fmtDur(timeForVdot(form.vdot, 10000))} na 10 km.`);
    if (h.daysSince != null && h.daysSince > 14) L.push(`Ostatni bieg ${Math.round(h.daysSince)} dni temu — plan zacznie łagodniej.`);
  }
  h.lines = L;
  return h;
}

// opts: { goal, weeks, target (s, opcjonalnie), days[], longDay, maxMin (0 = bez limitu), noIntervals, start }
export function generatePlan(opts, hist, s) {
  const goal = opts.goal, G = GOALS[goal];
  const weeks = Math.max(6, Math.min(20, opts.weeks || 12));
  const days = [...opts.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const per = days.length;
  const longIdx = Math.max(0, days.indexOf(opts.longDay ?? days[days.length - 1]));
  const maxMin = opts.maxMin || 999;
  const returning = !hist.runs || (hist.daysSince != null && hist.daysSince > 14);
  const c1 = v => v.toFixed(1).replace('.', ',');
  const vdNow = hist.vdot || 30;
  let check = null, vdTarget = null;
  if (G.dist && opts.target) {
    vdTarget = vdotOf(G.dist, opts.target);
    const months = weeks / 4.35, gain = vdTarget - vdNow;
    const realistic = timeForVdot(vdNow + 1.2 * months, G.dist);
    check = gain <= 1.2 * months ? { level: 'ok', text: `Cel realny: potrzebujesz formy (VDOT) ${c1(vdTarget)}, masz ${c1(vdNow)}.` }
      : gain <= 2 * months ? { level: 'warn', text: `Cel ambitny: wymaga VDOT ${c1(vdTarget)} (masz ${c1(vdNow)}). Możliwy przy pełnej regularności; bezpieczniej ok. ${fmtDur(realistic)}.` }
      : { level: 'bad', text: `Cel bardzo trudny w ${weeks} tyg.: wymaga VDOT ${c1(vdTarget)} przy obecnym ${c1(vdNow)}. Realny wynik to ok. ${fmtDur(realistic)} — plan liczy tempa pod taki cel.` };
    if (check.level === 'bad') vdTarget = vdNow + 1.2 * months;
  }
  const vdWork = vdTarget ? (vdNow + vdTarget) / 2 : vdNow;
  // tempa z Twoich danych: łatwe = tempo przy górze strefy 2, próg = tempo progowe z ustawień (Zepp)
  const thr = s.thrPace;
  const e0 = hist.easyPace ? Math.max(hist.easyPace - 10, thr + 45) : null;   // łatwe zawsze wyraźnie wolniej niż próg
  const paces = { easy: e0 ? [e0, e0 + 50] : null, thr, int: thr - 25 };
  const peakByGoal = { base: 60 * per, '5k': 55 * per, '10k': 65 * per, hm: 80 * per }[goal];
  const longCap = { base: 90, '5k': 70, '10k': 90, hm: 120 }[goal];
  let vol = Math.max(per * 25, Math.min(hist.weekMin || per * 30, peakByGoal)) * (returning ? 0.8 : 1);
  let long = Math.max(30, Math.min(longCap, Math.round(hist.longest || 35))) * (returning ? 0.8 : 1);
  const race = goal !== 'base';
  const introWeeks = hist.easyShare != null && hist.easyShare < 0.6 ? 3 : 2;
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    const cutback = w % 4 === 0 && w < weeks - 1;
    const taper = race && w >= weeks - 1;
    const last = w === weeks;
    if (w > 1 && !cutback && !taper) { vol = Math.min(peakByGoal, vol * 1.08); long = Math.min(longCap, long + 5); }
    const wVol = vol * (cutback ? 0.75 : 1) * (taper ? (last ? 0.6 : 0.8) : 1);
    const wLong = r5(Math.min(long * (cutback ? 0.8 : 1) * (taper ? 0.7 : 1), longCap));
    let Q;
    const phase = w / weeks;
    if (w <= introWeeks || cutback) Q = { kind: 'strides', min: Math.min(maxMin, r5(Math.max(25, wVol / per))), reps: w <= 1 ? 4 : 6 };
    else if (goal === 'base') {
      const t = Math.min(30, 10 + (w - introWeeks) * 2);
      if (w % 2 === 0) Q = { kind: 'tempo', work: r5(t) };
      else Q = opts.noIntervals ? { kind: 'progression', min: Math.min(maxMin, r5(wVol / per + 5)), work: Math.min(15, 5 + w) } : { kind: 'fartlek', reps: Math.min(8, 4 + Math.floor(w / 3)), work: 2, rest: 2 };
    } else if (goal === '5k') {
      if (phase < 0.45) Q = opts.noIntervals ? { kind: 'tempo', work: r5(12 + w * 2) } : { kind: 'quality', reps: 3, work: Math.min(10, 4 + w), rest: 2 };
      else Q = opts.noIntervals ? { kind: 'progression', min: Math.min(maxMin, 45), work: 15 } : { kind: 'intervals', reps: Math.min(6, 4 + Math.floor((w - weeks * 0.45) / 2)), work: w % 2 ? 3 : 4, rest: 2 };
    } else {
      const t = Math.min(goal === 'hm' ? 40 : 30, 12 + (w - introWeeks) * 3);
      Q = phase < 0.4 || opts.noIntervals ? { kind: 'tempo', work: r5(t) } : (w % 2 ? { kind: 'quality', reps: goal === 'hm' ? 3 : 2, work: Math.min(15, r5(t / 2)), rest: 3 } : { kind: 'intervals', reps: 5, work: 3, rest: 2 });
    }
    if (taper && !last) Q = { kind: 'quality', reps: 2, work: 6, rest: 2 };
    if (['tempo', 'quality', 'intervals', 'fartlek'].includes(Q.kind)) {
      const calc = () => (Q.kind === 'tempo' ? Q.work : Q.reps * Q.work + Math.max(0, Q.reps - 1) * (Q.rest || 0)) + (Q.kind === 'intervals' ? 25 : 20);
      Q.min = calc();
      while (Q.min > maxMin && ((Q.kind === 'tempo' && Q.work > 10) || (Q.kind !== 'tempo' && Q.reps > 2))) { if (Q.kind === 'tempo') Q.work -= 5; else Q.reps--; Q.min = calc(); }
    }
    const nEasy = Math.max(0, per - 2);
    const eMin = nEasy ? Math.min(maxMin, Math.max(25, r5((wVol - wLong - Q.min) / nEasy))) : 0;
    let L = { kind: 'long', min: wLong };
    if (last) L = race ? { kind: 'race', dist: G.dist, label: { '5k': '5 km', '10k': '10 km', hm: 'półmaraton' }[goal], min: Math.round(timeForVdot(vdWork, G.dist) / 60) + 25, targetPace: timeForVdot(vdWork, G.dist) / G.dist * 1000 }
      : { kind: 'race', dist: 5000, label: '5 km', min: 50 };
    let slots = new Array(per).fill(null);
    if (per === 1) slots = [L];
    else {
      slots[longIdx] = L;
      // akcent w dniu najdalej (w dniach tygodnia) od długiego biegu, w obie strony
      const off = d => (d + 6) % 7, lo = off(days[longIdx]);
      let qi = -1, bestGap = -1;
      for (let i = 0; i < per; i++) { if (i === longIdx) continue; const a = (off(days[i]) - lo + 7) % 7, gap = Math.min(a, 7 - a); if (gap > bestGap) { bestGap = gap; qi = i; } }
      slots[qi] = Q;
      for (let i = 0; i < per; i++) if (!slots[i]) slots[i] = { kind: 'easy', min: eMin };
    }
    slots.forEach((x, i) => out.push({ id: `w${w}-${i + 1}`, week: w, light: cutback || taper, ...x }));
  }
  const label = G.label + (G.dist && opts.target ? ` · cel ${fmtDur(opts.target)}` : '');
  return {
    goal, label, days, start: dayStart(opts.start || Date.now()), sessions: out, marks: {}, moves: {}, updated: Date.now(),
    meta: { paces, vdNow, vdTarget, check, hist: hist.lines, weeks, opts: { ...opts, days } },
  };
}

// ── ZMIANA DNI W TRAKCIE PLANU ─────────────────────────────────────────────
// Zamknięte treningi (zrobione, pominięte, przepadłe) zostają zapisane na stałe razem z biegiem,
// a otwarte dostają nowe dni w tych samych tygodniach planu. Długi bieg idzie na wybrany dzień,
// akcent na dzień najdalej od niego, łatwe biegi na pozostałe.
export function changePlanDays(plan, acts, set, newDays, longDay, now = Date.now()) {
  const sorted = [...newDays].sort((a, b) => offsetOf(a) - offsetOf(b));
  const oldDays = [...plan.days].sort((a, b) => offsetOf(a) - offsetOf(b));
  const sessions = planSessions(plan).map(s => ({ ...s, day: s.day ?? oldDays[Number(s.id.split('-')[1]) - 1] }));
  const sch = planSchedule(plan, acts, set, now);
  const marks = { ...(plan.marks || {}) };
  for (const x of sch.sessions) {
    if (marks[x.id]) continue;
    if (x.status === 'done' && x.runId) marks[x.id] = { s: 'done', ts: x.at, runId: x.runId };
    else if (x.status === 'missed') marks[x.id] = { s: 'missed', ts: x.planned };
  }
  const open = new Set(sch.sessions.filter(x => !marks[x.id]).map(x => x.id));
  const byWeek = {};
  for (const x of sessions) if (open.has(x.id)) (byWeek[x.week] ||= []).push(x);
  const lo = offsetOf(longDay);
  const mon0 = mondayOf(plan.start);
  // jeśli dziś już był bieg, nowe dni liczymy od jutra (bez dwóch treningów jednego dnia)
  const today = acts.some(a => isRun(a) && dayStart(a.start) === dayStart(now)) ? addDays(dayStart(now), 1) : dayStart(now);
  for (const [wk, list] of Object.entries(byWeek)) {
    // w bieżącym tygodniu tylko dni od dziś; dni, które już minęły, idą na koniec kolejki
    const dateOf = d => addDays(mon0, (wk - 1) * 7 + offsetOf(d));
    const realToday = dayStart(now);
    const free = [...sorted.filter(d => dateOf(d) >= today), ...sorted.filter(d => dateOf(d) < realToday), ...sorted.filter(d => dateOf(d) >= realToday && dateOf(d) < today)];
    const isFree = d => dateOf(d) >= today;
    const take = d => free.splice(free.indexOf(d), 1);
    const isLong = x => x.kind === 'long' || x.kind === 'race' || x.kind === 'test';
    const longS = list.find(isLong);
    if (longS && free.includes(longDay) && isFree(longDay)) { longS.day = longDay; take(longDay); }
    else if (longS) { const d = [...free].reverse().find(isFree) ?? free[free.length - 1]; longS.day = d; take(d); }
    const hard = list.find(x => x !== longS && !['easy', 'long'].includes(x.kind));
    if (hard && free.length) {
      const pool = free.filter(isFree);
      const far = pool.length ? [...pool].sort((a, b) => { const g = d => { const k = (offsetOf(d) - lo + 7) % 7; return Math.min(k, 7 - k); }; return g(b) - g(a); })[0] : free[0];
      hard.day = far; take(far);
    }
    for (const x of list) if (x !== longS && x !== hard) { if (free.length) { x.day = free[0]; take(free[0]); } }
  }
  const moves = {};   // przełożenia otwartych treningów tracą sens po zmianie dni
  for (const [k, v] of Object.entries(plan.moves || {})) if (!open.has(k)) moves[k] = v;
  return { ...plan, days: sorted, sessions, marks, moves, longDay, meta: plan.meta ? { ...plan.meta, opts: { ...(plan.meta.opts || {}), days: sorted, longDay } } : plan.meta, updated: Date.now() };
}
export function mondayOfWeek(ts) { return mondayOf(ts); }
