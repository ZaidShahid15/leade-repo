const JsonStore = require('../lib/jsonStore');

class JobRepository {
    constructor() {
        this.legacyStore = new JsonStore('jobs.json', []);
        this.indexStore = new JsonStore('job-owners.json', []);
        this.stores = new Map();
    }

    getStore(userId) {
        if (!this.stores.has(userId)) {
            // Each user keeps job history in their own JSON file.
            this.stores.set(userId, new JsonStore(`users/${userId}/jobs.json`, []));
        }

        return this.stores.get(userId);
    }

    async readRows(userId) {
        const store = this.getStore(userId);
        const rows = await store.read();
        if (rows.length > 0) {
            return rows;
        }

        const legacyRows = (await this.legacyStore.read()).filter((row) => row.owner_user_id === userId);
        if (legacyRows.length > 0) {
            await store.write(legacyRows);
        }

        return legacyRows;
    }

    async saveOwnerIndex(jobId, userId) {
        const rows = await this.indexStore.read();
        const filtered = rows.filter((row) => row.job_id !== jobId);
        filtered.push({ job_id: jobId, user_id: userId });
        await this.indexStore.write(filtered);
    }

    async getOwnerId(jobId) {
        const rows = await this.indexStore.read();
        const match = rows.find((row) => row.job_id === jobId);
        if (match) {
            return match.user_id;
        }

        const legacyRows = await this.legacyStore.read();
        const legacyMatch = legacyRows.find((row) => row.id === jobId);
        if (legacyMatch?.owner_user_id) {
            await this.saveOwnerIndex(jobId, legacyMatch.owner_user_id);
            return legacyMatch.owner_user_id;
        }

        return null;
    }

    async create(job) {
        const store = this.getStore(job.ownerUserId);
        const rows = await this.readRows(job.ownerUserId);
        const record = {
            id: job.id,
            owner_user_id: job.ownerUserId,
            type: job.type,
            status: job.status,
            payload: job.payload || {},
            result: job.result || {},
            error_message: job.errorMessage || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            completed_at: null
        };

        rows.push(record);
        await store.write(rows);
        await this.saveOwnerIndex(job.id, job.ownerUserId);
        return record;
    }

    async update(jobId, patch) {
        const ownerUserId = await this.getOwnerId(jobId);
        if (!ownerUserId) {
            return null;
        }

        const store = this.getStore(ownerUserId);
        const rows = await this.readRows(ownerUserId);
        const index = rows.findIndex((job) => job.id === jobId);
        if (index === -1) {
            return null;
        }

        const current = rows[index];
        const status = patch.status ?? current.status;
        rows[index] = {
            ...current,
            status,
            result: patch.result ?? current.result,
            error_message: patch.errorMessage ?? current.error_message,
            updated_at: new Date().toISOString(),
            completed_at: ['completed', 'failed'].includes(status) ? new Date().toISOString() : current.completed_at
        };

        await store.write(rows);
        return rows[index];
    }

    async findByIdForUser(jobId, userId) {
        const rows = await this.readRows(userId);
        return rows.find((job) => job.id === jobId && job.owner_user_id === userId) || null;
    }
}

module.exports = JobRepository;
