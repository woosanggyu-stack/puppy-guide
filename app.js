(() => {
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 저장소: 프로필(localStorage) / 일기(IndexedDB) ---------- */
const store = {
  get profile() { try { return JSON.parse(localStorage.getItem('profile')) || {}; } catch { return {}; } },
  set profile(v) { try { localStorage.setItem('profile', JSON.stringify(v)); } catch {} }
};
let dbp;
const idb = () => dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open('puppy', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('entries', { keyPath: 'id' });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('entries', mode);
    const out = fn(t.objectStore('entries'));
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
};
const allEntries = () => tx('readonly', s => s.getAll()).then(r => (r || []).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)));
const putEntry = e => tx('readwrite', s => s.put(e));
const delEntry = id => tx('readwrite', s => s.delete(id));

/* ---------- 공통 ---------- */
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const MOODS = ['😆', '😊', '😐', '😴', '🤒'];
const LV = { red: ['🔴 즉시 병원', 'red'], yellow: ['🟡 병원 상담', 'yellow'], green: ['🟢 훈련·환경', 'green'] };
const ul = a => a && a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

function setTab(t, title) {
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.t === t));
  $('#title').textContent = title;
}

/* ---------- 가이드 ---------- */
const g = { part: 'care', q: '', lv: 'all' };

function renderGuide() {
  setTab('guide', '🐶 댕댕이 가이드');
  const p = store.profile;
  view.innerHTML = `
    <div class="seg">
      <button data-p="care" class="${g.part === 'care' ? 'on' : ''}">🏠 평상시 돌봄</button>
      <button data-p="behav" class="${g.part === 'behav' ? 'on' : ''}">🚨 이상 행동 대처</button>
    </div>
    <input type="search" id="q" placeholder="검색 (예: 짖음, 구토, 사료)" value="${esc(g.q)}">
    ${g.part === 'behav' ? `<div class="chips">${['all', 'red', 'yellow', 'green'].map(k =>
      `<button class="chip ${g.lv === k ? 'on' : ''}" data-lv="${k}">${k === 'all' ? '전체' : LV[k][0]}</button>`).join('')}</div>` : ''}
    <div id="list"></div>
    <p class="note">⚠️ 이 가이드는 일반적인 참고용이며 수의사의 진료를 대신하지 않습니다. 불안하면 언제든 동물병원에 먼저 연락하세요.</p>`;
  view.querySelectorAll('.seg button').forEach(b => b.onclick = () => { g.part = b.dataset.p; renderGuide(); window.scrollTo(0, 0); });
  view.querySelectorAll('.chip').forEach(b => b.onclick = () => { g.lv = b.dataset.lv; renderGuide(); });
  $('#q').oninput = e => { g.q = e.target.value; drawList(); };
  drawList();
}

function drawList() {
  const q = g.q.trim().toLowerCase();
  const hit = o => !q || JSON.stringify(o).toLowerCase().includes(q);
  let html = '';
  if (g.part === 'care') {
    const items = window.CARE.filter(hit);
    html = items.map(c => `
      <details class="card"><summary><span class="ico">${c.icon}</span><div><div class="t">${esc(c.title)}</div><div class="s">${esc(c.sum)}</div></div></summary>
      <div class="body">${ul(c.points)}</div></details>`).join('');
  } else {
    const items = window.BEHAV.filter(b => (g.lv === 'all' || b.level === g.lv) && hit(b));
    if (g.lv !== 'red' && !q) html += `<div class="banner">🔴 경련, 호흡곤란, 중독 의심, 반복 구토, 낙상·사고는 <b>검색보다 병원 연락이 먼저</b>예요.</div>`;
    html += items.map(b => `
      <details class="card"><summary><span class="ico">${b.icon}</span><div>
        <div><span class="badge lv-${b.level}">${LV[b.level][0]}</span></div><div class="t">${esc(b.title)}</div></div></summary>
      <div class="body">
        <h3>이런 모습이에요</h3><p>${esc(b.look)}</p>
        <h3>흔한 원인</h3>${ul(b.causes)}
        <h3>✅ 이렇게 해주세요</h3>${ul(b.do)}
        <h3>❌ 하지 마세요</h3>${ul(b.dont)}
        ${b.vet && b.vet !== '-' ? `<div class="vet lv-${b.level}"><b>🏥 병원에 가야 할 때</b><br>${esc(b.vet)}</div>` : ''}
      </div></details>`).join('');
  }
  $('#list').innerHTML = html || '<div class="empty">검색 결과가 없어요 🐾</div>';
}

/* ---------- 일기 ---------- */
let urls = [];
const url = blob => { const u = URL.createObjectURL(blob); urls.push(u); return u; };

async function renderDiary() {
  setTab('diary', '📓 육아일기');
  urls.forEach(URL.revokeObjectURL); urls = [];
  const p = store.profile, list = await allEntries();
  let hero = '';
  if (p.adopt) {
    const d = dayDiff(p.adopt, today()) + 1;
    hero = `<div class="hero">${esc(p.name || '우리 강아지')}와(과) 함께한 지 <b>${Math.max(d, 1)}일째</b>${p.birth ? ` · 생후 약 ${Math.floor(dayDiff(p.birth, today()) / 7)}주` : ''}</div>`;
  } else {
    hero = `<div class="hero">더보기에서 강아지 이름과 입양일을 등록하면<br>함께한 날짜를 세어드려요 🐾</div>`;
  }
  view.innerHTML = hero + (list.length ? list.map(e => `
    <div class="entry" data-id="${e.id}">
      <div class="meta"><span>${e.mood || ''} ${esc(e.date)}</span><span><button class="chip" data-edit>수정</button></span></div>
      ${e.text ? `<div class="txt">${esc(e.text)}</div>` : ''}
      ${e.photos?.length ? `<div class="thumbs">${e.photos.map((b, i) => `<img src="${url(b)}" data-i="${i}" alt="일기 사진">`).join('')}</div>` : ''}
    </div>`).join('') : '<div class="empty">아직 일기가 없어요.<br>첫 기록을 남겨볼까요? ✏️</div>') +
    `<button class="fab" aria-label="일기 쓰기">＋</button>`;
  $('.fab').onclick = () => editEntry();
  view.querySelectorAll('.entry').forEach(el => {
    const e = list.find(x => x.id === el.dataset.id);
    el.querySelector('[data-edit]').onclick = () => editEntry(e);
    el.querySelectorAll('.thumbs img').forEach(img => img.onclick = () => openViewer(img.src));
  });
}

function openViewer(src) {
  const v = $('#viewer'); v.innerHTML = `<img src="${src}" alt="">`; v.hidden = false;
  v.onclick = () => { v.hidden = true; v.innerHTML = ''; };
}

// 사진을 긴 변 1280px JPEG로 줄여 저장 (저장 공간 절약)
function shrink(file, max = 1280) {
  return new Promise(res => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob(b => res(b || file), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(u); res(null); };
    img.src = u;
  });
}

function editEntry(e) {
  const st = e ? { ...e, photos: [...(e.photos || [])] } : { id: String(Date.now()), date: today(), text: '', mood: MOODS[1], photos: [] };
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `
    <h2>${e ? '일기 수정' : '새 일기'}</h2>
    <label>날짜</label><input type="date" id="d" value="${st.date}">
    <label>오늘의 기분</label><div class="moods">${MOODS.map(m => `<button type="button" data-m="${m}" class="${st.mood === m ? 'on' : ''}">${m}</button>`).join('')}</div>
    <label>오늘 있었던 일 (식사·배변·산책·새로 배운 것…)</label><textarea id="t" placeholder="오늘은 처음으로 '앉아'에 성공했다!">${esc(st.text)}</textarea>
    <label>사진</label><input type="file" id="f" accept="image/*" multiple>
    <div class="prev" id="prev"></div>
    <div class="row"><button class="btn" id="save">저장</button><button class="btn sub" id="cancel">취소</button>
    ${e ? '<button class="btn danger" id="del" style="margin-left:auto">삭제</button>' : ''}</div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const prevUrls = [];
  const drawPrev = () => {
    prevUrls.forEach(URL.revokeObjectURL); prevUrls.length = 0;
    $('#prev', dlg).innerHTML = st.photos.map((b, i) => { const u = URL.createObjectURL(b); prevUrls.push(u); return `<div><img src="${u}" alt=""><button type="button" data-rm="${i}">×</button></div>`; }).join('');
    dlg.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { st.photos.splice(+b.dataset.rm, 1); drawPrev(); });
  };
  drawPrev();
  const close = () => { prevUrls.forEach(URL.revokeObjectURL); dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', close);
  dlg.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { st.mood = b.dataset.m; dlg.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); });
  $('#f', dlg).onchange = async ev => {
    for (const f of ev.target.files) { const b = await shrink(f); if (b) st.photos.push(b); }
    ev.target.value = ''; drawPrev();
  };
  $('#cancel', dlg).onclick = close;
  $('#save', dlg).onclick = async () => {
    st.date = $('#d', dlg).value || today(); st.text = $('#t', dlg).value.trim();
    if (!st.text && !st.photos.length) { $('#t', dlg).focus(); return; }
    try { await putEntry(st); } catch { alert('저장에 실패했어요. 저장 공간을 확인해주세요.'); return; }
    close(); renderDiary();
  };
  const del = $('#del', dlg);
  if (del) del.onclick = async () => { if (confirm('이 일기를 삭제할까요? 되돌릴 수 없어요.')) { await delEntry(st.id); close(); renderDiary(); } };
}

/* ---------- 더보기 ---------- */
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });

function renderMore() {
  setTab('more', '⚙️ 더보기');
  const p = store.profile;
  view.innerHTML = `
    <h2>🐾 우리 강아지</h2>
    <label>이름</label><input type="text" id="n" value="${esc(p.name)}" placeholder="예: 콩이">
    <label>생일 (모르면 대략)</label><input type="date" id="b" value="${esc(p.birth)}">
    <label>입양일</label><input type="date" id="a" value="${esc(p.adopt)}">
    <div class="row"><button class="btn" id="ps">저장</button><span id="ok" class="note"></span></div>

    <h2>💾 백업</h2>
    <p class="note">일기와 사진은 <b>이 기기의 브라우저에만</b> 저장돼요. 폰을 바꾸거나 브라우저 데이터를 지우면 사라질 수 있으니 가끔 백업하세요.</p>
    <div class="row"><button class="btn sub" id="ex">백업 파일 내보내기</button>
    <button class="btn sub" id="im">백업 파일 불러오기</button></div>
    <input type="file" id="imf" accept="application/json" hidden>

    <h2>📲 홈 화면에 추가</h2>
    <p class="note">아이폰: Safari 공유 버튼 → "홈 화면에 추가"<br>안드로이드: Chrome 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"</p>

    <h2>ℹ️ 안내</h2>
    <p class="note">가이드의 내용은 일반적인 참고 정보입니다. 접종 일정, 약, 응급 상황은 반드시 담당 수의사와 확인하세요.</p>`;
  $('#ps').onclick = () => {
    store.profile = { name: $('#n').value.trim(), birth: $('#b').value, adopt: $('#a').value };
    $('#ok').textContent = '저장했어요 ✔';
  };
  $('#ex').onclick = async () => {
    const list = await allEntries();
    const data = { v: 1, profile: store.profile, entries: await Promise.all(list.map(async e => ({ ...e, photos: await Promise.all((e.photos || []).map(blobToData)) }))) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `puppy-diary-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#im').onclick = () => $('#imf').click();
  $('#imf').onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.entries)) throw 0;
      if (!confirm(`일기 ${data.entries.length}개를 불러올까요? 같은 날짜·ID의 일기는 덮어써져요.`)) return;
      for (const e of data.entries) {
        e.photos = await Promise.all((e.photos || []).map(d => fetch(d).then(r => r.blob())));
        await putEntry(e);
      }
      if (data.profile) store.profile = data.profile;
      alert('불러오기 완료!'); renderMore();
    } catch { alert('올바른 백업 파일이 아니에요.'); }
  };
}

/* ---------- 라우터 ---------- */
function route() {
  const r = (location.hash || '#/guide').split('/')[1];
  ({ guide: renderGuide, diary: renderDiary, more: renderMore }[r] || renderGuide)();
}
addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
