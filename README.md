# 다빈치 코드 3D

다빈치 코드(Algo) 보드게임을 Three.js로 만든 웹 3D 게임입니다. 아이패드 Safari에 맞춰 만들었습니다(터치 조작, 가로·세로 화면 지원).

- **혼자 하기**: 나 1명 + AI 3명. Firebase 없이 동작합니다.
- **온라인 (4명)**: Firebase Realtime Database로 방을 만들고, 방 코드로 들어옵니다. 4명이 모이면 자동으로 시작합니다.

## 플레이 방법

- **고개 돌리기**: 화면을 좌우(위아래)로 드래그합니다. `정면` 버튼을 누르면 시점이 처음으로 돌아갑니다.
- **뽑기**: 내 차례에 가운데 더미의 타일을 탭합니다. 타일 뒷면 색이 보이므로 검은색과 흰색 중 원하는 색을 골라 뽑을 수 있습니다.
- **추리**: 상대의 숨겨진 타일을 탭한 뒤 숫자(0~11, 조커)를 고릅니다.
  - 맞히면 그 타일이 뒤집혀 공개됩니다. `계속 추리`나 `멈추기`를 고릅니다(멈추면 뽑은 타일은 숨긴 채 내 줄에 들어갑니다).
  - 틀리면 뽑은 타일이 공개된 채로 내 줄에 들어갑니다.
- 조커처럼 놓을 자리를 고를 수 있는 타일은 자리 선택 창이 뜹니다.
- 화면 위쪽에서 차례, 더미 수, 각 플레이어의 공개된 타일과 틀린 추리 기록(`≠3` 등)을 볼 수 있고, `기록` 버튼으로 진행 로그를 엽니다.

## 온라인 플레이

1. 한 사람이 이름을 넣고 **방 만들기**를 누르면 5자리 방 코드가 나옵니다. **초대 링크 공유**로 링크를 보낼 수도 있습니다.
2. 다른 사람은 방 코드를 넣고 **입장**을 누릅니다. 초대 링크로 열면 코드가 미리 채워져 있습니다.
3. 4명이 모이면 자동으로 시작합니다. 방장은 **빈자리 AI로 채우고 시작**으로 4명이 안 돼도 시작할 수 있습니다.
4. 게임 중에 나가거나 연결이 3초 넘게 끊기면 그 자리는 AI가 이어서 합니다. 같은 탭에서 새로고침한 뒤 같은 코드로 다시 입장하면 원래 자리로 돌아옵니다.
5. 방장이 나가도 게임은 계속됩니다. 남은 사람 중 한 명이 자동으로 방장을 이어받습니다.

### 숨긴 숫자는 어떻게 지키나

- 게임 진행은 **방장 브라우저**가 맡습니다. 방장은 공개 정보만 담은 상태(`public`)와 사람마다 자기 타일 숫자만 담은 상태(`private/{내 uid}`)를 따로 올립니다.
- `database.rules.json` 보안 규칙 때문에 `private/{uid}`는 본인만 읽을 수 있습니다. 다른 사람 브라우저에는 남의 숨긴 숫자가 아예 내려오지 않습니다.
- 타일 id도 판마다 무작위로 섞기 때문에, id만 보고 숫자를 알아낼 수는 없습니다.
- **한계**: 방장 브라우저는 게임 전체 상태를 갖고 있습니다. 그래서 개발자 도구를 다룰 줄 아는 방장이라면 남의 숫자를 볼 수 있습니다. 친구끼리 하는 게임에는 충분하지만, 완전히 막으려면 게임 진행을 서버(Cloud Functions, 유료 Blaze 요금제)로 옮겨야 합니다.

## Firebase 설정 (온라인용)

### 1. 프로젝트 만들기

1. <https://console.firebase.google.com> 에 Google 계정으로 들어가 **프로젝트 추가**를 누릅니다.
2. 이름(예: `davinci-code`)을 정합니다. Google 애널리틱스는 꺼도 됩니다.

### 2. 익명 로그인 켜기

1. 왼쪽 메뉴 **빌드 → Authentication → 시작하기**를 누릅니다.
2. **Sign-in method** 탭에서 **익명**을 골라 **사용 설정**한 뒤 저장합니다.
   (플레이어는 따로 가입하지 않아도 되고, 보안 규칙이 사람을 구분하는 데만 씁니다.)

### 3. Realtime Database 만들기와 규칙 넣기

1. **빌드 → Realtime Database → 데이터베이스 만들기**를 누릅니다.
2. 위치는 한국에서 가까운 **싱가포르(asia-southeast1)**를 추천합니다. **잠금 모드로 시작**을 고릅니다.
3. **규칙** 탭을 열고, 이 저장소의 `database.rules.json` 내용을 통째로 붙여넣은 뒤 **게시**합니다.

### 4. 웹 앱 등록 → 설정값 넣기

1. 프로젝트 개요 옆 **톱니바퀴 → 프로젝트 설정 → 일반** 탭 아래 **내 앱**에서 웹 아이콘(`</>`)을 누릅니다.
2. 앱 닉네임을 넣고 등록합니다. Firebase Hosting은 체크하지 않습니다(GitHub Pages를 씁니다).
3. 화면에 나오는 `firebaseConfig = { ... }` 값을 이 저장소의 **`firebase-config.js`**에 그대로 붙여넣습니다.

```js
// firebase-config.js
export const firebaseConfig = {
  apiKey: 'AIza...',
  authDomain: 'davinci-code-xxxx.firebaseapp.com',
  databaseURL: 'https://davinci-code-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'davinci-code-xxxx',
  storageBucket: 'davinci-code-xxxx.appspot.com',
  messagingSenderId: '...',
  appId: '1:...:web:...',
};
```

- `databaseURL`이 비어 있으면 Realtime Database 화면 위쪽에 보이는 주소(`https://...firebasedatabase.app`)를 넣습니다.
- 이 값들은 웹페이지에 공개되어도 되는 값입니다. 실제 보호는 3단계의 보안 규칙이 맡습니다.

### 5. 배포 주소 허용

1. **Authentication → 설정 → 승인된 도메인**에 `<GitHub 계정>.github.io`를 추가합니다.
2. `firebase-config.js`를 커밋하고 푸시하면 GitHub Pages에 반영됩니다. 시작 화면의 온라인 버튼이 켜지면 설정이 끝난 것입니다.

무료 요금제(Spark)로 충분합니다. 동시 접속 100명, 저장 1GB까지 쓸 수 있습니다. 끝난 방 데이터는 자동으로 지워지지 않습니다. 가끔 Realtime Database 화면에서 `rooms`를 지워 주세요.

## 규칙 정리

- 검은 타일과 흰 타일이 각각 0~11, 색마다 조커(–)가 1개씩 있어 모두 26개입니다.
- 4명이 각자 3개씩 받고 시작합니다.
- 타일은 왼쪽부터 오름차순으로 놓고, 같은 숫자면 검은색이 왼쪽입니다. 조커는 원하는 자리에 놓습니다.
- 숨긴 타일이 모두 공개된 플레이어는 탈락하고, 마지막 1명이 승리합니다.
- (보충 규칙) 더미가 비면 뽑지 않고 추리합니다. 이때 틀리면 내 숨긴 타일 중 하나를 골라 공개합니다.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `src/game.js` | 게임 규칙과 상태(순수 로직, DOM·Three.js를 쓰지 않음) |
| `src/ai.js` | AI의 추리 판단(공개된 정보만 사용) |
| `src/engine.js` | 게임 진행 엔진: 행동 검증, AI 자리 진행, 공개/비공개 상태 만들기 |
| `src/view.js` | 공개 상태와 내 비공개 상태를 합쳐 화면용 데이터로 만듦 |
| `src/table.js` | 내 자리의 화면 진행: 상태를 그리고 내 차례에 입력을 받음 |
| `src/online.js` | 온라인 방: 만들기·입장·대기실·나간 자리 AI 대체·방장 교체 |
| `src/net/firebase.js` | Firebase SDK 연결 래퍼 (gstatic CDN에서 필요할 때만 불러옴) |
| `src/scene.js` | Three.js 3D 화면: 테이블, 타일, 애니메이션, 시점 회전, 터치 판정 |
| `src/ui.js` | 화면 위 2D UI: 공개 정보, 숫자 선택, 버튼, 알림 |
| `src/main.js` | 시작 화면, 대기실, 게임 화면 연결 |
| `firebase-config.js` | Firebase 설정값 (직접 채워 넣기) |
| `database.rules.json` | Realtime Database 보안 규칙 |
| `vendor/` | Three.js r160 (빌드 없이 바로 쓰도록 포함, MIT 라이선스) |

빌드 과정이 없는 정적 사이트입니다.

## 로컬 실행

```sh
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 열기
```

ES 모듈을 쓰기 때문에 `index.html`을 파일로 바로 열면 동작하지 않습니다. 반드시 웹 서버로 열어야 합니다.

규칙과 엔진 테스트(Node 18 이상): `npm install` 후 `npm test`

### Firebase 에뮬레이터로 온라인 테스트

실제 Firebase 프로젝트 없이 내 컴퓨터에서 온라인 기능을 시험할 수 있습니다. Java 11 이상이 필요합니다.

```sh
npm install
npm run test:online          # 에뮬레이터에서 4명 시나리오와 보안 규칙 자동 테스트

# 직접 해 보기: 에뮬레이터를 켜 두고
npx firebase emulators:start --only auth,database --project demo-davinci
# 다른 터미널에서 웹 서버를 띄운 뒤, 브라우저 탭 4개로 http://localhost:8000/?emulator 열기
```

## GitHub Pages 배포

1. 저장소의 **Settings → Pages**로 갑니다.
2. **Source**를 `Deploy from a branch`로 하고, 배포할 브랜치와 `/ (root)`를 고릅니다.
3. 잠시 뒤 `https://<계정>.github.io/<저장소>/` 주소로 접속합니다.
