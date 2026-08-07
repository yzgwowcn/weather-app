// rain.js — Canvas 雨滴特效（零依赖，本地文件约 5KB）
// 参考 Lavender-z/demo 雨特效（css+js）的视觉语言：斜向雨滴 + 头部亮点 + 落地涟漪扩散。
// 由 app.js 按 body[data-mood] 启停：rain/storm/thunder 开雨，thunder 额外开启闪电。
// 接口：RainFX.start({ lightning }) / RainFX.stop() / RainFX.running；
// 后续如需折射/景深级效果，可仅替换本文件内部实现为原生 WebGL，接口保持不变。
const RainFX = (() => {
  'use strict';
  let canvas = null;
  let ctx = null;
  let rafId = 0;
  let running = false;
  let lastTs = 0;
  let width = 0;
  let height = 0;
  let drops = [];
  let ripples = [];
  const lightning = { enabled: false, nextIn: 0, flash: 0, second: 0, secondDelay: 0, bolt: null };

  function ensureCanvas() {
    if (canvas) return true;
    canvas = document.getElementById('rain-layer');
    if (!canvas) return false;
    ctx = canvas.getContext('2d');
    return true;
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 雨滴数量按屏宽自适应（约每 30px 一根）
    const target = Math.max(24, Math.round(width / 30));
    while (drops.length < target) drops.push(newDrop());
    drops.length = target;
  }
  function newDrop() {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      len: 16 + Math.random() * 20,
      speed: 480 + Math.random() * 420, // px/s 下落速度
      drift: 34 + Math.random() * 46,   // px/s 横向漂移（斜雨）
      alpha: 0.4 + Math.random() * 0.45,
    };
  }
  function spawnRipple(x, y) {
    ripples.push({ x, y, age: 0, life: 0.55 + Math.random() * 0.35, radius: 4 + Math.random() * 5 });
    if (ripples.length > 36) ripples.shift();
  }
  function drawRain(dt) {
    for (const d of drops) {
      d.y += d.speed * dt;
      d.x -= d.drift * dt;
      if (d.y > height + 24) {
        if (Math.random() < 0.55) spawnRipple(d.x + d.drift * 0.02, Math.min(height - 2, d.y));
        d.y = -24 - Math.random() * 80;
        d.x = Math.random() * (width + 120) - 60;
      }
      // 雨线：头部亮、尾部暗的渐变
      const headX = d.x;
      const headY = d.y;
      const tailX = d.x + d.drift * (d.len / d.speed) * 0.6;
      const tailY = d.y - d.len;
      const grad = ctx.createLinearGradient(headX, headY, tailX, tailY);
      grad.addColorStop(0, `rgba(220, 234, 252, ${Math.min(1, d.alpha * 1.15)})`);
      grad.addColorStop(1, `rgba(150, 182, 218, ${d.alpha * 0.35})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(headX, headY);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      // 头部亮点（参考 demo 雨滴高光）
      ctx.fillStyle = `rgba(235, 244, 255, ${Math.min(1, d.alpha * 1.3)})`;
      ctx.beginPath();
      ctx.arc(headX, headY, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function drawRipples(dt) {
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const r = ripples[i];
      r.age += dt;
      if (r.age >= r.life) { ripples.splice(i, 1); continue; }
      const t = r.age / r.life;
      const rx = r.radius * (0.3 + t * 2.4);
      const ry = rx * 0.42;
      ctx.strokeStyle = `rgba(205, 222, 244, ${0.38 * (1 - t)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  function makeBolt() {
    const points = [];
    let x = width * (0.15 + Math.random() * 0.7);
    let y = -8;
    const segments = 6 + Math.floor(Math.random() * 4);
    points.push([x, y]);
    for (let i = 0; i < segments; i += 1) {
      x += (Math.random() - 0.5) * 70;
      y += (height * 0.5) / segments;
      points.push([x, y]);
    }
    return points;
  }
  function drawLightning(strength) {
    // 整屏泛白
    ctx.fillStyle = `rgba(226, 238, 255, ${strength * 0.2})`;
    ctx.fillRect(0, 0, width, height);
    if (!lightning.bolt) return;
    // 锯齿主干 + 光晕
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * strength})`;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = `rgba(190, 215, 255, ${0.9 * strength})`;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(lightning.bolt[0][0], lightning.bolt[0][1]);
    for (let i = 1; i < lightning.bolt.length; i += 1) ctx.lineTo(lightning.bolt[i][0], lightning.bolt[i][1]);
    ctx.stroke();
    ctx.restore();
  }
  function updateLightning(dt) {
    if (!lightning.enabled) return;
    lightning.nextIn -= dt;
    if (lightning.nextIn <= 0 && lightning.flash <= 0 && lightning.second <= 0) {
      lightning.flash = 0.09; // 主闪
      lightning.bolt = makeBolt();
      lightning.secondDelay = 0.09 + Math.random() * 0.08; // 双闪间隔
      lightning.nextIn = 2.8 + Math.random() * 3.2; // 闪电频率：2.8–6s 随机
    }
    if (lightning.flash > 0) {
      lightning.flash -= dt;
      if (lightning.flash <= 0 && lightning.secondDelay > 0) lightning.secondDelay -= dt;
    } else if (lightning.secondDelay > 0) {
      lightning.secondDelay -= dt;
      if (lightning.secondDelay <= 0) lightning.second = 0.08; // 次闪
    } else if (lightning.second > 0) {
      lightning.second -= dt;
    }
    const strength = Math.max(lightning.flash, lightning.second, 0) / 0.09;
    if (strength > 0) drawLightning(strength);
  }
  function frame(ts) {
    if (!running) return;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    ctx.clearRect(0, 0, width, height);
    drawRain(dt);
    drawRipples(dt);
    updateLightning(dt);
    rafId = requestAnimationFrame(frame);
  }
  function start(options = {}) {
    if (running) {
      lightning.enabled = Boolean(options.lightning);
      return;
    }
    if (!ensureCanvas()) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    lightning.enabled = Boolean(options.lightning);
    lightning.nextIn = 0.6 + Math.random() * 1.2;
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    running = true;
    lastTs = performance.now();
    rafId = requestAnimationFrame(frame);
  }
  function onVisibility() {
    if (!running) return;
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!rafId) {
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    if (ctx) ctx.clearRect(0, 0, width, height);
  }
  return { start, stop, get running() { return running; } };
})();
