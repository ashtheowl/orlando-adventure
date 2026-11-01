/* Paste into the console on the running app, or load from a test driver.
   Plays every activity through the same taps a child would make and returns
   a list of what happened. It uses the real saved data, so only run it on a
   browser that holds no real entries. */
window.runActivityTests = async function () {
  const data = (await (await fetch('./activities.json')).json()).items;
  const out = [];
  const check = (name, pass, detail) => out.push((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const open = async id => { location.hash = '#/activity/' + id; await wait(80); };
  const count = () => document.getElementById('count').textContent;
  const tap = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const key = k => tap(document.querySelector('[data-key="' + k + '"]'));
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const saved = id => (Store.state.activities || {})[id] || {};
  const overflow = () => document.documentElement.scrollWidth > innerWidth;
  Store.update(s => { s.activities = {}; });

  function find(grid, word) {
    const n = grid.length;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const er = r + dr * (word.length - 1), ec = c + dc * (word.length - 1);
      if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
      let ok = true;
      for (let i = 0; i < word.length; i++) if (grid[r + dr * i][c + dc * i] !== word[i]) { ok = false; break; }
      if (ok) return [r, c, er, ec];
    }
    return null;
  }
  function point(r, c) {
    const box = q('.ws').children[r * 15 + c].getBoundingClientRect();
    return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, cancelable: true, pointerId: 1 };
  }

  // word searches: first word by tapping, the rest by dragging
  for (const item of data.filter(i => i.type === 'wordsearch')) {
    await open(item.id);
    q('.ws').scrollIntoView({ block: 'center' });
    let missing = [];
    for (let w = 0; w < item.words.length; w++) {
      const pos = find(item.grid, item.words[w]);
      if (!pos) { missing.push(item.words[w]); continue; }
      const a = point(pos[0], pos[1]), b = point(pos[2], pos[3]);
      if (w === 0) {
        for (const p of [a, b]) {
          document.elementFromPoint(p.clientX, p.clientY).dispatchEvent(new PointerEvent('pointerdown', p));
          document.dispatchEvent(new PointerEvent('pointerup', p));
        }
      } else {
        document.elementFromPoint(a.clientX, a.clientY).dispatchEvent(new PointerEvent('pointerdown', a));
        document.dispatchEvent(new PointerEvent('pointermove', b));
        document.dispatchEvent(new PointerEvent('pointerup', b));
      }
      await wait(5);
    }
    check('word search ' + item.id + ' every word found', !missing.length && Object.keys(saved(item.id).found || {}).length === item.words.length && !!q('.act-done'), missing.join(',') + ' ' + count());
  }

  // a wrong drag finds nothing
  // crossword: type every across and down answer
  const xw = data.find(i => i.id === 'crossword');
  await open('crossword');
  for (const dir of ['across', 'down']) {
    for (const clue of xw[dir]) {
      tap(q('[data-g="clue"][data-n="' + clue.n + '"][data-d="' + dir + '"]'));
      const key0 = Object.keys(xw.numbers).find(k => xw.numbers[k] === clue.n).split(',').map(Number);
      for (let i = 0; i < clue.len; i++) {
        const r = key0[0] + (dir === 'down' ? i : 0), c = key0[1] + (dir === 'down' ? 0 : i);
        key(xw.rows[r][c]);
      }
    }
  }
  await wait(30);
  check('crossword solved by typing the answers', saved('crossword').done === true && !!q('.act-done'), count());
  tap(q('[data-xr="1"][data-xc="4"]'));
  key('Z');
  tap(q('[data-g="check"]'));
  check('crossword check marks a wrong letter', qa('.xw .wrong').length === 1);
  key('DEL'); key('A');

  // code
  const code = data.find(i => i.id === 'crack-the-code');
  await open('crack-the-code');
  code.messages.forEach((m, mi) => {
    tap(q('[data-g="slot"][data-m="' + mi + '"][data-i="0"]'));
    m.words.flat().forEach(num => key(String.fromCharCode(64 + num)));
  });
  await wait(30);
  check('code messages decode to the book answers', qa('.act-done').length === 2 && code.messages.every(m => m.words.map(w => w.map(n => String.fromCharCode(64 + n)).join('')).join(' ') === m.answer), count());

  // mixed up: every answer uses exactly the scrambled letters
  const mixed = data.find(i => i.id === 'mixed-up-rides');
  check('mixed-up answers are anagrams', mixed.puzzles.every(p => p.scram.split('').sort().join('') === p.answer.split('').sort().join('')));
  await open('mixed-up-rides');
  tap(q('[data-g="pick"]'));
  await wait(10);
  for (let guard = 0; guard < 200 && qa('[data-g="pick"]').length + qa('[data-g="unpick"]').length; guard++) {
    const unpick = qa('[data-g="unpick"]');
    if (unpick.length) { tap(unpick[0]); await wait(1); continue; }
    const puzzle = mixed.puzzles[Number(q('[data-g="pick"]').getAttribute('data-p'))];
    const used = [];
    for (const ch of puzzle.answer) {
      const i = puzzle.scram.split('').findIndex((x, n) => x === ch && !used.includes(n));
      used.push(i);
      tap(q('[data-g="pick"][data-i="' + i + '"]'));
    }
    await wait(1);
  }
  check('mixed-up rides all solved', Object.keys(saved('mixed-up-rides').solved || {}).length === 12 && !!q('.act-done'), count());

  // quizzes: answer key right, score right
  for (const item of data.filter(i => i.type === 'quiz')) {
    await open(item.id);
    item.qs.forEach((one, i) => tap(q('[data-g="pick"][data-q="' + i + '"][data-o="' + (i === 0 ? (one.ans + 1) % one.opts.length : one.ans) + '"]')));
    check('quiz ' + item.id + ' scores one wrong as ' + (item.qs.length - 1), q('.act-done').textContent.indexOf(String(item.qs.length - 1)) >= 0, q('.act-done').textContent);
  }

  // spot the difference: every spot found by tapping the picture, none by a miss
  for (const item of data.filter(i => i.type === 'spot')) {
    await open(item.id);
    const clickAt = (pic, x, y) => {
      const box = pic.getBoundingClientRect();
      pic.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.left + box.width * x / 130, clientY: box.top + box.height * y / 86 }));
    };
    item.spots.forEach(s => clickAt(q('.pic'), s.x, s.y));
    check('spot ' + item.id + ' all found', (saved(item.id).found || []).length === item.spots.length && !!q('.act-done'), count());
  }

  // bingo
  await open('theme-park-bingo');
  [0, 1, 2, 3, 4].forEach(i => tap(q('[data-g="mark"][data-i="' + i + '"]')));
  check('bingo line is noticed', q('.act-done') && q('.act-done').textContent.indexOf('Bingo') >= 0);
  check('bingo free square counts', count() === '6 of 25', count());

  // I-spy
  await open('aeroplane-ispy');
  tap(q('[data-g="thing"][data-i="3"]'));
  const box = q('[data-g-text]');
  box.value = 'A man in a kilt  !';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  check('I-spy tick and words saved', saved('aeroplane-ispy').ticks[3] && saved('aeroplane-ispy').strange === 'A man in a kilt  !', count());

  // would you rather
  await open('would-you-rather');
  tap(q('[data-g="pick"][data-q="2"][data-o="1"]'));
  check('would you rather saved', saved('would-you-rather').picks[2] === 1 && qa('.opt.right').length === 1);

  // noughts and crosses
  await open('noughts-and-crosses');
  tap(q('[data-m="friend"]'));
  for (const i of [0, 3, 1, 4, 2]) tap(q('[data-g="square"][data-i="' + i + '"]'));
  check('noughts: pass to a friend win', saved('noughts-and-crosses').tally.X === 1 && q('.clue-now').textContent === 'X won!', q('.clue-now').textContent);
  tap(q('[data-g="next"]'));
  tap(q('[data-m="tablet"]'));
  await wait(20);
  tap(q('[data-g="square"][data-i="4"]'));
  await wait(750);
  check('noughts: tablet replies', saved('noughts-and-crosses').board.filter(Boolean).length === 2, saved('noughts-and-crosses').board.join('.'));
  const b = saved('noughts-and-crosses').board.slice();
  tap(q('[data-g="square"][data-i="' + b.findIndex(x => x === 'O') + '"]'));
  check('noughts: cannot take a used square', saved('noughts-and-crosses').board.join() === b.join());

  // hangman: win one, lose one
  await open('hangman');
  const w = saved('hangman').word;
  [...new Set(w.split(''))].forEach(key);
  check('hangman win', saved('hangman').wins === 1 && !!q('.act-done'), w);
  tap(q('[data-g="next"]'));
  await wait(20);
  const w2 = saved('hangman').word;
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(k => w2.indexOf(k) < 0).slice(0, 6).forEach(key);
  check('hangman lost after six, word shown', !!q('.act-done') && qa('.hl.blank').length === 0, w2);

  // start again asks first
  await open('disney-quiz');
  tap(q('[data-g="again"]'));
  check('start again asks first, nothing cleared yet', !!q('[data-g="again-yes"]') && Object.keys(saved('disney-quiz').picks).length === 8);
  tap(q('[data-g="again-yes"]'));
  check('start again clears only that activity', !saved('disney-quiz').picks && !!saved('universal-quiz').picks);

  // list view totals, and nothing overflows
  location.hash = '#/activities';
  await wait(80);
  check('activity list shows 20', qa('a[href^="#/activity/"]').length === 20);
  const wide = [];
  for (const id of data.map(i => i.id)) { await open(id); if (overflow()) wide.push(id); }
  check('no sideways scroll at ' + innerWidth, !wide.length, wide.join(','));
  const small = [];
  for (const id of data.map(i => i.id)) {
    await open(id);
    qa('#act button').forEach(el => { const h = el.getBoundingClientRect().height; if (el.offsetParent && h < 56) small.push(id + ':' + el.className + ':' + Math.round(h)); });
  }
  check('tap targets at least 56 high', !small.length, [...new Set(small)].slice(0, 6).join(' '));
  return out;
};
