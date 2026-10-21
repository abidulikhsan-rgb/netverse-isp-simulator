import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Device, DeviceKind, DeviceStatus, Link } from './networkEngine';
import { deviceStatus } from './networkEngine';

type PortType = 'rj45' | 'sfp' | 'drive' | 'usb';
type KindSpec = { color: number; height: number; depth: number; ports: { type: PortType; count: number }[]; lcd?: boolean };
const KIND_SPEC: Record<DeviceKind, KindSpec> = {
  router: { color: 0xf4f5f6, height: 0.6, depth: 0.8, ports: [{ type: 'rj45', count: 8 }, { type: 'sfp', count: 2 }], lcd: true },
  switch: { color: 0x2b3038, height: 0.6, depth: 0.8, ports: [{ type: 'rj45', count: 8 }, { type: 'sfp', count: 2 }] },
  olt: { color: 0xf4f5f6, height: 0.6, depth: 0.8, ports: [{ type: 'sfp', count: 8 }] },
  ont: { color: 0xf4f5f6, height: 0.42, depth: 0.55, ports: [{ type: 'rj45', count: 2 }] },
  pc: { color: 0x9aa3ad, height: 0.42, depth: 0.55, ports: [{ type: 'rj45', count: 1 }, { type: 'usb', count: 2 }] },
  server: { color: 0x2b3038, height: 1.2, depth: 0.8, ports: [{ type: 'drive', count: 4 }] },
};

function makeRack(rx: number): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x303943, roughness: 0.34, metalness: 0.82,
  });
  const panel = new THREE.MeshStandardMaterial({
    color: 0x202830, roughness: 0.48, metalness: 0.65,
  });
  const vent = new THREE.MeshStandardMaterial({
    color: 0x080c11, roughness: 0.7, metalness: 0.25,
  });

  const H = 5.6, W = 1.86, D = 0.9;
  const frontZ = RACK_Z + D / 2;
  const backZ = RACK_Z - D / 2;
  const xl = rx - W / 2, xr = rx + W / 2;

  // Struktur utama rak
  for (const [px, pz] of [
    [xl, frontZ], [xr, frontZ], [xl, backZ], [xr, backZ],
  ] as const) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, H, 0.075), metal
    );
    post.position.set(px, H / 2, pz);
    g.add(post);
  }

  // Balok rangka atas dan bawah
  for (const y of [0.04, H - 0.04]) {
    for (const pz of [frontZ, backZ]) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(W, 0.075, 0.075), metal
      );
      beam.position.set(rx, y, pz);
      g.add(beam);
    }
  }

  // Panel samping
  for (const x of [xl + 0.045, xr - 0.045]) {
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, H - 0.18, D - 0.12), panel
    );
    side.position.set(x, H / 2, RACK_Z);
    g.add(side);

    // Ventilasi samping
    for (let y = 0.45; y < H - 0.35; y += 0.18) {
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.075, 0.012), vent
      );
      slot.position.set(
        x + (x < rx ? 0.02 : -0.02), y, RACK_Z + 0.05
      );
      g.add(slot);
    }
  }

  // Rel pemasangan perangkat dan lubang baut
  for (const x of [xl + 0.16, xr - 0.16]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, H - 0.2, 0.035), metal
    );
    rail.position.set(x, H / 2, frontZ - 0.07);
    g.add(rail);

    for (let y = 0.18; y < H - 0.15; y += 0.14) {
      const hole = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.035, 0.009), vent
      );
      hole.position.set(x, y, frontZ - 0.048);
      g.add(hole);
    }
  }

  // Kaki rak
  for (const x of [xl + 0.12, xr - 0.12]) {
    for (const z of [frontZ - 0.08, backZ + 0.08]) {
      const foot = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.12, 0.16), panel
      );
      foot.position.set(x, -0.04, z);
      g.add(foot);
    }
  }

  return g;
}
function addFrontPanel(group: THREE.Group, spec: KindSpec, status: DeviceStatus): void {
  const frontZ = spec.depth / 2 + 0.011;
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.25, metalness: 0.5 });
  const SIZES: Record<PortType, [number, number]> = { rj45: [0.09, 0.14], sfp: [0.13, 0.17], drive: [0.3, 0.42], usb: [0.1, 0.08] };
  let x = -0.78;
  for (const p of spec.ports) {
    for (let i = 0; i < p.count; i++) {
      const [pw, ph] = SIZES[p.type];
      const port = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.02), dark);
      port.position.set(x + pw / 2, 0, frontZ);
      group.add(port);
      x += pw + 0.028;
    }
    x += 0.05;
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), new THREE.MeshStandardMaterial({ color: STATUS_COLOR[status], emissive: new THREE.Color(STATUS_COLOR[status]), emissiveIntensity: 0.9 }));
  led.position.set(0.74, spec.height / 2 - 0.1, frontZ);
  group.add(led);
  if (spec.lcd) {
    const lcd = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.02), new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: new THREE.Color(0x22c55e), emissiveIntensity: 0.3, roughness: 0.3 }));
    lcd.position.set(-0.52, spec.height / 2 - 0.14, frontZ);
    group.add(lcd);
  }
}
const STATUS_COLOR: Record<DeviceStatus, number> = {
  up: 0x22c55e, idle: 0xcbd5e1, error: 0xef4444,
};
const STATUS_LABEL: Record<DeviceStatus, string> = {
  up: 'Online', idle: 'Idle', error: 'Error',
};
const RACK_X = [-3.2, 0, 3.2];
const RACK_Z = -4;
const FLOOR_Y = 0;
const SLOT_H = 0.7;
const EYE = 1.6;

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

type Props = {
  devices: Device[];
  links: Link[];
  selectedId: string | null;
  linkStartId: string | null;
  onDeviceClick: (id: string) => void;
  onEmptyClick: () => void;
};

export default function Room3D({ devices, links, selectedId, linkStartId, onDeviceClick, onEmptyClick }: Props) {
  const animatedTrafficRef = useRef<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; phase: number }[]>([]);
  const animatedLedsRef = useRef<{ mesh: THREE.Mesh; phase: number; base: number }[]>([]);
  const serverFanRefs = useRef<THREE.Group[]>([]);
  const airflowParticlesRef = useRef<THREE.Mesh[]>([]);

  const hostRef = useRef<HTMLDivElement>(null);
  const dynamicRef = useRef<THREE.Group | null>(null);
  const deviceBodyRef = useRef<THREE.Mesh[]>([]);
  const [nearbyDevice, setNearbyDevice] = useState<{ id: string; label: string } | null>(null);
  const nearbyDeviceRef = useRef<{ id: string; label: string } | null>(null);
  const keysRef = useRef({ f: false, b: false, l: false, r: false });
  const fpRef = useRef<{ x: number; z: number; yaw: number; pitch: number } | null>(null);
  const clickRef = useRef(onDeviceClick);
  clickRef.current = onDeviceClick;
  const emptyRef = useRef(onEmptyClick);
  emptyRef.current = onEmptyClick;

  const setKey = (k: 'f' | 'b' | 'l' | 'r', v: boolean) => { keysRef.current[k] = v; };
  const resetView = () => {
    const f = fpRef.current;
    if (!f) return;
    f.x = 0; f.z = 2; f.yaw = 0; f.pitch = 0;
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f6f8);
    scene.fog = new THREE.Fog(0xf4f6f8, 16, 40);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(6, 12, 6);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xeef2f7, 0.5);
    fill.position.set(-6, 5, -4);
    scene.add(fill);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xeef0f3, roughness: 0.9, metalness: 0.02 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; scene.add(floor);
    const grid = new THREE.GridHelper(20, 20, 0xd8dde3, 0xe6e9ed);
    grid.position.y = FLOOR_Y + 0.01; scene.add(grid);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(20, 7), wallMat); back.position.set(0, 3.5, -10); scene.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(20, 7), wallMat); left.rotation.y = Math.PI / 2; left.position.set(-10, 3.5, 0); scene.add(left);
    const right = new THREE.Mesh(new THREE.PlaneGeometry(20, 7), wallMat); right.rotation.y = -Math.PI / 2; right.position.set(10, 3.5, 0); scene.add(right);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), wallMat); ceil.rotation.x = Math.PI / 2; ceil.position.y = 7; scene.add(ceil);

    const dynamic = new THREE.Group();
    scene.add(dynamic);
    dynamicRef.current = dynamic;

    const fp = { x: 0, z: 2, yaw: 0, pitch: 0 };
    fpRef.current = fp;

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
      dragging = true;
      moved = false;
      activePointerId = e.pointerId;
      px = e.clientX;
      py = e.clientY;
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
      const hits = raycaster.intersectObjects(deviceBodyRef.current, false);
      const m = hits.length ? hits[0].object as THREE.Mesh : null;
      if (m !== hovered) {
        if (hovered) (hovered.material as THREE.MeshStandardMaterial).color.set(hovered.userData.baseColor);
        hovered = m;
        if (hovered) (hovered.material as THREE.MeshStandardMaterial).color.set(hovered.userData.hoverColor);
      }
      if (hovered) {
        tooltip.textContent = `${hovered.userData.label} · ${STATUS_LABEL[hovered.userData.status as DeviceStatus]}`;
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
        const hits = raycaster.intersectObjects(deviceBodyRef.current, false);
        if (hits.length) clickRef.current(hits[0].object.userData.id as string);
        else emptyRef.current();
      }
      const pointerId = activePointerId;
      dragging = false;
      moved = false;
      activePointerId = null;
      try {
        if (pointerId !== null && host.hasPointerCapture(pointerId)) {
          host.releasePointerCapture(pointerId);
        }
      } catch {}
    };
    const onUp = (e: PointerEvent) => finishPointer(e, true);
    const onCancel = (e: PointerEvent) => finishPointer(e, false);
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onCancel);
    host.addEventListener('contextmenu', (e) => e.preventDefault());

    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': keysRef.current.f = true; break;
        case 's': case 'arrowdown': keysRef.current.b = true; break;
        case 'a': case 'arrowleft': keysRef.current.l = true; break;
        case 'd': case 'arrowright': keysRef.current.r = true; break;
        case 'e': {
          if (!e.repeat && nearbyDeviceRef.current) {
            clickRef.current(nearbyDeviceRef.current.id);
          }
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

    const deviceWorldPos = new THREE.Vector3();
    let raf = 0;
    let last = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = keysRef.current;
      const speed = 3.4 * dt;
      const fx = Math.sin(fp.yaw), fz = -Math.cos(fp.yaw);
      const rx = Math.cos(fp.yaw), rz = Math.sin(fp.yaw);
      let mvx = 0, mvz = 0;
      if (k.f) { mvx += fx; mvz += fz; }
      if (k.b) { mvx -= fx; mvz -= fz; }
      if (k.l) { mvx -= rx; mvz -= rz; }
      if (k.r) { mvx += rx; mvz += rz; }
      const len = Math.hypot(mvx, mvz) || 1;
      fp.x += (mvx / len) * speed;
      fp.z += (mvz / len) * speed;
      fp.x = Math.max(-8.5, Math.min(8.5, fp.x));
      fp.z = Math.max(-8.5, Math.min(8.5, fp.z));
      camera.position.set(fp.x, EYE, fp.z);
      camera.lookAt(fp.x + Math.sin(fp.yaw) * Math.cos(fp.pitch), EYE + Math.sin(fp.pitch), fp.z - Math.cos(fp.yaw) * Math.cos(fp.pitch));

      let nearest: { id: string; label: string; distance: number } | null = null;
      for (const body of deviceBodyRef.current) {
        body.getWorldPosition(deviceWorldPos);
        const distance = Math.hypot(deviceWorldPos.x - fp.x, deviceWorldPos.z - fp.z);
        if (distance <= 2.6 && (!nearest || distance < nearest.distance)) {
          nearest = {
            id: body.userData.id as string,
            label: body.userData.label as string,
            distance,
          };
        }
      }
      const nextNearby = nearest ? { id: nearest.id, label: nearest.label } : null;
      const previousNearby = nearbyDeviceRef.current;
      if (previousNearby?.id !== nextNearby?.id) {
        nearbyDeviceRef.current = nextNearby;
        setNearbyDevice(nextNearby);
      }

      for (const item of animatedTrafficRef.current) {
        const t = (now * 0.00022 + item.phase) % 1;
        item.mesh.position.copy(item.curve.getPoint(t));
      }
      for (const item of animatedLedsRef.current) {
        const pulse = 0.35 + (0.65 * (0.5 + 0.5 * Math.sin(now * 0.006 + item.phase)));
        const material = item.mesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = item.base * pulse;
      }
      for (const fan of serverFanRefs.current) fan.rotation.z += dt * 18;
      for (const particle of airflowParticlesRef.current) {
        const phase = particle.userData.airPhase as number;
        const baseY = particle.userData.airBaseY as number;
        particle.position.y = baseY + Math.sin(now * 0.0012 + phase) * 0.12;
        particle.position.x += Math.sin(now * 0.0008 + phase) * dt * 0.035;
        if (particle.position.x > 4.5) particle.position.x = -4.5;
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
      renderer.dispose();
      host.removeChild(renderer.domElement);
      dynamicRef.current = null;
      fpRef.current = null;
      nearbyDeviceRef.current = null;
    };
  }, []);

  useEffect(() => {
    animatedTrafficRef.current = [];
    animatedLedsRef.current = [];
    serverFanRefs.current = [];
    airflowParticlesRef.current = [];
    const dynamic = dynamicRef.current;
    if (!dynamic) return;
    while (dynamic.children.length) dynamic.remove(dynamic.children[0]);
    deviceBodyRef.current = [];
    const pos = new Map<string, THREE.Vector3>();

    RACK_X.forEach((rx) => {
      dynamic.add(makeRack(rx));
      // Partikel udara dingin dekoratif di sisi depan rak
      const airMaterial = new THREE.MeshBasicMaterial({
        color: 0x67e8f9,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      });
      for (let airIndex = 0; airIndex < 7; airIndex++) {
        const particle = new THREE.Mesh(
          new THREE.SphereGeometry(0.025 + (airIndex % 3) * 0.008, 6, 6),
          airMaterial.clone()
        );
        particle.position.set(
          rx - 0.65 + (airIndex % 4) * 0.42,
          0.35 + (airIndex % 5) * 0.7,
          RACK_Z + 0.85 + (airIndex % 3) * 0.18
        );
        particle.userData.airPhase = airIndex * 1.37;
        particle.userData.airBaseY = particle.position.y;
        dynamic.add(particle);
        airflowParticlesRef.current.push(particle);
      }

    });

    const rackY = RACK_X.map(() => FLOOR_Y + 0.3);
    devices.forEach((d, i) => {
      const rackIdx = i % RACK_X.length;
      const rx = RACK_X[rackIdx];
      const spec = KIND_SPEC[d.kind];
      const y = rackY[rackIdx] + spec.height / 2;
      rackY[rackIdx] += spec.height + 0.12;
      const z = RACK_Z + 0.45 - spec.depth / 2;
      const status = deviceStatus(d, { devices, links });
      const isSel = d.id === selectedId;
      const isLink = d.id === linkStartId;

      const group = new THREE.Group();
      group.position.set(rx, y, z);

      const baseC = new THREE.Color(spec.color);
      if (isSel) baseC.lerp(new THREE.Color(0x2563eb), 0.25);
      else if (isLink) baseC.lerp(new THREE.Color(0xf59e0b), 0.25);
      const baseColor = baseC.getHex();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, spec.height, spec.depth), new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, metalness: 0.15 }));
      body.userData.id = d.id;
      body.userData.label = d.name;
      body.userData.status = status;
      body.userData.baseColor = baseColor;
      body.userData.hoverColor = baseC.clone().offsetHSL(0, 0, 0.18).getHex();
      group.add(body);
      deviceBodyRef.current.push(body);

      const ledMat = new THREE.MeshStandardMaterial({
        color: status === 'error' ? 0xef4444 : status === 'up' ? 0x22c55e : 0xcbd5e1,
        emissive: status === 'error' ? 0xef4444 : status === 'up' ? 0x22c55e : 0x64748b,
        emissiveIntensity: 0.8,
      });
      const activityLed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), ledMat);
      activityLed.position.set(0.62, -spec.height * 0.12, spec.depth / 2 + 0.035);
      group.add(activityLed);
      if (status !== 'idle') animatedLedsRef.current.push({ mesh: activityLed, phase: i * 0.9, base: 0.8 });

      // Kipas server dekoratif pada panel depan
      const serverFanBlades: THREE.Group[] = [];
      if (d.kind === 'server') {
        const fanMaterial = new THREE.MeshStandardMaterial({
          color: 0x111820, roughness: 0.42, metalness: 0.55,
        });
        const bladeMaterial = new THREE.MeshStandardMaterial({
          color: 0x64748b, roughness: 0.38, metalness: 0.62,
          emissive: 0x0b1724, emissiveIntensity: 0.25,
        });
        for (let fanIndex = 0; fanIndex < 3; fanIndex++) {
          const fan = new THREE.Group();
          const fx = -0.48 + fanIndex * 0.34;
          const fy = -spec.height * 0.12;
          const rim = new THREE.Mesh(
            new THREE.CylinderGeometry(0.105, 0.105, 0.025, 20),
            fanMaterial
          );
          rim.rotation.x = Math.PI / 2;
          rim.position.set(fx, fy, spec.depth / 2 + 0.045);
          group.add(rim);

          const rotor = new THREE.Group();
          rotor.position.set(fx, fy, spec.depth / 2 + 0.065);
          for (let bladeIndex = 0; bladeIndex < 4; bladeIndex++) {
            const blade = new THREE.Mesh(
              new THREE.BoxGeometry(0.035, 0.082, 0.012),
              bladeMaterial
            );
            const angle = bladeIndex * Math.PI / 2;
            blade.position.set(
              Math.sin(angle) * 0.042,
              Math.cos(angle) * 0.042,
              0
            );
            blade.rotation.z = -angle;
            rotor.add(blade);
          }
          const hub = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 10, 10),
            bladeMaterial
          );
          rotor.add(hub);
          group.add(rotor);
          serverFanBlades.push(rotor);
        }
      }

      serverFanRefs.current.push(...serverFanBlades);
      addFrontPanel(group, spec, status);

      dynamic.add(group);
      pos.set(d.id, new THREE.Vector3(rx, y, z));

      const sprite = makeLabel(d.name, isSel || isLink);
      sprite.position.set(rx, y + spec.height / 2 + 0.35, z);
      dynamic.add(sprite);
    });

    links.forEach((l, linkIndex) => {
      const a = pos.get(l.from), b = pos.get(l.to);
      if (!a || !b) return;

      const fromDevice = devices.find((d) => d.id === l.from);
      const toDevice = devices.find((d) => d.id === l.to);
      const fiber = /sfp|fiber|pon|gpon|xgs/i.test(
        `${l.fromPort} ${l.toPort} ${fromDevice?.kind ?? ""} ${toDevice?.kind ?? ""}`
      );
      const cableColor = fiber ? 0x22d3ee : 0x3b82f6;
      const glowColor = fiber ? 0x06b6d4 : 0x2563eb;

      const startPoint = a.clone();
      const endPoint = b.clone();
      startPoint.y += 0.08;
      endPoint.y += 0.08;

      const mid = startPoint.clone().add(endPoint).multiplyScalar(0.5);
      mid.y += 0.8 + (linkIndex % 3) * 0.16;
      const curve = new THREE.QuadraticBezierCurve3(startPoint, mid, endPoint);

      const cableMat = new THREE.MeshStandardMaterial({
        color: cableColor,
        roughness: fiber ? 0.22 : 0.48,
        metalness: 0.12,
        emissive: glowColor,
        emissiveIntensity: fiber ? 0.85 : 0.22,
      });

      const cable = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 40, fiber ? 0.014 : 0.022, 8, false),
        cableMat
      );
      dynamic.add(cable);

      const dotMat = new THREE.MeshStandardMaterial({
        color: fiber ? 0xa5f3fc : 0x93c5fd,
        emissive: cableColor,
        emissiveIntensity: fiber ? 2.4 : 1.5,
      });

      for (let j = 0; j < 3; j++) {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(fiber ? 0.038 : 0.045, 10, 10),
          dotMat.clone()
        );
        dynamic.add(dot);
        animatedTrafficRef.current.push({
          mesh: dot,
          curve,
          phase: j / 3 + linkIndex * 0.13,
        });
      }
    });
    if (devices.length === 0) {
      const hint = makeLabel('Add devices to fill the racks', false);
      hint.position.set(0, 2.2, -4);
      dynamic.add(hint);
    }
  }, [devices, links, selectedId, linkStartId]);

  return (
    <div className="room3d">
      <div ref={hostRef} className="room3d-canvas" />
      <div className="crosshair" />
      {nearbyDevice && (
        <button
          className="device-interact"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => clickRef.current(nearbyDevice.id)}
          aria-label={`Periksa perangkat ${nearbyDevice.label}`}
        >
          <span className="device-interact-key">E</span>
          <span>Periksa {nearbyDevice.label}</span>
        </button>
      )}
      <div className="dpad">
        <button className="dpad-btn dpad-up" aria-label="Move forward" onPointerDown={(e) => { e.stopPropagation(); setKey('f', true); }} onPointerUp={(e) => { e.stopPropagation(); setKey('f', false); }} onPointerCancel={() => setKey('f', false)} onPointerLeave={() => setKey('f', false)}>▲</button>
        <button className="dpad-btn dpad-left" aria-label="Move left" onPointerDown={(e) => { e.stopPropagation(); setKey('l', true); }} onPointerUp={(e) => { e.stopPropagation(); setKey('l', false); }} onPointerCancel={() => setKey('l', false)} onPointerLeave={() => setKey('l', false)}>◀</button>
        <button className="dpad-btn dpad-right" aria-label="Move right" onPointerDown={(e) => { e.stopPropagation(); setKey('r', true); }} onPointerUp={(e) => { e.stopPropagation(); setKey('r', false); }} onPointerCancel={() => setKey('r', false)} onPointerLeave={() => setKey('r', false)}>▶</button>
        <button className="dpad-btn dpad-down" aria-label="Move backward" onPointerDown={(e) => { e.stopPropagation(); setKey('b', true); }} onPointerUp={(e) => { e.stopPropagation(); setKey('b', false); }} onPointerCancel={() => setKey('b', false)} onPointerLeave={() => setKey('b', false)}>▼</button>
      </div>
      <button className="room-reset" title="Reset position" onClick={resetView}>↺</button>
    </div>
  );
}
