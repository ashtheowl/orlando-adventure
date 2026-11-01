/* app.js: the screens. Everything saved lives in Store (storage.js); this file
   only reads it and asks it to change. Content comes from content.json and is
   never written to. */
(function () {
  'use strict';

  const APP_VERSION = '2';          // keep in step with CACHE_VERSION in sw.js
  const HEIGHT_NOTE = 'islands-of-adventure';
  const CHALLENGE_POINTS = 10;

  // Wording from the Bravery Awards page of the book
  const RANKS = [
    { at: 10, name: 'Brave Beginner', line: 'You got on the plane and you got on the rides. That is how everything starts.' },
    { at: 30, name: 'Courage Cadet', line: 'Dark rides no longer worry you. You have started saying "again".' },
    { at: 60, name: 'Daring Adventurer', line: 'You have been on something that made your tummy jump, on purpose.' },
    { at: 100, name: 'Fearless Explorer', line: 'Roller coasters. Big drops. You are choosing the front row now.' },
    { at: 135, name: 'Legendary Hero of Orlando', line: 'One point for every centimetre of you. There is nothing left in Florida that frightens you.' }
  ];

  const DAY_LABELS = { where: 'Where we went', best: 'The best bit', bravest: 'The bravest thing I did', stars: 'Today out of five' };
  const LAST_DAY_LABELS = { where: 'How I feel about going home', best: 'The thing I will miss most', bravest: "The first thing I'll tell my friends", stars: 'The whole holiday out of five' };

  const app = document.getElementById('app');
  let content = null;
  let starsById = {};
  let route = '';
  let toastTimer = null;
  const scrollMemo = {};
  let pendingRestore = null;
  let pendingUndo = false;
  let backupMsg = null;

  /* ---------- small helpers ---------- */

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function star(on) { return '<svg' + (on ? '' : ' class="off"') + '><use href="#i-star"/></svg>'; }
  function stars(count) {
    if (!count) return '';
    let html = '<span class="stars" aria-label="' + count + ' stars">';
    for (let i = 1; i <= 5; i++) html += star(i <= count);
    return html + '</span>';
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function localDate(d) {
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function prettyTime(iso) {
    if (!iso) return 'never';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + ' at ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  /* ---------- scoring ---------- */

  function score() {
    const s = Store.state;
    let total = 0;
    Object.keys(s.ticks).forEach(function (id) { total += starsById[id] || 0; });
    Object.keys(s.challenges).forEach(function (id) {
      if (s.challenges[id] && s.challenges[id].done) total += CHALLENGE_POINTS;
    });
    return total;
  }
  function currentRank(points) {
    let rank = null;
    RANKS.forEach(function (r) { if (points >= r.at) rank = r; });
    return rank;
  }
  function nextRank(points) {
    return RANKS.filter(function (r) { return r.at > points; })[0] || null;
  }
  function parkItems(park) {
    return park.groups.reduce(function (all, g) { return all.concat(g.items); }, []);
  }
  function parkDone(park) {
    const ticks = Store.state.ticks;
    return parkItems(park).filter(function (item) { return ticks[item.id]; }).length;
  }

  /* ---------- screens ---------- */

  function bookTitle() {
    const name = (Store.state.profile.name || '').trim();
    return name ? name + "'s Magical Orlando Adventure" : 'My Magical Orlando Adventure';
  }

  function nudgeHtml() {
    const meta = Store.state.meta;
    const today = localDate(new Date());
    const hasEntries = Object.keys(Store.state.ticks).length || Object.keys(Store.state.diary).length;
    const age = meta.lastBackup ? Date.now() - Date.parse(meta.lastBackup) : Infinity;
    if (!hasEntries || age < 24 * 3600 * 1000 || meta.nudgeHiddenOn === today) return '';
    return '<div class="nudge"><p>Grown-up job: back up today\'s adventure</p>' +
      '<a href="#/grown-ups">Back up</a><button data-act="nudge-later">Later</button></div>';
  }

  function dots() {
    return [[8, 18, 3], [22, 62, 2], [14, 80, 3], [30, 12, 2], [52, 92, 2], [46, 6, 3], [34, 94, 2], [6, 56, 2]]
      .map(function (d) {
        return '<span class="dot" style="left:' + d[1] + '%;top:' + d[0] + '%;width:' + d[2] + 'px;height:' + d[2] + 'px"></span>';
      }).join('');
  }

  function viewHome() {
    const points = score();
    const rank = currentRank(points);
    const next = nextRank(points);
    const base = rank ? rank.at : 0;
    const pct = next ? Math.round((points - base) / (next.at - base) * 100) : 100;
    const nameCard = Store.state.profile.name ? '' :
      '<div class="wrap" style="padding-bottom:0"><div class="card">' +
      '<label class="field" style="margin-bottom:0"><span>What is your name, adventurer?</span>' +
      inputTag('profile-name', '') + '</label></div></div>';

    let html = '<section class="hero">' + dots() +
      '<h1>' + esc(bookTitle()) + '</h1>' +
      '<p class="points" id="points">' + points + '</p>' +
      '<p class="points-label">bravery ' + (points === 1 ? 'point' : 'points') + '</p>' +
      '<p class="rank">' + esc(rank ? rank.name : 'Ready for take-off') + '</p>' +
      '<p class="rank-next">' + (next
        ? plural(next.at - points, 'more point') + ' to ' + esc(next.name)
        : 'You have reached the very top. Well done!') + '</p>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div></section>';
    html += nudgeHtml() + nameCard;

    html += '<div class="wrap">' + todayCard() + '<div class="awards"><h2>Bravery awards</h2>';
    RANKS.forEach(function (r) {
      html += '<div class="award' + (points >= r.at ? ' got' : '') + '"><div class="badge">' + r.at + '</div><div>' +
        '<h3>' + esc(r.name) + '</h3><p>' + esc(r.line) + '</p></div></div>';
    });
    html += '</div><a class="small-link" href="#/grown-ups">Grown-ups</a></div>';
    return html;
  }

  function todayDay() {
    const today = localDate(new Date());
    return content.diaryDays.filter(function (d) { return d.date === today; })[0] || null;
  }

  function todayCard() {
    const day = todayDay();
    if (!day) return '';
    return '<a class="card today" href="#/diary/' + day.id + '"><div class="card-top"><b>Today\'s diary</b>' +
      '<span>Day ' + day.dayNumber + '</span></div><span class="sub">' + esc(day.label) + '</span></a>';
  }

  function viewParks() {
    let html = '<div class="parkhead"><h2>My tick list</h2><p>Tap a place to see what is there</p></div><div class="wrap">';
    content.parks.forEach(function (park) {
      const total = parkItems(park).length;
      const done = parkDone(park);
      html += '<a class="card' + (done === total ? ' done' : '') + '" href="#/park/' + park.id + '">' +
        '<div class="card-top"><b>' + esc(park.name) + '</b><span>' + done + ' of ' + total + '</span></div>' +
        '<div class="bar"><i style="width:' + Math.round(done / total * 100) + '%"></i></div></a>';
    });
    return html + '</div>';
  }

  function tickRow(item) {
    const ticked = !!Store.state.ticks[item.id];
    return '<button class="tick" role="checkbox" aria-checked="' + ticked + '" data-tick="' + esc(item.id) + '">' +
      '<span class="box"><svg><use href="#i-tick"/></svg></span>' +
      '<span class="nm">' + esc(item.label) +
      (item.note ? '<small>' + esc(item.note) + '</small>' : '') +
      (item.heightCm ? '<span class="ht" aria-label="height rule ' + item.heightCm + ' centimetres, cleared">' + item.heightCm + 'cm &#10003;</span>' : '') +
      '</span>' + stars(item.stars) + '</button>';
  }

  function viewPark(id) {
    const park = content.parks.filter(function (p) { return p.id === id; })[0];
    if (!park) return viewParks();
    let html = topbar('#/parks', 'Tick list', parkDone(park) + ' of ' + parkItems(park).length) +
      '<div class="parkhead"><h2>' + esc(park.name) + '</h2></div>';
    if (id === HEIGHT_NOTE) {
      html += '<div class="note rose"><b>The green one.</b> The Incredible Hulk Coaster asks for 137 centimetres, ' +
        'which makes it the only ride in the whole of Orlando you are not tall enough for yet. Go and stand under it, ' +
        'watch it roar past, and remember it. That one is for next time.</div>';
    }
    park.groups.forEach(function (group) {
      html += '<h3 class="group">' + esc(group.heading) + '</h3>' + group.items.map(tickRow).join('');
    });
    return html;
  }

  function topbar(href, label, middle) {
    return '<div class="topbar"><a class="back" href="' + href + '"><svg><use href="#i-back"/></svg>' + esc(label) + '</a>' +
      '<span class="count" id="count">' + esc(middle) + '</span>' +
      '<span class="pill" id="pill"><svg><use href="#i-star"/></svg><span id="pill-n">' + score() + '</span></span></div>';
  }

  function viewDiary() {
    const today = todayDay();
    let html = '<div class="parkhead"><h2>My diary</h2><p>Three little lines a day</p></div><div class="wrap">';
    content.diaryDays.forEach(function (day) {
      const entry = Store.state.diary[day.id] || {};
      const words = entry.where || entry.best || entry.bravest || '';
      html += '<a class="card' + (today && today.id === day.id ? ' today' : '') + '" href="#/diary/' + day.id + '">' +
        '<div class="dayline"><h3>Day ' + day.dayNumber + '</h3>' + stars(entry.stars) + '</div>' +
        '<span class="sub">' + esc(day.label) + (day.going_home ? ' · going home' : '') + '</span>' +
        (words ? '<p class="preview">' + esc(words) + '</p>' : '') + '</a>';
    });
    return html + '</div>';
  }

  function inputTag(field, value) {
    return '<input type="text" data-field="' + field + '" value="' + esc(value) + '" ' + noHelp() + '>';
  }
  function noHelp() {
    return 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';
  }

  function viewDay(id) {
    const days = content.diaryDays;
    const index = days.findIndex(function (d) { return d.id === id; });
    if (index < 0) return viewDiary();
    const day = days[index];
    const labels = day.going_home ? LAST_DAY_LABELS : DAY_LABELS;
    const entry = Store.state.diary[day.id] || {};

    let html = topbar('#/diary', 'Diary', 'Day ' + day.dayNumber) +
      '<div class="parkhead"><h2>Day ' + day.dayNumber + '</h2><p>' + esc(day.label) + (day.going_home ? ' · going home' : '') + '</p></div><div class="wrap">';
    ['where', 'best', 'bravest'].forEach(function (field) {
      html += '<label class="field"><span>' + esc(labels[field]) + '</span>' +
        '<textarea rows="2" data-day="' + day.id + '" data-part="' + field + '" ' + noHelp() + '>' + esc(entry[field] || '') + '</textarea></label>';
    });
    html += '<div class="rate"><span>' + esc(labels.stars) + '</span><div class="rate-row">';
    for (let i = 1; i <= 5; i++) {
      html += '<button class="' + (i <= (entry.stars || 0) ? 'on' : '') + '" data-rate="' + i + '" data-day="' + day.id + '" aria-label="' + plural(i, 'star') + '"><svg><use href="#i-star"/></svg></button>';
    }
    html += '</div></div><div class="daynav">';
    if (index > 0) html += '<a class="btn quiet" href="#/diary/' + days[index - 1].id + '">Day ' + days[index - 1].dayNumber + '</a>';
    if (index < days.length - 1) html += '<a class="btn quiet" href="#/diary/' + days[index + 1].id + '">Day ' + days[index + 1].dayNumber + '</a>';
    return html + '</div></div>';
  }

  function viewGrownUps() {
    const meta = Store.state.meta;
    let html = topbar('#/', 'Back', 'Grown-ups') + '<div class="wrap adult">';
    html += '<h2>Backup</h2><p>Last backup: <b id="last-backup">' + esc(prettyTime(meta.lastBackup)) + '</b></p>' +
      '<div id="backup-msg">' + backupMsgHtml() + '</div>' +
      '<button class="btn pink" data-act="backup">Back up now</button>' +
      '<details><summary>Other ways to back up</summary>' +
      '<button class="btn quiet" data-act="download">Save a file to this tablet</button>' +
      '<button class="btn quiet" data-act="copy">Copy the backup as text</button>' +
      '<textarea class="code" id="backup-text" readonly hidden></textarea></details>';

    html += '<h2>Restore</h2><p>This replaces what is on this tablet with what is in the backup. It always asks first.</p>' +
      '<div id="restore-area">' + restoreHtml() + '</div>';

    html += '<h2>Name</h2><label class="field"><span>The name in the title</span>' +
      inputTag('profile-name', Store.state.profile.name) + '</label>';

    html += '<h2>How safe is it?</h2><ul class="health" id="health"><li><span>Checking…</span></li></ul>' +
      '<p style="margin-top:12px">Never use <b>Clear browsing data</b> on this tablet during the trip. It would wipe everything here.</p>';
    return html + '</div>';
  }

  function backupMsgHtml() {
    if (!backupMsg) return '';
    return '<p class="msg' + (backupMsg.bad ? ' bad' : '') + '">' + esc(backupMsg.text) + '</p>';
  }

  function restoreHtml() {
    if (pendingUndo) {
      return '<div class="confirm"><p><b>Put this tablet back to how it was before the last restore?</b></p>' +
        '<button class="btn pink" data-act="undo-yes">Yes, put it back</button>' +
        '<button class="btn quiet" data-act="restore-no">No, keep what is here</button></div>';
    }
    if (pendingRestore) {
      const s = pendingRestore.summary;
      return '<div class="confirm"><p><b>Replace everything on this tablet with this backup?</b></p>' +
        '<p>Backup from ' + esc(prettyTime(s.exportedAt)) + (s.name ? ' (' + esc(s.name) + ')' : '') + '<br>' +
        plural(s.ticks, 'tick') + ', ' + plural(s.diaryDays, 'diary day') + ', ' + plural(s.photos, 'photo') + '</p>' +
        '<button class="btn pink" data-act="restore-yes">Yes, replace it</button>' +
        '<button class="btn quiet" data-act="restore-no">No, keep what is here</button></div>';
    }
    return '<label class="btn quiet">Choose a backup file<input type="file" id="restore-file" hidden></label>' +
      '<details><summary>Paste a backup instead</summary>' +
      '<textarea class="code" id="restore-text" ' + noHelp() + '></textarea>' +
      '<button class="btn quiet" data-act="restore-paste">Check this backup</button></details>' +
      '<div id="restore-msg"></div>' +
      (Store.hasUndoRestore() ? '<button class="btn quiet" data-act="undo-restore">Undo the last restore</button>' : '');
  }

  async function fillHealth() {
    const list = document.getElementById('health');
    if (!list) return;
    const info = await Store.storageInfo();
    let offlineReady = false;
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller && window.caches) {
        offlineReady = (await caches.keys()).length > 0;
      }
    } catch (err) {
      console.error('offline check failed:', err);
    }
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const yesNo = function (flag, yes, no) {
      if (flag === null) return '<b>Cannot tell</b>';
      return flag ? '<b class="yes">' + yes + '</b>' : '<b class="no">' + no + '</b>';
    };
    const health = Store.health;
    const rows = [
      ['Last saved', '<b>' + esc(prettyTime(Store.state.meta.lastSaved)) + '</b>'],
      ['Ready to open with no internet', yesNo(offlineReady, 'Yes', 'No')],
      ['Protected from automatic clearing', yesNo(info.persisted, 'Yes', 'Not yet')],
      ['Saving to both places', yesNo(health.localOk && health.idbOk, 'Yes', 'No')],
      ['Opened from the home screen', yesNo(standalone, 'Yes', 'No, in a browser tab')],
      ['Share button on this browser', yesNo(!!navigator.canShare, 'Yes', 'No')],
      ['Space used', '<b>' + (info.usageMb === null ? '?' : info.usageMb + 'MB of ' + info.quotaMb + 'MB') + '</b>'],
      ['App version', '<b>' + esc(APP_VERSION) + '</b>']
    ];
    if (document.getElementById('health') === list) {
      list.innerHTML = rows.map(function (r) { return '<li><span>' + r[0] + '</span>' + r[1] + '</li>'; }).join('');
    }
  }

  /* ---------- backup actions ---------- */

  function setBackupMsg(text, bad) {
    backupMsg = { text: text, bad: !!bad };
    const el = document.getElementById('backup-msg');
    if (el) el.innerHTML = backupMsgHtml();
  }

  function markBackedUp() {
    Store.update(function (s) { s.meta.lastBackup = new Date().toISOString(); });
    const el = document.getElementById('last-backup');
    if (el) el.textContent = prettyTime(Store.state.meta.lastBackup);
  }

  function saveFile(backup) {
    const url = URL.createObjectURL(new Blob([backup.text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = backup.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // Android browsers refuse to share .json, so try .txt next. Restore reads either.
  function shareableFile(backup) {
    if (!navigator.canShare || !window.File) return null;
    const candidates = [
      new File([backup.text], backup.filename, { type: 'application/json' }),
      new File([backup.text], backup.filename.replace(/\.json$/, '.txt'), { type: 'text/plain' })
    ];
    return candidates.filter(function (file) {
      try { return navigator.canShare({ files: [file] }); } catch (err) { return false; }
    })[0] || null;
  }

  async function doBackup() {
    let backup;
    try {
      backup = await Store.exportBackup();
    } catch (err) {
      console.error('backup failed:', err);
      setBackupMsg('That backup did not work, try again.', true);
      return;
    }
    const file = shareableFile(backup);
    if (file) {
      try {
        await navigator.share({ files: [file], title: 'Orlando adventure backup' });
        markBackedUp();
        setBackupMsg('Backup sent. Check it has arrived.');
        return;
      } catch (err) {
        if (err.name === 'AbortError') { setBackupMsg('Backup cancelled.'); return; }
        console.error('share failed:', err);
      }
    }
    doDownload(backup);
  }

  async function doDownload(backup) {
    try {
      const made = backup || await Store.exportBackup();
      saveFile(made);
      markBackedUp();
      setBackupMsg('Saved as ' + made.filename + ' in the Downloads folder on this tablet. It is still only on this tablet, so email it to yourself as an attachment.');
    } catch (err) {
      console.error('download failed:', err);
      setBackupMsg('That did not save. Try "Copy the backup as text" instead.', true);
    }
  }

  async function doCopy() {
    const box = document.getElementById('backup-text');
    try {
      const backup = await Store.exportBackup();
      box.value = backup.text;
      box.hidden = false;
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        copied = await navigator.clipboard.writeText(backup.text).then(function () { return true; }, function () { return false; });
      }
      if (!copied) {
        box.select();
        copied = document.execCommand('copy');
      }
      if (copied) {
        markBackedUp();
        setBackupMsg('Copied. Now paste it into an email to yourself and send it.');
      } else {
        setBackupMsg('Could not copy automatically. Press and hold in the box below, select all, then copy.', true);
      }
    } catch (err) {
      console.error('copy failed:', err);
      setBackupMsg('That did not work, try again.', true);
    }
  }

  function showRestoreMsg(text) {
    const el = document.getElementById('restore-msg');
    if (el) el.innerHTML = '<p class="msg bad">' + esc(text) + '</p>';
  }

  function prepareRestore(text) {
    try {
      pendingRestore = Store.readBackup(text);
      document.getElementById('restore-area').innerHTML = restoreHtml();
    } catch (err) {
      showRestoreMsg(err.message);
    }
  }

  async function runRestore(work, doneText) {
    try {
      await work();
      pendingRestore = null;
      pendingUndo = false;
      backupMsg = null;
      render();
      toast(doneText);
    } catch (err) {
      console.error('restore failed:', err);
      showRestoreMsg('That did not restore, nothing has changed. Try again.');
    }
  }

  /* ---------- changes ---------- */

  function setTick(id, button) {
    const before = score();
    const ticked = !Store.state.ticks[id];
    Store.update(function (s) {
      if (ticked) s.ticks[id] = new Date().toISOString();
      else delete s.ticks[id];
    });
    button.setAttribute('aria-checked', String(ticked));

    const after = score();
    const number = document.getElementById('pill-n');
    if (number) number.textContent = after;
    const pill = document.getElementById('pill');
    if (pill && after !== before) {
      pill.classList.remove('bump');
      void pill.offsetWidth;
      pill.classList.add('bump');
    }
    const parts = route.split('/');
    const park = content.parks.filter(function (p) { return p.id === parts[2]; })[0];
    const count = document.getElementById('count');
    if (park && count) count.textContent = parkDone(park) + ' of ' + parkItems(park).length;

    const rank = currentRank(after);
    if (rank && rank !== currentRank(before) && after > before) toast('You are now a ' + rank.name + '!');
  }

  function setDayPart(dayId, part, value) {
    Store.update(function (s) {
      if (!s.diary[dayId]) s.diary[dayId] = { where: '', best: '', bravest: '', stars: 0 };
      s.diary[dayId][part] = value;
    });
  }

  document.addEventListener('click', function (e) {
    const tick = e.target.closest('[data-tick]');
    if (tick) { setTick(tick.getAttribute('data-tick'), tick); return; }

    const rate = e.target.closest('[data-rate]');
    if (rate) {
      const dayId = rate.getAttribute('data-day');
      const value = Number(rate.getAttribute('data-rate'));
      const current = (Store.state.diary[dayId] || {}).stars || 0;
      const next = current === value ? 0 : value;
      setDayPart(dayId, 'stars', next);
      rate.parentNode.querySelectorAll('button').forEach(function (b, i) {
        b.className = i < next ? 'on' : '';
      });
      return;
    }

    const act = e.target.closest('[data-act]');
    if (!act) return;
    switch (act.getAttribute('data-act')) {
      case 'backup': doBackup(); break;
      case 'download': doDownload(); break;
      case 'copy': doCopy(); break;
      case 'nudge-later':
        Store.update(function (s) { s.meta.nudgeHiddenOn = localDate(new Date()); });
        act.parentNode.remove();
        break;
      case 'restore-paste':
        prepareRestore(document.getElementById('restore-text').value);
        break;
      case 'restore-no':
        pendingRestore = null;
        pendingUndo = false;
        document.getElementById('restore-area').innerHTML = restoreHtml();
        break;
      case 'restore-yes':
        runRestore(function () { return Store.applyBackup(pendingRestore.parsed); }, 'Backup restored');
        break;
      case 'undo-restore':
        pendingUndo = true;
        document.getElementById('restore-area').innerHTML = restoreHtml();
        break;
      case 'undo-yes':
        runRestore(function () { return Store.undoRestore(); }, 'Put back as it was');
        break;
    }
  });

  document.addEventListener('input', function (e) {
    const el = e.target;
    if (el.hasAttribute('data-part')) {
      setDayPart(el.getAttribute('data-day'), el.getAttribute('data-part'), el.value);
    } else if (el.getAttribute('data-field') === 'profile-name') {
      Store.update(function (s) { s.profile.name = el.value; });
      document.title = bookTitle();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id !== 'restore-file') return;
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () { prepareRestore(reader.result); };
    reader.onerror = function () {
      console.error('could not read file:', reader.error);
      showRestoreMsg('Could not read that file. Try again.');
    };
    reader.readAsText(file);
  });

  // The keyboard takes the bottom of the screen, so the nav steps out of its way
  document.addEventListener('focusin', function (e) {
    if (!/^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
    document.body.classList.add('typing');
    setTimeout(function () { e.target.scrollIntoView({ block: 'center' }); }, 350);
  });
  document.addEventListener('focusout', function () {
    document.body.classList.remove('typing');
  });

  /* ---------- routing ---------- */

  function navFor(path) {
    if (path === '#/parks' || path.indexOf('#/park/') === 0) return 'parks';
    if (path.indexOf('#/diary') === 0) return 'diary';
    if (path.indexOf('#/activit') === 0) return 'activities';
    return 'home';
  }

  function render() {
    const path = location.hash || '#/';
    const parts = path.split('/');
    let html;
    Activities.leave();
    if (parts[1] === 'parks') html = viewParks();
    else if (parts[1] === 'activities') html = Activities.listHtml();
    else if (parts[1] === 'activity') html = Activities.pageHtml(parts[2]);
    else if (parts[1] === 'park') html = viewPark(parts[2]);
    else if (parts[1] === 'diary' && parts[2]) html = viewDay(parts[2]);
    else if (parts[1] === 'diary') html = viewDiary();
    else if (parts[1] === 'grown-ups') html = viewGrownUps();
    else html = viewHome();

    app.innerHTML = html;
    document.title = bookTitle();
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.classList.toggle('on', a.getAttribute('data-nav') === navFor(path));
    });
    if (parts[1] === 'grown-ups') fillHealth();
  }

  function go() {
    if (route) scrollMemo[route] = window.scrollY;
    route = location.hash || '#/';
    document.body.classList.remove('typing');
    render();
    window.scrollTo(0, scrollMemo[route] || 0);
  }

  /* ---------- start ---------- */

  function showProblem() {
    app.innerHTML = '<div class="problem"><h1>Nearly there</h1><p>The adventure book could not open just now. ' +
      'Everything you saved is still safe. Close this and try again, or connect to wifi once.</p></div>';
    document.querySelector('.nav').style.display = 'none';
  }

  async function start() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    Store.init({ appVersion: APP_VERSION });
    Store.on('error', function () { toast('That did not save, try again'); });
    Store.on('external', function () {
      const active = document.activeElement;
      if (active && /^(TEXTAREA|INPUT)$/.test(active.tagName)) return;
      if (content) render();
    });

    await Store.load();

    try {
      const response = await fetch('./content.json');
      if (!response.ok) throw new Error('content.json ' + response.status);
      content = await response.json();
    } catch (err) {
      console.error('Could not load content:', err);
      showProblem();
      return;
    }

    // The tick list and diary must still open if this one file fails
    Activities.setUi({ esc: esc, toast: toast, topbar: topbar });
    await Activities.load().catch(function (err) {
      console.error('Could not load activities:', err);
    });

    const known = new Set();
    content.parks.forEach(function (park) {
      parkItems(park).forEach(function (item) { known.add(item.id); starsById[item.id] = item.stars; });
    });
    content.challenges.forEach(function (c) { known.add(c.id); });
    content.diaryDays.forEach(function (d) { known.add(d.id); });
    content.freeText.forEach(function (t) { known.add(t.id); });
    content.drawings.forEach(function (d) { known.add(d.id); });
    Store.validate(known);

    addEventListener('hashchange', go);
    go();
    Store.requestPersist();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function (err) {
        console.error('Service worker did not register:', err);
      });
    }
  }

  start().catch(function (err) {
    console.error('Start failed:', err);
    showProblem();
  });

  window.AppDebug = { score: score, version: APP_VERSION };
})();
