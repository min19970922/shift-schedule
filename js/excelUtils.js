/**
 * 智慧護理排班專案 - 獨立 Excel 工具模組 (不使用 import/export 語法)
 */

window.ExcelUtils = {
  /**
   * Excel 匯出功能 (已整合多地點、去除"號"字、六日底色、全域框線與第一欄靠左優化)
   */
  exportExcel: function () {
    if (!window.staffData || window.staffData.length === 0) {
      showMsg("沒有資料可供匯出");
      return;
    }

    const wb = XLSX.utils.book_new();
    const loc = window.currentLocation || "預設地點";

    // 1. 建立 Excel 表頭列 (日期僅輸出 1, 2, 3...)
    const header = ["姓名", "預休日期"];

    // 插入上月最後 5 天的標頭
    for (let i = PREV_DAYS_COUNT; i >= 1; i--) {
      header.push(`前${i}天`);
    }

    // 插入本月日期標頭 💡 已修改：移除 "號" 字，只留純數字
    for (let i = 1; i <= window.currentMonthDays; i++) {
      header.push(i);
    }

    // 插入右側統計目標標頭
    header.push("白班", "小夜", "大夜", "休假", "欠班");

    // 2. 轉換每位同仁的資料列
    const dataRows = window.staffData.map((s) => {
      const counts = countStaffShifts(s);
      const tOff = parseInt(s.targets.off) || RULES.DEFAULT_MONTHLY_OFF;
      const targetWorkDays = window.currentMonthDays - tOff;
      const currentWorkDays = counts.日 + counts.小夜 + counts.大夜;
      const remainingToWork = targetWorkDays - currentWorkDays;

      const prevShiftsStr = s.prevShifts.map((p) => SHIFT_MAP[p] || p);

      const currentShiftsStr = s.shifts.map((sh, idx) => {
        const isPreRest = s.preRestDays.includes(idx + 1);
        return isPreRest ? "休" : SHIFT_MAP[sh] || sh;
      });

      return [
        s.name,
        (s.preRestDays || []).join(", "),
        ...prevShiftsStr,
        ...currentShiftsStr,
        counts.日,
        counts.小夜,
        counts.大夜,
        counts.休,
        remainingToWork === 0 ? "OK" : remainingToWork,
      ];
    });

    // 3. 建立下方「每日餘裕」資料列
    const surplusRows = [];
    const dRow = ["每日餘裕 (白班)", ""];
    const eRow = ["每日餘裕 (小夜)", ""];
    const nRow = ["每日餘裕 (大夜)", ""];

    for (let i = 0; i < PREV_DAYS_COUNT; i++) {
      dRow.push("");
      eRow.push("");
      nRow.push("");
    }

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

    for (let i = 0; i < 5; i++) {
      dRow.push("");
      eRow.push("");
      nRow.push("");
    }

    surplusRows.push(dRow, eRow, nRow);

    // 4. 合併所有資料並生成工作表
    const finalTableData = [header, ...dataRows, [], ...surplusRows];
    const ws = XLSX.utils.aoa_to_sheet(finalTableData);

    // 🌟 5. 全域儲存格遍歷：處理框線、週末底色與對齊優化 🌟
    const START_COL_INDEX = 2 + PREV_DAYS_COUNT;

    // A. 週末樣式：淡紅底色 + 灰色細邊框 + 置中
    const weekendStyle = {
      fill: { fgColor: { rgb: "FFF0F0" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: {
        top: { style: "thin", color: { rgb: "D3D3D3" } },
        bottom: { style: "thin", color: { rgb: "D3D3D3" } },
        left: { style: "thin", color: { rgb: "D3D3D3" } },
        right: { style: "thin", color: { rgb: "D3D3D3" } },
      },
    };

    // B. 一般平日與統計樣式：灰色細邊框 + 置中
    const normalCenterStyle = {
      alignment: { horizontal: "center", vertical: "center" },
      border: {
        top: { style: "thin", color: { rgb: "D3D3D3" } },
        bottom: { style: "thin", color: { rgb: "D3D3D3" } },
        left: { style: "thin", color: { rgb: "D3D3D3" } },
        right: { style: "thin", color: { rgb: "D3D3D3" } },
      },
    };

    // C. 第一欄專用樣式（姓名、每日餘裕文字）：灰色細邊框 + 💡 靠左對齊
    const firstColLeftStyle = {
      alignment: { horizontal: "left", vertical: "center" },
      border: {
        top: { style: "thin", color: { rgb: "D3D3D3" } },
        bottom: { style: "thin", color: { rgb: "D3D3D3" } },
        left: { style: "thin", color: { rgb: "D3D3D3" } },
        right: { style: "thin", color: { rgb: "D3D3D3" } },
      },
    };

    // 雙重迴圈遍歷每一個格子進行樣式注入
    for (let r = 0; r < finalTableData.length; r++) {
      for (let c = 0; c < header.length; c++) {
        const colLetter = XLSX.utils.encode_col(c);
        const cellRef = `${colLetter}${r + 1}`;

        if (ws[cellRef]) {
          // 確保型態為物件以利注入樣式
          if (typeof ws[cellRef] !== "object") {
            ws[cellRef] = { v: ws[cellRef], t: "s" };
          }

          // 判斷分流套用樣式
          if (c === 0) {
            // 💡 1. 如果是第一欄 (欄位索引 0)，通通套用靠左樣式
            ws[cellRef].s = firstColLeftStyle;
          } else {
            // 2. 檢查目前是否為本月日期範圍
            const isDateCol =
              c >= START_COL_INDEX &&
              c < START_COL_INDEX + window.currentMonthDays;
            const currentDayNum = c - START_COL_INDEX + 1;

            if (
              isDateCol &&
              isWeekendDay(
                window.currentYear,
                window.currentMonth,
                currentDayNum
              )
            ) {
              // 💡 如果是本月日期的六日，給予粉紅底色 + 置中
              ws[cellRef].s = weekendStyle;
            } else {
              // 💡 平日日期、上月5天、預休日期、右側統計，通通給予細框線 + 置中
              ws[cellRef].s = normalCenterStyle;
            }
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, `${loc}_排班表`);
    XLSX.writeFile(
      wb,
      `護理排班表_${loc}_${window.currentYear}_${window.currentMonth}.xlsx`
    );
  },

  /**
   * Excel 匯入功能 (相容純數字日期格式)
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
        const SHIFT_START_INDEX = 2 + PREV_PADDING;

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[0]) continue;

          if (String(r[0]).includes("每日餘裕") || String(r[0]).trim() === "") {
            break;
          }

          const prevShifts = [];
          for (let p = 0; p < PREV_PADDING; p++) {
            let pv = r[2 + p] || "休";
            if (pv === "白" || pv === "日") pv = "日";
            if (pv === "小") pv = "小夜";
            if (pv === "大") pv = "大夜";
            prevShifts.push(pv);
          }

          const shifts = [];
          for (let d = 0; d < window.currentMonthDays; d++) {
            let v = r[SHIFT_START_INDEX + d] || "休";
            if (v === "白" || v === "日") v = "日";
            if (v === "小") v = "小夜";
            if (v === "大") v = "大夜";
            shifts.push(v);
          }

          const preRestStr = r[1] ? String(r[1]) : "";
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
        showMsg(`成功匯入 ${newStaff.length} 位人員的完整班表！`);

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
