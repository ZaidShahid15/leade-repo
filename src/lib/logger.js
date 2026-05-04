const pino = require('pino');

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'password',
            'access_token',
            'refresh_token',
            'token',
            'googleApiKey',
            'linkedinClientSecret'
        ],
        remove: true
    }
});

module.exports = logger;
