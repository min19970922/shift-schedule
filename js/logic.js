/**
 * 智慧護理排班專案 - 核心業務邏輯 (完整無刪節 - 調整排班順序與碎班彈性優化版)
 */

// --- 基礎工具函數 ---

/**
 * 取得特定日期的班別 (處理跨月)
 */
function getShift(staff, dayIndex) {
  if (dayIndex < 0) {
    const prevIdx = PREV_DAYS_COUNT + dayIndex;
    return staff.prevShifts && staff.prevShifts[prevIdx]
      ? staff.prevShifts[prevIdx]
      : "休";
  }
  if (dayIndex >= window.currentMonthDays) return "休";
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
 * 雙向檢查全局連班狀態 (禁連 6)
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
 * 取得連續上班天數
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
 * 向後看待定空間
 */
function getForwardAvailableSpace(staff, dayIndex) {
  let space = 0;
  for (let i = dayIndex; i < window.currentMonthDays; i++) {
    if (staff.shifts[i] === "待定") space++;
    else break;
  }
  return space;
}

/**
 * 檢查班別銜接 (大小不可接日，大不可接小)
 * 💡 日班(08-16)接隔日大夜(00-08)中間隔32小時，此處合法放行
 */
function isAllowed(prevShift, nextShift) {
  if (prevShift === "大夜" && (nextShift === "日" || nextShift === "小夜"))
    return false;
  if (prevShift === "小夜" && nextShift === "日") return false;
  return true;
}

/**
 * 當日休息總人數
 */
function getDailyOffCount(dayIndex) {
  return (window.staffData || []).filter((s) => s.shifts[dayIndex] === "休")
    .length;
}

// --- 核心計算邏輯 ---

/**
 * 計算全月統計數據
 */
window.calculateMonthStats = () => {
  let totalNeeded = { 日: 0, 小夜: 0, 大夜: 0 };
  for (let d = 1; d <= window.currentMonthDays; d++) {
    const type = isWeekendDay(window.currentYear, window.currentMonth, d)
      ? "weekend"
      : "weekday";
    totalNeeded.日 += window.dailyMins[type].日;
    totalNeeded.小夜 += window.dailyMins[type].小夜;
    totalNeeded.大夜 += window.dailyMins[type].大夜;
  }
  let currentAssigned = { 日: 0, 小夜: 0, 大夜: 0 };
  (window.staffData || []).forEach((staff) => {
    staff.shifts.forEach((shift) => {
      if (currentAssigned[shift] !== undefined) currentAssigned[shift]++;
    });
  });
  return { totalNeeded, currentAssigned };
};

window.runAutofill = () => {
  const buttons = document.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  showMsg("執行智慧排班：優先滿足夜班基本需求，剩餘多餘人力導入白班...");

  setTimeout(() => {
    try {
      // 1. 初始化
      window.staffData.forEach((s) => {
        if (s.isLocked) return;
        const offT = parseInt(s.targets.off) || 10;

        s._manualLimit = {
          day: s.targets.day !== "" && s.targets.day !== undefined,
          evening: s.targets.evening !== "" && s.targets.evening !== undefined,
          night: s.targets.night !== "" && s.targets.night !== undefined,
        };

        s.isFullyFlexible =
          !s._manualLimit.day &&
          !s._manualLimit.evening &&
          !s._manualLimit.night;
        s.shifts = new Array(window.currentMonthDays).fill("待定");
        s.manualEdits = new Array(window.currentMonthDays).fill(false);

        // 預填預休
        if (s.preRestDays && s.preRestDays.length > 0) {
          s.preRestDays.forEach((dayNum) => {
            const idx = dayNum - 1;
            if (idx >= 0 && idx < window.currentMonthDays) {
              s.shifts[idx] = "休";
              s.manualEdits[idx] = true;
            }
          });
        }
      });

      // 2. 雙對連休與預休湊對
      assignMandatoryDoubleRestPairs();

      // 3. 【第一優先級】達成手動輸入的目標天數
      fillStrictTargets();

      // 4. 逐日排班 (補齊每日基本人力需求)
      for (let d = 0; d < window.currentMonthDays; d++) {
        const type = isWeekendDay(
          window.currentYear,
          window.currentMonth,
          d + 1
        )
          ? "weekend"
          : "weekday";

        // 💡 優化：排班順序全面調整為 大夜 -> 小夜 -> 日班
        const shiftOrder = ["大夜", "小夜", "日"];

        shiftOrder.forEach((shiftType) => {
          let needed = window.dailyMins[type][shiftType];
          let failSafe = 0;
          while (needed > 0 && failSafe < window.staffData.length * 2) {
            failSafe++;
            const currentFilled = window.staffData.filter(
              (s) => s.shifts[d] === shiftType
            ).length;
            if (currentFilled >= window.dailyMins[type][shiftType]) break;

            const candidates = getSortedCandidates(d, shiftType);
            if (candidates.length === 0) break;

            const best = candidates[0];
            window.staffData[best.idx].shifts[d] = shiftType;
            needed--;
          }
        });
      }

      // 5. 後端修復與多餘人力填補
      enforceMinimumWorkStreak();
      fillUnderworked();

      renderTable();
      showMsg("排班成功！已優先滿足大夜與小夜基本坑，多餘人力已導入白班。");
    } catch (err) {
      console.error(err);
      showMsg("排班錯誤：" + err.message);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
      saveScheduleData(
        window.currentYear,
        window.currentMonth,
        window.staffData,
        window.dailyMins
      );
    }
  }, 100);
};

function getSortedCandidates(d, shiftType) {
  const tKey =
    shiftType === "日" ? "day" : shiftType === "小夜" ? "evening" : "night";

  return window.staffData
    .map((s, idx) => {
      if (s.isLocked || s.manualEdits[d]) return null;
      if (s.shifts[d] !== "待定") return null;

      const userTarget = parseInt(s.targets[tKey]);
      const curShiftCount = s.shifts.filter((x) => x === shiftType).length;

      // 1. 如果手動限制該班別為 0 天，不管是哪一種班，都絕對不允許排入
      if (s._manualLimit[tKey] && userTarget === 0) return null;

      // 2. 如果手動限制大於 0 天，且目前排的數量已經達到或超過目標，就不再排
      if (s._manualLimit[tKey] && curShiftCount >= userTarget) return null;

      if (checkTotalStreak(s, d, shiftType) > 5) return null;
      if (checkFlexViolation(s, d, shiftType)) return null;

      const prevShift = getShift(s, d - 1);
      if (!isAllowed(prevShift, shiftType)) return null;

      let score = 0;
      let backWork = getStreak(s, d);

      // 💡 彈性修正：不再用 null 硬性封死少於 4 天的待定空間，改用「碎班懲罰分」
      if (backWork === 0) {
        const space = getForwardAvailableSpace(s, d);
        if (space < 3 && d < window.currentMonthDays - 2) {
          score -= 2000000000; // 空間嚴重不足（連 1-2 天碎班），扣大分
        }
      }

      const offT = parseInt(s.targets.off) || 8;
      const targetWork = window.currentMonthDays - offT;
      const currentWork = s.shifts.filter(
        (x) => x !== "待定" && x !== "休"
      ).length;

      // 延續上班的優先加分（傾向湊成 3-5 天的完整區間）
      if (backWork > 0 && backWork < 5) score += 5000000000;

      const isWeekend = isWeekendDay(
        window.currentYear,
        window.currentMonth,
        d + 1
      );
      if (!isWeekend) score += 50000000;

      // 💡 評分權重微調：配合大夜小夜優先的策略
      if (shiftType === "大夜") score += 4000000000;
      if (shiftType === "小夜") score += 3500000000;
      if (shiftType === "日") score += 1000000000;

      if (s._manualLimit[tKey] && curShiftCount < targetVal)
        score += 10000000000;
      if (currentWork < targetWork)
        score += (targetWork - currentWork) * 10000000;

      if (prevShift === "休") score += 50000;
      score += Math.random() * 500;
      return { idx, score };
    })
    .filter((c) => c !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * 分配雙對連休
 */
function assignMandatoryDoubleRestPairs() {
  window.staffData.forEach((staff) => {
    if (staff.isLocked) return;
    const offT = parseInt(staff.targets.off) || 10;

    const getPairsCount = () => {
      let count = 0;
      for (let i = 0; i < window.currentMonthDays - 1; i++) {
        if (staff.shifts[i] === "休" && staff.shifts[i + 1] === "休") {
          count++;
          i++;
        }
      }
      return count;
    };

    const getCurOffCount = () =>
      staff.shifts.filter((sh) => sh === "休").length;

    for (let i = 0; i < window.currentMonthDays; i++) {
      if (staff.shifts[i] === "休") {
        const hasPrevOff = i > 0 && staff.shifts[i - 1] === "休";
        const hasNextOff =
          i < window.currentMonthDays - 1 && staff.shifts[i + 1] === "休";
        if (!hasPrevOff && !hasNextOff) {
          if (
            getCurOffCount() < offT &&
            i < window.currentMonthDays - 1 &&
            staff.shifts[i + 1] === "待定"
          ) {
            staff.shifts[i + 1] = "休";
            staff.manualEdits[i + 1] = true;
          } else if (
            getCurOffCount() < offT &&
            i > 0 &&
            staff.shifts[i - 1] === "待定"
          ) {
            staff.shifts[i - 1] = "休";
            staff.manualEdits[i - 1] = true;
          }
        }
      }
      if (getPairsCount() >= 2) break;
    }

    let retry = 0;
    while (getPairsCount() < 2 && retry < 20) {
      retry++;
      if (getCurOffCount() + 2 > offT) break;
      let bestD = -1,
        minGlobalOff = 999;
      const range = Array.from(
        { length: window.currentMonthDays - 1 },
        (_, i) => i
      ).sort(() => Math.random() - 0.5);
      for (let d of range) {
        if (canAssignPair(staff, d)) {
          const offTotal = getDailyOffCount(d) + getDailyOffCount(d + 1);
          if (offTotal < minGlobalOff) {
            minGlobalOff = offTotal;
            bestD = d;
          }
        }
      }
      if (bestD !== -1) {
        staff.shifts[bestD] = "休";
        staff.shifts[bestD + 1] = "休";
        staff.manualEdits[bestD] = true;
        staff.manualEdits[bestD + 1] = true;
      } else break;
    }
  });
}

function canAssignPair(staff, d) {
  if (d < 0 || d >= window.currentMonthDays - 1) return false;
  return (
    staff.shifts[d] === "待定" &&
    staff.shifts[d + 1] === "待定" &&
    !staff.manualEdits[d] &&
    !staff.manualEdits[d + 1] &&
    (d === 0 || staff.shifts[d - 1] !== "休") &&
    (d + 2 === window.currentMonthDays || staff.shifts[d + 2] !== "休")
  );
}

function tryFillDay(s, d, shiftTypes) {
  const counts = {
    日: s.shifts.filter((x) => x === "日").length,
    小夜: s.shifts.filter((x) => x === "小夜").length,
    大夜: s.shifts.filter((x) => x === "大夜").length,
  };

  // 💡 排序優先級：大夜 -> 小夜 -> 日班，若夜班次數較少者優先排入
  const sortedShifts = [...shiftTypes].sort((a, b) => {
    if (a === "大夜" && b !== "大夜") return -1;
    if (a === "小夜" && b === "日") return -1;
    if (b === "大夜" && a !== "大夜") return 1;
    if (b === "小夜" && a === "日") return 1;
    return counts[a] - counts[b];
  });

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
      (d === window.currentMonthDays - 1 || isAllowed(type, s.shifts[d + 1]))
    ) {
      s.shifts[d] = type;
      return true;
    }
  }
  return false;
}

/**
 * 【第一優先級】達成手動輸入的目標天數
 */
function fillStrictTargets() {
  window.staffData.forEach((s) => {
    if (s.isLocked) return;
    // 💡 目標天數填充順序同樣改為大夜、小夜優先
    ["大夜", "小夜", "日"].forEach((tKeyNative) => {
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
        for (let d = 0; d < window.currentMonthDays; d++) {
          if (curCount >= targetVal) break;
          if (s.shifts[d] !== "待定" || s.manualEdits[d]) continue;
          if (tryFillDay(s, d, [tKeyNative])) {
            curCount++;
            s.manualEdits[d] = true;
          }
        }
      }
    });
  });
}

function enforceMinimumWorkStreak() {
  window.staffData.forEach((s) => {
    if (s.isLocked) return;
    for (let d = 0; d < window.currentMonthDays; d++) {
      if (
        (s.shifts[d] === "待定" || s.shifts[d] === "休") &&
        getStreak(s, d) > 0 &&
        getStreak(s, d) < 3 // 💡 寬限為：少於 3 天才觸發後端修復補班
      ) {
        if (!s.manualEdits[d]) tryFillDay(s, d, ["大夜", "小夜", "日"]);
      }
    }
  });
}

/**
 * 補齊上班天數 (白班設0者為夜班絕對優先，其餘人力通通導入白班，精準控休 10 天)
 */
function fillUnderworked() {
  window.staffData.forEach((s) => {
    if (s.isLocked) return;

    // 💡 核心天條：一個月基本盤固定休 10 天，其餘天數必須上好上滿
    const FIXED_OFF_DAYS = 10;
    const targetWork = window.currentMonthDays - FIXED_OFF_DAYS;

    let retry = 0;

    // 💡 階段 1：常規夜班限額控人。只有在夜班還沒補滿每日基本需求時，才允許用夜班補同仁的上班天數
    while (retry < 20) {
      let curWork = s.shifts.filter((x) => x !== "休" && x !== "待定").length;
      if (curWork >= targetWork) break;
      let filled = false;

      for (let d = 0; d < window.currentMonthDays; d++) {
        if (curWork >= targetWork) break;
        if (s.shifts[d] === "待定" && !s.manualEdits[d]) {
          const type = isWeekendDay(
            window.currentYear,
            window.currentMonth,
            d + 1
          )
            ? "weekend"
            : "weekday";

          // 檢查當天大夜、小夜是否已經達到基本需求
          const currentFilledNight = window.staffData.filter(
            (staff) => staff.shifts[d] === "大夜"
          ).length;
          const currentFilledEvening = window.staffData.filter(
            (staff) => staff.shifts[d] === "小夜"
          ).length;

          let allowedShifts = [];
          if (currentFilledNight < window.dailyMins[type]["大夜"])
            allowedShifts.push("大夜");
          if (currentFilledEvening < window.dailyMins[type]["小夜"])
            allowedShifts.push("小夜");

          // 夜班有缺人才塞夜班，避免夜班無故人力過剩
          if (allowedShifts.length > 0) {
            if (tryFillDay(s, d, allowedShifts)) {
              curWork++;
              filled = true;
            }
          }
        }
      }
      if (!filled) break;
      retry++;
    }

    // 💡 階段 2：針對「白班設定為 0 的夜班專職人員」進行破例特殊處理
    // 如果她們的天數在階段 1 結束後還是不夠（因為夜班坑滿了），此處允許她們「溢出」塞入夜班，絕對不灌白班！
    if (s._manualLimit.day && parseInt(s.targets.day) === 0) {
      for (let d = 0; d < window.currentMonthDays; d++) {
        let curWorkNightSpecial = s.shifts.filter(
          (x) => x !== "休" && x !== "待定"
        ).length;
        if (curWorkNightSpecial >= targetWork) break; // 天數夠 10 天假了就收手

        if (s.shifts[d] === "待定" && !s.manualEdits[d]) {
          // 只要符合基本安全天條（禁連6、大小不接日、大不接小），無視夜班限額，依序強灌大夜或小夜
          if (tryFillDay(s, d, ["大夜", "小夜"])) {
            // tryFillDay 內部有 manualLimit 阻斷，但因為她們沒限制夜班上限，所以能成功塞入
          }
        }
      }
    }

    // 💡 階段 3：普通彈性人力蓄水池。其餘人員只要上班天數還沒點滿，剩下的格子通通強制塞「日班」
    for (let d = 0; d < window.currentMonthDays; d++) {
      let curWorkFinal = s.shifts.filter(
        (x) => x !== "休" && x !== "待定"
      ).length;
      if (curWorkFinal >= targetWork) break; // 天數夠了就收手

      if (s.shifts[d] === "待定" && !s.manualEdits[d]) {
        // 💡 這裡加上雙重保險：如果手動限制白班為 0，絕對不准灌日班
        if (s._manualLimit.day && parseInt(s.targets.day) === 0) continue;

        // 只要符合勞基法禁連6、花班銜接等安全天條，無視日班需求上限，直接塞日班
        if (
          checkTotalStreak(s, d, "日") <= 5 &&
          isAllowed(getShift(s, d - 1), "日")
        ) {
          s.shifts[d] = "日";
        }
      }
    }

    // 💡 階段 4：最後安全收尾。萬一有極端連班衝突，最後還剩餘待定，才轉為休假
    for (let d = 0; d < window.currentMonthDays; d++) {
      if (s.shifts[d] === "待定") s.shifts[d] = "休";
    }
  });
}
// --- 全域互動與對接 ExcelUtils 的橋樑函式 ---

window.exportExcel = () => {
  ExcelUtils.exportExcel();
};
window.importExcel = () => {
  ExcelUtils.importExcel();
};

window.clearSchedule = () => {
  if (!confirm("確定清除全月班表？")) return;
  window.staffData.forEach((s) => {
    s.shifts = new Array(window.currentMonthDays).fill("休");
    s.manualEdits.fill(false);
    s.isLocked = false;
  });
  renderTable();
  saveScheduleData(
    window.currentYear,
    window.currentMonth,
    window.staffData,
    window.dailyMins
  );
};

window.toggleLock = (index) => {
  if (!window.staffData || !window.staffData[index]) return;
  const staff = window.staffData[index];
  staff.isLocked = !staff.isLocked;
  if (staff.isLocked) {
    staff.manualEdits.fill(true);
  } else {
    staff.manualEdits.fill(false);
  }
  renderTable();
  saveScheduleData(
    window.currentYear,
    window.currentMonth,
    window.staffData,
    window.dailyMins
  );
};
window.lockStaff = window.toggleLock;

window.importLastMonthExcel = () => {
  let lastY = window.currentYear,
    lastM = window.currentMonth - 1;
  if (lastM === 0) {
    lastM = 12;
    lastY -= 1;
  }
  const key = `${STORAGE_PREFIX}${lastY}_${lastM}`;
  const raw = localStorage.getItem(key);
  if (!raw) return showMsg(`未找到 ${lastY}/${lastM} 的歷史資料`);
  try {
    const data = JSON.parse(raw);
    const lastStaff = JSON.parse(data.staffData);
    window.staffData.forEach((s) => {
      const old = lastStaff.find((ls) => ls.name === s.name);
      if (old) {
        s.targets = { ...old.targets };
        s.prevShifts = old.shifts.slice(-5);
      }
    });
    renderTable();
    showMsg(`已成功銜接上月歷史資料與目標設定。`);
  } catch (e) {
    showMsg("銜接歷史資料失敗");
  }
};

window.commitAndClearRedFrames = () => {
  window.staffData.forEach((s) => {
    s.manualEdits.fill(false);
    s.isLocked = false;
  });
  renderTable();
  showMsg("紅框已清除並轉為正式班表");
};
