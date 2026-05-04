class AppError extends Error {
    constructor(statusCode, message, code = 'APP_ERROR', details = null) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

module.exports = AppError;
