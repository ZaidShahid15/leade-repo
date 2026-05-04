const fs = require('fs');
const path = require('path');

class JsonStore {
    constructor(filename, defaultValue) {
        this.dataDir = path.join(__dirname, '..', '..', 'data');
        this.filePath = path.join(this.dataDir, filename);
        this.defaultValue = defaultValue;
        this.writeQueue = Promise.resolve();
        this.ensureFile();
    }

    ensureFile() {
        // Support nested per-user JSON paths like data/users/<id>/leads.json.
        const targetDir = path.dirname(this.filePath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify(this.defaultValue, null, 2), 'utf8');
        }
    }

    async read() {
        try {
            const raw = await fs.promises.readFile(this.filePath, 'utf8');
            return JSON.parse(raw);
        } catch (_error) {
            return this.cloneDefault();
        }
    }

    async write(value) {
        this.writeQueue = this.writeQueue.then(async () => {
            await fs.promises.writeFile(this.filePath, JSON.stringify(value, null, 2), 'utf8');
        });

        return this.writeQueue;
    }

    cloneDefault() {
        return JSON.parse(JSON.stringify(this.defaultValue));
    }
}

module.exports = JsonStore;
