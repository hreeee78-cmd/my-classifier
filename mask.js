/* mask.js — 이름 · 전화번호 · 사번 · 계좌번호를 가린다.
   분류는 가린 문장으로 한다. 브라우저 밖으로 나가는 문장도 이 가림을 거친 것만 보낸다. */
(function (root) {
  'use strict';

  // 성 + 이름 1~2글자 뒤에 «님 · 씨 · 직급» 이 붙으면 이름으로 본다.
  var SURNAMES = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부가복태목형피두감호';
  var TITLES = '님|씨|과장|부장|차장|팀장|대리|실장';
  // 성처럼 보이지만 이름이 아닌 말
  var NOT_NAMES = ['고객', '부장', '사장', '팀장', '주임', '차장', '과장', '대리', '대표', '이사', '사원', '직원',
    '선생', '상무', '전무', '실장', '소장', '원장', '감사', '임원', '담당', '회장', '고문', '기사', '신입'];

  var NAME_RE = new RegExp(
    '(^|[^가-힣])([' + SURNAMES + '][가-힣]{1,2})(?=\\s?(?:' + TITLES + ')|\\(\\[(?:전화번호|사번)\\])', 'g');

  function mask(text) {
    var s = String(text == null ? '' : text);

    // 1) 전화번호 (휴대폰 · 지역번호 · 내선 앞자리 포함)
    s = s.replace(/(^|[^\d-])(?:01[016789]|02|0[3-6]\d|070|080)[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g, '$1[전화번호]');

    // 2) 계좌번호 — 하이픈으로 이어진 숫자 묶음이고 숫자가 모두 10~16자리일 때 (날짜 같은 짧은 것은 그대로)
    s = s.replace(/(^|[^\d-])(\d{2,6}(?:-\d{2,8}){1,3})(?![\d-])/g, function (m, pre, num) {
      var n = num.replace(/-/g, '').length;
      return n >= 10 && n <= 16 ? pre + '[계좌번호]' : m;
    });
    s = s.replace(/(^|[^\d])\d{10,16}(?!\d)/g, '$1[계좌번호]');

    // 3) 사번 — «사번 E-1042» 또는 «E-1042»
    s = s.replace(/사번\s*[:：]?\s*[A-Za-z]{0,3}-?\d{3,8}/g, '[사번]');
    s = s.replace(/(^|[^A-Za-z0-9])[A-Za-z]{1,2}-\d{3,8}(?!\d)/g, '$1[사번]');

    // 4) 이름 — «이름: 홍길동» 꼴, 그리고 성+이름 뒤에 님·씨·직급이 붙은 꼴
    s = s.replace(/(성함|이름)\s*[:：]\s*[가-힣]{2,4}/g, '$1: [이름]');
    s = s.replace(NAME_RE, function (m, pre, name) {
      return NOT_NAMES.indexOf(name) >= 0 ? m : pre + '[이름]';
    });

    return s;
  }

  var api = { mask: mask };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Mask = api;
})(typeof window !== 'undefined' ? window : globalThis);
