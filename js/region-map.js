// 区域示意地图背景（SVG）：随区域模式切换海南/四川地图，目的地光点与当前选中高亮
// 依赖：js/config.js（REGIONS / CURRENT_REGION）、js/app.js（__getCurrentDest + dest-change 事件）
// 地图轮廓为 DataV GeoAtlas 简化数据（风格化示意，非标准政区图），坐标投影与生成脚本一致：x=lon*scale, y=-lat*scale
(function () {
  'use strict';
  var mapEl = document.getElementById('region-map');
  var svgs = {
    hainan: document.getElementById('region-map-hainan'),
    sichuan: document.getElementById('region-map-sichuan'),
  };
  if (!mapEl || !svgs.hainan || !svgs.sichuan) return;

  // 海南 viewBox 高度作光点尺寸归一化基准（两图显示高度一致，viewBox 单位尺寸随各自高度缩放）
  var REF_VB_H = 26.2;
  var DOT_R = 0.45;   // 基准光点半径（viewBox 单位）
  var LABEL_FS = 1.7; // 基准标签字号

  function vbOf(svg) {
    var v = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    return { minX: v[0], minY: v[1], w: v[2], h: v[3] };
  }
  // 经纬度 → SVG viewBox 坐标
  function project(svg, lat, lon) {
    var vb = vbOf(svg);
    var scale = parseFloat(svg.getAttribute('data-proj-scale')) || 10;
    return { x: lon * scale - vb.minX, y: -lat * scale - vb.minY };
  }
  // 当前 SVG 相对基准的尺寸系数（viewBox 高度越大，单位越小 → 光点/字号相应放大保持视觉一致）
  function unit(svg) {
    return vbOf(svg).h / REF_VB_H;
  }

  function setRegion(region) {
    Object.keys(svgs).forEach(function (key) {
      svgs[key].classList.toggle('active', key === region);
    });
    renderDots(region);
  }

  // 目的地光点：全部目的地小点，当前选中大点 + 呼吸 + 名称标签（textContent 赋值，无 HTML 注入面）
  function renderDots(region) {
    var svg = svgs[region];
    if (!svg) return;
    var g = svg.querySelector('g.map-dots');
    if (g) g.parentNode.removeChild(g);
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'map-dots');
    var list = (typeof REGIONS !== 'undefined' && REGIONS[region]) ? REGIONS[region] : [];
    var u = unit(svg);
    // 当前选中目的地（预设目的地按名称匹配 id；自定义选点不在预设列表 → 不高亮）
    var cur = (typeof window.__getCurrentDest === 'function') ? window.__getCurrentDest() : null;
    var curId = null;
    if (cur && cur.name) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === cur.name) { curId = list[i].id; break; }
      }
    }
    list.forEach(function (d) {
      var p = project(svg, d.lat, d.lon);
      var isCur = d.id === curId;
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'map-dot' + (isCur ? ' current' : ''));
      c.setAttribute('cx', p.x.toFixed(2));
      c.setAttribute('cy', p.y.toFixed(2));
      c.setAttribute('r', ((isCur ? DOT_R * 1.5 : DOT_R * 0.85) * u).toFixed(2));
      g.appendChild(c);
      if (isCur) {
        var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('class', 'map-dot-label');
        t.setAttribute('x', (p.x + DOT_R * 1.7 * u).toFixed(2));
        t.setAttribute('y', (p.y + DOT_R * 0.5 * u).toFixed(2));
        t.setAttribute('font-size', (LABEL_FS * u).toFixed(2));
        t.textContent = d.name; // textContent：目的地名来自 config.js 常量，无注入面
        g.appendChild(t);
      }
    });
    svg.appendChild(g);
  }

  // 区域切换（顶栏按钮 / 登录偏好 / 地图选点均经 app.js 派发 region-change）
  document.addEventListener('region-change', function (e) {
    var region = e.detail && e.detail.region;
    if (region && svgs[region]) setRegion(region);
  });
  // 目的地变化（app.js renderDestButtons 汇聚派发 dest-change）
  document.addEventListener('dest-change', function () {
    var region = (typeof CURRENT_REGION !== 'undefined' && CURRENT_REGION) || 'hainan';
    if (svgs[region]) renderDots(region);
  });

  // 初始化：显示当前区域地图与光点（CURRENT_REGION 由 app.js 同步设置，本文件在其后加载）
  var initial = (typeof CURRENT_REGION !== 'undefined' && CURRENT_REGION) || 'hainan';
  setRegion(initial);
})();
