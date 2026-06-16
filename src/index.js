import "./styles.css";
import * as THREE from "three";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xeeeeee);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.01, 1000);
camera.position.set(0, 0, 0.5);
camera.lookAt(new THREE.Vector3(0, 0, 0));
scene.add(camera);

const GRIDW = 160;
const GRIDH = 160;
const N = GRIDW;

// シミュレーション結果を4倍にアップサンプリングして描画
const UPSAMPLE = 4;
const VIS_W = GRIDW * UPSAMPLE;
const VIS_H = GRIDH * UPSAMPLE;

const visCanvas = document.createElement('canvas');
visCanvas.width = VIS_W;
visCanvas.height = VIS_H;
const ctx = visCanvas.getContext('2d');
const imageData = ctx.createImageData(VIS_W, VIS_H);
const texture = new THREE.CanvasTexture(visCanvas);

// 画面全体を覆う1枚のクワッドで描画
const quadMat = new THREE.MeshBasicMaterial({ map: texture });
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), quadMat);
scene.add(quad);

// u[x][y]: 速度場 (Vector3.x = 横, Vector3.y = 縦)
const u = Array.from({ length: GRIDW }, () =>
  Array.from({ length: GRIDH }, () => new THREE.Vector3()));
const u0 = Array.from({ length: GRIDW }, () =>
  Array.from({ length: GRIDH }, () => new THREE.Vector3()));

// pres[x][y].x = 圧力スカラー, pres[x][y].y = 発散（作業用）
const pres = Array.from({ length: GRIDW }, () =>
  Array.from({ length: GRIDH }, () => new THREE.Vector3()));

let f = [];

const dt = 6;
let visc = Number(document.getElementById("viscosity").value);
let forcestr = Number(document.getElementById("forcestr").value);
const ITER = 3;
const VIS_SCALE = 800;

// Neumann境界条件
function setBnd(type, field, comp) {
  for (let i = 1; i < N - 1; i++) {
    field[0][i][comp]   = type === 1 ? -field[1][i][comp]   : field[1][i][comp];
    field[N-1][i][comp] = type === 1 ? -field[N-2][i][comp] : field[N-2][i][comp];
    field[i][0][comp]   = type === 2 ? -field[i][1][comp]   : field[i][1][comp];
    field[i][N-1][comp] = type === 2 ? -field[i][N-2][comp] : field[i][N-2][comp];
  }
  field[0][0][comp]     = 0.5*(field[1][0][comp]+field[0][1][comp]);
  field[N-1][0][comp]   = 0.5*(field[N-2][0][comp]+field[N-1][1][comp]);
  field[0][N-1][comp]   = 0.5*(field[1][N-1][comp]+field[0][N-2][comp]);
  field[N-1][N-1][comp] = 0.5*(field[N-2][N-1][comp]+field[N-1][N-2][comp]);
}

// ガウスザイデル法
function linSolve(field, field0, a, c, comp, type) {
  for (let k = 0; k < ITER; k++) {
    for (let x = 1; x < N - 1; x++) {
      for (let y = 1; y < N - 1; y++) {
        field[x][y][comp] = (field0[x][y][comp] + a * (
          field[x-1][y][comp] + field[x+1][y][comp] +
          field[x][y-1][comp] + field[x][y+1][comp]
        )) / c;
      }
    }
    setBnd(type, field, comp);
  }
}

function diffuse() {
  const a = dt * visc * N * N;
  const c = 1 + 4 * a;
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) { u0[x][y].x = u[x][y].x; u0[x][y].y = u[x][y].y; }
  linSolve(u, u0, a, c, 'x', 1);
  linSolve(u, u0, a, c, 'y', 2);
}

function project() {
  const h = 1.0 / N;
  for (let x = 1; x < N - 1; x++) {
    for (let y = 1; y < N - 1; y++) {
      pres[x][y].y = -0.5 * h * (
        u[x+1][y].x - u[x-1][y].x + u[x][y+1].y - u[x][y-1].y
      );
      pres[x][y].x = 0;
    }
  }
  setBnd(0, pres, 'y');
  setBnd(0, pres, 'x');
  for (let k = 0; k < ITER; k++) {
    for (let x = 1; x < N - 1; x++) {
      for (let y = 1; y < N - 1; y++) {
        pres[x][y].x = (pres[x][y].y +
          pres[x-1][y].x + pres[x+1][y].x +
          pres[x][y-1].x + pres[x][y+1].x
        ) / 4;
      }
    }
    setBnd(0, pres, 'x');
  }
  for (let x = 1; x < N - 1; x++) {
    for (let y = 1; y < N - 1; y++) {
      u[x][y].x -= 0.5 * (pres[x+1][y].x - pres[x-1][y].x) / h;
      u[x][y].y -= 0.5 * (pres[x][y+1].x - pres[x][y-1].x) / h;
    }
  }
  setBnd(1, u, 'x');
  setBnd(2, u, 'y');
}

function advect() {
  const dt0 = dt * N;
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) { u0[x][y].x = u[x][y].x; u0[x][y].y = u[x][y].y; }
  for (let x = 1; x < N - 1; x++) {
    for (let y = 1; y < N - 1; y++) {
      const px = Math.max(0.5, Math.min(N - 1.5, x - dt0 * u0[x][y].x));
      const py = Math.max(0.5, Math.min(N - 1.5, y - dt0 * u0[x][y].y));
      const x0 = Math.floor(px), x1 = x0 + 1;
      const y0 = Math.floor(py), y1 = y0 + 1;
      const sx = px - x0, sy = py - y0;
      u[x][y].x = (1-sx)*((1-sy)*u0[x0][y0].x + sy*u0[x0][y1].x) +
                      sx *((1-sy)*u0[x1][y0].x + sy*u0[x1][y1].x);
      u[x][y].y = (1-sx)*((1-sy)*u0[x0][y0].y + sy*u0[x0][y1].y) +
                      sx *((1-sy)*u0[x1][y0].y + sy*u0[x1][y1].y);
    }
  }
  setBnd(1, u, 'x');
  setBnd(2, u, 'y');
}

// 4倍バイリニアアップサンプリングでキャンバスに書き込む
function updateGrid() {
  const data = imageData.data;
  for (let py = 0; py < VIS_H; py++) {
    for (let px = 0; px < VIS_W; px++) {
      // キャンバス座標 → シミュレーショングリッド座標（中心オフセット）
      const sx = (px + 0.5) / UPSAMPLE - 0.5;
      const sy = (py + 0.5) / UPSAMPLE - 0.5;
      const x0 = Math.max(0, Math.min(GRIDW - 1, Math.floor(sx)));
      const x1 = Math.min(GRIDW - 1, x0 + 1);
      const y0 = Math.max(0, Math.min(GRIDH - 1, Math.floor(sy)));
      const y1 = Math.min(GRIDH - 1, y0 + 1);
      const tx = Math.max(0, sx - x0);
      const ty = Math.max(0, sy - y0);

      // バイリニア補間
      const vx = (1-tx)*((1-ty)*u[x0][y0].x + ty*u[x0][y1].x) +
                     tx *((1-ty)*u[x1][y0].x + ty*u[x1][y1].x);
      const vy = (1-tx)*((1-ty)*u[x0][y0].y + ty*u[x0][y1].y) +
                     tx *((1-ty)*u[x1][y0].y + ty*u[x1][y1].y);

      const idx = (py * VIS_W + px) * 4;
      data[idx]   = 255 - Math.min(255, Math.max(0, vx * VIS_SCALE * 127));
      data[idx+1] = 255- Math.min(255, Math.max(0, vy * VIS_SCALE * 127));
      data[idx+2] = 255 - Math.min(127, Math.max(0, vx * VIS_SCALE * 127)) - Math.min(127, Math.max(0, vx * VIS_SCALE * 127));
      data[idx+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  texture.needsUpdate = true;
}

const stfstep = () => {
  // 外力項（前進オイラー法）
  for (const { x, y, fx, fy } of f) {
    if (x >= 1 && x < N - 1 && y >= 1 && y < N - 1) {
      u[x][y].x += dt * fx;
      u[x][y].y += dt * fy;
    }
  }
  f.length = 0;
  diffuse();
  project();
  advect();
  project();
  updateGrid();
};

// マウスドラッグで外力を追加（変化があった部分のみ）
let lastMouseGrid = null;
window.addEventListener("mouseup", () => { lastMouseGrid = null; });
window.addEventListener("mousemove", (e) => {
  //if (e.buttons === 0) { lastMouseGrid = null; return; }
  const mx = (e.clientX / window.innerWidth) * 2 - 1;
  const my = (e.clientY / window.innerHeight) * 2 - 1;
  const gx = Math.floor((mx + aspect) / (2 * aspect) * GRIDW);
  const gy = Math.floor((my + 1) / 2 * GRIDH);
  if (gx < 1 || gx >= GRIDW - 1 || gy < 1 || gy >= GRIDH - 1) {
    lastMouseGrid = null;
    return;
  }
  if (lastMouseGrid) {
    f.push({ x: gx, y: gy, fx: (gx - lastMouseGrid.x)*forcestr, fy: (gy - lastMouseGrid.y)*forcestr });
  }
  lastMouseGrid = { x: gx, y: gy };
});

function animate() {
  visc = Number(document.getElementById("viscosity").value);
  forcestr = Number(document.getElementById("forcestr").value);
  console.log(visc);
  requestAnimationFrame(animate);
  stfstep();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.left = -aspect;
  camera.right = aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  quad.geometry.dispose();
  quad.geometry = new THREE.PlaneGeometry(2 * aspect, 2);
});
