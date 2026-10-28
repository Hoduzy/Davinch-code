// ===================================================================
//  상점 아이템 / 가격 / 재화 설정 — 이 파일만 고치면 됩니다
// ===================================================================
//  고친 뒤에는: 게임 → 설정 → 관리자 → [상점·재화 설정 서버에 올리기] 를 눌러야
//  보안 규칙(서버)이 새 가격과 보상 값을 알게 됩니다. (안 누르면 구매/보상이 거절될 수 있어요)
//
//  항목 공통:
//    id        고유 이름 (영문/숫자/_ 만, 바꾸면 이미 산 사람의 보유 기록과 연결이 끊김)
//    category  'skin' | 'tile' | 'effectCorrect' | 'effectWin'
//    name      상점에 보이는 이름
//    price     가격 (0이면 모두가 기본으로 가지고 있음)
//    rarity    'common' | 'rare' | 'epic' | 'legendary'
//    enabled   false면 상점에 안 보임 (생략하면 true)
// ===================================================================

/** 재화 규칙 */
export const ECONOMY = {
  currencyName: '코인',
  startCoins: 1000,        // 처음 가입하면 받는 코인
  dailyBonus: 200,         // 매일 첫 접속 보상
  bailoutBelow: 100,       // 잔액이 이 값보다 적으면
  bailoutAmount: 300,      //   하루 1번 이만큼 구제금
  aiWinReward: 100,        // AI 대전 승리 보상
  aiDailyCap: 5,           // AI 대전 보상은 하루 최대 몇 번
  aiMinIntervalSec: 90,    // AI 대전 보상 사이 최소 간격(초) — 연속 부정 수령 방지
  dayResetHour: 0,         // 하루가 바뀌는 시각 (한국 시간 기준, 0 = 자정)
  betOptions: [0, 50, 100, 200, 500], // 온라인 방 만들 때 고를 수 있는 베팅액 (0 = 베팅 없음)
};

/** 희귀도 표시 */
export const RARITY = {
  common: { label: '일반', color: '#9e9e9e' },
  rare: { label: '희귀', color: '#42a5f5' },
  epic: { label: '영웅', color: '#ab47bc' },
  legendary: { label: '전설', color: '#ffb300' },
};

/** AI 상대가 무작위로 고르는 스킨 (그 판에 고른 스킨 파일만 불러옴) */
export const AI_SKINS = ['skin_basic', 'skin_shinku', 'skin_mana'];

// -------------------------------------------------------------------
//  캐릭터 스킨 (VRM)
//    file       VRM 파일 경로 (assets/characters/ 에 넣기). null이면 기본 인형
//    thumbnail  상점 썸네일 이미지 (없으면 이름 첫 글자로 표시)
//               tools/thumbnail.html?file=assets/characters/xxx.vrm 에서 만들 수 있음
//    sizeMB     파일 크기 (상점에 표시, 불러오기 시간 안내용)
//    credit     크레딧 페이지에 표시 { author, license, url, note }
//  새 스킨 추가: VRM 파일과 썸네일을 넣고 아래에 항목 하나 추가 → 서버에 설정 올리기
// -------------------------------------------------------------------
const SKINS = [
  {
    id: 'skin_basic',
    name: '기본 인형',
    price: 0,
    rarity: 'common',
    file: null,
    thumbnail: null,
    credit: null,
  },
  {
    id: 'skin_shinku',
    name: 'Shinku',
    price: 1500,
    rarity: 'epic',
    file: 'assets/characters/shinku.vrm',
    thumbnail: 'assets/characters/thumbs/shinku.png',
    sizeMB: 28.7,
    credit: {
      author: 'Hotta Studio',
      license: 'VRM Public License 1.0 — 개인 비영리 이용, 크레딧 표기 필요, 재배포 허용',
      url: 'https://vrm.dev/licenses/1.0/',
    },
  },
  {
    id: 'skin_mana',
    name: 'Mana (HHD Combat Suit)',
    price: 1200,
    rarity: 'rare',
    file: 'assets/characters/mana.vrm',
    thumbnail: 'assets/characters/thumbs/mana.png',
    sizeMB: 30.5,
    credit: {
      author: 'wev',
      license: 'VRoid Hub 이용 조건 — 크레딧 표기 필요, 재배포 허용, 개조·상업 이용 금지',
      url: 'https://hub.vroid.com/license?allowed_to_use_user=everyone&characterization_allowed_user=author&corporate_commercial_use=disallow&credit=necessary&modification=disallow&personal_commercial_use=disallow&redistribution=allow&sexual_expression=allow&version=1&violent_expression=allow',
    },
  },

  // ↓ 받은 파일 중 라이선스가 "재배포 금지(redistribution=disallow)"인 모델들.
  //   GitHub Pages(공개 사이트)에 올리면 재배포가 되므로 파일을 넣지 않았고 상점에서도 꺼 두었습니다.
  //   제작자에게 공개 배포 허락을 받은 경우에만 파일을 넣고 enabled를 지우세요.
  ...['Odette', 'Nefer', 'Hu Tao', 'Vodyanitsa', 'Columbina', 'Citlali', 'Skirk', 'Paimon', 'Zibai'].map((name) => ({
    id: `skin_${name.toLowerCase().replace(/\s+/g, '_')}`,
    name,
    price: 1000,
    rarity: 'rare',
    enabled: false,
    file: `assets/characters/${name.toLowerCase().replace(/\s+/g, '_')}.vrm`,
    thumbnail: null,
    credit: {
      author: 'Original model provided by miHoYo',
      license: 'VRoid Hub 이용 조건 — 재배포 금지, 개조 금지, 상업 이용 금지, 크레딧 표기 필요',
      url: 'https://hub.vroid.com/license?allowed_to_use_user=everyone&characterization_allowed_user=everyone&corporate_commercial_use=disallow&credit=necessary&modification=disallow&personal_commercial_use=disallow&redistribution=disallow&sexual_expression=disallow&version=1&violent_expression=disallow',
    },
  })),
];

// -------------------------------------------------------------------
//  타일 디자인
//    style.black / style.white: { body: 타일 몸통 색, ink: 숫자 색 }
//      ⚠ 검은 타일은 어둡게, 흰 타일은 밝게 유지하세요 (색 구분이 게임 정보입니다)
//    style.border  테두리 색 (선택)     style.metal  true면 금속 느낌
//    style.glow    true면 숫자가 빛남    style.pattern 'petals' | 'stars' | 'lines' (선택)
//    style.font    'sans' | 'serif' | 'round' (선택)
// -------------------------------------------------------------------
const TILES = [
  {
    id: 'tile_classic', name: '클래식', price: 0, rarity: 'common',
    style: { black: { body: '#1c1c22', ink: '#f5f1e6' }, white: { body: '#f1ede2', ink: '#17171c' } },
  },
  {
    id: 'tile_jade', name: '비취', price: 300, rarity: 'rare',
    style: { black: { body: '#0f3b2e', ink: '#e7f6ec' }, white: { body: '#dcf3e6', ink: '#0f3b2e' }, border: '#c9a227', font: 'serif' },
  },
  {
    id: 'tile_sakura', name: '벚꽃', price: 500, rarity: 'rare',
    style: { black: { body: '#4a1f33', ink: '#ffd1e3' }, white: { body: '#ffeef4', ink: '#a3214f' }, pattern: 'petals', font: 'round' },
  },
  {
    id: 'tile_neon', name: '네온', price: 800, rarity: 'epic',
    style: { black: { body: '#120a2a', ink: '#27f2ff' }, white: { body: '#efe6ff', ink: '#e01fbf' }, glow: true, pattern: 'lines' },
  },
  {
    id: 'tile_gold', name: '황금', price: 2000, rarity: 'legendary',
    style: { black: { body: '#2b2110', ink: '#ffd76a' }, white: { body: '#fff3cf', ink: '#7a5a12' }, border: '#ffcc33', metal: true, pattern: 'stars', font: 'serif' },
  },
];

// -------------------------------------------------------------------
//  이펙트
//    effect.type  정답: 'sparkle' | 'burst' | 'hearts' | 'ring'
//                 승리: 'confetti' | 'fireworks' | 'goldrain'
//    effect.colors 색 목록,  effect.count 입자 수
//    icon          상점에 보이는 아이콘
// -------------------------------------------------------------------
const EFFECTS = [
  { id: 'fx_correct_basic', category: 'effectCorrect', name: '반짝임', price: 0, rarity: 'common', icon: '✨',
    effect: { type: 'sparkle', colors: ['#ffffff', '#ffe082'], count: 30 } },
  { id: 'fx_correct_fire', category: 'effectCorrect', name: '불꽃 폭발', price: 400, rarity: 'rare', icon: '🔥',
    effect: { type: 'burst', colors: ['#ff5722', '#ffc107', '#ff9800'], count: 70 } },
  { id: 'fx_correct_hearts', category: 'effectCorrect', name: '하트', price: 600, rarity: 'rare', icon: '💖',
    effect: { type: 'hearts', colors: ['#ff4f81', '#ff9ab8', '#ffffff'], count: 28 } },
  { id: 'fx_correct_shock', category: 'effectCorrect', name: '충격파', price: 1200, rarity: 'epic', icon: '⚡',
    effect: { type: 'ring', colors: ['#7df9ff', '#ffffff'], count: 3 } },

  { id: 'fx_win_basic', category: 'effectWin', name: '꽃가루', price: 0, rarity: 'common', icon: '🎉',
    effect: { type: 'confetti', colors: ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb'], count: 140 } },
  { id: 'fx_win_fireworks', category: 'effectWin', name: '불꽃놀이', price: 1000, rarity: 'epic', icon: '🎆',
    effect: { type: 'fireworks', colors: ['#ff5252', '#ffd740', '#40c4ff', '#ffffff'], count: 7 } },
  { id: 'fx_win_goldrain', category: 'effectWin', name: '황금비', price: 2500, rarity: 'legendary', icon: '👑',
    effect: { type: 'goldrain', colors: ['#ffd700', '#fff3b0', '#ffb300'], count: 220 } },
];

export const ITEMS = [
  ...SKINS.map((s) => ({ category: 'skin', ...s })),
  ...TILES.map((t) => ({ category: 'tile', ...t })),
  ...EFFECTS,
];
