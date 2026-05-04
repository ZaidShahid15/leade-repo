const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const logger = require('../lib/logger');

function createDb(config) {
    const pool = new Pool({
        connectionString: config.database.url,
        ssl: config.database.ssl ? { rejectUnauthorized: false } : false
    });

    async function query(text, params) {
        return pool.query(text, params);
    }

    async function ensureSchema() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const sql = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(sql);
        logger.info('Database schema ensured');
    }

    async function close() {
        await pool.end();
    }

    return {
        close,
        ensureSchema,
        pool,
        query
    };
}

module.exports = {
    createDb
};
