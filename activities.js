/* activities.js: the puzzles and games. The puzzles come from activities.json;
   progress is saved through Store under state.activities, keyed on each
   activity's id, so it is in backups and survives updates like everything else. */
(function () {
  'use strict';

  const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  const LINES_3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const WRONG_LIMIT = 6;

  let items = [];
  let ui = null;
  let current = null;
  let view = {};           // what is selected on screen, nothing that needs saving
  let confirming = false;

  /* ---------- saved progress ---------- */

  function saved(id) { return (Store.state.activities || {})[id] || {}; }
  function save(id, change) {
    Store.update(function (s) {
      if (!s.activities) s.activities = {};
      if (!s.activities[id]) s.activities[id] = {};
      change(s.activities[id]);
    });
  }

  /* ---------- shared pieces ---------- */

  function draw() {
    const box = document.getElementById('act');
    if (!box || !current) return;
    box.innerHTML = kinds[current.type].body(current, saved(current.id));
    const count = document.getElementById('count');
    if (count) count.textContent = countLabel(current);
  }

  function countLabel(item) {
    const p = progress(item);
    return p ? p.done + ' of ' + p.total : 'Games';
  }

  function progress(item) {
    const fn = kinds[item.type].progress;
    return fn ? fn(item, saved(item.id)) : null;
  }

  function keypad(states) {
    states = states || {};
    const rows = KEY_ROWS.map(function (row, i) {
      const keys = row.split('').map(function (k) {
        return '<button class="key ' + (states[k] || '') + '" data-key="' + k + '"' + (states[k] ? ' disabled' : '') + '>' + k + '</button>';
      }).join('');
      return '<div class="key-row">' + keys + (i === 2 && !states.noDelete ? '<button class="key wide" data-key="DEL" aria-label="Delete">&#9003;</button>' : '') + '</div>';
    }).join('');
    return '<div class="keys">' + rows + '</div>';
  }

  function againHtml(hasProgress) {
    if (!hasProgress) return '';
    if (confirming) {
      return '<div class="confirm"><p><b>Clear this and start again?</b></p>' +
        '<button class="btn pink" data-g="again-yes">Yes, start again</button>' +
        '<button class="btn quiet" data-g="again-no">No, keep it</button></div>';
    }
    return '<button class="btn quiet" data-g="again">Start again</button>';
  }

  function wellDone(text) { return '<p class="act-done">' + ui.esc(text) + '</p>'; }

  /* ---------- word search ---------- */

  function lineCells(r1, c1, r2, c2) {
    let dr = r2 - r1;
    let dc = c2 - c1;
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) {
      // snap a wobbly drag onto the nearest straight line
      if (Math.abs(dr) > 2 * Math.abs(dc)) dc = 0;
      else if (Math.abs(dc) > 2 * Math.abs(dr)) dr = 0;
      else {
        const size = Math.max(Math.abs(dr), Math.abs(dc));
        dr = Math.sign(dr) * size;
        dc = Math.sign(dc) * size;
      }
    }
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    const cells = [];
    for (let i = 0; i <= steps; i++) {
      cells.push([r1 + Math.sign(dr) * i, c1 + Math.sign(dc) * i]);
    }
    return cells;
  }

  function paintSelection(cells) {
    const grid = document.querySelector('.ws');
    if (!grid) return;
    const n = current.grid.length;
    grid.querySelectorAll('.sel').forEach(function (el) { el.classList.remove('sel'); });
    cells.forEach(function (cell) {
      if (cell[0] >= 0 && cell[0] < n && cell[1] >= 0 && cell[1] < n) grid.children[cell[0] * n + cell[1]].classList.add('sel');
    });
  }

  function finishSelection(start, end) {
    const cells = lineCells(start.r, start.c, end.r, end.c);
    const text = cells.map(function (cell) { return (current.grid[cell[0]] || '')[cell[1]] || ''; }).join('');
    const reversed = text.split('').reverse().join('');
    const found = saved(current.id).found || {};
    const word = current.words.filter(function (w) { return (w === text || w === reversed) && !found[w]; })[0];
    view.anchor = null;
    if (word) {
      const last = cells[cells.length - 1];
      save(current.id, function (s) {
        if (!s.found) s.found = {};
        s.found[word] = [start.r, start.c, last[0], last[1]];
      });
      draw();
    } else {
      paintSelection([]);
    }
  }

  function cellAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest ? el.closest('[data-r]') : null;
    return cell ? { r: Number(cell.getAttribute('data-r')), c: Number(cell.getAttribute('data-c')) } : null;
  }

  let drag = null;
  document.addEventListener('pointerdown', function (e) {
    if (!current || current.type !== 'wordsearch' || !e.target.closest('.ws')) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    drag = { start: cell, end: cell };
    paintSelection(lineCells(cell.r, cell.c, cell.r, cell.c));
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    drag.end = cell;
    paintSelection(lineCells(drag.start.r, drag.start.c, cell.r, cell.c));
  });
  document.addEventListener('pointerup', function () {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.start.r === d.end.r && d.start.c === d.end.c) {
      // a tap: first letter now, last letter next
      if (view.anchor) finishSelection(view.anchor, d.end);
      else view.anchor = d.start;
    } else {
      finishSelection(d.start, d.end);
    }
  });
  document.addEventListener('pointercancel', function () {
    drag = null;
    view.anchor = null;
    paintSelection([]);
  });

  /* ---------- crossword helpers ---------- */

  function isCell(item, r, c) {
    return r >= 0 && r < item.rows.length && c >= 0 && c < item.rows[0].length && item.rows[r][c] !== '#';
  }

  function wordCells(item, r, c, dir) {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'down' ? 0 : 1;
    while (isCell(item, r - dr, c - dc)) { r -= dr; c -= dc; }
    const cells = [];
    while (isCell(item, r, c)) { cells.push([r, c]); r += dr; c += dc; }
    return cells;
  }

  function startOf(item, n) {
    const key = Object.keys(item.numbers).filter(function (k) { return item.numbers[k] === n; })[0];
    return key.split(',').map(Number);
  }

  function selectClue(item, n, dir) {
    const pos = startOf(item, n);
    view.cur = { r: pos[0], c: pos[1] };
    view.dir = dir;
  }

  function activeClue(item) {
    const cells = wordCells(item, view.cur.r, view.cur.c, view.dir);
    const n = item.numbers[cells[0][0] + ',' + cells[0][1]];
    return item[view.dir].filter(function (clue) { return clue.n === n; })[0] || null;
  }

  function crosswordFinished(item, letters) {
    return item.rows.every(function (row, r) {
      return row.split('').every(function (ch, c) { return ch === '#' || letters[r + ',' + c] === ch; });
    });
  }

  /* ---------- noughts and crosses helpers ---------- */

  function winner(board) {
    for (let i = 0; i < LINES_3.length; i++) {
      const l = LINES_3[i];
      if (board[l[0]] && board[l[0]] === board[l[1]] && board[l[1]] === board[l[2]]) return board[l[0]];
    }
    return board.every(Boolean) ? 'draw' : '';
  }

  function emptySquares(board) {
    return board.map(function (v, i) { return v ? -1 : i; }).filter(function (i) { return i >= 0; });
  }

  function finishingMove(board, mark) {
    return emptySquares(board).filter(function (i) {
      const copy = board.slice();
      copy[i] = mark;
      return winner(copy) === mark;
    })[0];
  }

  // Beatable on purpose: about one move in three is just a guess
  function tabletMove(board) {
    const free = emptySquares(board);
    const guess = free[Math.floor(Math.random() * free.length)];
    if (Math.random() < 0.34) return guess;
    const win = finishingMove(board, 'O');
    if (win !== undefined) return win;
    const block = finishingMove(board, 'X');
    if (block !== undefined) return block;
    return board[4] ? guess : 4;
  }

  function placeMark(id, index, mark) {
    save(id, function (s) {
      s.board[index] = mark;
      const result = winner(s.board);
      if (result) {
        if (!s.tally) s.tally = { X: 0, O: 0, draw: 0 };
        s.tally[result] += 1;
      }
    });
  }

  /* ---------- hangman helpers ---------- */

  function pickWord(item) {
    save(item.id, function (s) {
      const used = s.used || [];
      let left = item.words.filter(function (w) { return used.indexOf(w) < 0; });
      if (!left.length) { left = item.words; s.used = []; }
      s.word = left[Math.floor(Math.random() * left.length)];
      s.guessed = '';
      s.used = (s.used || []).concat([s.word]);
    });
  }

  function wrongLetters(s) {
    return (s.guessed || '').split('').filter(function (k) { return s.word.indexOf(k) < 0; });
  }

  function hangmanWon(s) {
    return s.word.split('').every(function (k) { return (s.guessed || '').indexOf(k) >= 0; });
  }

  /* ---------- each kind of activity ---------- */

  const kinds = {
    wordsearch: {
      progress: function (item, s) { return { done: Object.keys(s.found || {}).length, total: item.words.length }; },
      body: function (item, s) {
        const found = s.found || {};
        const on = {};
        Object.keys(found).forEach(function (w) {
          const f = found[w];
          lineCells(f[0], f[1], f[2], f[3]).forEach(function (cell) { on[cell[0] + ',' + cell[1]] = true; });
        });
        let cells = '';
        item.grid.forEach(function (row, r) {
          row.split('').forEach(function (ch, c) {
            cells += '<span data-r="' + r + '" data-c="' + c + '"' + (on[r + ',' + c] ? ' class="got"' : '') + '>' + ch + '</span>';
          });
        });
        const words = item.words.map(function (w) { return '<span class="word' + (found[w] ? ' got' : '') + '">' + w + '</span>'; }).join('');
        const left = item.words.length - Object.keys(found).length;
        return '<div class="ws" style="--n:' + item.grid.length + '">' + cells + '</div>' +
          '<p class="act-tip">Drag across a word, or tap its first letter and then its last.</p>' +
          (left ? '' : wellDone('You found them all!')) +
          '<div class="words">' + words + '</div>' + againHtml(Object.keys(found).length > 0);
      },
      click: function () {}
    },

    crossword: {
      progress: function (item, s) {
        const letters = s.letters || {};
        let done = 0;
        let total = 0;
        item.rows.forEach(function (row, r) {
          row.split('').forEach(function (ch, c) {
            if (ch === '#') return;
            total += 1;
            if (letters[r + ',' + c]) done += 1;
          });
        });
        return { done: done, total: total };
      },
      open: function (item) { selectClue(item, item.across[0].n, 'across'); },
      body: function (item, s) {
        const letters = s.letters || {};
        const n = item.rows[0].length;
        const active = {};
        wordCells(item, view.cur.r, view.cur.c, view.dir).forEach(function (cell) { active[cell[0] + ',' + cell[1]] = true; });
        let cells = '';
        item.rows.forEach(function (row, r) {
          row.split('').forEach(function (ch, c) {
            if (ch === '#') { cells += '<span class="blk"></span>'; return; }
            const key = r + ',' + c;
            const value = letters[key] || '';
            let cls = active[key] ? 'act-word' : '';
            if (view.cur.r === r && view.cur.c === c) cls += ' act-cell';
            if (view.checked && value && value !== ch) cls += ' wrong';
            cells += '<span class="' + cls + '" data-g="xw" data-xr="' + r + '" data-xc="' + c + '">' +
              (item.numbers[key] ? '<i>' + item.numbers[key] + '</i>' : '') + value + '</span>';
          });
        });
        const clue = activeClue(item);
        const clueList = function (dir, title) {
          return '<h3 class="group flush">' + title + '</h3>' + item[dir].map(function (one) {
            return '<button class="clue" data-g="clue" data-n="' + one.n + '" data-d="' + dir + '"><b>' + one.n + '</b> ' + ui.esc(one.text) + ' (' + one.len + ')</button>';
          }).join('');
        };
        return '<div class="xw" style="--n:' + n + '">' + cells + '</div>' +
          '<p class="clue-now">' + (clue ? '<b>' + clue.n + ' ' + view.dir + '</b> ' + ui.esc(clue.text) + ' (' + clue.len + ')' : 'Tap a square') + '</p>' +
          (s.done ? wellDone('Every answer is right!') : '') +
          keypad() +
          '<button class="btn quiet" data-g="check">Check my letters</button>' +
          clueList('across', 'Across') + clueList('down', 'Down') +
          '<div style="margin-top:14px">' + againHtml(Object.keys(letters).length > 0) + '</div>';
      },
      click: function (t, g) {
        const item = current;
        if (g === 'xw') {
          const r = Number(t.getAttribute('data-xr'));
          const c = Number(t.getAttribute('data-xc'));
          if (view.cur.r === r && view.cur.c === c) {
            view.dir = view.dir === 'across' ? 'down' : 'across';
          }
          view.cur = { r: r, c: c };
          if (wordCells(item, r, c, view.dir).length < 2) view.dir = view.dir === 'across' ? 'down' : 'across';
          draw();
        } else if (g === 'clue') {
          selectClue(item, Number(t.getAttribute('data-n')), t.getAttribute('data-d'));
          draw();
          window.scrollTo(0, 0);
        } else if (g === 'check') {
          view.checked = true;
          draw();
          const left = document.querySelectorAll('.xw .wrong').length;
          ui.toast(left ? plural(left, 'letter') + ' to change' : 'All good so far!');
        }
      },
      key: function (k) {
        const item = current;
        const key = view.cur.r + ',' + view.cur.c;
        const cells = wordCells(item, view.cur.r, view.cur.c, view.dir);
        const at = cells.findIndex(function (cell) { return cell[0] === view.cur.r && cell[1] === view.cur.c; });
        view.checked = false;
        if (k === 'DEL') {
          const had = (saved(item.id).letters || {})[key];
          save(item.id, function (s) { if (s.letters) delete s.letters[key]; });
          if (!had && at > 0) {
            view.cur = { r: cells[at - 1][0], c: cells[at - 1][1] };
            const prev = view.cur.r + ',' + view.cur.c;
            save(item.id, function (s) { if (s.letters) delete s.letters[prev]; });
          }
        } else {
          save(item.id, function (s) {
            if (!s.letters) s.letters = {};
            s.letters[key] = k;
            s.done = crosswordFinished(item, s.letters);
          });
          if (at < cells.length - 1) view.cur = { r: cells[at + 1][0], c: cells[at + 1][1] };
        }
        draw();
      }
    },

    code: {
      progress: function (item, s) {
        return { done: item.messages.filter(function (m, i) { return codeSolved(m, i, s); }).length, total: item.messages.length };
      },
      open: function () { view.cur = { m: 0, i: 0 }; },
      body: function (item, s) {
        const letters = s.letters || {};
        let key = '<div class="code-key">';
        for (let i = 1; i <= 26; i++) key += '<span><b>' + String.fromCharCode(64 + i) + '</b>' + i + '</span>';
        key += '</div>';
        let html = key;
        item.messages.forEach(function (msg, m) {
          const solved = codeSolved(msg, m, s);
          const nums = codeNumbers(msg);
          const full = nums.every(function (n, i) { return letters[m + ',' + i]; });
          let index = 0;
          html += '<h3 class="group flush">' + ui.esc(msg.name) + '</h3><div class="msg-words">';
          msg.words.forEach(function (word) {
            html += '<span class="msg-word">';
            word.forEach(function (num) {
              const value = letters[m + ',' + index] || '';
              let cls = view.cur.m === m && view.cur.i === index ? 'act-cell' : '';
              if (solved) cls += ' right';
              else if (full && value !== String.fromCharCode(64 + num)) cls += ' wrong';
              html += '<span class="slot ' + cls + '" data-g="slot" data-m="' + m + '" data-i="' + index + '"><b>' + (value || '&nbsp;') + '</b><small>' + num + '</small></span>';
              index += 1;
            });
            html += '</span>';
          });
          html += '</div>' + (solved ? wellDone('Cracked it!') : '');
        });
        return html + keypad() + againHtml(Object.keys(letters).length > 0);
      },
      click: function (t, g) {
        if (g !== 'slot') return;
        view.cur = { m: Number(t.getAttribute('data-m')), i: Number(t.getAttribute('data-i')) };
        draw();
      },
      key: function (k) {
        const item = current;
        const total = codeNumbers(item.messages[view.cur.m]).length;
        const key = view.cur.m + ',' + view.cur.i;
        if (k === 'DEL') {
          const had = (saved(item.id).letters || {})[key];
          if (!had && view.cur.i > 0) view.cur.i -= 1;
          const target = view.cur.m + ',' + view.cur.i;
          save(item.id, function (s) { if (s.letters) delete s.letters[target]; });
        } else {
          save(item.id, function (s) {
            if (!s.letters) s.letters = {};
            s.letters[key] = k;
          });
          if (view.cur.i < total - 1) view.cur.i += 1;
        }
        draw();
      }
    },

    mixed: {
      progress: function (item, s) { return { done: Object.keys(s.solved || {}).length, total: item.puzzles.length }; },
      body: function (item, s) {
        const solved = s.solved || {};
        const left = item.puzzles.map(function (p, i) { return i; }).filter(function (i) { return !solved[i]; });
        let html = '';
        if (left.length) {
          const index = left.indexOf(s.cur) >= 0 ? s.cur : left[0];
          const puzzle = item.puzzles[index];
          const pick = (s.cur === index && s.pick) || [];
          let slots = '';
          for (let i = 0; i < puzzle.answer.length; i++) {
            const tile = pick[i];
            slots += tile === undefined ? '<span class="tile empty"></span>'
              : '<button class="tile chosen" data-g="unpick" data-i="' + i + '">' + puzzle.scram[tile] + '</button>';
          }
          const tiles = puzzle.scram.split('').map(function (ch, i) {
            return pick.indexOf(i) >= 0 ? '<span class="tile empty"></span>'
              : '<button class="tile" data-g="pick" data-i="' + i + '" data-p="' + index + '">' + ch + '</button>';
          }).join('');
          html += '<div class="tiles">' + slots + '</div>' +
            (pick.length === puzzle.answer.length ? '<p class="act-tip">Not quite. Tap a letter to take it back.</p>' : '<p class="act-tip">Tap the letters in the right order.</p>') +
            '<div class="tiles">' + tiles + '</div>';
          if (left.length > 1) html += '<button class="btn quiet" data-g="skip" data-p="' + index + '" style="margin-top:14px">Try a different one</button>';
        } else {
          html += wellDone('You unjumbled every one!');
        }
        const names = Object.keys(solved).map(function (i) { return '<span class="word solved">' + item.puzzles[i].answer + '</span>'; }).join('');
        return html + '<div class="words">' + names + '</div>' + againHtml(Object.keys(solved).length > 0);
      },
      click: function (t, g) {
        const item = current;
        if (g === 'pick') {
          const p = Number(t.getAttribute('data-p'));
          const i = Number(t.getAttribute('data-i'));
          const puzzle = item.puzzles[p];
          save(item.id, function (s) {
            s.pick = s.cur === p && s.pick ? s.pick : [];
            s.cur = p;
            s.pick.push(i);
            if (s.pick.length === puzzle.answer.length) {
              const word = s.pick.map(function (tile) { return puzzle.scram[tile]; }).join('');
              if (word === puzzle.answer) {
                if (!s.solved) s.solved = {};
                s.solved[p] = true;
                s.pick = [];
                ui.toast('Yes! ' + puzzle.answer);
              }
            }
          });
          draw();
        } else if (g === 'unpick') {
          const at = Number(t.getAttribute('data-i'));
          save(item.id, function (s) { s.pick.splice(at, 1); });
          draw();
        } else if (g === 'skip') {
          const p = Number(t.getAttribute('data-p'));
          const solved = saved(item.id).solved || {};
          const left = item.puzzles.map(function (one, i) { return i; }).filter(function (i) { return !solved[i]; });
          save(item.id, function (s) {
            s.cur = left[(left.indexOf(p) + 1) % left.length];
            s.pick = [];
          });
          draw();
        }
      }
    },

    quiz: {
      progress: function (item, s) { return { done: Object.keys(s.picks || {}).length, total: item.qs.length }; },
      body: function (item, s) {
        const picks = s.picks || {};
        let score = 0;
        let html = '';
        item.qs.forEach(function (q, i) {
          const picked = picks[i];
          const answered = picked !== undefined;
          if (answered && picked === q.ans) score += 1;
          html += '<div class="card"><p class="q-text">' + ui.esc(q.q) + '</p>';
          q.opts.forEach(function (opt, o) {
            let cls = '';
            if (answered) {
              if (o === q.ans) cls = 'right';
              else if (o === picked) cls = 'wrong';
              else cls = 'dim';
            }
            html += '<button class="opt ' + cls + '" data-g="pick" data-q="' + i + '" data-o="' + o + '"' + (answered ? ' disabled' : '') + '>' + ui.esc(opt) + '</button>';
          });
          html += '</div>';
        });
        if (Object.keys(picks).length === item.qs.length) html += wellDone('You got ' + score + ' out of ' + item.qs.length + '!');
        return html + againHtml(Object.keys(picks).length > 0);
      },
      click: function (t, g) {
        if (g !== 'pick') return;
        const q = t.getAttribute('data-q');
        const o = Number(t.getAttribute('data-o'));
        save(current.id, function (s) {
          if (!s.picks) s.picks = {};
          s.picks[q] = o;
        });
        draw();
      }
    },

    spot: {
      progress: function (item, s) { return { done: (s.found || []).length, total: item.spots.length }; },
      body: function (item, s) {
        const found = s.found || [];
        const rings = '<svg class="rings" viewBox="0 0 130 86">' + found.map(function (i) {
          const spot = item.spots[i];
          return '<circle cx="' + spot.x + '" cy="' + spot.y + '" r="' + Math.max(spot.r, 7) + '"/>';
        }).join('') + '</svg>';
        const names = found.map(function (i) { return '<span class="word solved">' + ui.esc(item.spots[i].label) + '</span>'; }).join('');
        const all = found.length === item.spots.length;
        return '<div class="pic" data-g="spot">' + item.a + rings + '</div>' +
          '<div class="pic" data-g="spot">' + item.b + rings + '</div>' +
          '<p class="act-tip">Tap a difference on either picture.</p>' +
          (all ? wellDone('You spotted them all!') : '<button class="btn quiet" data-g="hint">Show me one</button>') +
          '<div class="words">' + names + '</div>' + againHtml(found.length > 0);
      },
      click: function (t, g, e) {
        const item = current;
        if (g === 'hint') {
          const found = saved(item.id).found || [];
          const next = item.spots.map(function (one, i) { return i; }).filter(function (i) { return found.indexOf(i) < 0; })[0];
          save(item.id, function (s) { s.found = (s.found || []).concat([next]); });
          draw();
          window.scrollTo(0, 0);
          return;
        }
        if (g !== 'spot') return;
        const box = t.getBoundingClientRect();
        const x = (e.clientX - box.left) / box.width * 130;
        const y = (e.clientY - box.top) / box.height * 86;
        const found = saved(item.id).found || [];
        const hit = item.spots.map(function (spot, i) {
          return { i: i, gap: Math.sqrt(Math.pow(spot.x - x, 2) + Math.pow(spot.y - y, 2)) - spot.r - 3 };
        }).filter(function (o) { return o.gap <= 0 && found.indexOf(o.i) < 0; }).sort(function (a, b) { return a.gap - b.gap; })[0];
        if (!hit) return;
        save(item.id, function (s) { s.found = (s.found || []).concat([hit.i]); });
        ui.toast(item.spots[hit.i].label);
        draw();
      }
    },

    bingo: {
      progress: function (item, s) {
        return { done: (s.marks || []).length + item.cells.filter(isFree).length, total: item.cells.length };
      },
      body: function (item, s) {
        const marks = s.marks || [];
        const cells = item.cells.map(function (text, i) {
          const on = isFree(text) || marks.indexOf(i) >= 0;
          return '<button class="' + (on ? 'on' : '') + '" data-g="mark" data-i="' + i + '"' + (isFree(text) ? ' disabled' : '') + '>' + ui.esc(text) + '</button>';
        }).join('');
        const lines = bingoLines(item, marks);
        const full = kinds.bingo.progress(item, s);
        return '<div class="bingo">' + cells + '</div>' +
          (full.done === full.total ? wellDone('Full house!') : lines ? wellDone('Bingo! ' + plural(lines, 'line')) : '') +
          '<p class="act-tip">A line across, down or corner to corner is a win. All twenty-five is a full house.</p>' +
          againHtml(marks.length > 0);
      },
      click: function (t, g) {
        if (g !== 'mark') return;
        const item = current;
        const i = Number(t.getAttribute('data-i'));
        const before = bingoLines(item, saved(item.id).marks || []);
        save(item.id, function (s) {
          const marks = s.marks || [];
          const at = marks.indexOf(i);
          if (at >= 0) marks.splice(at, 1);
          else marks.push(i);
          s.marks = marks;
        });
        if (bingoLines(item, saved(item.id).marks) > before) ui.toast('Bingo!');
        draw();
      }
    },

    ticks: {
      progress: function (item, s) { return { done: Object.keys(s.ticks || {}).length, total: item.things.length }; },
      body: function (item, s) {
        const ticks = s.ticks || {};
        const rows = item.things.map(function (thing, i) {
          return '<button class="tick" role="checkbox" aria-checked="' + !!ticks[i] + '" data-g="thing" data-i="' + i + '">' +
            '<span class="box"><svg><use href="#i-tick"/></svg></span><span class="nm">' + ui.esc(thing) + '</span></button>';
        }).join('');
        return '<div class="flush-list">' + rows + '</div><label class="field" style="margin-top:16px"><span>' + ui.esc(item.prompt) + '</span>' +
          '<textarea rows="2" data-g-text="strange" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' + ui.esc(s.strange || '') + '</textarea></label>';
      },
      click: function (t, g) {
        if (g !== 'thing') return;
        const i = t.getAttribute('data-i');
        save(current.id, function (s) {
          if (!s.ticks) s.ticks = {};
          if (s.ticks[i]) delete s.ticks[i];
          else s.ticks[i] = new Date().toISOString();
        });
        t.setAttribute('aria-checked', String(!!saved(current.id).ticks[i]));
        document.getElementById('count').textContent = countLabel(current);
      }
    },

    wyr: {
      progress: function (item, s) { return { done: Object.keys(s.picks || {}).length, total: item.pairs.length }; },
      body: function (item, s) {
        const picks = s.picks || {};
        return item.pairs.map(function (pair, i) {
          return '<div class="card">' + pair.map(function (text, o) {
            return '<button class="opt ' + (picks[i] === o ? 'right' : '') + '" data-g="pick" data-q="' + i + '" data-o="' + o + '">' + ui.esc(text) + '</button>' +
              (o === 0 ? '<p class="or">or</p>' : '');
          }).join('') + '</div>';
        }).join('');
      },
      click: function (t, g) {
        if (g !== 'pick') return;
        const q = t.getAttribute('data-q');
        const o = Number(t.getAttribute('data-o'));
        save(current.id, function (s) {
          if (!s.picks) s.picks = {};
          s.picks[q] = o;
        });
        draw();
      }
    },

    ttt: {
      open: function (item) {
        if (!saved(item.id).board) save(item.id, function (s) { s.board = ['', '', '', '', '', '', '', '', '']; s.mode = 'tablet'; });
      },
      body: function (item, s) {
        const result = winner(s.board);
        const xTurn = emptySquares(s.board).length % 2 === 1;
        const tally = s.tally || { X: 0, O: 0, draw: 0 };
        const tablet = s.mode === 'tablet';
        let status = xTurn ? 'X to go' : 'O to go';
        if (tablet && !xTurn) status = 'The tablet is thinking…';
        if (tablet && xTurn) status = 'Your turn, you are X';
        if (result === 'draw') status = 'A draw!';
        else if (result) status = result === 'X' ? (tablet ? 'You won!' : 'X won!') : (tablet ? 'The tablet won!' : 'O won!');
        return '<div class="choose"><button class="opt ' + (tablet ? 'right' : '') + '" data-g="mode" data-m="tablet">Play the tablet</button>' +
          '<button class="opt ' + (tablet ? '' : 'right') + '" data-g="mode" data-m="friend">Pass to a friend</button></div>' +
          '<p class="clue-now" style="text-align:center">' + status + '</p>' +
          '<div class="ttt">' + s.board.map(function (mark, i) {
            return '<button class="' + mark + '" data-g="square" data-i="' + i + '">' + mark + '</button>';
          }).join('') + '</div>' +
          '<p class="act-tip" style="text-align:center">' + (tablet ? 'You ' : 'X ') + tally.X + ', ' + (tablet ? 'tablet ' : 'O ') + tally.O + ', draws ' + tally.draw + '</p>' +
          (result ? '<button class="btn" data-g="next">Play again</button>' : '');
      },
      click: function (t, g) {
        const item = current;
        const s = saved(item.id);
        if (g === 'mode') {
          const mode = t.getAttribute('data-m');
          if (mode === s.mode) return;
          save(item.id, function (o) { o.mode = mode; o.board = ['', '', '', '', '', '', '', '', '']; o.tally = { X: 0, O: 0, draw: 0 }; });
          draw();
        } else if (g === 'next') {
          save(item.id, function (o) { o.board = ['', '', '', '', '', '', '', '', '']; });
          draw();
        } else if (g === 'square') {
          const i = Number(t.getAttribute('data-i'));
          const xTurn = emptySquares(s.board).length % 2 === 1;
          if (s.board[i] || winner(s.board) || (s.mode === 'tablet' && !xTurn)) return;
          placeMark(item.id, i, xTurn ? 'X' : 'O');
          draw();
          const after = saved(item.id);
          if (after.mode === 'tablet' && !winner(after.board)) {
            setTimeout(function () {
              if (current !== item) return;
              placeMark(item.id, tabletMove(saved(item.id).board), 'O');
              draw();
            }, 550);
          }
        }
      }
    },

    hangman: {
      open: function (item) { if (!saved(item.id).word) pickWord(item); },
      body: function (item, s) {
        const guessed = s.guessed || '';
        const wrong = wrongLetters(s);
        const won = hangmanWon(s);
        const lost = wrong.length >= WRONG_LIMIT;
        const parts = [
          '<circle cx="26" cy="13" r="4"/>', '<line x1="26" y1="17" x2="26" y2="27"/>',
          '<line x1="26" y1="20" x2="21" y2="24"/>', '<line x1="26" y1="20" x2="31" y2="24"/>',
          '<line x1="26" y1="27" x2="22" y2="33"/>', '<line x1="26" y1="27" x2="30" y2="33"/>'
        ].slice(0, wrong.length).join('');
        const letters = s.word.split('').map(function (k) {
          const show = guessed.indexOf(k) >= 0 || lost;
          return '<span class="hl' + (show ? '' : ' blank') + '">' + (show ? k : '&nbsp;') + '</span>';
        }).join('');
        const states = { noDelete: true };
        guessed.split('').forEach(function (k) { states[k] = s.word.indexOf(k) >= 0 ? 'right' : 'wrong'; });
        const over = won || lost;
        return '<svg class="gallows" viewBox="0 0 40 40"><g><line x1="4" y1="37" x2="20" y2="37"/><line x1="10" y1="37" x2="10" y2="4"/>' +
          '<line x1="10" y1="4" x2="26" y2="4"/><line x1="26" y1="4" x2="26" y2="9"/>' + parts + '</g></svg>' +
          '<div class="hword">' + letters + '</div>' +
          '<p class="act-tip" style="text-align:center">' + (WRONG_LIMIT - wrong.length) + ' goes left. Won ' + (s.wins || 0) + ' so far.</p>' +
          (won ? wellDone('You got it!') : lost ? wellDone('Bad luck! Have another go.') : '') +
          (over ? '<button class="btn" data-g="next">Next word</button>' : keypad(states));
      },
      click: function (t, g) {
        if (g !== 'next') return;
        pickWord(current);
        draw();
      },
      key: function (k) {
        const item = current;
        const s = saved(item.id);
        if ((s.guessed || '').indexOf(k) >= 0 || hangmanWon(s) || wrongLetters(s).length >= WRONG_LIMIT) return;
        save(item.id, function (o) {
          o.guessed = (o.guessed || '') + k;
          if (hangmanWon(o)) o.wins = (o.wins || 0) + 1;
        });
        draw();
      }
    }
  };

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function isFree(text) { return text === 'FREE'; }

  function bingoLines(item, marks) {
    const on = function (i) { return isFree(item.cells[i]) || marks.indexOf(i) >= 0; };
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push([0, 1, 2, 3, 4].map(function (n) { return i * 5 + n; }));
      lines.push([0, 1, 2, 3, 4].map(function (n) { return n * 5 + i; }));
    }
    lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
    return lines.filter(function (line) { return line.every(on); }).length;
  }

  function codeNumbers(message) {
    return message.words.reduce(function (all, word) { return all.concat(word); }, []);
  }

  function codeSolved(message, m, s) {
    const letters = s.letters || {};
    return codeNumbers(message).every(function (num, i) { return letters[m + ',' + i] === String.fromCharCode(64 + num); });
  }

  /* ---------- events ---------- */

  document.addEventListener('click', function (e) {
    if (!current) return;
    const keyEl = e.target.closest('[data-key]');
    if (keyEl) {
      if (kinds[current.type].key) kinds[current.type].key(keyEl.getAttribute('data-key'));
      return;
    }
    const t = e.target.closest('[data-g]');
    if (!t) return;
    const g = t.getAttribute('data-g');
    if (g === 'again') { confirming = true; draw(); return; }
    if (g === 'again-no') { confirming = false; draw(); return; }
    if (g === 'again-yes') {
      const id = current.id;
      Store.update(function (s) { if (s.activities) delete s.activities[id]; });
      confirming = false;
      view = {};
      if (kinds[current.type].open) kinds[current.type].open(current);
      draw();
      return;
    }
    kinds[current.type].click(t, g, e);
  });

  document.addEventListener('input', function (e) {
    const field = e.target.getAttribute && e.target.getAttribute('data-g-text');
    if (!field || !current) return;
    const value = e.target.value;
    save(current.id, function (s) { s[field] = value; });
  });

  /* ---------- what app.js calls ---------- */

  window.Activities = {
    load: async function () {
      const response = await fetch('./activities.json');
      if (!response.ok) throw new Error('activities.json ' + response.status);
      items = (await response.json()).items;
    },
    setUi: function (helpers) { ui = helpers; },
    leave: function () { current = null; drag = null; view = {}; confirming = false; },
    ids: function () { return items.map(function (item) { return item.id; }); },
    listHtml: function () {
      if (!items.length) return '<div class="wrap"><p>The activities could not open just now. Try again on wifi.</p></div>';
      let html = '<div class="parkhead"><h2>Activities</h2><p>Puzzles and games for queues, coaches and the plane</p></div><div class="wrap">';
      let group = '';
      items.forEach(function (item) {
        if (item.group !== group) {
          group = item.group;
          html += '<h3 class="group flush">' + ui.esc(group) + '</h3>';
        }
        const p = progress(item);
        html += '<a class="card' + (p && p.done === p.total ? ' done' : '') + '" href="#/activity/' + item.id + '"><div class="card-top"><b>' + ui.esc(item.title.replace('Spot the difference: ', '')) + '</b>' +
          (p ? '<span>' + p.done + ' of ' + p.total + '</span>' : '') + '</div>' +
          '<span class="sub">' + ui.esc(item.sub) + '</span>' +
          (p ? '<div class="bar"><i style="width:' + Math.round(p.done / p.total * 100) + '%"></i></div>' : '') + '</a>';
      });
      return html + '</div>';
    },
    pageHtml: function (id) {
      const item = items.filter(function (one) { return one.id === id; })[0];
      if (!item) return window.Activities.listHtml();
      current = item;
      view = {};
      confirming = false;
      if (kinds[item.type].open) kinds[item.type].open(item);
      return ui.topbar('#/activities', 'Activities', countLabel(item)) +
        '<div class="parkhead"><h2>' + ui.esc(item.title) + '</h2><p>' + ui.esc(item.sub) + '</p></div>' +
        '<div class="wrap" id="act">' + kinds[item.type].body(item, saved(item.id)) + '</div>';
    }
  };
})();
