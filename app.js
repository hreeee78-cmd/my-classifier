/* app.js — 화면. criteria.json · keywords.json 은 열 때, data/answer.json 은 채점 단추를 누를 때만 읽는다.
   AI(Gemini)는 서버 함수 api/classify 를 거쳐서만 부른다. 열쇠는 이 화면에 없다.
   서버로 나가는 문장은 모두 Mask.mask 로 가린 문장이다. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = { criteria: null, keywords: null, practice: null };
  var BATCH = 10;               // AI 채점은 10개씩
  var CLIENT_WAIT_MS = 75000;   // 서버(60초) 보다 조금 더 기다린다
  var RETRY_WAIT_MS = 5000;     // 503 · 429 로 거절되면 이만큼 쉬었다가 한 번만 다시 보낸다
  var busy = false;
  var lastAi = null;            // 내려받기용

  function setStatus(msg) {
    var el = $('status');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function loadJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(path + ' 을 읽지 못했습니다 (' + res.status + ')');
      return res.json();
    });
  }

  function pct(a, n) { return n ? (Math.round((a / n) * 1000) / 10) + '%' : '-'; }
  function frac(a, n) { return a + ' / ' + n + ' (' + pct(a, n) + ')'; }

  // ---- AI 서버 함수 호출 ----
  // 돌려주는 값: {ok:true, model, results:[{id,category,urgency,reason}], missing:[]}
  //            또는 {ok:false, timeout:true/false, error:'이유'}
  function callAI(items) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, CLIENT_WAIT_MS);
    return fetch('api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items }),
      signal: ctl.signal
    }).then(function (res) {
      return res.text().then(function (txt) {
        var j = null;
        try { j = JSON.parse(txt); } catch (e) { j = null; }
        if (j && j.ok && Array.isArray(j.results)) return j;
        return {
          ok: false,
          timeout: !!(j && j.timeout) || res.status === 504,
          upstream: (j && j.upstream_status) || null,
          error: (j && j.error) || ('서버 응답 오류 (' + res.status + ')')
        };
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return { ok: false, timeout: true, error: 'AI 응답이 너무 오래 걸렸습니다' };
      return { ok: false, timeout: false, error: 'AI 서버에 연결하지 못했습니다' };
    }).then(function (v) { clearTimeout(timer); return v; });
  }

  // ---- 탭 ----
  function selectTab(name) {
    ['classify', 'score'].forEach(function (t) {
      var on = t === name;
      $('tab-' + t).setAttribute('aria-selected', on ? 'true' : 'false');
      $('panel-' + t).hidden = !on;
    });
  }

  // ---- 분류 ----
  // 실패 이유를 쉬운 말로 바꾼다. 원래 이유(detail)는 아래 작은 글씨로 따로 둔다.
  function friendlyWhy(res) {
    if (res.ok) return 'AI가 이 문장은 답하지 않았어요';
    if (res.timeout) return 'AI 답이 늦어요. 잠시 뒤에 다시 해 보세요';
    if (res.upstream === 503 || res.upstream === 429) return 'AI가 지금 바빠요. 잠시 뒤에 다시 해 보세요';
    if (/GEMINI_API_KEY/.test(res.error || '')) return 'AI 설정이 아직 안 돼 있어요. 관리자에게 알려 주세요';
    return 'AI에 연결하지 못했어요. 잠시 뒤에 다시 해 보세요';
  }

  // why 가 있으면 규칙으로 간 것(AI 실패 이유), 없으면 AI 가 가른 것
  function showResult(masked, cat, urg, reason, src, why, detail) {
    $('r-masked').textContent = masked;
    $('r-cat').textContent = cat;
    var u = $('r-urg');
    u.textContent = urg;
    // 긴급도 색: 첫 단계(높음)부터 0, 1, 2 — 이름은 criteria.json 에서 가져온다
    u.dataset.level = String(state.criteria.urgency.map(function (x) { return x.name; }).indexOf(urg));
    $('r-reason').textContent = reason;
    $('r-src').textContent = src;
    $('r-why').textContent = why || '';
    $('r-why').hidden = !why;
    $('r-detail').textContent = detail ? '자세한 이유: ' + detail : '';
    $('r-detail').hidden = !detail;
    $('result').hidden = false;
  }

  function setBusy(on) {
    busy = on;
    ['btn-classify', 'btn-sample', 'btn-score', 'btn-ai'].forEach(function (id) { $(id).disabled = on; });
  }

  function onClassify() {
    if (busy) return;
    var raw = $('req').value.trim();
    if (!raw) { setStatus('요청을 한 줄 먼저 적어 주세요.'); return; }
    if (!state.criteria || !state.keywords) { setStatus('기준을 아직 불러오지 못했어요. 잠시 뒤에 다시 해 보세요.'); return; }
    setStatus('');
    var masked = Mask.mask(raw);
    var btn = $('btn-classify');
    setBusy(true);
    btn.textContent = 'AI가 읽고 있어요…';

    callAI([{ id: 'q', text: masked }]).then(function (res) {
      var hit = res.ok && res.results.filter(function (r) { return r.id === 'q'; })[0];
      if (hit) {
        showResult(masked, hit.category, hit.urgency, hit.reason, 'AI가 나눴어요 · ' + res.model);
        return;
      }
      var out = Rules.classify(masked, state.criteria, state.keywords);
      showResult(masked, out.category, out.urgency, out.reason, 'AI 연결이 안 돼서 규칙으로 나눴어요',
        friendlyWhy(res), res.ok ? '' : res.error);
    }).then(function () {
      setBusy(false);
      btn.textContent = '분류하기';
    });
  }

  // 예시 문장 — 연습 문장 파일(data/practice.json)에서 하나 골라 입력 칸에 넣는다. 정답 파일은 열지 않는다.
  function onSample() {
    if (busy) return;
    var pick = function (list) {
      $('req').value = list[Math.floor(Math.random() * list.length)].text;
      $('req').focus();
    };
    if (state.practice) { pick(state.practice); return; }
    loadJson('data/practice.json').then(function (list) {
      state.practice = list;
      pick(list);
    }).catch(function (e) { setStatus(e.message); });
  }

  // 칸과 긴급도의 뜻 — criteria.json 에서 그린다
  function renderLegend(c) {
    var box = $('legend');
    box.textContent = '';
    function block(title, items) {
      var h = document.createElement('h3');
      h.textContent = title;
      box.appendChild(h);
      var ul = document.createElement('ul');
      items.forEach(function (t) {
        var li = document.createElement('li');
        li.textContent = t;
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    block('칸 (앞 칸일수록 우선)', c.categories.slice().sort(function (a, b) { return a.order - b.order; })
      .map(function (x) { return x.order + '. ' + x.name + ' — ' + x.definition; }));
    block('긴급도', c.urgency.map(function (u) { return u.name + ' — ' + u.definition; }));
    if (c.rules && c.rules.length) block('애매할 때', c.rules);
    if (c.worst_mistake) block('가장 나쁜 실수', [c.worst_mistake]);
  }

  // ---- 채점: 규칙 ----
  function onScore() {
    if (busy) return;
    if (!state.criteria || !state.keywords) { setStatus('기준을 아직 불러오지 못했어요. 잠시 뒤에 다시 해 보세요.'); return; }
    setStatus('정답 파일을 읽는 중…');
    loadJson('data/answer.json').then(function (answers) {
      setStatus('');
      var r = Rules.evaluate(answers, state.criteria, state.keywords, Mask.mask);

      $('m-cat').textContent = frac(r.catRight, r.n);
      $('m-urg').textContent = frac(r.urgRight, r.n);
      $('m-both').textContent = r.bothRight + ' / ' + r.n;
      $('m-spend-label').textContent = r.spendName + '을 다른 칸으로 놓친 수';
      $('m-spend').textContent = r.spendMissed + ' / ' + r.spendTotal;

      $('conditions').textContent =
        '잰 조건: 규칙만 사용(AI 없음) · 낱말 keywords.json v' + state.keywords.version +
        ' (' + state.keywords.source + ' ' + state.keywords.practice_count + '문장에서 추출) · ' +
        '정답 data/answer.json ' + r.n + '개 · 가린 문장으로 판정. ' +
        '정답은 AI 초안을 사람이 확인해 확정한 것이라 점수는 낙관적으로 읽습니다.';

      $('wrong-count').textContent = '(' + r.wrong.length + '개)';
      var list = $('wrong-list');
      list.textContent = '';
      r.wrong.forEach(function (w) {
        var li = document.createElement('li');
        if (w.spendMiss) li.className = 'spend-miss';

        var t = document.createElement('p');
        t.className = 'w-text';
        t.textContent = w.text;

        var d = document.createElement('p');
        d.className = 'w-diff';
        d.textContent = '정답 ' + w.answerCat + '·' + w.answerUrg + ' → 판정 ' + w.predCat + '·' + w.predUrg;

        li.appendChild(t);
        li.appendChild(d);
        if (w.spendMiss) {
          var b = document.createElement('span');
          b.className = 'badge';
          b.textContent = r.spendName + ' 놓침';
          li.appendChild(b);
        }
        list.appendChild(li);
      });
      $('score-out').hidden = false;
    }).catch(function (e) { setStatus(e.message); });
  }

  // ---- 채점: AI ----
  function chunk(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  // 한 묶음을 보낸다. 시간 초과는 바로, 503(붐빔) · 429(한도)는 잠깐 쉬었다가 한 번만 다시 보낸다.
  // 그 밖의 실패는 다시 보내지 않는다.
  function sendBatch(items) {
    var attempts = [];
    function note(res) {
      attempts.push({ ok: !!res.ok, timeout: !!res.timeout, upstream_status: res.upstream || null,
        error: res.ok ? null : res.error, model: res.model || null });
      return res;
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    return callAI(items).then(note).then(function (res) {
      if (res.ok) return res;
      if (res.timeout) return callAI(items).then(note);
      if (res.upstream === 503 || res.upstream === 429) {
        return sleep(RETRY_WAIT_MS).then(function () { return callAI(items); }).then(note);
      }
      return res;
    }).then(function (res) { return { res: res, attempts: attempts }; });
  }

  function tallyAI(answers, predById, spend) {
    var t = { n: answers.length, catRight: 0, urgRight: 0, bothRight: 0, spendTotal: 0, spendMissed: 0, unanswered: 0 };
    answers.forEach(function (a) {
      var isSpend = a['칸'] === spend;
      var p = predById[a.id];
      if (isSpend) t.spendTotal++;
      if (!p) { // 답을 못 받은 문장은 오답. 지출·지급이면 놓친 것으로 센다.
        t.unanswered++;
        if (isSpend) t.spendMissed++;
        return;
      }
      var catOk = p.category === a['칸'];
      var urgOk = p.urgency === a['긴급도'];
      if (catOk) t.catRight++;
      if (urgOk) t.urgRight++;
      if (catOk && urgOk) t.bothRight++;
      if (isSpend && !catOk) t.spendMissed++;
    });
    return t;
  }

  function addRow(body, label, ruleVal, aiVal, opts) {
    opts = opts || {};
    var tr = document.createElement('tr');
    if (opts.warn) tr.className = 'warn';
    [label, ruleVal, aiVal].forEach(function (v, i) {
      var td = document.createElement('td');
      td.textContent = v;
      if (i === 2 && opts.aiSub) {
        var s = document.createElement('small');
        s.textContent = opts.aiSub;
        td.appendChild(s);
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }

  async function onAiScore() {
    if (busy) return;
    if (!state.criteria || !state.keywords) { setStatus('기준을 아직 불러오지 못했어요. 잠시 뒤에 다시 해 보세요.'); return; }
    setBusy(true);
    $('ai-out').hidden = true;
    var prog = $('ai-progress');
    try {
      setStatus('정답 파일을 읽는 중…');
      var answers = await loadJson('data/answer.json');
      setStatus('');
      var n = answers.length;
      var items = answers.map(function (a) { return { id: a.id, text: Mask.mask(a.text) }; });
      var batches = chunk(items, BATCH);

      prog.hidden = false;
      prog.textContent = 'AI 채점 중… 0/' + n;

      var predById = {};
      var models = [];
      var batchLog = [];
      var firstError = null;
      var done = 0;
      for (var b = 0; b < batches.length; b++) {
        var sent = await sendBatch(batches[b]);
        var res = sent.res;
        if (res.ok) {
          res.results.forEach(function (r) { predById[r.id] = r; });
          if (res.model && models.indexOf(res.model) < 0) models.push(res.model);
        } else if (!firstError) {
          firstError = res.error;
        }
        batchLog.push({ batch: b + 1, ids: batches[b].map(function (x) { return x.id; }), attempts: sent.attempts });
        done += batches[b].length;
        prog.textContent = 'AI 채점 중… ' + done + '/' + n;
      }
      prog.textContent = 'AI 채점 끝 ' + n + '/' + n;

      var rules = Rules.evaluate(answers, state.criteria, state.keywords, Mask.mask);
      var ai = tallyAI(answers, predById, rules.spendName);
      var modelName = models.length ? models.join(' / ') : '모델 확인 못함';

      $('th-ai').textContent = 'AI (' + modelName + ')';
      var body = $('cmp-body');
      body.textContent = '';
      addRow(body, '칸 정확도', frac(rules.catRight, rules.n), frac(ai.catRight, ai.n));
      addRow(body, '긴급도 정확도', frac(rules.urgRight, rules.n), frac(ai.urgRight, ai.n));
      addRow(body, '둘 다 맞은 수', rules.bothRight + ' / ' + rules.n, ai.bothRight + ' / ' + ai.n);
      addRow(body, rules.spendName + '을 다른 칸으로 놓친 수',
        rules.spendMissed + ' / ' + rules.spendTotal, ai.spendMissed + ' / ' + ai.spendTotal,
        { warn: true, aiSub: ai.unanswered ? '답 못 받은 지출·지급도 놓친 것으로 셈' : '' });
      addRow(body, '답을 못 받은 문장', '-', ai.unanswered + '건');

      $('ai-cond').textContent =
        '잰 조건: AI = ' + modelName + ', 가린 문장 ' + BATCH + '개씩 ' + batches.length + '번 · 시간 초과 · 503 · 429 묶음은 한 번만 다시 보냄(503·429는 ' + (RETRY_WAIT_MS / 1000) + '초 쉼) · ' +
        '답을 못 받은 문장 ' + ai.unanswered + '건은 오답으로 셈 · 규칙 = keywords.json v' + state.keywords.version +
        ' · 정답 data/answer.json ' + n + '개. 정답은 AI 초안을 사람이 확인해 확정한 것이라 점수는 낙관적으로 읽습니다.' +
        (firstError ? ' (AI 실패 이유: ' + firstError + ')' : '');

      lastAi = {
        measured_at: new Date().toISOString(),
        model: modelName,
        conditions: {
          sentences: n, batch_size: BATCH, masked_before_sending: true,
          retry: '시간 초과 · 503 · 429 묶음만 한 번 다시 보냄 (503·429는 ' + (RETRY_WAIT_MS / 1000) + '초 쉼)',
          unanswered_counted_as_wrong: true,
          keywords_version: state.keywords.version, criteria_version: state.criteria.version
        },
        summary: {
          rules: { cat_right: rules.catRight, urgency_right: rules.urgRight, both_right: rules.bothRight,
            spend_missed: rules.spendMissed, spend_total: rules.spendTotal, n: rules.n },
          ai: { cat_right: ai.catRight, urgency_right: ai.urgRight, both_right: ai.bothRight,
            spend_missed: ai.spendMissed, spend_total: ai.spendTotal, unanswered: ai.unanswered, n: ai.n }
        },
        batches: batchLog,
        items: answers.map(function (a, i) {
          var p = predById[a.id];
          var rp = Rules.classify(items[i].text, state.criteria, state.keywords);
          return {
            id: a.id,
            sent_text: items[i].text,
            answer: { category: a['칸'], urgency: a['긴급도'] },
            ai: p ? { category: p.category, urgency: p.urgency, reason: p.reason } : null,
            ai_result: !p ? '답 못 받음' : (p.category === a['칸'] && p.urgency === a['긴급도'] ? '맞음' : '틀림'),
            rules: { category: rp.category, urgency: rp.urgency }
          };
        })
      };
      $('ai-out').hidden = false;
    } catch (e) {
      prog.hidden = true;
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  }

  function onDownload() {
    if (!lastAi) return;
    var blob = new Blob([JSON.stringify(lastAi, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ai_채점결과.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---- 시작 ----
  function init() {
    $('tab-classify').addEventListener('click', function () { selectTab('classify'); });
    $('tab-score').addEventListener('click', function () { selectTab('score'); });
    $('btn-classify').addEventListener('click', onClassify);
    $('btn-sample').addEventListener('click', onSample);
    $('btn-score').addEventListener('click', onScore);
    $('btn-ai').addEventListener('click', onAiScore);
    $('btn-download').addEventListener('click', onDownload);
    $('req').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onClassify(); }
    });

    Promise.all([loadJson('criteria.json'), loadJson('keywords.json')]).then(function (v) {
      state.criteria = v[0];
      state.keywords = v[1];
      $('sub').textContent = state.criteria.owner + ' · version ' + state.criteria.version;
      renderLegend(state.criteria);
    }).catch(function (e) {
      var local = location.protocol === 'file:';
      setStatus(e.message + (local
        ? ' — 파일을 더블클릭해 열면 읽히지 않습니다. 폴더에서 «python -m http.server 8000» 을 실행하고 http://localhost:8000 으로 여세요.'
        : ''));
    });
  }

  init();
})();
