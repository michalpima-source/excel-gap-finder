const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/subscriptions.json');

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getDaysUntil(dateStr) {
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

function advanceRenewalDate(sub) {
  let d = new Date(sub.renewalDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  if (d >= now) return sub.renewalDate;
  if (sub.billingCycle === 'monthly') {
    while (d < now) d.setMonth(d.getMonth() + 1);
  } else if (sub.billingCycle === 'annual') {
    while (d < now) d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString().split('T')[0];
}

function getComputedSubscription(sub, usageCache = {}) {
  const renewalDate = advanceRenewalDate(sub);
  const daysUntilRenewal = getDaysUntil(renewalDate);
  let urgency = 'safe';
  if (daysUntilRenewal <= 3) urgency = 'urgent';
  else if (daysUntilRenewal <= 7) urgency = 'warn';

  const result = { ...sub, renewalDate, daysUntilRenewal, urgency };

  if (sub.type === 'api') {
    const usage = usageCache[sub.id];
    const spent = (usage && usage.spent != null) ? usage.spent : (sub.manualSpend ?? null);
    const usageError = usage ? usage.error : null;
    const usageConfigured = usage ? usage.configured : false;
    result.currentSpend = spent;
    result.spendPercent = (sub.monthlyBudget && spent != null)
      ? Math.min(100, (spent / sub.monthlyBudget) * 100) : null;
    result.remaining = (sub.monthlyBudget && spent != null)
      ? Math.max(0, sub.monthlyBudget - spent) : null;
    result.usageError = usageError;
    result.usageConfigured = usageConfigured;
  }

  return result;
}

module.exports = { readData, writeData, getDaysUntil, getComputedSubscription };
