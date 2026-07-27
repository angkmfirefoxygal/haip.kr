/* HaiP — 전 페이지 공용 스크립트
   히어로 영상과 스크롤 리빌. 대상 요소가 없는 페이지에서는 조용히 넘어간다. */
(function(){
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  /* ---- 히어로 배경 영상 ---- */
  (function(){
    var v = document.querySelector('.hero-video');
    if(!v) return;
    if(reduce){ v.pause(); v.removeAttribute('autoplay'); return; }
    /* 영상은 1.6MB다. 데이터 절약 모드나 저속 회선에서는 받지 않고
       --ink 배경만 남긴다. 레이아웃은 그대로이고 LCP 요소도 영상이 아니다. */
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if(conn && (conn.saveData || /^(slow-)?2g$|^3g$/.test(conn.effectiveType || ''))){
      v.removeAttribute('autoplay'); v.removeAttribute('src'); v.load(); return;
    }
    /* 일부 브라우저는 autoplay 속성만으로 재생을 시작하지 않으므로 명시적으로 한 번 더 시도한다.
       실패하면(정책·저전력 모드 등) 영상 없이 --ink 배경만 남고 레이아웃은 그대로다. */
    var go = function(){ var r = v.play(); if(r && r.catch) r.catch(function(){}); };
    if(v.readyState >= 2) go(); else v.addEventListener('loadeddata', go, {once:true});
    /* 탭이 백그라운드로 가면 멈추고 돌아오면 재생 — 불필요한 디코딩을 줄인다 */
    document.addEventListener('visibilitychange', function(){
      if(document.hidden) v.pause(); else go();
    });
  })();

  /* ---- 스크롤 리빌 ---- */
  var rv = document.querySelectorAll('.rv');
  if(reduce || !('IntersectionObserver' in window)){
    rv.forEach(function(n){ n.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function(ents){
      ents.forEach(function(e){
        if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, {threshold:.12, rootMargin:'0px 0px -8% 0px'});
    rv.forEach(function(n){ io.observe(n); });
  }
})();
