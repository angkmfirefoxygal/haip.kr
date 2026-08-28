/* PDF 게이트 — 회사소개서 다운로드 전 리드 정보 수집, Formspree 전송 후 자동 다운로드 */
(function(){
  var modal = document.getElementById('pdfGate');
  if(!modal) return;

  var form  = document.getElementById('pdfGateForm');
  var btn   = document.getElementById('pgSubmit');
  var err   = document.getElementById('pgErr');
  var BTN_LABEL = btn.textContent;
  var lastFocus = null;
  var pending = { file: '', name: '' };

  function fail(msg){ err.textContent = msg; err.hidden = false; }

  function openModal(file, name){
    pending.file = file; pending.name = name;
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var first = form.querySelector('input');
    if(first) first.focus();
  }

  function closeModal(){
    modal.hidden = true;
    document.body.style.overflow = '';
    err.hidden = true;
    form.reset();
    btn.disabled = false; btn.textContent = BTN_LABEL;
    if(lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* href/download 은 build.py 의 rebase() 가 페이지 깊이에 맞춰 이미 고쳐 둔 값이라
     그대로 쓴다 — 별도 data-* 경로를 두면 rebase 대상에서 빠져 하위 페이지에서 404 난다. */
  document.querySelectorAll('.pdfgate-trigger').forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      openModal(a.getAttribute('href'), a.getAttribute('download'));
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

    btn.disabled = true; btn.textContent = '확인 중…';
    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json' }
    }).then(function(res){
      if(!res.ok) throw new Error(res.status);
      var a = document.createElement('a');
      a.href = pending.file;
      a.download = pending.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      closeModal();
    }).catch(function(){
      btn.disabled = false; btn.textContent = BTN_LABEL;
      fail('전송에 실패했습니다. 잠시 후 다시 시도하시거나 haip.office@gmail.com 으로 보내주세요.');
    });
  });
})();
