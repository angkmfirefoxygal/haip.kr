/* 문의 폼 — 유형 칩 동기화, 검증, Formspree 전송 */
document.querySelectorAll('#typeChips .chip').forEach(function(c){
    c.addEventListener('click', function(){
      c.setAttribute('aria-pressed', c.getAttribute('aria-pressed')==='true' ? 'false' : 'true');
    });
  });
  /* 프로젝트 유형 칩은 button 이라 FormData 에 들어가지 않는다.
     선택 상태를 hidden input 으로 옮겨 함께 전송한다. */
  var chips = document.querySelectorAll('#typeChips .chip');
  var typeValue = document.getElementById('typeValue');
  function syncTypes(){
    var on = [];
    chips.forEach(function(c){ if(c.getAttribute('aria-pressed')==='true') on.push(c.textContent.trim()); });
    typeValue.value = on.join(', ');
    return on.length;
  }
  chips.forEach(function(c){ c.addEventListener('click', syncTypes); });

  var form = document.getElementById('contactForm');
  var btn  = document.getElementById('submitBtn');
  var err  = document.getElementById('formErr');
  var BTN_LABEL = btn.textContent;

  function fail(msg){
    err.textContent = msg; err.hidden = false;
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    err.hidden = true;

    var missing = ['co','nm','em','ms'].filter(function(id){ return !document.getElementById(id).value.trim(); });
    if(missing.length){ fail('필수 항목을 모두 입력해 주세요.'); document.getElementById(missing[0]).focus(); return; }
    if(!document.getElementById('em').checkValidity()){ fail('이메일 형식을 확인해 주세요.'); document.getElementById('em').focus(); return; }
    if(!syncTypes()){ fail('프로젝트 유형을 하나 이상 선택해 주세요.'); return; }
    if(!document.getElementById('consent').checked){ fail('개인정보 수집 및 이용 동의가 필요합니다.'); return; }

    btn.disabled = true; btn.textContent = '전송 중…';
    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json' }
    }).then(function(res){
      if(!res.ok) throw new Error(res.status);
      form.hidden = true;
      document.getElementById('successBox').classList.add('show');
      document.getElementById('successBox').scrollIntoView({behavior:'smooth', block:'center'});
    }).catch(function(){
      btn.disabled = false; btn.textContent = BTN_LABEL;
      fail('전송에 실패했습니다. 잠시 후 다시 시도하시거나 haip.office@gmail.com 으로 보내주세요.');
    });
  });
