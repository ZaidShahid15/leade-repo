const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('../lib/asyncHandler');
const AppError = require('../lib/appError');
const {
    crawlUrlSchema,
    linkedinSearchSchema,
    searchSchema,
    settingsSchema,
    siteCrawlSchema
} = require('../lib/validators');
const GooglePlacesService = require('../services/googlePlaces');
const WebCrawler = require('../services/webCrawler');

function parse(schema, input) {
    const result = schema.safeParse(input);
    if (!result.success) {
        throw new AppError(400, 'Invalid request payload.', 'VALIDATION_ERROR', result.error.flatten());
    }

    return result.data;
}

function maskSecret(value) {
    if (!value) return '';
    if (value.length <= 6) return '*'.repeat(value.length);
    return `${value.slice(0, 4)}${'*'.repeat(Math.max(0, value.length - 6))}${value.slice(-2)}`;
}

function normalizeLeadRow(row) {
    if (!row) return row;
    return {
        ...row,
        socialLinks: row.social_links || {},
        contactPageUrl: row.contact_page_url || null,
        crawlStatus: row.crawl_status,
        crawlError: row.crawl_error,
        pagesScanned: row.pages_scanned,
        reviewCount: row.review_count,
        businessStatus: row.business_status,
        discoveredAt: row.discovered_at,
        lastCrawled: row.last_crawled
    };
}

function buildApiRouter({ config, encryptionService, io, authMiddleware, leadRepository, jobRepository, settingsRepository, linkedinOAuthService }) {
    const router = express.Router();
    const crawler = new WebCrawler(config.crawler);

    router.use(authMiddleware);

    router.get('/health', (_req, res) => {
        res.json({
            success: true,
            status: 'ok',
            environment: config.app.env,
            demoMode: config.app.demoMode
        });
    });

    router.get('/linkedin/auth/status', asyncHandler(async (req, res) => {
        res.json({
            success: true,
            status: await linkedinOAuthService.getPublicStatus(req.auth.userId)
        });
    }));

    router.post('/search', asyncHandler(async (req, res) => {
        const payload = parse(searchSchema, req.body);
        const userSettings = await settingsRepository.getByUserId(req.auth.userId);
        const googleApiKey = decryptGoogleApiKey(encryptionService, userSettings) || config.googlePlaces.apiKey;

        if (!googleApiKey) {
            throw new AppError(503, 'Google Places provider unavailable.', 'GOOGLE_PROVIDER_UNAVAILABLE');
        }

        const jobId = `search_${Date.now()}_${uuidv4().slice(0, 8)}`;
        await jobRepository.create({
            id: jobId,
            ownerUserId: req.auth.userId,
            type: 'search',
            status: 'running',
            payload,
            result: {}
        });

        res.status(202).json({
            success: true,
            jobId,
            status: 'running',
            message: 'Search started.'
        });

        const placesService = new GooglePlacesService({ apiKey: googleApiKey });
        void runSearchJob({
            io,
            jobId,
            ownerUserId: req.auth.userId,
            payload,
            placesService,
            leadRepository,
            jobRepository,
            crawler,
            autoCrawl: payload.autoCrawl,
            config
        });
    }));

    router.post('/crawl', asyncHandler(async (req, res) => {
        const payload = parse(crawlUrlSchema, req.body || {});

        if (payload.url) {
            const result = await crawler.crawl(payload.url);
            return res.json({ success: true, result });
        }

        const jobId = `crawl_${Date.now()}_${uuidv4().slice(0, 8)}`;
        await jobRepository.create({
            id: jobId,
            ownerUserId: req.auth.userId,
            type: 'crawl',
            status: 'running',
            payload: {},
            result: {}
        });

        res.status(202).json({
            success: true,
            jobId,
            status: 'running',
            message: 'Crawl started.'
        });

        void runBulkCrawlJob({
            io,
            jobId,
            ownerUserId: req.auth.userId,
            crawler,
            leadRepository,
            jobRepository,
            config
        });
    }));

    router.post('/crawl/:id', asyncHandler(async (req, res) => {
        const lead = await leadRepository.findByIdForUser(req.params.id, req.auth.userId);
        if (!lead) {
            throw new AppError(404, 'Lead not found.', 'LEAD_NOT_FOUND');
        }

        if (!lead.website) {
            throw new AppError(400, 'Lead does not have a website to crawl.', 'LEAD_NO_WEBSITE');
        }

        const crawlResult = await crawler.crawl(lead.website);
        const updated = await leadRepository.updateLeadForUser(req.auth.userId, lead.id, {
            emails: crawlResult.emails,
            phones: crawlResult.phones,
            socialLinks: crawlResult.socialLinks,
            contactPageUrl: crawlResult.contactPageUrl,
            crawled: true,
            crawlStatus: crawlResult.error ? 'error' : 'completed',
            crawlError: crawlResult.error || null,
            pagesScanned: crawlResult.pagesScanned,
            lastCrawled: new Date().toISOString()
        });

        io.to(`user:${req.auth.userId}`).emit('lead:updated', normalizeLeadRow(updated));
        res.json({ success: true, lead: normalizeLeadRow(updated) });
    }));

    router.get('/leads', asyncHandler(async (req, res) => {
        const filters = {
            keyword: req.query.keyword,
            hasEmail: req.query.hasEmail === 'true' ? true : undefined,
            hasPhone: req.query.hasPhone === 'true' ? true : undefined,
            hasWebsite: req.query.hasWebsite === 'true' ? true : undefined,
            category: req.query.category,
            crawled: req.query.crawled !== undefined ? req.query.crawled === 'true' : undefined,
            sortBy: req.query.sortBy,
            sortDir: req.query.sortDir,
            page: req.query.page,
            limit: req.query.limit
        };

        const results = await leadRepository.listForUser(req.auth.userId, filters);
        res.json({
            success: true,
            ...results,
            leads: results.leads.map(normalizeLeadRow)
        });
    }));

    router.get('/leads/export', asyncHandler(async (req, res) => {
        const results = await leadRepository.listForUser(req.auth.userId, { limit: 5000, page: 1 });
        const format = String(req.query.format || 'json').toLowerCase();
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=leads_export.csv');
            return res.send(toCsv(results.leads.map(normalizeLeadRow)));
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=leads_export.json');
        return res.send(JSON.stringify(results.leads.map(normalizeLeadRow), null, 2));
    }));

    router.delete('/leads', asyncHandler(async (req, res) => {
        await leadRepository.clearForUser(req.auth.userId);
        io.to(`user:${req.auth.userId}`).emit('leads:cleared');
        res.json({ success: true, message: 'All leads deleted.' });
    }));

    router.delete('/leads/:id', asyncHandler(async (req, res) => {
        const deleted = await leadRepository.deleteForUser(req.auth.userId, req.params.id);
        if (!deleted) {
            throw new AppError(404, 'Lead not found.', 'LEAD_NOT_FOUND');
        }

        io.to(`user:${req.auth.userId}`).emit('lead:deleted', { id: req.params.id });
        res.json({ success: true, message: 'Lead deleted.' });
    }));

    router.get('/stats', asyncHandler(async (req, res) => {
        const stats = await leadRepository.getStatsForUser(req.auth.userId);
        res.json({ success: true, stats });
    }));

    router.get('/jobs/:id', asyncHandler(async (req, res) => {
        const job = await jobRepository.findByIdForUser(req.params.id, req.auth.userId);
        if (!job) {
            throw new AppError(404, 'Job not found.', 'JOB_NOT_FOUND');
        }

        res.json({ success: true, job });
    }));

    router.post('/settings', asyncHandler(async (req, res) => {
        const payload = parse(settingsSchema, req.body);
        const encrypted = payload.googleApiKey
            ? encryptionService.encrypt(payload.googleApiKey)
            : null;

        const settings = await settingsRepository.upsert(req.auth.userId, {
            google_api_key_ciphertext: encrypted?.ciphertext ?? null,
            google_api_key_iv: encrypted?.iv ?? null,
            google_api_key_auth_tag: encrypted?.authTag ?? null,
            crawler_concurrency: payload.crawlerConcurrency,
            crawler_timeout: payload.crawlerTimeout
        });

        res.json({
            success: true,
            settings: {
                hasApiKey: Boolean(settings.google_api_key_ciphertext),
                crawlerConcurrency: settings.crawler_concurrency,
                crawlerTimeout: settings.crawler_timeout
            }
        });
    }));

    router.get('/settings', asyncHandler(async (req, res) => {
        const settings = await settingsRepository.getByUserId(req.auth.userId);
        const googleApiKey = decryptGoogleApiKey(encryptionService, settings);
        res.json({
            success: true,
            settings: {
                googleApiKey: maskSecret(googleApiKey),
                hasApiKey: Boolean(googleApiKey),
                crawlerConcurrency: settings?.crawler_concurrency || config.crawler.concurrency,
                crawlerTimeout: settings?.crawler_timeout || config.crawler.timeout
            }
        });
    }));

    router.post('/site-crawl', asyncHandler(async (req, res) => {
        const payload = parse(siteCrawlSchema, req.body);
        const jobId = `sitecrawl_${Date.now()}_${uuidv4().slice(0, 8)}`;
        await jobRepository.create({
            id: jobId,
            ownerUserId: req.auth.userId,
            type: 'site-crawl',
            status: 'running',
            payload,
            result: {}
        });

        res.status(202).json({
            success: true,
            jobId,
            status: 'running',
            total: payload.sites.length
        });

        void runSiteCrawlJob({
            io,
            jobId,
            ownerUserId: req.auth.userId,
            sites: [...new Set(payload.sites)],
            crawler,
            jobRepository,
            config
        });
    }));

    router.post('/linkedin/search', asyncHandler(async (req, res) => {
        const payload = parse(linkedinSearchSchema, req.body);
        const authStatus = await linkedinOAuthService.getPublicStatus(req.auth.userId);
        if (!authStatus.configured) {
            throw new AppError(400, 'LinkedIn OAuth is not configured.', 'LINKEDIN_NOT_CONFIGURED');
        }

        if (!authStatus.connected) {
            throw new AppError(400, 'Open /auth/linkedin/connect?token=<JWT> first and complete authorization before using LinkedIn search.', 'LINKEDIN_NOT_CONNECTED');
        }

        if (!config.linkedin.providerUrl) {
            throw new AppError(503, 'Provider unavailable.', 'LINKEDIN_PROVIDER_UNAVAILABLE');
        }

        const token = await linkedinOAuthService.getAccessTokenForUser(req.auth.userId);
        const response = await axios.post(config.linkedin.providerUrl, payload, {
            timeout: config.linkedin.providerTimeoutMs,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token.access_token}`
            }
        });

        res.json({
            success: true,
            provider: response.data?.provider || 'linkedin-provider',
            results: Array.isArray(response.data?.results) ? response.data.results : []
        });
    }));

    router.get('/site-crawl/export/:jobId', asyncHandler(async (req, res) => {
        const job = await jobRepository.findByIdForUser(req.params.jobId, req.auth.userId);
        if (!job || job.type !== 'site-crawl') {
            throw new AppError(404, 'Site crawl job not found.', 'JOB_NOT_FOUND');
        }

        const format = String(req.query.format || 'csv').toLowerCase();
        const results = Array.isArray(job.result?.results) ? job.result.results : [];

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=${req.params.jobId}.json`);
            return res.send(JSON.stringify(results, null, 2));
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${req.params.jobId}.csv`);
        return res.send(siteResultsToCsv(results));
    }));

    return router;
}

async function runSearchJob({ io, jobId, ownerUserId, payload, placesService, leadRepository, jobRepository, crawler, autoCrawl, config }) {
    try {
        const leads = await placesService.search({
            ...payload,
            onProgress: async (progress) => {
                io.to(`user:${ownerUserId}`).emit('search:progress', { jobId, ...progress });
                if (progress.phase === 'found' && progress.lead) {
                    const stored = await leadRepository.createOrUpdateForUser(ownerUserId, progress.lead);
                    io.to(`user:${ownerUserId}`).emit('lead:new', normalizeLeadRow(stored));
                }
            }
        });

        await jobRepository.update(jobId, {
            status: 'completed',
            result: { totalFound: leads.length }
        });

        io.to(`user:${ownerUserId}`).emit('search:complete', {
            jobId,
            totalFound: leads.length
        });

        if (autoCrawl) {
            const autoCrawlJobId = `autocrawl_${Date.now()}`;
            await jobRepository.create({
                id: autoCrawlJobId,
                ownerUserId,
                type: 'crawl',
                status: 'running',
                payload: { triggeredByJobId: jobId, mode: 'auto' },
                result: {}
            });

            await runBulkCrawlJob({ io, jobId: autoCrawlJobId, ownerUserId, crawler, leadRepository, jobRepository, config });
        }
    } catch (error) {
        await jobRepository.update(jobId, {
            status: 'failed',
            errorMessage: error.message
        });

        io.to(`user:${ownerUserId}`).emit('search:error', {
            jobId,
            error: error.message
        });
    }
}

async function runBulkCrawlJob({ io, jobId, ownerUserId, crawler, leadRepository, jobRepository, config }) {
    try {
        const uncrawled = await leadRepository.getUncrawledForUser(ownerUserId, 5000);
        const total = uncrawled.length;
        let completed = 0;

        io.to(`user:${ownerUserId}`).emit('crawl:start', { jobId, total });

        for (let index = 0; index < uncrawled.length; index += config.crawler.concurrency) {
            const batch = uncrawled.slice(index, index + config.crawler.concurrency);
            const results = await Promise.all(batch.map(async (lead) => {
                const crawlResult = await crawler.crawl(lead.website);
                return leadRepository.updateLeadForUser(ownerUserId, lead.id, {
                    emails: crawlResult.emails,
                    phones: crawlResult.phones,
                    socialLinks: crawlResult.socialLinks,
                    contactPageUrl: crawlResult.contactPageUrl,
                    crawled: true,
                    crawlStatus: crawlResult.error ? 'error' : 'completed',
                    crawlError: crawlResult.error || null,
                    pagesScanned: crawlResult.pagesScanned,
                    lastCrawled: new Date().toISOString()
                });
            }));

            for (const updated of results) {
                completed += 1;
                io.to(`user:${ownerUserId}`).emit('crawl:progress', {
                    jobId,
                    completed,
                    total,
                    percent: Math.round((completed / Math.max(total, 1)) * 100),
                    lead: normalizeLeadRow(updated)
                });
            }

            if (index + config.crawler.concurrency < uncrawled.length) {
                await new Promise((resolve) => setTimeout(resolve, config.crawler.delayMs));
            }
        }

        await jobRepository.update(jobId, {
            status: 'completed',
            result: { completed, total }
        });

        io.to(`user:${ownerUserId}`).emit('crawl:complete', {
            jobId,
            total,
            completed
        });
    } catch (error) {
        await jobRepository.update(jobId, {
            status: 'failed',
            errorMessage: error.message
        });

        io.to(`user:${ownerUserId}`).emit('crawl:error', {
            jobId,
            error: error.message
        });
    }
}

async function runSiteCrawlJob({ io, jobId, ownerUserId, sites, crawler, jobRepository, config }) {
    const total = sites.length;
    const results = [];
    let completed = 0;

    try {
        io.to(`user:${ownerUserId}`).emit('sitecrawl:start', { jobId, total });
        for (let index = 0; index < sites.length; index += config.crawler.concurrency) {
            const batch = sites.slice(index, index + config.crawler.concurrency);
            const batchResults = await Promise.all(batch.map(async (site) => {
                const crawlResult = await crawler.crawl(site);
                return {
                    site,
                    normalizedUrl: crawlResult.url,
                    emails: crawlResult.emails || [],
                    phones: crawlResult.phones || [],
                    contactPageUrl: crawlResult.contactPageUrl || '',
                    pagesScanned: crawlResult.pagesScanned || 0,
                    status: crawlResult.error ? 'error' : 'completed',
                    error: crawlResult.error || ''
                };
            }));

            for (const result of batchResults) {
                results.push(result);
                completed += 1;
                io.to(`user:${ownerUserId}`).emit('sitecrawl:progress', {
                    jobId,
                    completed,
                    total,
                    percent: Math.round((completed / total) * 100),
                    result
                });
            }

            if (index + config.crawler.concurrency < sites.length) {
                await new Promise((resolve) => setTimeout(resolve, config.crawler.delayMs));
            }
        }

        await jobRepository.update(jobId, {
            status: 'completed',
            result: { total, completed, results }
        });

        io.to(`user:${ownerUserId}`).emit('sitecrawl:complete', {
            jobId,
            total,
            completed,
            results
        });
    } catch (error) {
        await jobRepository.update(jobId, {
            status: 'failed',
            errorMessage: error.message,
            result: { total, completed, results }
        });

        io.to(`user:${ownerUserId}`).emit('sitecrawl:error', {
            jobId,
            error: error.message
        });
    }
}

function decryptGoogleApiKey(encryptionService, settings) {
    if (!settings?.google_api_key_ciphertext || !settings?.google_api_key_iv || !settings?.google_api_key_auth_tag) {
        return '';
    }

    return encryptionService.decrypt({
        algorithm: 'aes-256-gcm',
        ciphertext: settings.google_api_key_ciphertext,
        iv: settings.google_api_key_iv,
        authTag: settings.google_api_key_auth_tag
    });
}

function toCsv(leads) {
    const headers = ['Name', 'Source', 'Email', 'Phone', 'Website', 'Address', 'Category'];
    const rows = [headers.join(',')];

    for (const lead of leads) {
        const emails = Array.isArray(lead.emails) && lead.emails.length ? lead.emails : [''];
        const phones = Array.isArray(lead.phones) && lead.phones.length ? lead.phones : [lead.phone || ''];
        const count = Math.max(emails.length, phones.length, 1);

        for (let index = 0; index < count; index += 1) {
            rows.push([
                csvEscape(lead.name),
                csvEscape(lead.source),
                csvEscape(emails[index] || ''),
                csvEscape(phones[index] || ''),
                csvEscape(lead.website || ''),
                csvEscape(lead.address || ''),
                csvEscape(lead.category || '')
            ].join(','));
        }
    }

    return rows.join('\n');
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
}

function siteResultsToCsv(results) {
    const headers = ['Source', 'Email', 'Phone/Contact'];
    const rows = [headers.join(',')];

    for (const result of results) {
        const source = csvEscape(String(result.normalizedUrl || result.site || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, ''));
        const emails = Array.isArray(result.emails) && result.emails.length ? result.emails : [''];
        const phones = Array.isArray(result.phones) && result.phones.length ? result.phones : [''];
        const count = Math.max(emails.length, phones.length, 1);

        for (let index = 0; index < count; index += 1) {
            rows.push([
                source,
                csvEscape(emails[index] || ''),
                csvEscape(phones[index] || '')
            ].join(','));
        }
    }

    return rows.join('\n');
}

module.exports = buildApiRouter;
