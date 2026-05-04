const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const AppError = require('../lib/appError');
const { assertSafePublicUrl } = require('../lib/ssrf');
const {
    isLikelyPhoneContext,
    normalizeEmail,
    normalizePhone,
    sanitizeEmailList,
    sanitizePhoneList
} = require('../lib/contactSanitizer');

class WebCrawler {
    constructor(options = {}) {
        this.timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 10000;
        this.delayMs = Number(options.delayMs) >= 0 ? Number(options.delayMs) : 250;
        this.maxPages = Number(options.maxPages) > 0 ? Number(options.maxPages) : 12;
        this.userAgent = 'LeadGenPlatformBot/1.0 (+https://leadgen.local)';
    }

    async crawl(inputUrl) {
        const normalizedUrl = await this._normalizeUrl(inputUrl);
        const result = {
            url: normalizedUrl,
            emails: new Set(),
            phones: new Set(),
            socialLinks: {},
            contactPageUrl: null,
            pages: [],
            error: null
        };

        try {
            const baseHost = new URL(normalizedUrl).hostname;
            const queue = this._buildSeedQueue(normalizedUrl);
            const visited = new Set();
            let contactPagesChecked = 0;

            while (queue.length && result.pages.length < this.maxPages) {
                const nextUrl = queue.shift();
                if (!nextUrl || visited.has(nextUrl)) {
                    continue;
                }

                visited.add(nextUrl);
                if (result.pages.length > 0) {
                    await this._delay(this.delayMs);
                }

                const page = await this._fetchPage(nextUrl);
                result.pages.push(nextUrl);
                this._extractContactInfo(page.$, result);

                if (this._isContactUrl(nextUrl) && !result.contactPageUrl) {
                    result.contactPageUrl = nextUrl;
                }
                if (this._isContactUrl(nextUrl)) {
                    contactPagesChecked += 1;
                }

                if (this._hasEnoughContactInfo(result, contactPagesChecked)) {
                    break;
                }

                const links = this._findRelevantLinks(page.$, nextUrl, baseHost, visited);
                for (const link of links) {
                    if (!visited.has(link) && !queue.includes(link)) {
                        queue.push(link);
                    }
                }
            }
        } catch (error) {
            if (error instanceof AppError) {
                result.error = error.message;
            } else {
                result.error = error.message || 'Unexpected crawl failure.';
            }
        }

        return this._formatResult(result);
    }

    async _fetchPage(url) {
        try {
            const response = await axios.get(url, {
                timeout: this.timeout,
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': 'text/html,application/xhtml+xml'
                },
                maxRedirects: 5,
                maxContentLength: 5 * 1024 * 1024
            });

            const contentType = response.headers['content-type'] || '';
            if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
                throw new AppError(422, `Unsupported content type for crawl: ${contentType}`, 'CRAWL_UNSUPPORTED_CONTENT');
            }

            return {
                $: cheerio.load(response.data)
            };
        } catch (error) {
            throw new AppError(502, error.message || 'Failed to fetch website content.', 'CRAWL_FETCH_FAILED');
        }
    }

    _extractContactInfo($, result) {
        const textRoot = $('body').clone();
        textRoot.find('script, style, noscript, svg, iframe').remove();

        const footerRoot = $('footer, [role="contentinfo"], .footer, #footer').clone();
        footerRoot.find('script, style, noscript, svg, iframe').remove();

        const bodyText = textRoot.text();
        const footerText = footerRoot.text();
        const bodyHtml = $('body').html() || '';
        const emailRegex = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/gi;
        const emails = `${bodyText}\n${footerText}`.match(emailRegex) || [];

        $('a[href^="mailto:"]').each((_, el) => {
            const email = String($(el).attr('href') || '').replace('mailto:', '').split('?')[0].trim();
            if (email) emails.push(email);
        });

        for (const email of sanitizeEmailList(emails)) {
            result.emails.add(email);
        }

        const phonePatterns = [
            /(?:\+?\d[\d\s().-]{6,}\d)/g
        ];

        $('a[href^="tel:"]').each((_, el) => {
            const phone = normalizePhone(String($(el).attr('href') || '').replace('tel:', '').trim());
            if (phone) {
                result.phones.add(phone);
            }
        });

        for (const pattern of phonePatterns) {
            for (const match of `${bodyText}\n${footerText}`.match(pattern) || []) {
                if (!isLikelyPhoneContext(match)) {
                    continue;
                }

                const cleaned = normalizePhone(match);
                if (cleaned) {
                    result.phones.add(cleaned);
                }
            }
        }

        const socialPatterns = {
            facebook: /(?:https?:\/\/)?(?:www\.)?facebook\.com\/[a-zA-Z0-9.]+/gi,
            linkedin: /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9\-]+/gi,
            instagram: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/gi
        };

        for (const [platform, regex] of Object.entries(socialPatterns)) {
            const matches = bodyHtml.match(regex) || [];
            if (matches.length && !result.socialLinks[platform]) {
                result.socialLinks[platform] = matches[0];
            }
        }

        this._extractStructuredContactInfo($, result);
    }

    _findRelevantLinks($, baseUrl, baseHost, visited) {
        const priority = [];
        const secondary = [];
        const seen = new Set();

        $('a[href]').each((_, el) => {
            try {
                const href = String($(el).attr('href') || '').trim();
                if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
                    return;
                }

                const resolved = new URL(href, baseUrl).href;
                const resolvedHost = new URL(resolved).hostname;

                if (resolvedHost !== baseHost || visited.has(resolved) || this._shouldSkipUrl(resolved) || seen.has(resolved)) {
                    return;
                }

                seen.add(resolved);
                if (this._isContactUrl(resolved) || this._isAboutUrl(resolved)) {
                    priority.push(resolved);
                } else {
                    secondary.push(resolved);
                }
            } catch (_error) {
                return;
            }
        });

        for (const seeded of this._buildSeedQueue(baseUrl)) {
            const seededHost = new URL(seeded).hostname;
            if (seededHost === baseHost && !visited.has(seeded) && !seen.has(seeded) && !this._shouldSkipUrl(seeded)) {
                priority.unshift(seeded);
                seen.add(seeded);
            }
        }

        return [...priority, ...secondary].slice(0, this.maxPages * 2);
    }

    _isContactUrl(url) {
        const lower = url.toLowerCase();
        return [
            '/contact',
            '/contact-us',
            '/contactus',
            '/kontakt',
            '/reach-us',
            '/get-in-touch',
            '/support',
            '/help',
            '/impressum'
        ].some((fragment) => lower.includes(fragment));
    }

    _isAboutUrl(url) {
        const lower = url.toLowerCase();
        return ['/about', '/about-us', '/team', '/company', '/our-team', '/staff'].some((fragment) => lower.includes(fragment));
    }

    _shouldSkipUrl(url) {
        const lower = url.toLowerCase();
        const blockedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.pdf', '.zip', '.mp4', '.mp3', '.css', '.js', '.json', '.xml'];
        return blockedExtensions.some((ext) => lower.includes(ext))
            || lower.includes('/wp-content/')
            || lower.includes('/wp-json/')
            || lower.includes('/cdn-cgi/');
    }

    async _normalizeUrl(url) {
        if (!url) {
            throw new AppError(400, 'A target URL is required.', 'INVALID_URL');
        }

        let normalized = String(url).trim();
        if (!/^https?:\/\//i.test(normalized)) {
            normalized = `https://${normalized}`;
        }

        return assertSafePublicUrl(normalized);
    }

    _buildSeedQueue(baseUrl) {
        const url = new URL(baseUrl);
        const candidates = [
            url.href,
            new URL('/contact', url).href,
            new URL('/contact-us', url).href,
            new URL('/contactus', url).href,
            new URL('/about', url).href,
            new URL('/about-us', url).href,
            new URL('/team', url).href,
            new URL('/impressum', url).href
        ];

        return [...new Set(candidates)];
    }

    _extractStructuredContactInfo($, result) {
        $('script[type="application/ld+json"]').each((_, el) => {
            const raw = $(el).html();
            if (!raw) {
                return;
            }

            for (const node of this._safeParseJsonLd(raw)) {
                this._collectStructuredNode(node, result);
            }
        });
    }

    _safeParseJsonLd(raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed;
            }
            if (Array.isArray(parsed['@graph'])) {
                return parsed['@graph'];
            }
            return [parsed];
        } catch (_error) {
            return [];
        }
    }

    _collectStructuredNode(node, result) {
        if (!node || typeof node !== 'object') {
            return;
        }

        if (typeof node.email === 'string') {
            const clean = normalizeEmail(node.email);
            if (clean) {
                result.emails.add(clean);
            }
        }

        if (typeof node.telephone === 'string') {
            const cleaned = normalizePhone(node.telephone);
            if (cleaned) {
                result.phones.add(cleaned);
            }
        }

        if (Array.isArray(node.sameAs)) {
            for (const url of node.sameAs) {
                if (typeof url !== 'string') {
                    continue;
                }
                const lower = url.toLowerCase();
                if (lower.includes('facebook.com') && !result.socialLinks.facebook) {
                    result.socialLinks.facebook = url;
                }
                if (lower.includes('linkedin.com') && !result.socialLinks.linkedin) {
                    result.socialLinks.linkedin = url;
                }
                if (lower.includes('instagram.com') && !result.socialLinks.instagram) {
                    result.socialLinks.instagram = url;
                }
            }
        }
    }

    _hasEnoughContactInfo(result, contactPagesChecked) {
        const hasDirectContact = result.emails.size > 0 || result.phones.size > 0;
        if (!hasDirectContact) {
            return false;
        }

        return Boolean(result.contactPageUrl) || contactPagesChecked > 0 || result.pages.length >= 3;
    }

    _formatResult(result) {
        return {
            url: result.url,
            emails: sanitizeEmailList([...result.emails]),
            phones: sanitizePhoneList([...result.phones]),
            socialLinks: result.socialLinks,
            contactPageUrl: result.contactPageUrl,
            pagesScanned: result.pages.length,
            error: result.error
        };
    }

    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = WebCrawler;
