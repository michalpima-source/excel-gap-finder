const express = require('express');
const router = express.Router();
const subService = require('../services/subscriptionService');
const anthropic = require('../services/anthropicService');
const openai = require('../services/openaiService');
const google = require('../services/googleService');

let usageCache = {};
let lastRefreshed = null;

const PROVIDER_FETCHERS = {
  Anthropic: () => anthropic.getMonthlyUsage(),
  OpenAI: () => openai.getMonthlyUsage(),
  Google: () => google.getMonthlyUsage()
};

async function refreshUsageCache() {
  const { subscriptions } = subService.readData();
  const apiSubs = subscriptions.filter(s => s.type === 'api' && s.active);

  const grouped = {};
  for (const sub of apiSubs) {
    if (!grouped[sub.provider]) grouped[sub.provider] = [];
    grouped[sub.provider].push(sub.id);
  }

  await Promise.all(
    Object.entries(grouped).map(async ([provider, ids]) => {
      const fetcher = PROVIDER_FETCHERS[provider];
      if (!fetcher) return;
      try {
        const usage = await fetcher();
        for (const id of ids) usageCache[id] = usage;
      } catch {}
    })
  );

  lastRefreshed = new Date().toISOString();
}

refreshUsageCache();
setInterval(refreshUsageCache, 5 * 60 * 1000);

router.get('/subscriptions', (req, res) => {
  try {
    const data = subService.readData();
    const subscriptions = data.subscriptions.map(s =>
      subService.getComputedSubscription(s, usageCache)
    );
    res.json({ subscriptions, settings: data.settings, lastRefreshed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', (req, res) => {
  try {
    const data = subService.readData();
    const active = data.subscriptions
      .filter(s => s.active)
      .map(s => subService.getComputedSubscription(s, usageCache));

    const subscriptionCost = active
      .filter(s => s.type === 'subscription')
      .reduce((sum, s) => sum + (s.cost || 0), 0);

    const apiSpend = active
      .filter(s => s.type === 'api')
      .reduce((sum, s) => sum + (s.currentSpend || 0), 0);

    const renewingSoon = active
      .filter(s => s.daysUntilRenewal <= data.settings.warningDaysBeforeRenewal)
      .map(s => ({ id: s.id, name: s.name, daysUntilRenewal: s.daysUntilRenewal }));

    res.json({
      totalMonthlyCost: subscriptionCost + apiSpend,
      subscriptionCost,
      apiSpend,
      activeCount: active.length,
      renewingSoon,
      lastRefreshed
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/subscriptions/:id', (req, res) => {
  try {
    const data = subService.readData();
    const idx = data.subscriptions.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const allowed = ['renewalDate', 'monthlyBudget', 'manualSpend', 'cost', 'active', 'notes', 'color', 'billingCycle'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    data.subscriptions[idx] = { ...data.subscriptions[idx], ...updates };
    subService.writeData(data);

    res.json({
      success: true,
      subscription: subService.getComputedSubscription(data.subscriptions[idx], usageCache)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/subscriptions', (req, res) => {
  try {
    const data = subService.readData();
    const b = req.body;
    const newSub = {
      id: `sub-${Date.now()}`,
      name: b.name,
      provider: b.provider || 'Other',
      type: b.type || 'subscription',
      category: b.category || 'other',
      cost: b.cost != null ? Number(b.cost) : null,
      currency: b.currency || 'USD',
      billingCycle: b.billingCycle || 'monthly',
      renewalDate: b.renewalDate,
      icon: b.icon || '📋',
      color: b.color || '#818cf8',
      active: true,
      monthlyBudget: b.monthlyBudget != null ? Number(b.monthlyBudget) : null,
      usageLimitType: b.usageLimitType || 'none',
      notes: b.notes || ''
    };
    data.subscriptions.push(newSub);
    subService.writeData(data);
    res.json({ success: true, subscription: subService.getComputedSubscription(newSub, usageCache) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/subscriptions/:id', (req, res) => {
  try {
    const data = subService.readData();
    const idx = data.subscriptions.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data.subscriptions.splice(idx, 1);
    subService.writeData(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    await refreshUsageCache();
    res.json({ success: true, lastRefreshed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, refreshUsageCache, getUsageCache: () => usageCache };
