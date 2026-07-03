/**
 * <visor-360 src="..."> — Equirectangular 360° panorama viewer.
 * WebGL sphere projection · drag with inertia · wheel zoom · gyroscope support.
 * No dependencies. Registered as a custom element.
 */
const VERT = `
attribute vec2 aPos;
varying vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }
`;
const FRAG = `
precision highp float;
varying vec2 vNdc;
uniform sampler2D uTex;
uniform float uYaw, uPitch, uFov, uAspect;
const float PI = 3.14159265358979;
void main() {
  float t = tan(uFov * 0.5);
  vec3 d = normalize(vec3(vNdc.x * t * uAspect, vNdc.y * t, -1.0));
  // pitch (X axis)
  float cp = cos(uPitch), sp = sin(uPitch);
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  // yaw (Y axis)
  float cy = cos(uYaw), sy = sin(uYaw);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
  vec2 uv = vec2(atan(d.x, -d.z) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI);
  gl_FragColor = texture2D(uTex, uv);
}
`;

class Visor360 extends HTMLElement {
  connectedCallback() {
    if (this._init) return;
    this._init = true;
    this.style.display = 'block';
    this.style.position = this.style.position || 'relative';
    this.style.touchAction = 'none';
    this.style.overflow = 'hidden';
    this.style.cursor = 'grab';

    this.yaw = 0; this.pitch = 0; this.gYaw = 0; this.gPitch = 0; this.fov = 75 * Math.PI / 180;
    this.vYaw = 0; this.vPitch = 0;
    this.gyroOn = false; this._gyroRef = null;
    this._dirty = true;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    this.appendChild(canvas);
    this.canvas = canvas;

    // UI hint
    const hint = document.createElement('div');
    hint.textContent = 'Arrastra para explorar · 360°';
    hint.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);padding:6px 14px;border-radius:999px;background:rgba(14,11,22,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em;pointer-events:none;transition:opacity .6s ease;font-family:inherit';
    this.appendChild(hint);
    this._hint = hint;

    // Gyroscope toggle (mobile)
    if (typeof DeviceOrientationEvent !== 'undefined' && ('ontouchstart' in window || typeof DeviceOrientationEvent.requestPermission === 'function')) {
      const gbtn = document.createElement('button');
      gbtn.type = 'button';
      gbtn.setAttribute('aria-label', 'Activar giroscopio');
      gbtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><ellipse cx="12" cy="12" rx="10" ry="4.2"></ellipse><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"></ellipse></svg>';
      gbtn.style.cssText = 'position:absolute;top:12px;left:12px;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.3);background:rgba(14,11,22,.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;cursor:pointer;transition:background .3s';
      gbtn.addEventListener('click', () => this._toggleGyro(gbtn));
      this.appendChild(gbtn);
    }

    this._setupGL();
    this._loadTexture(this.getAttribute('src'));
    this._bindPointer();

    this._onWheel = (e) => {
      e.preventDefault();
      this.fov = Math.min(100 * Math.PI / 180, Math.max(40 * Math.PI / 180, this.fov + e.deltaY * 0.0012));
      this._dirty = true;
    };
    this.addEventListener('wheel', this._onWheel, { passive: false });

    this._ro = new ResizeObserver(() => { this._resize(); });
    this._ro.observe(this);
    this._resize();

    const loop = () => {
      if (!this.isConnected) return;
      this._raf = requestAnimationFrame(loop);
      // inertia
      if (!this._dragging && (Math.abs(this.vYaw) > 0.00002 || Math.abs(this.vPitch) > 0.00002)) {
        this.yaw += this.vYaw; this.pitch = this._clampPitch(this.pitch + this.vPitch);
        this.vYaw *= 0.94; this.vPitch *= 0.94;
        this._dirty = true;
      }
      if (this._dirty) { this._draw(); this._dirty = false; }
    };
    loop();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this._gyroHandler) window.removeEventListener('deviceorientation', this._gyroHandler);
  }

  _clampPitch(p) { return Math.max(-1.45, Math.min(1.45, p)); }

  _setupGL() {
    const gl = this.canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
    this.gl = gl;
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {
      yaw: gl.getUniformLocation(prog, 'uYaw'),
      pitch: gl.getUniformLocation(prog, 'uPitch'),
      fov: gl.getUniformLocation(prog, 'uFov'),
      aspect: gl.getUniformLocation(prog, 'uAspect')
    };
  }

  _loadTexture(src) {
    if (!src || !this.gl) return;
    const gl = this.gl;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._ready = true;
      this._dirty = true;
    };
    img.src = src;
  }

  _bindPointer() {
    // Multi-pointer: 1 finger/mouse = drag, 2 fingers = pinch zoom
    this._pts = new Map();
    let lx = 0, ly = 0, pinchD = 0, pinchFov = 0;
    const down = (e) => {
      this._pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.setPointerCapture(e.pointerId);
      if (this._pts.size === 1) {
        this._dragging = true;
        lx = e.clientX; ly = e.clientY;
        this.vYaw = 0; this.vPitch = 0;
        this.style.cursor = 'grabbing';
        if (this._hint) this._hint.style.opacity = '0';
      } else if (this._pts.size === 2) {
        const [a, b] = [...this._pts.values()];
        pinchD = Math.hypot(a.x - b.x, a.y - b.y);
        pinchFov = this.fov;
        this._dragging = false;
        this.vYaw = 0; this.vPitch = 0;
      }
    };
    const move = (e) => {
      if (!this._pts.has(e.pointerId)) return;
      this._pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pts.size >= 2) {
        const [a, b] = [...this._pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD > 0 && d > 0) {
          this.fov = Math.min(100 * Math.PI / 180, Math.max(40 * Math.PI / 180, pinchFov * pinchD / d));
          this._dirty = true;
        }
        return;
      }
      if (!this._dragging) return;
      const k = this.fov / this.clientHeight;
      const dYaw = -(e.clientX - lx) * k;
      const dPitch = -(e.clientY - ly) * k; // drag down -> look down
      this.yaw += dYaw;
      this.pitch = this._clampPitch(this.pitch + dPitch);
      this.vYaw = dYaw; this.vPitch = dPitch;
      lx = e.clientX; ly = e.clientY;
      this._dirty = true;
    };
    const up = (e) => {
      this._pts.delete(e.pointerId);
      if (this._pts.size === 1) {
        const [a] = [...this._pts.values()];
        lx = a.x; ly = a.y;
        pinchD = 0;
        this._dragging = true;
      } else if (this._pts.size === 0) {
        this._dragging = false;
        pinchD = 0;
        this.style.cursor = 'grab';
      }
    };
    this.addEventListener('pointerdown', down);
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', up);
    this.addEventListener('pointercancel', up);
  }

  async _toggleGyro(btn) {
    if (this.gyroOn) {
      this.gyroOn = false;
      btn.style.background = 'rgba(14,11,22,.45)';
      if (this._gyroHandler) window.removeEventListener('deviceorientation', this._gyroHandler);
      // Fold the gyro offset into the base view so nothing jumps
      this.yaw += this.gYaw; this.pitch = this._clampPitch(this.pitch + this.gPitch);
      this.gYaw = 0; this.gPitch = 0;
      this._dirty = true;
      return;
    }
    // iOS requires explicit permission
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch (e) { return; }
    }
    this.gyroOn = true;
    this._gyroRef = null;
    btn.style.background = 'rgba(139,92,246,.75)';
    this._gyroHandler = (e) => {
      if (!this.gyroOn || e.alpha == null) return;
      const a = e.alpha * Math.PI / 180, b = e.beta * Math.PI / 180;
      if (!this._gyroRef) this._gyroRef = { a, b };
      // Gyro contributes an additive offset, so touch-drag keeps working at the same time
      this.gYaw = a - this._gyroRef.a;
      this.gPitch = b - this._gyroRef.b;
      this._dirty = true;
    };
    window.addEventListener('deviceorientation', this._gyroHandler);
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      if (this.gl) this.gl.viewport(0, 0, w, h);
      this._dirty = true;
    }
  }

  _draw() {
    const gl = this.gl;
    if (!gl || !this._ready) return;
    gl.uniform1f(this.u.yaw, this.yaw + this.gYaw);
    gl.uniform1f(this.u.pitch, this._clampPitch(this.pitch + this.gPitch));
    gl.uniform1f(this.u.fov, this.fov);
    gl.uniform1f(this.u.aspect, this.canvas.width / this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

if (!customElements.get('visor-360')) customElements.define('visor-360', Visor360);
