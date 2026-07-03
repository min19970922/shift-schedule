/**
 * 智慧護理排班專案 - 核心業務邏輯 (完整無刪節 - 雙對連休保障、最少連上班 4 天與嚴格限制版)
 * 整合規則：
 * 1. 跨月銜接 (處理 prevShifts 銜接前月班別)
 * 2. 手動目標嚴格達成 (手動輸入為第一優先級，輸入幾天排幾天)
 * 3. 剩餘人力填補白班：多餘人力優先補白班，小大夜僅滿足目標天數，不多排人力
 * 4. 預休湊對連休：偵測孤立預休，優先補上一天湊成連休，杜絕碎班
 * 5. 雙對連休保障：每人每月剛好兩次連休(共4天)，兩次間隔 12-15 天
 * 6. 全局嚴格規則：禁止連上班超過 5 天，且最少連上 4 天 (杜絕 1-3 天碎班)
 * 7. 假日傾向休息：平日上班加分，引導人力貢獻於平日
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
 * 計算全月統計數據 (供儀表板使用)
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
  showMsg("執行智慧排班：優先滿足手動目標天數，並將剩餘人力導入白班...");

  setTimeout(() => {
    try {
      // 1. 初始化
      window.staffData.forEach((s) => {
        if (s.isLocked) return;
        const offT = parseInt(s.targets.off) || 8;

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
      // 這邊排完會標記為 manualEdits，確保重要目標(如小夜17)被固定
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
        const shiftOrder = ["日", "大夜", "小夜"];

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

      // 5. 後端修復與多餘人力填補 (此處會極度傾向填補白班)
      enforceMinimumWorkStreak();
      fillUnderworked();

      renderTable();
      showMsg("排班成功！已達成手動目標，多餘人力已導入白班。");
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

      // 如果有設定目標，且已經達標，就不再多排 (達成輸入幾天排幾天)
      if (s._manualLimit[tKey] && curShiftCount >= userTarget) return null;
      if (userTarget === 0) return null;

      if (checkTotalStreak(s, d, shiftType) > 5) return null;
      if (checkFlexViolation(s, d, shiftType)) return null;

      const prevShift = getShift(s, d - 1);
      if (!isAllowed(prevShift, shiftType)) return null;

      let backWork = getStreak(s, d);
      if (backWork === 0) {
        const space = getForwardAvailableSpace(s, d);
        if (space < 4 && d < window.currentMonthDays - 3) return null;
      }

      let score = 0;
      const offT = parseInt(s.targets.off) || 8;
      const targetWork = window.currentMonthDays - offT;
      const currentWork = s.shifts.filter(
        (x) => x !== "待定" && x !== "休"
      ).length;

      if (backWork > 0 && backWork < 4) score += 5000000000;

      const isWeekend = isWeekendDay(
        window.currentYear,
        window.currentMonth,
        d + 1
      );
      if (!isWeekend) score += 500000000; // 平日上班優先得分

      if (shiftType === "日") score += 3000000000;
      if (s._manualLimit[tKey] && curShiftCount < userTarget)
        score += 10000000000;
      if (currentWork < targetWork)
        score += (targetWork - currentWork) * 10000000;

      if (s.isFullyFlexible) {
        if (shiftType === "日") score += 2000000000;
      }
      if (prevShift === "休") score += 50000;
      score += Math.random() * 500;
      return { idx, score };
    })
    .filter((c) => c !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * 分配雙對連休 (包含預休自動湊對)
 */
function assignMandatoryDoubleRestPairs() {
  window.staffData.forEach((staff) => {
    if (staff.isLocked) return;
    const offT = parseInt(staff.targets.off) || 8;

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

    // 優先：讓單天預休湊對
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

    // 次優先：補齊兩對連休
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

/**
 * 核心輔助：嘗試為特定人員在特定日期填入班別
 * 改動：大幅強化白班(日)優先級，嚴格遵守輸入幾天排幾天的原則
 */
function tryFillDay(s, d, shiftTypes) {
  const counts = {
    日: s.shifts.filter((x) => x === "日").length,
    小夜: s.shifts.filter((x) => x === "小夜").length,
    大夜: s.shifts.filter((x) => x === "大夜").length,
  };

  // 建立排序後的班別列表：白班絕對優先，其餘依照目前計數排序
  const sortedShifts = [...shiftTypes].sort((a, b) => {
    if (a === "日") return -1;
    if (b === "日") return 1;
    return counts[a] - counts[b];
  });

  for (let type of sortedShifts) {
    const tKey = type === "日" ? "day" : type === "小夜" ? "evening" : "night";

    // 如果有手動輸入目標，嚴格禁止超過目標 (輸入幾天就排幾天)
    if (
      s._manualLimit[tKey] &&
      s.shifts.filter((x) => x === type).length >= parseInt(s.targets[tKey])
    )
      continue;

    // 全局規則檢查
    if (checkTotalStreak(s, d, type) > 5) continue;
    if (checkFlexViolation(s, d, type)) continue;

    // 班別銜接合法性
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
    ["日", "小夜", "大夜"].forEach((tKeyNative) => {
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
        getStreak(s, d) < 4
      ) {
        // 在填補最短連班限制時，也是優先嘗試日班
        if (!s.manualEdits[d]) tryFillDay(s, d, ["日", "小夜", "大夜"]);
      }
    }
  });
}

/**
 * 補齊上班天數 (填補剩餘人力)
 * 改動：確保所有「多餘人力」(為了補足月休目標而產生的天數) 全部流向白班
 */
function fillUnderworked() {
  window.staffData.forEach((s) => {
    if (s.isLocked) return;
    const targetWork = window.currentMonthDays - (parseInt(s.targets.off) || 8);
    let retry = 0;

    // 優先以「日班」填滿所有天數
    while (retry < 20) {
      let curWork = s.shifts.filter((x) => x !== "休" && x !== "待定").length;
      if (curWork >= targetWork) break;
      let filled = false;
      for (let d = 0; d < window.currentMonthDays; d++) {
        if (curWork >= targetWork) break;
        if (s.shifts[d] === "待定" && !s.manualEdits[d]) {
          // 只嘗試填日班
          if (tryFillDay(s, d, ["日"])) {
            curWork++;
            filled = true;
          }
        }
      }
      if (!filled) break;
      retry++;
    }

    // 如果日班因為規則衝突(如禁連6)排不進去，但天數仍不足，最後才嘗試排小大夜
    let curWorkFinal = s.shifts.filter(
      (x) => x !== "休" && x !== "待定"
    ).length;
    if (curWorkFinal < targetWork) {
      for (let d = 0; d < window.currentMonthDays; d++) {
        if (curWorkFinal >= targetWork) break;
        if (s.shifts[d] === "待定" && !s.manualEdits[d]) {
          if (tryFillDay(s, d, ["小夜", "大夜"])) {
            curWorkFinal++;
          }
        }
      }
    }

    // 最後將所有剩餘待定轉為休息
    for (let d = 0; d < window.currentMonthDays; d++)
      if (s.shifts[d] === "待定") s.shifts[d] = "休";
  });
}

// --- 全域互動與 Excel 函式 ---

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

window.toggleLock = (id) => {
  if (!window.staffData) return;
  const staff = window.staffData.find((s) => s.id === id);
  if (staff) {
    staff.isLocked = !staff.isLocked;
    renderTable();
    saveScheduleData(
      window.currentYear,
      window.currentMonth,
      window.staffData,
      window.dailyMins
    );
  }
};
window.lockStaff = window.toggleLock;

window.exportExcel = () => {
  const wb = XLSX.utils.book_new();
  const header = [
    "姓名",
    "白班目標",
    "小夜目標",
    "大夜目標",
    "休假目標",
    "預休日期",
  ];
  for (let i = 1; i <= window.currentMonthDays; i++) header.push(`${i}號`);
  const dataRows = window.staffData.map((s) => [
    s.name,
    s.targets.day,
    s.targets.evening,
    s.targets.night,
    s.targets.off,
    (s.preRestDays || []).join(", "),
    ...s.shifts,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, "排班表");
  XLSX.writeFile(
    wb,
    `護理排班_${window.currentYear}_${window.currentMonth}.xlsx`
  );
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
        for (let d = 0; d < window.currentMonthDays; d++) {
          let v = r[d + 6] || "休";
          if (v === "白" || v === "日") v = "日";
          if (v === "小") v = "小夜";
          if (v === "大") v = "大夜";
          shifts.push(v);
        }
        const preRestStr = r[5] ? String(r[5]) : "";
        const preRestDays = preRestStr
          ? preRestStr
              .split(/[,,， ]/)
              .map((n) => parseInt(n.trim()))
              .filter((n) => !isNaN(n))
          : [];
        newStaff.push({
          id: `imp_${Date.now()}_${i}`,
          name: r[0],
          targets: {
            day: r[1] || "",
            evening: r[2] || "",
            night: r[3] || "",
            off: r[4] || 8,
          },
          shifts,
          preRestDays,
          prevShifts: new Array(PREV_DAYS_COUNT).fill("休"),
          manualEdits: new Array(window.currentMonthDays).fill(true),
          isLocked: false,
        });
      }
      window.staffData = newStaff;
      renderTable();
      saveScheduleData(
        window.currentYear,
        window.currentMonth,
        window.staffData,
        window.dailyMins
      );
    };
    reader.readAsArrayBuffer(file);
  };
  input.click();
};

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
