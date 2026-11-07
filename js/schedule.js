/* =========================================================================
 * schedule.js — fixtures (games) + calendar events (practice / other).
 * Games created here are full game records with status 'scheduled' and can
 * be started in the Live Console or edited as a final box score.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const storage = TBS.storage;
  const qs = ui.qs;

  function teamOf(state, id) {
    return state.teams.find(x => x.id === id) || null;
  }

  function teamName(state, id) {
    const t = teamOf(state, id);
    return t ? t.name : 'Unknown team';
  }

  function teamDot(state, id) {
    const team = teamOf(state, id);
    return '<span class="team-dot" style="--team-color:' +
      ui.esc(team && team.color ? team.color : '#94a3b8') + '"></span>';
  }

  function preserveSelect(selector, html, fallback) {
    const el = qs(selector);
    if (!el) return;
    const previous = el.value;
    el.innerHTML = html;
    const wanted = previous || fallback;
    if (wanted && Array.from(el.options).some(o => o.value === wanted)) el.value = wanted;
  }

  function sortKey(item) {
    const date = String(item.date || '');
    if (date.indexOf('T') >= 0) return date;
    return date + 'T' + (item.time || '00:00');
  }

  function syncTypeFields() {
    const type = qs('#sched-type').value;
    const isGame = type === 'game';
    qs('#sched-home-wrap').hidden = !isGame;
    qs('#sched-away-wrap').hidden = !isGame;
    qs('#sched-title-wrap').hidden = isGame;
    qs('#sched-title').required = !isGame;
    qs('#sched-hint').textContent = isGame
      ? 'Games are created as “Scheduled” and can be started from the Live Console.'
      : 'Practices and other events appear on the timeline but do not affect standings.';
  }

  function gameActions(g) {
    const id = ui.esc(g.id);
    let html = '';
    if (g.status === 'scheduled') {
      html += '<button type="button" class="btn btn-mini" data-action="start-game" data-id="' + id + '">Start live</button>';
    } else if (g.status === 'live') {
      html += '<button type="button" class="btn btn-mini" data-action="open-live" data-id="' + id + '">Resume</button>';
      html += '<button type="button" class="btn btn-mini" data-action="open-box" data-id="' + id + '">Box score</button>';
    } else {
      html += '<button type="button" class="btn btn-mini" data-action="open-box" data-id="' + id + '">Box score</button>';
      html += '<button type="button" class="btn btn-mini" data-action="print-game" data-id="' + id + '">Print</button>';
    }
    html += '<button type="button" class="btn btn-mini" data-action="edit-game" data-id="' + id + '">Edit</button>';
    html += '<button type="button" class="btn btn-mini" data-action="delete-game" data-id="' + id + '">Delete</button>';
    return html;
  }

  function eventActions(ev) {
    const id = ui.esc(ev.id);
    return '<button type="button" class="btn btn-mini" data-action="edit-event" data-id="' + id + '">Edit</button>' +
      '<button type="button" class="btn btn-mini" data-action="delete-event" data-id="' + id + '">Delete</button>';
  }

  function render(state) {
    const primaryId = state.league.primaryTeamId;
    const others = state.teams.filter(t => t.id !== primaryId);
    preserveSelect('#sched-home', ui.teamOptions(state.teams, ''), primaryId);
    preserveSelect('#sched-away',
      ui.teamOptions(state.teams, '', state.teams.length > 1 ? '— choose opponent —' : ''),
      others.length ? others[0].id : '');
    const awaySelect = qs('#sched-away');
    const homeSelect = qs('#sched-home');
    if (awaySelect.value === homeSelect.value && state.teams.length > 1) {
      const alternative = state.teams.find(t => t.id !== homeSelect.value);
      if (alternative) awaySelect.value = alternative.id;
    }
    if (!qs('#sched-date').value) qs('#sched-date').value = storage.todayISO();
    syncTypeFields();

    const items = [];
    state.games.forEach(g => items.push({
      kind: 'game', id: g.id, date: g.date, time: g.time, g: g,
      titleHtml: teamDot(state, g.awayTeamId) + ui.esc(teamName(state, g.awayTeamId)) + ' @ ' +
        teamDot(state, g.homeTeamId) + ui.esc(teamName(state, g.homeTeamId)),
      meta: (g.time ? ui.fmtTime(g.time) + ' · ' : '') + (g.location || '') +
        (g.notes ? ' · ' + g.notes : ''),
      badge: ui.statusBadge(g.status) + (g.status === 'final'
        ? ' <span class="timeline-score">' + ui.fmtInt(g.homeScore) + '–' + ui.fmtInt(g.awayScore) + '</span>'
        : ''),
      status: g.status,
      actions: gameActions(g)
    }));
    state.schedule.forEach(ev => items.push({
      kind: 'event', id: ev.id, date: ev.date, time: ev.time, ev: ev,
      titleHtml: '<span class="event-glyph" aria-hidden="true">' +
        (ev.type === 'practice' ? '🎯' : '📅') + '</span>' + ui.esc(ev.title),
      meta: (ui.fmtTime(ev.date.indexOf('T') >= 0 ? ev.date.slice(11, 16) : ev.time) ?
        ui.fmtTime(ev.date.indexOf('T') >= 0 ? ev.date.slice(11, 16) : ev.time) + ' · ' : '') +
        (ev.location || '') + (ev.notes ? ' · ' + ev.notes : ''),
      badge: '<span class="badge badge-' + ui.esc(ev.type) + '">' + ui.esc(ev.type) + '</span>',
      status: 'past',
      actions: eventActions(ev)
    }));
    items.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    const today = storage.todayISO();
    const upcoming = items.filter(i => sortKey(i) >= today + 'T00:00' || i.status === 'live');
    const earlier = items.filter(i => !(sortKey(i) >= today + 'T00:00' || i.status === 'live')).reverse();

    qs('#schedule-count').textContent =
      state.games.length + ' fixtures · ' + state.schedule.length + ' events';

    function group(title, list, emptyText) {
      if (!list.length) return '<div class="timeline-group">' + ui.esc(title) + '</div>' +
        '<p class="muted">' + ui.esc(emptyText) + '</p>';
      return '<div class="timeline-group">' + ui.esc(title) + '</div>' +
        '<div class="timeline">' + list.map(i =>
          '<div class="timeline-item' + (i.status === 'live' ? ' is-live' : '') + '">' +
            '<div class="timeline-date"><strong>' + ui.fmtDate(i.date) + '</strong>' +
              '<span>' + (ui.relativeDate(i.date) ? ui.esc(ui.relativeDate(i.date)) :
                (i.time ? ui.fmtTime(i.time) : '')) + '</span></div>' +
            '<div class="timeline-body"><div class="timeline-title">' + i.titleHtml + '</div>' + i.badge +
              '<div class="meta">' + ui.esc(i.meta || 'No location or notes') + '</div></div>' +
            '<div class="timeline-actions">' + i.actions + '</div>' +
          '</div>').join('') + '</div>';
    }

    qs('#schedule-list').innerHTML =
      group('Upcoming & live', upcoming, 'Nothing scheduled yet — add a fixture above.') +
      group('Earlier', earlier, 'No past games or events.');
  }

  function editGame(state, id) {
    const g = state.games.find(x => x.id === id);
    if (!g) return;
    ui.openModal({
      title: 'Edit fixture',
      fields: [
        { name: 'date', label: 'Date', type: 'date', value: g.date, required: true },
        { name: 'time', label: 'Time', type: 'time', value: g.time },
        { name: 'homeTeamId', label: 'Home team', type: 'select', value: g.homeTeamId,
          options: state.teams.map(t => ({ value: t.id, label: t.name })) },
        { name: 'awayTeamId', label: 'Away team', type: 'select', value: g.awayTeamId,
          options: state.teams.map(t => ({ value: t.id, label: t.name })) },
        { name: 'status', label: 'Status', type: 'select', value: g.status,
          options: storage.STATUSES.map(s => ({ value: s, label: s })) },
        { name: 'location', label: 'Location', type: 'text', value: g.location },
        { name: 'notes', label: 'Notes', type: 'text', value: g.notes }
      ],
      onSubmit: (values, close) => {
        if (values.homeTeamId === values.awayTeamId) {
          ui.toast('Home and away teams must be different.', 'error');
          return;
        }
        TBS.app.commit(d => {
          const game = d.games.find(x => x.id === id);
          if (!game) return;
          game.date = values.date;
          game.time = values.time;
          game.homeTeamId = values.homeTeamId;
          game.awayTeamId = values.awayTeamId;
          game.status = values.status;
          game.location = String(values.location || '').trim();
          game.notes = String(values.notes || '').trim();
          if (game.status !== 'live') game.clockRunningSince = null;
        });
        close();
        ui.toast('Fixture updated.', 'success');
      }
    });
  }

  function editEvent(state, id) {
    const ev = state.schedule.find(x => x.id === id);
    if (!ev) return;
    const hasTimeInDate = ev.date.indexOf('T') >= 0;
    const legacyDate = hasTimeInDate ? ev.date.slice(0, 10) : ev.date;
    const legacyTime = hasTimeInDate ? ev.date.slice(11, 16) : ev.time;
    ui.openModal({
      title: 'Edit calendar event',
      fields: [
        { name: 'title', label: 'Title', type: 'text', value: ev.title, required: true },
        { name: 'type', label: 'Type', type: 'select', value: ev.type,
          options: storage.EVENT_TYPES.map(t => ({ value: t, label: t })) },
        { name: 'date', label: 'Date', type: 'date', value: legacyDate, required: true },
        { name: 'time', label: 'Time', type: 'time', value: legacyTime },
        { name: 'location', label: 'Location', type: 'text', value: ev.location },
        { name: 'notes', label: 'Notes', type: 'text', value: ev.notes }
      ],
      onSubmit: (values, close) => {
        TBS.app.commit(d => {
          const item = d.schedule.find(x => x.id === id);
          if (!item) return;
          item.title = String(values.title || '').trim() || 'Event';
          item.type = values.type;
          item.date = values.date + (values.time ? 'T' + values.time : '');
          item.time = values.time;
          item.location = String(values.location || '').trim();
          item.notes = String(values.notes || '').trim();
        });
        close();
        ui.toast('Event updated.', 'success');
      }
    });
  }

  function startGame(id) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === id);
      if (!g) return;
      g.status = 'live';
      g.quarter = 1;
      g.clockSeconds = d.league.quarterMinutes * 60;
      g.clockRunningSince = null;
    });
    TBS.live.openGame(id);
    TBS.app.go('live');
    ui.toast('Game started — clock is stopped until you press Start.', 'success');
  }

  function resetForm(date) {
    qs('#schedule-form').reset();
    qs('#sched-date').value = date;
    syncTypeFields();
    render(TBS.app.getState());
  }

  function addFixture(vals, newTeam) {
    const newId = storage.uid('game');
    TBS.app.commit(d => {
      if (newTeam && !d.teams.some(t => t.id === newTeam.id)) d.teams.push(newTeam);
      d.games.push({
        id: newId, date: vals.date, time: vals.time, location: vals.location,
        season: d.league.season,
        status: 'scheduled',
        homeTeamId: vals.homeTeamId, awayTeamId: vals.awayTeamId,
        homeScore: 0, awayScore: 0,
        quarter: 1, clockSeconds: d.league.quarterMinutes * 60,
        clockRunningSince: null,
        lineup: storage.blankLineup(),
        stats: [], events: [], notes: vals.notes,
        createdAt: new Date().toISOString()
      });
    });
    ui.toast('Fixture added to schedule.', 'success');
    return newId;
  }

  /* When only one team exists, let the user create an opponent inline. */
  function askForOpponent(vals, state) {
    ui.openModal({
      title: 'Add an opponent',
      fields: [{
        name: 'opponentName', label: 'Opponent team name', type: 'text',
        value: '', placeholder: 'e.g. Lakeside Lions', required: true,
        help: 'A new team is created and used as the away team for this fixture.'
      }],
      onSubmit: (values, close) => {
        const name = String(values.opponentName || '').trim();
        if (!name) return;
        const existing = state.teams.find(t =>
          t.name.trim().toLowerCase() === name.toLowerCase() && t.id !== vals.homeTeamId);
        let awayTeamId;
        let newTeam = null;
        if (existing) {
          awayTeamId = existing.id;
        } else {
          newTeam = {
            id: storage.uid('team'), name: name,
            short: name.slice(0, 3).toUpperCase(), color: '', primary: false
          };
          awayTeamId = newTeam.id;
        }
        addFixture(Object.assign({}, vals, { awayTeamId: awayTeamId }), newTeam);
        close();
        resetForm(vals.date);
      }
    });
  }

  function init() {
    qs('#sched-type').addEventListener('change', syncTypeFields);

    qs('#schedule-form').addEventListener('submit', e => {
      e.preventDefault();
      const type = qs('#sched-type').value;
      const date = qs('#sched-date').value;
      const time = qs('#sched-time').value;
      const location = qs('#sched-location').value.trim();
      const notes = qs('#sched-notes').value.trim();
      if (!date) return;

      if (type === 'game') {
        const vals = {
          date: date, time: time, location: location, notes: notes,
          homeTeamId: qs('#sched-home').value, awayTeamId: qs('#sched-away').value
        };
        if (!vals.homeTeamId || !vals.awayTeamId || vals.homeTeamId === vals.awayTeamId) {
          askForOpponent(vals, TBS.app.getState());
          return; /* the modal finishes the job and resets the form */
        }
        addFixture(vals, null);
      } else {
        const title = qs('#sched-title').value.trim() ||
          (type === 'practice' ? 'Team practice' : 'Team event');
        TBS.app.commit(d => {
          d.schedule.push({
            id: storage.uid('event'),
            date: date + (time ? 'T' + time : ''),
            time: time, title: title, type: type,
            location: location, gameId: null, notes: notes
          });
        });
        ui.toast('Event added to schedule.', 'success');
      }
      resetForm(date);
    });

    qs('#schedule-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const state = TBS.app.getState();
      switch (btn.dataset.action) {
        case 'start-game': startGame(id); break;
        case 'open-live': TBS.live.openGame(id); TBS.app.go('live'); break;
        case 'open-box': TBS.boxscores.openGame(id); TBS.app.go('boxscores'); break;
        case 'print-game': TBS.reports.printBoxScore(id); break;
        case 'edit-game': editGame(state, id); break;
        case 'edit-event': editEvent(state, id); break;
        case 'delete-game':
          if (ui.confirmDanger('Delete this game and its box score? This cannot be undone.')) {
            TBS.app.commit(d => { d.games = d.games.filter(g => g.id !== id); });
            ui.toast('Game deleted.', 'success');
          }
          break;
        case 'delete-event':
          if (ui.confirmDanger('Delete this calendar event?')) {
            TBS.app.commit(d => { d.schedule = d.schedule.filter(ev => ev.id !== id); });
            ui.toast('Event deleted.', 'success');
          }
          break;
      }
    });
  }

  TBS.schedule = { render: render, init: init };
})(window.TBS = window.TBS || {});
