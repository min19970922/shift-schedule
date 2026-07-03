/**
 * 智慧護理排班專案 - 工具函式
 */

// 取得特定人員在特定日期的班別
function getShift(staff, dayIndex) {
  if (dayIndex < 0) {
    const prevIndex = PREV_DAYS_COUNT + dayIndex;
    if (
      staff.prevShifts &&
      prevIndex >= 0 &&
      prevIndex < staff.prevShifts.length
    ) {
      return staff.prevShifts[prevIndex];
    }
    return "休";
  }
  return staff.shifts[dayIndex];
}

// 取得連續上班天數
function getStreak(staff, dayIdx) {
  let streak = 0;
  for (let k = dayIdx - 1; k >= -PREV_DAYS_COUNT; k--) {
    if (getShift(staff, k) !== "休") streak++;
    else break;
  }
  return streak;
}

// 檢查班別規則
function isAllowed(prev, next) {
  if (prev === "休") return true;
  if (prev === "日") return ["日", "小夜", "大夜", "休"].includes(next);
  if (prev === "小夜") return ["小夜", "大夜", "休"].includes(next);
  if (prev === "大夜") return ["大夜", "休"].includes(next);
  return true;
}

// 統計人員班別次數
function countStaffShifts(staff) {
  const counts = { 日: 0, 小夜: 0, 大夜: 0, 休: 0 };
  staff.shifts.forEach((s) => {
    if (counts[s] !== undefined) counts[s]++;
  });
  return counts;
}

// 取得星期幾標籤 (解決 UI 報錯)
function getDayLabel(year, month, day) {
  const date = new Date(year, month - 1, day);
  return ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
}

// 判斷是否為週末 (解決 UI 報錯)
function isWeekendDay(year, month, day) {
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function showMsg(msg) {
  const el = document.getElementById("status-msg");
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = "";
  }, 3000);
}

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}
