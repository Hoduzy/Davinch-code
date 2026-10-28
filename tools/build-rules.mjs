// database.rules.json 생성기 — 규칙이 길어서 여기서 읽기 쉽게 쓰고 JSON으로 뽑음
// 실행: node tools/build-rules.mjs  (결과를 Firebase 콘솔 → Realtime Database → 규칙 에 붙여넣기)
//
// 재화(코인)는 클라이언트가 직접 바꿀 수 없음:
//   지갑(users/{uid}/wallet)을 바꿀 때마다 tx.type(거래 종류)을 함께 써야 하고,
//   규칙이 거래 종류별로 "코인이 정확히 얼마 바뀌어야 하는지"와 "같은 거래를 두 번 할 수 없는지"를 검사함.
//   가격과 보상 값은 config/economy, shop/items (관리자가 items.config.js에서 올린 값)를 읽음.
import fs from 'node:fs';

const DAY = 86400000;
const E = (k) => `root.child('config/economy/${k}').val()`;
const isToday = (v) => `(${v}) * ${DAY} - ${E('dayOffsetMs')} <= now && ((${v}) + 1) * ${DAY} - ${E('dayOffsetMs')} > now`;
const and = (...xs) => xs.map((x) => `(${x})`).join(' && ');
const or = (...xs) => xs.map((x) => `(${x})`).join(' || ');

const room = (code) => `root.child('rooms').child(${code})`;
const hostOf = (code) => `${room(code)}.child('meta/host').val() === auth.uid`;
const IS_HOST = hostOf('$code');
const STATUS = `${room('$code')}.child('meta/status').val()`;
const NOT_SEATED = [0, 1, 2, 3].map((i) => `${room('$code')}.child('seats/${i}/uid').val() !== auth.uid`).join(' && ');
const ADMIN = "root.child('admins').child(auth.uid).val() === true";

// ---------- 지갑 (users/$uid/wallet/coins 에서 본 경로들) ----------
const W = "newData.parent()";            // 새 지갑
const Wo = 'data.parent()';              // 이전 지갑
const T = `${W}.child('tx/type').val()`;
const ITEM = `${W}.child('tx/item').val()`;
const ROOM = `${W}.child('tx/room').val()`;
const ROOT_NEW = 'newData.parent().parent().parent().parent()';
const PRICE = `root.child('shop/items').child(${ITEM}).child('price').val()`;
const STAKE_OLD = `${room(ROOM)}.child('stakes').child($uid)`;
const STAKE_NEW = `${ROOT_NEW}.child('rooms').child(${ROOM}).child('stakes').child($uid)`;
const f = (snap, k) => `${snap}.child('${k}').val()`;

const coinRule = and(
  'newData.isNumber()',
  'newData.val() % 1 === 0',
  'newData.val() >= 0',
  or(
    // 처음 가입: 시작 코인
    and(`${T} === 'create'`, `!${Wo}.exists()`, `newData.val() === ${E('startCoins')}`),
    and(`${Wo}.exists()`, or(
      // 출석 보상: 오늘 처음
      and(`${T} === 'daily'`, `${f(W, 'dailyDay')} > ${f(Wo, 'dailyDay')}`, `newData.val() === data.val() + ${E('dailyBonus')}`),
      // 구제금: 잔액이 적고 오늘 처음
      and(`${T} === 'bailout'`, `data.val() < ${E('bailoutBelow')}`, `${f(W, 'bailoutDay')} > ${f(Wo, 'bailoutDay')}`,
        `newData.val() === data.val() + ${E('bailoutAmount')}`),
      // AI 대전 승리: 하루 상한, 최소 간격
      and(`${T} === 'aiWin'`, `${f(W, 'aiLastAt')} === now`, `now - ${f(Wo, 'aiLastAt')} >= ${E('aiMinIntervalMs')}`,
        `${f(W, 'aiCount')} <= ${E('aiDailyCap')}`,
        or(and(`${f(W, 'aiDay')} === ${f(Wo, 'aiDay')}`, `${f(W, 'aiCount')} === ${f(Wo, 'aiCount')} + 1`),
          and(`${f(W, 'aiDay')} > ${f(Wo, 'aiDay')}`, `${f(W, 'aiCount')} === 1`)),
        `newData.val() === data.val() + ${E('aiWinReward')}`),
      // 구매: 처음 사는 아이템, 같은 쓰기에서 보관함에 추가, 가격만큼 차감
      and(`${T} === 'buy'`, `${PRICE} > 0`, `!root.child('users').child($uid).child('inventory').child(${ITEM}).exists()`,
        `${ROOT_NEW}.child('users').child($uid).child('inventory').child(${ITEM}).val() === true`,
        `newData.val() === data.val() - ${PRICE}`),
      // 온라인 베팅: 대기실에서 한 번, 방의 베팅액만큼 차감하고 걸어 둠
      and(`${T} === 'bet'`, `${room(ROOM)}.child('meta/bet').val() > 0`, `${room(ROOM)}.child('meta/status').val() === 'lobby'`,
        `!${STAKE_OLD}.exists()`, `${STAKE_NEW}.val() === ${room(ROOM)}.child('meta/bet').val()`,
        `newData.val() === data.val() - ${room(ROOM)}.child('meta/bet').val()`),
      // 베팅 돌려받기: 건 돈을 지우면서 그만큼 돌려받음 (언제 가능한지는 stakes 규칙이 검사)
      and(`${T} === 'refund'`, `${STAKE_OLD}.exists()`, `!${STAKE_NEW}.exists()`, `newData.val() === data.val() + ${STAKE_OLD}.val()`),
      // 1등 상금: 결과가 나를 승자로 적었고, 아직 안 받았으면 베팅액의 2배
      and(`${T} === 'payout'`, `${room(ROOM)}.child('result/winner').val() === $uid`, `${STAKE_OLD}.exists()`,
        `!${room(ROOM)}.child('payouts').child($uid).exists()`,
        `${ROOT_NEW}.child('rooms').child(${ROOM}).child('payouts').child($uid).val() === true`,
        `newData.val() === data.val() + 2 * ${STAKE_OLD}.val()`),
    )),
  ),
);

const dayField = (txType) => ({
  '.validate': and('newData.isNumber()', 'newData.val() % 1 === 0', or(
    'newData.val() === data.val()',
    `${T.replace(W, 'newData.parent()')} === 'create' && newData.val() === 0`,
    and(`${T} === '${txType}'`, 'newData.val() > data.val()', isToday('newData.val()')),
  )),
});

const wallet = {
  '.read': 'auth != null && auth.uid === $uid',
  '.write': 'auth != null && auth.uid === $uid && newData.exists()',
  '.validate': "newData.hasChildren(['coins', 'tx', 'dailyDay', 'bailoutDay', 'aiDay', 'aiCount', 'aiLastAt', 'createdAt']) && root.child('config/economy').exists()",
  coins: { '.validate': coinRule },
  tx: {
    '.validate': "newData.hasChildren(['type'])",
    type: { '.validate': "newData.isString() && newData.val().matches(/^(create|daily|bailout|aiWin|buy|bet|refund|payout|name)$/)" },
    item: { '.validate': 'newData.isString() && newData.val().length <= 64' },
    room: { '.validate': 'newData.isString() && newData.val().length <= 16' },
    $other: { '.validate': false },
  },
  dailyDay: dayField('daily'),
  bailoutDay: dayField('bailout'),
  aiDay: dayField('aiWin'),
  aiCount: {
    '.validate': and('newData.isNumber()', or(
      `${T} === 'create' && newData.val() === 0`,
      'newData.val() === data.val()',
      and(`newData.parent().child('aiDay').val() > data.parent().child('aiDay').val()`, 'newData.val() === 1'),
      and(`newData.parent().child('aiDay').val() === data.parent().child('aiDay').val()`, 'newData.val() === data.val() + 1'),
    )),
  },
  aiLastAt: {
    '.validate': and('newData.isNumber()', or(`${T} === 'create' && newData.val() === 0`, 'newData.val() === data.val()', 'newData.val() === now')),
  },
  createdAt: {
    '.validate': or(`${T} === 'create' && newData.val() === now`, 'newData.val() === data.val()'),
  },
  $other: { '.validate': false },
};

const users = {
  $uid: {
    profile: {
      '.read': 'auth != null',
      '.write': 'auth != null && auth.uid === $uid',
      name: { '.validate': 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 12' },
      equipped: {
        $slot: {
          '.validate': and(
            'newData.isString()',
            "root.child('shop/items').child(newData.val()).child('category').val() === $slot",
            or("root.child('shop/items').child(newData.val()).child('price').val() === 0",
              "root.child('users').child($uid).child('inventory').child(newData.val()).exists()"),
          ),
        },
      },
      $other: { '.validate': false },
    },
    wallet,
    inventory: {
      '.read': 'auth != null && auth.uid === $uid',
      $item: {
        '.write': and(
          'auth != null && auth.uid === $uid',
          '!data.exists()',
          'newData.val() === true',
          "newData.parent().parent().child('wallet/tx/type').val() === 'buy'",
          "newData.parent().parent().child('wallet/tx/item').val() === $item",
          "root.child('shop/items').child($item).child('price').val() > 0",
          "newData.parent().parent().child('wallet/coins').val() === data.parent().parent().child('wallet/coins').val() - root.child('shop/items').child($item).child('price').val()",
        ),
      },
    },
    pending: {
      '.read': 'auth != null && auth.uid === $uid',
      $code: { '.write': 'auth != null && auth.uid === $uid', '.validate': 'newData.val() === true' },
    },
  },
};

// ---------- 방 (rooms/$code/stakes/$uid 에서 새 상태 루트 = 4단계 위) ----------
const RN4 = 'newData.parent().parent().parent().parent()';
const myWalletNew = `${RN4}.child('users').child($uid).child('wallet')`;
const myWalletOld = "root.child('users').child($uid).child('wallet')";

const rooms = {
  $code: {
    meta: {
      '.read': 'auth != null',
      host: {
        '.write': `auth != null && newData.val() === auth.uid && (!data.exists() || data.val() === auth.uid || (${room('$code')}.child('members').child(auth.uid).exists() && !${room('$code')}.child('presence').child(data.val()).exists()))`,
      },
      status: {
        '.write': "auth != null && newData.parent().child('host').val() === auth.uid",
        '.validate': "newData.val() === 'lobby' || newData.val() === 'playing' || newData.val() === 'over'",
      },
      createdAt: { '.write': "auth != null && newData.parent().child('host').val() === auth.uid" },
      bet: {
        '.write': "auth != null && !data.exists() && newData.parent().child('host').val() === auth.uid",
        '.validate': 'newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= 0 && newData.val() <= 1000000',
      },
    },
    seats: {
      '.read': 'auth != null',
      $seat: {
        '.write': `auth != null && ($seat === '0' || $seat === '1' || $seat === '2' || $seat === '3') && (${IS_HOST} || (${STATUS} === 'lobby' && ((!data.exists() && newData.child('uid').val() === auth.uid) || (data.child('uid').val() === auth.uid && !newData.exists()))))`,
        name: { '.validate': 'newData.isString() && newData.val().length <= 20' },
      },
    },
    members: {
      '.read': 'auth != null',
      $uid: {
        '.write': `auth != null && (${IS_HOST} || (auth.uid === $uid && (!newData.exists() || (${STATUS} === 'lobby' && newData.isString() && ${room('$code')}.child('seats').child(newData.val()).child('uid').val() === auth.uid))))`,
      },
    },
    presence: { '.read': 'auth != null', $uid: { '.write': 'auth != null && auth.uid === $uid' } },
    public: { '.read': 'auth != null', '.write': `auth != null && ${IS_HOST}` },
    private: { $uid: { '.read': 'auth != null && auth.uid === $uid', '.write': `auth != null && ${IS_HOST}` } },
    secret: { '.read': `auth != null && ${IS_HOST}`, '.write': `auth != null && ${IS_HOST}` },
    actions: {
      '.read': `auth != null && ${IS_HOST}`,
      $id: {
        '.write': `auth != null && ((!data.exists() && newData.child('uid').val() === auth.uid && ${room('$code')}.child('members').child(auth.uid).exists()) || (!newData.exists() && ${IS_HOST}))`,
      },
    },
    // 베팅: 지갑 차감/환불과 같은 쓰기에서만 만들고 지울 수 있음
    stakes: {
      '.read': 'auth != null',
      $uid: {
        '.write': and('auth != null && auth.uid === $uid', or(
          and('!data.exists()', `${STATUS} === 'lobby'`,
            `newData.val() === ${room('$code')}.child('meta/bet').val()`,
            `${myWalletNew}.child('tx/type').val() === 'bet'`, `${myWalletNew}.child('tx/room').val() === $code`,
            `${myWalletNew}.child('coins').val() === ${myWalletOld}.child('coins').val() - newData.val()`),
          and('data.exists()', '!newData.exists()', or(`${STATUS} === 'lobby'`, NOT_SEATED),
            `${myWalletNew}.child('tx/type').val() === 'refund'`, `${myWalletNew}.child('tx/room').val() === $code`,
            `${myWalletNew}.child('coins').val() === ${myWalletOld}.child('coins').val() + data.val()`),
        )),
      },
    },
    payouts: {
      '.read': 'auth != null',
      $uid: {
        '.write': and('auth != null && auth.uid === $uid', '!data.exists()', 'newData.val() === true',
          `${room('$code')}.child('result/winner').val() === $uid`,
          `${myWalletNew}.child('tx/type').val() === 'payout'`, `${myWalletNew}.child('tx/room').val() === $code`),
      },
    },
    // 결과는 방장이 게임 중에 한 번만 씀 (상금 기준)
    result: {
      '.read': 'auth != null',
      '.write': `auth != null && ${IS_HOST} && !data.exists() && ${STATUS} === 'playing'`,
      '.validate': "newData.hasChildren(['winner']) && newData.child('winner').isString()",
    },
    // 그 판에 각자 장착한 아이템 (방장이 프로필에서 읽어 씀)
    looks: { '.read': 'auth != null', '.write': `auth != null && ${IS_HOST}` },
    ready: { '.read': 'auth != null', $uid: { '.write': 'auth != null && auth.uid === $uid' } },
  },
};

const rules = {
  rules: {
    admins: {
      '.read': 'auth != null',
      // 관리자가 아무도 없을 때 처음 한 명만 스스로 등록 가능 (그다음부터는 콘솔에서 추가)
      $uid: { '.write': "auth != null && auth.uid === $uid && !root.child('admins').exists() && newData.val() === true" },
    },
    config: { '.read': true, '.write': `auth != null && ${ADMIN}` },
    shop: { '.read': true, '.write': `auth != null && ${ADMIN}` },
    users,
    rooms,
  },
};

const out = new URL('../database.rules.json', import.meta.url);
fs.writeFileSync(out, `${JSON.stringify(rules, null, 2)}\n`);
console.log('database.rules.json 생성 완료');
