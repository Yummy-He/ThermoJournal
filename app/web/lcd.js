"use strict";

// Clockwise from the top bar, with the centre bar last.
const lcdBars = [
  "M2 0h14l-3 3H5z", "M17 1v13l-2 2-1-2V4z",
  "M15 17l2 2v13l-3-3V19z", "M2 33l3-3h8l3 3z",
  "M0 19l2-2 1 2v10l-3 3z", "M0 1l3 3v10l-1 2-2-2z",
  "M2.5 16.5 5 15h7l2.5 1.5L12 18H5z"
];
const lcdGlyphs = {
  "0":"abcdef", "1":"bc", "2":"abdeg", "3":"abcdg", "4":"bcfg",
  "5":"acdfg", "6":"acdefg", "7":"abc", "8":"abcdefg", "9":"abcdfg", "-":"g"
};

function drawLcdNumber(group, value, right, top, maxWidth, scale) {
  let offset = 0;
  const parts = [];
  for (const glyph of value) {
    if (glyph === ".") {
      parts.push('<rect x="' + offset + '" y="29" width="4" height="4"/>');
      offset += 7;
    } else {
      const bars = lcdBars.map((path, i) => {
        const active = lcdGlyphs[glyph].includes("abcdefg"[i]);
        return '<path d="' + path + '"' + (active ? '' : ' class="lcd-idle"') + '/>';
      });
      parts.push('<g transform="translate(' + offset + ')">' + bars.join("") + '</g>');
      offset += 20;
    }
  }
  const width = offset - 3;
  const scaleX = Math.min(scale, maxWidth / width);
  group.setAttribute("transform", "translate(" + (right - width * scaleX) + " " + top + ") scale(" + scaleX + " " + scale + ")");
  group.innerHTML = parts.join("");
}

function renderLcd(row) {
  const temperature = row ? Number(row[2]).toFixed(1) : "--.-";
  const humidity = row ? String(Math.round(row[4])) : "--";
  drawLcdNumber($("lcdT"), temperature.length <= 6 ? temperature : "--.-", 96, 21, 91, 1.22);
  drawLcdNumber($("lcdH"), humidity, 96, 74, 43, .72);

  const comfortable = row && row[2] >= 19 && row[2] <= 27 && row[4] >= 20 && row[4] <= 85;
  $("lcdFace").classList.toggle("lcd-idle", !row);
  $("lcdExpression").setAttribute("d", comfortable || !row
    ? "m19 84 3-3 3 3m12 0 3-3 3 3m-16 9h8"
    : "M19 83h6m12 0h6m-16 10 4-4 4 4");
  $("lcdTitle").textContent = row
    ? "最近一条小时记录，最高温度 " + temperature + " °C，最高湿度 " + humidity + "%。按这两个最高值判断：" + (comfortable ? "舒适" : "超出舒适区间")
    : "温湿度计，暂无记录";
}
