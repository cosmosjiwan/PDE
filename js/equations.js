// Equation definitions.
//
// Each equation provides a GLSL "body" that is injected into the update shader
// template (see solver.js). The simulation works in *grid units* (dx = 1), so
// the discrete Laplacian is just the 5-point stencil with no 1/dx^2 factor.
// This keeps the explicit time-stepping stable with friendly dt values and
// makes the dynamics visually lively, exactly like browser PDE demos.
//
// Available inside the GLSL body:
//   u, v            : current field value and its time-derivative (channels x,y)
//   lap             : discrete Laplacian of u  (sum of 4 neighbours - 4u)
//   Uo(vec2 off)    : sample u at an integer texel offset
//   Vo(vec2 off)    : sample v at an integer texel offset
//   u_dt, u_time    : timestep and accumulated simulation time
//   u_p0..u_p3      : the equation's parameters, in the order listed in `params`
//   v_uv            : normalized coordinate of the current cell, in [0,1]^2
// The body must assign `newU` and `newV` (the next state).

export const EQUATIONS = [
  {
    id: "heat",
    name: "열 방정식 (Heat)",
    formula: "∂u/∂t = D ∇²u",
    desc:
      "확산 방정식. 임의의 분포가 시간이 지나며 부드럽게 퍼지고 평탄해집니다. " +
      "캔버스를 클릭해 열을 주입해 보세요.",
    dt: 0.4,
    substeps: 6,
    gain: 1.4,
    brushAmp: 1.0,
    params: [
      { key: "p0", name: "확산계수 D", min: 0.02, max: 0.25, step: 0.005, value: 0.18 },
    ],
    body: /* glsl */ `
      newU = u + u_dt * u_p0 * lap;
      newV = 0.0;
    `,
  },

  {
    id: "wave",
    name: "파동 방정식 (Wave)",
    formula: "∂²u/∂t² = c² ∇²u − γ ∂u/∂t",
    desc:
      "2차 시간 미분 파동 방정식. 교란이 파동으로 퍼져나가며 경계에서 반사됩니다. " +
      "감쇠 γ 를 0 으로 두면 거의 영원히 진동합니다.",
    dt: 0.35,
    substeps: 4,
    gain: 1.6,
    brushAmp: 0.9,
    params: [
      { key: "p0", name: "파동속도² c²", min: 0.1, max: 2.5, step: 0.05, value: 1.0 },
      { key: "p1", name: "감쇠 γ", min: 0.0, max: 0.05, step: 0.001, value: 0.0 },
    ],
    body: /* glsl */ `
      float c2 = u_p0;
      float damp = u_p1;
      newV = v + u_dt * (c2 * lap - damp * v);
      newU = u + u_dt * newV;
    `,
  },

  {
    id: "inhomwave",
    name: "비균질 파동 (Inhomogeneous Wave)",
    formula: "∂²u/∂t² = c²(x) ∇²u + f(x,t)",
    desc:
      "매질의 파동속도가 공간에 따라 변하고(왼쪽 느림 → 오른쪽 빠름), 왼쪽에 " +
      "진동하는 강제항 f 가 파동을 계속 만들어냅니다. 굴절·산란을 관찰하세요.",
    dt: 0.3,
    substeps: 4,
    gain: 1.8,
    brushAmp: 0.8,
    params: [
      { key: "p0", name: "속도 스케일", min: 0.2, max: 2.0, step: 0.05, value: 1.0 },
      { key: "p1", name: "감쇠 γ", min: 0.0, max: 0.03, step: 0.001, value: 0.004 },
      { key: "p2", name: "강제항 진폭", min: 0.0, max: 1.5, step: 0.05, value: 0.7 },
      { key: "p3", name: "강제항 주파수", min: 0.0, max: 1.0, step: 0.01, value: 0.28 },
    ],
    body: /* glsl */ `
      // Spatially varying wave speed: smooth gradient across x.
      float c2 = u_p0 * (0.3 + 1.1 * v_uv.x);
      float damp = u_p1;
      // Oscillating point source on the left.
      vec2 ds = v_uv - vec2(0.18, 0.5);
      float src = u_p2 * sin(u_p3 * u_time) * exp(-dot(ds, ds) / 0.0009);
      newV = v + u_dt * (c2 * lap - damp * v + src);
      newU = u + u_dt * newV;
    `,
  },

  {
    id: "plate",
    name: "판 방정식 (Plate / Biharmonic)",
    formula: "∂²u/∂t² = −D ∇⁴u − γ ∂u/∂t",
    desc:
      "4차 미분(중조화) 판 진동 방정식. 얇은 금속판처럼 뻣뻣하게 진동하며, " +
      "파동 방정식과 달리 잔물결이 분산(dispersion)되어 퍼지는 패턴이 나타납니다.",
    dt: 0.18,
    substeps: 5,
    gain: 2.8,
    brushAmp: 0.7,
    params: [
      { key: "p0", name: "강성 D", min: 0.005, max: 0.08, step: 0.001, value: 0.045 },
      { key: "p1", name: "감쇠 γ", min: 0.0, max: 0.02, step: 0.0005, value: 0.001 },
    ],
    body: /* glsl */ `
      // 13-point biharmonic (∇⁴u) stencil, dx = 1.
      float biharm =
          20.0 * u
        - 8.0 * (Uo(vec2(1.0,0.0)) + Uo(vec2(-1.0,0.0)) + Uo(vec2(0.0,1.0)) + Uo(vec2(0.0,-1.0)))
        + 2.0 * (Uo(vec2(1.0,1.0)) + Uo(vec2(1.0,-1.0)) + Uo(vec2(-1.0,1.0)) + Uo(vec2(-1.0,-1.0)))
        + 1.0 * (Uo(vec2(2.0,0.0)) + Uo(vec2(-2.0,0.0)) + Uo(vec2(0.0,2.0)) + Uo(vec2(0.0,-2.0)));
      float D = u_p0;
      float damp = u_p1;
      newV = v - u_dt * (D * biharm + damp * v);
      newU = u + u_dt * newV;
    `,
  },
];

export function getEquation(id) {
  return EQUATIONS.find((e) => e.id === id) || EQUATIONS[0];
}
