const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const AppError = require('../lib/appError');
const {
    outreachCampaignCreateSchema,
    outreachConfigSchema,
    outreachManualSendSchema
} = require('../lib/validators');

function parse(schema, input) {
    const result = schema.safeParse(input);
    if (!result.success) {
        const details = result.error.flatten();
        throw new AppError(
            400,
            buildOutreachValidationMessage(details),
            'VALIDATION_ERROR',
            details
        );
    }

    return result.data;
}

function buildOutreachValidationMessage(details) {
    const fieldMessages = Object.entries(details?.fieldErrors || {})
        .flatMap(([field, messages]) => (messages || []).map((message) => `${humanizeFieldName(field)}: ${message}`));

    const formMessages = details?.formErrors || [];
    const combined = [...fieldMessages, ...formMessages].filter(Boolean);

    if (!combined.length) {
        return 'Invalid outreach request payload.';
    }

    return combined.slice(0, 3).join(' ');
}

function humanizeFieldName(field) {
    const labels = {
        smtpHost: 'SMTP Host',
        smtpPort: 'SMTP Port',
        smtpSecure: 'SMTP Secure',
        smtpUser: 'SMTP Username',
        smtpPass: 'SMTP Password',
        fromEmail: 'From Email',
        fromName: 'From Name',
        openAiApiKey: 'OpenAI API Key',
        openAiModel: 'OpenAI Model',
        aiPrompt: 'AI Prompt',
        name: 'Campaign Name',
        mode: 'Campaign Mode',
        niche: 'Niche / Context',
        subjectTemplate: 'Subject Guidance',
        messageTemplate: 'Message Guidance',
        recipients: 'Recipients',
        recipientId: 'Recipient',
        subject: 'Subject',
        message: 'Message'
    };

    return labels[field] || field;
}

function buildOutreachRouter({ authMiddleware, outreachService }) {
    const router = express.Router();
    router.use(authMiddleware);

    router.get('/config', asyncHandler(async (req, res) => {
        const config = await outreachService.getPublicConfig(req.auth.userId);
        res.json({ success: true, config });
    }));

    router.post('/config', asyncHandler(async (req, res) => {
        const payload = parse(outreachConfigSchema, req.body || {});
        const config = await outreachService.saveConfig(req.auth.userId, payload);
        res.json({ success: true, config });
    }));

    router.get('/campaigns', asyncHandler(async (req, res) => {
        const campaigns = await outreachService.listCampaigns(req.auth.userId);
        res.json({ success: true, campaigns });
    }));

    router.get('/campaigns/:id', asyncHandler(async (req, res) => {
        const campaign = await outreachService.getCampaign(req.auth.userId, req.params.id);
        res.json({ success: true, campaign });
    }));

    router.post('/campaigns', asyncHandler(async (req, res) => {
        const payload = parse(outreachCampaignCreateSchema, req.body || {});
        const created = await outreachService.createCampaign(req.auth.userId, payload);
        res.status(201).json({ success: true, ...created });
    }));

    router.post('/campaigns/:id/start', asyncHandler(async (req, res) => {
        const campaign = await outreachService.startAiCampaign(req.auth.userId, req.params.id);
        res.status(202).json({
            success: true,
            campaign,
            message: 'AI outreach campaign started.'
        });
    }));

    router.post('/campaigns/:id/manual-send', asyncHandler(async (req, res) => {
        const payload = parse(outreachManualSendSchema, req.body || {});
        const result = await outreachService.sendManualRecipient(req.auth.userId, req.params.id, payload);
        res.json({ success: true, ...result });
    }));

    return router;
}

module.exports = buildOutreachRouter;
