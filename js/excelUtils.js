/**
 * 智慧護理排班專案 - 獨立 Excel 工具模組 (不使用 import/export 語法)
 */

window.ExcelUtils = {
  /**
   * Excel 匯出功能
   */
  exportExcel: function () {
    if (!window.staffData || window.staffData.length === 0) {
      showMsg("沒有資料可供匯出");
      return;
    }

    const wb = XLSX.utils.book_new();

    // 1. 建立 Excel 表頭列
    const header = ["姓名", "預休日期"];

    // 插入上月最後 5 天的標頭
    for (let i = PREV_DAYS_COUNT; i >= 1; i--) {
      header.push(`前${i}天`);
    }

    // 插入本月日期標頭
    for (let i = 1; i <= window.currentMonthDays; i++) {
      header.push(`${i}號`);
    }

    // 插入右側統計目標標頭
    header.push("白班", "小夜", "大夜", "休假", "欠班");

    // 2. 轉換每位同仁的資料列 (含上月班表、本月班表、右側統計)
    const dataRows = window.staffData.map((s) => {
      // 計算該人員的各班別實際次數
      const counts = countStaffShifts(s);
      const tOff = parseInt(s.targets.off) || RULES.DEFAULT_MONTHLY_OFF;
      const targetWorkDays = window.currentMonthDays - tOff;
      const currentWorkDays = counts.日 + counts.小夜 + counts.大夜;
      const remainingToWork = targetWorkDays - currentWorkDays;

      // 轉換上月最後 5 天班別字串
      const prevShiftsStr = s.prevShifts.map((p) => SHIFT_MAP[p] || p);

      // 轉換本月每日班別字串
      const currentShiftsStr = s.shifts.map((sh, idx) => {
        const isPreRest = s.preRestDays.includes(idx + 1);
        return isPreRest ? "休" : SHIFT_MAP[sh] || sh;
      });

      return [
        s.name,
        (s.preRestDays || []).join(", "),
        ...prevShiftsStr, // 上月最後 5 天
        ...currentShiftsStr, // 本月班表
        counts.日, // 右側統計：白
        counts.小夜, // 右側統計：小
        counts.大夜, // 右側統計：大
        counts.休, // 右側統計：休
        remainingToWork === 0 ? "OK" : remainingToWork, // 右側統計：欠
      ];
    });

    // 3. 建立下方「每日餘裕」資料列
    const surplusRows = [];

    // 準備每日餘裕的三個統計列
    const dRow = ["每日餘裕 (白班)", ""];
    const eRow = ["每日餘裕 (小夜)", ""];
    const nRow = ["每日餘裕 (大夜)", ""];

    // 補足上月5天位置的空格
    for (let i = 0; i < PREV_DAYS_COUNT; i++) {
      dRow.push("");
      eRow.push("");
      nRow.push("");
    }

    // 逐日計算餘裕數據並填入
    for (let d = 0; d < window.currentMonthDays; d++) {
      const type = isWeekendDay(window.currentYear, window.currentMonth, d + 1)
        ? "weekend"
        : "weekday";
      const demand = window.dailyMins[type];

      let counts = { 日: 0, 小夜: 0, 大夜: 0 };
      window.staffData.forEach((s) => {
        if (counts[s.shifts[d]] !== undefined) counts[s.shifts[d]]++;
      });

      const dDiff = counts["日"] - demand["日"];
      const eDiff = counts["小夜"] - demand["小夜"];
      const nDiff = counts["大夜"] - demand["大夜"];

      dRow.push(dDiff >= 0 ? `+${dDiff}` : `缺${Math.abs(dDiff)}`);
      eRow.push(eDiff >= 0 ? `+${eDiff}` : `缺${Math.abs(eDiff)}`);
      nRow.push(nDiff >= 0 ? `+${nDiff}` : `缺${Math.abs(nDiff)}`);
    }

    // 補足右側統計欄位下方的空白
    for (let i = 0; i < 5; i++) {
      dRow.push("");
      eRow.push("");
      nRow.push("");
    }

    surplusRows.push(dRow, eRow, nRow);

    // 4. 合併所有資料並輸出成 Excel 檔案
    const finalTableData = [header, ...dataRows, [], ...surplusRows];
    const ws = XLSX.utils.aoa_to_sheet(finalTableData);

    XLSX.utils.book_append_sheet(wb, ws, "完整排班表");
    XLSX.writeFile(
      wb,
      `護理排班_${window.currentYear}_${window.currentMonth}_完整版.xlsx`
    );
  },

  /**
   * Excel 匯入功能
   */
  importExcel: function () {
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
        const PREV_PADDING = 5;
        const SHIFT_START_INDEX = 2 + PREV_PADDING; // 等於 7

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[0]) continue; // 沒姓名就跳過

          if (String(r[0]).includes("每日餘裕") || String(r[0]).trim() === "") {
            break;
          }

          // 1. 讀取並還原上月最後 5 天班表
          const prevShifts = [];
          for (let p = 0; p < PREV_PADDING; p++) {
            let pv = r[2 + p] || "休";
            if (pv === "白" || pv === "日") pv = "日";
            if (pv === "小") pv = "小夜";
            if (pv === "大") pv = "大夜";
            prevShifts.push(pv);
          }

          // 2. 讀取本月每日班表
          const shifts = [];
          for (let d = 0; d < window.currentMonthDays; d++) {
            let v = r[SHIFT_START_INDEX + d] || "休";
            if (v === "白" || v === "日") v = "日";
            if (v === "小") v = "小夜";
            if (v === "大") v = "大夜";
            shifts.push(v);
          }

          // 3. 讀取預休日期
          const preRestStr = r[1] ? String(r[1]) : "";
          const preRestDays = preRestStr
            ? preRestStr
                .split(/[,,， ]/)
                .map((n) => parseInt(n.trim()))
                .filter((n) => !isNaN(n))
            : [];

          // 4. 重新建構人員物件
          newStaff.push({
            id: `imp_${Date.now()}_${i}`,
            name: r[0],
            targets: {
              day: "",
              evening: "",
              night: "",
              off: 8,
            },
            shifts,
            preRestDays,
            prevShifts,
            manualEdits: new Array(window.currentMonthDays).fill(true),
            isLocked: false,
          });
        }

        if (newStaff.length === 0) {
          showMsg("未從 Excel 中讀取到有效的人員資料");
          return;
        }

        window.staffData = newStaff;
        renderTable();
        showMsg(
          `成功匯入 ${newStaff.length} 位人員的完整班表（含上月跨月班表）！`
        );

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
  },
};
