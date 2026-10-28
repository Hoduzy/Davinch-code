// 온라인 멀티플레이용 Firebase 설정
// Firebase 콘솔 → 프로젝트 설정(톱니바퀴) → 일반 → 내 앱 → 웹 앱의 "SDK 설정 및 구성" → "구성"에 나오는 값을 붙여넣으세요.
// 이 값들은 공개되어도 괜찮은 값입니다 (보안은 database.rules.json 규칙이 담당).
// 비어 있으면 "혼자 하기"만 할 수 있습니다.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  databaseURL: '', // 예: https://내프로젝트-default-rtdb.asia-southeast1.firebasedatabase.app
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
