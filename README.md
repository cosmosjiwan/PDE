# PDE Playground

브라우저에서 **실시간으로 편미분방정식(PDE)을 풀고 시각화**하는 인터랙티브 툴입니다.
[VisualPDE](https://visualpde.com) 에서 영감을 받아, GPU(WebGL2 fragment shader)에서
유한차분법으로 PDE 를 직접 적분합니다. 별도 빌드 과정이나 의존성이 없습니다.

![heat / wave / plate](https://img.shields.io/badge/WebGL2-realtime-58a6ff)

## 지원하는 방정식

| 방정식 | 형태 | 특징 |
|---|---|---|
| **열 방정식** | ∂u/∂t = D ∇²u | 확산·평활화 |
| **파동 방정식** | ∂²u/∂t² = c² ∇²u − γ ∂u/∂t | 파동 전파·반사 |
| **비균질 파동** | ∂²u/∂t² = c²(x) ∇²u + f(x,t) | 공간 가변 속도(굴절) + 진동 강제항 |
| **판 방정식** | ∂²u/∂t² = −D ∇⁴u − γ ∂u/∂t | 4차(biharmonic) 분산성 진동 |

## 실행

### 방법 1 — 단일 파일 (가장 간단)

**[`pde-playground.html`](pde-playground.html)** 한 파일만 받아서 브라우저로 **더블클릭/열기** 하면 끝입니다.
모든 CSS·JS 가 인라인되어 있어 서버 없이 `file://` 로 바로 동작합니다.

### 방법 2 — 모듈 버전 (개발용)

`index.html` + `js/` + `css/` 구조는 ES 모듈을 쓰므로 정적 서버가 필요합니다.

```bash
# 저장소 루트에서
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

> 모듈 버전(`index.html`)은 `file://` 로 직접 열면 동작하지 않습니다. 서버 없이 쓰려면 `pde-playground.html` 을 쓰세요.

### 단일 파일 다시 만들기

`js/`·`css/` 를 수정한 뒤 단일 파일을 갱신하려면:

```bash
node build.mjs   # → pde-playground.html 재생성
```

> 캐시버스팅: `index.html`은 `css/style.css?v=...`, `js/main.js?v=...`(+ `main.js`
> 내부 import의 `?v=...`)로 정적 파일 버전을 관리합니다. CSS/JS를 수정해 배포할
> 때는 이 `?v=` 값을 함께 올리면 브라우저가 새 파일을 즉시 받아갑니다.

## 사용법

- **방정식 선택** — 좌측 상단 드롭다운
- **클릭 / 드래그** — 그 위치에 교란(열·파동)을 실시간 주입 (모바일 터치 지원)
- **파라미터 슬라이더** — 확산계수, 파동속도, 감쇠, 강성 등을 즉석에서 조절
- **시각화** — 컬러맵, 대비(gain), 격자 해상도(128/256/512), 시뮬 속도, 붓 크기
- **버튼** — 일시정지 / 중앙 자극(가우시안) / 초기화

## 동작 원리

- 상태장은 `N×N` 의 `RGBA32F` 부동소수점 텍스처에 저장됩니다 (R = u, G = ∂u/∂t).
- 매 스텝마다 update fragment shader 가 이웃 텍셀을 읽어 명시적(explicit) 시간적분으로
  다음 상태를 **다른 텍스처**에 씁니다 (ping-pong 기법).
- 시뮬레이션은 *격자 단위*(dx = 1)에서 수행되어, 명시적 스킴이 안정적이면서도
  시각적으로 생동감 있는 dt 값을 사용합니다.
- 라플라시안은 5점 스텐실, 판 방정식의 ∇⁴ 는 13점 biharmonic 스텐실을 사용합니다.
- 별도 render pass 가 장(field)을 `tanh` 로 정규화한 뒤 컬러맵을 적용해 화면에 그립니다.

## 새 방정식 추가하기

`js/equations.js` 의 `EQUATIONS` 배열에 항목을 하나 추가하면 됩니다. GLSL `body`
안에서 `u`, `v`, `lap`, `Uo(offset)`, `u_dt`, `u_time`, `u_p0..u_p3`, `v_uv` 를 사용해
`newU`, `newV` 를 정의하면 자동으로 UI(슬라이더 포함)에 연결됩니다.

## 파일 구조

```
index.html          레이아웃 + 컨트롤
css/style.css       스타일
js/equations.js     방정식 정의 (GLSL 업데이트 본문 + 파라미터)
js/solver.js        WebGL2 ping-pong 솔버 엔진
js/main.js          UI 연결 · 입력 처리 · 렌더 루프
```

## 요구 사항

WebGL2 와 부동소수점 텍스처 렌더링(`EXT_color_buffer_float`)을 지원하는 브라우저.
최신 Chrome / Edge / Firefox / Safari 에서 동작합니다.
