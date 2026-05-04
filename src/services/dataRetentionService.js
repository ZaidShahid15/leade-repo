const fs = require('fs');
const path = require('path');

class DataRetentionService {
    constructor({ logger, ttlMs = 24 * 60 * 60 * 1000, sweepIntervalMs = 60 * 60 * 1000 }) {
        this.logger = logger;
        this.ttlMs = ttlMs;
        this.sweepIntervalMs = sweepIntervalMs;
        this.dataDir = path.join(__dirname, '..', '..', 'data');
        this.userDataRoot = path.join(this.dataDir, 'users');
        this.timer = null;
        this.running = false;
    }

    start() {
        this.stop();
        this.timer = setInterval(() => {
            void this.sweep().catch((error) => {
                this.logger?.error?.({ err: error }, 'User data retention sweep failed');
            });
        }, this.sweepIntervalMs);

        if (typeof this.timer.unref === 'function') {
            this.timer.unref();
        }

        void this.sweep().catch((error) => {
            this.logger?.error?.({ err: error }, 'Initial user data retention sweep failed');
        });
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async sweep() {
        if (this.running) {
            return;
        }

        this.running = true;
        try {
            await fs.promises.mkdir(this.userDataRoot, { recursive: true });
            const entries = await fs.promises.readdir(this.userDataRoot, { withFileTypes: true });
            const deletedUsers = [];

            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }

                const userDir = path.join(this.userDataRoot, entry.name);
                const lastActivity = await this.getLatestJsonModifiedTime(userDir);
                if (!lastActivity) {
                    await this.removeDirectoryIfEmpty(userDir);
                    continue;
                }

                if ((Date.now() - lastActivity) < this.ttlMs) {
                    continue;
                }

                await this.deleteJsonFiles(userDir);
                await this.removeDirectoryIfEmpty(userDir);
                deletedUsers.push(entry.name);
            }

            if (deletedUsers.length) {
                this.logger?.info?.({
                    deletedUsers,
                    ttlHours: Math.round(this.ttlMs / (60 * 60 * 1000))
                }, 'Deleted expired per-user JSON workspaces');
            }
        } finally {
            this.running = false;
        }
    }

    async getLatestJsonModifiedTime(targetDir) {
        const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
        let latest = 0;

        for (const entry of entries) {
            const fullPath = path.join(targetDir, entry.name);
            if (entry.isDirectory()) {
                const nestedLatest = await this.getLatestJsonModifiedTime(fullPath);
                latest = Math.max(latest, nestedLatest || 0);
                continue;
            }

            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') {
                continue;
            }

            const stats = await fs.promises.stat(fullPath);
            latest = Math.max(latest, stats.mtimeMs || 0);
        }

        return latest || 0;
    }

    async deleteJsonFiles(targetDir) {
        const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(targetDir, entry.name);
            if (entry.isDirectory()) {
                await this.deleteJsonFiles(fullPath);
                await this.removeDirectoryIfEmpty(fullPath);
                continue;
            }

            if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') {
                await fs.promises.unlink(fullPath).catch(() => {});
            }
        }
    }

    async removeDirectoryIfEmpty(targetDir) {
        const entries = await fs.promises.readdir(targetDir);
        if (entries.length === 0) {
            await fs.promises.rmdir(targetDir).catch(() => {});
        }
    }
}

module.exports = DataRetentionService;
