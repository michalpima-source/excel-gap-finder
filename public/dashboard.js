(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let state = {
    subscriptions: [],
    summary: {},
    activeFilter: 'all',
    editingId: null,
    lastRefreshed: null
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const grid       = document.getElementById('cardsGrid');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalForm  = document.getElementById('modalForm');
  const modalDelete = document.getElementById('modalDelete');

  // ── Formatting ─────────────────────────────────────────────────────────────
  function fmt$(n, currency = 'USD') {
    if (n == null) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDays(days) {
    if (days == null) return '';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0)  return `${Math.abs(days)}d overdue`;
    return `in ${days}d`;
  }

  function timeAgo(iso) {
    if (!iso) return 'never';
    const diff = Math.round((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)  return `${diff}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    return `${Math.round(diff / 3600)}h ago`;
  }

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // ── Data refresh ───────────────────────────────────────────────────────────
  async function refresh() {
    const dot = document.getElementById('refreshDot');
    const label = document.getElementById('refreshLabel');
    dot.classList.remove('stale');
    label.textContent = 'Refreshing…';

    try {
      const [subs, summary] = await Promise.all([
        fetchJSON('/api/dashboard/subscriptions'),
        fetchJSON('/api/dashboard/summary')
      ]);
      state.subscriptions = subs.subscriptions;
      state.summary = summary;
      state.lastRefreshed = summary.lastRefreshed || new Date().toISOString();
      renderAll();
      label.textContent = 'Updated ' + timeAgo(state.lastRefreshed);
    } catch (err) {
      dot.classList.add('stale');
      label.textContent = 'Refresh failed';
      console.error(err);
    }
  }

  // ── Render: summary strip ──────────────────────────────────────────────────
  function renderSummary() {
    const s = state.summary;
    document.getElementById('sumTotal').textContent    = fmt$(s.totalMonthlyCost);
    document.getElementById('sumSubCost').textContent  = fmt$(s.subscriptionCost);
    document.getElementById('sumApiSpend').textContent = fmt$(s.apiSpend);
    document.getElementById('sumActive').textContent   = s.activeCount ?? '—';
  }

  // ── Render: cards ─────────────────────────────────────────────────────────
  function renderAll() {
    renderSummary();
    renderCards();
  }

  function renderCards() {
    const filter = state.activeFilter;
    const visible = state.subscriptions.filter(s => {
      if (filter === 'all') return true;
      return s.category === filter;
    });

    if (!visible.length) {
      grid.innerHTML = `<div class="empty-state"><span>No subscriptions in this category.</span></div>`;
      return;
    }

    grid.innerHTML = visible.map(renderCard).join('');

    // Attach click handlers
    grid.querySelectorAll('.sub-card').forEach(el => {
      el.addEventListener('click', () => openEdit(el.dataset.id));
    });
  }

  function renderCard(sub) {
    const cardColor = sub.color || '#818cf8';
    const style = `--card-color: ${cardColor};`;

    const typeLabel = sub.type === 'api' ? 'API' : 'PLAN';
    const badgeTypeClass = sub.type === 'api' ? 'badge-type-api' : 'badge-type-sub';
    const statusBadge = sub.active
      ? `<span class="badge badge-active">Active</span>`
      : `<span class="badge badge-inactive">Inactive</span>`;

    const body = sub.type === 'api' ? renderApiBody(sub) : renderSubBody(sub);

    return `
    <div class="sub-card${sub.active ? '' : ' inactive'}" data-id="${sub.id}" style="${style}">
      <div class="card-header">
        <div class="card-identity">
          <div class="card-icon">${sub.icon || '📋'}</div>
          <div>
            <div class="card-name">${esc(sub.name)}</div>
            <div class="card-provider">${esc(sub.provider)}</div>
          </div>
        </div>
        <div class="card-badges">
          <span class="badge ${badgeTypeClass}">${typeLabel}</span>
          ${statusBadge}
        </div>
      </div>
      ${body}
    </div>`;
  }

  function renderSubBody(sub) {
    const cycleSuffix = sub.billingCycle === 'annual' ? '/yr' : '/mo';
    const costLine = sub.cost != null
      ? `<div class="card-cost-main">${fmt$(sub.cost, sub.currency)}<span style="font-size:13px;font-weight:400;color:var(--text-dim)">${cycleSuffix}</span></div>`
      : `<div class="card-cost-main" style="font-size:16px;color:var(--text-dim)">Free / Included</div>`;

    return `
      <div class="card-cost-block">${costLine}</div>
      ${renewalRow(sub)}`;
  }

  function renderApiBody(sub) {
    const hasSpend = sub.currentSpend != null;
    const hasBudget = sub.monthlyBudget != null;
    const pct = sub.spendPercent ?? 0;
    const fillClass = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : '';

    if (!hasSpend && sub.usageConfigured === false) {
      return `
        <div class="api-not-configured">
          <span>⚙️</span>
          <span>${sub.usageError || 'Configure API key to track spend'}</span>
        </div>
        ${hasBudget ? `<div class="api-budget-line">Budget: ${fmt$(sub.monthlyBudget, sub.currency)}/mo</div>` : ''}
        ${renewalRow(sub)}`;
    }

    const spendDisplay = hasSpend ? fmt$(sub.currentSpend, sub.currency) : '—';
    const budgetLine = hasBudget
      ? `of ${fmt$(sub.monthlyBudget, sub.currency)} budget`
      : 'this month';

    return `
      <div class="card-cost-block">
        <div class="api-spend-main">${spendDisplay}</div>
        <div class="api-budget-line">${budgetLine}</div>
      </div>
      ${hasBudget && hasSpend ? `
      <div class="progress-wrap">
        <div class="progress-labels">
          <span>${pct.toFixed(1)}% used</span>
          ${sub.remaining != null ? `<span>${fmt$(sub.remaining, sub.currency)} left</span>` : ''}
        </div>
        <div class="progress-track">
          <div class="progress-fill ${fillClass}" style="width:${pct.toFixed(1)}%"></div>
        </div>
      </div>` : ''}
      ${renewalRow(sub)}`;
  }

  function renewalRow(sub) {
    const label = sub.type === 'api' ? 'Resets' : 'Renews';
    return `
    <div class="renewal-row">
      <span class="renewal-date">${label} ${fmtDate(sub.renewalDate)}</span>
      <span class="renewal-badge ${sub.urgency}" data-renewal-date="${sub.renewalDate}">
        ${fmtDays(sub.daysUntilRenewal)}
      </span>
    </div>`;
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  const ICONS = ['🤖','⚡','💬','🧠','✨','🌐','🎨','📊','🔮','🛠️','🚀','💡'];
  const COLORS = [
    { label: 'Indigo', value: '#818cf8' },
    { label: 'Amber', value: '#d97706' },
    { label: 'Green', value: '#10a37f' },
    { label: 'Blue', value: '#4285f4' },
    { label: 'Purple', value: '#7c3aed' },
    { label: 'Rose', value: '#f43f5e' },
    { label: 'Cyan', value: '#06b6d4' },
    { label: 'Orange', value: '#f97316' }
  ];

  function buildForm(sub = {}) {
    const isApi = (sub.type || 'subscription') === 'api';
    return `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Name *</label>
          <input class="form-input" name="name" value="${esc(sub.name || '')}" placeholder="e.g. Claude Pro" required>
        </div>
        <div class="form-group">
          <label class="form-label">Provider</label>
          <input class="form-input" name="provider" value="${esc(sub.provider || '')}" placeholder="e.g. Anthropic">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-select" name="type" id="formType">
            <option value="subscription" ${!isApi ? 'selected' : ''}>Flat subscription</option>
            <option value="api" ${isApi ? 'selected' : ''}>Pay-per-use API</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <select class="form-select" name="category">
            <option value="ai-chat" ${sub.category === 'ai-chat' ? 'selected' : ''}>AI Chat</option>
            <option value="ai-api" ${sub.category === 'ai-api' ? 'selected' : ''}>AI API</option>
            <option value="ai-image" ${sub.category === 'ai-image' ? 'selected' : ''}>AI Image</option>
            <option value="other" ${(sub.category === 'other' || !sub.category) ? 'selected' : ''}>Other</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group" id="costGroup" ${isApi ? 'style="display:none"' : ''}>
          <label class="form-label">Monthly Cost ($)</label>
          <input class="form-input" name="cost" type="number" step="0.01" min="0"
            value="${sub.cost != null ? sub.cost : ''}" placeholder="20.00">
        </div>
        <div class="form-group" id="budgetGroup" ${!isApi ? 'style="display:none"' : ''}>
          <label class="form-label">Monthly Budget ($)</label>
          <input class="form-input" name="monthlyBudget" type="number" step="0.01" min="0"
            value="${sub.monthlyBudget != null ? sub.monthlyBudget : ''}" placeholder="50.00">
        </div>
        <div class="form-group" id="manualSpendGroup" ${!isApi ? 'style="display:none"' : ''}>
          <label class="form-label">Manual Spend MTD ($)</label>
          <input class="form-input" name="manualSpend" type="number" step="0.01" min="0"
            value="${sub.manualSpend != null ? sub.manualSpend : ''}" placeholder="0.00">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Renewal Date *</label>
          <input class="form-input" name="renewalDate" type="date"
            value="${sub.renewalDate || ''}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Billing Cycle</label>
          <select class="form-select" name="billingCycle">
            <option value="monthly" ${(sub.billingCycle || 'monthly') === 'monthly' ? 'selected' : ''}>Monthly</option>
            <option value="annual" ${sub.billingCycle === 'annual' ? 'selected' : ''}>Annual</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Icon</label>
          <select class="form-select" name="icon">
            ${ICONS.map(i => `<option value="${i}" ${sub.icon === i ? 'selected' : ''}>${i} ${i}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <select class="form-select" name="color">
            ${COLORS.map(c => `<option value="${c.value}" ${(sub.color || '#818cf8') === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Notes</label>
        <input class="form-input" name="notes" value="${esc(sub.notes || '')}" placeholder="Optional notes">
      </div>
    `;
  }

  function openAdd() {
    state.editingId = null;
    modalTitle.textContent = 'Add Subscription';
    modalDelete.classList.add('hidden');
    modalForm.innerHTML = buildForm();
    wireTypeToggle();
    modalOverlay.classList.remove('hidden');
  }

  function openEdit(id) {
    const sub = state.subscriptions.find(s => s.id === id);
    if (!sub) return;
    state.editingId = id;
    modalTitle.textContent = 'Edit Subscription';
    modalDelete.classList.remove('hidden');
    modalForm.innerHTML = buildForm(sub);
    wireTypeToggle();
    modalOverlay.classList.remove('hidden');
  }

  function wireTypeToggle() {
    const typeSelect = document.getElementById('formType');
    const costGroup   = document.getElementById('costGroup');
    const budgetGroup = document.getElementById('budgetGroup');
    const spendGroup  = document.getElementById('manualSpendGroup');

    function toggle() {
      const isApi = typeSelect.value === 'api';
      costGroup.style.display   = isApi ? 'none' : '';
      budgetGroup.style.display = isApi ? '' : 'none';
      spendGroup.style.display  = isApi ? '' : 'none';
    }

    typeSelect.addEventListener('change', toggle);
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    state.editingId = null;
  }

  async function saveModal() {
    const fd = new FormData(modalForm);
    const body = {};
    fd.forEach((v, k) => { body[k] = v; });

    // Type coercions
    if (body.cost !== '') body.cost = parseFloat(body.cost) || null;
    else body.cost = null;
    if (body.monthlyBudget !== '') body.monthlyBudget = parseFloat(body.monthlyBudget) || null;
    else body.monthlyBudget = null;
    if (body.manualSpend !== '') body.manualSpend = parseFloat(body.manualSpend) || null;
    else body.manualSpend = null;

    if (!body.name || !body.renewalDate) {
      showToast('Name and renewal date are required.', 'error');
      return;
    }

    try {
      if (state.editingId) {
        await fetchJSON(`/api/dashboard/subscriptions/${state.editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        showToast('Saved!', 'success');
      } else {
        await fetchJSON('/api/dashboard/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        showToast('Subscription added!', 'success');
      }
      closeModal();
      refresh();
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    }
  }

  async function deleteSubscription() {
    if (!state.editingId) return;
    if (!confirm('Delete this subscription?')) return;
    try {
      await fetchJSON(`/api/dashboard/subscriptions/${state.editingId}`, { method: 'DELETE' });
      showToast('Deleted.', 'success');
      closeModal();
      refresh();
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
    }
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  let toastTimer;
  function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast visible ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, 3000);
  }

  // ── Countdown ticker ───────────────────────────────────────────────────────
  function startCountdownTicker() {
    setInterval(() => {
      document.querySelectorAll('[data-renewal-date]').forEach(el => {
        const renewalDate = el.dataset.renewalDate;
        const days = Math.round((new Date(renewalDate) - new Date()) / 86400000);
        el.textContent = fmtDays(days);
        // Update urgency class
        el.className = 'renewal-badge ' + (days <= 3 ? 'urgent' : days <= 7 ? 'warn' : 'safe');
      });

      const label = document.getElementById('refreshLabel');
      if (state.lastRefreshed) {
        label.textContent = 'Updated ' + timeAgo(state.lastRefreshed);
      }
    }, 60 * 1000);
  }

  // ── Filter tabs ────────────────────────────────────────────────────────────
  function initFilterTabs() {
    document.getElementById('filterTabs').addEventListener('click', e => {
      const tab = e.target.closest('.filter-tab');
      if (!tab) return;
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeFilter = tab.dataset.filter;
      renderCards();
    });
  }

  // ── Socket.io ──────────────────────────────────────────────────────────────
  function initSocket() {
    try {
      const socket = io();
      socket.on('dashboard-refresh', () => refresh());
    } catch {}
  }

  // ── Event wiring ───────────────────────────────────────────────────────────
  function initEvents() {
    document.getElementById('btnRefresh').addEventListener('click', async () => {
      const btn = document.getElementById('btnRefresh');
      btn.classList.add('spinning');
      await fetchJSON('/api/dashboard/refresh', { method: 'POST' }).catch(() => {});
      await refresh();
      btn.classList.remove('spinning');
    });

    document.getElementById('btnAdd').addEventListener('click', openAdd);
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalCancel').addEventListener('click', closeModal);
    document.getElementById('modalSave').addEventListener('click', saveModal);
    document.getElementById('modalDelete').addEventListener('click', deleteSubscription);

    modalOverlay.addEventListener('click', e => {
      if (e.target === modalOverlay) closeModal();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });

    modalForm.addEventListener('submit', e => {
      e.preventDefault();
      saveModal();
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    initEvents();
    initFilterTabs();
    initSocket();
    startCountdownTicker();
    await refresh();
    // Client-side polling fallback every 60s
    setInterval(refresh, 60 * 1000);
  }

  init();
})();
