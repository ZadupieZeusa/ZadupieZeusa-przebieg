// Przebieg — plan treningowy, który sam się przesuwa.
// Plan to kolejka treningów w ustalonej kolejności. Daty nie są zapisane na sztywno:
// liczymy je za każdym razem od ostatniego wykonanego treningu, więc opuszczony dzień
// nigdy nie przepada — trening przechodzi na najbliższy możliwy dzień, a reszta planu za nim.
import { isRun, fmtDur, fmtPace, fmtKm, vdot as vdotOf, timeForVdot, currentForm, weekStart } from './core.js?v=20261113d';
import { zonesFor, zoneTimes, TYPES, intensitySplit, paceAtHr, easyHrMax, countReps, efficiency } from './analysis.js?v=20261113d';

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

// ── OCENA WYKONANIA TRENINGU (0–100%, jak w Zepp) ─────────────────────────
// Cztery części z wagami: intensywność 40, czas/dystans 30, struktura 20, termin 10.
// Brakująca część (np. bez tętna) nie karze — wagi rozkładają się na pozostałe.
const clamp01 = v => Math.max(0, Math.min(1, v));
const pc = v => Math.round(v * 100) + '%';
export const VERDICTS = [[90, 'Wzorowo'], [75, 'Dobrze'], [55, 'Częściowo'], [0, 'Słabo']];
export const verdictOf = p => VERDICTS.find(([m]) => p >= m)[1];
export function scoreSession(s, run, set) {
  if (!run) return { ok: true, pct: null, label: 'Oznaczony ręcznie', parts: [], verdict: null, tip: null };
  const z = zonesFor(set.lthr);
  const zt = zoneTimes(run, set.lthr);
  const tot = zt ? zt.reduce((a, b) => a + b, 0) : 0;
  const hasHr = !!zt && tot >= run.timer * 0.5;
  const sh = i => hasHr ? zt[i] / tot : 0;
  const easyShare = sh(0) + sh(1) + sh(2);
  const hardMin = hasHr ? (zt[4] + zt[5]) / 60 : 0;
  const mins = run.timer / 60, k = s.kind;
  const parts = [];
  const add = (key, label, w, score, plan, done, tip = null) => parts.push({ key, label, w, score: clamp01(score), plan, done, tip });
  const easyKinds = ['easy', 'long', 'strides'];
  const work = k === 'tempo' || (k === 'quality' && s.reps === 1) ? s.work : (s.reps || 0) * (s.work || 0);

  // 1. intensywność
  if (!hasHr) add('int', 'Intensywność', 40, 0.75, 'wg tętna', 'brak tętna', 'Biegaj z pomiarem tętna — bez niego ocena intensywności jest tylko przybliżona.');
  else if (easyKinds.includes(k)) {
    const tgt = k === 'strides' ? 0.75 : 0.85;
    add('int', 'Intensywność', 40, (easyShare - 0.4) / (tgt - 0.4), `≥ ${pc(tgt)} czasu do ${z[1].hi} bpm`, `${pc(easyShare)} czasu`,
      easyShare < tgt ? `Za mocno jak na spokojny bieg. Trzymaj tętno do ${z[1].hi} bpm — zwolnij albo przejdź chwilę marszem, zwłaszcza pod górę.` : null);
  } else if (['quality', 'tempo', 'intervals', 'fartlek'].includes(k)) {
    const r = work ? hardMin / work : 1;
    add('int', 'Intensywność', 40, r < 0.8 ? r / 0.8 : r <= 1.6 ? 1 : 1 - (r - 1.6) * 0.8, `${work} min od ${z[3].lo} bpm`, `${Math.round(hardMin)} min`,
      r < 0.8 ? `Odcinki za lekkie — w części mocnej tętno ma dojść do ${z[3].lo}–${z[3].hi} bpm.` : r > 1.6 ? 'Za dużo mocnej pracy — rozgrzewka, przerwy i schłodzenie mają być naprawdę spokojne.' : null);
  } else if (k === 'progression') {
    const okE = clamp01((easyShare - 0.4) / 0.25), okH = clamp01(hardMin / Math.max(1, s.work * 0.5));
    add('int', 'Intensywność', 40, 0.6 * okE + 0.4 * okH, `spokojnie + ${s.work} min mocniej`, `${pc(easyShare)} łatwo, ${Math.round(hardMin)} min mocno`,
      okH < 1 ? 'Końcówka za spokojna — ostatnie minuty przyspiesz aż do strefy progu.' : okE < 1 ? 'Początek za szybki — pierwsza część ma być w strefie 2.' : null);
  } else if (k === 'race' || k === 'test') {
    const h = sh(4) + sh(5);
    add('int', 'Intensywność', 40, h / 0.6, 'większość od progu w górę', `${pc(h)} czasu`, h < 0.6 ? 'Został spory zapas — następnym razem odważniej w drugiej połowie.' : null);
  }

  // 2. czas / dystans
  if (k === 'race' || k === 'test') {
    const dist = s.dist || 5000, label = s.label || '5 km', best = run.bests?.[dist];
    add('vol', 'Dystans', 30, best ? 1 : run.distance / dist, label, best ? `${label} w ${fmtDur(best)}` : `${(run.distance / 1000).toFixed(2).replace('.', ',')} km`,
      best ? null : `Przebiegnij cały dystans ${label} — inaczej nie ma porównania z celem.`);
  } else {
    const r = mins / s.min;
    add('vol', 'Czas', 30, r < 0.9 ? (r - 0.5) / 0.4 : r <= 1.25 ? 1 : Math.max(0.3, 1 - (r - 1.25) * 1.2), `${s.min} min`, `${Math.round(mins)} min`,
      r < 0.9 ? `Zabrakło ok. ${Math.round(s.min - mins)} min do planu.` : r > 1.25 ? 'Wyraźnie dłużej niż w planie — więcej nie znaczy lepiej, plan rośnie stopniowo celowo.' : null);
  }

  // 3. struktura
  if (k === 'strides') {
    const sg = stridesOf(run);
    const det = sg ? sg.length : countReps(run);
    const avgDur = sg && sg.length ? Math.round(sg.reduce((a, x) => a + x[1], 0) / sg.length) : null;
    add('str', 'Przebieżki', 20, det >= s.reps ? 1 : det > 0 ? det / s.reps : sg ? 0 : 0.5, `${s.reps} × 20 s`, det ? `${det} × ${avgDur ? 'śr. ' + avgDur + ' s' : 'zryw'}` : sg ? 'brak' : 'niewidoczne w danych',
      det === 0 ? 'Nie widać przebieżek — każda ma być wyraźnie szybsza od biegu (luźny, szybki krok przez 20 s).' : det < s.reps ? `Wykryłem ${det} z ${s.reps} przebieżek — zrób wszystkie, to one uczą szybszego kroku.` : null);
  } else if (['quality', 'intervals', 'fartlek'].includes(k) && s.reps > 1) {
    const det = Math.max(countReps(run), run.surges ? run.surges.filter(x => x[1] >= Math.min(45, s.work * 30)).length : 0);
    add('str', 'Odcinki', 20, det >= s.reps ? (det > s.reps + 2 ? 0.8 : 1) : det / s.reps, `${s.reps} × ${s.work} min`, `wykryto ${det}`,
      det < s.reps ? `Wykryłem ${det} z ${s.reps} odcinków — każdy odcinek wyraźnie szybciej, przerwa w truchcie.` : null);
  } else if (k === 'tempo' || k === 'quality') {
    let best = 0, cur = 0;
    for (const m of run.mins || []) { if (m[0] != null && m[0] >= z[3].lo - 2) { cur++; best = Math.max(best, cur); } else cur = 0; }
    if (hasHr) add('str', 'Ciągłość', 20, best / Math.max(1, s.work * 0.8), `${s.work} min bez przerwy`, `${best} min`,
      best < s.work * 0.8 ? 'Odcinek progowy się rwał — utrzymaj równe, „komfortowo ciężkie” tempo bez zatrzymań.' : null);
  } else if (k === 'progression') {
    const m = (run.mins || []).filter(x => x[1] > 0), n = Math.floor(m.length / 3);
    if (n >= 3) { const v1 = m.slice(0, n).reduce((a, x) => a + x[1], 0) / n, v3 = m.slice(-n).reduce((a, x) => a + x[1], 0) / n;
      add('str', 'Narastanie', 20, v3 > v1 * 1.04 ? 1 : v3 > v1 ? 0.6 : 0.2, 'końcówka szybciej', v3 > v1 ? `+${Math.round((v3 / v1 - 1) * 100)}% prędkości` : 'bez przyspieszenia',
        v3 > v1 * 1.04 ? null : 'Ostatnia część ma być wyraźnie szybsza od początku.'); }
  } else {
    const eff = efficiency(run);
    const sp = (run.splits || []).filter(x => x.dist >= 900);
    let diff = null;
    if (sp.length >= 3) { const h = Math.floor(sp.length / 2); diff = sp.slice(-h).reduce((a, x) => a + x.pace, 0) / h - sp.slice(0, h).reduce((a, x) => a + x.pace, 0) / h; }
    if (k === 'race' || k === 'test') {
      if (diff != null) add('str', 'Rozłożenie sił', 20, diff <= 5 ? 1 : 1 - (diff - 5) / 30, 'druga połowa równo lub szybciej', diff <= 0 ? `szybciej o ${Math.round(-diff)} s/km` : `wolniej o ${Math.round(diff)} s/km`,
        diff > 5 ? 'Start za szybki — pierwszy kilometr w tempie docelowym, przyspieszaj dopiero w drugiej połowie.' : null);
    } else if (eff || diff != null) {
      const dr = eff ? eff.drift : 0;
      const sc = 1 - Math.max(0, (dr - 5) / 10) - Math.max(0, ((diff || 0) - 15) / 45);
      add('str', 'Równość', 20, sc, 'dryf < 5%, równe tempo', `${eff ? 'dryf ' + Math.max(0, dr).toFixed(1).replace('.', ',') + '%' : ''}${eff && diff != null ? ', ' : ''}${diff != null ? (Math.abs(diff) < 8 ? 'tempo równe' : diff > 0 ? `2. połowa wolniej o ${Math.round(diff)} s` : `2. połowa szybciej o ${Math.round(-diff)} s`) : ''}`,
        dr > 5 ? 'Tętno rosło pod koniec przy tym samym tempie — zacznij wolniej, przy dłuższych biegach pij.' : diff != null && diff > 15 ? 'Druga połowa wyraźnie wolniejsza — pierwsze kilometry spokojniej.' : null);
    }
  }

  // 4. termin
  if (s.planned != null) {
    const D = dayStart(run.start), due = s.date ?? s.planned;
    const [sc, txt] = D === due ? [1, 'w terminie'] : D < due ? [0.9, 'dzień wcześniej'] : [0.7, 'nadrobiony'];
    add('day', 'Termin', 10, sc, DAY_SHORT[new Date(due).getDay()], txt, sc < 1 && D > due ? 'Staraj się biegać w zaplanowane dni — wtedy odpoczynek między treningami jest taki, jak trzeba.' : null);
  }

  const W = parts.reduce((a, p) => a + p.w, 0) || 1;
  const pct = Math.round(parts.reduce((a, p) => a + p.w * p.score, 0) / W * 100);
  parts.forEach(p => p.share = Math.round(p.w / W * 100));
  const verdict = verdictOf(pct);
  const weak = parts.filter(p => p.tip && p.score < 0.9).sort((a, b) => (a.score - b.score) || (b.w - a.w))[0];
  const praise = { easy: 'Spokojnie i równo — dokładnie tak buduje się bazę.', long: 'Długi bieg zrobiony jak trzeba: spokojnie i do końca.', strides: 'Spokojny bieg z przebieżkami — nogi uczą się szybszego kroku bez zmęczenia.',
    tempo: 'Próg trzymany równo — to podnosi tempo, które utrzymasz długo.', quality: 'Odcinki progowe zrobione równo — świetna robota.', intervals: 'Interwały zrobione zgodnie z planem — szybkość rośnie.',
    fartlek: 'Zabawa tempem zrobiona jak trzeba.', progression: 'Ładnie narastający bieg — mocna końcówka na zmęczonych nogach.', race: 'Sprawdzian pobiegnięty mądrze.', test: 'Sprawdzian pobiegnięty mądrze.' }[k] || 'Zgodnie z planem.';
  const tip = weak ? weak.tip : praise;
  return { ok: pct >= 70, pct, verdict, tip, parts, label: `${pct}% · ${verdict}` };
}
// przebieżki: krótkie zrywy (do 45 s), bez wolniejszego finiszu
export function stridesOf(run) {
  let sg = run.surges ? run.surges.filter(x => x[1] <= 45) : null;
  if (sg && sg.length) { const vmax = Math.max(...sg.map(x => x[2])); sg = sg.filter(x => x[2] >= vmax * 0.85); }
  return sg;
}
// zgodność wstecz
export const compliance = scoreSession;

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
  const offPlan = new Set(plan.offPlan || []);
  const usedRuns = new Set([...Object.values(marks).map(m => m.runId).filter(Boolean), ...offPlan]);
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
  const matched = new Set(list.map(x => x.runId).filter(Boolean));
  const unmatched = runs.filter(r => !matched.has(r.id)).map(r => r.id);
  return { sessions: list, open, done, closed, total: list.length, next, unmatched, offPlan: [...offPlan], week: next ? next.week : list[list.length - 1]?.week, finished: !next };
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

// ── PRZYPISANIE BIEGU DO PLANU ──────────────────────────────────────────────
// Czy aplikacja jest pewna, który to trening? Jeśli nie — pytamy po wgraniu.
export function linkStatus(plan, acts, set, run, now = Date.now()) {
  if (!plan || plan.ended || !isRun(run) || run.start < dayStart(plan.start)) return { inPlan: false };
  const sch = planSchedule(plan, acts, set, now);
  if ((plan.offPlan || []).includes(run.id)) return { inPlan: true, off: true, sch };
  const ses = sch.sessions.find(x => x.runId === run.id) || null;
  const D = dayStart(run.start);
  const cands = linkCandidates(sch, run);
  let sure = !!ses;
  if (ses) {
    const manual = !!(plan.marks || {})[ses.id]?.runId;
    if (!manual) {
      if (ses.kind !== 'race' && run.timer / 60 < ses.min * 0.5) sure = false;              // dużo krócej niż trening
      if (ses.date !== D && cands.filter(c => c.id !== ses.id && c.status !== 'done').length) sure = false;   // poza dniem, a są inne kandydatury
    }
  }
  return { inPlan: true, ses, sure, cands, sch };
}
// treningi, do których można przypisać bieg: niezrobione z ±7 dni (plus obecny), najbliższe dacie biegu
export function linkCandidates(sch, run) {
  const D = dayStart(run.start);
  return sch.sessions.filter(x => (x.runId === run.id || x.status !== 'done' && x.status !== 'skipped') && Math.abs(x.date - D) <= 7 * DAY)
    .sort((a, b) => Math.abs(a.date - D) - Math.abs(b.date - D) || a.date - b.date).slice(0, 5);
}
// zapisuje decyzję: sessionId albo 'off' (poza planem)
export function linkRun(plan, runId, target, runStart) {
  const marks = { ...(plan.marks || {}) };
  for (const [k, m] of Object.entries(marks)) if (m.runId === runId) delete marks[k];
  const off = (plan.offPlan || []).filter(x => x !== runId);
  if (target === 'off') off.push(runId);
  else marks[target] = { s: 'done', ts: runStart, runId };
  return { ...plan, marks, offPlan: off, updated: Date.now() };
}

// ── REALIZACJA I SKUTECZNOŚĆ PLANU ─────────────────────────────────────────
export function planProgress(plan, acts, set, now = Date.now()) {
  const sch = planSchedule(plan, acts, set, now);
  const closed = sch.sessions.filter(x => ['done', 'missed', 'skipped'].includes(x.status));
  const scores = closed.map(x => x.status === 'done' ? (x.comp?.pct ?? 100) : 0);
  const exec = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const doneScores = closed.filter(x => x.status === 'done' && x.comp?.pct != null).map(x => x.comp.pct);
  const quality = doneScores.length ? Math.round(doneScores.reduce((a, b) => a + b, 0) / doneScores.length) : null;
  const missed = closed.filter(x => x.status !== 'done').length;
  const start = dayStart(plan.start), weeksIn = Math.max(0, (now - start) / (7 * DAY));
  // forma: VDOT na starcie planu (z generatora) i dziś
  const G = GOALS[plan.goal] || {};
  const formNow = currentForm(acts, now);
  const vdStart = plan.meta?.vdNow ?? currentForm(acts, start)?.vdot ?? null;
  const vdNow = formNow?.vdot ?? null;
  const vdTarget = plan.meta?.vdTarget ?? null;
  const dist = G.dist || 5000;
  const form = vdStart && vdNow ? {
    vdStart, vdNow, dist, distLabel: { 5000: '5 km', 10000: '10 km', 21097.5: 'półmaraton' }[dist],
    predStart: timeForVdot(vdStart, dist), predNow: timeForVdot(vdNow, dist),
    goal: plan.meta?.opts?.target || null,
    progress: vdTarget && vdTarget > vdStart ? clamp01((vdNow - vdStart) / (vdTarget - vdStart)) : null,
  } : null;
  // tempo przy tym samym (łatwym) tętnie: 4 tyg. przed planem vs ostatnie 4 tyg.
  const ref = easyHrMax(set);
  const pBefore = paceAtHr(acts, ref, start - 28 * DAY, start), pNow = weeksIn >= 1 ? paceAtHr(acts, ref, now - 28 * DAY, now + 1) : null;
  const pace = pBefore && pNow ? { ref, before: pBefore.pace, now: pNow.pace, diff: pNow.pace - pBefore.pace } : null;
  // ocena skuteczności
  let note;
  if (weeksIn < 2) note = 'Na ocenę skuteczności planu za wcześnie — pierwsze efekty widać po 3–4 tygodniach.';
  else {
    const better = (pace && pace.diff <= -3) || (form && form.vdNow - form.vdStart >= 0.3);
    const worse = (pace && pace.diff >= 5) && !(form && form.vdNow > form.vdStart);
    if (better) note = `Plan działa: ${pace && pace.diff <= -3 ? `przy tętnie ${ref} biegasz o ${Math.round(-pace.diff)} s/km szybciej niż przed planem` : `forma wzrosła z ${form.vdStart.toFixed(1).replace('.', ',')} do ${form.vdNow.toFixed(1).replace('.', ',')}`}.`;
    else if (worse) note = 'Tempo przy tym samym tętnie spadło — możliwe zmęczenie. Sprawdź sen i czy łatwe biegi są naprawdę łatwe.';
    else if (weeksIn >= 4) note = `Forma stoi w miejscu od ${Math.floor(weeksIn)} tygodni${exec != null && exec < 75 ? ` — realizacja planu ${exec}% to za mało, żeby zobaczyć postęp` : ' — trzymaj łatwe biegi naprawdę spokojnie, efekt często przychodzi skokowo'}.`;
    else note = 'Forma na razie bez zmian — to normalne na tym etapie planu.';
  }
  return { sch, exec, quality, missed, closed: closed.length, done: sch.done, total: sch.total, weeksIn, form, pace, note };
}

// ── OMÓWIENIE TRENINGU Z PLANU ─────────────────────────────────────────────
// Opis „jak trener”: co wyszło, co nie i KIEDY (z przebiegu tętna i tempa), dlaczego to ważne, jak następnym razem.
export function sessionDebrief(ses, run, st, set, plan) {
  const c = ses.comp; if (!c || !c.parts?.length || !st?.t?.length) return null;
  const z = zonesFor(set.lthr), Z2 = z[1].hi, Z1 = z[0].hi, k = ses.kind;
  const T = st.t, D = st.d, H = st.hr, n = T.length;
  const km = m => fmtKm(m, 1);
  const iAt = t => { let i = 0; while (i < n - 1 && T[i] < t) i++; return i; };
  const seg = (t0, t1) => {
    const a = iAt(t0), b = Math.max(a, iAt(t1)); const hs = [];
    for (let i = a; i <= b; i++) if (H[i] != null) hs.push(H[i]);
    hs.sort((x, y) => x - y);
    const dd = D[b] - D[a], dt = T[b] - T[a];
    return { a, b, km0: D[a], km1: D[b], dur: dt, pace: dd > 20 ? dt / dd * 1000 : null,
      hr: hs.length ? Math.round(hs.reduce((x, y) => x + y, 0) / hs.length) : null, hrMax: hs.length ? hs[hs.length - 1] : null, hr90: hs.length ? hs[Math.floor(hs.length * 0.9)] : null };
  };
  const tEnd = T[n - 1];
  const good = [], issues = [], factors = [];
  const nt = run.note || {}, w = run.weather;
  if (w && w.feels != null && w.feels <= 2) factors.push(`zimno (odczuwalne ${Math.round(w.feels)}°C)`);
  else if (w && w.t != null && w.t >= 22) factors.push(`ciepło (${Math.round(w.t)}°C)`);
  if (nt.coffee) factors.push('kawa przed biegiem');
  if (nt.sleep === 'bad') factors.push('słaby sen');
  const P = Object.fromEntries(c.parts.map(p => [p.key, p]));

  // co wyszło
  for (const p of c.parts) if (p.score >= 0.9) good.push(p.key === 'str' && k === 'strides' ? `Przebieżki zrobiłeś dobrze: ${p.done.replace('×', 'zrywy po').replace('śr.', 'średnio')}.`
    : p.key === 'vol' ? `Czas się zgadza: ${p.done} przy planie ${p.plan}.` : p.key === 'day' ? 'Trening w zaplanowanym dniu.' : p.key === 'int' ? `Intensywność zgodna z planem (${p.done}).` : `${p.label}: ${p.done}.`);

  // 1. intensywność — z przebiegu w czasie
  const pi = P.int;
  if (pi && pi.score < 0.9 && ['easy', 'long', 'strides', 'progression'].includes(k)) {
    const b = [];
    const zt = zoneTimes(run, set.lthr), tot = zt ? zt.reduce((x, y) => x + y, 0) : 0;
    if (zt && tot) {
      const m = v => Math.round(v / 60);
      b.push(`Plan: ${pi.plan}. Spokojnie było ${pi.done} (ok. ${m(zt[0] + zt[1] + zt[2])} min), w strefie 3 ok. ${m(zt[3])} min, w strefach 4–5 ok. ${m(zt[4] + zt[5])} min. Średnie tętno ${run.avgHr}, maksymalne ${run.maxHr}.`);
    }
    const sg = k === 'strides' ? (stridesOf(run) || []) : [];
    if (sg.length) {
      const s0 = sg[0][0], s1 = sg[sg.length - 1][0] + sg[sg.length - 1][1];
      const pre = seg(0, s0), blk = seg(s0, s1), post = seg(s1, tEnd);
      if (pre.hr90 != null) b.push(`Pierwsze ${km(pre.km1)} km: tętno doszło do ok. ${pre.hr90}${pre.hr90 > Z2 + 3 ? ` — ponad granicę spokojnej strefy (${Z2}), za mocno już na rozgrzewce` : pre.hr90 >= Z2 - 6 ? `, pod samą granicę spokojnej strefy (${Z2})` : ' — dobrze, spokojnie'}, tempo ${fmtPace(pre.pace)}/km.${pre.hr90 >= Z2 - 6 && factors.length ? ` Swoje dołożyły: ${factors.join(', ')} — każde podbija tętno o kilka uderzeń.` : ''}`);
      if (blk.hrMax) b.push(`Przebieżki: tętno skoczyło do ok. ${blk.hrMax} — to normalne.`);
      const gaps = [];
      for (let i = 0; i + 1 < sg.length; i++) gaps.push(seg(sg[i][0] + sg[i][1], sg[i + 1][0]));
      const gp = gaps.filter(g => g.pace), gPace = gp.length ? gp.reduce((x, g) => x + g.pace, 0) / gp.length : null;
      if (gPace && gPace < 9 * 60) b.push(`Między zrywami trucht ok. ${fmtPace(gPace)}/km — bez odpoczynku, więc tętno nie zdążyło spaść.`);
      if (post.dur > 120) {
        const h1 = seg(s1, s1 + post.dur / 2), h2 = seg(s1 + post.dur / 2, tEnd);
        const acc = h1.pace && h2.pace && h1.pace - h2.pace > 20;
        if (post.hr > Z2 || acc) b.push(`Po przebieżkach (${km(post.km1 - post.km0)} km, ${Math.round(post.dur / 60)} min) tętno ${post.hr > Z2 ? `już nie spadło (średnio ${post.hr})` : `średnio ${post.hr}`}${acc ? `, a końcówkę przyspieszałeś do ok. ${fmtPace(h2.pace)}/km i tętno doszło do ${h2.hrMax}. Zamiast schłodzenia wyszedł bieg narastający` : ''}.`);
      }
    } else {
      // bez przebieżek: trzy części biegu
      const parts3 = [0, 1, 2].map(i => seg(tEnd * i / 3, tEnd * (i + 1) / 3));
      let cross = null; for (let i = 0; i < n; i++) if (H[i] != null && H[i] > Z2 && T[i] > 300) { let ok = 0; for (let j = i; j < Math.min(n, i + 30); j++) if (H[j] > Z2) ok++; if (ok >= 25) { cross = i; break; } }
      b.push(`Tętno w kolejnych częściach biegu: ${parts3.map(p => p.hr).join(' → ')} przy tempie ${parts3.map(p => fmtPace(p.pace)).join(' → ')}/km.`);
      if (cross != null) b.push(`Od ${km(D[cross])} km (${Math.round(T[cross] / 60)}. minuta) tętno trzymało się powyżej ${Z2} — tu trzeba było zwolnić.${factors.length ? ` Swoje dołożyły: ${factors.join(', ')}.` : ''}`);
      if (parts3[2].pace && parts3[0].pace && parts3[0].pace - parts3[2].pace > 20) b.push(`Końcówka szybsza o ${Math.round(parts3[0].pace - parts3[2].pace)} s/km niż początek — przy spokojnym biegu nie przyspieszaj na koniec.`);
    }
    issues.push({ title: `Za mocno (${Math.round(pi.score * pi.share)}/${pi.share})`, bullets: b });
  } else if (pi && pi.score < 0.9) issues.push({ title: `${pi.label} (${Math.round(pi.score * pi.share)}/${pi.share})`, bullets: [`Plan: ${pi.plan}, zrobione: ${pi.done}.`, pi.tip].filter(Boolean) });

  // 2. czas
  const pv = P.vol;
  if (pv && pv.score < 0.9) {
    const mins = Math.round(run.timer / 60);
    issues.push({ title: `${mins > ses.min ? 'Za długo' : 'Za krótko'} (${Math.round(pv.score * pv.share)}/${pv.share})`, bullets: [mins > ses.min
      ? `Plan ${ses.min} min, biegłeś ${mins}.${pi && pi.score < 0.9 ? ` Dodatkowe ${mins - ses.min} min było w dodatku w wysokich strefach.` : ''}`
      : `Plan ${ses.min} min, biegłeś ${mins}. Brakujące minuty to brakująca baza — lepiej wolniej, ale do końca.`] });
  }
  // 3. struktura / termin
  for (const key of ['str', 'day']) { const p = P[key]; if (p && p.score < 0.9) issues.push({ title: `${p.label} (${Math.round(p.score * p.share)}/${p.share})`, bullets: [`Plan: ${p.plan}, zrobione: ${p.done}.`, p.tip].filter(Boolean) }); }

  // dlaczego to ważne
  let why = null;
  const easyK = ['easy', 'long', 'strides'].includes(k);
  if (easyK && pi && pi.score < 0.6) why = k === 'strides' ? 'Ten trening miał być lekki: przebieżki uczą szybszego kroku bez zmęczenia, a spokojne minuty budują wytrzymałość. Wyszedł z tego mocny trening — organizm potrzebuje teraz więcej odpoczynku, a kolejny trening z planu zaczniesz zmęczony.'
    : 'Spokojny bieg buduje bazę tlenową tylko wtedy, gdy jest naprawdę spokojny. Za mocny daje mniej korzyści, a więcej zmęczenia — i odbiera siły na trening akcentowy.';
  else if (['quality', 'tempo', 'intervals', 'fartlek'].includes(k) && pi && pi.score < 0.9) why = pi.done && parseInt(pi.done) < parseInt(pi.plan) ? 'Za lekki akcent to za słaby bodziec — próg mleczanowy rośnie dopiero przy kilkunastu minutach pracy w jego strefie.' : 'Za dużo mocnej pracy podnosi zmęczenie bardziej niż formę. Liczy się powtarzalność z tygodnia na tydzień, nie jeden mocny dzień.';
  else if (pv && pv.score < 0.9 && run.timer / 60 > ses.min) why = 'Plan zwiększa objętość stopniowo, żeby ścięgna i stawy nadążały za sercem. Dokładanie minut „na zapas” to najczęstsza droga do przeciążeń.';

  // jak następnym razem
  const nx = [];
  const ep = plan?.meta?.paces?.easy;
  if (easyK) {
    const firstMin = k === 'strides' ? Math.max(15, ses.min - 5) : ses.min;
    nx.push(`${k === 'strides' ? `Przez pierwsze ${firstMin} min` : 'Cały bieg'} tętno do ${Z2}. Jeśli rośnie — zwolnij${ep ? ` nawet do ${fmtPace(ep[1])}/km` : ''} albo wtrąć minutę marszu.${factors.length ? ' W zimne dni, po kawie i po słabej nocy zacznij jeszcze wolniej.' : ''}`);
    if (k === 'strides') {
      nx.push(`Przebieżki na koniec: ${ses.reps} × 20 s luźno i szybko, po każdej ok. minuty marszu, aż tętno spadnie poniżej ${Z1}.`);
      nx.push('Po ostatniej przebieżce 3–5 min bardzo spokojnie i koniec — bez przyspieszania na ostatnim kilometrze.');
    }
    nx.push(`Łącznie ok. ${ses.min}–${ses.min + 3} min.`);
  } else if (['quality', 'tempo', 'intervals', 'fartlek'].includes(k)) {
    nx.push(`10–15 min rozgrzewki z tętnem do ${Z2}.`);
    nx.push(k === 'tempo' || ses.reps === 1 ? `${ses.work} min ciągle w strefie ${z[3].lo}–${z[3].hi} — równo, „komfortowo ciężko”.` : `${ses.reps} × ${ses.work} min w strefie ${k === 'intervals' || k === 'fartlek' ? `od ${z[3].lo} w górę` : `${z[3].lo}–${z[3].hi}`}, przerwy w truchcie aż tętno spadnie poniżej ${Z2}.`);
    nx.push('10 min spokojnego schłodzenia.');
  }
  if (!issues.length) { why = null; if (!nx.length) return { good, issues, why, next: [] }; }
  return { good, issues, why, next: issues.length ? nx : [] };
}
