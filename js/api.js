/**
 * 智慧護理排班專案 - 本地儲存處理 (API Mock)
 * 說明：負責使用 localStorage 進行資料的儲存與讀取。
 */

/**
 * 初始化本地連線 (取代 Firebase 初始化)
 * @param {Function} onReady - 初始化完成後的回呼
 */
async function initLocalConnection(onReady) {
  console.log("已啟動純本機模式 (localStorage)");

  // 模擬非同步載入過程
  setTimeout(() => {
    if (onReady) onReady({ uid: "local-user" });
  }, 100);
}

/**
 * 儲存排班資料到 localStorage (加入地點)
 */
function saveScheduleData(year, month, staffData, dailyMins, silent = true) {
  // 💡 關鍵：金鑰加入 currentLocation
  const loc = window.currentLocation || "預設地點";
  const key = `${STORAGE_PREFIX}${loc}_${year}_${month}`;
  try {
    const dataToSave = {
      staffData: JSON.stringify(staffData),
      dailyMins: dailyMins,
      lastUpdated: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(dataToSave));

    if (!silent) showMsg(`[${loc}] 本地儲存成功`);
  } catch (e) {
    console.error("本地儲存失敗:", e);
    showMsg("儲存失敗：瀏覽器空間可能已滿");
  }
}

/**
 * 讀取/監聽本地資料 (加入地點)
 */
function subscribeToSchedule(year, month, onUpdate) {
  const loc = window.currentLocation || "預設地點";
  const key = `${STORAGE_PREFIX}${loc}_${year}_${month}`;
  const rawData = localStorage.getItem(key);

  if (rawData) {
    try {
      const data = JSON.parse(rawData);
      onUpdate({
        staffData: JSON.parse(data.staffData),
        dailyMins: data.dailyMins,
      });
    } catch (e) {
      console.error("解析本地資料失敗:", e);
      onUpdate(null);
    }
  } else {
    onUpdate(null);
  }
}
