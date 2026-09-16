/* PDF 게이트 — 회사소개서 다운로드 전 리드 정보 수집.
 *
 * 예전에는 여기서 Formspree 로 바로 POST 하고, 성공하면 /assets/ 의 PDF 링크를
 * 클릭시켰다. 두 군데가 열려 있었다 — Formspree 엔드포인트가 HTML 에 노출돼
 * 봇이 폼을 건너뛰고 직접 POST 할 수 있었고, PDF 자체도 URL 만 알면 받아졌다.
 *
 * 지금은 /api/pdf-gate (Cloudflare Worker) 한 곳에만 보낸다. Worker 가 허니팟과
 * Turnstile 토큰을 서버에서 검증하고, 통과했을 때만 Formspree 로 리드를 넘긴 뒤
 * PDF 본문을 그대로 응답으로 돌려준다. 즉 파일은 이 응답 말고는 받을 길이 없다.
 * 자세한 내용은 tools/worker/pdf-gate.js.
 */
(function(){
  var modal = document.getElementById('pdfGate');
  if(!modal) return;

  var form  = document.getElementById('pdfGateForm');
  var btn   = document.getElementById('pgSubmit');
  var err   = document.getElementById('pgErr');
  var tsBox = document.getElementById('pgTurnstile');
  var BTN_LABEL = btn.textContent;
  var lastFocus = null;
  var fileName = '';
  var tsId = null;          // 렌더된 Turnstile 위젯 id (0 도 유효한 값이라 null 로 비교한다)
  var tsLoading = false;

  function fail(msg){ err.textContent = msg; err.hidden = false; }

  /* Turnstile 스크립트는 게이트를 처음 열 때만 불러온다. 이 파일은 40여 페이지
     전부에 붙는 partial 을 다루므로, 기본 로드로 두면 모달을 열지 않는 방문자까지
     비용을 치른다. 그래서 render=explicit 로 받아 필요할 때 직접 렌더한다. */
  function renderTurnstile(){
    if(tsId !== null || !window.turnstile) return;
    tsId = window.turnstile.render(tsBox, {
      sitekey: tsBox.getAttribute('data-sitekey')
    });
  }

  function mountTurnstile(){
    if(tsId !== null || tsLoading) return;
    if(window.turnstile){ renderTurnstile(); return; }
    tsLoading = true;
    window.__haipTurnstileReady = function(){ tsLoading = false; renderTurnstile(); };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
          + '?render=explicit&onload=__haipTurnstileReady';
    s.async = true; s.defer = true;
    s.onerror = function(){
      tsLoading = false;
      fail('보안 확인 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    };
    document.head.appendChild(s);
  }

  function openModal(name){
    fileName = name;
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    mountTurnstile();
    var first = form.querySelector('input');
    if(first) first.focus();
  }

  function closeModal(){
    modal.hidden = true;
    document.body.style.overflow = '';
    err.hidden = true;
    form.reset();
    /* 토큰은 1회용이고 유효기간도 짧다. 닫을 때 비워서 다음에 열면 새로 받게 한다. */
    if(window.turnstile && tsId !== null) window.turnstile.reset(tsId);
    btn.disabled = false; btn.textContent = BTN_LABEL;
    if(lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* 트리거의 href 는 옛 /assets/ 주소 그대로 둔다 — JS 가 꺼져 있을 때의 대비책이고,
     nginx 가 그 주소를 ?doc=profile 로 301 해서 아래 자동 열기로 이어진다.
     파일 경로는 더 이상 쓰지 않는다 (Worker 응답이 곧 파일이다). */
  document.querySelectorAll('.pdfgate-trigger').forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      openModal(a.getAttribute('download'));
    });
  });

  modal.querySelectorAll('[data-pdfgate-close]').forEach(function(el){
    el.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && !modal.hidden) closeModal();
  });

  form.addEventListener('submit', function(e){
    e.preventDefault();
    err.hidden = true;

    var ids = ['pgEmail','pgName','pgCompany','pgPhone'];
    var missing = ids.filter(function(id){ return !document.getElementById(id).value.trim(); });
    if(missing.length){ fail('필수 항목을 모두 입력해 주세요.'); document.getElementById(missing[0]).focus(); return; }
    if(!document.getElementById('pgEmail').checkValidity()){ fail('이메일 형식을 확인해 주세요.'); document.getElementById('pgEmail').focus(); return; }
    if(!document.getElementById('pgConsent').checked){ fail('정보 수집 및 제공 동의가 필요합니다.'); return; }

    /* 토큰이 없으면 보내봐야 Worker 가 403 을 준다. 여기서 먼저 막고 안내한다. */
    if(!window.turnstile || tsId === null){
      mountTurnstile();
      fail('보안 확인을 준비 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if(!window.turnstile.getResponse(tsId)){
      fail('자동 입력 방지 확인이 아직 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }

    btn.disabled = true; btn.textContent = '확인 중…';
    /* Turnstile 이 폼 안에 cf-turnstile-response 히든 input 을 심어두므로
       FormData 에 토큰이 자동으로 실린다. */
    fetch(form.action, {
      method: 'POST',
      body: new FormData(form)
    }).then(function(res){
      if(res.ok) return res.blob();
      /* Worker 는 실패 사유를 JSON 으로 준다. 본문이 깨져 있어도 흐름은 유지한다. */
      return res.json().then(
        function(d){ throw new Error((d && d.error) || ''); },
        function(){ throw new Error(''); }
      );
    }).then(function(blob){
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      /* 클릭 직후 revoke 하면 다운로드가 시작되기 전에 무효가 될 수 있다 */
      setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
      closeModal();
    }).catch(function(e2){
      btn.disabled = false; btn.textContent = BTN_LABEL;
      /* 실패한 토큰은 재사용할 수 없으므로 반드시 새로 발급받게 한다 */
      if(window.turnstile && tsId !== null) window.turnstile.reset(tsId);
      fail(e2.message || '전송에 실패했습니다. 잠시 후 다시 시도하시거나 haip.office@gmail.com 으로 보내주세요.');
    });
  });

  /* 외부에 공유된 옛 PDF 주소(/assets/haip-company-profile.pdf)는 nginx 가
     ?doc=profile 을 붙여 여기로 301 한다. 링크를 타고 온 사람이 빈 페이지를
     보지 않도록 게이트를 바로 열어준다. */
  if(/[?&]doc=profile(&|$)/.test(location.search)){
    var trigger = document.querySelector('.pdfgate-trigger');
    if(trigger) openModal(trigger.getAttribute('download'));
  }
})();
