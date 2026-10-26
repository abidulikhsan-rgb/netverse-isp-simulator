import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Device, DeviceKind, DeviceStatus, Link } from './networkEngine';
import { deviceStatus } from './networkEngine';
import { allRacks, planLabLayout, RACK_H, RACK_W, RACK_D, NOC_RACK, NOC_HERO_Y, AISLE_NAMES, AISLE_SIGN_X, AISLE_SIGN_Z, type Aisle, type DevicePlace } from './labLayout';
import { isAislePowered, simNetwork, type PowerGrid } from './labMetrics';
import { drawScreen, type NocScreenId, type NocData } from './nocScreens';
import { heroLcdData, heroLcdLines, nextHeroLcdView, type HeroLcdData, type HeroLcdView } from './heroLcd';
import { audio } from './audio';
import { loadNetverseAsset } from './three-loader';
import { maintenanceActionLabel, rackKey, selectRackAction, selectStoragePickup, type Carrying, type MaintenanceAction } from './maintenance';

type PortStyle = 'rj45' | 'sfp';
type KindSpec = { color: number; face: number; bezel: number; height: number; depth: number; portStyle: PortStyle; lcd?: boolean; leds?: number; drives?: number };

// Refined MikroTik CCR Style Specs
const KIND_SPEC: Record<DeviceKind, KindSpec> = {
  router: { color: 0xcccccc, face: 0xeeeeee, bezel: 0xbbbbbb, height: 0.6, depth: 0.8, portStyle: 'rj45', lcd: true, leds: 4 },
  switch: { color: 0x262b33, face: 0x2b3038, bezel: 0x14181e, height: 0.6, depth: 0.8, portStyle: 'rj45', leds: 4 },
  olt: { color: 0xf4f5f6, face: 0xf8f9fa, bezel: 0xd5dae0, height: 0.6, depth: 0.8, portStyle: 'sfp', leds: 4 },
  ont: { color: 0xf4f5f6, face: 0xffffff, bezel: 0xe2e5e9, height: 0.42, depth: 0.55, portStyle: 'sfp', leds: 4 },
  pc: { color: 0x9aa3ad, face: 0xa4adb6, bezel: 0x747d86, height: 0.42, depth: 0.55, portStyle: 'rj45', leds: 2 },
  server: { color: 0x262b33, face: 0x20252c, bezel: 0x101318, height: 1.2, depth: 0.8, portStyle: 'rj45', leds: 3, drives: 4 },
};

const HERO_KIND_SPEC: KindSpec = {
  color: 0x252b31,
  face: 0x303840,
  bezel: 0x12171c,
  height: 0.27,
  depth: 0.7,
  portStyle: 'sfp',
  lcd: true,
  leds: 2,
};

const PORT_DIMS: Record<PortStyle, [number, number]> = { rj45: [0.1, 0.14], sfp: [0.13, 0.17] };
const PORT_START_X = -0.66;
const PORT_GAP = 0.05;

// GLB assets are authored in metres, Z-up with the front facing -Y. We rotate
// -90° around X, which makes them Y-up with the front facing +Z. MODEL_DIMS is
// only a synchronous estimate for slot packing; the real placement always
// measures the loaded clone with THREE.Box3.
type ModelDims = { w: number; h: number; d: number };
const MODEL_DIMS: Record<string, ModelDims> = {
  'dell_poweredge_r760.glb': { w: 0.519, h: 0.177, d: 0.764 },
  'dell_poweredge_r960.glb': { w: 0.519, h: 0.352, d: 0.764 },
  'dell_poweredge_xe9680_gpu.glb': { w: 0.519, h: 0.352, d: 0.764 },
  'hpe_proliant_dl380.glb': { w: 0.519, h: 0.177, d: 0.764 },
  'lenovo_thinksystem_sr650.glb': { w: 0.519, h: 0.177, d: 0.764 },
  'supermicro_superserver.glb': { w: 0.519, h: 0.177, d: 0.764 },
  'router_enterprise.glb': { w: 0.482, h: 0.068, d: 0.354 },
  'switch_48port.glb': { w: 0.482, h: 0.046, d: 0.285 },
  'olt_gpon_16port.glb': { w: 0.482, h: 0.09, d: 0.384 },
  'tower_server_generic.glb': { w: 0.485, h: 0.785, d: 0.553 },
  'patch_panel_24port.glb': { w: 0.482, h: 0.044, d: 0.089 },
};

const FILLER_FILES = [
  'dell_poweredge_r760.glb',
  'hpe_proliant_dl380.glb',
  'lenovo_thinksystem_sr650.glb',
  'supermicro_superserver.glb',
  'dell_poweredge_r960.glb',
  'dell_poweredge_xe9680_gpu.glb',
];

const KIND_MODEL: Partial<Record<DeviceKind, string>> = {
  router: 'router_enterprise.glb',
  switch: 'switch_48port.glb',
  olt: 'olt_gpon_16port.glb',
  server: 'dell_poweredge_r760.glb',
  pc: 'tower_server_generic.glb',
};

type Fit = { sx: number; sy: number; sz: number; width: number; height: number; depth: number };

function fitDims(dims: ModelDims, maxWidth: number, maxHeight: number, maxDepth: number): Fit {
  let s = maxWidth / dims.w;
  if (Number.isFinite(maxHeight) && dims.h * s > maxHeight) s = maxHeight / dims.h;
  const sz = Math.min(s, maxDepth / dims.d);
  return { sx: s, sy: s, sz, width: dims.w * s, height: dims.h * s, depth: dims.d * sz };
}

function planFit(file: string, maxWidth: number, maxHeight: number, maxDepth: number): Fit {
  return fitDims(MODEL_DIMS[file] ?? { w: 1, h: 1, d: 1 }, maxWidth, maxHeight, maxDepth);
}

// The patch panel keeps its full rack width but may be squashed vertically to
// fit the free gap between the top device and the ToR switch.
function fitPanel(dims: ModelDims, maxWidth: number, maxHeight: number, maxDepth: number): Fit {
  const base = fitDims(dims, maxWidth, Infinity, maxDepth);
  const sy = Math.min(base.sy, maxHeight / dims.h);
  return { ...base, sy, height: dims.h * sy };
}

function measureDims(template: THREE.Group): ModelDims {
  template.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
  return {
    w: Math.max(size.x, 1e-4),
    h: Math.max(size.z, 1e-4),
    d: Math.max(size.y, 1e-4),
  };
}

function placeAsset(template: THREE.Group, fit: Fit, x: number, yBottom: number, zCenter: number, yaw: number): THREE.Group {
  const holder = new THREE.Group();
  const model = template.clone(true);
  model.rotation.x = -Math.PI / 2;
  holder.add(model);
  holder.scale.set(fit.sx, fit.sy, fit.sz);
  holder.rotation.y = yaw;
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  holder.position.set(
    x - (box.min.x + box.max.x) / 2,
    yBottom - box.min.y,
    zCenter - (box.min.z + box.max.z) / 2,
  );
  holder.updateMatrixWorld(true);
  return holder;
}

// Filler rack units come from a handful of GLB servers. Their natural scaled
// height is clamped so every rack fits 7–9 visible units between the floor and
// the rack cap without any unit ever poking through the top.
function fillerFit(dims: ModelDims): Fit {
  const base = fitDims(dims, 1.66, Infinity, 0.78);
  const height = Math.min(FILLER_MAX_H, Math.max(FILLER_MIN_H, base.height));
  return { ...base, sy: height / dims.h, height };
}

// WORLD LAYOUT CONSTANTS
const NOC_POS = { x: 0, z: 10 };
const POWER_PANEL_CENTER = { x: 10.4, z: 12.72 };
const FLOOR_Y = 0;
const EYE = 1.6;
const RACK_COORDS = allRacks();
const STORAGE_RACKS = [
  { x: -13.3, z: 13.68 },
  { x: -11.2, z: 13.68 },
  { x: -14.68, z: 8.2 },
];
const FILLER_MIN_H = 0.3;
const FILLER_MAX_H = 0.62;

// Cabinet front is local +Z. These vectors express that front and the local +X
// axis in world space after the rack's yaw rotation.
function frontDir(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
}
function rightDir(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
}

const HERO_RACK = RACK_COORDS[NOC_RACK];
const HERO_FRONT_POSITION = new THREE.Vector3(HERO_RACK.rx, NOC_HERO_Y, HERO_RACK.rz)
  .addScaledVector(frontDir(HERO_RACK.yaw), RACK_D / 2 + 0.04);

let placementWarningLogged = false;

function portOffset(kind: DeviceKind, index: number, rowY: number): { x: number; y: number; z: number } {
  const [w] = PORT_DIMS[KIND_SPEC[kind].portStyle];
  return { x: PORT_START_X + index * (w + PORT_GAP), y: rowY, z: 0 };
}

type PerforationTextures = { color: THREE.CanvasTexture; alpha: THREE.CanvasTexture };

function makePerforationTextures(): PerforationTextures {
  const w = 128, h = 256;
  const colorCanvas = document.createElement('canvas');
  const alphaCanvas = document.createElement('canvas');
  colorCanvas.width = alphaCanvas.width = w;
  colorCanvas.height = alphaCanvas.height = h;
  const cc = colorCanvas.getContext('2d')!;
  const ac = alphaCanvas.getContext('2d')!;
  cc.fillStyle = '#1a2027';
  cc.fillRect(0, 0, w, h);
  ac.fillStyle = '#ffffff';
  ac.fillRect(0, 0, w, h);
  const step = 8, radius = 3.1;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      cc.fillStyle = '#05080b';
      cc.beginPath(); cc.arc(x, y, radius, 0, Math.PI * 2); cc.fill();
      ac.fillStyle = '#000000';
      ac.beginPath(); ac.arc(x, y, radius, 0, Math.PI * 2); ac.fill();
    }
  }
  const color = new THREE.CanvasTexture(colorCanvas);
  const alpha = new THREE.CanvasTexture(alphaCanvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = color.wrapT = THREE.ClampToEdgeWrapping;
  alpha.wrapS = alpha.wrapT = THREE.ClampToEdgeWrapping;
  return { color, alpha };
}

const DOOR_OPEN_ANGLE = -105 * Math.PI / 180;
const DOOR_TOGGLE_SPEED = 10;

type RackDoorRef = { rackKey: string; doorGroup: THREE.Group };
type RackBuild = { group: THREE.Group; doorGroup: THREE.Group };

type RackMaterials = {
  metal: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  outer: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  handle: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  cable: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  door: THREE.MeshStandardMaterial;
};

function makeRackClosed(rx: number, rz: number, yaw: number, m: RackMaterials): RackBuild {
  const g = new THREE.Group();
  g.position.set(rx, 0, rz);
  g.rotation.y = yaw;
  const H = RACK_H, W = RACK_W, D = RACK_D;
  const xl = -W / 2, xr = W / 2;
  const frontZ = D / 2;
  const backZ = -D / 2;

  // Four corner posts plus top/bottom frames.
  for (const [px, pz] of [[xl + 0.04, frontZ - 0.04], [xr - 0.04, frontZ - 0.04], [xl + 0.04, backZ + 0.04], [xr - 0.04, backZ + 0.04]] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, H, 0.07), m.metal);
    post.position.set(px, H / 2, pz);
    g.add(post);
  }
  for (const y of [0.05, H - 0.05]) {
    for (const pz of [frontZ - 0.04, backZ + 0.04]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, 0.08), m.metal);
      beam.position.set(0, y, pz);
      g.add(beam);
    }
    for (const px of [xl + 0.04, xr - 0.04]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, D), m.metal);
      beam.position.set(px, y, 0);
      g.add(beam);
    }
  }

  // Solid side panels: cabinet is fully enclosed left/right.
  const sideOuter = new THREE.Mesh(new THREE.BoxGeometry(0.035, H - 0.22, D - 0.16), m.outer);
  sideOuter.position.set(xl + 0.06, H / 2, 0);
  g.add(sideOuter);
  const sideInner = new THREE.Mesh(new THREE.BoxGeometry(0.035, H - 0.22, D - 0.16), m.panel);
  sideInner.position.set(xr - 0.06, H / 2, 0);
  g.add(sideInner);

  // Roof + two cable-entry cut-outs (dark recessed boxes).
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, D), m.metal);
  roof.position.set(0, H - 0.01, 0);
  g.add(roof);
  for (const hx of [-0.42, 0.42]) {
    const hole = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.26), m.cable);
    hole.position.set(hx, H + 0.002, -0.12);
    g.add(hole);
  }

  // Rack floor and four feet.
  const rackFloor = new THREE.Mesh(new THREE.BoxGeometry(W - 0.16, 0.04, D - 0.16), m.floor);
  rackFloor.position.set(0, 0.07, 0);
  g.add(rackFloor);
  for (const fx of [xl + 0.14, xr - 0.14]) {
    for (const fz of [frontZ - 0.14, backZ + 0.14]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.17), m.dark);
      foot.position.set(fx, -0.03, fz);
      g.add(foot);
    }
  }

  const doorGroup = new THREE.Group();
  doorGroup.position.set(-0.85, 0, frontZ);
  g.add(doorGroup);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 5.2), m.door);
  door.position.set(0.85, 2.7, 0);
  doorGroup.add(door);
  for (const fx of [-0.87, 0.87]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 5.3, 0.04), m.frame);
    jamb.position.set(fx, 2.7, frontZ + 0.01);
    g.add(jamb);
  }
  for (const fy of [0.07, 5.33]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.04), m.frame);
    rail.position.set(0, fy, frontZ + 0.01);
    g.add(rail);
  }
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), m.handle);
  handle.position.set(1.57, 2.62, 0.05);
  doorGroup.add(handle);
  for (const hy of [1.25, 4.15]) {
    const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.04), m.handle);
    hinge.position.set(-0.845, hy, frontZ + 0.035);
    g.add(hinge);
  }
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.13, 0.025), m.plate);
  label.position.set(0, 5.43, frontZ - 0.02);
  g.add(label);

  // Solid rear door (opposite the aisle).
  const rear = new THREE.Mesh(new THREE.BoxGeometry(W - 0.12, H - 0.22, 0.035), m.dark);
  rear.position.set(0, H / 2, backZ + 0.02);
  g.add(rear);

  // Top cable entry: one dark opening with a faint cold glow.
  const entry = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 16), m.cable);
  entry.position.set(0, H + 0.005, 0.22);
  g.add(entry);
  const entryGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 16), m.glow);
  entryGlow.position.set(0, H + 0.024, 0.22);
  g.add(entryGlow);

  // Base glow strips on both sides of the aisle-facing mouth.
  for (const gx of [-0.78, 0.78]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.045), m.glow);
    strip.position.set(gx, 0.03, frontZ + 0.01);
    g.add(strip);
  }

  return { group: g, doorGroup };
}

function addPort(group: THREE.Group, x: number, y: number, style: PortStyle, z: number, status: DeviceStatus): void {
  const [w, h] = PORT_DIMS[style];
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.28, metalness: 0.4 });
  const recess = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), darkMat);
  recess.position.set(x, y, z);
  group.add(recess);
  const active = status === 'up';
  const c = status === 'error' ? 0xef4444 : active ? 0x2dd45a : 0x293039;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 7, 7), new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c), emissiveIntensity: active || status === 'error' ? 0.9 : 0.1 }));
  led.position.set(x, y + h / 2 + 0.028, z + 0.006);
  group.add(led);
}

function addDriveCaddy(group: THREE.Group, x: number, y: number, w: number, h: number, z: number, status: DeviceStatus, metalMat: THREE.MeshStandardMaterial, darkMat: THREE.MeshStandardMaterial): void {
  const tray = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), metalMat);
  tray.position.set(x, y, z + 0.004);
  group.add(tray);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.6, 0.016), darkMat);
  handle.position.set(x - w / 2 + 0.05, y, z + 0.02);
  group.add(handle);
  const c = status === 'error' ? 0xef4444 : status === 'up' ? 0x22c55e : 0x3a424c;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 7, 7), new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c), emissiveIntensity: status === 'idle' ? 0.1 : 0.8 }));
  led.position.set(x + w / 2 - 0.04, y + h / 2 - 0.05, z + 0.02);
  group.add(led);
}

function addFrontPanel(group: THREE.Group, spec: KindSpec, status: DeviceStatus): void {
  const frontZ = spec.depth / 2;
  const faceMat = new THREE.MeshStandardMaterial({ color: spec.face, roughness: 0.42, metalness: 0.1 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: spec.bezel, roughness: 0.55, metalness: 0.28 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.28, metalness: 0.4 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xb9c1ca, roughness: 0.3, metalness: 0.85 });
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.72, spec.height, 0.014), bezelMat);
  bezel.position.set(0, 0, frontZ + 0.006);
  group.add(bezel);
  const face = new THREE.Mesh(new THREE.BoxGeometry(1.62, spec.height - 0.1, 0.012), faceMat);
  face.position.set(0, 0, frontZ + 0.014);
  group.add(face);
  const earMat = new THREE.MeshStandardMaterial({ color: 0x3a424c, roughness: 0.4, metalness: 0.7 });
  for (const ex of [-0.84, 0.84]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.05, spec.height - 0.04, 0.012), earMat);
    ear.position.set(ex, 0, frontZ + 0.024);
    group.add(ear);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.01), metalMat);
  plate.position.set(-0.6, spec.height / 2 - 0.1, frontZ + 0.02);
  group.add(plate);
  const itemZ = frontZ + 0.022;
  if (spec.drives) {
    const dw = 0.3, dh = 0.4;
    const totalW = spec.drives * dw + (spec.drives - 1) * 0.03;
    let dx = -totalW / 2 + dw / 2;
    const dy = spec.height / 2 - 0.24;
    for (let i = 0; i < spec.drives; i++) {
      addDriveCaddy(group, dx, dy, dw, dh, itemZ, status, metalMat, darkMat);
      dx += dw + 0.03;
    }
  }
  const ledCount = spec.leds ?? 1;
  for (let i = 0; i < ledCount; i++) {
    const on = status === 'up' || (status === 'idle' && i === 0);
    const c = status === 'error' ? 0xef4444 : on ? 0x22c55e : 0x333b46;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c), emissiveIntensity: on || status === 'error' ? 0.9 : 0.1 }));
    led.position.set(0.72, spec.height / 2 - 0.13 - i * 0.065, itemZ + 0.004);
    group.add(led);
  }
  if (spec.lcd) {
    const lcd = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.012), new THREE.MeshStandardMaterial({ color: 0x07121f, emissive: new THREE.Color(0x25d366), emissiveIntensity: 0.35, roughness: 0.3 }));
    lcd.position.set(0.18, spec.height / 2 - 0.17, itemZ + 0.002);
    group.add(lcd);
  }
}

const STATUS_LABEL: Record<DeviceStatus, string> = { up: 'Online', idle: 'Idle', error: 'Error' };

function maintenanceActionIdentity(action: MaintenanceAction): string {
  return 'linkId' in action ? `${action.type}:${action.linkId}` : `${action.type}:${action.id}`;
}

function makeLabel(text: string, highlighted: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = '600 52px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = highlighted ? '#2563eb' : '#334155';
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
}

type HeroLcdVisual = { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; view: HeroLcdView };

function drawHeroLcd(visual: HeroLcdVisual, data: HeroLcdData): void {
  const ctx = visual.ctx;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#071a26');
  gradient.addColorStop(1, '#031019');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(67, 232, 255, 0.08)';
  ctx.fillRect(0, 0, width, 22);
  ctx.strokeStyle = 'rgba(77, 220, 245, 0.16)';
  ctx.lineWidth = 1;
  for (let y = 0; y < height; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.font = '600 13px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#8cf7ff';
  heroLcdLines(visual.view, data).forEach((line, index) => {
    ctx.fillText(line, 10, 17 + index * 31);
  });
  visual.tex.needsUpdate = true;
}

type HeroBuild = {
  group: THREE.Group;
  lcd: HeroLcdVisual;
  lcdMesh: THREE.Mesh;
  hitMeshes: THREE.Mesh[];
  usrLed: THREE.Mesh;
};

function makeHeroCcr1072(data: HeroLcdData, view: HeroLcdView): HeroBuild {
  const group = new THREE.Group();
  const height = HERO_KIND_SPEC.height;
  const depth = HERO_KIND_SPEC.depth;
  const centerY = height / 2;
  const frontZ = depth / 2;
  const itemZ = frontZ + 0.033;

  const bodyMat = new THREE.MeshStandardMaterial({ color: HERO_KIND_SPEC.color, roughness: 0.36, metalness: 0.58 });
  const faceMat = new THREE.MeshStandardMaterial({ color: HERO_KIND_SPEC.face, roughness: 0.4, metalness: 0.42 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: HERO_KIND_SPEC.bezel, roughness: 0.48, metalness: 0.52 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xaab4be, roughness: 0.28, metalness: 0.88 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x070a0d, roughness: 0.3, metalness: 0.38 });
  const claspMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.42, metalness: 0.16 });
  const lcdFrameMat = new THREE.MeshStandardMaterial({ color: 0x080d12, roughness: 0.34, metalness: 0.68, emissive: 0x0a3440, emissiveIntensity: 0.3 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.72, height, depth), bodyMat);
  body.position.y = centerY;
  group.add(body);

  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.235, 0.03), bezelMat);
  bezel.position.set(0, centerY, frontZ + 0.006);
  group.add(bezel);

  const face = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.205, 0.012), faceMat);
  face.position.set(0, centerY, frontZ + 0.022);
  group.add(face);

  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 512;
  nameCanvas.height = 96;
  const nameCtx = nameCanvas.getContext('2d')!;
  nameCtx.fillStyle = '#11171d';
  nameCtx.fillRect(0, 0, 512, 96);
  nameCtx.strokeStyle = '#52616f';
  nameCtx.lineWidth = 4;
  nameCtx.strokeRect(3, 3, 506, 90);
  nameCtx.fillStyle = '#dbe7f0';
  nameCtx.font = '600 27px system-ui, sans-serif';
  nameCtx.textAlign = 'center';
  nameCtx.textBaseline = 'middle';
  nameCtx.fillText('CCR1072-1G-8S+', 256, 27);
  nameCtx.fillStyle = '#43d6c4';
  nameCtx.font = 'italic 700 34px system-ui, sans-serif';
  nameCtx.fillText('MikroTik', 256, 68);
  nameCtx.strokeStyle = '#43d6c4';
  nameCtx.lineWidth = 5;
  nameCtx.beginPath();
  nameCtx.moveTo(58, 77);
  nameCtx.lineTo(78, 20);
  nameCtx.moveTo(72, 77);
  nameCtx.lineTo(92, 20);
  nameCtx.stroke();
  const nameTex = new THREE.CanvasTexture(nameCanvas);
  nameTex.colorSpace = THREE.SRGBColorSpace;
  const nameplate = new THREE.Mesh(new THREE.PlaneGeometry(0.39, 0.052), new THREE.MeshBasicMaterial({ map: nameTex }));
  nameplate.position.set(-0.52, 0.028, frontZ + 0.023);
  group.add(nameplate);

  const lcdCanvas = document.createElement('canvas');
  lcdCanvas.width = 256;
  lcdCanvas.height = 144;
  const lcdCtx = lcdCanvas.getContext('2d')!;
  const lcdTex = new THREE.CanvasTexture(lcdCanvas);
  lcdTex.colorSpace = THREE.SRGBColorSpace;
  const lcdVisual: HeroLcdVisual = { ctx: lcdCtx, tex: lcdTex, view };
  drawHeroLcd(lcdVisual, data);

  const lcdFrame = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.215, 0.024), lcdFrameMat);
  lcdFrame.position.set(-0.52, 0.16, itemZ);
  group.add(lcdFrame);
  const lcdMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.19),
    new THREE.MeshStandardMaterial({
      map: lcdTex,
      emissive: 0xffffff,
      emissiveMap: lcdTex,
      emissiveIntensity: 0.58,
      roughness: 0.28,
      metalness: 0.04,
    }),
  );
  lcdMesh.position.set(-0.52, 0.16, itemZ + 0.014);
  lcdMesh.userData.heroLcd = true;
  lcdMesh.userData.label = 'CCR1072-1G-8S+ LCD';
  group.add(lcdMesh);

  for (let index = 0; index < 8; index++) {
    const x = -0.25 + index * 0.085;
    const cage = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.022), metalMat);
    cage.position.set(x, 0.13, itemZ);
    group.add(cage);
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.034, 0.012), claspMat);
    clasp.position.set(x + 0.019, 0.13, itemZ + 0.018);
    group.add(clasp);
  }

  const rj45 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.028), darkMat);
  rj45.position.set(0.49, 0.13, itemZ);
  group.add(rj45);
  const rj45Notch = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.03), metalMat);
  rj45Notch.position.set(0.49, 0.153, itemZ + 0.006);
  group.add(rj45Notch);
  const usb = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.022, 0.016), darkMat);
  usb.position.set(0.66, 0.13, itemZ);
  group.add(usb);
  const serial = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.035, 0.018), metalMat);
  serial.position.set(0.79, 0.13, itemZ);
  group.add(serial);
  const serialCore = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.022, 0.02), darkMat);
  serialCore.position.set(0.79, 0.13, itemZ + 0.006);
  group.add(serialCore);

  const pwrLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.35 }),
  );
  pwrLed.position.set(-0.79, 0.18, itemZ + 0.004);
  group.add(pwrLed);
  const usrLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1 }),
  );
  usrLed.position.set(-0.79, 0.09, itemZ + 0.004);
  group.add(usrLed);

  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(1.72, height, depth),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
  );
  hitbox.position.y = centerY;
  hitbox.userData.heroTerminal = true;
  hitbox.userData.label = 'CCR1072-1G-8S+';
  hitbox.userData.baseColor = HERO_KIND_SPEC.color;
  hitbox.userData.hoverColor = new THREE.Color(HERO_KIND_SPEC.color).offsetHSL(0, 0, 0.18).getHex();
  group.add(hitbox);

  return { group, lcd: lcdVisual, lcdMesh, hitMeshes: [hitbox, lcdMesh], usrLed };
}

function disposeGroup(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Sprite || child instanceof THREE.Line) {
      // GLB geometries/materials are shared by every clone (and by the loader
      // cache) — disposing them here would break future rebuilds.
      if (child.userData.glbAsset) return;
      if (child.geometry && !geometries.has(child.geometry)) {
        geometries.add(child.geometry);
        child.geometry.dispose();
      }
      if (!child.material) return;
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach(m => {
        if (!m || materials.has(m)) return;
        materials.add(m);
        const anyMat = m as unknown as { map?: THREE.Texture; alphaMap?: THREE.Texture };
        if (anyMat.map) textures.add(anyMat.map);
        if (anyMat.alphaMap) textures.add(anyMat.alphaMap);
        m.dispose();
      });
    }
  });
  textures.forEach(t => t.dispose());
}

type FillerSlot = { file: string; fit: Fit; rx: number; y: number; rz: number; yaw: number; placeholder: THREE.Mesh };
type PendingLab = { file: string; maxHeight: number; visual: THREE.Group; group: THREE.Group; x: number; yBottom: number; zCenter: number; yaw: number };
type PendingPanel = { file: string; maxHeight: number; placeholder: THREE.Mesh; x: number; yBottom: number; zCenter: number; yaw: number };

type NearbyPrompt =
  | { key: string; label: string; kind: 'door'; rackKey: string }
  | { key: string; label: string; kind: 'maintenance'; action: MaintenanceAction }
  | { key: string; label: string; kind: 'storage'; pickup: Carrying }
  | { key: string; label: string; kind: 'nocPc' }
  | {
      key: string;
      label: string;
      kind: 'heroTerminal';
      doorRackKey: string;
      doorOpen: boolean;
      maintenanceAction: MaintenanceAction | null;
      maintenanceLabel: string | null;
      otherDoor: { rackKey: string; open: boolean; label: string } | null;
      otherMaintenanceAction: MaintenanceAction | null;
      otherMaintenanceLabel: string | null;
    }
  | { key: string; label: string; kind: 'powerPanel' };

type PowerBreakerVisual = { mesh: THREE.Mesh; aisle: Aisle; baseY: number };
type GensetVisual = { fan: THREE.Group; led: THREE.Mesh };

type Props = {
  devices: Device[];
  links: Link[];
  selectedId: string | null;
  linkStartId: string | null;
  onDeviceClick: (id: string) => void;
  onEmptyClick: () => void;
  room: 'dc' | 'noc' | 'power' | 'gudang';
  onRoomChange: (r: 'dc' | 'noc' | 'power' | 'gudang') => void;
  onScreenClick: (id: NocScreenId) => void;
  nocData: NocData;
  powerGrid: PowerGrid;
  carrying: Carrying | null;
  onCarry: (carrying: Carrying | null) => void;
  onMaintain: (action: MaintenanceAction) => void;
  removedLinks: ReadonlySet<string>;
  removedDevices: ReadonlySet<string>;
  pcOn: boolean;
  interactionLocked: boolean;
  onPowerOn: () => void;
  onPowerOff: () => void;
  onRemoteOps: () => void;
  onHeroTerminal: () => void;
  onOpenPowerPanel: () => void;
};

export default function Room3D({ devices, links, selectedId, linkStartId, onDeviceClick, onEmptyClick, room, onRoomChange, onScreenClick, nocData, powerGrid, carrying, onCarry, onMaintain, removedLinks, removedDevices, pcOn, interactionLocked, onPowerOn, onPowerOff, onRemoteOps, onHeroTerminal, onOpenPowerPanel }: Props) {
  const animatedTrafficRef = useRef<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; phase: number }[]>([]);
  const animatedLedsRef = useRef<{ mesh: THREE.Mesh; phase: number; base: number }[]>([]);
  const serverFanRefs = useRef<THREE.Group[]>([]);
  const airflowParticlesRef = useRef<THREE.Mesh[]>([]);
  const powerBreakerRefs = useRef<PowerBreakerVisual[]>([]);
  const gensetRefs = useRef<GensetVisual[]>([]);
  const emergencyLensRef = useRef<THREE.Mesh | null>(null);
  const heroHitMeshesRef = useRef<THREE.Mesh[]>([]);
  const heroLcdRef = useRef<HeroLcdVisual | null>(null);
  const heroLcdViewRef = useRef<HeroLcdView>('overview');
  const heroStartedAtRef = useRef(0);

  const hostRef = useRef<HTMLDivElement>(null);
  const staticGroupRef = useRef<THREE.Group | null>(null);
  const dynamicGroupRef = useRef<THREE.Group | null>(null);
  const deviceBodyRef = useRef<THREE.Mesh[]>([]);
  const doorRefsRef = useRef<RackDoorRef[]>([]);
  const openDoorsRef = useRef<Set<string>>(new Set());
  const [, setOpenDoorKeys] = useState<Set<string>>(() => new Set());
  const [nearbyPrompt, setNearbyPrompt] = useState<NearbyPrompt | null>(null);
  const nearbyPromptRef = useRef<NearbyPrompt | null>(null);
  const keysRef = useRef({ f: false, b: false, l: false, r: false });
  const fpRef = useRef<{ x: number; z: number; yaw: number; pitch: number } | null>(null);
  const clickRef = useRef(onDeviceClick);
  clickRef.current = onDeviceClick;
  const emptyRef = useRef(onEmptyClick);
  emptyRef.current = onEmptyClick;
  const screenMeshesRef = useRef<THREE.Mesh[]>([]);
  const nocMonitorPanesRef = useRef<THREE.Mesh[]>([]);
  const screenClickRef = useRef(onScreenClick);
  screenClickRef.current = onScreenClick;
  const roomChangeRef = useRef(onRoomChange);
  roomChangeRef.current = onRoomChange;
  const roomRef = useRef(room);
  roomRef.current = room;
  const previousRoomRef = useRef<typeof room | null>(null);
  const dataRef = useRef(nocData);
  dataRef.current = nocData;
  const powerGridRef = useRef(powerGrid);
  powerGridRef.current = powerGrid;
  const carryingRef = useRef(carrying);
  carryingRef.current = carrying;
  const removedLinksRef = useRef(removedLinks);
  removedLinksRef.current = removedLinks;
  const removedDevicesRef = useRef(removedDevices);
  removedDevicesRef.current = removedDevices;
  const onCarryRef = useRef(onCarry);
  onCarryRef.current = onCarry;
  const onMaintainRef = useRef(onMaintain);
  onMaintainRef.current = onMaintain;
  const pcOnRef = useRef(pcOn);
  pcOnRef.current = pcOn;
  const interactionLockedRef = useRef(interactionLocked);
  interactionLockedRef.current = interactionLocked;
  const onPowerOnRef = useRef(onPowerOn);
  onPowerOnRef.current = onPowerOn;
  const onPowerOffRef = useRef(onPowerOff);
  onPowerOffRef.current = onPowerOff;
  const onRemoteOpsRef = useRef(onRemoteOps);
  onRemoteOpsRef.current = onRemoteOps;
  const heroTerminalRef = useRef(onHeroTerminal);
  heroTerminalRef.current = onHeroTerminal;
  const onOpenPowerPanelRef = useRef(onOpenPowerPanel);
  onOpenPowerPanelRef.current = onOpenPowerPanel;
  const deviceRackKeysRef = useRef<Map<string, string>>(new Map());
  const toggleDoor = (key: string) => {
    const next = new Set(openDoorsRef.current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    openDoorsRef.current = next;
    setOpenDoorKeys(new Set(next));
    audio.play('door');
  };
  const runNearbyAction = () => {
    const prompt = nearbyPromptRef.current;
    if (!prompt) return;
    if (prompt.kind === 'door') toggleDoor(prompt.rackKey);
    else if (prompt.kind === 'maintenance') onMaintainRef.current(prompt.action);
    else if (prompt.kind === 'storage') onCarryRef.current(prompt.pickup);
    else if (prompt.kind === 'heroTerminal') heroTerminalRef.current();
    else if (prompt.kind === 'powerPanel') onOpenPowerPanelRef.current();
    else if (pcOnRef.current) onRemoteOpsRef.current();
    else onPowerOnRef.current();
  };
  const runNearbyActionRef = useRef(runNearbyAction);
  runNearbyActionRef.current = runNearbyAction;
  const cycleHeroLcd = () => {
    const visual = heroLcdRef.current;
    if (!visual) return;
    const view = nextHeroLcdView(visual.view);
    visual.view = view;
    heroLcdViewRef.current = view;
    const uptimeSeconds = heroStartedAtRef.current > 0
      ? Math.floor((performance.now() - heroStartedAtRef.current) / 1000)
      : 0;
    drawHeroLcd(visual, heroLcdData(dataRef.current.sim, uptimeSeconds));
  };
  const cycleHeroLcdRef = useRef(cycleHeroLcd);
  cycleHeroLcdRef.current = cycleHeroLcd;
  const setKey = (k: 'f' | 'b' | 'l' | 'r', v: boolean) => { keysRef.current[k] = v; };
  const resetView = () => {
    const f = fpRef.current;
    if (!f) return;
    if (roomRef.current === 'gudang') {
      f.x = -8.5; f.z = 10; f.yaw = -Math.PI / 2; f.pitch = 0.02;
      return;
    }
    if (roomRef.current === 'power') {
      f.x = 8.5; f.z = 10; f.yaw = Math.PI / 2; f.pitch = 0.02;
      return;
    }
    if (roomRef.current === 'noc') {
      f.x = 0; f.z = 7.4; f.yaw = Math.PI; f.pitch = 0.02;
      return;
    }
    f.x = 0; f.z = -3.2; f.yaw = -Math.PI / 2; f.pitch = 0.02;
  };

  useEffect(() => {
    const previousRoom = previousRoomRef.current;
    previousRoomRef.current = room;
    const f = fpRef.current;
    if (!f) return;
    if (room === 'noc') { f.x = 0; f.z = 7.4; f.yaw = Math.PI; f.pitch = 0.02; }
    else if (room === 'power') { f.x = 8.5; f.z = 10; f.yaw = Math.PI / 2; f.pitch = 0.02; }
    else if (room === 'gudang') { f.x = -8.5; f.z = 10; f.yaw = -Math.PI / 2; f.pitch = 0.02; }
    else { f.x = 0; f.z = -3.2; f.yaw = -Math.PI / 2; f.pitch = 0.02; }
    if (previousRoom !== null && previousRoom !== room) {
      audio.play('doorclose');
      audio.play('door', 0.5);
    } else {
      audio.play('door');
    }
    audio.setRoomMix(room);
  }, [room]);

  useEffect(() => {
    const { places } = planLabLayout(devices);
    const next = new Map<string, string>();
    for (const [deviceId, place] of places) {
      const rc = RACK_COORDS[place.rack];
      if (rc) next.set(deviceId, rackKey(rc.rx, rc.rz));
    }
    deviceRackKeysRef.current = next;
  }, [devices]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);
    scene.fog = new THREE.Fog(0x020617, 45, 180);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    const environmentTarget = pmrem.fromScene(roomEnvironment, 0.04);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    const listener = new THREE.AudioListener();
    camera.add(listener);
    audio.attach(listener);

    // --- GLOBAL LIGHTING ---
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(10, 22, 2);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    // Cover the whole DC hall (x[-18,18], z[-20,-8]); the light is the only
    // shadow caster, point lights stay shadow-free for mobile performance.
    dir.shadow.camera.left = -22;
    dir.shadow.camera.right = 22;
    dir.shadow.camera.top = 22;
    dir.shadow.camera.bottom = -22;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 60;
    dir.shadow.camera.updateProjectionMatrix();
    dir.shadow.bias = -0.0003;
    dir.shadow.normalBias = 0.02;
    dir.target.position.set(0, 0, -14);
    scene.add(dir.target);
    scene.add(dir);
    scene.add(new THREE.HemisphereLight(0x9db4d6, 0x1a2230, 0.55));

    const sGroup = new THREE.Group();
    scene.add(sGroup);
    staticGroupRef.current = sGroup;
    const dGroup = new THREE.Group();
    scene.add(dGroup);
    dynamicGroupRef.current = dGroup;

    const dcEmitter = audio.makeEmitter('dc');
    if (dcEmitter) { dcEmitter.position.set(0, 1.5, -14); scene.add(dcEmitter); }
    const nocEmitter = audio.makeEmitter('noc');
    if (nocEmitter) { nocEmitter.position.set(0, 1.5, 10); scene.add(nocEmitter); }

    const fp = { x: 0, z: -3.2, yaw: -Math.PI / 2, pitch: 0.02 };
    fpRef.current = fp;
    heroStartedAtRef.current = performance.now();

    const tooltip = document.createElement('div');
    tooltip.className = 'room-tooltip';
    tooltip.style.display = 'none';
    host.appendChild(tooltip);

    const resize = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    const ndc = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let dragging = false, moved = false, px = 0, py = 0;
    let activePointerId: number | null = null;
    let hovered: THREE.Mesh | null = null;
    const onDown = (e: PointerEvent) => {
      if (dragging || (e.pointerType === 'mouse' && e.button !== 0)) return;
      dragging = true; moved = false; activePointerId = e.pointerId; px = e.clientX; py = e.clientY;
      try { host.setPointerCapture(e.pointerId); } catch {}
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        if (e.pointerId !== activePointerId) return;
        const dx = e.clientX - px, dy = e.clientY - py;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        fp.yaw += dx * 0.004;
        fp.pitch = Math.max(-1.3, Math.min(1.3, fp.pitch - dy * 0.004));
        px = e.clientX; py = e.clientY;
        return;
      }
      const rect = host.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects([...deviceBodyRef.current, ...screenMeshesRef.current, ...heroHitMeshesRef.current], false);
      const m = hits.length ? hits[0].object as THREE.Mesh : null;
      if (m !== hovered) {
        if (hovered && !hovered.userData.heroLcd) (hovered.material as THREE.MeshStandardMaterial).color.set(hovered.userData.baseColor);
        hovered = m;
        if (hovered && !hovered.userData.heroLcd) (hovered.material as THREE.MeshStandardMaterial).color.set(hovered.userData.hoverColor);
      }
      if (hovered) {
        const hLabel = (hovered.userData.label as string) ?? (hovered.userData.screen as string) ?? '';
        const hStatus = hovered.userData.status as DeviceStatus | undefined;
        if (hovered.userData.heroLcd) tooltip.textContent = `${hLabel} — klik untuk ganti tampilan`;
        else if (hovered.userData.heroTerminal) tooltip.textContent = `${hLabel} — klik untuk buka terminal`;
        else tooltip.textContent = hStatus ? `${hLabel} · ${STATUS_LABEL[hStatus]}` : `${hLabel} — klik untuk buka monitor`;
        tooltip.style.left = `${e.clientX - rect.left + 14}px`;
        tooltip.style.top = `${e.clientY - rect.top + 14}px`;
        tooltip.style.display = 'block';
      } else {
        tooltip.style.display = 'none';
      }
      host.style.cursor = m ? 'pointer' : 'default';
    };
    const finishPointer = (e: PointerEvent, allowClick: boolean) => {
      if (!dragging || e.pointerId !== activePointerId) return;
      if (allowClick && !moved) {
        const rect = host.getBoundingClientRect();
        ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects([...deviceBodyRef.current, ...screenMeshesRef.current, ...heroHitMeshesRef.current], false);
        const hitObj = hits[0]?.object;
        if (hitObj?.userData.heroLcd) { audio.play('blip'); cycleHeroLcdRef.current(); }
        else if (hitObj?.userData.heroTerminal) { audio.play('click'); heroTerminalRef.current(); }
        else if (hitObj?.userData.screen) { audio.play('blip'); screenClickRef.current(hitObj.userData.screen as NocScreenId); }
        else if (hitObj?.userData.id) { audio.play('click'); clickRef.current(hitObj.userData.id as string); }
        else emptyRef.current();
      }
      const pointerId = activePointerId;
      dragging = false; moved = false; activePointerId = null;
      try { if (pointerId !== null && host.hasPointerCapture(pointerId)) host.releasePointerCapture(pointerId); } catch {}
    };
    const onUp = (e: PointerEvent) => finishPointer(e, true);
    const onCancel = (e: PointerEvent) => finishPointer(e, false);
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onCancel);
    host.addEventListener('contextmenu', (e) => e.preventDefault());

    const onKeyDown = (e: KeyboardEvent) => {
      if (interactionLockedRef.current) return;
      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': keysRef.current.f = true; break;
        case 's': case 'arrowdown': keysRef.current.b = true; break;
        case 'a': case 'arrowleft': keysRef.current.l = true; break;
        case 'd': case 'arrowright': keysRef.current.r = true; break;
        case 'e': {
          if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) break;
          const target = e.target as HTMLElement | null;
          if (target?.closest('input, textarea, select, [contenteditable="true"]')) break;
          runNearbyActionRef.current();
          break;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': keysRef.current.f = false; break;
        case 's': case 'arrowdown': keysRef.current.b = false; break;
        case 'a': case 'arrowleft': keysRef.current.l = false; break;
        case 'd': case 'arrowright': keysRef.current.r = false; break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    let raf = 0;
    let last = performance.now();
    let lastScreenDraw = -1000;
    let stepT = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = keysRef.current;
      if (interactionLockedRef.current) {
        k.f = false;
        k.b = false;
        k.l = false;
        k.r = false;
      }
      const speed = 3.4 * dt;
      // DC spawn keeps yaw=-PI/2 (layout convention); offset it so the camera
      // actually looks down -Z into aisle A, while NOC/Power keep their yaw.
      const viewYaw = roomRef.current === 'dc' ? fp.yaw + Math.PI / 2 : fp.yaw;
      const fx = Math.sin(viewYaw), fz = -Math.cos(viewYaw);
      const rx = Math.cos(viewYaw), rz = Math.sin(viewYaw);
      let mvx = 0, mvz = 0;
      if (k.f) { mvx += fx; mvz += fz; }
      if (k.b) { mvx -= fx; mvz -= fz; }
      if (k.l) { mvx -= rx; mvz -= rz; }
      if (k.r) { mvx += rx; mvz += rz; }
      const len = Math.hypot(mvx, mvz) || 1;
      fp.x += (mvx / len) * speed;
      fp.z += (mvz / len) * speed;
      fp.x = Math.max(-25, Math.min(25, fp.x));
      fp.z = Math.max(-35, Math.min(25, fp.z));
      if (k.f || k.b || k.l || k.r) {
        stepT += dt;
        if (stepT > 0.42) { stepT = 0; audio.play('step'); }
      } else stepT = 0.3;
      camera.position.set(fp.x, EYE, fp.z);
      camera.lookAt(fp.x + Math.sin(viewYaw) * Math.cos(fp.pitch), EYE + Math.sin(fp.pitch), fp.z - Math.cos(viewYaw) * Math.cos(fp.pitch));

      for (const pane of nocMonitorPanesRef.current) {
        const material = pane.material as THREE.MeshStandardMaterial;
        material.color.setHex(pcOnRef.current ? 0x67e8f9 : 0x08131f);
        material.emissive.setHex(pcOnRef.current ? 0x67e8f9 : 0x22d3ee);
        material.emissiveIntensity = pcOnRef.current ? 1.8 : 0.5;
      }

      let nextPrompt: NearbyPrompt | null = null;
      if (roomRef.current === 'dc') {
        const data = dataRef.current;
        const statuses = new Map(data.lab.devices.map(device => [device.id, deviceStatus(device, data.lab)]));
        const heroDoorKey = rackKey(HERO_RACK.rx, HERO_RACK.rz);
        let heroMaintenanceAction: MaintenanceAction | null = null;
        let nearestMaintenance: { action: MaintenanceAction; distance: number } | null = null;
        let nearestDoor: { rackKey: string; distance: number; open: boolean } | null = null;
        for (const rc of RACK_COORDS) {
          const front = frontDir(rc.yaw);
          const frontX = rc.rx + front.x * RACK_D / 2;
          const frontZ = rc.rz + front.z * RACK_D / 2;
          const distance = Math.hypot(frontX - fp.x, frontZ - fp.z);
          if (distance > 2.3) continue;
          const key = rackKey(rc.rx, rc.rz);
          const open = openDoorsRef.current.has(key);
          if (!nearestDoor || distance < nearestDoor.distance) nearestDoor = { rackKey: key, distance, open };
          if (!open) continue;
          const action = selectRackAction({
            rackKey: key,
            doorOpen: true,
            carrying: carryingRef.current,
            links: data.lab.links,
            devices: data.lab.devices,
            removedLinks: removedLinksRef.current,
            removedDevices: removedDevicesRef.current,
            deviceRackKeys: deviceRackKeysRef.current,
            statuses,
          });
          if (action && key === heroDoorKey) heroMaintenanceAction = action;
          if (action && (!nearestMaintenance || distance < nearestMaintenance.distance)) {
            nearestMaintenance = { action, distance };
          }
        }
        const heroDoorOpen = openDoorsRef.current.has(heroDoorKey);
        const heroDistance = Math.hypot(HERO_FRONT_POSITION.x - fp.x, HERO_FRONT_POSITION.z - fp.z);
        if (heroDistance <= 2.4) {
          const heroTargetId = heroMaintenanceAction
            ? ('linkId' in heroMaintenanceAction ? heroMaintenanceAction.linkId : heroMaintenanceAction.id)
            : 'none';
          const otherDoor = nearestDoor && nearestDoor.rackKey !== heroDoorKey ? nearestDoor : null;
          const otherDoorIndex = otherDoor
            ? RACK_COORDS.findIndex(rc => rackKey(rc.rx, rc.rz) === otherDoor.rackKey)
            : -1;
          const otherMaintenanceAction = nearestMaintenance && (
            !heroMaintenanceAction
            || maintenanceActionIdentity(nearestMaintenance.action) !== maintenanceActionIdentity(heroMaintenanceAction)
          )
            ? nearestMaintenance.action
            : null;
          const otherTargetId = otherMaintenanceAction
            ? ('linkId' in otherMaintenanceAction ? otherMaintenanceAction.linkId : otherMaintenanceAction.id)
            : 'none';
          nextPrompt = {
            key: `hero-ccr1072:${heroDoorOpen ? 'open' : 'closed'}:${heroMaintenanceAction?.type ?? 'none'}:${heroTargetId}:${otherDoor?.rackKey ?? 'none'}:${otherDoor?.open ? 'open' : 'closed'}:${otherMaintenanceAction?.type ?? 'none'}:${otherTargetId}`,
            label: 'Buka Terminal CCR1072',
            kind: 'heroTerminal',
            doorRackKey: heroDoorKey,
            doorOpen: heroDoorOpen,
            maintenanceAction: heroMaintenanceAction,
            maintenanceLabel: heroMaintenanceAction
              ? maintenanceActionLabel(heroMaintenanceAction, data.lab.devices, data.lab.links)
              : null,
            otherDoor: otherDoor
              ? {
                  rackKey: otherDoor.rackKey,
                  open: otherDoor.open,
                  label: `${otherDoor.open ? 'Tutup' : 'Buka'} Pintu Rak ${otherDoorIndex + 1}`,
                }
              : null,
            otherMaintenanceAction,
            otherMaintenanceLabel: otherMaintenanceAction
              ? maintenanceActionLabel(otherMaintenanceAction, data.lab.devices, data.lab.links)
              : null,
          };
        } else if (nearestMaintenance) {
          const action = nearestMaintenance.action;
          const targetId = 'linkId' in action ? action.linkId : action.id;
          nextPrompt = {
            key: `maintenance:${action.type}:${targetId}`,
            label: maintenanceActionLabel(action, data.lab.devices, data.lab.links),
            kind: 'maintenance',
            action,
          };
        } else if (nearestDoor) {
          nextPrompt = {
            key: `door:${nearestDoor.rackKey}:${nearestDoor.open ? 'open' : 'closed'}`,
            label: nearestDoor.open ? 'Tutup Pintu Rak' : 'Buka Pintu Rak',
            kind: 'door',
            rackKey: nearestDoor.rackKey,
          };
        }
      } else if (roomRef.current === 'noc') {
        const deskDistance = Math.hypot(NOC_POS.x - fp.x, NOC_POS.z - 1.2 - fp.z);
        if (deskDistance <= 2.4) {
          nextPrompt = {
            key: `noc-pc:${pcOnRef.current ? 'on' : 'off'}`,
            label: pcOnRef.current ? 'Remote Ops' : 'Nyalakan PC',
            kind: 'nocPc',
          };
        }
      } else if (roomRef.current === 'power') {
        const panelDistance = Math.hypot(POWER_PANEL_CENTER.x - fp.x, POWER_PANEL_CENTER.z - fp.z);
        if (panelDistance <= 2.4) {
          nextPrompt = {
            key: 'power-panel',
            label: 'Buka Panel Listrik',
            kind: 'powerPanel',
          };
        }
      } else if (roomRef.current === 'gudang') {
        const nearestStorage = STORAGE_RACKS
          .map(rack => ({ rack, distance: Math.hypot(rack.x - fp.x, rack.z - fp.z) }))
          .filter(item => item.distance <= 2.5)
          .sort((a, b) => a.distance - b.distance)[0];
        if (nearestStorage) {
          const pickup = selectStoragePickup({
            carrying: carryingRef.current,
            devices: dataRef.current.lab.devices,
            removedDevices: removedDevicesRef.current,
          });
          if (pickup) {
            nextPrompt = {
              key: `storage:${pickup.type}:${pickup.forDeviceId ?? 'patchcord'}`,
              label: `Ambil ${pickup.label}`,
              kind: 'storage',
              pickup,
            };
          }
        }
      }
      if (nearbyPromptRef.current?.key !== nextPrompt?.key) {
        nearbyPromptRef.current = nextPrompt;
        setNearbyPrompt(nextPrompt);
      }

      const doorLerp = 1 - Math.exp(-DOOR_TOGGLE_SPEED * dt);
      for (const door of doorRefsRef.current) {
        const target = openDoorsRef.current.has(door.rackKey) ? DOOR_OPEN_ANGLE : 0;
        door.doorGroup.rotation.y += (target - door.doorGroup.rotation.y) * doorLerp;
      }

      for (const item of animatedTrafficRef.current) {
        const loadFactor = 0.5 + 0.5 * Math.sin(now * 0.0005 + item.phase);
        const t = (now * (0.00015 + 0.0002 * loadFactor) + item.phase) % 1;
        item.mesh.position.copy(item.curve.getPoint(t));
      }
      for (const item of animatedLedsRef.current) {
        const pulse = 0.35 + (0.65 * (0.5 + 0.5 * Math.sin(now * 0.006 + item.phase)));
        const material = item.mesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = item.base * pulse;
      }
      for (const fan of serverFanRefs.current) fan.rotation.z += dt * 18;
      const grid = powerGridRef.current;
      for (const breaker of powerBreakerRefs.current) {
        const on = grid.breakers[breaker.aisle];
        const material = breaker.mesh.material as THREE.MeshStandardMaterial;
        const color = on ? 0x22c55e : 0xef4444;
        material.color.setHex(color);
        material.emissive.setHex(color);
        material.emissiveIntensity = on ? 1.4 : 0.85;
        breaker.mesh.rotation.x = on ? 0.35 : -0.35;
        breaker.mesh.position.y = breaker.baseY + (on ? 0.04 : -0.04);
      }
      for (const genset of gensetRefs.current) {
        if (grid.gensetOn) genset.fan.rotation.z += dt * 20;
        const ledMaterial = genset.led.material as THREE.MeshStandardMaterial;
        const ledColor = grid.gensetOn ? 0x22c55e : 0xef4444;
        ledMaterial.color.setHex(ledColor);
        ledMaterial.emissive.setHex(ledColor);
        ledMaterial.emissiveIntensity = grid.gensetOn ? 1.4 : 0.25;
      }
      const hasDarkAisle = AISLE_NAMES.some(aisle => !isAislePowered(grid, aisle));
      if (emergencyLensRef.current) {
        const emergencyMaterial = emergencyLensRef.current.material as THREE.MeshStandardMaterial;
        emergencyMaterial.emissiveIntensity = hasDarkAisle
          ? 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(now * 0.012))
          : 0.05;
      }
      for (const particle of airflowParticlesRef.current) {
        const phase = particle.userData.airPhase as number;
        const baseY = particle.userData.airBaseY as number;
        particle.position.y = baseY + Math.sin(now * 0.0012 + phase) * 0.12;
        particle.position.x += Math.sin(now * 0.0008 + phase) * dt * 0.035;
        if (particle.position.x > 4.5) particle.position.x = -4.5;
      }
      if (fp.z > 7.5 && roomRef.current === 'dc') roomChangeRef.current('noc');
      else if (fp.z < 4.5 && roomRef.current === 'noc') roomChangeRef.current('dc');
      else if (fp.x > 5.4 && roomRef.current === 'noc') roomChangeRef.current('power');
      else if (fp.x < 4.6 && roomRef.current === 'power') roomChangeRef.current('noc');
      else if (fp.x < -5.4 && roomRef.current === 'noc') roomChangeRef.current('gudang');
      else if (fp.x > -4.6 && roomRef.current === 'gudang') roomChangeRef.current('noc');
      if (now - lastScreenDraw > 500) {
        lastScreenDraw = now;
        const data = dataRef.current;
        const sim = simNetwork(data.lab);
        for (const sm of screenMeshesRef.current) {
          const res = sm.userData.texRes as { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture };
          drawScreen(sm.userData.screen as NocScreenId, res.ctx, res.ctx.canvas.width, res.ctx.canvas.height, { ...data, sim });
          res.tex.needsUpdate = true;
        }
        const heroLcd = heroLcdRef.current;
        if (heroLcd) {
          const uptimeSeconds = Math.floor((now - heroStartedAtRef.current) / 1000);
          drawHeroLcd(heroLcd, heroLcdData(sim, uptimeSeconds));
        }
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onCancel);
      host.removeChild(tooltip);
      camera.remove(listener);
      try { listener.gain.disconnect(); } catch {}
      audio.detach(listener);
      heroLcdRef.current?.tex.dispose();
      if (staticGroupRef.current) disposeGroup(staticGroupRef.current);
      if (dynamicGroupRef.current) disposeGroup(dynamicGroupRef.current);
      environmentTarget.dispose();
      roomEnvironment.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((m) => m.dispose());
      });
      renderer.dispose();
      host.removeChild(renderer.domElement);
      staticGroupRef.current = null;
      dynamicGroupRef.current = null;
      screenMeshesRef.current = [];
      doorRefsRef.current = [];
      nocMonitorPanesRef.current = [];
      powerBreakerRefs.current = [];
      gensetRefs.current = [];
      emergencyLensRef.current = null;
      heroLcdRef.current = null;
      heroHitMeshesRef.current = [];
      fpRef.current = null;
      nearbyPromptRef.current = null;
    };
  }, []);

  useEffect(() => {
    const sGroup = staticGroupRef.current;
    if (!sGroup) return;
    powerBreakerRefs.current = [];
    gensetRefs.current = [];
    emergencyLensRef.current = null;
    let cancelled = false;
    heroLcdRef.current?.tex.dispose();
    heroLcdRef.current = null;
    heroHitMeshesRef.current = [];
    disposeGroup(sGroup);
    while (sGroup.children.length) sGroup.remove(sGroup.children[0]);
    deviceBodyRef.current = [];
    doorRefsRef.current = [];
    nocMonitorPanesRef.current = [];
    const fillerSlots: FillerSlot[] = [];
    const pendingLab: PendingLab[] = [];
    const pendingPanel: PendingPanel[] = [];
    const pendingStorage: { file: string; parent: THREE.Group; x: number; yBottom: number; z: number; maxWidth: number; maxHeight: number; maxDepth: number }[] = [];
    const pos = new Map<string, THREE.Vector3>();
    const portLocal = new Map<string, THREE.Vector3>();

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95, side: THREE.DoubleSide });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8, metalness: 0.1 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 80), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; floor.receiveShadow = true; sGroup.add(floor);

    // --- NOC ROOM: enclosed room, video wall, operator desk ---
    const nocX = NOC_POS.x, nocZ = NOC_POS.z;
    const nocFloor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x14202e, roughness: 0.85 }));
    nocFloor.rotation.x = -Math.PI / 2; nocFloor.position.set(nocX, 0.005, nocZ); sGroup.add(nocFloor);
    const nocCeil = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x111823, roughness: 0.95, side: THREE.DoubleSide }));
    nocCeil.rotation.x = Math.PI / 2; nocCeil.position.set(nocX, 5, nocZ); sGroup.add(nocCeil);
    const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat);
    wallBack.position.set(nocX, 2.5, nocZ + 4); sGroup.add(wallBack);
    const wallLa = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5), wallMat);
    wallLa.rotation.y = Math.PI / 2; wallLa.position.set(nocX - 4, 2.5, 7.1); sGroup.add(wallLa);
    const wallLb = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 5), wallMat);
    wallLb.rotation.y = Math.PI / 2; wallLb.position.set(nocX - 4, 2.5, 11.9); sGroup.add(wallLb);
    const nocDoorZ = 9;
    const wallRa = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5), wallMat);
    wallRa.rotation.y = -Math.PI / 2; wallRa.position.set(nocX + 4, 2.5, 7.1); sGroup.add(wallRa);
    const wallRb = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 5), wallMat);
    wallRb.rotation.y = -Math.PI / 2; wallRb.position.set(nocX + 4, 2.5, 11.9); sGroup.add(wallRb);
    const wallF1 = new THREE.Mesh(new THREE.PlaneGeometry(3, 5), wallMat);
    wallF1.position.set(nocX - 2.5, 2.5, nocZ - 4); sGroup.add(wallF1);
    const wallF2 = new THREE.Mesh(new THREE.PlaneGeometry(3, 5), wallMat);
    wallF2.position.set(nocX + 2.5, 2.5, nocZ - 4); sGroup.add(wallF2);
    const wallTop = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.6), wallMat);
    wallTop.position.set(nocX, 4.2, nocZ - 4); sGroup.add(wallTop);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a4652, roughness: 0.4, metalness: 0.7 });
    for (const fx of [-1.06, 1.06]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.14), frameMat);
      jamb.position.set(nocX + fx, 1.3, nocZ - 4); sGroup.add(jamb);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.12, 0.14), frameMat);
    lintel.position.set(nocX, 2.66, nocZ - 4); sGroup.add(lintel);
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(2, 0.02, 0.6), new THREE.MeshStandardMaterial({ color: 0x0a2530, emissive: 0x22d3ee, emissiveIntensity: 1.1 }));
    threshold.position.set(nocX, 0.012, nocZ - 4); sGroup.add(threshold);
    for (const dz of [nocDoorZ - 0.86, nocDoorZ + 0.86]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.12), frameMat);
      jamb.position.set(nocX + 4, 1.3, dz); sGroup.add(jamb);
    }
    const eastLintel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 1.84), frameMat);
    eastLintel.position.set(nocX + 4, 2.66, nocDoorZ); sGroup.add(eastLintel);
    const eastThreshold = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 1.6), new THREE.MeshStandardMaterial({ color: 0x0a2530, emissive: 0x22d3ee, emissiveIntensity: 1.1 }));
    eastThreshold.position.set(nocX + 4, 0.012, nocDoorZ); sGroup.add(eastThreshold);
    for (const dz of [8.2, 9.8]) {
      const westJamb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.12), frameMat);
      westJamb.position.set(nocX - 4, 1.3, dz); sGroup.add(westJamb);
    }
    const westLintel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 1.84), frameMat);
    westLintel.position.set(nocX - 4, 2.66, nocDoorZ); sGroup.add(westLintel);
    const westThreshold = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 1.6), new THREE.MeshStandardMaterial({ color: 0x0a2530, emissive: 0x22d3ee, emissiveIntensity: 1.1 }));
    westThreshold.position.set(nocX - 4, 0.012, nocDoorZ); sGroup.add(westThreshold);
    const westCorridorFloor = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), new THREE.MeshStandardMaterial({ color: 0x1b2735, roughness: 0.85 }));
    westCorridorFloor.rotation.x = -Math.PI / 2; westCorridorFloor.position.set(-5.5, 0.006, nocDoorZ); sGroup.add(westCorridorFloor);
    const westCorridorCeil = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), new THREE.MeshStandardMaterial({ color: 0x0c121a, roughness: 0.95, side: THREE.DoubleSide }));
    westCorridorCeil.rotation.x = Math.PI / 2; westCorridorCeil.position.set(-5.5, 4.5, nocDoorZ); sGroup.add(westCorridorCeil);
    for (const cz of [8.2, 9.8]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(3, 5), wallMat);
      side.position.set(-5.5, 2.5, cz); sGroup.add(side);
    }
    const lightBar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: 0xf1f5f9, emissive: 0xe2e8f0, emissiveIntensity: 1.4 }));
    lightBar.position.set(nocX, 4.8, nocZ - 0.5); sGroup.add(lightBar);
    // video wall: 8 live screens wired to the wall
    const screenDefs: { id: NocScreenId; x: number; y: number; w: number; hh: number }[] = [
      { id: 'traffic', x: -3.2, y: 3.35, w: 1.44, hh: 1.05 },
      { id: 'bandwidth', x: -1.6, y: 3.35, w: 1.44, hh: 1.05 },
      { id: 'topology', x: 0, y: 3.35, w: 1.44, hh: 1.05 },
      { id: 'health', x: 1.6, y: 3.35, w: 1.44, hh: 1.05 },
      { id: 'power', x: 3.2, y: 3.35, w: 1.44, hh: 1.05 },
      { id: 'alerts', x: -2.6, y: 1.45, w: 2.4, hh: 1.3 },
      { id: 'dude', x: 0, y: 1.45, w: 2.4, hh: 1.3 },
      { id: 'devices', x: 2.6, y: 1.45, w: 2.4, hh: 1.3 },
    ];
    screenMeshesRef.current = [];
    for (const sd of screenDefs) {
      const bez = new THREE.Mesh(new THREE.BoxGeometry(sd.w + 0.12, sd.hh + 0.12, 0.07), frameMat);
      bez.position.set(nocX + sd.x, sd.y, nocZ + 3.92);
      sGroup.add(bez);
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = Math.round(512 * (sd.hh / sd.w));
      const ctx2d = cv.getContext('2d')!;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = -1;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(sd.w, sd.hh), new THREE.MeshBasicMaterial({ map: tex }));
      scr.position.set(nocX + sd.x, sd.y, nocZ + 3.86);
      scr.rotation.y = Math.PI;
      scr.userData.screen = sd.id;
      scr.userData.texRes = { ctx: ctx2d, tex };
      sGroup.add(scr);
      screenMeshesRef.current.push(scr);
    }
    // operator desk + monitors + chairs
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x2a323c, roughness: 0.6, metalness: 0.3 });
    const monMat = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.4, metalness: 0.5 });
    const scrMat = new THREE.MeshStandardMaterial({ color: 0x08131f, emissive: 0x22d3ee, emissiveIntensity: 0.5 });
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.07, 0.95), deskMat);
    deskTop.position.set(nocX, 0.76, nocZ - 0.5); sGroup.add(deskTop);
    for (const lx of [-1.7, 1.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.76, 0.8), deskMat);
      leg.position.set(nocX + lx, 0.38, nocZ - 0.5); sGroup.add(leg);
    }
    for (const mx of [-0.75, 0, 0.75]) {
      const mon = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.32, 0.04), monMat);
      mon.position.set(nocX + mx, 1.12, nocZ - 0.28); sGroup.add(mon);
      const pan = new THREE.Mesh(new THREE.PlaneGeometry(0.47, 0.27), scrMat);
      pan.position.set(nocX + mx, 1.12, nocZ - 0.255); pan.rotation.y = Math.PI; sGroup.add(pan);
      nocMonitorPanesRef.current.push(pan);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), monMat);
      stand.position.set(nocX + mx, 0.9, nocZ - 0.3); sGroup.add(stand);
    }
    for (const chx of [-0.55, 0.55]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.44), monMat);
      seat.position.set(nocX + chx, 0.48, nocZ - 1.55); sGroup.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.06), monMat);
      back.position.set(nocX + chx, 0.76, nocZ - 1.79); sGroup.add(back);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.05), monMat);
      post.position.set(nocX + chx, 0.24, nocZ - 1.55); sGroup.add(post);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.4), monMat);
      base.position.set(nocX + chx, 0.03, nocZ - 1.55); sGroup.add(base);
    }

    const gudangX0 = -15, gudangX1 = -7, gudangZ0 = 6, gudangZ1 = 14;
    const gudangCX = (gudangX0 + gudangX1) / 2, gudangCZ = (gudangZ0 + gudangZ1) / 2;
    const gudangFloorMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.92, metalness: 0.04 });
    const gudangCeilMat = new THREE.MeshStandardMaterial({ color: 0x10161e, roughness: 0.95, side: THREE.DoubleSide });
    const gudangFloor = new THREE.Mesh(new THREE.PlaneGeometry(gudangX1 - gudangX0, gudangZ1 - gudangZ0), gudangFloorMat);
    gudangFloor.rotation.x = -Math.PI / 2; gudangFloor.position.set(gudangCX, 0.007, gudangCZ); sGroup.add(gudangFloor);
    const gudangCeil = new THREE.Mesh(new THREE.PlaneGeometry(gudangX1 - gudangX0, gudangZ1 - gudangZ0), gudangCeilMat);
    gudangCeil.rotation.x = Math.PI / 2; gudangCeil.position.set(gudangCX, 4.5, gudangCZ); sGroup.add(gudangCeil);
    const gudangWallN = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat);
    gudangWallN.position.set(gudangCX, 2.5, gudangZ1); sGroup.add(gudangWallN);
    const gudangWallS = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat);
    gudangWallS.position.set(gudangCX, 2.5, gudangZ0); sGroup.add(gudangWallS);
    const gudangWallW = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat);
    gudangWallW.rotation.y = Math.PI / 2; gudangWallW.position.set(gudangX0, 2.5, gudangCZ); sGroup.add(gudangWallW);
    const gudangWallE1 = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5), wallMat);
    gudangWallE1.rotation.y = Math.PI / 2; gudangWallE1.position.set(gudangX1, 2.5, 7.1); sGroup.add(gudangWallE1);
    const gudangWallE2 = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 5), wallMat);
    gudangWallE2.rotation.y = Math.PI / 2; gudangWallE2.position.set(gudangX1, 2.5, 11.9); sGroup.add(gudangWallE2);
    for (const dz of [8.2, 9.8]) {
      const gudangJamb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.12), frameMat);
      gudangJamb.position.set(gudangX1, 1.3, dz); sGroup.add(gudangJamb);
    }
    const gudangLintel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 1.84), frameMat);
    gudangLintel.position.set(gudangX1, 2.66, 9); sGroup.add(gudangLintel);
    const gudangThreshold = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 1.6), new THREE.MeshStandardMaterial({ color: 0x0a2530, emissive: 0x22d3ee, emissiveIntensity: 1.1 }));
    gudangThreshold.position.set(gudangX1, 0.012, 9); sGroup.add(gudangThreshold);

    const gudangSignCanvas = document.createElement('canvas');
    gudangSignCanvas.width = 512; gudangSignCanvas.height = 128;
    const gudangSignCtx = gudangSignCanvas.getContext('2d')!;
    gudangSignCtx.fillStyle = '#0b1118'; gudangSignCtx.fillRect(0, 0, 512, 128);
    gudangSignCtx.strokeStyle = '#2dd4bf'; gudangSignCtx.lineWidth = 6; gudangSignCtx.strokeRect(6, 6, 500, 116);
    gudangSignCtx.fillStyle = '#f8fafc'; gudangSignCtx.font = 'bold 64px system-ui, sans-serif';
    gudangSignCtx.textAlign = 'center'; gudangSignCtx.textBaseline = 'middle'; gudangSignCtx.fillText('GUDANG', 256, 66);
    const gudangSignTex = new THREE.CanvasTexture(gudangSignCanvas);
    gudangSignTex.colorSpace = THREE.SRGBColorSpace;
    const gudangSignBoard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 1.6), new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.6, metalness: 0.3 }));
    gudangSignBoard.position.set(gudangX1 + 0.03, 3.4, 9); sGroup.add(gudangSignBoard);
    const gudangSignFace = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ map: gudangSignTex }));
    gudangSignFace.rotation.y = Math.PI / 2; gudangSignFace.position.set(gudangX1 + 0.065, 3.4, 9); sGroup.add(gudangSignFace);

    const storageFrameMat = new THREE.MeshStandardMaterial({ color: 0x4b5661, roughness: 0.42, metalness: 0.68 });
    const storageShelfMat = new THREE.MeshStandardMaterial({ color: 0x68737e, roughness: 0.48, metalness: 0.58 });
    const cardboardMat = new THREE.MeshStandardMaterial({ color: 0xa87845, roughness: 0.88, metalness: 0.02 });
    const orangeCableMat = new THREE.MeshStandardMaterial({ color: 0xf07b24, roughness: 0.58, metalness: 0.04 });
    const blueCableMat = new THREE.MeshStandardMaterial({ color: 0x2468b4, roughness: 0.58, metalness: 0.04 });
    const storageShelfYs = [0.12, 0.62, 1.12, 1.62];
    const makeStorageRack = (cx: number, cz: number, yaw: number): THREE.Group => {
      const rack = new THREE.Group();
      rack.position.set(cx, 0, cz);
      rack.rotation.y = yaw;
      for (const px of [-0.86, 0.86]) {
        for (const pz of [-0.21, 0.21]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2, 0.06), storageFrameMat);
          post.position.set(px, 1, pz);
          rack.add(post);
        }
      }
      for (const shelfY of storageShelfYs) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), storageShelfMat);
        shelf.position.set(0, shelfY, 0);
        rack.add(shelf);
      }
      const topBrace = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.05), storageFrameMat);
      topBrace.position.set(0, 1.97, -0.21);
      rack.add(topBrace);
      sGroup.add(rack);
      return rack;
    };
    const makeCardboardBox = (
      parent: THREE.Group,
      text: string,
      x: number,
      yBottom: number,
      z: number,
      width: number,
      height: number,
      depth: number,
    ) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), cardboardMat);
      body.position.set(x, yBottom + height / 2, z);
      parent.add(body);
      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = 512; labelCanvas.height = 256;
      const labelCtx = labelCanvas.getContext('2d')!;
      labelCtx.fillStyle = '#c4945e'; labelCtx.fillRect(0, 0, 512, 256);
      labelCtx.strokeStyle = '#3c2a1b'; labelCtx.lineWidth = 10; labelCtx.strokeRect(8, 8, 496, 240);
      labelCtx.fillStyle = '#17120e'; labelCtx.font = `bold ${text.length > 12 ? 38 : 48}px system-ui, sans-serif`;
      labelCtx.textAlign = 'center'; labelCtx.textBaseline = 'middle'; labelCtx.fillText(text, 256, 132);
      const labelTex = new THREE.CanvasTexture(labelCanvas);
      labelTex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width * 0.84, 0.66), Math.min(height * 0.58, 0.24)), new THREE.MeshBasicMaterial({ map: labelTex }));
      label.position.set(x, yBottom + height * 0.52, z + depth / 2 + 0.006);
      parent.add(label);
    };
    const addCableCoil = (parent: THREE.Group, x: number, yBottom: number, z: number, material: THREE.MeshStandardMaterial) => {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 8, 20), material);
      coil.position.set(x, yBottom + 0.23, z);
      parent.add(coil);
    };

    const gudangRackA = makeStorageRack(-13.3, 13.68, Math.PI);
    const gudangRackB = makeStorageRack(-11.2, 13.68, Math.PI);
    const gudangRackC = makeStorageRack(-14.68, 8.2, Math.PI / 2);
    pendingStorage.push({ file: 'router_enterprise.glb', parent: gudangRackA, x: -0.35, yBottom: 0.145, z: 0, maxWidth: 0.72, maxHeight: 0.2, maxDepth: 0.38 });
    pendingStorage.push({ file: 'switch_24port.glb', parent: gudangRackC, x: 0.35, yBottom: 0.145, z: 0, maxWidth: 0.72, maxHeight: 0.18, maxDepth: 0.38 });

    makeCardboardBox(gudangRackA, 'MIKROTIK CCR', -0.45, 0.645, 0, 0.58, 0.34, 0.36);
    makeCardboardBox(gudangRackA, 'MIKROTIK CCR', 0.35, 1.145, 0, 0.58, 0.34, 0.36);
    makeCardboardBox(gudangRackB, 'MIKROTIK CCR', -0.4, 0.645, 0, 0.58, 0.34, 0.36);
    makeCardboardBox(gudangRackB, 'PATCH CORD CAT6', 0.35, 1.145, 0, 0.52, 0.3, 0.34);
    makeCardboardBox(gudangRackC, 'PATCH CORD CAT6', -0.35, 0.645, 0, 0.52, 0.3, 0.34);
    makeCardboardBox(gudangRackC, 'UTP CAT6 305M', 0.35, 1.145, 0, 0.42, 0.25, 0.3);

    addCableCoil(gudangRackA, -0.5, 1.145, 0, orangeCableMat);
    addCableCoil(gudangRackA, 0, 1.645, 0, blueCableMat);
    addCableCoil(gudangRackB, 0, 1.645, 0, orangeCableMat);
    addCableCoil(gudangRackC, -0.55, 1.145, 0, blueCableMat);
    addCableCoil(gudangRackC, 0.25, 1.645, 0, orangeCableMat);
    addCableCoil(sGroup, -8.45, 0, 12.55, orangeCableMat);

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x755233, roughness: 0.88, metalness: 0.01 });
    const hookBoard = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.08), woodMat);
    hookBoard.position.set(-8.9, 2.75, 13.96);
    sGroup.add(hookBoard);
    const bundleColors = [0xef4444, 0xf59e0b, 0x22c55e, 0x3b82f6, 0x8b5cf6, 0xec4899];
    for (let i = 0; i < 6; i++) {
      const hookX = -9.48 + i * 0.23;
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.035), storageFrameMat);
      hook.position.set(hookX, 2.64, 13.9);
      sGroup.add(hook);
      const cordCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(hookX, 2.58, 13.88),
        new THREE.Vector3(hookX + (i % 2 ? 0.08 : -0.06), 2.18, 13.62),
        new THREE.Vector3(hookX + (i % 3 - 1) * 0.07, 1.62, 13.72),
      );
      const cord = new THREE.Mesh(new THREE.TubeGeometry(cordCurve, 10, 0.012, 5, false), new THREE.MeshStandardMaterial({ color: bundleColors[i], roughness: 0.58 }));
      sGroup.add(cord);
    }

    const toolboxRedMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.48, metalness: 0.2 });
    const toolbox = new THREE.Group();
    toolbox.position.set(-8.7, 0, 7.25);
    const toolboxBody = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.28, 0.42), toolboxRedMat);
    toolboxBody.position.y = 0.14;
    toolbox.add(toolboxBody);
    const toolboxLid = new THREE.Mesh(new THREE.BoxGeometry(0.67, 0.08, 0.44), toolboxRedMat);
    toolboxLid.position.y = 0.32;
    toolbox.add(toolboxLid);
    const toolboxHandle = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.16, 0.36, 0),
      new THREE.Vector3(0, 0.54, 0),
      new THREE.Vector3(0.16, 0.36, 0),
    ), 10, 0.025, 6, false), storageFrameMat);
    toolbox.add(toolboxHandle);
    sGroup.add(toolbox);

    for (const [bx, bz, bw, bh, bd] of [
      [-13.4, 6.65, 0.72, 0.48, 0.55],
      [-12.45, 6.75, 0.58, 0.4, 0.48],
      [-9.4, 13, 0.7, 0.5, 0.55],
    ] as const) {
      const floorBox = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), cardboardMat);
      floorBox.position.set(bx, bh / 2 + 0.007, bz);
      sGroup.add(floorBox);
    }

    const gudangLampMat = new THREE.MeshStandardMaterial({ color: 0xfff8ec, emissive: 0xfff2dd, emissiveIntensity: 1.35 });
    for (const lx of [-13, -9]) {
      const lampPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.45), gudangLampMat);
      lampPanel.rotation.x = Math.PI / 2;
      lampPanel.position.set(lx, 4.49, 10);
      sGroup.add(lampPanel);
      const lamp = new THREE.PointLight(0xfff2dd, 1.2, 10, 0);
      lamp.position.set(lx, 4.3, 10);
      sGroup.add(lamp);
    }

    // --- POWER ROOM: gensets, UPS bank, electrical panels, battery rack ---
    const powerX0 = 7, powerX1 = 15, powerZ0 = 5, powerZ1 = 13;
    const powerCX = (powerX0 + powerX1) / 2, powerCZ = (powerZ0 + powerZ1) / 2;
    const powerFloorMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.82, metalness: 0.08 });
    const powerCeilMat = new THREE.MeshStandardMaterial({ color: 0x0c121a, roughness: 0.95, side: THREE.DoubleSide });
    const corridorFloorMat = new THREE.MeshStandardMaterial({ color: 0x1b2735, roughness: 0.85 });
    const powerFloor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), powerFloorMat);
    powerFloor.rotation.x = -Math.PI / 2; powerFloor.position.set(powerCX, 0.006, powerCZ); sGroup.add(powerFloor);
    const powerCeil = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), powerCeilMat);
    powerCeil.rotation.x = Math.PI / 2; powerCeil.position.set(powerCX, 4.5, powerCZ); sGroup.add(powerCeil);
    const powerWallN = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat);
    powerWallN.position.set(powerCX, 2.5, powerZ0); sGroup.add(powerWallN);
    const powerWallS = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat);
    powerWallS.position.set(powerCX, 2.5, powerZ1); sGroup.add(powerWallS);
    const powerWallE = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat);
    powerWallE.rotation.y = -Math.PI / 2; powerWallE.position.set(powerX1, 2.5, powerCZ); sGroup.add(powerWallE);
    const powerWallWa = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5), wallMat);
    powerWallWa.rotation.y = -Math.PI / 2; powerWallWa.position.set(powerX0, 2.5, 6.6); sGroup.add(powerWallWa);
    const powerWallWb = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5), wallMat);
    powerWallWb.rotation.y = -Math.PI / 2; powerWallWb.position.set(powerX0, 2.5, 11.4); sGroup.add(powerWallWb);
    // corridor connecting NOC east doorway to the power room
    const corridorFloor = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), corridorFloorMat);
    corridorFloor.rotation.x = -Math.PI / 2; corridorFloor.position.set(5.5, 0.006, 9); sGroup.add(corridorFloor);
    const addCorridorCeilingPanel = (x0: number, x1: number, z0: number, z1: number) => {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), powerCeilMat);
      panel.rotation.x = Math.PI / 2;
      panel.position.set((x0 + x1) / 2, 4.5, (z0 + z1) / 2);
      sGroup.add(panel);
    };
    addCorridorCeilingPanel(4, 6.34, 8.2, 9.8);
    addCorridorCeilingPanel(6.66, 7, 8.2, 9.8);
    addCorridorCeilingPanel(6.34, 6.66, 8.2, 9.34);
    addCorridorCeilingPanel(6.34, 6.66, 9.66, 9.8);
    for (const cz of [8.2, 9.8]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(3, 5), wallMat);
      side.position.set(5.5, 2.5, cz); sGroup.add(side);
    }
    for (const dz of [nocDoorZ - 0.86, nocDoorZ + 0.86]) {
      const pJamb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.12), frameMat);
      pJamb.position.set(powerX0, 1.3, dz); sGroup.add(pJamb);
    }
    const pLintel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 1.84), frameMat);
    pLintel.position.set(powerX0, 2.66, nocDoorZ); sGroup.add(pLintel);
    const pThreshold = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 1.6), new THREE.MeshStandardMaterial({ color: 0x0a2530, emissive: 0x22d3ee, emissiveIntensity: 1.1 }));
    pThreshold.position.set(powerX0, 0.012, nocDoorZ); sGroup.add(pThreshold);

    // POWER ROOM sign above the west doorway (faces the corridor)
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 512; signCanvas.height = 128;
    const signCtx = signCanvas.getContext('2d')!;
    signCtx.fillStyle = '#0b1118'; signCtx.fillRect(0, 0, 512, 128);
    signCtx.strokeStyle = '#2dd4bf'; signCtx.lineWidth = 6; signCtx.strokeRect(6, 6, 500, 116);
    signCtx.fillStyle = '#f8fafc'; signCtx.font = 'bold 58px system-ui, sans-serif';
    signCtx.textAlign = 'center'; signCtx.textBaseline = 'middle'; signCtx.fillText('POWER ROOM', 256, 66);
    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 1.6), new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.6, metalness: 0.3 }));
    signBoard.position.set(powerX0 - 0.03, 3.4, nocDoorZ); sGroup.add(signBoard);
    const signFace = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ map: signTex }));
    signFace.rotation.y = -Math.PI / 2; signFace.position.set(powerX0 - 0.065, 3.4, nocDoorZ); sGroup.add(signFace);

    // Shared power-room materials
    const indYellowMat = new THREE.MeshStandardMaterial({ color: 0xd9a520, roughness: 0.55, metalness: 0.12 });
    const powerBlackMat = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.75, metalness: 0.25 });
    const altMat = new THREE.MeshStandardMaterial({ color: 0x8b95a1, roughness: 0.4, metalness: 0.75 });
    const upsMat = new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 0.6, metalness: 0.35 });
    const upsFaceMat = new THREE.MeshStandardMaterial({ color: 0x232a32, roughness: 0.45, metalness: 0.5 });
    const panelGreyMat = new THREE.MeshStandardMaterial({ color: 0x5a6470, roughness: 0.52, metalness: 0.45 });
    const panelDoorMat = new THREE.MeshStandardMaterial({ color: 0x4a535e, roughness: 0.48, metalness: 0.5 });
    const batteryMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.55, metalness: 0.2 });
    const powerRedMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.45, metalness: 0.3 });
    const powerMetalMat = new THREE.MeshStandardMaterial({ color: 0x7b8794, roughness: 0.35, metalness: 0.8 });
    const ledGreenMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.2 });
    const ledAmberMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.9 });

    // Two diesel gensets, side by side along the east wall, facing the central aisle.
    const makeGenset = (cx: number, cz: number) => {
      const g = new THREE.Group();
      g.position.set(cx, 0, cz);
      const skid = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 2.5), powerBlackMat);
      skid.position.y = 0.09; g.add(skid);
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 2.2), indYellowMat);
      block.position.y = 0.68; g.add(block);
      const alternator = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.46, 16), altMat);
      alternator.rotation.x = Math.PI / 2; alternator.position.set(0, 0.68, 1.0); g.add(alternator);
      for (let i = 0; i < 3; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.22), powerBlackMat);
        slat.position.set(-0.71, 0.68, -0.5 + i * 0.5); g.add(slat);
      }
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 10), powerMetalMat);
      pipe.position.set(0.35, 1.58, 0.65); g.add(pipe);
      const muffler = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 14), powerMetalMat);
      muffler.position.set(0.35, 2.23, 0.65); g.add(muffler);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), powerBlackMat);
      cap.position.set(0.35, 2.52, 0.65); g.add(cap);
      const fan = new THREE.Group();
      fan.position.set(0, 0.68, 1.25);
      for (let bladeIndex = 0; bladeIndex < 4; bladeIndex++) {
        const angle = bladeIndex * Math.PI / 2;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.025), powerMetalMat);
        blade.position.set(Math.sin(angle) * 0.09, Math.cos(angle) * 0.09, 0);
        blade.rotation.z = -angle;
        fan.add(blade);
      }
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), powerBlackMat);
      fan.add(hub);
      g.add(fan);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.25 }));
      led.position.set(0.48, 1.05, 1.18);
      g.add(led);
      sGroup.add(g);
      gensetRefs.current.push({ fan, led });
    };
    makeGenset(13.8, 7.4);
    makeGenset(13.8, 10.4);

    // Cable trays from the electrical panels to each genset, hung from the ceiling.
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x3b4552, roughness: 0.52, metalness: 0.6 });
    const addTray = (startX: number, midZ: number) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(startX, 2.0, 12.86),
        new THREE.Vector3(startX, 2.8, 12.7),
        new THREE.Vector3(startX, 2.8, midZ),
        new THREE.Vector3(13.2, 2.8, midZ),
        new THREE.Vector3(13.2, 1.2, midZ),
      ]);
      sGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.055, 6, false), trayMat));
    };
    addTray(9.2, 8.0);
    addTray(11.6, 10.4);
    const addHanger = (x: number, z: number) => {
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.65, 6), powerMetalMat);
      hanger.position.set(x, 3.625, z); sGroup.add(hanger);
    };
    addHanger(9.2, 10.4); addHanger(11.2, 8.0);
    addHanger(11.6, 11.5); addHanger(12.4, 10.4);

    // Three UPS cabinets against the north wall.
    for (const ux of [8.9, 10.1, 11.3]) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.9, 0.7), upsMat);
      body.position.set(ux, 1.03, 5.42); sGroup.add(body);
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.62, 0.03), upsFaceMat);
      face.position.set(ux, 1.06, 5.78); sGroup.add(face);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.02), ledGreenMat);
      bar.position.set(ux, 1.52, 5.8); sGroup.add(bar);
      const led1 = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), ledGreenMat);
      led1.position.set(ux - 0.16, 1.25, 5.8); sGroup.add(led1);
      const led2 = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), ledAmberMat);
      led2.position.set(ux + 0.16, 1.25, 5.8); sGroup.add(led2);
      for (const fx of [-0.36, 0.36]) for (const fz of [5.14, 5.66]) {
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), powerBlackMat);
        foot.position.set(ux + fx, 0.04, fz); sGroup.add(foot);
      }
    }

    // Electrical distribution panels on the inner south wall.
    const panelPositions = [9.2, 10.4, 11.6];
    for (const px of panelPositions) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.2), panelGreyMat);
      body.position.set(px, 1.25, 12.9); sGroup.add(body);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.36, 0.03), panelDoorMat);
      door.position.set(px, 1.25, 12.785); sGroup.add(door);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.03), powerBlackMat);
      handle.position.set(px + 0.31, 1.25, 12.765); sGroup.add(handle);
    }
    AISLE_NAMES.forEach((aisle, index) => {
      const baseY = 0.78;
      const lever = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.08, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.2, roughness: 0.35, metalness: 0.45 }),
      );
      lever.position.set(panelPositions[index], baseY, 12.735);
      lever.rotation.x = 0.35;
      sGroup.add(lever);
      powerBreakerRefs.current.push({ mesh: lever, aisle, baseY });
    });
    const warnCanvas = document.createElement('canvas');
    warnCanvas.width = 256; warnCanvas.height = 320;
    const warnCtx = warnCanvas.getContext('2d')!;
    warnCtx.clearRect(0, 0, 256, 320);
    warnCtx.fillStyle = '#facc15'; warnCtx.strokeStyle = '#111827'; warnCtx.lineWidth = 8;
    warnCtx.beginPath(); warnCtx.moveTo(128, 18); warnCtx.lineTo(238, 210); warnCtx.lineTo(18, 210); warnCtx.closePath();
    warnCtx.fill(); warnCtx.stroke();
    warnCtx.fillStyle = '#111827'; warnCtx.font = 'bold 120px system-ui, sans-serif';
    warnCtx.textAlign = 'center'; warnCtx.textBaseline = 'middle'; warnCtx.fillText('!', 128, 142);
    warnCtx.font = 'bold 32px system-ui, sans-serif';
    warnCtx.fillText('BAHAYA', 128, 252); warnCtx.fillText('LISTRIK', 128, 292);
    const warnTex = new THREE.CanvasTexture(warnCanvas);
    warnTex.colorSpace = THREE.SRGBColorSpace;
    const warnSign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.62), new THREE.MeshBasicMaterial({ map: warnTex, transparent: true }));
    warnSign.rotation.y = Math.PI; warnSign.position.set(10.4, 1.5, 12.75); sGroup.add(warnSign);

    // Battery rack: 2 columns x 4 rows of cells in an open frame.
    const rackCX = 13.5, rackCZ = 12.15;
    for (const sx of [-0.82, 0.82]) for (const sz of [-0.38, 0.38]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.88, 0.06), powerMetalMat);
      post.position.set(rackCX + sx, 0.94, rackCZ + sz); sGroup.add(post);
    }
    const shelfYs = [0.13, 0.57, 1.01, 1.45];
    for (const sy of shelfYs) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.04, 0.82), powerMetalMat);
      shelf.position.set(rackCX, sy, rackCZ); sGroup.add(shelf);
    }
    for (let row = 0; row < 4; row++) {
      const cy = shelfYs[row] + 0.19;
      for (const dx of [-0.4, 0.4]) {
        const cell = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.34, 0.6), batteryMat);
        cell.position.set(rackCX + dx, cy, rackCZ); sGroup.add(cell);
        for (const tx of [-0.18, 0.18]) {
          const terminal = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), powerMetalMat);
          terminal.position.set(rackCX + dx + tx, cy + 0.195, rackCZ); sGroup.add(terminal);
        }
      }
    }

    // Hazard floor strip along the genset aisle.
    const hazardCanvas = document.createElement('canvas');
    hazardCanvas.width = 64; hazardCanvas.height = 64;
    const hazardCtx = hazardCanvas.getContext('2d')!;
    hazardCtx.fillStyle = '#f5c518'; hazardCtx.fillRect(0, 0, 64, 64);
    hazardCtx.strokeStyle = '#111111'; hazardCtx.lineWidth = 16;
    for (let i = -64; i < 128; i += 32) {
      hazardCtx.beginPath(); hazardCtx.moveTo(i, 0); hazardCtx.lineTo(i + 64, 64); hazardCtx.stroke();
    }
    const hazardTex = new THREE.CanvasTexture(hazardCanvas);
    hazardTex.colorSpace = THREE.SRGBColorSpace;
    hazardTex.wrapS = THREE.RepeatWrapping; hazardTex.wrapT = THREE.RepeatWrapping;
    hazardTex.repeat.set(1, 10);
    const hazardStrip = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 5.2), new THREE.MeshBasicMaterial({ map: hazardTex }));
    hazardStrip.rotation.x = -Math.PI / 2; hazardStrip.position.set(12.55, 0.012, 8.9); sGroup.add(hazardStrip);

    // Fire extinguisher in the south-west corner.
    const extinguisher = new THREE.Group();
    extinguisher.position.set(7.5, 0, 12.4); sGroup.add(extinguisher);
    const extBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.62, 12), powerRedMat);
    extBody.position.y = 0.36; extinguisher.add(extBody);
    const extBase = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 12), powerBlackMat);
    extBase.position.y = 0.02; extinguisher.add(extBase);
    const extTop = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 10), powerBlackMat);
    extTop.position.y = 0.72; extinguisher.add(extTop);
    const extHose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0.08, 0.65, 0),
      new THREE.Vector3(0.25, 0.5, 0.08),
      new THREE.Vector3(0.2, 0.25, 0.12),
    ), 10, 0.022, 6, false), powerBlackMat);
    extinguisher.add(extHose);

    // Emergency light (off) on the south wall.
    const emergencyBox = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.1), powerBlackMat);
    emergencyBox.position.set(12.0, 2.6, 12.94); sGroup.add(emergencyBox);
    const emergencyLens = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xff2020, emissiveIntensity: 0.35, roughness: 0.4 }));
    emergencyLens.scale.z = 0.6; emergencyLens.position.set(12.0, 2.6, 12.88); sGroup.add(emergencyLens);
    emergencyLensRef.current = emergencyLens;

    // Ceiling lamps for the power room (lower ceiling than the DC hall).
    const powerLampMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, emissive: 0xdfe8ff, emissiveIntensity: 1.5 });
    for (const lx of [9.5, 12.5]) {
      const lampPanel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), powerLampMat);
      lampPanel.rotation.x = Math.PI / 2; lampPanel.position.set(lx, 4.44, 9); sGroup.add(lampPanel);
      const pLight = new THREE.PointLight(0xdfe8ff, 1.6, 12, 0);
      pLight.position.set(lx, 4.3, 9); sGroup.add(pLight);
    }

    // --- DC RACKS: closed cabinets, 3 aisles × 2 facing rows × 4 racks ---
    const perf = makePerforationTextures();
    const rackMats: RackMaterials = {
      metal: new THREE.MeshStandardMaterial({ color: 0x46525f, roughness: 0.34, metalness: 0.82 }),
      panel: new THREE.MeshStandardMaterial({ color: 0x202830, roughness: 0.48, metalness: 0.65 }),
      outer: new THREE.MeshStandardMaterial({ color: 0x151c24, roughness: 0.55, metalness: 0.55 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x080c11, roughness: 0.7, metalness: 0.25 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x39434e, roughness: 0.4, metalness: 0.75 }),
      handle: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.3, metalness: 0.85 }),
      plate: new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.6, metalness: 0.3 }),
      floor: new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.7, metalness: 0.3 }),
      cable: new THREE.MeshStandardMaterial({ color: 0x05080b, roughness: 0.8, metalness: 0.1 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x0a2530, emissive: 0x22d3ee, emissiveIntensity: 1.3, roughness: 0.4 }),
      door: new THREE.MeshStandardMaterial({
        map: perf.color, alphaMap: perf.alpha, transparent: true, alphaTest: 0.45,
        side: THREE.DoubleSide, roughness: 0.5, metalness: 0.55, depthWrite: true,
      }),
    };
    const rackCoords = RACK_COORDS;
    for (const rc of rackCoords) {
      const built = makeRackClosed(rc.rx, rc.rz, rc.yaw, rackMats);
      const key = rackKey(rc.rx, rc.rz);
      built.doorGroup.rotation.y = openDoorsRef.current.has(key) ? DOOR_OPEN_ANGLE : 0;
      doorRefsRef.current.push({ rackKey: key, doorGroup: built.doorGroup });
      sGroup.add(built.group);
    }

    const pduMat = new THREE.MeshStandardMaterial({ color: 0x747d86, roughness: 0.48, metalness: 0.45 });
    const powerCableMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.82, metalness: 0.05 });
    const conduitMat = new THREE.MeshStandardMaterial({ color: 0x8a939c, roughness: 0.32, metalness: 0.6 });
    const clampMat = new THREE.MeshStandardMaterial({ color: 0x353d46, roughness: 0.42, metalness: 0.72 });
    const pduGeometry = new THREE.BoxGeometry(0.28, 0.16, 0.08);
    const socketGeometry = new THREE.BoxGeometry(0.05, 0.045, 0.012);
    const conduitGeometry = new THREE.CylinderGeometry(0.05, 0.05, 12, 10);
    const conduitRows = [...new Set(rackCoords.map(r => r.rx))];
    const conduitXs = conduitRows.map(rx => rx + (rx < 0 ? 0.18 : -0.18));

    for (const rc of rackCoords) {
      const pduGroup = new THREE.Group();
      pduGroup.position.set(rc.rx, 0, rc.rz);
      pduGroup.rotation.y = rc.yaw;
      const localX = 0.72;
      const localZ = -RACK_D / 2 - 0.04;
      const pdu = new THREE.Mesh(pduGeometry, pduMat);
      pdu.position.set(localX, 5.25, localZ);
      pduGroup.add(pdu);
      for (const socketX of [localX - 0.065, localX + 0.065]) {
        const socket = new THREE.Mesh(socketGeometry, rackMats.dark);
        socket.position.set(socketX, 5.25, localZ - 0.045);
        pduGroup.add(socket);
      }
      sGroup.add(pduGroup);

      const right = rightDir(rc.yaw);
      const front = frontDir(rc.yaw);
      const cableStart = new THREE.Vector3(
        rc.rx + right.x * localX + front.x * localZ,
        5.33,
        rc.rz + right.z * localX + front.z * localZ,
      );
      const conduitX = conduitXs[conduitRows.indexOf(rc.rx)];
      const cableEnd = new THREE.Vector3(conduitX, 6.25, rc.rz);
      const cableCurve = new THREE.QuadraticBezierCurve3(
        cableStart,
        new THREE.Vector3(cableStart.x, 6.25, cableStart.z),
        cableEnd,
      );
      const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 12, 0.018, 6, false), powerCableMat);
      sGroup.add(cable);
    }

    for (const conduitX of conduitXs) {
      const conduit = new THREE.Mesh(conduitGeometry, conduitMat);
      conduit.rotation.x = Math.PI / 2;
      conduit.position.set(conduitX, 6.25, -12);
      sGroup.add(conduit);
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 10), conduitMat);
      branch.rotation.x = Math.PI / 2;
      branch.position.set(conduitX, 6.25, -5.6);
      sGroup.add(branch);
    }

    const mainTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 12.1, 10), conduitMat);
    mainTrunk.rotation.z = Math.PI / 2;
    mainTrunk.position.set(0.45, 6.25, -5.2);
    sGroup.add(mainTrunk);

    const powerRoute = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 14.7, 10), conduitMat);
    powerRoute.rotation.x = Math.PI / 2;
    powerRoute.position.set(6.5, 6.25, 2.15);
    sGroup.add(powerRoute);

    const routeDrop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.05, 10), conduitMat);
    routeDrop.position.set(6.5, 5.225, 9.5);
    sGroup.add(routeDrop);

    const wallEntry = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 10), conduitMat);
    wallEntry.rotation.z = Math.PI / 2;
    wallEntry.position.set(6.925, 4.2, 9.5);
    sGroup.add(wallEntry);

    const wallSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 12), clampMat);
    wallSleeve.rotation.z = Math.PI / 2;
    wallSleeve.position.set(7, 4.2, 9.5);
    sGroup.add(wallSleeve);

    const insideDrop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.58, 10), conduitMat);
    insideDrop.position.set(7.35, 3.41, 9.5);
    sGroup.add(insideDrop);

    for (const elbow of [
      new THREE.Vector3(6.5, 6.25, -5.2),
      new THREE.Vector3(6.5, 4.2, 9.5),
      new THREE.Vector3(7.35, 4.2, 9.5),
    ]) {
      const joint = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), conduitMat);
      joint.position.copy(elbow);
      sGroup.add(joint);
    }

    const clampGeometry = new THREE.TorusGeometry(0.065, 0.012, 6, 12);
    for (const clampX of [-3, 3]) {
      const clamp = new THREE.Mesh(clampGeometry, clampMat);
      clamp.rotation.y = Math.PI / 2;
      clamp.position.set(clampX, 6.25, -5.2);
      sGroup.add(clamp);
    }
    for (const clampZ of [1.5, 6.5]) {
      const clamp = new THREE.Mesh(clampGeometry, clampMat);
      clamp.position.set(6.5, 6.25, clampZ);
      sGroup.add(clamp);
    }
    const verticalClamp = new THREE.Mesh(clampGeometry, clampMat);
    verticalClamp.rotation.x = Math.PI / 2;
    verticalClamp.position.set(6.5, 5.3, 9.5);
    sGroup.add(verticalClamp);

    const junction = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.12), clampMat);
    junction.position.set(7.35, 2.52, 9.5);
    sGroup.add(junction);

    // Hanging "DC LORONG A/B/C" boards over each aisle, still facing +Z (spawn side).
    const signBoardMat = new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.55, metalness: 0.35 });
    const signRodMat = new THREE.MeshStandardMaterial({ color: 0x5b6b7e, roughness: 0.35, metalness: 0.8 });
    AISLE_NAMES.forEach((name, k) => {
      const xc = AISLE_SIGN_X[k];
      const zc = AISLE_SIGN_Z;
      const sc = document.createElement('canvas');
      sc.width = 512; sc.height = 136;
      const sx = sc.getContext('2d')!;
      sx.fillStyle = '#0b1118'; sx.fillRect(0, 0, 512, 136);
      sx.strokeStyle = '#22d3ee'; sx.lineWidth = 6; sx.strokeRect(7, 7, 498, 122);
      sx.fillStyle = '#f8fafc'; sx.font = 'bold 62px system-ui, sans-serif';
      sx.textAlign = 'center'; sx.textBaseline = 'middle';
      sx.fillText(`DC LORONG ${name}`, 256, 70);
      const st = new THREE.CanvasTexture(sc);
      st.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 0.08), signBoardMat);
      board.position.set(xc, 4.6, zc);
      sGroup.add(board);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.7), new THREE.MeshBasicMaterial({ map: st }));
      face.position.set(xc, 4.6, zc + 0.045);
      sGroup.add(face);
      for (const rodX of [-1.1, 1.1]) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 6), signRodMat);
        rod.position.set(xc + rodX, 5.1, zc);
        sGroup.add(rod);
      }
    });

    // Cold point lights down the central aisle (near and far end).
    for (const z of [-8, -16.5]) {
      const cold = new THREE.PointLight(0xbfe6ff, 1.6, 14, 0);
      cold.position.set(0, 4.5, z);
      sGroup.add(cold);
    }

    // --- CEILING LIGHTING SYSTEM (aisles + NOC) ---
    const lampPanelMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, emissive: 0xe2e8f0, emissiveIntensity: 1.6 });
    const addCeilingLamp = (x: number, z: number, intensity: number, dist: number) => {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), lampPanelMat);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(x, 6.9, z);
      sGroup.add(panel);
      const pLight = new THREE.PointLight(0xdfe8ff, intensity, dist, 0);
      pLight.position.set(x, 6.5, z);
      sGroup.add(pLight);
    };
    for (const lz of [-6, -12, -18]) {
      for (const lx of [-7.5, 0, 7.5]) addCeilingLamp(lx, lz, 2.6, 18);
    }
    addCeilingLamp(-2.5, 9, 1.6, 12);
    addCeilingLamp(2.5, 9, 1.6, 12);

    // --- DEVICE / FILLER PLACEMENT (anchored to rack slots) ---
    const { usedY, places } = planLabLayout(devices);
    const verifyUnit = (obj: THREE.Object3D, rx: number, rz: number, yaw: number, label: string) => {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
      const halfX = (c * RACK_W + s * RACK_D) / 2;
      const halfZ = (s * RACK_W + c * RACK_D) / 2;
      const inX = box.min.x >= rx - halfX - 0.02 && box.max.x <= rx + halfX + 0.02;
      const inY = box.min.y >= FLOOR_Y - 0.01 && box.max.y <= RACK_H - 0.01;
      const inZ = box.min.z >= rz - halfZ - 0.02 && box.max.z <= rz + halfZ + 0.02;
      if ((!inX || !inY || !inZ) && !placementWarningLogged) {
        placementWarningLogged = true;
        console.warn('[Room3D] rack placement violation', { label, rx, rz, yaw, minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z });
      }
    };

    const mountRemovedDevice = (d: Device, p: DevicePlace) => {
      const spec = KIND_SPEC[d.kind];
      const group = new THREE.Group();
      group.position.set(p.rx, p.yBottom, p.rz);
      group.rotation.y = p.yaw;
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.62, Math.max(0.16, spec.height - 0.08), Math.max(0.16, spec.depth - 0.06))),
        new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85 }),
      );
      outline.position.y = spec.height / 2;
      group.add(outline);
      sGroup.add(group);
    };

    const mountDevice = (d: Device, p: DevicePlace) => {
      const spec = KIND_SPEC[d.kind];
      const status = deviceStatus(d, { devices, links });
      const group = new THREE.Group();
      group.position.set(p.rx, p.yBottom, p.rz);
      group.rotation.y = p.yaw;
      const names = Object.keys(d.config.interfaces);
      const file = KIND_MODEL[d.kind];
      const localCenterY = spec.height / 2;

      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(1.72, spec.height, spec.depth),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hitbox.position.y = localCenterY;
      hitbox.userData.id = d.id;
      hitbox.userData.label = d.name;
      hitbox.userData.status = status;
      hitbox.userData.baseColor = spec.color;
      hitbox.userData.hoverColor = new THREE.Color(spec.color).offsetHSL(0, 0, 0.18).getHex();
      group.add(hitbox);
      deviceBodyRef.current.push(hitbox);

      const visual = new THREE.Group();
      visual.position.y = localCenterY;
      group.add(visual);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.72, spec.height, spec.depth), new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.5, metalness: 0.15 }));
      visual.add(body);
      addFrontPanel(visual, spec, status);
      const itemZ = spec.depth / 2 + 0.022;
      const rowY = d.kind === 'server' ? -0.3 : 0;
      for (let idx = 0; idx < names.length; idx++) {
        const off = portOffset(d.kind, idx, rowY);
        addPort(visual, off.x, off.y, spec.portStyle, itemZ, status);
      }

      if (file) {
        pendingLab.push({ file, maxHeight: spec.height, visual, group, x: p.rx, yBottom: p.yBottom, zCenter: p.rz, yaw: p.yaw });
      }

      sGroup.add(group);
      pos.set(d.id, new THREE.Vector3(p.rx, p.yBottom + localCenterY, p.rz));

      const fit = file ? planFit(file, 1.72, spec.height, 0.78) : null;
      const span = Math.max(0.12, Math.min(1.56, (fit ? fit.width : 1.2) * 0.8));
      const front = frontDir(p.yaw);
      const right = rightDir(p.yaw);
      const portBase = new THREE.Vector3(p.rx, p.yBottom + localCenterY, p.rz);
      names.forEach((name, idx) => {
        const t = names.length <= 1 ? 0.5 : idx / (names.length - 1);
        const localX = (t - 0.5) * span;
        const point = portBase.clone().addScaledVector(right, localX).addScaledVector(front, 0.42);
        portLocal.set(`${d.id}:${name}`, point);
      });
      verifyUnit(group, p.rx, p.rz, p.yaw, d.name);
    };

    devices.forEach(d => {
      const p = places.get(d.id);
      if (!p) return;
      if (removedDevices.has(d.id)) mountRemovedDevice(d, p);
      else mountDevice(d, p);
    });

    const shellMat = new THREE.MeshStandardMaterial({ color: 0x2e353e, roughness: 0.45, metalness: 0.6 });
    const fallbackFrontMat = new THREE.MeshStandardMaterial({ color: 0x3a424e, roughness: 0.5, metalness: 0.35 });
    const riserMat = new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.6 });
    const patchColors = [0x2f6fed, 0x18c5d9, 0xf5c518, 0x35c759, 0xdedede];
    const extraLeds: { mesh: THREE.Mesh; phase: number; base: number }[] = [];
    let cordN = 0;
    const addCord = (a: THREE.Vector3, b: THREE.Vector3, bulge: number, yaw: number, radius: number) => {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.addScaledVector(frontDir(yaw), Math.min(0.12, bulge));
      const mat = new THREE.MeshStandardMaterial({ color: patchColors[cordN++ % patchColors.length], roughness: 0.55 });
      sGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 8, radius, 5, false), mat));
    };
    const torY = RACK_H - 0.5;

    // ToR switch stays inside every cabinet; patch cords never leave the rack.
    for (const rc of rackCoords) {
      const torGroup = new THREE.Group();
      torGroup.position.set(rc.rx, torY + 0.15, rc.rz);
      torGroup.rotation.y = rc.yaw;
      const tor = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.3, 0.78), shellMat);
      torGroup.add(tor);
      const torLed = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), new THREE.MeshStandardMaterial({ color: 0x2dd45a, emissive: 0x2dd45a, emissiveIntensity: 1 }));
      torLed.position.set(-0.72, 0.11, 0.4);
      torGroup.add(torLed);
      sGroup.add(torGroup);
      extraLeds.push({ mesh: torLed, phase: rc.rx * 0.7 + rc.rz * 0.13, base: 1 });
    }

    // Patch panel lives in the NOC rack, just under its ToR.
    const nr = rackCoords[NOC_RACK];
    {
      const ppFile = 'patch_panel_24port.glb';
      const ppMaxH = 0.11;
      const ppFit = fitPanel(MODEL_DIMS[ppFile] ?? { w: 1, h: 1, d: 1 }, 1.72, ppMaxH, 0.78);
      const ppY = torY - ppMaxH - 0.005;
      const ppPlaceholder = new THREE.Mesh(
        new THREE.BoxGeometry(ppFit.width, ppFit.height, ppFit.depth),
        [shellMat, shellMat, shellMat, shellMat, fallbackFrontMat, shellMat],
      );
      ppPlaceholder.position.set(nr.rx, ppY + ppFit.height / 2, nr.rz);
      ppPlaceholder.rotation.y = nr.yaw;
      sGroup.add(ppPlaceholder);
      pendingPanel.push({ file: ppFile, maxHeight: ppMaxH, placeholder: ppPlaceholder, x: nr.rx, yBottom: ppY, zCenter: nr.rz, yaw: nr.yaw });
    }

    {
      const hero = makeHeroCcr1072(heroLcdData(dataRef.current.sim, 0), heroLcdViewRef.current);
      hero.group.position.set(nr.rx, NOC_HERO_Y, nr.rz);
      hero.group.rotation.y = nr.yaw;
      sGroup.add(hero.group);
      heroLcdRef.current = hero.lcd;
      heroHitMeshesRef.current = hero.hitMeshes;
      extraLeds.push({ mesh: hero.usrLed, phase: 1.7, base: 0.9 });
      verifyUnit(hero.group, nr.rx, nr.rz, nr.yaw, 'CCR1072-1G-8S+');
    }

    // Fill the remaining cabinet slots with deterministic server units.
    for (let r = 0; r < rackCoords.length; r++) {
      const rc = rackCoords[r];
      const cap = r === NOC_RACK ? NOC_HERO_Y - 0.01 : RACK_H - 1.05;
      let y = usedY[r];
      let slot = 0;
      for (;;) {
        const file = FILLER_FILES[(r * 7 + slot) % FILLER_FILES.length];
        const fit = fillerFit(MODEL_DIMS[file] ?? { w: 1, h: 1, d: 1 });
        if (y + fit.height > cap) break;
        const placeholder = new THREE.Mesh(
          new THREE.BoxGeometry(fit.width, fit.height, fit.depth),
          [shellMat, shellMat, shellMat, shellMat, fallbackFrontMat, shellMat],
        );
        placeholder.position.set(rc.rx, y + fit.height / 2, rc.rz);
        placeholder.rotation.y = rc.yaw;
        sGroup.add(placeholder);
        fillerSlots.push({ file, fit, rx: rc.rx, y, rz: rc.rz, yaw: rc.yaw, placeholder });

        const front = frontDir(rc.yaw);
        const right = rightDir(rc.yaw);
        const cordA = new THREE.Vector3(rc.rx, y + fit.height - 0.04, rc.rz)
          .addScaledVector(right, 0.58 - (slot % 4) * 0.16)
          .addScaledVector(front, 0.42);
        const cordB = new THREE.Vector3(rc.rx, torY + 0.04, rc.rz)
          .addScaledVector(right, 0.62 - (slot % 4) * 0.18)
          .addScaledVector(front, 0.42);
        addCord(cordA, cordB, 0.06 + (slot % 3) * 0.02, rc.yaw, 0.011);
        if (slot % 3 === 0) {
          const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), new THREE.MeshStandardMaterial({ color: 0x41f28d, emissive: 0x41f28d, emissiveIntensity: 1 }));
          led.position.set(rc.rx, y + fit.height / 2, rc.rz).addScaledVector(right, 0.7).addScaledVector(front, 0.425);
          sGroup.add(led);
          extraLeds.push({ mesh: led, phase: (r * 13 + slot) * 0.37, base: 1 });
        }
        y += fit.height + 0.01;
        slot++;
      }
    }

    // Patch cords from every device front port to the ToR inside the same rack.
    {
      const perRackIndex = new Map<number, number>();
      devices.forEach(d => {
        const p = places.get(d.id);
        if (!p || removedDevices.has(d.id)) return;
        const rc = rackCoords[p.rack];
        if (!rc) return;
        const ni = perRackIndex.get(p.rack) ?? 0;
        perRackIndex.set(p.rack, ni + 1);
        const firstPort = Object.keys(d.config.interfaces)[0];
        const start = firstPort ? portLocal.get(`${d.id}:${firstPort}`) : undefined;
        const startPoint = start ?? new THREE.Vector3(p.rx, p.yCenter, p.rz).addScaledVector(frontDir(p.yaw), 0.42);
        const endPoint = new THREE.Vector3(rc.rx, torY + 0.04, rc.rz)
          .addScaledVector(rightDir(rc.yaw), 0.62 - (ni % 4) * 0.18)
          .addScaledVector(frontDir(rc.yaw), 0.42);
        addCord(startPoint, endPoint, 0.06 + (ni % 3) * 0.02, rc.yaw, 0.012);
      });
    }

    // Overhead trunk tray per rack row, running along Z above each row.
    // Risers at z=-7.5 (spawn end) link the row trays to a cross-aisle spine.
    const rowXs = [...new Set(rackCoords.map(r => r.rx))].sort((a, b) => a - b);
    const trunkY = RACK_H + 0.25;
    const spineY = RACK_H + 0.65;
    const trunkNearZ = Math.max(...rackCoords.map(r => r.rz)); // spawn end (-7.5)
    const trunkFarZ = Math.min(...rackCoords.map(r => r.rz)); // deep end (-16.5)
    for (const rx of rowXs) {
      const pts = [trunkNearZ, (trunkNearZ + trunkFarZ) / 2, trunkFarZ].map(z => new THREE.Vector3(rx, trunkY, z));
      sGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.032, 6, false), riserMat));
      const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, spineY - trunkY, 6), riserMat);
      riser.position.set(rx, (spineY + trunkY) / 2, trunkNearZ);
      sGroup.add(riser);
    }
    {
      const spinePts = rowXs.map(rx => new THREE.Vector3(rx, spineY, trunkNearZ));
      sGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spinePts), 32, 0.032, 6, false), riserMat));
    }

    // Metro uplink: overhead feed into the NOC rack (internet source)
    {
      const metroCable = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 5, 20),
            new THREE.Vector3(0, 6.9, 13),
            new THREE.Vector3(nr.rx, 6.9, -6),
            new THREE.Vector3(nr.rx, RACK_H - 0.32, nr.rz).addScaledVector(frontDir(nr.yaw), 0.42),
          ]),
          40, 0.045, 8, false
        ),
        new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xcc9900, emissiveIntensity: 0.7, roughness: 0.4 })
      );
      sGroup.add(metroCable);
    }

    const dGroupUpd = dynamicGroupRef.current;
    if (dGroupUpd) {
      disposeGroup(dGroupUpd);
      while (dGroupUpd.children.length) dGroupUpd.remove(dGroupUpd.children[0]);
      animatedTrafficRef.current = [];
      animatedLedsRef.current = [...extraLeds];
      links.forEach((l, linkIndex) => {
        if (removedLinks.has(l.id)) return;
        const a = pos.get(l.from), b = pos.get(l.to);
        if (!a || !b) return;
        const fromDevice = devices.find((d) => d.id === l.from);
        const toDevice = devices.find((d) => d.id === l.to);
        const fiber = Boolean(fromDevice && toDevice && (KIND_SPEC[fromDevice.kind].portStyle === 'sfp' || KIND_SPEC[toDevice.kind].portStyle === 'sfp'));
        const faulty = Boolean(l.faulty);
        const cableColor = faulty ? 0xef4444 : fiber ? 0x22d3ee : 0x3b82f6;
        const glowColor = faulty ? 0xdc2626 : fiber ? 0x06b6d4 : 0x2563eb;
        const pa = portLocal.get(`${l.from}:${l.fromPort}`);
        const pb = portLocal.get(`${l.to}:${l.toPort}`);
        const startPoint = pa ? pa.clone() : a.clone().add(new THREE.Vector3(0, 0.08, 0.42));
        const endPoint = pb ? pb.clone() : b.clone().add(new THREE.Vector3(0, 0.08, 0.42));
        const mid = startPoint.clone().add(endPoint).multiplyScalar(0.5);
        mid.y += 0.8 + (linkIndex % 3) * 0.16;
        const curve = new THREE.QuadraticBezierCurve3(startPoint, mid, endPoint);
        const cableMat = new THREE.MeshStandardMaterial({ color: cableColor, roughness: fiber ? 0.22 : 0.48, metalness: 0.12, emissive: glowColor, emissiveIntensity: faulty ? 0.95 : fiber ? 0.85 : 0.22 });
        const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, fiber ? 0.014 : 0.022, 8, false), cableMat);
        dGroupUpd.add(cable);
        const dotColor = faulty ? 0xfca5a5 : fiber ? 0xa5f3fc : 0x93c5fd;
        const dotMat = new THREE.MeshStandardMaterial({ color: dotColor, emissive: cableColor, emissiveIntensity: faulty ? 2 : fiber ? 2.4 : 1.5 });
        for (let j = 0; j < 3; j++) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(fiber ? 0.038 : 0.045, 10, 10), dotMat.clone());
          dGroupUpd.add(dot);
          animatedTrafficRef.current.push({ mesh: dot, curve, phase: j / 3 + linkIndex * 0.13 });
        }
      });
      devices.forEach(d => {
        if (removedDevices.has(d.id)) return;
        const posV = pos.get(d.id);
        if (!posV) return;
        const isSel = d.id === selectedId;
        const isLink = d.id === linkStartId;
        const sprite = makeLabel(d.name, isSel || isLink);
        sprite.position.set(posV.x, posV.y + KIND_SPEC[d.kind].height / 2 + 0.35, posV.z);
        dGroupUpd.add(sprite);
      });
    }

    const loadFillers = async () => {
      const byFile = new Map<string, FillerSlot[]>();
      for (const slot of fillerSlots) {
        const bucket = byFile.get(slot.file);
        if (bucket) bucket.push(slot);
        else byFile.set(slot.file, [slot]);
      }
      for (const [file, slots] of byFile) {
        try {
          const template = await loadNetverseAsset(file);
          if (cancelled) return;
          const measured = fillerFit(measureDims(template));
          for (const slot of slots) {
            if (cancelled) return;
            const fit: Fit = {
              ...measured,
              sy: Math.min(measured.sy, slot.fit.sy),
              height: Math.min(measured.height, slot.fit.height),
            };
            const holder = placeAsset(template, fit, slot.rx, slot.y, slot.rz, slot.yaw);
            sGroup.add(holder);
            verifyUnit(holder, slot.rx, slot.rz, slot.yaw, file);
            sGroup.remove(slot.placeholder);
            slot.placeholder.geometry.dispose();
          }
        } catch {
          // Keep the procedural placeholder as the fallback.
        }
      }
    };

    const loadLab = async () => {
      const byFile = new Map<string, PendingLab[]>();
      for (const item of pendingLab) {
        const bucket = byFile.get(item.file);
        if (bucket) bucket.push(item);
        else byFile.set(item.file, [item]);
      }
      for (const [file, items] of byFile) {
        try {
          const template = await loadNetverseAsset(file);
          if (cancelled) return;
          const dims = measureDims(template);
          for (const item of items) {
            if (cancelled) return;
            const fit = fitDims(dims, 1.72, item.maxHeight, 0.78);
            const holder = placeAsset(template, fit, item.x, item.yBottom, item.zCenter, item.yaw);
            sGroup.add(holder);
            verifyUnit(holder, item.x, item.zCenter, item.yaw, file);
            item.group.remove(item.visual);
            disposeGroup(item.visual);
          }
        } catch {
          // Keep the procedural visual as the fallback.
        }
      }
    };

    const loadPanel = async () => {
      for (const item of pendingPanel) {
        try {
          const template = await loadNetverseAsset(item.file);
          if (cancelled) return;
          const fit = fitPanel(measureDims(template), 1.72, item.maxHeight, 0.78);
          const holder = placeAsset(template, fit, item.x, item.yBottom, item.zCenter, item.yaw);
          sGroup.add(holder);
          verifyUnit(holder, item.x, item.zCenter, item.yaw, item.file);
          sGroup.remove(item.placeholder);
          item.placeholder.geometry.dispose();
        } catch {
          // Keep the procedural placeholder as the fallback.
        }
      }
    };

    const loadStorage = async () => {
      for (const item of pendingStorage) {
        try {
          const template = await loadNetverseAsset(item.file);
          if (cancelled) return;
          const fit = fitDims(measureDims(template), item.maxWidth, item.maxHeight, item.maxDepth);
          const holder = placeAsset(template, fit, item.x, item.yBottom, item.z, 0);
          item.parent.add(holder);
        } catch {
          continue;
        }
      }
    };

    // Serialise the loads so each GLB file is fetched/parsed only once even when
    // both a filler rack and a lab device use the same model.
    void (async () => {
      await loadFillers();
      if (cancelled) return;
      await loadLab();
      if (cancelled) return;
      await loadPanel();
      if (cancelled) return;
      await loadStorage();
    })();

    return () => {
      cancelled = true;
    };
  }, [devices, links, selectedId, linkStartId, removedLinks, removedDevices]);
  return (
    <div className="room3d">
      <div ref={hostRef} className="room3d-canvas" />
      <div className="crosshair" />
      {nearbyPrompt && (
        <div className="device-interact-group">
          <button
            className="device-interact"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={runNearbyAction}
            aria-label={nearbyPrompt.label}
          >
            <span className="device-interact-key">E</span>
            <span>{nearbyPrompt.label}</span>
          </button>
          {nearbyPrompt.kind === 'nocPc' && pcOn && (
            <button className="device-interact-secondary" onPointerDown={e => e.stopPropagation()} onClick={() => onPowerOffRef.current()}>Matikan PC</button>
          )}
          {nearbyPrompt.kind === 'heroTerminal' && (
            <>
              <button className="device-interact-secondary" onPointerDown={e => e.stopPropagation()} onClick={() => toggleDoor(nearbyPrompt.doorRackKey)}>{nearbyPrompt.doorOpen ? 'Tutup Pintu Rak NOC' : 'Buka Pintu Rak NOC'}</button>
              {nearbyPrompt.maintenanceAction && nearbyPrompt.maintenanceLabel && (
                <button className="device-interact-secondary" onPointerDown={e => e.stopPropagation()} onClick={() => { const action = nearbyPrompt.maintenanceAction; if (action) onMaintainRef.current(action); }}>{nearbyPrompt.maintenanceLabel}</button>
              )}
              {nearbyPrompt.otherDoor && (
                <button className="device-interact-secondary" onPointerDown={e => e.stopPropagation()} onClick={() => { const door = nearbyPrompt.otherDoor; if (door) toggleDoor(door.rackKey); }}>{nearbyPrompt.otherDoor.label}</button>
              )}
              {nearbyPrompt.otherMaintenanceAction && nearbyPrompt.otherMaintenanceLabel && (
                <button className="device-interact-secondary" onPointerDown={e => e.stopPropagation()} onClick={() => { const action = nearbyPrompt.otherMaintenanceAction; if (action) onMaintainRef.current(action); }}>{nearbyPrompt.otherMaintenanceLabel}</button>
              )}
            </>
          )}
        </div>
      )}
      <div className="dpad">
        <button className="dpad-btn dpad-up" onPointerDown={(e) => { e.stopPropagation(); setKey('f', true); }} onPointerUp={(e) => { e.stopPropagation(); setKey('f', false); }} onPointerCancel={() => setKey('f', false)} onPointerLeave={() => setKey('f', false)}>UP</button>
        <button className="dpad-btn dpad-left" onPointerDown={(e) => { e.stopPropagation(); setKey('l', true); }} onPointerUp={(e) => { e.stopPropagation(); setKey('l', false); }} onPointerCancel={() => setKey('l', false)} onPointerLeave={() => setKey('l', false)}>LEFT</button>
        <button className="dpad-btn dpad-right" onPointerDown={(e) => { e.stopPropagation(); setKey('r', true); }} onPointerUp={(e) => { e.stopPropagation(); setKey('r', false); }} onPointerCancel={() => setKey('r', false)} onPointerLeave={() => setKey('r', false)}>RIGHT</button>
        <button className="dpad-btn dpad-down" onPointerDown={(e) => { e.stopPropagation(); setKey('b', true); }} onPointerUp={(e) => { e.stopPropagation(); setKey('b', false); }} onPointerCancel={() => setKey('b', false)} onPointerLeave={() => setKey('b', false)}>DOWN</button>
      </div>
      <button className="room-reset" title="Reset position" onClick={resetView}>&#8634;</button>
    </div>
  );
}
