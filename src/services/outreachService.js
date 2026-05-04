const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const AppError = require('../lib/appError');

class OutreachService {
    constructor({ config, encryptionService, settingsRepository, outreachRepository, io }) {
        this.config = config;
        this.encryptionService = encryptionService;
        this.settingsRepository = settingsRepository;
        this.outreachRepository = outreachRepository;
        this.io = io;
    }

    async getPublicConfig(userId) {
        const settings = await this.settingsRepository.getByUserId(userId);
        return this._toPublicConfig(settings);
    }

    async saveConfig(userId, payload) {
        const smtpPass = payload.smtpPass
            ? this.encryptionService.encrypt(payload.smtpPass)
            : null;
        const openAiApiKey = payload.openAiApiKey
            ? this.encryptionService.encrypt(payload.openAiApiKey)
            : null;

        const settings = await this.settingsRepository.upsert(userId, {
            smtp_host: payload.smtpHost,
            smtp_port: payload.smtpPort,
            smtp_secure: payload.smtpSecure,
            smtp_user: payload.smtpUser,
            smtp_pass_ciphertext: smtpPass?.ciphertext,
            smtp_pass_iv: smtpPass?.iv,
            smtp_pass_auth_tag: smtpPass?.authTag,
            smtp_from_email: payload.fromEmail,
            smtp_from_name: payload.fromName,
            openai_api_key_ciphertext: openAiApiKey?.ciphertext,
            openai_api_key_iv: openAiApiKey?.iv,
            openai_api_key_auth_tag: openAiApiKey?.authTag,
            openai_model: payload.openAiModel,
            openai_prompt: payload.aiPrompt
        });

        return this._toPublicConfig(settings);
    }

    async listCampaigns(userId) {
        const campaigns = await this.outreachRepository.listForUser(userId);
        return campaigns.map((campaign) => this._sanitizeCampaign(campaign));
    }

    async getCampaign(userId, campaignId) {
        const campaign = await this.outreachRepository.findByIdForUser(campaignId, userId);
        if (!campaign) {
            throw new AppError(404, 'Outreach campaign not found.', 'OUTREACH_CAMPAIGN_NOT_FOUND');
        }

        return this._sanitizeCampaign(campaign);
    }

    async createCampaign(userId, payload) {
        const recipients = this._normalizeRecipients(payload.recipients);
        const uploadedEmails = this._normalizeEmailArchive(payload.uploadedEmails?.length
            ? payload.uploadedEmails
            : payload.recipients.map((item) => item.email));
        const invalidEmails = this._normalizeEmailArchive(payload.invalidEmails);
        if (!recipients.length) {
            throw new AppError(400, 'No valid unique recipient emails were provided.', 'OUTREACH_NO_RECIPIENTS');
        }
        const now = new Date().toISOString();
        const campaign = {
            id: `campaign_${Date.now()}_${uuidv4().slice(0, 8)}`,
            owner_user_id: userId,
            name: payload.name,
            mode: payload.mode,
            niche: payload.niche,
            subject_template: payload.subjectTemplate || '',
            message_template: payload.messageTemplate || '',
            status: payload.mode === 'manual' ? 'awaiting-manual' : 'draft',
            created_at: now,
            updated_at: now,
            completed_at: null,
            started_at: null,
            current_recipient_id: recipients[0]?.id || null,
            sent_count: 0,
            failed_count: 0,
            total_count: recipients.length,
            uploaded_count: uploadedEmails.length,
            invalid_count: invalidEmails.length,
            uploaded_emails: uploadedEmails,
            invalid_emails: invalidEmails,
            recipients
        };

        await this.outreachRepository.create(campaign);
        const sanitized = this._sanitizeCampaign(campaign);

        if (campaign.mode === 'manual' && recipients[0]) {
            this._emit(userId, 'outreach:manual-ready', {
                campaignId: campaign.id,
                recipient: this._sanitizeRecipient(recipients[0]),
                remaining: campaign.total_count
            });
        }

        return {
            campaign: sanitized,
            nextRecipient: recipients[0] ? this._sanitizeRecipient(recipients[0]) : null
        };
    }

    async startAiCampaign(userId, campaignId) {
        const campaign = await this.outreachRepository.findByIdForUser(campaignId, userId);
        if (!campaign) {
            throw new AppError(404, 'Outreach campaign not found.', 'OUTREACH_CAMPAIGN_NOT_FOUND');
        }

        if (campaign.mode !== 'ai') {
            throw new AppError(400, 'Only AI campaigns can be started automatically.', 'OUTREACH_INVALID_MODE');
        }

        if (campaign.status === 'running') {
            throw new AppError(409, 'This outreach campaign is already running.', 'OUTREACH_ALREADY_RUNNING');
        }

        const config = await this._getPrivateConfig(userId);
        this._assertSmtpConfigured(config);
        this._assertOpenAiConfigured(config);

        campaign.status = 'running';
        campaign.started_at = campaign.started_at || new Date().toISOString();
        campaign.updated_at = new Date().toISOString();
        await this.outreachRepository.replaceForUser(userId, campaign.id, campaign);

        this._emit(userId, 'outreach:progress', this._buildProgressPayload(campaign, null, 'AI sending started.'));
        void this._runAiCampaign(userId, campaign.id);

        return this._sanitizeCampaign(campaign);
    }

    async sendManualRecipient(userId, campaignId, payload) {
        const campaign = await this.outreachRepository.findByIdForUser(campaignId, userId);
        if (!campaign) {
            throw new AppError(404, 'Outreach campaign not found.', 'OUTREACH_CAMPAIGN_NOT_FOUND');
        }

        if (campaign.mode !== 'manual') {
            throw new AppError(400, 'This campaign is not in manual mode.', 'OUTREACH_INVALID_MODE');
        }

        const recipient = campaign.recipients.find((entry) => entry.id === payload.recipientId);
        if (!recipient) {
            throw new AppError(404, 'Recipient not found in this campaign.', 'OUTREACH_RECIPIENT_NOT_FOUND');
        }

        if (recipient.status === 'sent') {
            throw new AppError(409, 'This recipient has already been sent.', 'OUTREACH_RECIPIENT_ALREADY_SENT');
        }

        const config = await this._getPrivateConfig(userId);
        this._assertSmtpConfigured(config);

        recipient.status = 'sending';
        recipient.updated_at = new Date().toISOString();
        campaign.status = 'running';
        campaign.current_recipient_id = recipient.id;
        campaign.updated_at = new Date().toISOString();
        await this.outreachRepository.replaceForUser(userId, campaign.id, campaign);
        this._emit(userId, 'outreach:progress', this._buildProgressPayload(campaign, recipient, 'Sending manual email.'));

        try {
            await this._sendEmail(config, recipient.email, payload.subject, payload.message);
            recipient.subject = payload.subject;
            recipient.message = payload.message;
            recipient.status = 'sent';
            recipient.sent_at = new Date().toISOString();
            recipient.error = '';
            campaign.sent_count += 1;
        } catch (error) {
            recipient.subject = payload.subject;
            recipient.message = payload.message;
            recipient.status = 'failed';
            recipient.error = error.message || 'Send failed.';
            recipient.updated_at = new Date().toISOString();
            campaign.failed_count += 1;
        }

        const nextRecipient = campaign.recipients.find((entry) => !['sent'].includes(entry.status));
        campaign.current_recipient_id = nextRecipient?.id || null;
        campaign.status = nextRecipient ? 'awaiting-manual' : 'completed';
        campaign.updated_at = new Date().toISOString();
        campaign.completed_at = nextRecipient ? null : new Date().toISOString();
        await this.outreachRepository.replaceForUser(userId, campaign.id, campaign);

        this._emit(userId, 'outreach:progress', this._buildProgressPayload(campaign, recipient, recipient.status === 'sent'
            ? `Sent to ${recipient.email}`
            : `Failed for ${recipient.email}: ${recipient.error}`));

        if (nextRecipient) {
            this._emit(userId, 'outreach:manual-ready', {
                campaignId: campaign.id,
                recipient: this._sanitizeRecipient(nextRecipient),
                remaining: campaign.recipients.filter((entry) => entry.status !== 'sent').length
            });
        } else {
            this._emit(userId, 'outreach:complete', this._buildProgressPayload(campaign, recipient, 'Manual campaign completed.'));
        }

        return {
            campaign: this._sanitizeCampaign(campaign),
            sentRecipient: this._sanitizeRecipient(recipient),
            nextRecipient: nextRecipient ? this._sanitizeRecipient(nextRecipient) : null
        };
    }

    async _runAiCampaign(userId, campaignId) {
        const config = await this._getPrivateConfig(userId);

        while (true) {
            const campaign = await this.outreachRepository.findByIdForUser(campaignId, userId);
            if (!campaign) {
                return;
            }

            const recipient = campaign.recipients.find((entry) => !['sent', 'failed'].includes(entry.status));
            if (!recipient) {
                campaign.status = 'completed';
                campaign.current_recipient_id = null;
                campaign.completed_at = new Date().toISOString();
                campaign.updated_at = new Date().toISOString();
                await this.outreachRepository.replaceForUser(userId, campaign.id, campaign);
                this._emit(userId, 'outreach:complete', this._buildProgressPayload(campaign, null, 'AI campaign completed.'));
                return;
            }

            recipient.status = 'generating';
            recipient.updated_at = new Date().toISOString();
            campaign.current_recipient_id = recipient.id;
            campaign.updated_at = new Date().toISOString();
            await this.outreachRepository.replaceForUser(userId, campaign.id, campaign);
            this._emit(userId, 'outreach:progress', this._buildProgressPayload(campaign, recipient, `Generating content for ${recipient.email}`));

            try {
                const generated = await this._generateAiContent(config, campaign, recipient);
                recipient.subject = generated.subject;
                recipient.message = generated.message;
                recipient.status = 'sending';
                recipient.updated_at = new Date().toISOString();
                await this.outreachRepository.replaceForUser(userId, campaign.id, campaign);

                await this._sendEmail(config, recipient.email, generated.subject, generated.message);
                recipient.status = 'sent';
                recipient.sent_at = new Date().toISOString();
                recipient.error = '';
                campaign.sent_count += 1;
            } catch (error) {
                recipient.status = 'failed';
                recipient.error = error.message || 'Failed to generate or send.';
                campaign.failed_count += 1;
            }

            recipient.updated_at = new Date().toISOString();
            campaign.updated_at = new Date().toISOString();
            await this.outreachRepository.replaceForUser(userId, campaign.id, campaign);
            this._emit(userId, 'outreach:progress', this._buildProgressPayload(campaign, recipient, recipient.status === 'sent'
                ? `Sent to ${recipient.email}`
                : `Failed for ${recipient.email}: ${recipient.error}`));
        }
    }

    async _generateAiContent(config, campaign, recipient) {
        const response = await fetch(`${config.openAiApiBaseUrl.replace(/\/$/, '')}/responses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.openAiApiKey}`
            },
            body: JSON.stringify({
                model: config.openAiModel || this.config.openai.model,
                input: [
                    {
                        role: 'system',
                        content: 'You write concise cold outreach emails. Return JSON only with keys "subject" and "message". The message must be plain text with short paragraphs.'
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'input_text',
                                text: [
                                    `Niche: ${campaign.niche}`,
                                    `Recipient email: ${recipient.email}`,
                                    campaign.subject_template ? `Subject guidance: ${campaign.subject_template}` : '',
                                    campaign.message_template ? `Message guidance: ${campaign.message_template}` : '',
                                    config.aiPrompt ? `Additional style guidance: ${config.aiPrompt}` : '',
                                    'Create a unique subject and message for this recipient. Return valid JSON only.'
                                ].filter(Boolean).join('\n')
                            }
                        ]
                    }
                ]
            })
        });

        if (!response.ok) {
            const body = await response.text();
            throw new AppError(502, `OpenAI request failed: ${body || response.statusText}`, 'OUTREACH_OPENAI_FAILED');
        }

        const payload = await response.json();
        const outputText = this._extractResponseText(payload);
        let parsed;

        try {
            parsed = JSON.parse(this._stripCodeFence(outputText));
        } catch (_error) {
            throw new AppError(502, 'OpenAI returned an invalid JSON email draft.', 'OUTREACH_OPENAI_INVALID_JSON');
        }

        if (!parsed?.subject || !parsed?.message) {
            throw new AppError(502, 'OpenAI response is missing subject or message.', 'OUTREACH_OPENAI_INCOMPLETE');
        }

        return {
            subject: String(parsed.subject).trim(),
            message: String(parsed.message).trim()
        };
    }

    _extractResponseText(payload) {
        if (payload?.output_text) {
            return payload.output_text;
        }

        const parts = [];
        for (const item of payload?.output || []) {
            if (item.type === 'message') {
                for (const content of item.content || []) {
                    if (content.type === 'output_text' && content.text) {
                        parts.push(content.text);
                    }
                }
            }
        }

        return parts.join('\n').trim();
    }

    _stripCodeFence(text) {
        return String(text || '')
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
    }

    async _sendEmail(config, to, subject, message) {
        const transporter = nodemailer.createTransport({
            host: config.smtpHost,
            port: config.smtpPort,
            secure: config.smtpSecure,
            auth: {
                user: config.smtpUser,
                pass: config.smtpPass
            }
        });

        await transporter.sendMail({
            from: config.fromName
                ? `"${config.fromName.replace(/"/g, '\\"')}" <${config.fromEmail}>`
                : config.fromEmail,
            to,
            subject,
            text: message,
            html: this._textToHtml(message)
        });
    }

    _textToHtml(message) {
        return String(message || '')
            .split(/\n{2,}/)
            .map((paragraph) => `<p>${paragraph.trim().replace(/\n/g, '<br>')}</p>`)
            .join('');
    }

    async _getPrivateConfig(userId) {
        const settings = await this.settingsRepository.getByUserId(userId);
        return {
            smtpHost: settings?.smtp_host || '',
            smtpPort: Number(settings?.smtp_port || 587),
            smtpSecure: Boolean(settings?.smtp_secure),
            smtpUser: settings?.smtp_user || '',
            smtpPass: this._decrypt(settings, 'smtp_pass'),
            fromEmail: settings?.smtp_from_email || '',
            fromName: settings?.smtp_from_name || '',
            openAiApiKey: this._decrypt(settings, 'openai_api_key'),
            openAiModel: settings?.openai_model || this.config.openai.model,
            aiPrompt: settings?.openai_prompt || '',
            openAiApiBaseUrl: this.config.openai.apiBaseUrl
        };
    }

    _decrypt(settings, prefix) {
        return this.encryptionService.decrypt({
            algorithm: 'aes-256-gcm',
            ciphertext: settings?.[`${prefix}_ciphertext`],
            iv: settings?.[`${prefix}_iv`],
            authTag: settings?.[`${prefix}_auth_tag`]
        }) || '';
    }

    _toPublicConfig(settings) {
        return {
            hasSmtp: Boolean(settings?.smtp_host && settings?.smtp_user && settings?.smtp_from_email),
            smtpHost: settings?.smtp_host || '',
            smtpPort: settings?.smtp_port || 587,
            smtpSecure: Boolean(settings?.smtp_secure),
            smtpUser: this._maskValue(settings?.smtp_user || ''),
            fromEmail: settings?.smtp_from_email || '',
            fromName: settings?.smtp_from_name || '',
            hasOpenAi: Boolean(settings?.openai_api_key_ciphertext),
            openAiModel: settings?.openai_model || this.config.openai.model,
            aiPrompt: settings?.openai_prompt || ''
        };
    }

    _maskValue(value) {
        if (!value) {
            return '';
        }

        if (value.length <= 6) {
            return '*'.repeat(value.length);
        }

        return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`;
    }

    _normalizeRecipients(recipients) {
        const seen = new Set();
        const candidates = recipients.reduce((list, item) => {
            const email = String(item.email || '').trim().toLowerCase();
            if (!email || seen.has(email)) {
                return list;
            }

            seen.add(email);
            list.push({
                id: `recipient_${uuidv4().slice(0, 8)}`,
                email,
                status: 'pending',
                subject: '',
                message: '',
                error: '',
                sent_at: null,
                updated_at: new Date().toISOString()
            });
            return list;
        }, []);

        return this._filterSuspiciousRecipients(candidates);
    }

    _normalizeEmailArchive(items = []) {
        const seen = new Set();

        return (Array.isArray(items) ? items : [])
            .map((item) => String(item || '').trim())
            .filter((item) => {
                if (!item) {
                    return false;
                }

                const key = item.toLowerCase();
                if (seen.has(key)) {
                    return false;
                }

                seen.add(key);
                return true;
            });
    }

    _filterSuspiciousRecipients(recipients) {
        const domains = new Set(recipients.map((recipient) => this._recipientDomain(recipient.email)).filter(Boolean));
        return recipients.filter((recipient) => !this._isSuspiciousRecipientEmail(recipient.email, domains));
    }

    _recipientDomain(email) {
        const parts = String(email || '').split('@');
        return parts.length === 2 ? parts[1] : '';
    }

    _isSuspiciousRecipientEmail(email, domains) {
        const domain = this._recipientDomain(email);
        if (!domain) {
            return true;
        }

        const suspiciousBases = ['.com', '.co', '.net', '.org', '.io', '.ae', '.ai', '.app', '.dev'];
        return suspiciousBases.some((suffix) => {
            if (!domain.includes(suffix)) {
                return false;
            }

            const markerIndex = domain.indexOf(suffix);
            if (markerIndex === -1) {
                return false;
            }

            const exactDomain = domain.slice(0, markerIndex + suffix.length);
            const trailing = domain.slice(markerIndex + suffix.length);

            if (!trailing || !/^[a-z]{1,24}$/.test(trailing)) {
                return false;
            }

            return domains.has(exactDomain);
        });
    }

    _sanitizeCampaign(campaign) {
        return {
            id: campaign.id,
            name: campaign.name,
            mode: campaign.mode,
            niche: campaign.niche,
            subjectTemplate: campaign.subject_template,
            messageTemplate: campaign.message_template,
            status: campaign.status,
            createdAt: campaign.created_at,
            updatedAt: campaign.updated_at,
            completedAt: campaign.completed_at,
            currentRecipientId: campaign.current_recipient_id,
            sentCount: campaign.sent_count,
            failedCount: campaign.failed_count,
            totalCount: campaign.total_count,
            uploadedCount: campaign.uploaded_count || (campaign.uploaded_emails || []).length,
            invalidCount: campaign.invalid_count || (campaign.invalid_emails || []).length,
            uploadedEmails: campaign.uploaded_emails || [],
            invalidEmails: campaign.invalid_emails || [],
            recipients: campaign.recipients.map((recipient) => this._sanitizeRecipient(recipient))
        };
    }

    _sanitizeRecipient(recipient) {
        return {
            id: recipient.id,
            email: recipient.email,
            status: recipient.status,
            subject: recipient.subject,
            message: recipient.message,
            error: recipient.error,
            sentAt: recipient.sent_at,
            updatedAt: recipient.updated_at
        };
    }

    _buildProgressPayload(campaign, recipient, message) {
        return {
            campaignId: campaign.id,
            name: campaign.name,
            mode: campaign.mode,
            status: campaign.status,
            sentCount: campaign.sent_count,
            failedCount: campaign.failed_count,
            totalCount: campaign.total_count,
            remainingCount: Math.max(0, campaign.total_count - campaign.sent_count - campaign.failed_count),
            recipient: recipient ? this._sanitizeRecipient(recipient) : null,
            message
        };
    }

    _assertSmtpConfigured(config) {
        if (!config.smtpHost || !config.smtpUser || !config.smtpPass || !config.fromEmail) {
            throw new AppError(400, 'SMTP configuration is incomplete. Save your mail settings first.', 'OUTREACH_SMTP_MISSING');
        }
    }

    _assertOpenAiConfigured(config) {
        if (!config.openAiApiKey) {
            throw new AppError(400, 'OpenAI API key is required for AI outreach mode.', 'OUTREACH_OPENAI_MISSING');
        }
    }

    _emit(userId, event, payload) {
        this.io.to(`user:${userId}`).emit(event, payload);
    }
}

module.exports = OutreachService;
