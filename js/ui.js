/**
 * 智慧護理排班專案 - UI 渲染與互動處理
 * 說明：負責表格生成、儀表板更新及使用者互動事件。
 */

/**
 * 更新上方儀表板 (月目標達成率)
 */
function updateDashboard() {
  const container = document.getElementById("total-stats-container");
  if (!container) return;

  const stats = calculateMonthStats();
  const { totalNeeded, currentAssigned } = stats;

  const renderCard = (label, current, target) => {
    const diff = target - current;
    let statusClass = "status-ok",
      statusText = "OK";
    if (diff > 0) {
      statusClass = "status-warn";
      statusText = `缺 ${diff}`;
    } else if (diff < 0) {
      statusClass = "status-ok";
      statusText = `+${Math.abs(diff)}`;
    }
    return `
      <div class="stat-card ${statusClass} flex-1">
        <span class="stat-label">${label}</span>
        <div class="flex items-baseline gap-1">
          <span class="stat-value">${current}</span>
          <span class="text-xs text-gray-500 font-medium">/${target}</span>
        </div>
        <span class="stat-sub font-bold">${statusText}</span>
      </div>`;
  };

  container.innerHTML = `
    ${renderCard("白班", currentAssigned.日, totalNeeded.日)}
    ${renderCard("小夜", currentAssigned.小夜, totalNeeded.小夜)}
    ${renderCard("大夜", currentAssigned.大夜, totalNeeded.大夜)}
  `;
}

/**
 * 渲染每日人力需求輸入框
 */
function renderDailyMinsInputs() {
  const container = document.getElementById("daily-mins-inputs");
  if (!container) return;

  const renderSection = (title, type) => `
    <div class="flex flex-col bg-gray-50 p-2 rounded">
      <span class="text-[10px] text-gray-500 font-bold mb-1">${title}</span>
      <div class="flex gap-1">
        ${["日", "小夜", "大夜"]
          .map(
            (shift) => `
          <div class="flex-1 text-center">
            <label class="block text-[9px] text-gray-400 mb-0.5">${SHIFT_MAP[shift]}</label>
            <input type="number" min="0" value="${dailyMins[type][shift]}" 
              data-type="${type}" data-shift="${shift}" 
              class="daily-min-input w-full p-0.5 text-xs border border-gray-300 rounded text-center focus:border-indigo-500 outline-none" />
          </div>
        `
          )
          .join("")}
      </div>
    </div>`;

  container.innerHTML = `${renderSection("平日", "weekday")}${renderSection(
    "週末",
    "weekend"
  )}`;

  container.querySelectorAll(".daily-min-input").forEach((input) => {
    input.addEventListener("change", (e) => {
      const { type, shift } = e.target.dataset;
      dailyMins[type][shift] = parseInt(e.target.value) || 0;
      updateDashboard();
      renderTable();
      saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
    });
  });
}

/**
 * 渲染主排班表格
 */
function renderTable() {
  const tableBody = document.getElementById("schedule-body");
  const tableHeadRow = document.getElementById("schedule-head-row");
  if (!tableBody || !tableHeadRow) return;

  currentMonthDays = new Date(currentYear, currentMonth, 0).getDate();

  let headerHTML = `
    <th class="sticky-col actions rounded-tl-lg bg-gray-100 text-gray-500">操作</th>
    <th class="sticky-col name bg-gray-100 text-left pl-2 text-gray-700">姓名</th>
    <th class="sticky-col rest bg-gray-100 text-gray-600 text-[10px]">預休</th>`;

  for (let i = PREV_DAYS_COUNT; i >= 1; i--) {
    headerHTML += `<th class="prev-month-col min-w-[30px] border-b border-gray-300 text-[10px]">前${i}</th>`;
  }
  for (let d = 1; d <= currentMonthDays; d++) {
    const isWeekend = isWeekendDay(currentYear, currentMonth, d);
    const dayLabel = getDayLabel(currentYear, currentMonth, d);
    headerHTML += `
      <th class="${
        isWeekend ? "bg-red-50 text-red-600" : "bg-gray-50 text-gray-600"
      } min-w-[34px] border-b border-gray-200">
        <div class="flex flex-col leading-tight">
          <span class="text-xs">${d}</span>
          <span class="text-[9px] opacity-70">${dayLabel}</span>
        </div>
      </th>`;
  }
  headerHTML += `
    <th class="sticky-right-header bg-yellow-50 border-l-2 border-yellow-100 min-w-[38px] text-[10px]">白</th>
    <th class="sticky-right-header bg-blue-50 min-w-[38px] text-[10px]">小</th>
    <th class="sticky-right-header bg-purple-50 min-w-[38px] text-[10px]">大</th>
    <th class="sticky-right-header bg-gray-100 min-w-[38px] text-[10px]">休</th>
    <th class="sticky-right-header bg-indigo-50 min-w-[38px] text-[10px]">欠</th>`;

  tableHeadRow.innerHTML = headerHTML;

  tableBody.innerHTML = "";
  staffData.forEach((staff, staffIndex) => {
    const row = document.createElement("tr");
    row.className = "hover:bg-gray-50 transition-colors";

    const counts = countStaffShifts(staff);
    const tOff = parseInt(staff.targets.off) || RULES.DEFAULT_MONTHLY_OFF;
    const targetWorkDays = currentMonthDays - tOff;
    const currentWorkDays = counts.日 + counts.小夜 + counts.大夜;
    const remainingToWork = targetWorkDays - currentWorkDays;
    const isLocked = staff.isLocked || false;

    row.innerHTML = generateStaffRowHTML(
      staff,
      staffIndex,
      counts,
      remainingToWork,
      isLocked
    );
    tableBody.appendChild(row);
  });

  renderSurplusRow(tableBody);
  updateDashboard();
}

window.moveStaff = (index, direction) => {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= staffData.length) return;
  [staffData[index], staffData[newIndex]] = [
    staffData[newIndex],
    staffData[index],
  ];
  renderTable();
  saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
};

window.updateStaffName = (index, val) => {
  staffData[index].name = val;
  saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
};

window.updateTarget = (index, field, val) => {
  staffData[index].targets[field] = val;
  renderTable();
  saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
};

window.toggleLock = (index) => {
  staffData[index].isLocked = !staffData[index].isLocked;
  if (staffData[index].isLocked) staffData[index].manualEdits.fill(true);
  renderTable();
  saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
};

window.handleRestEdit = (input, index) => {
  const days = input.value
    .split(/[,，;]/)
    .map((s) => parseInt(s.trim()))
    .filter((n) => !isNaN(n));
  staffData[index].preRestDays = days;
  days.forEach((d) => {
    if (d <= currentMonthDays) {
      staffData[index].shifts[d - 1] = "休";
      staffData[index].manualEdits[d - 1] = false;
    }
  });
  renderTable();
  saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
};

window.toggleShift = (el, staffIndex, dayIndex) => {
  if (staffData[staffIndex].preRestDays.includes(dayIndex + 1)) return;
  const cycles = ["休", "日", "小夜", "大夜"];
  const current = staffData[staffIndex].shifts[dayIndex];
  staffData[staffIndex].shifts[dayIndex] =
    cycles[(cycles.indexOf(current) + 1) % cycles.length];
  staffData[staffIndex].manualEdits[dayIndex] = true;
  renderTable();
  saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
};

window.togglePrevShift = (el, staffIndex, prevIndex) => {
  const cycles = ["休", "日", "小夜", "大夜"];
  const current = staffData[staffIndex].prevShifts[prevIndex];
  staffData[staffIndex].prevShifts[prevIndex] =
    cycles[(cycles.indexOf(current) + 1) % cycles.length];
  renderTable();
  saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
};

window.removeStaff = (index) => {
  if (confirm("確定刪除此人員？")) {
    staffData.splice(index, 1);
    renderTable();
    saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
  }
};

window.addStaff = () => {
  staffData.push({
    id: `new_${Date.now()}`,
    name: `人員 ${staffData.length + 1}`,
    preRestDays: [],
    shifts: new Array(currentMonthDays).fill("休"),
    prevShifts: new Array(PREV_DAYS_COUNT).fill("休"),
    manualEdits: new Array(currentMonthDays).fill(false),
    targets: {
      day: "",
      evening: "",
      night: "",
      off: RULES.DEFAULT_MONTHLY_OFF, // 預設 8 天休假
    },
    isLocked: false,
  });
  renderTable();
  saveScheduleData(currentYear, currentMonth, staffData, dailyMins);
};

function generateStaffRowHTML(
  staff,
  staffIndex,
  counts,
  remainingToWork,
  isLocked
) {
  const lockIcon = isLocked
    ? `<svg class="w-3 h-3 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" /></svg>`
    : `<svg class="w-3 h-3 text-gray-300 hover:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>`;

  let html = `
    <td class="sticky-col actions bg-white flex items-center justify-center gap-1 h-[36px]">
        <div class="flex flex-col gap-0.5 mr-1">
          <button onclick="window.moveStaff(${staffIndex}, -1)" ${
    staffIndex === 0 ? "disabled" : ""
  } class="text-[8px] leading-none text-gray-400 hover:text-indigo-600 disabled:opacity-20 cursor-pointer">▲</button>
          <button onclick="window.moveStaff(${staffIndex}, 1)" ${
    staffIndex === staffData.length - 1 ? "disabled" : ""
  } class="text-[8px] leading-none text-gray-400 hover:text-indigo-600 disabled:opacity-20 cursor-pointer">▼</button>
        </div>
        <button onclick="window.toggleLock(${staffIndex})" title="鎖定" class="p-1 rounded hover:bg-gray-100">${lockIcon}</button>
        <button onclick="window.removeStaff(${staffIndex})" class="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
    </td>
    <td class="sticky-col name bg-white"><input type="text" value="${
      staff.name
    }" onchange="window.updateStaffName(${staffIndex}, this.value)" class="name-input" /></td>
    <td class="sticky-col rest bg-white"><input type="text" value="${staff.preRestDays.join(
      ","
    )}" onchange="window.handleRestEdit(this, ${staffIndex})" class="rest-input" placeholder="ex:5,6" /></td>
  `;

  staff.prevShifts.forEach((pShift, pIdx) => {
    html += `<td class="p-0.5 prev-month-col"><input type="text" value="${
      SHIFT_MAP[pShift] || pShift
    }" class="shift-input prev-shift-input text-xs" onclick="window.togglePrevShift(this, ${staffIndex}, ${pIdx})" /></td>`;
  });

  for (let d = 0; d < currentMonthDays; d++) {
    const shift = staff.shifts[d] || "休";
    const isManual = staff.manualEdits[d] || isLocked;
    const isPreRest = staff.preRestDays.includes(d + 1);
    let bgClass = isPreRest
      ? SHIFT_CLASSES["預休"]
      : SHIFT_CLASSES[shift] || SHIFT_CLASSES["休"];

    html += `<td class="p-0.5"><input type="text" value="${
      isPreRest ? "休" : SHIFT_MAP[shift] || shift
    }" readonly class="shift-input ${bgClass} ${
      isManual ? "manual-edit" : ""
    }" onclick="window.toggleShift(this, ${staffIndex}, ${d})" /></td>`;
  }

  const renderTarget = (field, val, bg, cur) => {
    const mismatch = val && cur != val ? "target-mismatch" : "";
    return `<td class="sticky-right bg-white p-0 border-l border-gray-100 h-full relative ${mismatch}"><div class="target-container ${bg}"><span class="current-val">${cur}</span><input type="number" value="${val}" onchange="window.updateTarget(${staffIndex}, '${field}', this.value)" class="target-input" /></div></td>`;
  };

  html += renderTarget("day", staff.targets.day, "bg-yellow-50", counts.日);
  html += renderTarget(
    "evening",
    staff.targets.evening,
    "bg-blue-50",
    counts.小夜
  );
  html += renderTarget(
    "night",
    staff.targets.night,
    "bg-purple-50",
    counts.大夜
  );
  html += renderTarget("off", staff.targets.off, "bg-gray-50", counts.休);

  let remClass =
    remainingToWork < 0
      ? "text-red-600 font-bold bg-red-50"
      : remainingToWork > 0
      ? "text-indigo-600 font-bold"
      : "text-green-600";
  html += `<td class="sticky-right bg-white border-l border-indigo-100 text-[10px] text-center ${remClass}">${
    remainingToWork === 0 ? "OK" : remainingToWork
  }</td>`;

  return html;
}

function renderSurplusRow(tableBody) {
  const surplusRow = document.createElement("tr");
  surplusRow.className = "bg-gray-50 font-bold border-t-2 border-gray-200";
  surplusRow.innerHTML = `<td class="sticky-col actions bg-gray-100"></td><td class="sticky-col name bg-gray-100 text-center text-xs text-gray-500 py-1">每日餘裕</td><td class="sticky-col rest bg-gray-100"></td>`;

  for (let i = 0; i < PREV_DAYS_COUNT; i++)
    surplusRow.innerHTML += `<td class="bg-gray-200 border-r border-gray-300"></td>`;

  for (let d = 0; d < currentMonthDays; d++) {
    const type = isWeekendDay(currentYear, currentMonth, d + 1)
      ? "weekend"
      : "weekday";
    const demand = dailyMins[type];
    let counts = { 日: 0, 小夜: 0, 大夜: 0 };
    staffData.forEach((s) => {
      if (counts[s.shifts[d]] !== undefined) counts[s.shifts[d]]++;
    });

    let details = [],
      isAllOk = true;
    ["日", "小夜", "大夜"].forEach((shift) => {
      const diff = counts[shift] - demand[shift];
      if (diff < 0) {
        isAllOk = false;
        details.push(
          `<span class="text-red-500 font-bold text-[11px] block">缺${
            SHIFT_MAP[shift]
          }${Math.abs(diff)}</span>`
        );
      } else if (diff > 0) {
        details.push(
          `<span class="text-green-600 font-bold text-[11px] block">${SHIFT_MAP[shift]}+${diff}</span>`
        );
      }
    });

    surplusRow.innerHTML += `<td class="text-center text-xs p-0.5 border-r border-gray-200 align-top ${
      !isAllOk ? "bg-red-50" : ""
    }">
      ${
        details.length
          ? details.join("")
          : '<span class="text-gray-300 text-[10px]">OK</span>'
      }
    </td>`;
  }
  surplusRow.innerHTML += `<td class="sticky-right-header bg-gray-50" colspan="5"></td>`;
  tableBody.appendChild(surplusRow);
}
