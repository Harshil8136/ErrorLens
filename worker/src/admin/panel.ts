/**
 * Admin panel, served as a single self-contained document at /admin.
 *
 * Two rules govern everything below.
 *
 * First: nothing untrusted is ever concatenated into HTML. Log rows contain
 * `query_text`, which is verbatim user input -- someone can search for
 * `<img src=x onerror=...>` and it lands in this table. Since the admin token
 * lives in sessionStorage on this same origin, an injection here is a token
 * theft. Every cell is therefore built with createElement/textContent, and the
 * CSP forbids external script entirely.
 *
 * Second: the budget meter is the point. A project that claims to be free
 * needs to show its own consumption against the published free-tier limits,
 * not assert it in a README.
 */
export function renderAdminPanel(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ErrorLens admin</title>
<style>
  :root {
    --bg: #090d16; --surface: #0f172a; --card: #141d31; --border: #26334d;
    --text: #e8edf5; --muted: #8595ad; --cyan: #22d3ee; --green: #34d399;
    --amber: #fbbf24; --rose: #fb7185; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--text); line-height: 1.55;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 28px 20px 64px;
  }
  .wrap { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 26px; }
  header { display: flex; flex-wrap: wrap; gap: 14px; align-items: baseline; justify-content: space-between; }
  h1 { font-size: 1.35rem; font-weight: 600; letter-spacing: -0.01em; }
  h1 span { color: var(--muted); font-weight: 400; font-size: .82rem; margin-left: 10px; }
  h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); font-weight: 600; }

  .auth { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  input[type=password] {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    padding: 8px 12px; border-radius: 6px; font-family: var(--mono); font-size: .82rem; min-width: 260px;
  }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
  button {
    background: var(--cyan); color: #04121a; border: 0; padding: 8px 15px;
    border-radius: 6px; font-weight: 600; font-size: .82rem; cursor: pointer;
  }
  button.ghost { background: transparent; color: var(--cyan); border: 1px solid var(--border); }
  button:hover { filter: brightness(1.08); }
  .status { font-size: .78rem; color: var(--muted); font-family: var(--mono); }

  .msg { padding: 10px 14px; border-radius: 6px; font-size: .85rem; display: none; }
  .msg.ok  { display: block; background: rgba(52,211,153,.12); color: var(--green); }
  .msg.err { display: block; background: rgba(251,113,133,.12); color: var(--rose); }

  section { display: flex; flex-direction: column; gap: 12px; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 12px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 9px; padding: 14px 16px; }
  .card .v { font-size: 1.7rem; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .card .k { font-size: .72rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  .card .s { font-size: .74rem; color: var(--muted); font-family: var(--mono); margin-top: 3px; }

  .budget { display: flex; flex-direction: column; gap: 11px; background: var(--card);
            border: 1px solid var(--border); border-radius: 9px; padding: 17px 18px; }
  .brow { display: grid; grid-template-columns: 190px 1fr 132px; gap: 13px; align-items: center; }
  .brow .lbl { font-size: .82rem; }
  .brow .lbl small { display: block; color: var(--muted); font-size: .68rem; font-family: var(--mono); }
  .bar { height: 7px; background: rgba(255,255,255,.07); border-radius: 4px; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: var(--green); border-radius: 4px; }
  .bar > i.warn { background: var(--amber); }
  .bar > i.hot  { background: var(--rose); }
  .brow .num { font-family: var(--mono); font-size: .74rem; color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }

  .scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 9px; background: var(--card); }
  table { width: 100%; border-collapse: collapse; font-size: .8rem; }
  th { text-align: left; padding: 9px 12px; font-size: .68rem; text-transform: uppercase;
       letter-spacing: .07em; color: var(--muted); border-bottom: 1px solid var(--border); white-space: nowrap; }
  td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  td.mono { font-family: var(--mono); font-size: .74rem; }
  td.q { color: var(--text); max-width: 380px; word-break: break-word; }
  .s200 { color: var(--green); } .s429 { color: var(--amber); } .s5xx { color: var(--rose); }
  .empty { text-align: center; color: var(--muted); padding: 22px; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 20px; font-size: .68rem;
          font-family: var(--mono); background: rgba(255,255,255,.06); color: var(--muted); }
  .note { font-size: .76rem; color: var(--muted); }
  @media (max-width: 720px) { .brow { grid-template-columns: 1fr; gap: 5px; } .brow .num { text-align: left; } }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <h1>ErrorLens admin<span>observability &amp; free-tier budget</span></h1>
    <div class="auth">
      <input type="password" id="token" placeholder="ADMIN_TOKEN" autocomplete="off" aria-label="Admin token">
      <button id="save">Connect</button>
      <button class="ghost" id="refresh">Refresh</button>
      <button class="ghost" id="reindex">Reindex vectors</button>
    </div>
  </header>
  <div class="status" id="authStatus">Not connected.</div>
  <div class="msg" id="msg" role="status" aria-live="polite"></div>

  <section>
    <h2>Last 7 days</h2>
    <div class="cards" id="cards"></div>
  </section>

  <section>
    <h2>Free-tier budget</h2>
    <div class="budget" id="budget"></div>
    <p class="note">
      Percentages are today's usage against the published free-plan allowances
      (Vectorize is billed monthly). D1 writes and Workers AI neurons are
      deliberate over-estimates &mdash; a budget meter that flatters you is worse than none.
    </p>
  </section>

  <section>
    <h2>Knowledge gaps &mdash; queries that matched no runbook</h2>
    <div class="scroll"><table>
      <thead><tr><th>Query</th><th>Times asked</th><th>First seen</th><th>Last seen</th></tr></thead>
      <tbody id="gaps"><tr><td class="empty" colspan="4">Connect to load.</td></tr></tbody>
    </table></div>
  </section>

  <section>
    <h2>Runbook coverage</h2>
    <div class="scroll"><table>
      <thead><tr><th>Error code</th><th>Title</th><th>Category</th><th>Hits</th><th>Steps</th><th>Verified</th></tr></thead>
      <tbody id="runbooks"><tr><td class="empty" colspan="6">Connect to load.</td></tr></tbody>
    </table></div>
  </section>

  <section>
    <h2>Recent requests</h2>
    <div class="scroll"><table>
      <thead><tr><th>Time</th><th>Route</th><th>Status</th><th>ms</th><th>Country</th><th>Query</th><th>Matched</th><th>Strategy</th><th>Model</th></tr></thead>
      <tbody id="logs"><tr><td class="empty" colspan="9">Connect to load.</td></tr></tbody>
    </table></div>
  </section>

</div>

<script>
(function () {
  'use strict';

  var token = sessionStorage.getItem('errorlens_admin_token') || '';
  var $ = function (id) { return document.getElementById(id); };

  // Every table cell goes through here. textContent never parses markup, so a
  // logged query containing HTML is displayed as text rather than executed.
  function cell(text, className) {
    var td = document.createElement('td');
    td.textContent = text === null || text === undefined || text === '' ? '-' : String(text);
    if (className) td.className = className;
    return td;
  }

  function row(cells) {
    var tr = document.createElement('tr');
    cells.forEach(function (c) { tr.appendChild(c); });
    return tr;
  }

  function fill(tbody, rows, colspan, emptyText) {
    tbody.replaceChildren();
    if (!rows.length) {
      var td = document.createElement('td');
      td.className = 'empty';
      td.colSpan = colspan;
      td.textContent = emptyText;
      tbody.appendChild(row([td]));
      return;
    }
    rows.forEach(function (r) { tbody.appendChild(r); });
  }

  function message(text, isError) {
    var el = $('msg');
    el.textContent = text;
    el.className = 'msg ' + (isError ? 'err' : 'ok');
    setTimeout(function () { el.className = 'msg'; }, 5000);
  }

  function api(path, options) {
    if (!token) return Promise.reject(new Error('Enter your ADMIN_TOKEN first.'));
    return fetch(path, Object.assign({}, options, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    })).then(function (res) {
      if (res.status === 401) throw new Error('Unauthorized - check the token.');
      if (res.status === 503) throw new Error('ADMIN_TOKEN is not set on the Worker.');
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
        return data;
      });
    });
  }

  function statCard(label, value, sub) {
    var d = document.createElement('div');
    d.className = 'card';
    var k = document.createElement('div'); k.className = 'k'; k.textContent = label;
    var v = document.createElement('div'); v.className = 'v'; v.textContent = value;
    var s = document.createElement('div'); s.className = 's'; s.textContent = sub;
    d.append(k, v, s);
    return d;
  }

  function renderCards(ov) {
    var t = ov.totals || {};
    var lat = ov.latency || {};
    var today = ov.today || {};
    var corpus = ov.corpus || {};
    $('cards').replaceChildren(
      statCard('Requests', t.requests || 0, 'today: ' + (today.requests || 0)),
      statCard('Diagnoses', t.troubleshoots || 0, 'cache hit ' + (t.cache_hit_rate_pct || 0) + '%'),
      statCard('LLM calls', (t.gemini_calls || 0) + (t.workers_ai_calls || 0),
               'gemini ' + (t.gemini_calls || 0) + ' / cf ' + (t.workers_ai_calls || 0)),
      statCard('p95 latency', (lat.p95_ms == null ? '-' : lat.p95_ms + ' ms'),
               'avg ' + (lat.avg_ms == null ? '-' : lat.avg_ms + ' ms') + ' / n=' + (lat.samples || 0)),
      statCard('Rate limited', t.rate_limited || 0, 'errors: ' + (t.errors || 0)),
      statCard('Runbooks', corpus.runbooks || 0, (corpus.never_matched || 0) + ' never matched')
    );
  }

  function renderBudget(budget) {
    var host = $('budget');
    host.replaceChildren();
    var labels = {
      worker_requests: 'Worker requests',
      d1_writes: 'D1 rows written',
      workers_ai_neurons: 'Workers AI neurons',
      gemini_requests: 'Gemini requests',
      vectorize_dimensions: 'Vectorize dimensions'
    };
    Object.keys(labels).forEach(function (key) {
      var b = budget[key];
      if (!b) return;

      var lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = labels[key];
      var small = document.createElement('small');
      small.textContent = b.source + ' / per ' + b.window;
      lbl.appendChild(small);

      var barWrap = document.createElement('div');
      barWrap.className = 'bar';
      var fillBar = document.createElement('i');
      fillBar.style.width = Math.min(100, b.pct) + '%';
      if (b.pct >= 80) fillBar.className = 'hot';
      else if (b.pct >= 50) fillBar.className = 'warn';
      barWrap.appendChild(fillBar);

      var num = document.createElement('div');
      num.className = 'num';
      num.textContent = b.used.toLocaleString() + ' / ' + b.limit.toLocaleString() + '  (' + b.pct + '%)';

      var r = document.createElement('div');
      r.className = 'brow';
      r.append(lbl, barWrap, num);
      host.appendChild(r);
    });
  }

  function renderLogs(logs) {
    fill($('logs'), logs.map(function (l) {
      var cls = l.status === 200 ? 's200' : (l.status === 429 ? 's429' : 's5xx');
      return row([
        cell(new Date(l.ts + 'Z').toLocaleTimeString(), 'mono'),
        cell(l.method + ' ' + l.route, 'mono'),
        cell(l.status, 'mono ' + cls),
        cell(l.duration_ms, 'mono'),
        cell(l.country),
        cell(l.query_text, 'q'),
        cell(l.matched_slug, 'mono'),
        cell(l.search_strategy, 'mono'),
        cell(l.model, 'mono')
      ]);
    }), 9, 'No requests logged yet.');
  }

  function renderGaps(gaps) {
    fill($('gaps'), gaps.map(function (g) {
      return row([
        cell(g.query_text, 'q'),
        cell(g.count, 'mono'),
        cell(new Date(g.first_seen + 'Z').toLocaleDateString(), 'mono'),
        cell(new Date(g.last_seen + 'Z').toLocaleDateString(), 'mono')
      ]);
    }), 4, 'Every query so far matched a runbook.');
  }

  function renderRunbooks(runbooks) {
    fill($('runbooks'), runbooks.map(function (r) {
      return row([
        cell(r.error_code, 'mono'),
        cell(r.title),
        cell(r.category, 'mono'),
        cell(r.hit_count, 'mono'),
        cell(r.steps, 'mono'),
        cell(r.verified_at, 'mono')
      ]);
    }), 6, 'No runbooks loaded. Run the migrations.');
  }

  function loadAll() {
    if (!token) return;
    Promise.all([
      api('/api/admin/overview?days=7'),
      api('/api/admin/logs?limit=50'),
      api('/api/admin/gaps?limit=25'),
      api('/api/admin/runbooks')
    ]).then(function (res) {
      renderCards(res[0]);
      renderBudget(res[0].budget || {});
      renderLogs(res[1].logs || []);
      renderGaps(res[2].gaps || []);
      renderRunbooks(res[3].runbooks || []);
      $('authStatus').textContent = 'Connected. Updated ' + new Date().toLocaleTimeString() + '.';
    }).catch(function (err) {
      message(err.message, true);
      $('authStatus').textContent = 'Not connected.';
    });
  }

  $('save').addEventListener('click', function () {
    token = $('token').value.trim();
    sessionStorage.setItem('errorlens_admin_token', token);
    loadAll();
  });
  $('refresh').addEventListener('click', loadAll);
  $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('save').click(); });

  $('reindex').addEventListener('click', function () {
    if (!confirm('Re-embed every runbook and upsert it into Vectorize?')) return;
    api('/api/admin/reindex', { method: 'POST' })
      .then(function (r) { message(r.message, false); loadAll(); })
      .catch(function (err) { message(err.message, true); });
  });

  if (token) {
    $('token').value = token;
    loadAll();
  }
})();
</script>
</body>
</html>`;
}
