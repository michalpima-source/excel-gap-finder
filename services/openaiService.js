const axios = require('axios');

const cache = { data: null, fetchedAt: null, TTL_MS: 5 * 60 * 1000 };

async function getMonthlyUsage() {
  if (cache.data && Date.now() - cache.fetchedAt < cache.TTL_MS) {
    return cache.data;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key') {
    return { spent: null, configured: false, error: 'API key not configured' };
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const fmt = (d) => d.toISOString().split('T')[0];

  try {
    const response = await axios.get('https://api.openai.com/dashboard/billing/usage', {
      headers: { Authorization: `Bearer ${apiKey}` },
      params: { start_date: fmt(startDate), end_date: fmt(endDate) },
      timeout: 10000
    });

    // total_usage is in cents
    const spent = (response.data.total_usage || 0) / 100;
    const result = { spent, configured: true };
    cache.data = result;
    cache.fetchedAt = Date.now();
    return result;
  } catch (err) {
    if (err.response?.status === 401) {
      return { spent: null, configured: false, error: 'Invalid API key' };
    }
    console.error('OpenAI usage fetch failed:', err.message);
    return { spent: null, configured: true, error: err.message };
  }
}

function clearCache() {
  cache.data = null;
  cache.fetchedAt = null;
}

module.exports = { getMonthlyUsage, clearCache };
