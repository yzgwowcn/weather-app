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
  const lightning = { enabled: false, nextIn: 0, flash: 0, second: 0, third: 0, secondDelay: 0, thirdDelay: 0, glow: 0, bolt: null, intensity: 0.5 };
  const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

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
  function makeBolt(intensity) {
    const points = [];
    let x = width * (0.15 + Math.random() * 0.7);
    let y = -8;
    const segments = 6 + Math.floor(Math.random() * 4);
    points.push([x, y]);
    const branches = [];
    for (let i = 0; i < segments; i += 1) {
      x += (Math.random() - 0.5) * 70;
      y += (height * 0.5) / segments;
      points.push([x, y]);
      // 分支：从主干节点岔出（高强度更多分支）
      if (i > 1 && i < segments - 1 && Math.random() < 0.35 + intensity * 0.35) {
        const branch = [[x, y]];
        let bx = x;
        let by = y;
        const blen = 3 + Math.floor(Math.random() * 3);
        for (let j = 0; j < blen; j += 1) {
          bx += (Math.random() - 0.5) * 50;
          by += (height * 0.16) / blen;
          branch.push([bx, by]);
        }
        branches.push(branch);
      }
    }
    return { main: points, branches };
  }
  function strokeBolt(bolt) {
    ctx.beginPath();
    ctx.moveTo(bolt.main[0][0], bolt.main[0][1]);
    for (let i = 1; i < bolt.main.length; i += 1) ctx.lineTo(bolt.main[i][0], bolt.main[i][1]);
    ctx.stroke();
    bolt.branches.forEach((b) => {
      ctx.beginPath();
      ctx.moveTo(b[0][0], b[0][1]);
      for (let i = 1; i < b.length; i += 1) ctx.lineTo(b[i][0], b[i][1]);
      ctx.stroke();
    });
  }
  function drawLightning(strength, intensity) {
    // 分层泛白：全屏微亮 + 云层区（顶部 45%）径向渐变更亮
    ctx.fillStyle = `rgba(226, 238, 255, ${strength * (0.12 + intensity * 0.08)})`;
    ctx.fillRect(0, 0, width, height);
    const cloudGrad = ctx.createLinearGradient(0, 0, 0, height * 0.45);
    cloudGrad.addColorStop(0, `rgba(235, 245, 255, ${strength * (0.26 + intensity * 0.22)})`);
    cloudGrad.addColorStop(1, 'rgba(235, 245, 255, 0)');
    ctx.fillStyle = cloudGrad;
    ctx.fillRect(0, 0, width, height * 0.45);
    if (!lightning.bolt) return;
    // 双通道光晕：宽 glow（低不透明度）＋ 细芯（高不透明度）
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(185, 212, 255, ${0.38 * strength})`;
    ctx.lineWidth = 7;
    ctx.shadowColor = `rgba(170, 205, 255, ${0.8 * strength})`;
    ctx.shadowBlur = 22;
    strokeBolt(lightning.bolt);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * strength})`;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8;
    strokeBolt(lightning.bolt);
    ctx.restore();
  }
  function updateLightning(dt) {
    if (!lightning.enabled) return;
    const intensity = lightning.intensity;
    lightning.nextIn -= dt;
    if (lightning.nextIn <= 0 && lightning.flash <= 0 && lightning.second <= 0 && lightning.third <= 0 && lightning.secondDelay <= 0 && lightning.thirdDelay <= 0 && !lightning.bolt) {
      lightning.flash = 0.07 + Math.random() * 0.05; // 主闪
      lightning.bolt = makeBolt(intensity);
      lightning.secondDelay = 0.08 + Math.random() * 0.08; // 双闪间隔
      lightning.thirdDelay = intensity > 0.65 ? 0.05 + Math.random() * 0.07 : 0; // 强雷暴三连闪
      // 频率随强度：晴天短时雷雨 4.5–7s 低频，阴雨强雷暴 1.3–2.5s 高频
      lightning.nextIn = (5.5 - intensity * 4.2) + Math.random() * (2 - intensity * 1.1);
    }
    // 主闪 → 次闪 → 三闪 推进
    if (lightning.flash > 0) lightning.flash -= dt;
    else if (lightning.secondDelay > 0) {
      lightning.secondDelay -= dt;
      if (lightning.secondDelay <= 0) { lightning.secondDelay = 0; lightning.second = 0.06 + Math.random() * 0.04; }
    } else if (lightning.second > 0) lightning.second -= dt;
    else if (lightning.thirdDelay > 0) {
      lightning.thirdDelay -= dt;
      if (lightning.thirdDelay <= 0) { lightning.thirdDelay = 0; lightning.third = 0.06 + Math.random() * 0.03; }
    } else if (lightning.third > 0) lightning.third -= dt;
    // 余辉：全部闪结束后短暂低强度泛白
    if (lightning.bolt && lightning.flash <= 0 && lightning.second <= 0 && lightning.third <= 0 && lightning.secondDelay <= 0 && lightning.thirdDelay <= 0) {
      lightning.glow = Math.max(0, (lightning.glow || 0.09) - dt);
      if (lightning.glow <= 0) { lightning.bolt = null; lightning.glow = 0; }
    }
    const strength = Math.max(lightning.flash, lightning.second, lightning.third, 0) / 0.09;
    const afterglow = lightning.glow > 0 ? (lightning.glow / 0.09) * 0.15 : 0;
    if (strength > 0 || afterglow > 0) drawLightning(Math.min(1, strength + afterglow), intensity);
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
      lightning.intensity = clamp01(options.intensity);
      return;
    }
    if (!ensureCanvas()) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    lightning.enabled = Boolean(options.lightning);
    lightning.intensity = clamp01(options.intensity);
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
