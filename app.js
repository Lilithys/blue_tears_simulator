const canvas = document.getElementById("ocean");
const ctx = canvas.getContext("2d", { alpha: false });
const statusEl = document.getElementById("status");
const enableBtn = document.getElementById("enableBtn");

let W = 0, H = 0, DPR = 1;
let particles = [];
let waves = [];
let lastMotion = null;
let shakeEnergy = 0;
let frame = 0;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.floor(window.innerWidth * DPR);
  H = Math.floor(window.innerHeight * DPR);
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
}
window.addEventListener("resize", resize);
resize();

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function addGlow(x, y, strength = 1, count = 16) {
  x *= DPR;
  y *= DPR;

  const n = Math.floor(count * Math.min(2.8, Math.max(0.4, strength)));
  for (let i = 0; i < n; i++) {
    particles.push({
      x: x + rand(-18, 18) * DPR,
      y: y + rand(-18, 18) * DPR,
      vx: rand(-0.35, 0.35) * DPR,
      vy: rand(-0.25, 0.25) * DPR,
      life: rand(0.7, 1.35),
      age: 0,
      r: rand(1.2, 4.2) * DPR,
      power: rand(0.45, 1.0) * strength
    });
  }

  waves.push({
    x, y,
    age: 0,
    life: 1.1 + strength * 0.22,
    radius: 8 * DPR,
    power: Math.min(1.4, strength)
  });
}

function addShakeBurst(strength) {
  const count = Math.floor(18 + strength * 24);
  for (let i = 0; i < count; i++) {
    const x = rand(0.05, 0.95) * window.innerWidth;
    const y = rand(0.20, 0.88) * window.innerHeight;
    addGlow(x, y, strength * rand(0.45, 1.1), 4);
  }
}

function drawOcean(t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#020711");
  g.addColorStop(0.45, "#041323");
  g.addColorStop(1, "#02060f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // soft moving wave lines
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 1 * DPR;
  for (let i = 0; i < 18; i++) {
    const y = H * (0.18 + i * 0.045);
    ctx.beginPath();
    for (let x = -40 * DPR; x <= W + 40 * DPR; x += 18 * DPR) {
      const amp = (3 + i * 0.2) * DPR;
      const yy = y + Math.sin(x * 0.006 + t * 0.0017 + i * 0.9) * amp
                 + Math.sin(x * 0.013 + t * 0.0011) * amp * 0.45;
      if (x === -40 * DPR) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = i % 3 === 0 ? "rgba(80, 210, 255, 0.18)" : "rgba(28, 88, 132, 0.18)";
    ctx.stroke();
  }
  ctx.restore();
}

function render(timestamp) {
  frame++;
  drawOcean(timestamp);

  const dt = 1 / 60;
  shakeEnergy *= 0.94;

  // occasional faint plankton sparkle when recently disturbed
  if (shakeEnergy > 0.05 && frame % 4 === 0) {
    addGlow(rand(0, window.innerWidth), rand(window.innerHeight * 0.18, window.innerHeight * 0.9), shakeEnergy * 0.35, 2);
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i];
    w.age += dt;
    const k = w.age / w.life;
    if (k >= 1) {
      waves.splice(i, 1);
      continue;
    }

    const alpha = (1 - k) * 0.55 * w.power;
    const radius = w.radius + k * (90 + w.power * 70) * DPR;

    ctx.beginPath();
    ctx.arc(w.x, w.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(50, 218, 255, ${alpha})`;
    ctx.lineWidth = (1.2 + w.power * 1.4) * DPR;
    ctx.stroke();

    const rg = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, radius * 0.7);
    rg.addColorStop(0, `rgba(57, 232, 255, ${alpha * 0.16})`);
    rg.addColorStop(1, "rgba(57, 232, 255, 0)");
    ctx.fillStyle = rg;
    ctx.fillRect(w.x - radius, w.y - radius, radius * 2, radius * 2);
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) {
      particles.splice(i, 1);
      continue;
    }

    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.995;
    p.vy *= 0.995;

    const k = p.age / p.life;
    const alpha = Math.pow(1 - k, 1.6) * 0.92 * p.power;
    const radius = p.r * (1 + k * 5);

    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 5);
    glow.addColorStop(0, `rgba(130, 250, 255, ${alpha})`);
    glow.addColorStop(0.22, `rgba(30, 207, 255, ${alpha * 0.72})`);
    glow.addColorStop(1, "rgba(0, 170, 255, 0)");

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // cap arrays
  if (particles.length > 1600) particles.splice(0, particles.length - 1600);
  if (waves.length > 120) waves.splice(0, waves.length - 120);

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

function motionHandler(event) {
  const a = event.accelerationIncludingGravity || event.acceleration;
  if (!a) return;

  const x = a.x || 0;
  const y = a.y || 0;
  const z = a.z || 0;

  if (!lastMotion) {
    lastMotion = { x, y, z };
    return;
  }

  const dx = x - lastMotion.x;
  const dy = y - lastMotion.y;
  const dz = z - lastMotion.z;
  lastMotion = { x, y, z };

  const jerk = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const threshold = 2.2;

  if (jerk > threshold) {
    const strength = Math.min(2.6, (jerk - threshold) / 4);
    shakeEnergy = Math.min(1.7, shakeEnergy + strength * 0.45);
    addShakeBurst(strength);
    statusEl.textContent = `检测到晃动：蓝眼泪发光强度 ${Math.round(strength * 100)}%`;
  }
}

async function enableMotion() {
  try {
    if (typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function") {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== "granted") {
        statusEl.textContent = "运动感应未授权。仍可用手指划过屏幕测试发光效果。";
        return;
      }
    }

    window.addEventListener("devicemotion", motionHandler, { passive: true });
    statusEl.textContent = "运动感应已启用。现在晃动手机，海面会发光。";
    enableBtn.textContent = "运动感应已启用";
    enableBtn.disabled = true;
  } catch (err) {
    statusEl.textContent = "无法启用运动感应。请用手机浏览器打开，并确认浏览器允许运动传感器。";
    console.error(err);
  }
}

enableBtn.addEventListener("click", enableMotion);

// Touch / mouse disturbance
let pointerDown = false;
let lastPointer = null;

function pointerGlow(clientX, clientY) {
  const now = performance.now();
  let strength = 0.8;

  if (lastPointer) {
    const dx = clientX - lastPointer.x;
    const dy = clientY - lastPointer.y;
    const dt = Math.max(16, now - lastPointer.t);
    const speed = Math.sqrt(dx * dx + dy * dy) / dt;
    strength = Math.min(2.2, 0.5 + speed * 1.8);
  }

  lastPointer = { x: clientX, y: clientY, t: now };
  addGlow(clientX, clientY, strength, 14);
}

window.addEventListener("pointerdown", (e) => {
  pointerDown = true;
  lastPointer = null;
  pointerGlow(e.clientX, e.clientY);
});

window.addEventListener("pointermove", (e) => {
  if (!pointerDown) return;
  pointerGlow(e.clientX, e.clientY);
});

window.addEventListener("pointerup", () => {
  pointerDown = false;
  lastPointer = null;
});

window.addEventListener("pointercancel", () => {
  pointerDown = false;
  lastPointer = null;
});
