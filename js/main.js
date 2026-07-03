/**
 * 智慧護理排班專案 - 主程式 (Main)
 * 說明：定義全域狀態，並初始化本地儲存與 UI 介面。
 */

// --- 全域狀態變數 ---
window.staffData = [];
window.dailyMins = deepCopy(INITIAL_DAILY_MINS);
window.currentYear = new Date().getFullYear();
window.currentMonth = new Date().getMonth() + 1;
window.currentMonthDays = new Date(
  window.currentYear,
  window.currentMonth,
  0
).getDate();

/**
 * 應用程式初始化
 */
async function initApp() {
  // 1. 初始化日期選擇器
  const yIn = document.getElementById("year-input");
  const mIn = document.getElementById("month-input");

  if (yIn && mIn) {
    yIn.value = window.currentYear;
    mIn.value = window.currentMonth;

    const handleDateChange = () => {
      window.currentYear = parseInt(yIn.value);
      window.currentMonth = parseInt(mIn.value);
      window.currentMonthDays = new Date(
        window.currentYear,
        window.currentMonth,
        0
      ).getDate();

      // 切換月份時顯示載入訊息
      showMsg(`切換至 ${window.currentYear}/${window.currentMonth}...`);

      // 重新讀取新月份的本地資料
      subscribeToSchedule(window.currentYear, window.currentMonth, (data) => {
        if (data) {
          window.staffData = data.staffData;
          window.dailyMins = data.dailyMins || deepCopy(INITIAL_DAILY_MINS);
        } else {
          // 若無資料，建立預設人員
          window.staffData = [];
          for (let i = 0; i < 5; i++) window.addStaff();
        }
        renderDailyMinsInputs();
        renderTable();
      });
    };

    yIn.onchange = handleDateChange;
    mIn.onchange = handleDateChange;
  }

  // 2. 初始化本地連線 (修正處：改為呼叫 initLocalConnection)
  await initLocalConnection((user) => {
    // 初始化成功後，執行第一次資料載入
    subscribeToSchedule(window.currentYear, window.currentMonth, (data) => {
      if (data) {
        window.staffData = data.staffData;
        window.dailyMins = data.dailyMins || deepCopy(INITIAL_DAILY_MINS);
      } else {
        // 若完全沒資料，初始化預設名單
        if (window.staffData.length === 0) {
          for (let i = 0; i < 5; i++) window.addStaff();
        }
      }
      renderDailyMinsInputs();
      renderTable();
    });
  });

  // 3. 初始渲染
  renderDailyMinsInputs();
  renderTable();
}

// 監聽視窗載入事件
window.onload = initApp;

/**
 * 截圖功能 (相容原本 HTML 邏輯)
 */
window.downloadImage = (event) => {
  const btn = event.currentTarget;
  const txt = btn.innerText;
  btn.innerText = "處理中...";
  btn.disabled = true;
  const node = document.querySelector(".table-container");

  if (typeof html2canvas === "undefined") {
    showMsg("截圖元件尚未載入");
    btn.innerText = txt;
    btn.disabled = false;
    return;
  }

  html2canvas(node, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
  })
    .then((cvs) => {
      const a = document.createElement("a");
      a.download = `Schedule_${window.currentYear}_${window.currentMonth}.png`;
      a.href = cvs.toDataURL("image/png");
      a.click();
      btn.innerText = txt;
      btn.disabled = false;
    })
    .catch((err) => {
      console.error(err);
      btn.innerText = txt;
      btn.disabled = false;
      showMsg("截圖失敗");
    });
};
