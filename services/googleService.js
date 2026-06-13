const axios = require('axios');

const cache = { data: null, fetchedAt: null, TTL_MS: 10 * 60 * 1000 };

async function getMonthlyUsage() {
  if (cache.data && Date.now() - cache.fetchedAt < cache.TTL_MS) {
    return cache.data;
  }
  const apiKey = process.env.GOOGLE_API_KEY;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;

  if (!apiKey && !projectId) {
    return { spent: null, configured: false, error: 'Google Cloud not configured' };
  }

  // Full GCP billing API requires OAuth2/service account.
  // Return partial config state so UI shows "set manual spend" prompt.
  return { spent: null, configured: false, error: 'Billing API requires service account — use manual spend' };
}

function clearCache() {
  cache.data = null;
  cache.fetchedAt = null;
}

module.exports = { getMonthlyUsage, clearCache };
