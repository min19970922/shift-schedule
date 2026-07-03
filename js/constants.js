/**
 * 智慧護理排班專案 - 常數與設定檔
 * 說明：此版本已移除 Firebase，改為純本機 localStorage 模式。
 */

// 1. 班別對照表
const SHIFT_MAP = {
  休: "休",
  日: "日",
  小夜: "小",
  大夜: "大",
};

// 2. 顯示設定
const PREV_DAYS_COUNT = 5; // 顯示前月參考天數

// 3. 初始人力需求
const INITIAL_DAILY_MINS = {
  weekday: { 日: 3, 小夜: 2, 大夜: 1 },
  weekend: { 日: 2, 小夜: 2, 大夜: 1 },
};

// 4. 排班優先順序
const SHIFT_TYPES = ["大夜", "小夜", "日"];

// 5. 排班規則設定
const RULES = {
  MAX_CONSECUTIVE_DAYS: 6, // 連續上班上限
  DEFAULT_MONTHLY_OFF: 8, // 預設月休天數
};

// 6. 介面樣式類名
const SHIFT_CLASSES = {
  休: "bg-shift-off",
  日: "bg-shift-day",
  小夜: "bg-shift-evening",
  大夜: "bg-shift-night",
  預休: "bg-shift-pre",
};

// 7. 本地儲存金鑰前綴
const STORAGE_PREFIX = "nurse_schedule_";
