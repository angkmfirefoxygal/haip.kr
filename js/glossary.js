/* 용어사전 허브 검색

   찾는 방식이 사람마다 달라서 다음을 모두 받는다.
     · 한글 그대로            체류      → 체류시간
     · 초성만                 ㅊㅇㅇ    → 참여율, 재참여율
     · 영문·약어              CTR, roas
     · 띄어쓰기·구분자 무시   재 참여율 → 재참여율,  qr스캔율 → QR 스캔율
     · 그룹 이름              애드테크  → F그룹 전체
   ?q= 로 링크할 수 있고, 입력하면 주소창도 따라 바뀐다. */
(function(){
  var q = document.getElementById('gq');
  if(!q) return;

  var items  = [].slice.call(document.querySelectorAll('.gh-list a'));
  var groups = [].slice.call(document.querySelectorAll('.gh-group'));
  var count  = document.getElementById('gcount');
  var empty  = document.getElementById('gempty');
  var total  = items.length;

  var CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ',
             'ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

  /* 비교 전에 양쪽을 같은 모양으로 만든다.
     공백과 가운뎃점·하이픈·슬래시 같은 구분자를 지워, 띄어 써도 붙여 써도 걸리게 한다. */
  function norm(s){
    return (s || '').toLowerCase().replace(/[\s·・\-–—_/.,()]/g, '');
  }

  /* 한글 음절을 초성으로. 한글이 아니면 그대로 둔다 (영문·숫자도 함께 걸리도록). */
  function cho(s){
    var out = '';
    for(var i = 0; i < s.length; i++){
      var c = s.charCodeAt(i);
      if(c >= 0xAC00 && c <= 0xD7A3) out += CHO[Math.floor((c - 0xAC00) / 588)];
      else out += s[i];
    }
    return out;
  }

  /* 질의가 초성 자모로만 이뤄졌는지. 그럴 때만 초성 검색으로 취급한다.
     '차' 같은 완성 음절까지 초성으로 보면 엉뚱한 결과가 나온다. */
  function isCho(s){
    return s.length > 0 && /^[ㄱ-ㅎ]+$/.test(s);
  }

  // 항목마다 비교용 문자열을 미리 만들어 둔다
  items.forEach(function(a){
    var raw   = a.dataset.t || a.textContent;
    var group = a.closest ? a.closest('.gh-group') : null;
    var gname = group ? ((group.querySelector('h2') || {}).textContent || '') : '';
    a._n = norm(raw);          // 용어 자체
    a._g = norm(gname);        // 그룹 이름 (직접 일치가 없을 때만 쓴다)
    a._c = cho(norm(raw));
    var n = a.querySelector('.gh-n'), sm = a.querySelector('small');
    a._name = n ? n.textContent : a.textContent;
    a._alt  = sm ? sm.textContent : '';
  });

  /* 일치 구간에 <mark>. norm() 이 글자를 지웠을 수 있어 원문 위치를 다시 센다. */
  function paint(el, text, needle){
    if(!el) return;
    if(!needle){ el.textContent = text; return; }
    var i = norm(text).indexOf(needle);
    if(i < 0){ el.textContent = text; return; }
    var s = 0, seen = 0;
    while(s < text.length && seen < i){ if(norm(text[s])) seen++; s++; }
    var e = s, got = 0;
    while(e < text.length && got < needle.length){ if(norm(text[e])) got++; e++; }
    el.textContent = '';
    el.appendChild(document.createTextNode(text.slice(0, s)));
    var m = document.createElement('mark');
    m.textContent = text.slice(s, e);
    el.appendChild(m);
    el.appendChild(document.createTextNode(text.slice(e)));
  }

  function run(push){
    var raw   = q.value.trim();
    var byCho = isCho(raw.replace(/\s/g, ''));
    var key   = byCho ? raw.replace(/\s/g, '') : norm(raw);
    var n = 0;

    /* 용어에 직접 걸리는 게 하나라도 있으면 그것만 보여 준다.
       그룹 이름까지 한꺼번에 보면 '체류' 가 '참여·체류 지표' 에 걸려
       그룹 10개가 통째로 나오고 정작 찾던 '체류시간' 이 묻힌다.
       직접 일치가 0 일 때만 그룹 이름으로 넓힌다 ('애드테크' → F그룹 전체). */
    var direct = !key || items.some(function(a){
      return byCho ? a._c.indexOf(key) > -1 : a._n.indexOf(key) > -1;
    });

    items.forEach(function(a){
      var hit = !key || (byCho ? a._c.indexOf(key) > -1
                               : (direct ? a._n.indexOf(key) > -1
                                         : a._g.indexOf(key) > -1));
      a.parentNode.hidden = !hit;
      if(hit){
        n++;
        paint(a.querySelector('.gh-n'), a._name, byCho ? '' : key);
        paint(a.querySelector('small'), a._alt,  byCho ? '' : key);
      }
    });
    groups.forEach(function(g){
      var on = g.querySelectorAll('li:not([hidden])').length;
      g.hidden = !on;
      /* 그룹 옆 숫자도 걸러진 결과에 맞춘다. 10개 그룹에서 2개만 남았는데
         계속 10 이라고 적혀 있으면 무엇을 세는 숫자인지 알 수 없다. */
      var c = g.querySelector('.g-cnt');
      if(c){
        if(!c._all) c._all = c.textContent;
        c.textContent = key ? (on + ' / ' + c._all) : c._all;
      }
    });
    // 카운터·안내문은 없을 수도 있다 (마크업에서 빼도 검색은 동작해야 한다)
    if(empty) empty.hidden = n > 0;
    if(count) count.textContent = key ? (n + ' / ' + total + '개') : (total + '개');

    if(push && history.replaceState){
      history.replaceState(null, '', location.pathname + (raw ? '?q=' + encodeURIComponent(raw) : ''));
    }
  }

  q.addEventListener('input', function(){ run(true); });

  // Esc 로 비우기, / 로 검색창에 바로 가기
  q.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ q.value = ''; run(true); }
  });
  document.addEventListener('keydown', function(e){
    if(e.key === '/' && document.activeElement !== q &&
       !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)){
      e.preventDefault(); q.focus(); q.select();
    }
  });

  // ?q= 로 들어오면 그 상태로 시작한다
  var pre = new URLSearchParams(location.search).get('q');
  if(pre) q.value = pre;
  run(false);
})();
