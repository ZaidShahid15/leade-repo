const { z } = require('zod');

const boundsSchema = z.tuple([
    z.tuple([z.number(), z.number()]),
    z.tuple([z.number(), z.number()])
]);

const polygonSchema = z.array(z.tuple([z.number(), z.number()])).min(3).optional();

const searchSchema = z.object({
    keyword: z.string().trim().min(1),
    bounds: boundsSchema,
    polygon: polygonSchema,
    type: z.string().trim().min(1).optional(),
    autoCrawl: z.boolean().optional().default(false)
});

const crawlUrlSchema = z.object({
    url: z.string().trim().url().optional()
});

const siteCrawlSchema = z.object({
    sites: z.array(z.string().trim().min(1)).min(1)
});

const authRegisterSchema = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(255),
    password: z.string().min(10).max(128)
});

const authLoginSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(1).max(128)
});

const settingsSchema = z.object({
    googleApiKey: z.string().trim().min(10).max(512).optional(),
    crawlerConcurrency: z.number().int().min(1).max(10).optional(),
    crawlerTimeout: z.number().int().min(1000).max(60000).optional()
});

const linkedinSearchSchema = z.object({
    keyword: z.string().trim().min(1),
    category: z.string().trim().min(1).optional().default('all'),
    limit: z.number().int().min(1).max(100).optional().default(25)
});

const outreachConfigSchema = z.object({
    smtpHost: z.string().trim().min(1).max(255).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpSecure: z.boolean().optional(),
    smtpUser: z.string().trim().min(1).max(255).optional(),
    smtpPass: z.string().min(1).max(512).optional(),
    fromEmail: z.string().trim().email().max(255).optional(),
    fromName: z.string().trim().min(1).max(255).optional(),
    openAiApiKey: z.string().trim().min(10).max(512).optional(),
    openAiModel: z.string().trim().min(1).max(120).optional(),
    aiPrompt: z.string().trim().max(4000).optional()
});

const outreachCampaignCreateSchema = z.object({
    name: z.string().trim().min(1).max(160),
    mode: z.enum(['manual', 'ai']),
    niche: z.string().trim().min(1).max(2000),
    subjectTemplate: z.string().trim().min(1).max(500).optional(),
    messageTemplate: z.string().trim().min(1).max(20000).optional(),
    uploadedEmails: z.array(z.string().trim().min(1).max(255)).max(5000).optional(),
    invalidEmails: z.array(z.string().trim().min(1).max(255)).max(5000).optional(),
    recipients: z.array(z.object({
        email: z.string().trim().email().max(255)
    })).min(1).max(1000)
});

const outreachManualSendSchema = z.object({
    recipientId: z.string().trim().min(1),
    subject: z.string().trim().min(1).max(500),
    message: z.string().trim().min(1).max(20000)
});

module.exports = {
    authLoginSchema,
    authRegisterSchema,
    crawlUrlSchema,
    linkedinSearchSchema,
    outreachCampaignCreateSchema,
    outreachConfigSchema,
    outreachManualSendSchema,
    searchSchema,
    settingsSchema,
    siteCrawlSchema
};
