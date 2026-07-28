/* 용어사전 허브 검색 — 이름과 영문 표기를 함께 훑는다.
   정의는 그룹 페이지에 있으므로 여기서는 목록만 걸러 낸다. */
(function(){
  var q = document.getElementById('gq');
  if(!q) return;
  var items = [].slice.call(document.querySelectorAll('.gh-list a'));
  var groups = [].slice.call(document.querySelectorAll('.gh-group'));
  var count = document.getElementById('gcount');
  var empty = document.getElementById('gempty');
  var total = items.length;

  function run(){
    var v = q.value.trim().toLowerCase();
    var n = 0;
    items.forEach(function(a){
      var hit = !v || a.dataset.t.indexOf(v) > -1;
      a.parentNode.hidden = !hit;
      if(hit) n++;
    });
    groups.forEach(function(g){
      g.hidden = !g.querySelector('li:not([hidden])');
    });
    empty.hidden = n > 0;
    count.textContent = v ? (n + ' / ' + total + '개') : (total + '개');
  }
  q.addEventListener('input', run);
  run();
})();
