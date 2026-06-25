// WebGL2 ping-pong PDE solver.
//
// State lives in an N x N RGBA32F texture: channel R = u (field), G = v (∂u/∂t).
// Each solver step runs an update fragment shader that reads neighbouring
// texels and writes the next state into the other texture (ping-pong). A
// separate render pass maps the field through a colormap onto the screen.

const VERT_SRC = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

function updateFragSrc(body) {
  return /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_state;
uniform vec2 u_texel;            // 1.0 / N
uniform float u_dt;
uniform float u_time;
uniform float u_p0, u_p1, u_p2, u_p3;
uniform vec3 u_mouse;            // xy = uv position, z = brush amplitude (0 = inactive)
uniform float u_brushR;          // brush radius in uv units

float Uo(vec2 off) { return texture(u_state, v_uv + off * u_texel).x; }
float Vo(vec2 off) { return texture(u_state, v_uv + off * u_texel).y; }

void main() {
  vec4 st = texture(u_state, v_uv);
  float u = st.x;
  float v = st.y;
  float lap = Uo(vec2(1.0,0.0)) + Uo(vec2(-1.0,0.0))
            + Uo(vec2(0.0,1.0)) + Uo(vec2(0.0,-1.0)) - 4.0 * u;

  float newU = u;
  float newV = v;

  ${body}

  // Interactive brush: inject a Gaussian bump while the pointer is down.
  if (u_mouse.z != 0.0) {
    vec2 d = v_uv - u_mouse.xy;
    float fall = exp(-dot(d, d) / (u_brushR * u_brushR));
    newU += u_mouse.z * fall;
  }

  outColor = vec4(newU, newV, 0.0, 1.0);
}`;
}

const RENDER_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_state;
uniform float u_gain;
uniform int u_cmap;

vec3 colormap(int id, float t) {
  t = clamp(t, 0.0, 1.0);
  if (id == 0) { // coolwarm
    vec3 c1 = vec3(0.23, 0.30, 0.75);
    vec3 c2 = vec3(0.90, 0.90, 0.90);
    vec3 c3 = vec3(0.71, 0.02, 0.15);
    return t < 0.5 ? mix(c1, c2, t * 2.0) : mix(c2, c3, (t - 0.5) * 2.0);
  } else if (id == 1) { // fire
    vec3 c = mix(vec3(0.0, 0.0, 0.05), vec3(0.7, 0.0, 0.0), smoothstep(0.0, 0.4, t));
    c = mix(c, vec3(1.0, 0.6, 0.0), smoothstep(0.35, 0.72, t));
    c = mix(c, vec3(1.0, 1.0, 0.88), smoothstep(0.72, 1.0, t));
    return c;
  } else if (id == 2) { // spectral (IQ cosine palette)
    return vec3(0.5) + vec3(0.5) * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
  } else if (id == 3) { // ocean
    return mix(vec3(0.0, 0.04, 0.18), vec3(0.45, 0.92, 1.0), t);
  }
  return vec3(t); // grayscale
}

void main() {
  float u = texture(u_state, v_uv).x;
  float t = 0.5 + 0.5 * tanh(u * u_gain);
  outColor = vec4(colormap(u_cmap, t), 1.0);
}`;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("Shader compile error:\n" + log + "\n\n" + src);
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("Program link error:\n" + gl.getProgramInfoLog(prog));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

export class Solver {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, depth: false });
    if (!gl) throw new Error("이 브라우저는 WebGL2 를 지원하지 않습니다.");
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("이 브라우저는 부동소수점 텍스처 렌더링(EXT_color_buffer_float)을 지원하지 않습니다.");
    }
    this.linearOK = !!gl.getExtension("OES_texture_float_linear");
    this.gl = gl;
    this.canvas = canvas;
    this.N = 256;
    this.time = 0;
    this.mouse = [0, 0, 0]; // x, y, amp
    this.brushR = 0.03;
    this.gain = 1.4;
    this.cmap = 0;
    this.params = [0, 0, 0, 0];

    // Fullscreen quad.
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    this.renderProg = createProgram(gl, VERT_SRC, RENDER_FRAG_SRC);
    this.updateProg = null;
    this.textures = [];
    this.fbos = [];
    this.src = 0;

    this._allocTextures(this.N);
  }

  _allocTextures(N) {
    const gl = this.gl;
    // Clean up previous resources.
    this.textures.forEach((t) => gl.deleteTexture(t));
    this.fbos.forEach((f) => gl.deleteFramebuffer(f));
    this.textures = [];
    this.fbos = [];

    const filter = this.linearOK ? gl.LINEAR : gl.NEAREST;
    const zeros = new Float32Array(N * N * 4);
    for (let i = 0; i < 2; i++) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, zeros);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

      this.textures.push(tex);
      this.fbos.push(fbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.N = N;
    this.src = 0;
  }

  setResolution(N) {
    if (N === this.N) return;
    this._allocTextures(N);
    this.time = 0;
  }

  setEquation(eq) {
    const gl = this.gl;
    if (this.updateProg) gl.deleteProgram(this.updateProg);
    this.updateProg = createProgram(gl, VERT_SRC, updateFragSrc(eq.body));
    this.eq = eq;
    this.time = 0;
  }

  setParams(arr) {
    for (let i = 0; i < 4; i++) this.params[i] = arr[i] || 0;
  }

  setMouse(x, y, amp) {
    this.mouse = [x, y, amp];
  }

  _bindQuad(prog) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  // Advance the simulation by `n` solver steps.
  step(n) {
    const gl = this.gl;
    if (!this.updateProg) return;
    gl.useProgram(this.updateProg);
    this._bindQuad(this.updateProg);
    gl.viewport(0, 0, this.N, this.N);

    const P = this.updateProg;
    const loc = (name) => gl.getUniformLocation(P, name);
    gl.uniform2f(loc("u_texel"), 1 / this.N, 1 / this.N);
    gl.uniform1f(loc("u_dt"), this.eq.dt);
    gl.uniform1f(loc("u_p0"), this.params[0]);
    gl.uniform1f(loc("u_p1"), this.params[1]);
    gl.uniform1f(loc("u_p2"), this.params[2]);
    gl.uniform1f(loc("u_p3"), this.params[3]);
    gl.uniform1f(loc("u_brushR"), this.brushR);
    gl.uniform1i(loc("u_state"), 0);
    const timeLoc = loc("u_time");
    const mouseLoc = loc("u_mouse");

    for (let i = 0; i < n; i++) {
      const dst = 1 - this.src;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[dst]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[this.src]);
      gl.uniform1f(timeLoc, this.time);
      gl.uniform3f(mouseLoc, this.mouse[0], this.mouse[1], this.mouse[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.src = dst;
      this.time += this.eq.dt;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.renderProg);
    this._bindQuad(this.renderProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[this.src]);
    gl.uniform1i(gl.getUniformLocation(this.renderProg, "u_state"), 0);
    gl.uniform1f(gl.getUniformLocation(this.renderProg, "u_gain"), this.gain);
    gl.uniform1i(gl.getUniformLocation(this.renderProg, "u_cmap"), this.cmap);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Reset the field. If `seed` is true, drop a Gaussian bump in the centre.
  reset(seed = false) {
    const gl = this.gl;
    const N = this.N;
    const data = new Float32Array(N * N * 4);
    if (seed) {
      const cx = N / 2;
      const cy = N / 2;
      const sigma = N * 0.04;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const r2 = (x - cx) ** 2 + (y - cy) ** 2;
          data[(y * N + x) * 4] = Math.exp(-r2 / (2 * sigma * sigma));
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, data);
    }
    this.src = 0;
    this.time = 0;
  }
}
