
// src/server.js
require('./utils/secure-logging');
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const config = require('./config/environment');
const calendlyRoutes = require('./routes/calendly');
const notificationsRoutes = require('./routes/notifications');
const elevenlabsRoutes = require('./routes/elevenlabs');
const promptBuilderRoutes = require('./routes/promptBuilder');
const calendlyTestRoute = require('./routes/calendly-test'); // ✅ Test route

// Import authentication middleware
const auth = require('./middleware/auth');

// Initialize Express app
const app = express();
app.set('trust proxy', 1);
const PORT = config.port;

// Mount Calendly test route early (no auth required)
app.use('/api', calendlyTestRoute);

// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Add security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: { policy: 'same-origin' }
}));

// Apply basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure CORS with security settings
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.APP_URL || 'http://localhost:3000'].concat(
        (process.env.ALLOWED_ORIGINS || '').split(',').filter(origin => origin.trim())
      )
    : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
  maxAge: 86400
};
app.use(cors(corsOptions));

// API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', apiLimiter);

// Admin-protected routes
app.get(['/agent-builder.html', '/prompt-builder.html'], auth.adminAuth, (req, res, next) => {
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, path) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('X-XSS-Protection', '1; mode=block');
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Apply auth middleware to secure API routes (excluding /calendly-test)
app.use('/api', auth.authenticateApiKey);

// Mount main routes
app.use('/api/calendly', calendlyRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/elevenlabs', elevenlabsRoutes);
app.use('/api/prompt-builder', promptBuilderRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : err.message,
    requestId: req.id
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ================================================
  🚀 Server running on port ${PORT}
  🔗 ${process.env.NODE_ENV === 'production' ? 'https' : 'http'}://localhost:${PORT}
  🔒 Security features: Helmet, Rate limiting, HTTPS enforcement
  ================================================
  `);
});

module.exports = app;
