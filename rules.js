/* rules.js — AI 없이 낱말 규칙으로만 칸 · 긴급도를 가른다 (기준선).
   낱말과 칸 · 긴급도 이름은 모두 밖(keywords.json · criteria.json)에서 받는다. 여기에는 적지 않는다. */
(function (root) {
  'use strict';

  function strip(s) { return String(s).replace(/\s+/g, ''); }

  function hits(words, text) {
    var t = strip(text);
    return words.filter(function (w) { return t.indexOf(strip(w)) >= 0; });
  }

  function weight(words) { // 길수록 구체적인 낱말이라 길이만큼 친다
    return words.reduce(function (sum, w) { return sum + strip(w).length; }, 0);
  }

  function quote(words) { // «낱말» «낱말» (최대 3개)
    return words.slice(0, 3).map(function (w) { return '«' + w + '»'; }).join(' ');
  }

  // 칸: 낱말 점수가 가장 높은 칸. 점수가 같으면 앞 칸. 걸리는 낱말이 없으면 마지막 칸(기타).
  function pickCategory(masked, criteria, keywords) {
    var cats = criteria.categories.slice().sort(function (a, b) { return a.order - b.order; });
    var scored = cats.map(function (c) {
      var words = ((keywords.categories || {})[c.name] || {}).words || [];
      var hit = hits(words, masked);
      return { name: c.name, hit: hit, score: weight(hit) };
    });
    var best = null;
    scored.forEach(function (s) { if (s.score > 0 && (!best || s.score > best.score)) best = s; });
    if (!best) {
      var last = cats[cats.length - 1].name;
      return { name: last, reason: '맞는 낱말 없음 → ' + last };
    }
    var tied = scored.filter(function (s) { return s.score === best.score; });
    if (tied.length > 1) {
      var others = tied.slice(1).map(function (s) { return s.name; }).join('·');
      return { name: best.name, reason: quote(best.hit) + ' → ' + best.name + ' (' + others + '에도 걸려 앞 칸)' };
    }
    return { name: best.name, reason: quote(best.hit) + ' → ' + best.name };
  }

  // 긴급도: 앞선 단계(높음)의 낱말이 있으면 그 단계. 마지막 단계(낮음)는 나머지 전부.
  function pickUrgency(masked, criteria, keywords) {
    var levels = criteria.urgency.map(function (u) { return u.name; });
    for (var i = 0; i < levels.length - 1; i++) {
      var words = ((keywords.urgency || {})[levels[i]] || {}).words || [];
      var hit = hits(words, masked);
      if (hit.length) return { name: levels[i], reason: quote(hit) + ' → ' + levels[i] };
    }
    var lastName = levels[levels.length - 1];
    var lowWords = ((keywords.urgency || {})[lastName] || {}).words || [];
    var lowHit = hits(lowWords, masked);
    return { name: lastName, reason: lowHit.length
      ? quote(lowHit) + ' → ' + lastName
      : '기한 낱말 없음 → ' + lastName };
  }

  function classify(masked, criteria, keywords) {
    var c = pickCategory(masked, criteria, keywords);
    var u = pickUrgency(masked, criteria, keywords);
    return { category: c.name, urgency: u.name, reason: c.reason + ' · ' + u.reason };
  }

  // 정답 목록과 견줘 센다. maskFn 으로 가린 문장을 만들어 그것으로 판정한다.
  function evaluate(answers, criteria, keywords, maskFn) {
    var spend = criteria.categories.slice().sort(function (a, b) { return a.order - b.order; })[0].name;
    var r = { n: answers.length, catRight: 0, urgRight: 0, bothRight: 0, spendTotal: 0, spendMissed: 0, wrong: [] };
    answers.forEach(function (a) {
      var p = classify(maskFn(a.text), criteria, keywords);
      var catOk = p.category === a['칸'];
      var urgOk = p.urgency === a['긴급도'];
      var missed = a['칸'] === spend && p.category !== spend;
      if (catOk) r.catRight++;
      if (urgOk) r.urgRight++;
      if (catOk && urgOk) r.bothRight++;
      if (a['칸'] === spend) r.spendTotal++;
      if (missed) r.spendMissed++;
      if (!catOk || !urgOk) {
        r.wrong.push({ id: a.id, text: a.text, answerCat: a['칸'], answerUrg: a['긴급도'],
          predCat: p.category, predUrg: p.urgency, spendMiss: missed });
      }
    });
    r.spendName = spend;
    return r;
  }

  var api = { classify: classify, evaluate: evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Rules = api;
})(typeof window !== 'undefined' ? window : globalThis);
