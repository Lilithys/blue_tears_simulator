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
  orientationTilt: 0,
  driveX: 0,
  driveY: 0,
  agitation: 0,
  lastMotion: null,
  lastPointer: null,
  pointerDown: false,
  motionEnabled: false,
  orientationEnabled: false
};

const sim = createSimulation(84, 148);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function createSimulation(cols, rows) {
  const size = cols * rows;

  return {
    cols,
    rows,
    size,
    maxMass: 1,
    maxCompress: 0.03,
    minMass: 0.0001,
    minFlow: 0.00008,
    maxFlow: 0.9,
    flowRate: 0.5,
    inside: new Uint8Array(size),
    wall: new Uint8Array(size),
    mass: new Float32Array(size),
    nextMass: new Float32Array(size),
    glow: new Float32Array(size),
    nextGlow: new Float32Array(size),
    excite: new Float32Array(size),
    surface: new Float32Array(cols),
    bufferCanvas: document.createElement("canvas"),
    bufferCtx: null,
    imageData: null,
    initialized: false
  };
}

function isInsideRoundedRect(nx, ny, radius = 0.14) {
  const dx = Math.abs(nx - 0.5);
  const dy = Math.abs(ny - 0.5);
  const qx = Math.max(dx - (0.5 - radius), 0);
  const qy = Math.max(dy - (0.5 - radius), 0);
  return qx * qx + qy * qy <= radius * radius;
}

function indexAt(x, y) {
  return y * sim.cols + x;
}

function initializeSimulation() {
  sim.bufferCanvas.width = sim.cols;
  sim.bufferCanvas.height = sim.rows;
  sim.bufferCtx = sim.bufferCanvas.getContext("2d");
  sim.imageData = sim.bufferCtx.createImageData(sim.cols, sim.rows);

  for (let y = 0; y < sim.rows; y++) {
    for (let x = 0; x < sim.cols; x++) {
      const idx = indexAt(x, y);
      const nx = (x + 0.5) / sim.cols;
      const ny = (y + 0.5) / sim.rows;

      if (!isInsideRoundedRect(nx, ny)) {
        continue;
      }

      sim.inside[idx] = 1;
    }
  }

  for (let y = 0; y < sim.rows; y++) {
    for (let x = 0; x < sim.cols; x++) {
      const idx = indexAt(x, y);
      if (!sim.inside[idx]) {
        continue;
      }

      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ];

      for (const [nx, ny] of neighbors) {
        if (
          nx < 0 ||
          nx >= sim.cols ||
          ny < 0 ||
          ny >= sim.rows ||
          !sim.inside[indexAt(nx, ny)]
        ) {
          sim.wall[idx] = 1;
          break;
        }
      }
    }
  }

  resetLiquid(state.fillLevel);
  sim.initialized = true;
}

function resetLiquid(fillLevel) {
  sim.mass.fill(0);
  sim.glow.fill(0);
  sim.excite.fill(0);

  const fillLine = sim.rows * (1 - fillLevel);

  for (let y = 0; y < sim.rows; y++) {
    for (let x = 0; x < sim.cols; x++) {
      const idx = indexAt(x, y);
      if (!sim.inside[idx]) {
        continue;
      }

      const amount = clamp(y + 1 - fillLine, 0, 1);
      sim.mass[idx] = amount;
    }
  }
}

function getStableState(totalMass) {
  if (totalMass <= sim.maxMass) {
    return sim.maxMass;
  }

  if (totalMass < sim.maxMass * 2 + sim.maxCompress) {
    return (
      sim.maxMass * sim.maxMass +
      totalMass * sim.maxCompress
    ) / (sim.maxMass + sim.maxCompress);
  }

  return (totalMass + sim.maxCompress) * 0.5;
}

function transferMass(fromIdx, toIdx, flow) {
  if (flow <= 0) {
    return 0;
  }

  const actual = Math.min(flow, sim.nextMass[fromIdx]);
  if (actual <= 0) {
    return 0;
  }

  sim.nextMass[fromIdx] -= actual;
  sim.nextMass[toIdx] += actual;
  return actual;
}

function disturbCell(x, y, amount) {
  if (x < 0 || x >= sim.cols || y < 0 || y >= sim.rows) {
    return;
  }

  const idx = indexAt(x, y);
  if (!sim.inside[idx]) {
    return;
  }

  sim.excite[idx] += amount;
}

function stirAt(clientX, clientY, dx, dy, strength) {
  const scene = getScene();
  const px = clientX * DPR;
  const py = clientY * DPR;

  if (
    px < scene.innerLeft ||
    px > scene.innerRight ||
    py < scene.innerTop ||
    py > scene.innerBottom
  ) {
    state.driveX += dx * 0.0022;
    state.driveY += Math.abs(dy) * 0.0016;
    state.agitation += strength * 0.05;
    return;
  }

  const gx = clamp(
    Math.floor(((px - scene.innerLeft) / scene.innerWidth) * sim.cols),
    0,
    sim.cols - 1
  );
  const gy = clamp(
    Math.floor(((py - scene.innerTop) / scene.innerHeight) * sim.rows),
    0,
    sim.rows - 1
  );
  const len = Math.max(1, Math.hypot(dx, dy));
  const dirX = dx / len;
  const dirY = dy / len;
  const radius = 4;

  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      const x = gx + ox;
      const y = gy + oy;
      if (x < 0 || x >= sim.cols || y < 0 || y >= sim.rows) {
        continue;
      }

      const idx = indexAt(x, y);
      if (!sim.inside[idx]) {
        continue;
      }

      const dist = Math.hypot(ox, oy) / radius;
      if (dist > 1) {
        continue;
      }

      const falloff = 1 - dist;
      const targetX = clamp(x + Math.round(dirX * 1.4), 0, sim.cols - 1);
      const targetY = clamp(y + Math.round(dirY * 1.4), 0, sim.rows - 1);
      const targetIdx = indexAt(targetX, targetY);
      if (!sim.inside[targetIdx]) {
        sim.excite[idx] += strength * falloff * 0.18;
        continue;
      }

      const moved = Math.min(sim.mass[idx], 0.08 * falloff * strength);
      sim.mass[idx] -= moved;
      sim.mass[targetIdx] += moved;
      sim.excite[targetIdx] += strength * falloff * 0.12;
    }
  }

  state.driveX += dx * 0.0025;
  state.driveY += Math.abs(dy) * 0.0018;
  state.agitation += strength * 0.08;
}

function simulateSubstep(flowBiasX, verticalBias, agitation) {
  sim.nextMass.set(sim.mass);

  const sideOrder = flowBiasX >= 0 ? [1, -1] : [-1, 1];
  const lateralBias = Math.abs(flowBiasX);

  for (let y = sim.rows - 1; y >= 0; y--) {
    for (let x = 0; x < sim.cols; x++) {
      const idx = indexAt(x, y);
      if (!sim.inside[idx]) {
        continue;
      }

      let remaining = sim.mass[idx];
      if (remaining <= sim.minMass) {
        continue;
      }

      const belowY = y + 1;
      if (belowY < sim.rows) {
        const belowIdx = indexAt(x, belowY);
        if (sim.inside[belowIdx]) {
          let flow = getStableState(remaining + sim.mass[belowIdx]) - sim.mass[belowIdx];
          if (flow > sim.minFlow) {
            flow *= sim.flowRate;
          }
          flow += Math.max(0, verticalBias) * 0.018;
          flow = clamp(flow, 0, Math.min(sim.maxFlow, remaining));
          const moved = transferMass(idx, belowIdx, flow);
          remaining -= moved;

          if (belowY >= sim.rows - 2 && moved > 0.04) {
            const hit = moved * (0.42 + agitation * 0.2 + Math.max(0, verticalBias) * 0.7);
            sim.excite[belowIdx] += hit;
            if (x > 0 && sim.inside[indexAt(x - 1, belowY)]) {
              sim.excite[indexAt(x - 1, belowY)] += hit * 0.22;
            }
            if (x < sim.cols - 1 && sim.inside[indexAt(x + 1, belowY)]) {
              sim.excite[indexAt(x + 1, belowY)] += hit * 0.22;
            }
          }
        } else {
          sim.excite[idx] += remaining * Math.max(0, verticalBias) * 0.16;
        }
      }

      for (const dir of sideOrder) {
        if (remaining <= sim.minMass) {
          break;
        }

        const nx = x + dir;
        if (nx < 0 || nx >= sim.cols) {
          continue;
        }

        const neighborIdx = indexAt(nx, y);
        const bias = Math.max(0, dir * flowBiasX);

        if (!sim.inside[neighborIdx]) {
          const wallHit = remaining * (0.05 + lateralBias * 0.08 + bias * 0.22 + agitation * 0.05);
          sim.excite[idx] += wallHit;

          if (y > 0) {
            const upIdx = indexAt(x, y - 1);
            if (sim.inside[upIdx]) {
              const climb = Math.min(remaining, wallHit * 0.08);
              const moved = transferMass(idx, upIdx, climb);
              remaining -= moved;
              sim.excite[upIdx] += wallHit * 0.3;
            }
          }

          continue;
        }

        const diff = remaining - sim.mass[neighborIdx];
        let flow = diff * (0.12 + bias * 0.16) + bias * 0.03;
        if (flow > sim.minFlow) {
          flow *= 0.5;
        }
        flow = clamp(flow, 0, Math.min(sim.maxFlow * 0.42, remaining));
        const moved = transferMass(idx, neighborIdx, flow);
        remaining -= moved;

        if (moved > 0.025) {
          const shear = moved * (0.12 + bias * 0.4 + agitation * 0.08);
          sim.excite[neighborIdx] += shear;
        }
      }

      if (remaining > sim.maxMass && y > 0) {
        const upIdx = indexAt(x, y - 1);
        if (sim.inside[upIdx]) {
          let flow = remaining - getStableState(remaining + sim.mass[upIdx]);
          if (flow > sim.minFlow) {
            flow *= 0.5;
          }
          flow = clamp(flow, 0, Math.min(sim.maxFlow * 0.26, remaining));
          const moved = transferMass(idx, upIdx, flow);
          if (moved > 0.018 && sim.wall[idx]) {
            sim.excite[upIdx] += moved * 0.22;
          }
        }
      }
    }
  }

  for (let i = 0; i < sim.size; i++) {
    if (!sim.inside[i]) {
      sim.mass[i] = 0;
      continue;
    }

    sim.mass[i] = clamp(sim.nextMass[i], 0, 1.2);
  }
}

function updateGlow(dt) {
  const decay = Math.exp(-dt * 2.4);
  const diffuse = Math.min(0.16, dt * 3.8);

  for (let y = 0; y < sim.rows; y++) {
    for (let x = 0; x < sim.cols; x++) {
      const idx = indexAt(x, y);
      if (!sim.inside[idx]) {
        sim.nextGlow[idx] = 0;
        continue;
      }

      const here = sim.glow[idx];
      let neighborSum = 0;
      let count = 0;

      if (x > 0 && sim.inside[indexAt(x - 1, y)]) {
        neighborSum += sim.glow[indexAt(x - 1, y)];
        count++;
      }
      if (x < sim.cols - 1 && sim.inside[indexAt(x + 1, y)]) {
        neighborSum += sim.glow[indexAt(x + 1, y)];
        count++;
      }
      if (y > 0 && sim.inside[indexAt(x, y - 1)]) {
        neighborSum += sim.glow[indexAt(x, y - 1)];
        count++;
      }
      if (y < sim.rows - 1 && sim.inside[indexAt(x, y + 1)]) {
        neighborSum += sim.glow[indexAt(x, y + 1)];
        count++;
      }

      const blended = count > 0 ? here * (1 - diffuse) + (neighborSum / count) * diffuse : here;
      const fluidMask = clamp(sim.mass[idx] * 1.35, 0, 1);
      const added = sim.excite[idx] * fluidMask;
      sim.nextGlow[idx] = clamp(blended * decay + added, 0, 1.6);
      sim.excite[idx] = 0;
    }
  }

  const swap = sim.glow;
  sim.glow = sim.nextGlow;
  sim.nextGlow = swap;
}

function computeSurface() {
  for (let x = 0; x < sim.cols; x++) {
    sim.surface[x] = sim.rows;

    for (let y = 0; y < sim.rows; y++) {
      const idx = indexAt(x, y);
      if (!sim.inside[idx]) {
        continue;
      }

      if (sim.mass[idx] > 0.08) {
        sim.surface[x] = y + (1 - clamp(sim.mass[idx], 0, 1));
        break;
      }
    }
  }
}

function publishDebug(flowBiasX, verticalBias) {
  let glowingCells = 0;
  let activeCells = 0;
  let maxGlow = 0;

  for (let i = 0; i < sim.size; i++) {
    if (!sim.inside[i]) {
      continue;
    }

    if (sim.mass[i] > 0.08) {
      activeCells++;
    }

    if (sim.glow[i] > 0.04) {
      glowingCells++;
    }

    if (sim.glow[i] > maxGlow) {
      maxGlow = sim.glow[i];
    }
  }

  window.__blueTearsDebug = {
    activeCells,
    glowingCells,
    maxGlow,
    driveX: state.driveX,
    driveY: state.driveY,
    agitation: state.agitation,
    flowBiasX,
    verticalBias
  };
}

function update(dt) {
  const flowBiasX = clamp(state.orientationTilt * 0.48 + state.driveX, -1.5, 1.5);
  const verticalBias = clamp(state.driveY + state.agitation * 0.36, -0.25, 1.75);
  const agitation = clamp(state.agitation, 0, 1.8);
  const substeps = 3;

  for (let step = 0; step < substeps; step++) {
    simulateSubstep(flowBiasX, verticalBias, agitation);
  }

  updateGlow(dt);
  computeSurface();
  publishDebug(flowBiasX, verticalBias);

  state.driveX *= Math.exp(-dt * 3.6);
  state.driveY *= Math.exp(-dt * 4.2);
  state.agitation *= Math.exp(-dt * 2.2);
}

function drawBackground(scene) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#02040a");
  bg.addColorStop(0.38, "#04101c");
  bg.addColorStop(1, "#010308");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const halo = ctx.createRadialGradient(
    scene.centerX,
    scene.centerY + scene.bottleHeight * 0.12,
    scene.bottleWidth * 0.12,
    scene.centerX,
    scene.centerY + scene.bottleHeight * 0.12,
    scene.bottleWidth * 1.1
  );
  halo.addColorStop(0, "rgba(14, 122, 182, 0.16)");
  halo.addColorStop(0.5, "rgba(6, 66, 108, 0.12)");
  halo.addColorStop(1, "rgba(0, 10, 18, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
}

function drawSimulation(scene) {
  const pixels = sim.imageData.data;

  for (let y = 0; y < sim.rows; y++) {
    for (let x = 0; x < sim.cols; x++) {
      const idx = indexAt(x, y);
      const offset = idx * 4;

      if (!sim.inside[idx]) {
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 0;
        continue;
      }

      const mass = sim.mass[idx];
      const glow = sim.glow[idx];
      const depth = y / (sim.rows - 1);
      const fluid = clamp(mass, 0, 1);
      const lum = clamp(glow, 0, 1.6);

      const r = Math.round(10 + depth * 26 + lum * 92);
      const g = Math.round(56 + depth * 54 + lum * 136);
      const b = Math.round(120 + depth * 64 + lum * 110);
      const alpha = Math.round(clamp(fluid * 0.94 + lum * 0.26, 0, 1) * 255);

      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = alpha;
    }
  }

  sim.bufferCtx.putImageData(sim.imageData, 0, 0);

  ctx.save();
  roundedRectPath(scene.bottleX, scene.bottleY, scene.bottleWidth, scene.bottleHeight, scene.radius);
  ctx.clip();

  const glassBase = ctx.createLinearGradient(0, scene.bottleY, 0, scene.bottleY + scene.bottleHeight);
  glassBase.addColorStop(0, "rgba(7, 18, 30, 0.72)");
  glassBase.addColorStop(0.5, "rgba(3, 10, 20, 0.9)");
  glassBase.addColorStop(1, "rgba(2, 7, 15, 0.98)");
  ctx.fillStyle = glassBase;
  ctx.fillRect(scene.bottleX, scene.bottleY, scene.bottleWidth, scene.bottleHeight);

  ctx.save();
  ctx.beginPath();
  ctx.rect(scene.innerLeft, scene.innerTop, scene.innerWidth, scene.innerHeight);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sim.bufferCanvas, scene.innerLeft, scene.innerTop, scene.innerWidth, scene.innerHeight);

  const liquidShade = ctx.createLinearGradient(0, scene.innerTop, 0, scene.innerBottom);
  liquidShade.addColorStop(0, "rgba(180, 238, 255, 0.07)");
  liquidShade.addColorStop(0.45, "rgba(22, 74, 130, 0.05)");
  liquidShade.addColorStop(1, "rgba(0, 18, 38, 0.18)");
  ctx.fillStyle = liquidShade;
  ctx.fillRect(scene.innerLeft, scene.innerTop, scene.innerWidth, scene.innerHeight);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = "rgba(77, 228, 255, 0.42)";
  ctx.shadowBlur = 12 * DPR;
  ctx.lineWidth = 2.1 * DPR;
  ctx.strokeStyle = "rgba(163, 247, 255, 0.55)";
  ctx.beginPath();

  let started = false;
  for (let x = 0; x < sim.cols; x++) {
    const y = sim.surface[x];
    if (y >= sim.rows) {
      continue;
    }

    const px = scene.innerLeft + (x / (sim.cols - 1)) * scene.innerWidth;
    const py = scene.innerTop + (y / (sim.rows - 1)) * scene.innerHeight;

    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }

  if (started) {
    ctx.stroke();
  }

  ctx.restore();

  const innerGlow = ctx.createRadialGradient(
    scene.centerX,
    scene.innerBottom - scene.innerHeight * 0.18,
    10 * DPR,
    scene.centerX,
    scene.innerBottom - scene.innerHeight * 0.18,
    scene.innerWidth * 0.7
  );
  innerGlow.addColorStop(0, "rgba(70, 216, 255, 0.12)");
  innerGlow.addColorStop(0.5, "rgba(18, 112, 180, 0.06)");
  innerGlow.addColorStop(1, "rgba(2, 26, 60, 0)");
  ctx.fillStyle = innerGlow;
  ctx.fillRect(scene.innerLeft, scene.innerTop, scene.innerWidth, scene.innerHeight);

  ctx.restore();
}

function drawBottle(scene) {
  ctx.save();
  roundedRectPath(scene.bottleX, scene.bottleY, scene.bottleWidth, scene.bottleHeight, scene.radius);
  ctx.strokeStyle = "rgba(196, 246, 255, 0.34)";
  ctx.lineWidth = 1.6 * DPR;
  ctx.stroke();

  const outerGlow = ctx.createLinearGradient(
    scene.bottleX,
    scene.bottleY,
    scene.bottleX + scene.bottleWidth,
    scene.bottleY + scene.bottleHeight
  );
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

function render(now) {
  const dt = Math.min(0.032, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;

  if (!sim.initialized) {
    initializeSimulation();
  }

  const scene = getScene();
  update(dt);
  drawBackground(scene);
  drawSimulation(scene);
  drawBottle(scene);

  requestAnimationFrame(render);
}

function applyImpulse(xImpulse, yImpulse, strength = 1) {
  state.driveX = clamp(state.driveX + xImpulse * 0.22, -1.6, 1.6);
  state.driveY = clamp(state.driveY + Math.abs(yImpulse) * 0.2 + strength * 0.08, -0.4, 1.8);
  state.agitation = clamp(state.agitation + strength * 0.16 + Math.abs(xImpulse) * 0.04, 0, 1.8);
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
  if (jerk < 0.65) {
    return;
  }

  const strength = clamp((jerk - 0.65) / 5.4, 0, 1.8);
  applyImpulse(dx, dy, strength);
  setStatus("检测到晃动，液体正在局部撞壁，荧光会在接触带停留后再衰减。");
}

function orientationHandler(event) {
  const gamma = typeof event.gamma === "number" ? event.gamma : 0;
  state.orientationTilt = clamp(gamma / 36, -1, 1);
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
        setStatus("传感器未授权。你仍然可以拖动屏幕，直接搅动瓶中的液体。");
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

    setStatus("运动感应已启用。轻微倾斜看液体堆积，快速晃动看局部撞壁发光。");
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
  const elapsed = Math.max(16, now - state.lastPointer.t);
  const speed = Math.hypot(dx, dy) / elapsed;
  const strength = clamp(speed * 9, 0.08, 1.7);

  stirAt(clientX, clientY, dx, dy, strength);
  state.lastPointer = { x: clientX, y: clientY, t: now };
}

window.addEventListener("resize", resize);
resize();

enableBtn.addEventListener("click", enableMotion);

window.addEventListener("pointerdown", (event) => {
  state.pointerDown = true;
  state.lastPointer = { x: event.clientX, y: event.clientY, t: performance.now() };
  setStatus("正在搅动液体。继续拖动，观察局部撞击带和荧光余辉。");
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
  setStatus("拖动屏幕可直接搅动液体。手机上启用传感器后，可用倾斜和晃动触发局部发光。");
}

window.addEventListener("pointerup", releasePointer);
window.addEventListener("pointercancel", releasePointer);
window.addEventListener("pointerleave", releasePointer);

requestAnimationFrame(render);
