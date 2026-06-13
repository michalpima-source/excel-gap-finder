const axios = require('axios');

const cache = { data: null, fetchedAt: null, TTL_MS: 5 * 60 * 1000 };

async function getMonthlyUsage() {
  if (cache.data && Date.now() - cache.fetchedAt < cache.TTL_MS) {
    return cache.data;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key') {
    return { spent: null, configured: false, error: 'API key not configured' };
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    const response = await axios.get('https://api.anthropic.com/v1/usage', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      params: {
        start_time: startDate.toISOString(),
        end_time: now.toISOString()
      },
      timeout: 10000
    });

    const data = response.data;
    let spent = 0;
    if (data.total_cost != null) {
      spent = data.total_cost;
    } else if (data.usage?.total_cost != null) {
      spent = data.usage.total_cost;
    } else if (Array.isArray(data.data)) {
      spent = data.data.reduce((sum, item) => sum + (item.cost || 0), 0);
    }

    const result = { spent, configured: true };
    cache.data = result;
    cache.fetchedAt = Date.now();
    return result;
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 405) {
      return { spent: null, configured: true, error: 'Usage API endpoint not available' };
    }
    if (err.response?.status === 401) {
      return { spent: null, configured: false, error: 'Invalid API key' };
    }
    console.error('Anthropic usage fetch failed:', err.message);
    return { spent: null, configured: true, error: err.message };
  }
}

function clearCache() {
  cache.data = null;
  cache.fetchedAt = null;
}

module.exports = { getMonthlyUsage, clearCache };
