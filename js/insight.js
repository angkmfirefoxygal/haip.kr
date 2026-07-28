/* 인사이트 허브 스크립트

   문서 23편이 각자 URL 을 갖게 되면서(insight/guide/*, insight/case/*,
   insight/glossary/*) 이 파일은 두 가지만 한다.
   1) 예전에 공유된 해시 URL 을 새 주소로 보낸다
   2) 허브 안의 목록 뷰 4개(overview/glossary/guide/case)를 해시로 전환한다 */
(function(){
  var MOVED = {
    'guide-01':'insight/guide/popup-kpi.html',
    'guide-02':'insight/guide/dwell-time.html',
    'guide-03':'insight/guide/booth-measurement.html',
    'guide-04':'insight/guide/consent-design.html',
    'guide-05':'insight/guide/data-over-goods.html',
    'guide-06':'insight/guide/no-app-entry.html',
    'guide-07':'insight/guide/online-offline-id.html',
    'guide-08':'insight/guide/cherry-picker.html',
    'case-01':'insight/case/burger-king-burn-that-ad.html',
    'case-02':'insight/case/coca-cola-wonderful.html',
    'case-03':'insight/case/simmons-grocery-store.html',
    'case-04':'insight/case/pokemon-go-sponsored-stops.html',
    'case-05':'insight/case/chipotle-loyalty-game.html',
    'case-06':'insight/case/sephora-virtual-artist.html',
    'case-07':'insight/case/snap-attribution-model.html',
    'case-08':'insight/case/homeplus-prize-event.html',
    'case-09':'insight/case/houston-airport-wait.html',
    'g-a':'insight/glossary/engagement.html',
    'g-b':'insight/glossary/conversion.html',
    'g-c':'insight/glossary/attribution.html',
    'g-d':'insight/glossary/data-privacy.html',
    'g-e':'insight/glossary/event-format.html',
    'g-f':'insight/glossary/adtech.html'
  };
  function redirect(){
    // #guide-01 처럼 한 토막인 것과 #glossary/g-a 처럼 두 토막인 옛 주소를 모두 받는다
    var parts = (location.hash || '').replace(/^#/, '').split('/');
    var to = MOVED[parts[0]] || (parts[1] && MOVED[parts[1]]);
    if(to){ location.replace(to); return true; }
    return false;
  }
  if(redirect()) return;
  window.addEventListener('hashchange', redirect);
})();

/* ============================================================
     INSIGHT SPA ROUTER
     좌측 메뉴(insight-side)와 상단 히어로(ins-hero)는 절대 다시 그리지 않고,
     insight-main 안의 .view 4개(overview/glossary/guide/case)만 해시로 전환한다.
     ============================================================ */
  (function(){
    var TITLES = {overview:'인사이트', glossary:'용어사전', guide:'가이드', case:'사례집'};
    var views = document.querySelectorAll('.view');
    var topLinks = document.querySelectorAll('.side-nav > li > a[data-view]');
    var shell = document.querySelector('.insight-shell');
    var prevView = null;
    var groupWrap = document.querySelector('.g-groups');
    var gGroups = Array.prototype.slice.call(document.querySelectorAll('.g-group'));
    if(!views.length) return;

    /* 목록 뷰(overview/glossary/guide/case)와 상세 글 뷰(guide-01… / case-01…)를 한 맵으로 관리한다.
       상세 글은 data-parent로 좌측 메뉴 활성 항목을, data-title로 문서 제목을 지정한다. */
    var META = {};
    Array.prototype.forEach.call(views, function(v){
      var id = v.dataset.view;
      if(!id) return;
      META[id] = {
        parent: v.dataset.parent || id,
        title:  v.dataset.title  || TITLES[id] || '인사이트'
      };
    });

    function parseHash(hash){
      hash = (hash || '').replace(/^#/, '');
      if(!hash) return {view:'overview', group:null};
      /* #g-a … #g-f = 용어사전의 특정 그룹만 표시. 스크롤로 데려가지 않는다. */
      if(/^g-[a-f]$/.test(hash)) return {view:'glossary', group:hash};
      if(META[hash]) return {view:hash, group:null};
      return {view:'overview', group:null};
    }

    /* 상단 '현재 위치' 표시 — 허브는 해시로 뷰가 바뀌므로 여기서 켠다.
       하위 문서는 빌드 시점에 이미 확정돼 있어 이 함수가 돌지 않는다. */
    var crumbSec = document.querySelector('.crumb-sec');
    var crumbLinks = crumbSec ? crumbSec.querySelectorAll('[data-crumb]') : [];
    function setCrumb(section){
      if(!crumbSec) return;
      var hit = false;
      Array.prototype.forEach.call(crumbLinks, function(a){
        var on = a.dataset.crumb === section;
        a.hidden = !on;
        if(on){ a.setAttribute('aria-current','page'); hit = true; }
        else  { a.removeAttribute('aria-current'); }
      });
      crumbSec.hidden = !hit;
    }

    function activate(hash, opts){
      opts = opts || {};
      var r = parseHash(hash);

      var meta = META[r.view] || {parent:r.view, title:'인사이트'};

      views.forEach(function(v){
        v.classList.toggle('is-active', v.dataset.view === r.view);
      });
      topLinks.forEach(function(a){
        a.classList.toggle('active', a.dataset.view === meta.parent);
      });
      document.title = meta.title + ' — HaiP';
      setCrumb(meta.parent);

      // 방금 켜진 뷰 안의 리빌 요소는 즉시 보이게 (숨겨져 있는 동안은 IntersectionObserver가 잡지 못하므로)
      var active = document.querySelector('.view.is-active');
      if(active){
        active.querySelectorAll('.rv').forEach(function(n){ n.classList.add('in'); });
      }

      /* 용어사전 그룹 필터 — 선택한 그룹만 남기고 나머지는 숨긴다.
         스크롤로 데려가지 않으므로 좌측 사이드바의 어떤 항목을 눌러도 화면이 움직이지 않는다.
         상위 '용어사전'(#glossary)은 group이 없으므로 6그룹 전체를 보여준다. */
      if(groupWrap){
        groupWrap.classList.toggle('is-filtered', !!r.group);
        gGroups.forEach(function(g){ g.hidden = !!r.group && g.dataset.group !== r.group; });
        setActiveSub(r.group);
      }

      /* 스크롤 정책
         - 좌측 메뉴 클릭(섹션 전환·그룹 필터)에서는 스크롤을 건드리지 않는다.
         - 글 상세로 들어가거나 글에서 나올 때만, 그리고 현재 위치가 본문 시작점보다
           아래일 때만 본문 시작점까지 끌어올린다. 아래로 내리는 스크롤은 하지 않는다. */
      var isArticle  = meta.parent !== r.view;
      var wasArticle = prevView && META[prevView] && META[prevView].parent !== prevView;

      if(!opts.initial && shell && (isArticle || wasArticle)){
        requestAnimationFrame(function(){
          var navEl = document.querySelector('.nav');
          var navH  = navEl ? navEl.getBoundingClientRect().height : 0;
          var top   = shell.getBoundingClientRect().top + window.pageYOffset - navH - 16;
          if(window.pageYOffset > top){
            window.scrollTo({top: Math.max(top, 0), behavior: reduce ? 'auto' : 'smooth'});
          }
        });
      }

      prevView = r.view;
      runGlossaryScrollspy();
    }

    document.body.addEventListener('click', function(e){
      var a = e.target.closest('a[href*="insight.html#"]');
      if(!a) return;
      var href = a.getAttribute('href');
      var hashIdx = href.indexOf('#');
      var hash = href.slice(hashIdx); // includes '#'
      if(hash === '#') return; // bare placeholder link, ignore
      e.preventDefault();
      if(location.hash === hash){
        activate(hash);
      } else {
        location.hash = hash; // triggers hashchange -> activate()
      }
    });

    window.addEventListener('hashchange', function(){ activate(location.hash); });

    /* ---- 용어사전 좌측 서브메뉴 스크롤 연동 (glossary 뷰가 켜져 있을 때만 동작) ---- */
    var ssLinks = Array.prototype.slice.call(document.querySelectorAll('.side-sub .ss-link'));
    var jumpLinks = Array.prototype.slice.call(document.querySelectorAll('.g-jump a'));
    var ssGroups = ssLinks.map(function(a){
      var hashIdx = a.getAttribute('href').indexOf('#');
      return document.querySelector('.g-group[data-group="' + a.getAttribute('href').slice(hashIdx + 1) + '"]');
    }).filter(Boolean);
    var scrollBound = false;

    /* opts.spy = 스크롤 연동 호출. 이때는 사이드바만 갱신하고 모바일 칩은 건드리지 않는다.
       (전체 보기 중에는 '전체' 칩이 선택 상태로 남아 있어야 한다) */
    function setActiveSub(id, opts){
      ssLinks.forEach(function(a){
        a.classList.toggle('active', !!id && a.getAttribute('href').indexOf('#' + id) !== -1);
      });
      if(opts && opts.spy) return;
      jumpLinks.forEach(function(a){
        var h = a.getAttribute('href');
        a.classList.toggle('active', id ? h.indexOf('#' + id) !== -1 : h.indexOf('#glossary') !== -1);
      });
    }

    function onScroll(){
      var glossaryView = document.querySelector('.view[data-view="glossary"]');
      if(!glossaryView || !glossaryView.classList.contains('is-active') || !ssGroups.length) return;
      /* 한 그룹만 표시 중일 때는 활성 표시가 이미 확정돼 있고,
         숨은 그룹의 좌표는 0이라 스크롤 기준 판정이 틀어진다. */
      if(groupWrap && groupWrap.classList.contains('is-filtered')) return;
      var offset = 120, current = ssGroups[0].dataset.group;
      for(var i=0;i<ssGroups.length;i++){
        if(ssGroups[i].getBoundingClientRect().top <= offset) current = ssGroups[i].dataset.group;
      }
      setActiveSub(current, {spy:true});
    }

    function runGlossaryScrollspy(){
      onScroll();
      if(scrollBound) return;
      scrollBound = true;
      var ticking = false;
      window.addEventListener('scroll', function(){
        if(ticking) return;
        ticking = true;
        requestAnimationFrame(function(){ onScroll(); ticking = false; });
      }, {passive:true});
    }

    activate(location.hash, {initial:true});
  })();
