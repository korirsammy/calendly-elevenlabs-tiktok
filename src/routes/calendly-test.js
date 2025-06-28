// routes/calendly-test.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const config = require('../config/environment');

router.get('/calendly-test', async (req, res) => {
  try {
    const calendlyApi = axios.create({
      baseURL: config.calendly.baseUrl || 'https://api.calendly.com',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.calendly.apiToken}`
      }
    });

    const response = await calendlyApi.get('/event_types');
    res.json({
      success: true,
      eventTypeCount: response.data.collection?.length,
      eventTypes: response.data.collection
    });
  } catch (error) {
    console.error('Calendly test failed:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

module.exports = router;
