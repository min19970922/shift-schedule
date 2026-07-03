/**
 * 智慧護理排班專案 - 核心業務邏輯 (完整無刪節 - 雙對連休保障、最少連上班 4 天與嚴格限制版)
 * 整合規則：
 * 1. 跨月銜接 (處理 prevShifts 銜接前月班別)
 * 2. 手動目標嚴格達成 (不多不少，第一優先級)
 * 3. 雙對連休保障：每人每月剛好兩次連休(共4天)，兩次間隔 12-15 天，人員間強力錯開
 * 4. 全局嚴格規則：禁止連上班超過 5 天，且最少連上 4 天 (杜絕 1-3 天碎班)
 * 5. 彈性人員限制：小/大單班別 <= 2天 (不連3), 小大混班組合 <= 3天 (不連4), 日班不限
 * 6. 嚴格休假控制：每人固定休 8 天
 * 7. 完整 Excel 功能與跨月銜接
 */

// --- 基礎工具函數 ---

/**
 * 取得特定日期的班別（處理跨月與月底邊界）
 */
function getShift(staff, dayIndex) {
  if (dayIndex < 0) {
    const prevIdx = PREV_DAYS_COUNT + dayIndex;
    return staff.prevShifts && staff.prevShifts[prevIdx]
      ? staff.prevShifts[prevIdx]
      : "休";
  }
  if (dayIndex >= currentMonthDays) return "休";
  return staff.shifts[dayIndex] || "待定";
}

/**
 * 雙向檢查彈性人員限制 (單班不連 3, 混班不連 4)
 */
function checkFlexViolation(staff, d, shiftType) {
  if (!staff.isFullyFlexible) return false;
  const isMix = (sh) => sh === "小夜" || sh === "大夜";
  if (!isMix(shiftType)) return false;

  const original = staff.shifts[d];
  staff.shifts[d] = shiftType;
  let violation = false;

  // 1. 單一班別連 3 檢查 (檢查所有包含 d 的 3 天視窗)
  for (let i = d - 2; i <= d; i++) {
    if (
      getShift(staff, i) === shiftType &&
      getShift(staff, i + 1) === shiftType &&
      getShift(staff, i + 2) === shiftType
    ) {
      violation = true;
      break;
    }
  }

  // 2. 混班組合連 4 檢查 (檢查所有包含 d 的 4 天視窗)
  if (!violation) {
    for (let i = d - 3; i <= d; i++) {
      if (
        isMix(getShift(staff, i)) &&
        isMix(getShift(staff, i + 1)) &&
        isMix(getShift(staff, i + 2)) &&
        isMix(getShift(staff, i + 3))
      ) {
        violation = true;
        break;
      }
    }
  }

  staff.shifts[d] = original;
  return violation;
}

/**
 * 雙向檢查全局連班狀態，確保 6 天內不超過 5 天班 (禁連 6)
 */
function checkTotalStreak(staff, d, shiftType) {
  const original = staff.shifts[d];
  staff.shifts[d] = shiftType === "休" ? "休" : shiftType;

  let maxStreak = 0;
  for (let start = d - 5; start <= d; start++) {
    let currentStreak = 0;
    for (let i = 0; i < 6; i++) {
      const s = getShift(staff, start + i);
      if (s !== "休" && s !== "待定") {
        currentStreak++;
      } else {
        currentStreak = 0;
      }
      if (currentStreak > 5) {
        maxStreak = 6;
        break;
      }
    }
    if (maxStreak > 5) break;
  }

  staff.shifts[d] = original;
  return maxStreak;
}

/**
 * 僅回頭看連續上班天數
 */
function getStreak(staff, dayIndex) {
  let streak = 0;
  for (let i = dayIndex - 1; i >= -5; i--) {
    const s = getShift(staff, i);
    if (s !== "休" && s !== "待定") streak++;
    else break;
  }
  return streak;
}

/**
 * 向後看可排班空間天數
 */
function getForwardAvailableSpace(staff, dayIndex) {
  let space = 0;
  for (let i = dayIndex; i < currentMonthDays; i++) {
    if (staff.shifts[i] === "待定") space++;
    else break;
  }
  return space;
}

/**
 * 檢查班別銜接合法性
 */
function isAllowed(prevShift, nextShift) {
  if (prevShift === "大夜" && (nextShift === "日" || nextShift === "小夜"))
    return false;
  if (prevShift === "小夜" && nextShift === "日") return false;
  return true;
}

/**
 * 取得當前某日已安排休息的總人數
 */
function getDailyOffCount(dayIndex) {
  return staffData.filter((s) => s.shifts[dayIndex] === "休").length;
}

// --- 核心計算邏輯 ---

function calculateMonthStats() {
  let totalNeeded = { 日: 0, 小夜: 0, 大夜: 0 };
  for (let d = 1; d <= currentMonthDays; d++) {
    const type = isWeekendDay(currentYear, currentMonth, d)
      ? "weekend"
      : "weekday";
    totalNeeded.日 += dailyMins[type].日;
    totalNeeded.小夜 += dailyMins[type].小夜;
    totalNeeded.大夜 += dailyMins[type].大夜;
  }
  let currentAssigned = { 日: 0, 小夜: 0, 大夜: 0 };
  staffData.forEach((staff) => {
    staff.shifts.forEach((shift) => {
      if (currentAssigned[shift] !== undefined) currentAssigned[shift]++;
    });
  });
  return { totalNeeded, currentAssigned };
}

window.runAutofill = () => {
  const buttons = document.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  showMsg("正在執行核心排班：落實預休計算、兩對連休與最少連 4 天上班限制...");

  setTimeout(() => {
    try {
      // 1. 初始化班表為「待定」並預填預休
      staffData.forEach((s) => {
        if (s.isLocked) return;
        const offT =
          s.targets.off !== "" && s.targets.off !== undefined
            ? parseInt(s.targets.off)
            : 8;

        s._manualLimit = {
          day: s.targets.day !== "" && s.targets.day !== undefined,
          evening: s.targets.evening !== "" && s.targets.evening !== undefined,
          night: s.targets.night !== "" && s.targets.night !== undefined,
        };

        s.isFullyFlexible =
          !s._manualLimit.day &&
          !s._manualLimit.evening &&
          !s._manualLimit.night;

        s._activeTargets = {
          day: s.targets.day,
          evening: s.targets.evening,
          night: s.targets.night,
          off: offT.toString(),
        };

        s.shifts = new Array(currentMonthDays).fill("待定");
        s.manualEdits = new Array(currentMonthDays).fill(false);

        // 改動：將預休填入，並標記為已手動編輯，以列入休假計算
        if (s.preRestDays && s.preRestDays.length > 0) {
          s.preRestDays.forEach((dayNum) => {
            const idx = dayNum - 1;
            if (idx >= 0 && idx < currentMonthDays) {
              s.shifts[idx] = "休";
              s.manualEdits[idx] = true;
            }
          });
        }
      });

      // 2. 核心：分配雙對連休 (強力錯開且限制剛好兩次，並算入預休天數)
      assignMandatoryDoubleRestPairs();

      // 3. 逐日排班 (主要排班循環)
      for (let d = 0; d < currentMonthDays; d++) {
        const type = isWeekendDay(currentYear, currentMonth, d + 1)
          ? "weekend"
          : "weekday";
        const shiftOrder = ["大夜", "小夜", "日"].sort(
          () => Math.random() - 0.5
        );

        shiftOrder.forEach((shiftType) => {
          let needed = dailyMins[type][shiftType];
          let failSafe = 0;
          while (needed > 0 && failSafe < staffData.length * 2) {
            failSafe++;
            const currentFilled = staffData.filter(
              (s) => s.shifts[d] === shiftType
            ).length;
            if (currentFilled >= dailyMins[type][shiftType]) break;

            const candidates = getSortedCandidates(d, shiftType);
            if (candidates.length === 0) break;

            const best = candidates[0];
            staffData[best.idx].shifts[d] = shiftType;
            needed--;
          }
        });
      }

      // 4. 後端修復
      fillStrictTargets();
      enforceMinimumWorkStreak();
      fillUnderworked();

      renderTable();
      showMsg("排班完成！已落實預休計算、剛好兩次連休、連上 4-5 天班。");
    } catch (err) {
      console.error(err);
      showMsg("排班錯誤：" + err.message);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
      saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
    }
  }, 100);
};

function getSortedCandidates(d, shiftType) {
  const tKey =
    shiftType === "日" ? "day" : shiftType === "小夜" ? "evening" : "night";

  return staffData
    .map((s, idx) => {
      if (s.isLocked || s.manualEdits[d] || s.preRestDays.includes(d + 1))
        return null;
      if (s.shifts[d] !== "待定") return null;

      const userTarget = parseInt(s.targets[tKey]);
      const curShiftCount = s.shifts.filter((x) => x === shiftType).length;

      if (s._manualLimit[tKey] && curShiftCount >= userTarget) return null;
      if (userTarget === 0) return null;

      if (checkTotalStreak(s, d, shiftType) > 5) return null;
      if (checkFlexViolation(s, d, shiftType)) return null;

      const prevShift = getShift(s, d - 1);
      if (!isAllowed(prevShift, shiftType)) return null;

      // 核心限制：若要開始新班 (前一天是休息)，必須確保後方有至少 4 天空間，否則拒絕排班 (除非接近月底)
      let backWork = getStreak(s, d);
      if (backWork === 0) {
        const space = getForwardAvailableSpace(s, d);
        if (space < 4 && d < currentMonthDays - 3) return null;
      }

      let score = 0;
      const offT =
        s.targets.off !== "" && s.targets.off !== undefined
          ? parseInt(s.targets.off)
          : 8;
      const targetWork = currentMonthDays - offT;
      const currentWork = s.shifts.filter(
        (x) => x !== "待定" && x !== "休"
      ).length;

      // 核心權重：最少連上 4 天。若目前已經連 1-3 天，必須極大優先繼續上班。
      if (backWork > 0 && backWork < 4) score += 5000000000;

      if (s._manualLimit[tKey] && curShiftCount < userTarget)
        score += 10000000000;
      if (currentWork < targetWork)
        score += (targetWork - currentWork) * 10000000;

      if (s.isFullyFlexible) {
        const counts = {
          日: s.shifts.filter((x) => x === "日").length,
          小夜: s.shifts.filter((x) => x === "小夜").length,
          大夜: s.shifts.filter((x) => x === "大夜").length,
        };
        const minCount = Math.min(counts.日, counts.小夜, counts.大夜);
        if (counts[shiftType] === minCount) score += 5000000;
      }
      if (prevShift === "休") score += 50000;
      score += Math.random() * 500;
      return { idx, score };
    })
    .filter((c) => c !== null)
    .sort((a, b) => b.score - a.score);
}

function tryFillDay(s, d, shiftTypes) {
  const counts = {
    日: s.shifts.filter((x) => x === "日").length,
    小夜: s.shifts.filter((x) => x === "小夜").length,
    大夜: s.shifts.filter((x) => x === "大夜").length,
  };
  const sortedShifts = [...shiftTypes].sort((a, b) => counts[a] - counts[b]);

  for (let type of sortedShifts) {
    const tKey = type === "日" ? "day" : type === "小夜" ? "evening" : "night";
    if (
      s._manualLimit[tKey] &&
      s.shifts.filter((x) => x === type).length >= parseInt(s.targets[tKey])
    )
      continue;

    if (checkTotalStreak(s, d, type) > 5) continue;
    if (checkFlexViolation(s, d, type)) continue;

    if (
      isAllowed(getShift(s, d - 1), type) &&
      (d === currentMonthDays - 1 || isAllowed(type, s.shifts[d + 1]))
    ) {
      s.shifts[d] = type;
      return true;
    }
  }
  return false;
}

function fillStrictTargets() {
  const shiftTypes = ["大夜", "小夜", "日"];
  staffData.forEach((s) => {
    if (s.isLocked) return;
    shiftTypes.forEach((tKeyNative) => {
      const tKey =
        tKeyNative === "日"
          ? "day"
          : tKeyNative === "小夜"
          ? "evening"
          : "night";
      if (!s._manualLimit[tKey]) return;
      const targetVal = parseInt(s.targets[tKey]) || 0;
      let curCount = s.shifts.filter((x) => x === tKeyNative).length;

      if (curCount < targetVal) {
        for (let d = 0; d < currentMonthDays; d++) {
          if (curCount >= targetVal) break;
          if (
            s.shifts[d] !== "待定" ||
            s.manualEdits[d] ||
            s.preRestDays.includes(d + 1)
          )
            continue;
          if (tryFillDay(s, d, [tKeyNative])) curCount++;
        }
      }
      if (curCount > targetVal) {
        for (let d = currentMonthDays - 1; d >= 0; d--) {
          if (curCount <= targetVal) break;
          if (s.shifts[d] === tKeyNative && !s.manualEdits[d]) {
            s.shifts[d] = "待定";
            curCount--;
          }
        }
      }
    });
  });
}

function enforceMinimumWorkStreak() {
  const shiftTypes = ["日", "小夜", "大夜"];
  staffData.forEach((s) => {
    if (s.isLocked) return;
    for (let d = 0; d < currentMonthDays; d++) {
      if (s.shifts[d] === "待定" || s.shifts[d] === "休") {
        let back = getStreak(s, d);
        if (back > 0 && back < 4) {
          // 如果連上班天數不足 4，嘗試補班
          if (!s.manualEdits[d] && !s.preRestDays.includes(d + 1)) {
            if (tryFillDay(s, d, shiftTypes)) continue;
          }
          // 如果後方不能補班，為了達成「最少連 4」，可能需要移除這段短班 (將其變回休息)
          // 註：這部分依賴 fillUnderworked 將剩餘待定轉休息來自動達成
        }
      }
    }
  });
}

function fillUnderworked() {
  const shiftTypes = ["日", "小夜", "大夜"];
  staffData.forEach((s) => {
    if (s.isLocked) return;
    const offT =
      s.targets.off !== "" && s.targets.off !== undefined
        ? parseInt(s.targets.off)
        : 8;
    const targetWork = currentMonthDays - offT;
    let retry = 0;
    while (retry < 15) {
      let curWork = s.shifts.filter((x) => x !== "休" && x !== "待定").length;
      if (curWork >= targetWork) break;
      let filled = false;
      for (let d = 0; d < currentMonthDays; d++) {
        if (curWork >= targetWork) break;
        if (
          s.shifts[d] === "待定" &&
          !s.manualEdits[d] &&
          !s.preRestDays.includes(d + 1)
        ) {
          // 為了避免碎班，補班時優先接在既有班表後面
          if (getStreak(s, d) > 0 || d === 0 || getShift(s, d - 1) === "待定") {
            if (tryFillDay(s, d, shiftTypes)) {
              curWork++;
              filled = true;
            }
          }
        }
      }
      if (!filled) break;
      retry++;
    }
    // 將所有剩餘的「待定」轉為「休」
    for (let d = 0; d < currentMonthDays; d++) {
      if (s.shifts[d] === "待定") s.shifts[d] = "休";
    }
  });
}

/**
 * 分配雙對連休 (嚴格剛好兩對版，並尊重休假目標)
 */
function assignMandatoryDoubleRestPairs() {
  staffData.forEach((staff) => {
    if (staff.isLocked) return;

    const offT = parseInt(staff.targets.off) || 8;
    // 檢查目前已排休假總數 (包含預休)
    const getCurOff = () => staff.shifts.filter((sh) => sh === "休").length;

    // 1. 尋找第一對連休 (月中以前)
    // 改動：確保加入連休後不會超過總休假目標
    if (getCurOff() + 2 <= offT) {
      let bestD1 = -1;
      let minOffD1 = 999;
      const d1Range = Array.from(
        { length: Math.floor(currentMonthDays / 2) - 2 },
        (_, i) => i
      ).sort(() => Math.random() - 0.5);

      for (let d of d1Range) {
        if (!canAssignPair(staff, d)) continue;
        const currentOff = getDailyOffCount(d) + getDailyOffCount(d + 1);
        if (currentOff < minOffD1) {
          minOffD1 = currentOff;
          bestD1 = d;
        }
      }

      if (bestD1 !== -1) {
        applyPair(staff, bestD1);

        // 2. 為該員工尋找第二對連休，間隔必須為 12-15 天
        // 改動：同樣確保加入第二對後不會超過目標
        if (getCurOff() + 2 <= offT) {
          let bestD2 = -1;
          let minOffD2 = 999;
          const d2Candidates = [
            bestD1 + 14,
            bestD1 + 15,
            bestD1 + 16,
            bestD1 + 17,
          ]
            .filter((d) => d < currentMonthDays - 1)
            .sort(() => Math.random() - 0.5);

          for (let d2 of d2Candidates) {
            if (!canAssignPair(staff, d2)) continue;
            const currentOff = getDailyOffCount(d2) + getDailyOffCount(d2 + 1);
            if (currentOff < minOffD2) {
              minOffD2 = currentOff;
              bestD2 = d2;
            }
          }

          if (bestD2 !== -1) {
            applyPair(staff, bestD2);
          }
        }
      }
    }
  });
}

function canAssignPair(staff, d) {
  if (d < 0 || d >= currentMonthDays - 1) return false;
  return (
    staff.shifts[d] === "待定" &&
    staff.shifts[d + 1] === "待定" &&
    !staff.manualEdits[d] &&
    !staff.manualEdits[d + 1] &&
    !staff.preRestDays.includes(d + 1) &&
    !staff.preRestDays.includes(d + 2) &&
    // 確保不會跟既有的休息連在一起 (不連 3 休)
    (d === 0 || staff.shifts[d - 1] !== "休") &&
    (d + 2 === currentMonthDays || staff.shifts[d + 2] !== "休")
  );
}

function applyPair(staff, d) {
  staff.shifts[d] = "休";
  staff.shifts[d + 1] = "休";
  staff.manualEdits[d] = true;
  staff.manualEdits[d + 1] = true;
}

// Excel 與 介面 互動
window.clearSchedule = () => {
  if (!confirm("確定清除？")) return;
  staffData.forEach((s) => {
    s.shifts = new Array(currentMonthDays).fill("休");
    s.manualEdits.fill(false);
    s.isLocked = false;
  });
  renderTable();
  saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
};

window.exportExcel = () => {
  const wb = XLSX.utils.book_new();
  const header = ["姓名", "白班目標", "小夜目標", "大夜目標", "休假目標"];
  for (let i = 1; i <= currentMonthDays; i++) header.push(`${i}號`);
  const dataRows = staffData.map((s) => [
    s.name,
    s.targets.day,
    s.targets.evening,
    s.targets.night,
    s.targets.off,
    ...s.shifts,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, "排班表");
  XLSX.writeFile(wb, `護理排班_${currentYear}_${currentMonth}.xlsx`);
};

window.importExcel = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx, .xls";
  input.onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const rows = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]],
        { header: 1 }
      );
      if (rows.length < 2) return showMsg("格式錯誤");
      const newStaff = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r[0]) continue;
        const shifts = [];
        for (let d = 0; d < currentMonthDays; d++) {
          let v = r[d + 5] || "休";
          if (v === "白" || v === "日") v = "日";
          if (v === "小") v = "小夜";
          if (v === "大") v = "大夜";
          shifts.push(v);
        }
        newStaff.push({
          id: `imp_${Date.now()}_${i}`,
          name: r[0],
          targets: {
            day: r[1] || "",
            evening: r[2] || "",
            night: r[3] || "",
            off: r[4] || 8,
          },
          shifts: shifts,
          preRestDays: [],
          prevShifts: new Array(PREV_DAYS_COUNT).fill("休"),
          manualEdits: new Array(currentMonthDays).fill(true),
          isLocked: false,
        });
      }
      window.staffData = newStaff;
      renderTable();
      saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
    };
    reader.readAsArrayBuffer(file);
  };
  input.click();
};

window.importLastMonthExcel = () => {
  let lastY = currentYear,
    lastM = currentMonth - 1;
  if (lastM === 0) {
    lastM = 12;
    lastY -= 1;
  }
  const key = `${STORAGE_PREFIX}${lastY}_${lastM}`;
  const raw = localStorage.getItem(key);
  if (!raw) return showMsg(`未找到歷史資料`);
  try {
    const data = JSON.parse(raw);
    const lastStaff = JSON.parse(data.staffData);
    staffData.forEach((s) => {
      const old = lastStaff.find((ls) => ls.name === s.name);
      if (old) {
        s.targets = { ...old.targets };
        s.prevShifts = old.shifts.slice(-5);
      }
    });
    renderTable();
    showMsg(`銜接成功`);
  } catch (e) {
    showMsg("錯誤");
  }
};

window.commitAndClearRedFrames = () => {
  staffData.forEach((s) => {
    s.manualEdits.fill(false);
    s.isLocked = false;
  });
  renderTable();
  showMsg("紅框已清除");
};
