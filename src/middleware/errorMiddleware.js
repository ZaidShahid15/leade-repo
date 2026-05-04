const logger = require('../lib/logger');
const AppError = require('../lib/appError');

function notFoundMiddleware(req, _res, next) {
    next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
}

function errorMiddleware(err, req, res, _next) {
    const statusCode = err.statusCode || 500;
    const payload = {
        success: false,
        error: err.code || 'INTERNAL_SERVER_ERROR',
        message: err.message || 'Unexpected server error.'
    };

    if (err.details) {
        payload.details = err.details;
    }

    logger.error({
        err,
        method: req.method,
        url: req.originalUrl,
        userId: req.auth?.userId || null
    }, 'Request failed');

    res.status(statusCode).json(payload);
}

module.exports = {
    errorMiddleware,
    notFoundMiddleware
};
