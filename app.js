const canvas = document.getElementById("ocean");
const ctx = canvas.getContext("2d", { alpha: false });
const statusEl = document.getElementById("status");
const enableBtn = document.getElementById("enableBtn");

let W = 0;
let H = 0;
let DPR = 1;
let lastFrame = performance.now();

const state = {
  fillLevel: 0.62,
  horizontalOffset: 0,
  horizontalVelocity: 0,
  surfaceTilt: 0,
  surfaceTiltVelocity: 0,
  orientationTilt: 0,
  verticalPulse: 0,
  waveEnergy: 0.18,
  wavePhase: 0,
  interiorGlow: 0.2,
  surfaceGlow: 0.3,
  wallGlowLeft: 0.08,
  wallGlowRight: 0.08,
  bottomGlow: 0.12,
  leftGlowCenter: 0,
  rightGlowCenter: 0,
  bottomGlowCenter: 0,
  impactCooldownLeft: 0,
  impactCooldownRight: 0,
  impactCooldownBottom: 0,
  blooms: [],
  lastMotion: null,
  lastPointer: null,
  pointerDown: false,
  motionEnabled: false,
  orientationEnabled: false
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function roundedRectPath(x, y, w, h, r) {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.floor(window.innerWidth * DPR);
  H = Math.floor(window.innerHeight * DPR);
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}

function getScene() {
  const bottleWidth = Math.min(W * 0.5, 420 * DPR);
  const bottleHeight = Math.min(H * 0.72, 760 * DPR);
  const bottleX = (W - bottleWidth) * 0.5;
  const bottleY = (H - bottleHeight) * 0.5 - H * 0.03;
  const radius = bottleWidth * 0.14;
  const paddingX = bottleWidth * 0.085;
  const paddingY = bottleHeight * 0.07;
  const innerLeft = bottleX + paddingX;
  const innerRight = bottleX + bottleWidth - paddingX;
  const innerTop = bottleY + paddingY;
  const innerBottom = bottleY + bottleHeight - paddingY;

  return {
    bottleX,
    bottleY,
    bottleWidth,
    bottleHeight,
    radius,
    innerLeft,
    innerRight,
    innerTop,
    innerBottom,
    innerWidth: innerRight - innerLeft,
    innerHeight: innerBottom - innerTop,
    centerX: bottleX + bottleWidth * 0.5,
    centerY: bottleY + bottleHeight * 0.5
  };
}

function setStatus(text) {
  statusEl.textContent = text;
}

function addBloom(side, power, scene) {
  const fillDepth = scene.innerHeight * state.fillLevel;
  const baseSurfaceY = scene.innerBottom - fillDepth;
  const slopePx = state.surfaceTilt * scene.innerHeight * 0.34;
  const waveAmp = (8 * DPR + scene.innerHeight * 0.012) * state.waveEnergy;
  const meniscus = 8 * DPR;

  if (side === "left") {
    const y = clamp(
      baseSurfaceY - slopePx + Math.sin(state.wavePhase + Math.PI * 0.3) * waveAmp * 0.18 - meniscus * 0.4,
      scene.innerTop + 18 * DPR,
      scene.innerBottom - 42 * DPR
    );

    state.blooms.push({
      x: scene.innerLeft + 2 * DPR,
      y,
      rx: 34 * DPR,
      ry: 88 * DPR,
      power,
      age: 0,
      life: 0.85
    });
    state.leftGlowCenter = y;
  }

  if (side === "right") {
    const y = clamp(
      baseSurfaceY + slopePx + Math.sin(state.wavePhase + Math.PI * 0.8) * waveAmp * 0.18 - meniscus * 0.4,
      scene.innerTop + 18 * DPR,
      scene.innerBottom - 42 * DPR
    );

    state.blooms.push({
      x: scene.innerRight - 2 * DPR,
      y,
      rx: 34 * DPR,
      ry: 88 * DPR,
      power,
      age: 0,
      life: 0.85
    });
    state.rightGlowCenter = y;
  }

  if (side === "bottom") {
    state.bottomGlowCenter = scene.centerX + state.horizontalOffset * 0.28;
    state.blooms.push({
      x: state.bottomGlowCenter,
      y: scene.innerBottom - 5 * DPR,
      rx: 130 * DPR,
      ry: 34 * DPR,
      power,
      age: 0,
      life: 1.05
    });
  }
}

function triggerImpact(side, power, scene) {
  const intensity = clamp(power, 0.25, 1.6);

  state.surfaceGlow = clamp(state.surfaceGlow + intensity * 0.35, 0, 1.8);
  state.interiorGlow = clamp(state.interiorGlow + intensity * 0.24, 0, 1.5);
  state.waveEnergy = clamp(state.waveEnergy + intensity * 0.18, 0, 1.8);

  if (side === "left") {
    state.wallGlowLeft = clamp(state.wallGlowLeft + intensity * 0.95, 0, 2);
    state.impactCooldownLeft = 0.16;
  }

  if (side === "right") {
    state.wallGlowRight = clamp(state.wallGlowRight + intensity * 0.95, 0, 2);
    state.impactCooldownRight = 0.16;
  }

  if (side === "bottom") {
    state.bottomGlow = clamp(state.bottomGlow + intensity, 0, 2);
    state.impactCooldownBottom = 0.24;
  }

  addBloom(side, intensity, scene);
}

function applyImpulse(xImpulse, yImpulse, strength = 1) {
  state.horizontalVelocity += xImpulse * 520 * DPR;
  state.surfaceTiltVelocity += xImpulse * 1.2;
  state.verticalPulse = clamp(
    state.verticalPulse + Math.abs(yImpulse) * 0.75 + strength * 0.16,
    0,
    1.8
  );
  state.waveEnergy = clamp(
    state.waveEnergy + Math.abs(xImpulse) * 0.22 + strength * 0.12,
    0,
    1.8
  );
  state.surfaceGlow = clamp(state.surfaceGlow + strength * 0.08, 0, 1.8);
  state.interiorGlow = clamp(state.interiorGlow + strength * 0.06, 0, 1.5);
}

function drawBackground(scene, time) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#02040a");
  bg.addColorStop(0.38, "#04111e");
  bg.addColorStop(1, "#010308");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const halo = ctx.createRadialGradient(
    scene.centerX,
    scene.centerY + scene.bottleHeight * 0.12,
    scene.bottleWidth * 0.1,
    scene.centerX,
    scene.centerY + scene.bottleHeight * 0.12,
    scene.bottleWidth * 1.1
  );
  halo.addColorStop(0, "rgba(18, 152, 210, 0.16)");
  halo.addColorStop(0.46, "rgba(8, 88, 132, 0.12)");
  halo.addColorStop(1, "rgba(1, 8, 18, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.085;
  ctx.strokeStyle = "rgba(90, 198, 255, 0.14)";
  ctx.lineWidth = 1 * DPR;

  for (let i = 0; i < 11; i++) {
    const y = H * (0.12 + i * 0.075);
    ctx.beginPath();
    for (let x = -40 * DPR; x <= W + 40 * DPR; x += 20 * DPR) {
      const wave =
        Math.sin(x * 0.008 + time * 0.00055 + i * 0.7) * (4 + i * 0.2) * DPR +
        Math.sin(x * 0.015 + time * 0.0008) * 2 * DPR;
      if (x <= -40 * DPR) {
        ctx.moveTo(x, y + wave);
      } else {
        ctx.lineTo(x, y + wave);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

function getSurfacePoints(scene) {
  const fillDepth = scene.innerHeight * state.fillLevel;
  const baseSurfaceY = scene.innerBottom - fillDepth;
  const slopePx = state.surfaceTilt * scene.innerHeight * 0.34;
  const waveAmp = (8 * DPR + scene.innerHeight * 0.012) * state.waveEnergy;
  const meniscus = 9 * DPR;
  const points = [];
  const samples = 26;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = lerp(scene.innerLeft, scene.innerRight, t);
    const centered = (t - 0.5) * 2;
    const wave =
      Math.sin(t * Math.PI * 2 + state.wavePhase) * waveAmp * 0.24 +
      Math.sin(t * Math.PI * 4 + state.wavePhase * 1.4) * waveAmp * 0.12;
    const edgeLift =
      Math.pow(1 - Math.abs(centered), 0.55) * 0 -
      (Math.pow(1 - t, 7) + Math.pow(t, 7)) * meniscus;

    const y = baseSurfaceY + centered * slopePx + wave + edgeLift;
    points.push({ x, y });
  }

  return points;
}

function drawLiquid(scene) {
  const surface = getSurfacePoints(scene);

  ctx.save();
  roundedRectPath(scene.bottleX, scene.bottleY, scene.bottleWidth, scene.bottleHeight, scene.radius);
  ctx.clip();

  const glassBase = ctx.createLinearGradient(0, scene.bottleY, 0, scene.bottleY + scene.bottleHeight);
  glassBase.addColorStop(0, "rgba(7, 18, 30, 0.76)");
  glassBase.addColorStop(0.5, "rgba(3, 11, 23, 0.92)");
  glassBase.addColorStop(1, "rgba(2, 8, 16, 0.98)");
  ctx.fillStyle = glassBase;
  ctx.fillRect(scene.bottleX, scene.bottleY, scene.bottleWidth, scene.bottleHeight);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(surface[0].x, surface[0].y);
  for (let i = 1; i < surface.length; i++) {
    ctx.lineTo(surface[i].x, surface[i].y);
  }
  ctx.lineTo(scene.innerRight, scene.innerBottom);
  ctx.lineTo(scene.innerLeft, scene.innerBottom);
  ctx.closePath();
  ctx.clip();

  const liquid = ctx.createLinearGradient(0, scene.innerTop, 0, scene.innerBottom);
  liquid.addColorStop(0, "rgba(22, 132, 172, 0.72)");
  liquid.addColorStop(0.28, "rgba(10, 84, 138, 0.76)");
  liquid.addColorStop(1, "rgba(2, 25, 46, 0.96)");
  ctx.fillStyle = liquid;
  ctx.fillRect(scene.innerLeft, scene.innerTop, scene.innerWidth, scene.innerHeight);

  const bodyMist = ctx.createRadialGradient(
    scene.centerX + state.horizontalOffset * 0.18,
    scene.innerBottom - scene.innerHeight * 0.24,
    8 * DPR,
    scene.centerX + state.horizontalOffset * 0.18,
    scene.innerBottom - scene.innerHeight * 0.24,
    scene.innerWidth * 0.65
  );
  bodyMist.addColorStop(0, `rgba(61, 228, 255, ${0.1 + state.interiorGlow * 0.16})`);
  bodyMist.addColorStop(0.42, `rgba(18, 142, 200, ${0.08 + state.interiorGlow * 0.1})`);
  bodyMist.addColorStop(1, "rgba(5, 38, 74, 0)");
  ctx.fillStyle = bodyMist;
  ctx.fillRect(scene.innerLeft, scene.innerTop, scene.innerWidth, scene.innerHeight);

  for (const bloom of state.blooms) {
    const k = bloom.age / bloom.life;
    const alpha = Math.pow(1 - k, 1.6) * bloom.power * 0.46;
    const gradient = ctx.createRadialGradient(
      bloom.x,
      bloom.y,
      0,
      bloom.x,
      bloom.y,
      Math.max(bloom.rx, bloom.ry)
    );
    gradient.addColorStop(0, `rgba(133, 249, 255, ${alpha})`);
    gradient.addColorStop(0.4, `rgba(42, 206, 255, ${alpha * 0.72})`);
    gradient.addColorStop(1, "rgba(2, 90, 160, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(bloom.x, bloom.y, bloom.rx, bloom.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const leftGlowY = state.leftGlowCenter || (scene.innerBottom - scene.innerHeight * state.fillLevel);
  const leftGlow = ctx.createRadialGradient(
    scene.innerLeft,
    leftGlowY,
    0,
    scene.innerLeft,
    leftGlowY,
    scene.innerHeight * 0.24
  );
  leftGlow.addColorStop(0, `rgba(112, 242, 255, ${0.08 + state.wallGlowLeft * 0.22})`);
  leftGlow.addColorStop(0.42, `rgba(28, 192, 255, ${0.04 + state.wallGlowLeft * 0.12})`);
  leftGlow.addColorStop(1, "rgba(12, 114, 185, 0)");
  ctx.fillStyle = leftGlow;
  ctx.fillRect(
    scene.innerLeft - scene.innerWidth * 0.05,
    leftGlowY - scene.innerHeight * 0.26,
    scene.innerWidth * 0.32,
    scene.innerHeight * 0.52
  );

  const rightGlowY = state.rightGlowCenter || (scene.innerBottom - scene.innerHeight * state.fillLevel);
  const rightGlow = ctx.createRadialGradient(
    scene.innerRight,
    rightGlowY,
    0,
    scene.innerRight,
    rightGlowY,
    scene.innerHeight * 0.24
  );
  rightGlow.addColorStop(0, `rgba(112, 242, 255, ${0.08 + state.wallGlowRight * 0.22})`);
  rightGlow.addColorStop(0.42, `rgba(28, 192, 255, ${0.04 + state.wallGlowRight * 0.12})`);
  rightGlow.addColorStop(1, "rgba(12, 114, 185, 0)");
  ctx.fillStyle = rightGlow;
  ctx.fillRect(
    scene.innerRight - scene.innerWidth * 0.27,
    rightGlowY - scene.innerHeight * 0.26,
    scene.innerWidth * 0.32,
    scene.innerHeight * 0.52
  );

  const bottomGlow = ctx.createRadialGradient(
    state.bottomGlowCenter || (scene.centerX + state.horizontalOffset * 0.24),
    scene.innerBottom,
    10 * DPR,
    state.bottomGlowCenter || (scene.centerX + state.horizontalOffset * 0.24),
    scene.innerBottom,
    scene.innerWidth * 0.55
  );
  bottomGlow.addColorStop(0, `rgba(103, 244, 255, ${0.1 + state.bottomGlow * 0.22})`);
  bottomGlow.addColorStop(0.58, `rgba(28, 194, 255, ${0.04 + state.bottomGlow * 0.1})`);
  bottomGlow.addColorStop(1, "rgba(2, 36, 82, 0)");
  ctx.fillStyle = bottomGlow;
  ctx.fillRect(scene.innerLeft, scene.innerBottom - scene.innerHeight * 0.22, scene.innerWidth, scene.innerHeight * 0.26);

  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = `rgba(146, 248, 255, ${0.26 + state.surfaceGlow * 0.2})`;
  ctx.lineWidth = 2.2 * DPR;
  ctx.shadowColor = "rgba(61, 228, 255, 0.7)";
  ctx.shadowBlur = 16 * DPR;
  ctx.beginPath();
  ctx.moveTo(surface[0].x, surface[0].y);
  for (let i = 1; i < surface.length; i++) {
    ctx.lineTo(surface[i].x, surface[i].y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  ctx.save();
  roundedRectPath(scene.bottleX, scene.bottleY, scene.bottleWidth, scene.bottleHeight, scene.radius);
  ctx.strokeStyle = "rgba(196, 246, 255, 0.34)";
  ctx.lineWidth = 1.6 * DPR;
  ctx.stroke();

  const outerGlow = ctx.createLinearGradient(scene.bottleX, scene.bottleY, scene.bottleX + scene.bottleWidth, scene.bottleY + scene.bottleHeight);
  outerGlow.addColorStop(0, "rgba(166, 239, 255, 0.16)");
  outerGlow.addColorStop(0.45, "rgba(92, 170, 212, 0.06)");
  outerGlow.addColorStop(1, "rgba(255, 255, 255, 0.02)");
  ctx.strokeStyle = outerGlow;
  ctx.lineWidth = 8 * DPR;
  ctx.stroke();

  const reflection = ctx.createLinearGradient(
    scene.bottleX + scene.bottleWidth * 0.18,
    scene.bottleY,
    scene.bottleX + scene.bottleWidth * 0.36,
    scene.bottleY + scene.bottleHeight
  );
  reflection.addColorStop(0, "rgba(255, 255, 255, 0.2)");
  reflection.addColorStop(0.18, "rgba(185, 244, 255, 0.08)");
  reflection.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = reflection;
  ctx.beginPath();
  ctx.moveTo(scene.bottleX + scene.bottleWidth * 0.14, scene.bottleY + 22 * DPR);
  ctx.quadraticCurveTo(
    scene.bottleX + scene.bottleWidth * 0.32,
    scene.centerY,
    scene.bottleX + scene.bottleWidth * 0.2,
    scene.bottleY + scene.bottleHeight - 26 * DPR
  );
  ctx.quadraticCurveTo(
    scene.bottleX + scene.bottleWidth * 0.26,
    scene.centerY,
    scene.bottleX + scene.bottleWidth * 0.22,
    scene.bottleY + 18 * DPR
  );
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function update(dt, scene) {
  const maxOffset = scene.innerWidth * 0.16;
  const targetOffset = clamp(state.orientationTilt * scene.innerWidth * 0.1, -maxOffset * 0.7, maxOffset * 0.7);
  const offsetAccel = (targetOffset - state.horizontalOffset) * 11 - state.horizontalVelocity * 4.8;
  state.horizontalVelocity += offsetAccel * dt;
  state.horizontalOffset = clamp(state.horizontalOffset + state.horizontalVelocity * dt, -maxOffset, maxOffset);

  const targetTilt = clamp(
    state.orientationTilt * 0.18 + (state.horizontalOffset / scene.innerWidth) * 0.46,
    -0.24,
    0.24
  );
  const tiltAccel = (targetTilt - state.surfaceTilt) * 18 - state.surfaceTiltVelocity * 5.6;
  state.surfaceTiltVelocity += tiltAccel * dt;
  state.surfaceTilt = clamp(state.surfaceTilt + state.surfaceTiltVelocity * dt, -0.28, 0.28);

  state.wavePhase += dt * (1.8 + state.waveEnergy * 3.1);
  state.waveEnergy *= Math.exp(-dt * 1.35);
  state.verticalPulse *= Math.exp(-dt * 2.4);
  state.interiorGlow *= Math.exp(-dt * 1.3);
  state.surfaceGlow *= Math.exp(-dt * 1.65);
  state.wallGlowLeft *= Math.exp(-dt * 2.1);
  state.wallGlowRight *= Math.exp(-dt * 2.1);
  state.bottomGlow *= Math.exp(-dt * 1.8);
  state.impactCooldownLeft = Math.max(0, state.impactCooldownLeft - dt);
  state.impactCooldownRight = Math.max(0, state.impactCooldownRight - dt);
  state.impactCooldownBottom = Math.max(0, state.impactCooldownBottom - dt);

  const wallThreshold = maxOffset * 0.58;
  const leftPressure = clamp((-state.horizontalOffset - wallThreshold) / (maxOffset - wallThreshold), 0, 1.6);
  const rightPressure = clamp((state.horizontalOffset - wallThreshold) / (maxOffset - wallThreshold), 0, 1.6);
  const lateralSpeed = Math.abs(state.horizontalVelocity) / (320 * DPR);

  if (state.horizontalVelocity < -32 * DPR && leftPressure > 0.02) {
    state.wallGlowLeft = clamp(state.wallGlowLeft + leftPressure * 0.12, 0, 1.8);
  }

  if (state.horizontalVelocity > 32 * DPR && rightPressure > 0.02) {
    state.wallGlowRight = clamp(state.wallGlowRight + rightPressure * 0.12, 0, 1.8);
  }

  if (leftPressure > 0.16 && state.horizontalVelocity < -60 * DPR && state.impactCooldownLeft <= 0) {
    triggerImpact("left", leftPressure * (0.55 + lateralSpeed), scene);
  }

  if (rightPressure > 0.16 && state.horizontalVelocity > 60 * DPR && state.impactCooldownRight <= 0) {
    triggerImpact("right", rightPressure * (0.55 + lateralSpeed), scene);
  }

  const bottomPressure = clamp(state.verticalPulse * 0.9 + lateralSpeed * 0.18, 0, 1.8);
  if (bottomPressure > 0.22) {
    state.bottomGlow = clamp(state.bottomGlow + bottomPressure * 0.03, 0, 1.6);
  }

  if (bottomPressure > 0.58 && state.impactCooldownBottom <= 0) {
    triggerImpact("bottom", bottomPressure, scene);
  }

  for (let i = state.blooms.length - 1; i >= 0; i--) {
    const bloom = state.blooms[i];
    bloom.age += dt;
    if (bloom.age >= bloom.life) {
      state.blooms.splice(i, 1);
    }
  }

  if (state.blooms.length > 36) {
    state.blooms.splice(0, state.blooms.length - 36);
  }
}

function render(now) {
  const dt = Math.min(0.032, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;

  const scene = getScene();
  update(dt, scene);
  drawBackground(scene, now);
  drawLiquid(scene);

  requestAnimationFrame(render);
}

function motionHandler(event) {
  const a = event.accelerationIncludingGravity || event.acceleration;
  if (!a) {
    return;
  }

  const x = a.x || 0;
  const y = a.y || 0;
  const z = a.z || 0;

  if (!state.lastMotion) {
    state.lastMotion = { x, y, z };
    return;
  }

  const dx = x - state.lastMotion.x;
  const dy = y - state.lastMotion.y;
  const dz = z - state.lastMotion.z;
  state.lastMotion = { x, y, z };

  const jerk = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (jerk < 0.8) {
    return;
  }

  const strength = clamp((jerk - 0.8) / 4.8, 0, 1.8);
  applyImpulse(dx * 0.08, dy * 0.06, strength);
  setStatus("检测到晃动，液体正在撞击瓶壁并留下蓝色余辉。");
}

function orientationHandler(event) {
  const gamma = typeof event.gamma === "number" ? event.gamma : 0;
  state.orientationTilt = clamp(gamma / 42, -1, 1);
}

async function enableMotion() {
  try {
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      const motionPermission = await DeviceMotionEvent.requestPermission();
      let orientationPermission = "granted";

      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        orientationPermission = await DeviceOrientationEvent.requestPermission();
      }

      if (motionPermission !== "granted" || orientationPermission !== "granted") {
        setStatus("传感器未授权。你仍然可以拖动屏幕，观察液体撞壁发光。");
        return;
      }
    }

    if (!state.motionEnabled) {
      window.addEventListener("devicemotion", motionHandler, { passive: true });
      state.motionEnabled = true;
    }

    if (!state.orientationEnabled) {
      window.addEventListener("deviceorientation", orientationHandler, { passive: true });
      state.orientationEnabled = true;
    }

    setStatus("运动感应已启用。轻微倾斜看液面变化，快速晃动看瓶壁和底部发光。");
    enableBtn.textContent = "运动感应已启用";
    enableBtn.disabled = true;
  } catch (error) {
    setStatus("无法启用传感器。请用支持传感器的手机浏览器打开，或直接拖动屏幕测试。");
    console.error(error);
  }
}

function pointerImpulse(clientX, clientY) {
  const now = performance.now();

  if (!state.lastPointer) {
    state.lastPointer = { x: clientX, y: clientY, t: now };
    return;
  }

  const dx = clientX - state.lastPointer.x;
  const dy = clientY - state.lastPointer.y;
  const dt = Math.max(16, now - state.lastPointer.t);
  const speedX = dx / dt;
  const speedY = dy / dt;
  const strength = clamp(Math.sqrt(speedX * speedX + speedY * speedY) * 8, 0.08, 1.6);

  applyImpulse(speedX * 1.35, speedY * 0.9, strength);
  state.lastPointer = { x: clientX, y: clientY, t: now };
}

window.addEventListener("resize", resize);
resize();

enableBtn.addEventListener("click", enableMotion);

window.addEventListener("pointerdown", (event) => {
  state.pointerDown = true;
  state.lastPointer = { x: event.clientX, y: event.clientY, t: performance.now() };
  setStatus("正在搅动液体。继续拖动，观察液面倾斜和撞壁荧光。");
});

window.addEventListener("pointermove", (event) => {
  if (!state.pointerDown) {
    return;
  }

  pointerImpulse(event.clientX, event.clientY);
});

function releasePointer() {
  state.pointerDown = false;
  state.lastPointer = null;
  setStatus("拖动屏幕可搅动液体。手机上启用传感器后，可用倾斜和晃动触发撞壁发光。");
}

window.addEventListener("pointerup", releasePointer);
window.addEventListener("pointercancel", releasePointer);
window.addEventListener("pointerleave", releasePointer);

requestAnimationFrame(render);
