/**
 * 智慧護理排班專案 - 主程式 (Main)
 * 說明：定義全域狀態，並初始化本地儲存與 UI 介面。
 */

// --- 1. 全域狀態與多地點變數初始化 (最優先執行) ---
window.staffData = [];
window.dailyMins = deepCopy(INITIAL_DAILY_MINS);
window.currentYear = new Date().getFullYear();
window.currentMonth = new Date().getMonth() + 1;
window.currentMonthDays = new Date(
  window.currentYear,
  window.currentMonth,
  0
).getDate();

// 多地點初始化
window.currentLocation = localStorage.getItem("nurse_current_loc") || "ICU病房";
window.locationList = JSON.parse(localStorage.getItem("nurse_loc_list")) || [
  "5F護理站",
  "7F護理站",
  "急診室",
];

// --- 2. 多地點分頁功能函式 ---
/**
 * 渲染分頁 Tabs UI
 */
window.renderLocationTabs = function () {
  const container = document.getElementById("location-tabs");
  if (!container) return;

  container.innerHTML = window.locationList
    .map((loc) => {
      const isCurrent = loc === window.currentLocation;
      const activeClass = isCurrent
        ? "bg-indigo-600 text-white font-bold shadow"
        : "bg-white text-gray-600 hover:bg-gray-200 border-gray-300";

      return `
      <button onclick="window.switchLocation('${loc}')" 
              ondblclick="window.renameLocation('${loc}')"
              title="按兩下可修改名稱"
              class="control-button px-4 text-xs transition-all ${activeClass}">
        ${loc}
      </button>
    `;
    })
    .join("");
};

/**
 * 🌟 新增：修改特定分頁名稱的功能
 */
window.renameLocation = function (oldName) {
  const newName = prompt(`請輸入【${oldName}】的新地點/部門名稱：`, oldName);
  if (!newName || newName.trim() === "" || newName.trim() === oldName) return;
  const cleanName = newName.trim();

  if (window.locationList.includes(cleanName)) {
    alert("該排班地點名稱已存在！");
    return;
  }

  // 1. 搬移 localStorage 舊資料到新名字的 key 下
  const oldKey = `${STORAGE_PREFIX}${oldName}_${window.currentYear}_${window.currentMonth}`;
  const newKey = `${STORAGE_PREFIX}${cleanName}_${window.currentYear}_${window.currentMonth}`;
  const oldData = localStorage.getItem(oldKey);
  if (oldData) {
    localStorage.setItem(newKey, oldData);
    localStorage.removeItem(oldKey); // 刪除舊資料
  }

  // 2. 更新清單陣列中的名稱
  window.locationList = window.locationList.map((l) =>
    l === oldName ? cleanName : l
  );
  localStorage.setItem("nurse_loc_list", JSON.stringify(window.locationList));

  // 3. 全域當前地點切換至新名稱並刷新
  window.currentLocation = cleanName;
  localStorage.setItem("nurse_current_loc", cleanName);

  window.renderLocationTabs();
  showMsg(`成功將名稱修改為：${cleanName}`);

  // 觸發重新整理標題與畫面
  if (typeof renderTable === "function") renderTable();
};

/**
 * 切換排班地點
 */
window.switchLocation = function (loc) {
  window.currentLocation = loc;
  localStorage.setItem("nurse_current_loc", loc);
  window.renderLocationTabs();

  showMsg(`已切換至：${loc}`);

  // 觸發重新讀取資料與渲染
  const yIn = document.getElementById("year-input");
  if (yIn) yIn.onchange();
};

/**
 * 新增排班地點分頁
 */
window.addNewLocation = function () {
  const name = prompt("請輸入新的排班地方/部門名稱：");
  if (!name || name.trim() === "") return;
  const cleanName = name.trim();

  if (window.locationList.includes(cleanName)) {
    alert("該排班地點已存在！");
    return;
  }

  window.locationList.push(cleanName);
  localStorage.setItem("nurse_loc_list", JSON.stringify(window.locationList));
  window.switchLocation(cleanName);
};

/**
 * 刪除當前排班地點
 */
window.deleteCurrentLocation = function () {
  if (window.locationList.length <= 1) {
    alert("必須保留至少一個排班地點！");
    return;
  }

  if (
    !confirm(
      `確定要刪除【${window.currentLocation}】分頁與其本月所有本地班表嗎？此操作不可逆！`
    )
  ) {
    return;
  }

  // 移除本地儲存資料
  const key = `${STORAGE_PREFIX}${window.currentLocation}_${window.currentYear}_${window.currentMonth}`;
  localStorage.removeItem(key);

  // 從清單中移除
  window.locationList = window.locationList.filter(
    (l) => l !== window.currentLocation
  );
  localStorage.setItem("nurse_loc_list", JSON.stringify(window.locationList));

  // 切換回第一個地點
  window.switchLocation(window.locationList[0]);
};

// --- 3. 核心初始化應用程式 ---
async function initApp() {
  // 先把分頁列長出來
  window.renderLocationTabs();

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

      showMsg(`切換至 ${window.currentYear}/${window.currentMonth}...`);

      subscribeToSchedule(window.currentYear, window.currentMonth, (data) => {
        if (data) {
          window.staffData = data.staffData;
          window.dailyMins = data.dailyMins || deepCopy(INITIAL_DAILY_MINS);
        } else {
          window.staffData = [];
          window.dailyMins = deepCopy(INITIAL_DAILY_MINS);
          for (let i = 0; i < 5; i++) window.addStaff();
        }
        renderDailyMinsInputs();
        renderTable();
      });
    };

    yIn.onchange = handleDateChange;
    mIn.onchange = handleDateChange;
  }

  // 2. 初始化本地連線
  await initLocalConnection((user) => {
    subscribeToSchedule(window.currentYear, window.currentMonth, (data) => {
      if (data) {
        window.staffData = data.staffData;
        window.dailyMins = data.dailyMins || deepCopy(INITIAL_DAILY_MINS);
      } else {
        window.dailyMins = deepCopy(INITIAL_DAILY_MINS);
        if (window.staffData.length === 0) {
          for (let i = 0; i < 5; i++) window.addStaff();
        }
      }
      renderDailyMinsInputs();
      renderTable();
    });
  });
}

// 監聽視窗載入事件
window.onload = initApp;

/**
 * 截圖功能
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
      // 💡 截圖檔名也貼心地加入地點識別
      a.download = `Schedule_${window.currentLocation}_${window.currentYear}_${window.currentMonth}.png`;
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
