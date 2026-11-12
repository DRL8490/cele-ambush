/* CELE Ambush Command Center — Native cele_ambush_curriculum.json Engine (126 Topics + 14-Week Spiral Schedule) */
(function () {
  "use strict";

  const STORAGE_KEY = "cele_ambush_command_v2";
  const DAY_MS = 86400000;

  const ctx = window.CELE_CONTEXT || {
    appConfig: {
      appName: "CELE Ambush Command Center",
      version: "1.0.0",
      primaryTimerMinutes: 15,
      spiralTimerMinutes: 15,
      startingIntegrityXP: 100,
      hintPenaltyXP: 20,
      tacticalRescuePenaltyXP: 30,
      decayThresholdDays: 7,
      holidayShutdown: {
        start: "2026-12-21",
        end: "2027-01-03",
        rule: "Zero studying. Mandatory cognitive recovery."
      },
      notebookLMUrl: "https://gemini.google.com/notebook/1c6b7e1c-9354-42d6-b174-c5743d55b0e1"
    },
    summaryCounts: { totalTopics: 126, MSTE: 47, HPGE: 31, PSAD: 48 },
    topics: [],
    spiralSchedule: [],
    samplePuzzles: []
  };

  // Hydrate deterministic rescueLinks if omitted in compact bundles
  const nbDefault = (ctx.appConfig && ctx.appConfig.notebookLMUrl) || "https://gemini.google.com/notebook/1c6b7e1c-9354-42d6-b174-c5743d55b0e1";
  (ctx.topics || []).forEach((t) => {
    t.title = t.title || t.name;
    t.name = t.name || t.title;
    if (!t.rescueLinks) {
      const q = String(t.name).replace(/ /g, "+");
      t.rescueLinks = {
        organicChemistryTutor: `https://www.youtube.com/results?search_query=${q}+Organic+Chemistry+Tutor`,
        khanAcademy: `https://www.youtube.com/results?search_query=${q}+Khan+Academy`,
        notebookLM: nbDefault
      };
    }
  });

  function detectScheduleSlot() {
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10);
    const hs = ctx.appConfig.holidayShutdown || {};
    const inHoliday = hs.start && hs.end && ymd >= hs.start && ymd <= hs.end;

    const w1Start = Date.UTC(2026, 9, 12);  // Oct 12, 2026 (Mon)
    const w11Start = Date.UTC(2027, 0, 4);  // Jan 4, 2027 (Mon)
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    let week = 1;
    let dayIdx = 0;
    if (todayUTC >= w1Start && todayUTC < w1Start + 70 * DAY_MS) {
      const diff = Math.floor((todayUTC - w1Start) / DAY_MS);
      week = Math.floor(diff / 7) + 1;
      dayIdx = diff % 7;
    } else if (todayUTC >= w11Start && todayUTC < w11Start + 28 * DAY_MS) {
      const diff = Math.floor((todayUTC - w11Start) / DAY_MS);
      week = 11 + Math.floor(diff / 7);
      dayIdx = diff % 7;
    }
    return { week, dayIdx, inHoliday };
  }

  function defaultState() {
    const slot = detectScheduleSlot();
    const schedWeek = (ctx.spiralSchedule || []).find((w) => w.week === slot.week) || (ctx.spiralSchedule || [])[0];
    const schedDay = schedWeek && schedWeek.days ? schedWeek.days[slot.dayIdx] || schedWeek.days[0] : null;
    const pInit = (schedDay && schedDay.primaryTopicIds && schedDay.primaryTopicIds[0]) || "T-001";
    const sInit = (schedDay && schedDay.spiralTopicIds && schedDay.spiralTopicIds[0]) || null;

    return {
      version: "2.0",
      appConfig: JSON.parse(JSON.stringify(ctx.appConfig)),
      sourceLabel: "cele_ambush_curriculum.json · 126 Topics · MSTE (47) · HPGE (31) · PSAD (48)",
      careerXp: 0,
      topicOverrides: {},
      extraTopics: [],
      nodeProgress: {},     // id -> { completedAt, lastReviewedAt, reviewCount, spiralLocked, manualState, xpEarned }
      customPuzzles: {},    // id -> [puzzleObj, ...]
      scheduleProgress: {}, // "W{week}-D{dayIdx}" -> { completed: bool }
      selectedWeek: slot.week,
      selectedDayIdx: slot.dayIdx,
      showHolidayBanner: slot.inHoliday,
      primaryTargetId: pInit,
      spiralTargetId: sInit,
      selectedNodeId: pInit,
      engagedMode: "primary"
    };
  }

  let state = loadState();
  let filterSector = "ALL";
  let filterState = "ALL";
  let searchQuery = "";
  let activePuzzleIndex = 0;

  const cfg = () => state.appConfig || ctx.appConfig;
  const primaryDurationSec = () => ((cfg().primaryTimerMinutes || 15) * 60);
  const spiralDurationSec = () => ((cfg().spiralTimerMinutes || 15) * 60);

  let attempt = {
    xp: cfg().startingIntegrityXP || 100,
    hintUsed: false,
    rescueUsed: false,
    stage1Cleared: false,
    stage2Cleared: false,
    stage3Cleared: false,
    shuffledOptions: [],
    wrongChoices: new Set()
  };

  const timers = {
    primary: { remaining: primaryDurationSec(), running: false, interval: null },
    spiral: { remaining: spiralDurationSec(), running: false, interval: null }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      showToast("LocalStorage quota warning: " + e.message);
    }
  }

  function getAllTopics() {
    const merged = (ctx.topics || []).map((t) => {
      const ov = state.topicOverrides && state.topicOverrides[t.id];
      if (!ov) return t;
      return {
        ...t,
        ...ov,
        title: ov.title || ov.name || t.title || t.name,
        name: ov.name || ov.title || t.name || t.title,
        defaultPuzzle: ov.defaultPuzzle || t.defaultPuzzle,
        rescueLinks: ov.rescueLinks || t.rescueLinks
      };
    });
    return merged.concat(state.extraTopics || []);
  }

  function getTopicById(id) {
    const list = getAllTopics();
    return list.find((t) => t.id === id) || list[0];
  }

  // Order puzzles: samplePuzzles (PUZ-001..003) & customPuzzles first, plus KIPPAP Core Bank
  function getPuzzlesForTopic(topic) {
    const seeds = Array.isArray(topic.seedPuzzles) ? topic.seedPuzzles : [];
    const custom = (state.customPuzzles && state.customPuzzles[topic.id]) || [];
    return [...seeds, topic.defaultPuzzle, ...custom].filter(Boolean);
  }

  function getSelectedScheduleDay() {
    const sched = state.customSchedule || ctx.spiralSchedule || [];
    const wk = sched.find((w) => w.week === Number(state.selectedWeek)) || sched[0];
    if (!wk) return { weekObj: null, dayObj: null };
    const dObj = wk.days[state.selectedDayIdx] || wk.days[0];
    return { weekObj: wk, dayObj: dObj };
  }

  function computeNodeStates(topics) {
    const now = Date.now();
    const firstUncompletedBySector = {};
    const statusMap = {};
    const { dayObj } = getSelectedScheduleDay();
    const scheduledPrimarySet = new Set((dayObj && dayObj.primaryTopicIds) || []);

    for (const t of topics) {
      const prog = state.nodeProgress[t.id];
      const hasCompleted = prog && prog.lastReviewedAt;
      if (!hasCompleted && !firstUncompletedBySector[t.sector]) {
        firstUncompletedBySector[t.sector] = t.id;
      }
    }

    for (const t of topics) {
      const prog = state.nodeProgress[t.id] || {};
      const decayLimit = Number(t.decayDaysThreshold || cfg().decayThresholdDays || 7);
      if (prog.lastReviewedAt) {
        const days = (now - prog.lastReviewedAt) / DAY_MS;
        if (prog.spiralLocked && days <= 30) {
          statusMap[t.id] = { state: "spiral", days };
        } else if (days > decayLimit) {
          statusMap[t.id] = { state: "decaying", days };
        } else {
          statusMap[t.id] = { state: "cleared", days };
        }
      } else if (
        prog.manualState === "active" ||
        scheduledPrimarySet.has(t.id) ||
        firstUncompletedBySector[t.sector] === t.id
      ) {
        statusMap[t.id] = { state: "active", days: null };
      } else {
        statusMap[t.id] = { state: "locked", days: null };
      }
    }
    return statusMap;
  }

  function syncTargets(topics, statusMap) {
    const currPrimary = state.primaryTargetId && topics.find((t) => t.id === state.primaryTargetId);
    if (!currPrimary) {
      const firstActive = topics.find((t) => statusMap[t.id].state === "active");
      state.primaryTargetId = (firstActive || topics[0]).id;
    }

    const { dayObj } = getSelectedScheduleDay();
    const schedSpirals = (dayObj && dayObj.spiralTopicIds) || [];

    const spiralCandidates7to14 = topics.filter((t) => {
      const st = statusMap[t.id];
      return st.days !== null && st.days >= 7 && st.days <= 14 && st.state !== "spiral";
    });
    const anyDecaying = topics.filter((t) => statusMap[t.id].state === "decaying");

    const currentSpiralExists = state.spiralTargetId && topics.some((t) => t.id === state.spiralTargetId);
    if (!currentSpiralExists) {
      if (spiralCandidates7to14.length > 0) {
        state.spiralTargetId = spiralCandidates7to14[0].id;
      } else if (anyDecaying.length > 0) {
        state.spiralTargetId = anyDecaying[0].id;
      } else if (schedSpirals.length > 0) {
        state.spiralTargetId = schedSpirals[0];
      } else {
        const clearedNodes = topics
          .filter((t) => statusMap[t.id].days !== null)
          .sort((a, b) => (statusMap[b.id].days || 0) - (statusMap[a.id].days || 0));
        state.spiralTargetId = clearedNodes.length ? clearedNodes[0].id : null;
      }
    }
  }

  function formatMMSS(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  }

  function getMaxSec(which) {
    return which === "primary" ? primaryDurationSec() : spiralDurationSec();
  }

  let wakeLockSentinel = null;
  async function syncWakeLock() {
    const anyRunning = timers.primary.running || timers.spiral.running;
    if (!("wakeLock" in navigator)) return;
    try {
      if (anyRunning && !wakeLockSentinel && document.visibilityState === "visible") {
        wakeLockSentinel = await navigator.wakeLock.request("screen");
        wakeLockSentinel.addEventListener("release", () => { wakeLockSentinel = null; });
      } else if (!anyRunning && wakeLockSentinel) {
        await wakeLockSentinel.release();
        wakeLockSentinel = null;
      }
    } catch (_) {
      // Ignore wakeLock permission refusals in non-HTTPS contexts
    }
  }

  function renderTimerUI(which) {
    const t = timers[which];
    const maxS = getMaxSec(which);
    const disp = document.getElementById(which + "-timer-display");
    const st = document.getElementById(which + "-timer-state");
    const bar = document.getElementById(which + "-timer-bar");
    const btn = document.getElementById("btn-toggle-" + which + "-timer");
    if (!disp) return;

    disp.textContent = formatMMSS(t.remaining);
    disp.className = "timer-readout " + (t.remaining === 0 ? "is-expired" : t.running ? "is-running" : t.remaining < maxS ? "is-paused" : "");
    st.textContent = t.remaining === 0 ? "TIME EXPIRED" : t.running ? "LIVE AMBUSH" : t.remaining < maxS ? "PAUSED" : "STANDBY";
    bar.style.width = ((t.remaining / maxS) * 100).toFixed(1) + "%";
    btn.textContent = t.running ? "Pause" : "Start Timer";
  }

  function tickWallClockTimer(which) {
    const t = timers[which];
    if (!t.running || !t.endTime) return;
    t.remaining = Math.max(0, Math.ceil((t.endTime - Date.now()) / 1000));
    renderTimerUI(which);
    if (t.remaining === 0) {
      pauseTimer(which);
      showToast(which.toUpperCase() + " 15-minute ambush window complete!");
    }
  }

  function startTimer(which) {
    const other = which === "primary" ? "spiral" : "primary";
    pauseTimer(other);
    const t = timers[which];
    if (t.running) return;
    if (t.remaining <= 0) t.remaining = getMaxSec(which);
    t.running = true;
    t.endTime = Date.now() + t.remaining * 1000;
    t.interval = setInterval(() => tickWallClockTimer(which), 500);
    renderTimerUI(which);
    syncWakeLock();
  }

  function pauseTimer(which) {
    const t = timers[which];
    if (t.running && t.endTime) {
      t.remaining = Math.max(0, Math.ceil((t.endTime - Date.now()) / 1000));
    }
    if (t.interval) clearInterval(t.interval);
    t.interval = null;
    t.endTime = null;
    t.running = false;
    renderTimerUI(which);
    syncWakeLock();
  }

  function resetTimer(which) {
    pauseTimer(which);
    timers[which].remaining = getMaxSec(which);
    renderTimerUI(which);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      tickWallClockTimer("primary");
      tickWallClockTimer("spiral");
      syncWakeLock();
    }
  });

  function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function initPuzzleAttempt(resetIndex) {
    if (resetIndex) activePuzzleIndex = 0;
    const topic = getTopicById(state.selectedNodeId);
    const puzzles = getPuzzlesForTopic(topic);
    if (activePuzzleIndex >= puzzles.length) activePuzzleIndex = 0;
    const pz = puzzles[activePuzzleIndex];
    const startXp = cfg().startingIntegrityXP || 100;

    attempt = {
      xp: startXp,
      hintUsed: false,
      rescueUsed: false,
      stage1Cleared: false,
      stage2Cleared: false,
      stage3Cleared: false,
      shuffledOptions: shuffleArray([pz.governingEq, ...(pz.distractors || [])]),
      wrongChoices: new Set()
    };

    document.getElementById("stage-2-input").value = "";
    document.getElementById("stage-3-input").value = "";
    document.getElementById("stage-1-feedback").textContent = "";
    document.getElementById("stage-2-feedback").textContent = "";
    document.getElementById("stage-3-feedback").textContent = "";
    renderPuzzleArena();
  }

  function withinStageTolerance(userVal, stageObj) {
    if (!Number.isFinite(userVal)) return false;
    const targetVal = Number(stageObj.answer);
    const relTol = Math.abs(targetVal) * 0.01;
    const explicitTol = Number(stageObj.tolerance || 0);
    const tol = Math.max(relTol, explicitTol, 1e-4);
    return Math.abs(userVal - targetVal) <= tol;
  }

  function renderPuzzleArena() {
    const topic = getTopicById(state.selectedNodeId);
    const puzzles = getPuzzlesForTopic(topic);
    const pz = puzzles[activePuzzleIndex] || puzzles[0];
    const startXp = cfg().startingIntegrityXP || 100;
    const hintCost = cfg().hintPenaltyXP || 20;
    const rescueCost = cfg().tacticalRescuePenaltyXP || 30;

    document.getElementById("arena-sector-badge").textContent =
      `${topic.id} · ${topic.sector} (${topic.category})${topic.isHomeTurf ? " · HOME TURF" : ""} · MODE: ${state.engagedMode.toUpperCase()}`;
    document.getElementById("puzzle-panel-heading").textContent = topic.name || topic.title;

    const sel = document.getElementById("puzzle-selector");
    sel.innerHTML = "";
    puzzles.forEach((item, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = item.source || `${item.id || "Puzzle #" + (idx + 1)}`;
      if (idx === activePuzzleIndex) opt.selected = true;
      sel.appendChild(opt);
    });

    document.getElementById("attempt-xp-readout").textContent = `${attempt.xp} / ${startXp} XP`;
    const xpBar = document.getElementById("attempt-xp-bar");
    const pct = Math.max(0, Math.min(100, (attempt.xp / startXp) * 100));
    xpBar.style.width = `${pct}%`;
    xpBar.style.background = pct >= 70 ? "var(--status-cleared)" : pct >= 40 ? "var(--status-decaying)" : "var(--status-danger)";

    document.getElementById("btn-use-hint").textContent =
      attempt.hintUsed ? `Hint Active (-${hintCost} XP)` : `Hint / Formula (-${hintCost} XP)`;
    document.getElementById("btn-tactical-rescue").textContent =
      attempt.rescueUsed ? `Rescue Active (-${rescueCost} XP)` : `Tactical Rescue (-${rescueCost} XP)`;

    const hintDrawer = document.getElementById("hint-drawer");
    if (attempt.hintUsed) {
      hintDrawer.style.display = "block";
      hintDrawer.innerHTML = `<strong>Governing Equation:</strong> <code style="font-family:var(--font-mono);">${escapeHtml(pz.governingEq)}</code><div style="margin-top:4px;color:var(--text-secondary);">${escapeHtml(pz.hint || "")}</div>`;
    } else {
      hintDrawer.style.display = "none";
    }

    const tacDrawer = document.getElementById("tactical-drawer");
    if (attempt.rescueUsed) {
      const rl = topic.rescueLinks || {};
      const octUrl = rl.organicChemistryTutor || ("https://www.youtube.com/results?search_query=" + encodeURIComponent(topic.name + " Organic Chemistry Tutor"));
      const kaUrl = rl.khanAcademy || ("https://www.youtube.com/results?search_query=" + encodeURIComponent(topic.name + " Khan Academy"));
      const nbUrl = rl.notebookLM || cfg().notebookLMUrl;
      tacDrawer.style.display = "block";
      tacDrawer.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;">⏸ Timer Paused · Tactical Rescue Links (${escapeHtml(topic.id)}):</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          <a class="btn btn-sm btn-primary" href="${escapeHtml(octUrl)}" target="_blank" rel="noopener noreferrer">▶ Organic Chemistry Tutor</a>
          <a class="btn btn-sm" href="${escapeHtml(kaUrl)}" target="_blank" rel="noopener noreferrer">▶ Khan Academy</a>
          <a class="btn btn-sm btn-gold" href="${escapeHtml(nbUrl)}" target="_blank" rel="noopener noreferrer">✦ My Gemini NotebookLM</a>
        </div>
      `;
    } else {
      tacDrawer.style.display = "none";
    }

    document.getElementById("puzzle-stem-text").textContent = pz.stem;
    document.getElementById("stage-1-prompt").textContent =
      pz.s1Instruction || "Identify the governing formula or equilibrium relationship for this setup:";

    // Stage 1
    const s1Box = document.getElementById("stage-1-box");
    s1Box.className = "stage-box" + (attempt.stage1Cleared ? " is-cleared" : "");
    document.getElementById("stage-1-status").textContent = attempt.stage1Cleared ? "✓ Unlocked" : "Step 1 of 3";

    const optContainer = document.getElementById("stage-1-options");
    optContainer.innerHTML = "";
    attempt.shuffledOptions.forEach((eqText, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "eq-option-btn";
      if (attempt.stage1Cleared && eqText === pz.governingEq) b.classList.add("is-correct");
      if (attempt.wrongChoices.has(eqText)) b.classList.add("is-wrong");
      b.disabled = attempt.stage1Cleared || attempt.wrongChoices.has(eqText);
      b.textContent = `${String.fromCharCode(65 + i)}.  ${eqText}`;
      b.addEventListener("click", () => handleStage1Choice(eqText, pz.governingEq));
      optContainer.appendChild(b);
    });

    // Stage 2
    const s2Box = document.getElementById("stage-2-box");
    const s2Disabled = !attempt.stage1Cleared || attempt.stage2Cleared;
    s2Box.className = "stage-box" + (attempt.stage2Cleared ? " is-cleared" : !attempt.stage1Cleared ? " is-locked" : "");
    document.getElementById("stage-2-status").textContent = attempt.stage2Cleared ? "✓ Unlocked" : attempt.stage1Cleared ? "Active (±1%)" : "Locked";
    document.getElementById("stage-2-prompt").textContent = pz.stage2.prompt;
    document.getElementById("stage-2-unit").textContent = pz.stage2.unit || "unit";
    document.getElementById("stage-2-input").disabled = s2Disabled;
    document.getElementById("btn-verify-stage-2").disabled = s2Disabled;
    const neg2 = document.getElementById("btn-neg-stage-2");
    if (neg2) neg2.disabled = s2Disabled;

    // Stage 3
    const s3Box = document.getElementById("stage-3-box");
    const s3Disabled = !attempt.stage2Cleared || attempt.stage3Cleared;
    s3Box.className = "stage-box" + (attempt.stage3Cleared ? " is-cleared" : !attempt.stage2Cleared ? " is-locked" : "");
    document.getElementById("stage-3-status").textContent = attempt.stage3Cleared ? "✓ NODE CLEARED" : attempt.stage2Cleared ? "Active (±1%)" : "Locked";
    document.getElementById("stage-3-prompt").textContent = pz.stage3.prompt;
    document.getElementById("stage-3-unit").textContent = pz.stage3.unit || "unit";
    document.getElementById("stage-3-input").disabled = s3Disabled;
    document.getElementById("btn-verify-stage-3").disabled = s3Disabled;
    const neg3 = document.getElementById("btn-neg-stage-3");
    if (neg3) neg3.disabled = s3Disabled;
  }

  function parseNumericInput(elId) {
    const rawStr = String(document.getElementById(elId).value || "")
      .trim()
      .replace(/[−–—]/g, "-")
      .replace(/,/g, "");
    return parseFloat(rawStr);
  }

  function handleStage1Choice(chosen, correct) {
    const fb = document.getElementById("stage-1-feedback");
    if (chosen === correct) {
      attempt.stage1Cleared = true;
      fb.className = "feedback-msg ok";
      fb.textContent = "Governing condition verified. Stage 2 intermediate calculation unlocked.";
      renderPuzzleArena();
      document.getElementById("stage-2-input").focus();
    } else {
      attempt.wrongChoices.add(chosen);
      attempt.xp = Math.max(0, attempt.xp - 5);
      fb.className = "feedback-msg err";
      fb.textContent = "Incorrect governing relation (-5 XP). Check sign conventions or FBD equilibrium.";
      renderPuzzleArena();
    }
  }

  function handleVerifyStage2() {
    const topic = getTopicById(state.selectedNodeId);
    const pz = getPuzzlesForTopic(topic)[activePuzzleIndex];
    const raw = parseNumericInput("stage-2-input");
    const fb = document.getElementById("stage-2-feedback");

    if (withinStageTolerance(raw, pz.stage2)) {
      attempt.stage2Cleared = true;
      fb.className = "feedback-msg ok";
      fb.textContent = `Verified (Expected: ${pz.stage2.answer} ${pz.stage2.unit}). Stage 3 final unlock armed!`;
      renderPuzzleArena();
      document.getElementById("stage-3-input").focus();
    } else {
      attempt.xp = Math.max(0, attempt.xp - 5);
      fb.className = "feedback-msg err";
      fb.textContent = Number.isFinite(raw)
        ? `Outside tolerance (-5 XP). Recheck units (${pz.stage2.unit}) and intermediate substitution.`
        : "Enter a valid numerical value.";
      renderPuzzleArena();
    }
  }

  function handleVerifyStage3() {
    const topic = getTopicById(state.selectedNodeId);
    const pz = getPuzzlesForTopic(topic)[activePuzzleIndex];
    const raw = parseNumericInput("stage-3-input");
    const fb = document.getElementById("stage-3-feedback");

    if (!withinStageTolerance(raw, pz.stage3)) {
      attempt.xp = Math.max(0, attempt.xp - 5);
      fb.className = "feedback-msg err";
      fb.textContent = Number.isFinite(raw)
        ? `Outside tolerance (-5 XP). Check rounding and units (${pz.stage3.unit}).`
        : "Enter a valid numerical final answer.";
      renderPuzzleArena();
      return;
    }

    attempt.stage3Cleared = true;
    const now = Date.now();
    const decayDays = Number(topic.decayDaysThreshold || cfg().decayThresholdDays || 7);
    const prev = state.nodeProgress[topic.id] || { reviewCount: 0, xpEarned: 0 };
    const wasAged = prev.lastReviewedAt && (now - prev.lastReviewedAt) >= decayDays * DAY_MS;
    const isSpiralUnlock = state.engagedMode === "spiral" || wasAged || prev.spiralLocked;

    state.nodeProgress[topic.id] = {
      completedAt: prev.completedAt || now,
      lastReviewedAt: now,
      reviewCount: (prev.reviewCount || 0) + 1,
      spiralLocked: Boolean(isSpiralUnlock),
      manualState: null,
      xpEarned: (prev.xpEarned || 0) + attempt.xp
    };
    state.careerXp += attempt.xp;

    if (state.engagedMode === "primary") pauseTimer("primary");
    if (state.engagedMode === "spiral") pauseTimer("spiral");

    const allTopics = getAllTopics();
    const statusMap = computeNodeStates(allTopics);
    if (state.primaryTargetId === topic.id) {
      const { dayObj } = getSelectedScheduleDay();
      const nextInPair = ((dayObj && dayObj.primaryTopicIds) || []).find((id) => id !== topic.id && !state.nodeProgress[id]?.lastReviewedAt);
      const nextAct = nextInPair || (allTopics.find((t) => statusMap[t.id].state === "active") || {}).id;
      if (nextAct) state.primaryTargetId = nextAct;
    }
    if (state.spiralTargetId === topic.id) {
      const { dayObj } = getSelectedScheduleDay();
      const nextSp = ((dayObj && dayObj.spiralTopicIds) || []).find((id) => id !== topic.id);
      state.spiralTargetId = nextSp || null;
    }
    syncTargets(allTopics, statusMap);
    saveState();

    const noteSuffix = pz.stage3.solutionNote ? ` · ${pz.stage3.solutionNote}` : "";
    fb.className = "feedback-msg ok";
    fb.textContent = `NODE UNLOCKED (${pz.stage3.answer} ${pz.stage3.unit})! +${attempt.xp} XP · Status: ${isSpiralUnlock ? "SPIRAL-LOCKED (GOLD)" : "CLEARED (GREEN)"}${noteSuffix}`;
    showToast(`${topic.id} ${isSpiralUnlock ? "Spiral-Locked (Gold)" : "Cleared"}! +${attempt.xp} XP`);
    renderAll();
  }

  // Convert samplePuzzles[] or custom schema into internal puzzle object
  function normalizePuzzleObj(rawPz, fallbackTopicId, fallbackTitle) {
    if (!rawPz || typeof rawPz !== "object") return null;
    if (Array.isArray(rawPz.stages) && rawPz.stages.length >= 3) {
      const s1 = rawPz.stages[0];
      const s2 = rawPz.stages[1];
      const s3 = rawPz.stages[2];
      const opts = Array.isArray(s1.options) ? s1.options : [];
      const cIdx = Number(s1.correctOptionIndex || 0);
      const gov = opts[cIdx] || s1.governingEq;
      const dist = opts.filter((_, i) => i !== cIdx);
      if (!gov) return null;
      return {
        id: rawPz.puzzleId || rawPz.id || `${fallbackTopicId}-IMP-${Date.now()}`,
        source: `${rawPz.puzzleId || "Custom"} · ${rawPz.difficulty || "Board"} (${rawPz.topicName || fallbackTitle})`,
        difficulty: rawPz.difficulty || "Medium",
        stem: rawPz.prompt || rawPz.stem || "",
        s1Instruction: s1.instruction || "Select the governing equation:",
        governingEq: String(gov),
        distractors: dist.length ? dist.map(String) : [`0.5 * (${gov})`, `2 * (${gov})`],
        stage2: {
          prompt: s2.instruction || s2.prompt || "Compute intermediate value:",
          answer: Number(s2.expectedValue ?? s2.answer),
          tolerance: Number(s2.tolerance || 0.01),
          unit: s2.unit || "units"
        },
        stage3: {
          prompt: s3.instruction || s3.prompt || "Compute final answer:",
          answer: Number(s3.expectedValue ?? s3.answer),
          tolerance: Number(s3.tolerance || 0.01),
          unit: s3.unit || "units",
          solutionNote: s3.solutionNote || ""
        },
        hint: (s1.formulaHint || rawPz.hint || "") + (s3.solutionNote ? " — " + s3.solutionNote : "")
      };
    }
    if (rawPz.governingEq && rawPz.stage2 && rawPz.stage3) {
      return rawPz;
    }
    return null;
  }

  function buildCanonicalExportPayload() {
    const topics = getAllTopics();
    const statusMap = computeNodeStates(topics);
    const exportedTopics = topics.map((t) => {
      const prog = state.nodeProgress[t.id] || {};
      const st = statusMap[t.id].state;
      return {
        id: t.id,
        index: t.index,
        sector: t.sector,
        category: t.category,
        name: t.name || t.title,
        isHomeTurf: Boolean(t.isHomeTurf),
        assignedWeek: t.assignedWeek,
        assignedDayOfWeek: t.assignedDayOfWeek,
        status: st,
        lastReviewed: prog.lastReviewedAt ? new Date(prog.lastReviewedAt).toISOString() : null,
        decayDaysThreshold: t.decayDaysThreshold || 7,
        xpEarned: prog.xpEarned || 0,
        rescueLinks: t.rescueLinks
      };
    });

    // Convert customPuzzles into samplePuzzles schema alongside original samplePuzzles
    const allSamples = JSON.parse(JSON.stringify(ctx.samplePuzzles || []));
    Object.entries(state.customPuzzles || {}).forEach(([tid, list]) => {
      const tObj = getTopicById(tid);
      (list || []).forEach((pz) => {
        if (allSamples.some((s) => s.puzzleId === pz.id)) return;
        allSamples.push({
          puzzleId: pz.id,
          topicId: tid,
          topicName: tObj ? tObj.name : tid,
          difficulty: pz.difficulty || "Custom",
          prompt: pz.stem,
          stages: [
            {
              stage: 1,
              instruction: pz.s1Instruction || "Identify the governing equation:",
              options: [pz.governingEq, ...(pz.distractors || [])],
              correctOptionIndex: 0,
              formulaHint: pz.hint || ""
            },
            {
              stage: 2,
              instruction: pz.stage2.prompt,
              expectedValue: pz.stage2.answer,
              tolerance: pz.stage2.tolerance || 0.01,
              unit: pz.stage2.unit
            },
            {
              stage: 3,
              instruction: pz.stage3.prompt,
              expectedValue: pz.stage3.answer,
              tolerance: pz.stage3.tolerance || 0.01,
              unit: pz.stage3.unit,
              solutionNote: pz.stage3.solutionNote || pz.hint || ""
            }
          ]
        });
      });
    });

    const schedCopy = JSON.parse(JSON.stringify(state.customSchedule || ctx.spiralSchedule || []));
    schedCopy.forEach((wk) => {
      wk.days.forEach((d, dIdx) => {
        const key = `W${wk.week}-D${dIdx}`;
        if (state.scheduleProgress && state.scheduleProgress[key]?.completed !== undefined) {
          const val = state.scheduleProgress[key].completed;
          if ("primaryCompleted" in d) {
            d.primaryCompleted = val;
            d.spiralCompleted = val;
          } else {
            d.completed = val;
          }
        }
      });
    });

    const msteCnt = exportedTopics.filter((t) => t.sector === "MSTE").length;
    const hpgeCnt = exportedTopics.filter((t) => t.sector === "HPGE").length;
    const psadCnt = exportedTopics.filter((t) => t.sector === "PSAD").length;

    return {
      appConfig: cfg(),
      summaryCounts: { totalTopics: exportedTopics.length, MSTE: msteCnt, HPGE: hpgeCnt, PSAD: psadCnt },
      topics: exportedTopics,
      spiralSchedule: schedCopy,
      samplePuzzles: allSamples,
      appState: state
    };
  }

  function importUniversalJSON(rawText, fileName) {
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (err) {
      showToast("Invalid JSON syntax: " + err.message);
      return;
    }

    if (data && data.appState && typeof data.appState === "object") {
      state = Object.assign(defaultState(), data.appState);
      if (fileName) state.sourceLabel = `Synced: ${fileName}`;
      saveState();
      initPuzzleAttempt(true);
      renderAll();
      showToast("Restored full CELE Ambush state & curriculum!");
      return;
    }

    if (data.appConfig && typeof data.appConfig === "object") {
      state.appConfig = Object.assign({}, cfg(), data.appConfig);
    }
    if (Array.isArray(data.spiralSchedule) && data.spiralSchedule.length) {
      state.customSchedule = data.spiralSchedule;
      data.spiralSchedule.forEach((wk) => {
        (wk.days || []).forEach((d, dIdx) => {
          if (d.primaryCompleted || d.completed) {
            state.scheduleProgress[`W${wk.week}-D${dIdx}`] = { completed: true };
          }
        });
      });
    }

    let updatedTopics = 0;
    let importedPuzzles = 0;
    const newExtras = [];

    if (Array.isArray(data.topics)) {
      data.topics.forEach((item, idx) => {
        const id = item.id || `T-${String(idx + 1).padStart(3, "0")}`;
        const existing = (ctx.topics || []).find((t) => t.id === id);
        const name = item.name || item.title || (existing && existing.name) || id;
        const ov = {
          sector: item.sector || (existing && existing.sector) || "MSTE",
          category: item.category || (existing && existing.category) || "General",
          name,
          title: name,
          isHomeTurf: item.isHomeTurf !== undefined ? Boolean(item.isHomeTurf) : Boolean(existing && existing.isHomeTurf),
          assignedWeek: item.assignedWeek ?? (existing && existing.assignedWeek),
          assignedDayOfWeek: item.assignedDayOfWeek ?? (existing && existing.assignedDayOfWeek),
          decayDaysThreshold: item.decayDaysThreshold || 7,
          rescueLinks: item.rescueLinks || (existing && existing.rescueLinks)
        };
        if (existing) {
          state.topicOverrides[id] = ov;
        } else {
          newExtras.push({
            id,
            index: item.index || (126 + newExtras.length + 1),
            ...ov,
            defaultPuzzle: ctx.topics[0].defaultPuzzle
          });
        }
        updatedTopics++;

        const stName = String(item.status || "").toLowerCase();
        const ts = item.lastReviewed ? Date.parse(item.lastReviewed) : null;
        if (ts || (stName && stName !== "locked")) {
          state.nodeProgress[id] = {
            completedAt: ts || Date.now(),
            lastReviewedAt: stName === "decaying" ? Date.now() - 10 * DAY_MS : (ts || (stName === "cleared" || stName === "spiral" ? Date.now() : null)),
            reviewCount: stName === "locked" ? 0 : 1,
            spiralLocked: stName.includes("spiral") || stName.includes("gold"),
            manualState: stName === "active" ? "active" : null,
            xpEarned: Number(item.xpEarned || 0)
          };
        }
      });
    }

    if (newExtras.length) state.extraTopics = newExtras;

    if (Array.isArray(data.samplePuzzles)) {
      const baseIds = new Set((ctx.samplePuzzles || []).map((s) => s.puzzleId));
      data.samplePuzzles.forEach((sp) => {
        const tid = sp.topicId || "T-001";
        if (baseIds.has(sp.puzzleId)) return; // already built into seedPuzzles
        const norm = normalizePuzzleObj(sp, tid, sp.topicName || tid);
        if (norm) {
          if (!state.customPuzzles[tid]) state.customPuzzles[tid] = [];
          if (!state.customPuzzles[tid].some((p) => p.id === norm.id)) {
            state.customPuzzles[tid].push(norm);
            importedPuzzles++;
          }
        }
      });
    }

    const totalXpFromTopics = Object.values(state.nodeProgress).reduce((acc, p) => acc + (p.xpEarned || 0), 0);
    if (totalXpFromTopics > state.careerXp) state.careerXp = totalXpFromTopics;

    state.sourceLabel = `${fileName || "cele_ambush_curriculum.json"} · ${updatedTopics || getAllTopics().length} Topics Synced`;
    saveState();
    initPuzzleAttempt(true);
    renderAll();
    showToast(`Synced ${updatedTopics} topics, 14-week schedule & ${importedPuzzles + (ctx.samplePuzzles || []).length} sample puzzles!`);
  }

  function renderWarPlan(topics, statusMap) {
    const sched = state.customSchedule || ctx.spiralSchedule || [];
    const wkSel = document.getElementById("schedule-week-select");
    wkSel.innerHTML = "";
    sched.forEach((wk) => {
      const opt = document.createElement("option");
      opt.value = String(wk.week);
      opt.textContent = `Week ${wk.week} (${wk.dateRange}) — ${wk.title}`;
      if (wk.week === Number(state.selectedWeek)) opt.selected = true;
      wkSel.appendChild(opt);
    });

    const { weekObj, dayObj } = getSelectedScheduleDay();
    const pillsEl = document.getElementById("schedule-day-pills");
    pillsEl.innerHTML = "";
    if (weekObj && Array.isArray(weekObj.days)) {
      weekObj.days.forEach((d, idx) => {
        const key = `W${weekObj.week}-D${idx}`;
        const done = Boolean(state.scheduleProgress?.[key]?.completed || d.primaryCompleted || d.completed);
        const b = document.createElement("button");
        b.type = "button";
        b.className = `day-pill${idx === state.selectedDayIdx ? " active" : ""}${done ? " is-done" : ""}`;
        b.textContent = d.day.slice(0, 3) + (done ? " ✓" : "");
        b.addEventListener("click", () => {
          state.selectedDayIdx = idx;
          const clickedDay = weekObj.days[idx];
          if (clickedDay.primaryTopicIds && clickedDay.primaryTopicIds[0]) {
            state.primaryTargetId = clickedDay.primaryTopicIds[0];
            state.selectedNodeId = clickedDay.primaryTopicIds[0];
          }
          if (clickedDay.spiralTopicIds && clickedDay.spiralTopicIds[0]) {
            state.spiralTargetId = clickedDay.spiralTopicIds[0];
          }
          saveState();
          initPuzzleAttempt(true);
          renderAll();
        });
        pillsEl.appendChild(b);
      });
    }

    const summaryEl = document.getElementById("schedule-day-summary");
    if (dayObj) {
      if (dayObj.type === "Weekly Eval") {
        summaryEl.innerHTML = `<strong>${escapeHtml(dayObj.day)} — Weekly Evaluation:</strong> Mix <code>${escapeHtml(dayObj.evalMix || "Cumulative")}</code> · Timed simulation block.`;
      } else if (dayObj.type === "Rest") {
        summaryEl.innerHTML = `<strong>${escapeHtml(dayObj.day)} — Scheduled Recovery:</strong> Rest day (protect long-term retention).`;
      } else {
        const pIds = (dayObj.primaryTopicIds || []).join(", ");
        const sIds = (dayObj.spiralTopicIds || []).join(", ");
        summaryEl.innerHTML =
          `<strong>${escapeHtml(dayObj.day)}:</strong> Primary <code>${escapeHtml(pIds || "Block")}</code> (${escapeHtml(dayObj.primaryLabel || "")}) · ` +
          `Spiral <code>${escapeHtml(sIds || "—")}</code> (${escapeHtml(dayObj.spiralLabel || "")})`;
      }
    }

    const dayKey = weekObj ? `W${weekObj.week}-D${state.selectedDayIdx}` : "";
    const isDayDone = Boolean(dayKey && state.scheduleProgress?.[dayKey]?.completed);
    document.getElementById("btn-toggle-day-complete").textContent = isDayDone ? "✓ Day Checked Off" : "Mark Day Checkoff";

    const holBanner = document.getElementById("holiday-shutdown-banner");
    const hs = cfg().holidayShutdown;
    if (state.showHolidayBanner && hs) {
      holBanner.style.display = "flex";
      holBanner.innerHTML = `<span><strong>Mandatory Holiday Shutdown (${escapeHtml(hs.start)} to ${escapeHtml(hs.end)}):</strong> ${escapeHtml(hs.rule)}</span><span style="font-family:var(--font-mono);font-size:11.5px;">Between Week 10 &amp; Week 11</span>`;
    } else {
      holBanner.style.display = "none";
    }

    // Render Pair Chips inside Primary & Spiral Cards
    const pChips = document.getElementById("primary-pair-chips");
    pChips.innerHTML = "";
    ((dayObj && dayObj.primaryTopicIds) || []).forEach((tid) => {
      const t = getTopicById(tid);
      if (!t) return;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "pair-chip" + (state.primaryTargetId === tid ? " active" : "");
      chip.textContent = `${tid}: ${t.name} (${statusMap[tid]?.state === "cleared" || statusMap[tid]?.state === "spiral" ? "✓" : "Scheduled"})`;
      chip.addEventListener("click", () => {
        state.primaryTargetId = tid;
        state.selectedNodeId = tid;
        state.engagedMode = "primary";
        saveState();
        initPuzzleAttempt(true);
        renderAll();
      });
      pChips.appendChild(chip);
    });

    const sChips = document.getElementById("spiral-pair-chips");
    sChips.innerHTML = "";
    ((dayObj && dayObj.spiralTopicIds) || []).forEach((tid) => {
      const t = getTopicById(tid);
      if (!t) return;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "pair-chip" + (state.spiralTargetId === tid ? " active" : "");
      chip.textContent = `${tid}: ${t.name}`;
      chip.addEventListener("click", () => {
        state.spiralTargetId = tid;
        state.selectedNodeId = tid;
        state.engagedMode = "spiral";
        saveState();
        initPuzzleAttempt(true);
        renderAll();
      });
      sChips.appendChild(chip);
    });
  }

  function renderAll() {
    const topics = getAllTopics();
    const statusMap = computeNodeStates(topics);
    syncTargets(topics, statusMap);

    document.getElementById("app-title-heading").textContent = cfg().appName || "CELE Ambush Command Center";
    document.getElementById("curriculum-source-label").textContent = state.sourceLabel;

    renderWarPlan(topics, statusMap);

    let clearedTotal = 0;
    let decayingCount = 0;
    let spiralCount = 0;
    let msteCnt = 0, hpgeCnt = 0, psadCnt = 0, htCnt = 0;

    topics.forEach((t) => {
      const s = statusMap[t.id].state;
      if (s === "cleared" || s === "decaying" || s === "spiral") clearedTotal++;
      if (s === "decaying") decayingCount++;
      if (s === "spiral") spiralCount++;
      if (t.sector === "MSTE") msteCnt++;
      if (t.sector === "HPGE") hpgeCnt++;
      if (t.sector === "PSAD") psadCnt++;
      if (t.isHomeTurf) htCnt++;
    });

    document.getElementById("stat-career-xp").textContent = `${state.careerXp} XP`;
    document.getElementById("stat-cleared-count").textContent = `${clearedTotal} / ${topics.length}`;
    document.getElementById("stat-decaying-count").textContent = String(decayingCount);
    document.getElementById("stat-spiral-count").textContent = String(spiralCount);

    document.getElementById("tab-sec-all").textContent = `All Sectors (${topics.length})`;
    document.getElementById("tab-sec-mste").textContent = `MSTE (${msteCnt})`;
    document.getElementById("tab-sec-hpge").textContent = `HPGE (${hpgeCnt})`;
    document.getElementById("tab-sec-psad").textContent = `PSAD (${psadCnt})`;
    document.getElementById("tab-sec-ht").textContent = `Home Turf (${htCnt})`;
    document.getElementById("matrix-heading").textContent = `${topics.length}-Node Decay & Mastery Matrix`;

    // Primary Card
    const pTopic = getTopicById(state.primaryTargetId);
    document.getElementById("primary-topic-title").textContent = `${pTopic.id}: ${pTopic.name}`;
    document.getElementById("primary-topic-meta").textContent =
      `${pTopic.sector} · ${pTopic.category}${pTopic.assignedWeek ? " · Week " + pTopic.assignedWeek + " Day " + pTopic.assignedDayOfWeek : ""}`;
    document.getElementById("primary-target-card").classList.toggle("is-engaged", state.engagedMode === "primary" && state.selectedNodeId === pTopic.id);
    renderTimerUI("primary");

    // Spiral Card
    const spiralTitleEl = document.getElementById("spiral-topic-title");
    const spiralMetaEl = document.getElementById("spiral-topic-meta");
    const engageSpiralBtn = document.getElementById("btn-engage-spiral");
    if (state.spiralTargetId) {
      const sTopic = getTopicById(state.spiralTargetId);
      const sInfo = statusMap[sTopic.id];
      const ageStr = sInfo.days !== null ? `${sInfo.days.toFixed(1)}d since review` : `War Plan W${state.selectedWeek} Spiral`;
      spiralTitleEl.textContent = `${sTopic.id}: ${sTopic.name}`;
      spiralMetaEl.textContent =
        sInfo.days !== null && sInfo.days >= 7 && sInfo.days <= 14
          ? `${sTopic.sector} · Prime 7–14d Window (${ageStr})`
          : `${sTopic.sector} · ${sTopic.category} (${ageStr})`;
      engageSpiralBtn.disabled = false;
      document.getElementById("spiral-target-card").classList.toggle("is-engaged", state.engagedMode === "spiral" && state.selectedNodeId === sTopic.id);
    } else {
      spiralTitleEl.textContent = "Week 1 Base-Building (No Spiral Pair Yet)";
      spiralMetaEl.textContent = "Switch to Week 2–14 above or click 'Simulate Spiral Window' to preview 7–14d retention.";
      engageSpiralBtn.disabled = true;
      document.getElementById("spiral-target-card").classList.remove("is-engaged");
    }
    renderTimerUI("spiral");

    // Inspector Panel
    const selTopic = getTopicById(state.selectedNodeId);
    const selStatus = statusMap[selTopic.id];
    const selProg = state.nodeProgress[selTopic.id] || {};
    document.getElementById("inspector-code-cat").textContent = `${selTopic.id} · ${selTopic.sector} · ${selTopic.category}`;
    document.getElementById("inspector-title").textContent = selTopic.name;
    document.getElementById("inspector-hometurf").style.display = selTopic.isHomeTurf ? "inline-block" : "none";
    document.getElementById("inspector-schedule-slot").textContent =
      selTopic.assignedWeek ? `Assigned War Plan: Week ${selTopic.assignedWeek} · Day ${selTopic.assignedDayOfWeek}` : "Custom Node";
    document.getElementById("inspector-state-badge").textContent = selStatus.state.toUpperCase();
    document.getElementById("inspector-last-reviewed").textContent =
      selStatus.days !== null ? `${selStatus.days.toFixed(1)} days ago` : "Not yet cleared";
    document.getElementById("inspector-reviews-xp").textContent =
      `${selProg.reviewCount || 0} pass · ${selProg.xpEarned || 0} XP`;

    // 126-Node Grid
    const grid = document.getElementById("nodes-grid-container");
    grid.innerHTML = "";
    const q = searchQuery.trim().toLowerCase();

    const filtered = topics.filter((t) => {
      if (filterSector === "HOMETURF" && !t.isHomeTurf) return false;
      if (filterSector !== "ALL" && filterSector !== "HOMETURF" && t.sector !== filterSector) return false;
      if (filterState !== "ALL" && statusMap[t.id].state !== filterState) return false;
      if (q && !(`${t.id} ${t.name} ${t.category} ${t.sector} w${t.assignedWeek}`).toLowerCase().includes(q)) return false;
      return true;
    });

    filtered.forEach((t) => {
      const info = statusMap[t.id];
      const pzTotal = getPuzzlesForTopic(t).length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `node-tile state-${info.state}${state.selectedNodeId === t.id ? " selected" : ""}`;
      const badgeRight =
        info.state === "spiral" ? "★ GOLD" :
        info.days !== null ? `${Math.floor(info.days)}d` :
        info.state === "active" ? "ACTIVE" : `W${t.assignedWeek || "-"}`;
      btn.innerHTML = `
        <div class="node-top">
          <span>${escapeHtml(t.id)}${t.isHomeTurf ? " · HT" : ""}</span>
          <span>${badgeRight}</span>
        </div>
        <div class="node-name">${escapeHtml(t.name)}</div>
        <div class="node-foot">
          <span>${escapeHtml(t.category)}</span>
          <span>${pzTotal} ${pzTotal === 1 ? "puz" : "puzs"}</span>
        </div>
      `;
      btn.addEventListener("click", () => {
        state.selectedNodeId = t.id;
        state.engagedMode = "node";
        saveState();
        initPuzzleAttempt(true);
        renderAll();
        jumpToSectionOnMobile("arena");
      });
      grid.appendChild(btn);
    });

    renderPuzzleArena();
  }

  function setBottomNavActive(navKey) {
    document.querySelectorAll("#ios-bottom-nav .ios-nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.nav === navKey);
    });
  }

  function jumpToSectionOnMobile(navKey, forceScroll) {
    setBottomNavActive(navKey);
    if (!forceScroll && window.innerWidth > 860) return;
    const targetId =
      navKey === "loop" ? "warplan-section" :
      navKey === "arena" ? "puzzle-engine-panel" :
      navKey === "matrix" ? "matrix-section" : null;
    const el = targetId && document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleInputSign(elId) {
    const el = document.getElementById(elId);
    if (!el || el.disabled) return;
    const v = el.value.trim();
    if (v.startsWith("-")) {
      el.value = v.slice(1);
    } else {
      el.value = "-" + v.replace(/^\+/, "");
    }
    el.focus();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById("toast-banner");
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3600);
  }

  function populateBuilderSelect() {
    const sel = document.getElementById("builder-topic-select");
    sel.innerHTML = "";
    getAllTopics().forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.id} — ${t.name} (${t.sector})`;
      if (t.id === state.selectedNodeId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function bindEvents() {
    // War Plan Controls
    document.getElementById("schedule-week-select").addEventListener("change", (e) => {
      state.selectedWeek = parseInt(e.target.value, 10) || 1;
      state.selectedDayIdx = 0;
      const { dayObj } = getSelectedScheduleDay();
      if (dayObj && dayObj.primaryTopicIds && dayObj.primaryTopicIds[0]) {
        state.primaryTargetId = dayObj.primaryTopicIds[0];
        state.selectedNodeId = dayObj.primaryTopicIds[0];
      }
      state.spiralTargetId = (dayObj && dayObj.spiralTopicIds && dayObj.spiralTopicIds[0]) || null;
      saveState();
      initPuzzleAttempt(true);
      renderAll();
    });

    document.getElementById("btn-load-scheduled-pair").addEventListener("click", () => {
      const { dayObj } = getSelectedScheduleDay();
      if (!dayObj) return;
      if (dayObj.primaryTopicIds && dayObj.primaryTopicIds[0]) {
        state.primaryTargetId = dayObj.primaryTopicIds[0];
        state.selectedNodeId = dayObj.primaryTopicIds[0];
        state.engagedMode = "primary";
      }
      if (dayObj.spiralTopicIds && dayObj.spiralTopicIds[0]) {
        state.spiralTargetId = dayObj.spiralTopicIds[0];
      }
      saveState();
      initPuzzleAttempt(true);
      renderAll();
      showToast(`Synced Week ${state.selectedWeek} ${dayObj.day} Primary & Spiral targets!`);
    });

    document.getElementById("btn-toggle-day-complete").addEventListener("click", () => {
      const { weekObj, dayObj } = getSelectedScheduleDay();
      if (!weekObj) return;
      const key = `W${weekObj.week}-D${state.selectedDayIdx}`;
      const curr = Boolean(state.scheduleProgress?.[key]?.completed);
      state.scheduleProgress[key] = { completed: !curr };
      saveState();
      renderAll();
      showToast(`${dayObj.day} (Week ${weekObj.week}) ${!curr ? "checked off!" : "unmarked."}`);
    });

    document.getElementById("btn-toggle-holiday-preview").addEventListener("click", () => {
      state.showHolidayBanner = !state.showHolidayBanner;
      saveState();
      renderAll();
    });

    // Primary & Spiral Card Controls
    document.getElementById("btn-engage-primary").addEventListener("click", () => {
      state.selectedNodeId = state.primaryTargetId;
      state.engagedMode = "primary";
      saveState();
      initPuzzleAttempt(true);
      startTimer("primary");
      renderAll();
      jumpToSectionOnMobile("arena");
    });

    document.getElementById("btn-toggle-primary-timer").addEventListener("click", () => {
      timers.primary.running ? pauseTimer("primary") : startTimer("primary");
    });
    document.getElementById("btn-reset-primary-timer").addEventListener("click", () => resetTimer("primary"));

    document.getElementById("btn-cycle-primary").addEventListener("click", () => {
      const topics = getAllTopics();
      const statusMap = computeNodeStates(topics);
      const candidates = topics.filter((t) => statusMap[t.id].state === "active" || statusMap[t.id].state === "locked");
      if (!candidates.length) return;
      const idx = candidates.findIndex((t) => t.id === state.primaryTargetId);
      const next = candidates[(idx + 1) % candidates.length];
      state.primaryTargetId = next.id;
      state.selectedNodeId = next.id;
      state.engagedMode = "primary";
      saveState();
      initPuzzleAttempt(true);
      renderAll();
    });

    document.getElementById("btn-engage-spiral").addEventListener("click", () => {
      if (!state.spiralTargetId) return;
      state.selectedNodeId = state.spiralTargetId;
      state.engagedMode = "spiral";
      saveState();
      initPuzzleAttempt(true);
      startTimer("spiral");
      renderAll();
      jumpToSectionOnMobile("arena");
    });

    document.getElementById("btn-toggle-spiral-timer").addEventListener("click", () => {
      timers.spiral.running ? pauseTimer("spiral") : startTimer("spiral");
    });
    document.getElementById("btn-reset-spiral-timer").addEventListener("click", () => resetTimer("spiral"));

    document.getElementById("btn-cycle-spiral").addEventListener("click", () => {
      const topics = getAllTopics();
      const statusMap = computeNodeStates(topics);
      const { dayObj } = getSelectedScheduleDay();
      const schedIds = (dayObj && dayObj.spiralTopicIds) || [];
      const agedIds = topics.filter((t) => statusMap[t.id].days !== null && statusMap[t.id].days >= 7).map((t) => t.id);
      const pool = Array.from(new Set([...agedIds, ...schedIds]));
      if (!pool.length) {
        showToast("No 7–14d or scheduled spiral topics on this day. Try Week 2+ or 'Simulate Spiral Window'!");
        return;
      }
      const idx = pool.indexOf(state.spiralTargetId);
      const nextId = pool[(idx + 1) % pool.length];
      state.spiralTargetId = nextId;
      state.selectedNodeId = nextId;
      state.engagedMode = "spiral";
      saveState();
      initPuzzleAttempt(true);
      renderAll();
    });

    // Tactical Rescue & Hint
    document.getElementById("btn-use-hint").addEventListener("click", () => {
      const cost = cfg().hintPenaltyXP || 20;
      if (!attempt.hintUsed) {
        attempt.hintUsed = true;
        attempt.xp = Math.max(0, attempt.xp - cost);
        showToast(`Governing formula revealed (-${cost} XP).`);
      }
      renderPuzzleArena();
    });

    document.getElementById("btn-tactical-rescue").addEventListener("click", () => {
      const cost = cfg().tacticalRescuePenaltyXP || 30;
      pauseTimer("primary");
      pauseTimer("spiral");
      if (!attempt.rescueUsed) {
        attempt.rescueUsed = true;
        attempt.xp = Math.max(0, attempt.xp - cost);
        showToast(`Timer paused! Tactical Rescue links unlocked (-${cost} XP).`);
      }
      renderPuzzleArena();
    });

    document.getElementById("puzzle-selector").addEventListener("change", (e) => {
      activePuzzleIndex = parseInt(e.target.value, 10) || 0;
      initPuzzleAttempt(false);
    });
    document.getElementById("btn-reset-attempt").addEventListener("click", () => initPuzzleAttempt(false));
    document.getElementById("btn-neg-stage-2")?.addEventListener("click", () => toggleInputSign("stage-2-input"));
    document.getElementById("btn-neg-stage-3")?.addEventListener("click", () => toggleInputSign("stage-3-input"));
    document.getElementById("btn-verify-stage-2").addEventListener("click", handleVerifyStage2);
    document.getElementById("stage-2-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleVerifyStage2();
    });
    document.getElementById("btn-verify-stage-3").addEventListener("click", handleVerifyStage3);
    document.getElementById("stage-3-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleVerifyStage3();
    });

    // Inspector Controls
    document.getElementById("btn-set-as-primary").addEventListener("click", () => {
      state.primaryTargetId = state.selectedNodeId;
      state.engagedMode = "primary";
      saveState();
      renderAll();
      showToast(`${state.selectedNodeId} locked into Primary Target Card.`);
    });

    document.getElementById("btn-set-as-spiral").addEventListener("click", () => {
      state.spiralTargetId = state.selectedNodeId;
      state.engagedMode = "spiral";
      saveState();
      renderAll();
      showToast(`${state.selectedNodeId} locked into Spiral Target Card.`);
    });

    document.getElementById("btn-mark-active").addEventListener("click", () => {
      state.nodeProgress[state.selectedNodeId] = { manualState: "active", reviewCount: 0, xpEarned: 0 };
      saveState();
      renderAll();
    });

    document.getElementById("btn-mark-cleared").addEventListener("click", () => {
      const now = Date.now();
      state.nodeProgress[state.selectedNodeId] = {
        completedAt: now, lastReviewedAt: now, reviewCount: 1, spiralLocked: false, xpEarned: 100
      };
      saveState();
      renderAll();
    });

    document.getElementById("btn-age-10d").addEventListener("click", () => {
      const tenDaysAgo = Date.now() - 10 * DAY_MS;
      state.nodeProgress[state.selectedNodeId] = {
        completedAt: tenDaysAgo, lastReviewedAt: tenDaysAgo, reviewCount: 1, spiralLocked: false, xpEarned: 85
      };
      state.spiralTargetId = state.selectedNodeId;
      saveState();
      renderAll();
      showToast(`${state.selectedNodeId} backdated 10d — Amber Decay (>7d) & Spiral Target active!`);
    });

    document.getElementById("btn-mark-spiral-gold").addEventListener("click", () => {
      const now = Date.now();
      state.nodeProgress[state.selectedNodeId] = {
        completedAt: now - 10 * DAY_MS, lastReviewedAt: now, reviewCount: 2, spiralLocked: true, xpEarned: 190
      };
      saveState();
      renderAll();
    });

    // Simulate Spiral Window Demo
    document.getElementById("btn-demo-decay").addEventListener("click", () => {
      const now = Date.now();
      ["T-001", "T-048"].forEach((id) => {
        state.nodeProgress[id] = { completedAt: now - 16 * DAY_MS, lastReviewedAt: now - 1 * DAY_MS, reviewCount: 2, spiralLocked: true, xpEarned: 190 };
      });
      ["T-002", "T-032", "T-079"].forEach((id, i) => {
        const ago = (9 + i * 2) * DAY_MS;
        state.nodeProgress[id] = { completedAt: now - ago, lastReviewedAt: now - ago, reviewCount: 1, spiralLocked: false, xpEarned: 85 };
      });
      ["T-003", "T-028"].forEach((id) => {
        state.nodeProgress[id] = { completedAt: now - 2 * DAY_MS, lastReviewedAt: now - 2 * DAY_MS, reviewCount: 1, spiralLocked: false, xpEarned: 100 };
      });
      state.primaryTargetId = "T-045";
      state.spiralTargetId = "T-002";
      state.selectedNodeId = "T-002";
      state.engagedMode = "spiral";
      if (state.careerXp < 835) state.careerXp = 835;
      saveState();
      initPuzzleAttempt(true);
      renderAll();
      showToast("Simulated 7–14d Spiral Window: T-002 (PUZ-001) & T-032 (PUZ-003) ready in Amber Decay!");
    });

    // Filters & Search
    document.querySelectorAll("#sector-filter-tabs .pill-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#sector-filter-tabs .pill-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        filterSector = btn.dataset.sector;
        renderAll();
      });
    });

    document.querySelectorAll("#state-filter-tabs .pill-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#state-filter-tabs .pill-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        filterState = btn.dataset.state;
        renderAll();
      });
    });

    document.getElementById("node-search-input").addEventListener("input", (e) => {
      searchQuery = e.target.value;
      renderAll();
    });

    // Custom Puzzle Builder Modal
    const builderModal = document.getElementById("builder-modal");
    const openBuilder = () => {
      populateBuilderSelect();
      builderModal.classList.add("open");
    };
    document.getElementById("btn-open-builder").addEventListener("click", openBuilder);
    document.getElementById("btn-encode-for-node").addEventListener("click", openBuilder);
    document.getElementById("btn-close-builder").addEventListener("click", () => builderModal.classList.remove("open"));
    document.getElementById("btn-cancel-builder").addEventListener("click", () => builderModal.classList.remove("open"));

    document.getElementById("btn-autofill-distractors").addEventListener("click", () => {
      const eq = document.getElementById("builder-eq-correct").value.trim();
      if (!eq) {
        showToast("Enter the governing equation first so distractors can be drafted.");
        return;
      }
      document.getElementById("builder-eq-d1").value = eq.replace(/\+/g, "TEMP").replace(/-/g, "+").replace(/TEMP/g, "-") !== eq
        ? eq.replace(/\+/g, "TEMP").replace(/-/g, "+").replace(/TEMP/g, "-")
        : `0.5 * (${eq})`;
      document.getElementById("builder-eq-d2").value = eq.includes("2") ? eq.replace("2", "4") : `2 * (${eq})`;
      document.getElementById("builder-eq-d3").value = eq.includes("/") ? eq.replace("/", "*") : `(${eq}) / 2`;
    });

    document.getElementById("custom-puzzle-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const targetId = document.getElementById("builder-topic-select").value;
      const dList = [
        document.getElementById("builder-eq-d1").value.trim(),
        document.getElementById("builder-eq-d2").value.trim(),
        document.getElementById("builder-eq-d3").value.trim()
      ].filter(Boolean);

      const newPz = {
        id: `PUZ-CUST-${Date.now().toString().slice(-4)}`,
        source: document.getElementById("builder-source-input").value.trim(),
        difficulty: "Custom",
        stem: document.getElementById("builder-stem-input").value.trim(),
        s1Instruction: "Identify the governing equation or free-body condition:",
        governingEq: document.getElementById("builder-eq-correct").value.trim(),
        distractors: dList,
        stage2: {
          prompt: document.getElementById("builder-s2-prompt").value.trim(),
          answer: parseFloat(document.getElementById("builder-s2-ans").value),
          tolerance: 0.01,
          unit: document.getElementById("builder-s2-unit").value.trim()
        },
        stage3: {
          prompt: document.getElementById("builder-s3-prompt").value.trim(),
          answer: parseFloat(document.getElementById("builder-s3-ans").value),
          tolerance: 0.01,
          unit: document.getElementById("builder-s3-unit").value.trim(),
          solutionNote: document.getElementById("builder-hint-input").value.trim()
        },
        hint: document.getElementById("builder-hint-input").value.trim()
      };

      if (!state.customPuzzles[targetId]) state.customPuzzles[targetId] = [];
      state.customPuzzles[targetId].push(newPz);
      state.selectedNodeId = targetId;
      saveState();

      const allForTopic = getPuzzlesForTopic(getTopicById(targetId));
      activePuzzleIndex = allForTopic.length - 1;
      builderModal.classList.remove("open");
      e.target.reset();
      initPuzzleAttempt(false);
      renderAll();
      showToast(`Encoded new puzzle into ${targetId}!`);
    });

    function triggerDownloadBlob(content, filename, mimeType) {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    async function shareOrDownloadFile(content, filename, mimeType, titleText) {
      try {
        const file = new File([content], filename, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: titleText });
          showToast(`Shared ${filename} via iOS/iPadOS Share Sheet!`);
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
      triggerDownloadBlob(content, filename, mimeType);
      showToast(`Saved ${filename}!`);
    }

    // JSON Import / Export Modal & Quick Dropzone
    const jsonModal = document.getElementById("json-modal");
    document.getElementById("btn-open-json").addEventListener("click", () => {
      document.getElementById("json-textarea").value = JSON.stringify(buildCanonicalExportPayload(), null, 2);
      jsonModal.classList.add("open");
    });
    document.getElementById("btn-close-json").addEventListener("click", () => jsonModal.classList.remove("open"));

    document.getElementById("btn-download-backup").addEventListener("click", () => {
      const payload = JSON.stringify(buildCanonicalExportPayload(), null, 2);
      triggerDownloadBlob(payload, "cele_ambush_curriculum.json", "application/json");
      showToast("Exported updated cele_ambush_curriculum.json!");
    });

    document.getElementById("btn-ios-share-json")?.addEventListener("click", () => {
      const payload = JSON.stringify(buildCanonicalExportPayload(), null, 2);
      shareOrDownloadFile(payload, "cele_ambush_curriculum.json", "application/json", "CELE Ambush Curriculum Backup");
    });

    document.getElementById("btn-copy-json").addEventListener("click", () => {
      navigator.clipboard?.writeText(document.getElementById("json-textarea").value);
      showToast("Curriculum JSON copied to clipboard!");
    });

    document.getElementById("btn-apply-pasted-json").addEventListener("click", () => {
      importUniversalJSON(document.getElementById("json-textarea").value, "Pasted Curriculum JSON");
      jsonModal.classList.remove("open");
    });

    document.getElementById("btn-factory-reset").addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      state = defaultState();
      initPuzzleAttempt(true);
      renderAll();
      jsonModal.classList.remove("open");
      showToast("Reset to fresh 126-topic cele_ambush_curriculum.json state.");
    });

    function handleFileObj(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        importUniversalJSON(String(ev.target.result || ""), file.name);
        jsonModal.classList.remove("open");
      };
      reader.readAsText(file);
    }

    const modalFileIn = document.getElementById("modal-json-file-input");
    document.getElementById("btn-upload-json-trigger").addEventListener("click", () => modalFileIn.click());
    modalFileIn.addEventListener("change", (e) => handleFileObj(e.target.files[0]));

    const quickDrop = document.getElementById("quick-json-dropzone");
    const quickFileIn = document.getElementById("quick-json-file-input");
    quickDrop.addEventListener("click", () => quickFileIn.click());
    quickFileIn.addEventListener("change", (e) => handleFileObj(e.target.files[0]));
    quickDrop.addEventListener("dragover", (e) => {
      e.preventDefault();
      quickDrop.classList.add("dragover");
    });
    quickDrop.addEventListener("dragleave", () => quickDrop.classList.remove("dragover"));
    quickDrop.addEventListener("drop", (e) => {
      e.preventDefault();
      quickDrop.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileObj(e.dataTransfer.files[0]);
      }
    });

    // iOS / iPadOS Standalone Install Guide & Bottom Navigation
    const installModal = document.getElementById("install-modal");
    let deferredInstallPrompt = null;

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      const promptBtn = document.getElementById("btn-native-install-prompt");
      if (promptBtn) promptBtn.style.display = "inline-flex";
    });

    document.getElementById("btn-native-install-prompt")?.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      document.getElementById("btn-native-install-prompt").style.display = "none";
      updatePwaTelemetry();
    });

    document.getElementById("btn-open-install")?.addEventListener("click", () => {
      updatePwaTelemetry();
      installModal?.classList.add("open");
    });
    document.getElementById("btn-close-install")?.addEventListener("click", () => installModal?.classList.remove("open"));

    document.getElementById("btn-export-portable-html")?.addEventListener("click", async () => {
      try {
        let cssText = "";
        Array.from(document.styleSheets).forEach((sheet) => {
          try {
            Array.from(sheet.cssRules || []).forEach((r) => { cssText += r.cssText + "\n"; });
          } catch (_) {}
        });
        const cloneDoc = document.documentElement.cloneNode(true);
        cloneDoc.querySelectorAll("link[rel='stylesheet'], link[rel='manifest'], script").forEach((el) => el.remove());
        cloneDoc.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.remove("open"));
        const styleEl = document.createElement("style");
        styleEl.textContent = cssText;
        cloneDoc.querySelector("head").appendChild(styleEl);

        const dataScript = document.createElement("script");
        const safeCtx = JSON.stringify(ctx).replace(/<\/script>/gi, "<\\/script>");
        const safeState = JSON.stringify(state).replace(/<\/script>/gi, "<\\/script>");
        dataScript.textContent =
          `window.CELE_CONTEXT = ${safeCtx};\n` +
          `try { if (!localStorage.getItem("${STORAGE_KEY}")) localStorage.setItem("${STORAGE_KEY}", JSON.stringify(${safeState})); } catch(_) {}\n`;
        cloneDoc.querySelector("body").appendChild(dataScript);

        let runtimeJs = "";
        const appScripts = Array.from(document.querySelectorAll("script"));
        const lastScript = appScripts[appScripts.length - 1];
        if (lastScript && lastScript.src) {
          const resp = await fetch(lastScript.src);
          runtimeJs = await resp.text();
        } else if (lastScript) {
          runtimeJs = lastScript.textContent;
        }
        const appScriptEl = document.createElement("script");
        appScriptEl.textContent = runtimeJs;
        cloneDoc.querySelector("body").appendChild(appScriptEl);

        const fullHtml = "<!DOCTYPE html>\n" + cloneDoc.outerHTML;
        await shareOrDownloadFile(fullHtml, "CELE_Ambush_iOS_Standalone.html", "text/html", "CELE Ambush Standalone App");
      } catch (err) {
        showToast("Portable export notice: " + err.message);
      }
    });

    document.querySelectorAll("#ios-bottom-nav .ios-nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nav = btn.dataset.nav;
        if (nav === "install") {
          updatePwaTelemetry();
          installModal?.classList.add("open");
        } else {
          jumpToSectionOnMobile(nav, true);
        }
      });
    });
  }

  function isStandaloneMode() {
    return Boolean(
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true
    );
  }

  let swStatusText = "Embedded / Ready";
  function updatePwaTelemetry() {
    const standalone = isStandaloneMode();
    const pill = document.getElementById("pwa-standalone-pill");
    const installBtn = document.getElementById("btn-open-install");
    const modeEl = document.getElementById("pwa-mode-readout");
    const swEl = document.getElementById("pwa-sw-readout");

    if (pill) pill.style.display = standalone ? "inline-flex" : "none";
    if (installBtn) {
      installBtn.textContent = standalone ? "✓ Installed · Offline Ready" : "📲 Install on iPad / iPhone";
    }
    if (modeEl) modeEl.textContent = standalone ? "Standalone Home Screen" : "Browser / Preview Mode";
    if (swEl) swEl.textContent = swStatusText;
  }

  function initPwaCapabilities() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then((persisted) => {
        const stEl = document.getElementById("pwa-storage-readout");
        if (stEl) stEl.textContent = persisted ? "Durable Persistent ✓" : "LocalStorage Active";
      }).catch(() => {});
    }

    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      navigator.serviceWorker.register("./sw.js").then(() => {
        swStatusText = "Offline Cached (126 Nodes) ✓";
        updatePwaTelemetry();
      }).catch(() => {
        swStatusText = "Single-File / Local Mode";
        updatePwaTelemetry();
      });
    } else {
      swStatusText = "Single-File Offline Mode";
    }

    window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", updatePwaTelemetry);
    updatePwaTelemetry();

    // Handle Home Screen quick-launch shortcuts (?launch=primary|spiral|matrix)
    try {
      const params = new URLSearchParams(window.location.search);
      const launch = params.get("launch");
      if (launch === "primary") {
        state.selectedNodeId = state.primaryTargetId;
        state.engagedMode = "primary";
        jumpToSectionOnMobile("arena", true);
      } else if (launch === "spiral" && state.spiralTargetId) {
        state.selectedNodeId = state.spiralTargetId;
        state.engagedMode = "spiral";
        jumpToSectionOnMobile("arena", true);
      } else if (launch === "matrix") {
        jumpToSectionOnMobile("matrix", true);
      }
    } catch (_) {}
  }

  // Boot
  bindEvents();
  const bootTopics = getAllTopics();
  const bootStatus = computeNodeStates(bootTopics);
  syncTargets(bootTopics, bootStatus);
  state.selectedNodeId = state.primaryTargetId || "T-001";
  initPuzzleAttempt(true);
  renderAll();
  initPwaCapabilities();
})();

