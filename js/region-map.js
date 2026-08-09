// 区域示意地图背景（SVG）：随区域模式切换海南/四川全景地图；两级 LOD——选择预设目的地后
// 平滑放大过渡到该地所在市/县精细轮廓（定位视图），点击地图空白或切换区域恢复全景。
// 依赖：js/config.js（REGIONS / CURRENT_REGION）、js/app.js（__getCurrentDest + dest-change 事件）
// 地图轮廓为 DataV GeoAtlas 简化数据（风格化示意，非标准政区图），坐标投影与生成脚本一致：x=lon*scale, y=-lat*scale
(function () {
  'use strict';
  var mapEl = document.getElementById('region-map');
  var svgs = {
    hainan: document.getElementById('region-map-hainan'),
    sichuan: document.getElementById('region-map-sichuan'),
  };
  // 精细区划图（LOD 定位视图）：adcode → SVG 元素（index.html 内嵌，id 形如 region-map-detail-460200）
  var DETAIL_ADCODES = [460200, 469028, 469006, 510100, 511100, 511181, 513225, 510181];
  var detailSvgs = {};
  DETAIL_ADCODES.forEach(function (code) {
    var el = document.getElementById('region-map-detail-' + code);
    if (el) detailSvgs[code] = el;
  });
  if (!mapEl || !svgs.hainan || !svgs.sichuan) return;

  // 目的地 → 精细区划 adcode（覆盖全部预设目的地；未列出的自定义选点保持全景视图）
  var DEST_ADCODE = {
    hainan: { sanya: 460200, haitang: 460200, lingshui: 469028, wanning: 469006, houhai: 469028 },
    sichuan: { chengdu: 510100, 'jiang-an': 510100, wangjiang: 510100, leshan: 511100, emeishan: 511181, jiuzhaigou: 513225, dujiangyan: 510181 },
  };
  // adcode 反向索引：该区划内包含的预设目的地 id（定位视图光点列表）
  var ADCODE_DESTS = {};
  Object.keys(DEST_ADCODE).forEach(function (region) {
    Object.keys(DEST_ADCODE[region]).forEach(function (id) {
      var code = DEST_ADCODE[region][id];
      (ADCODE_DESTS[code] = ADCODE_DESTS[code] || []).push(id);
    });
  });

  // 视图状态：region 当前区域；adcode null = 全景，非 null = 定位视图
  var view = { region: 'hainan', adcode: null };

  // 海南 viewBox 高度作光点尺寸归一化基准（各图显示高度一致，viewBox 单位尺寸随各自高度缩放）
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
  function findDest(region, id) {
    var list = (typeof REGIONS !== 'undefined' && REGIONS[region]) ? REGIONS[region] : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  // 名称标签（textContent 赋值，无 HTML 注入面）
  function addLabel(g, p, name, u) {
    var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('class', 'map-dot-label');
    t.setAttribute('x', (p.x + DOT_R * 1.7 * u).toFixed(2));
    t.setAttribute('y', (p.y + DOT_R * 0.5 * u).toFixed(2));
    t.setAttribute('font-size', (LABEL_FS * u).toFixed(2));
    t.textContent = name; // 目的地名来自 config.js 常量或地点搜索名（textContent 转义，无注入面）
    g.appendChild(t);
  }
  // 当前选中目的地 id：预设按名称匹配；自定义（不在预设列表）返回 null
  function currentDestId() {
    var cur = (typeof window.__getCurrentDest === 'function') ? window.__getCurrentDest() : null;
    if (!cur || !cur.name) return null;
    var list = (typeof REGIONS !== 'undefined' && REGIONS[view.region]) ? REGIONS[view.region] : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === cur.name) return list[i].id;
    }
    return null;
  }
  function currentDest() {
    return (typeof window.__getCurrentDest === 'function') ? window.__getCurrentDest() : null;
  }

  // 光点渲染到目标 SVG：定位视图画该区划内预设目的地；全景画区域全部预设 + 自定义位置光点
  function renderDots() {
    var region = view.region;
    var target = (view.adcode && detailSvgs[view.adcode]) ? detailSvgs[view.adcode] : svgs[region];
    if (!target) return;
    // 清空全部旧光点组（避免跨视图残留）
    Object.keys(svgs).forEach(function (key) {
      var g = svgs[key].querySelector('g.map-dots');
      if (g) g.parentNode.removeChild(g);
    });
    Object.keys(detailSvgs).forEach(function (code) {
      var g = detailSvgs[code].querySelector('g.map-dots');
      if (g) g.parentNode.removeChild(g);
    });
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'map-dots');
    var u = unit(target);
    var curId = currentDestId();
    var list = [];
    if (view.adcode) {
      (ADCODE_DESTS[view.adcode] || []).forEach(function (id) {
        var d = findDest(region, id);
        if (d) list.push(d);
      });
    } else {
      list = (typeof REGIONS !== 'undefined' && REGIONS[region]) ? REGIONS[region].slice() : [];
    }
    list.forEach(function (d) {
      var p = project(target, d.lat, d.lon);
      var isCur = d.id === curId;
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'map-dot' + (isCur ? ' current' : ''));
      c.setAttribute('cx', p.x.toFixed(2));
      c.setAttribute('cy', p.y.toFixed(2));
      c.setAttribute('r', ((isCur ? DOT_R * 1.5 : DOT_R * 0.85) * u).toFixed(2));
      g.appendChild(c);
      if (isCur) addLabel(g, p, d.name, u);
    });
    // 全景视图：自定义选点（不在预设列表）按其坐标画当前光点 + 名称标签
    // 省外位置投影后落在 viewBox 外，浏览器自动裁剪不可见（合理行为）
    if (!view.adcode && !curId) {
      var cur = currentDest();
      if (cur && Number.isFinite(cur.lat) && Number.isFinite(cur.lon)) {
        var pc = project(target, cur.lat, cur.lon);
        var cc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        cc.setAttribute('class', 'map-dot current');
        cc.setAttribute('cx', pc.x.toFixed(2));
        cc.setAttribute('cy', pc.y.toFixed(2));
        cc.setAttribute('r', (DOT_R * 1.5 * u).toFixed(2));
        g.appendChild(cc);
        addLabel(g, pc, cur.name || '', u);
      }
    }
    target.appendChild(g);
  }

  // 应用视图：激活对应 SVG（全景或定位），重渲染光点
  function applyView() {
    var inDetail = view.adcode && detailSvgs[view.adcode];
    Object.keys(svgs).forEach(function (key) {
      svgs[key].classList.toggle('active', !inDetail && key === view.region);
    });
    Object.keys(detailSvgs).forEach(function (code) {
      detailSvgs[code].classList.toggle('active', inDetail && view.adcode === Number(code));
    });
    renderDots();
  }

  // 区域切换（顶栏按钮 / 登录偏好 / 地图选点均经 app.js 派发 region-change）：回全景 + 切区域
  document.addEventListener('region-change', function (e) {
    var region = e.detail && e.detail.region;
    if (region && svgs[region]) {
      view.region = region;
      view.adcode = null;
      applyView();
    }
  });
  // 目的地变化（app.js renderDestButtons 汇聚派发 dest-change）：预设 → 定位视图，自定义 → 全景
  document.addEventListener('dest-change', function () {
    var region = (typeof CURRENT_REGION !== 'undefined' && CURRENT_REGION) || 'hainan';
    if (svgs[region]) view.region = region;
    var curId = currentDestId();
    var code = curId ? DEST_ADCODE[view.region][curId] : null;
    view.adcode = (code && detailSvgs[code]) ? code : null;
    applyView();
  });
  // 点击地图空白：从定位视图恢复全景（仅定位图可点击，全景图 pointer-events 关闭不挡页面）
  Object.keys(detailSvgs).forEach(function (code) {
    detailSvgs[code].addEventListener('click', function () {
      if (view.adcode === Number(code)) {
        view.adcode = null;
        applyView();
      }
    });
  });

  // 初始化：按 CURRENT_REGION 显示（app.js 在其之前加载并同步设置）
  var initial = (typeof CURRENT_REGION !== 'undefined' && CURRENT_REGION) || 'hainan';
  view.region = svgs[initial] ? initial : 'hainan';
  view.adcode = null;
  applyView();
})();
