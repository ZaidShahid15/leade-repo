const BLOCKED_EMAIL_DOMAINS = new Set([
    'example.com',
    'example.org',
    'example.net',
    'domain.com',
    'email.com',
    'company.com',
    'mysite.com',
    'test.com',
    'yourdomain.com',
    'sentry.io',
    'sentry.wixpress.com',
    'sentry-next.wixpress.com'
]);

const BLOCKED_EMAIL_LOCALS = new Set([
    'example',
    'john.doe',
    'jane.doe',
    'noreply',
    'no-reply',
    'sample',
    'test',
    'yourname'
]);

const GENERIC_PHONE_BLACKLIST = new Set([
    '1234567890',
    '2147483648',
    '255255255',
    '9999999999',
    '1999999999',
    '19999999999',
    '199999999999'
]);

// Validation rules used before contact values are stored.
const STANDARD_EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const STANDARD_PHONE_REGEX = /^\+?\d{7,15}$/;

function normalizeEmail(value) {
    if (!value) {
        return '';
    }

    const normalized = decodeURIComponentSafe(String(value))
        .replace(/^mailto:/i, '')
        .split('?')[0]
        .trim()
        .replace(/^[<("'`\s]+|[>)"'`.,;:\s]+$/g, '')
        .toLowerCase();

    if (!normalized || normalized.length > 254 || normalized.includes(' ')) {
        return '';
    }

    const match = normalized.match(STANDARD_EMAIL_REGEX);
    if (!match) {
        return '';
    }

    const [localPart, domain] = normalized.split('@');
    if (!localPart || !domain || domain.includes('..')) {
        return '';
    }

    const domainLabels = domain.split('.');
    if (domainLabels.some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
        return '';
    }

    if (BLOCKED_EMAIL_LOCALS.has(localPart) || BLOCKED_EMAIL_DOMAINS.has(domain)) {
        return '';
    }

    if (localPart.includes('sentry') || domain.includes('sentry')) {
        return '';
    }

    return normalized;
}

function isValidEmail(value) {
    return Boolean(normalizeEmail(value));
}

function normalizePhone(value) {
    if (!value) {
        return '';
    }

    const original = decodeURIComponentSafe(String(value))
        .replace(/^tel:/i, '')
        .replace(/(?:ext|extension|x)\s*\d+.*$/i, '')
        .trim();

    const hasExplicitInternationalPrefix = /^\s*\+/.test(original);
    const cleaned = original
        .replace(/^(?:tel|phone|fax|mobile|cell|call|contact|whatsapp)[\s:]*/i, '')
        .replace(/[^\d+]/g, '');

    const plusCount = (cleaned.match(/\+/g) || []).length;
    if (!cleaned || plusCount > 1 || (plusCount === 1 && !cleaned.startsWith('+'))) {
        return '';
    }

    if (!STANDARD_PHONE_REGEX.test(cleaned)) {
        return '';
    }

    const digits = cleaned.replace(/\D/g, '');
    if (!isValidPhoneDigits(digits)) {
        return '';
    }

    return hasExplicitInternationalPrefix ? `+${digits}` : digits;
}

function isValidPhone(value) {
    return Boolean(normalizePhone(value));
}

function sanitizeEmailList(values) {
    return uniqueTruthy((values || []).map(normalizeEmail));
}

function sanitizePhoneList(values) {
    return uniqueTruthy((values || []).map(normalizePhone));
}

// Store the value only when it is clearly a valid email or phone number.
function classifyContactValue(value) {
    const email = normalizeEmail(value);
    if (email) {
        return { type: 'email', value: email };
    }

    const phone = normalizePhone(value);
    if (phone) {
        return { type: 'phone', value: phone };
    }

    return null;
}

function splitContactValues(values) {
    const emails = [];
    const phones = [];

    for (const value of values || []) {
        const contact = classifyContactValue(value);
        if (!contact) {
            continue;
        }

        if (contact.type === 'email') {
            emails.push(contact.value);
        } else if (contact.type === 'phone') {
            phones.push(contact.value);
        }
    }

    return {
        emails: uniqueTruthy(emails),
        phones: uniqueTruthy(phones)
    };
}

function isLikelyPhoneContext(value) {
    const text = String(value || '');
    return /(?:\+|[\s().-]|tel|phone|mobile|call|whatsapp)/i.test(text);
}

function isValidPhoneDigits(digits) {
    if (digits.length < 8 || digits.length > 15) {
        return false;
    }

    if (/^0+$/.test(digits) || /^(\d)\1{7,}$/.test(digits)) {
        return false;
    }

    if (digits.length >= 8 && /^0{4,}/.test(digits)) {
        return false;
    }

    if (GENERIC_PHONE_BLACKLIST.has(digits)) {
        return false;
    }

    if (/^(19|20)\d{6}$/.test(digits)) {
        return false;
    }

    if (/^(19|20)\d{10,}$/.test(digits)) {
        return false;
    }

    if (/^(?:\d{4})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(digits)) {
        return false;
    }

    return true;
}

function uniqueTruthy(values) {
    return [...new Set(values.filter(Boolean))];
}

function decodeURIComponentSafe(value) {
    try {
        return decodeURIComponent(value);
    } catch (_error) {
        return value;
    }
}

module.exports = {
    classifyContactValue,
    isLikelyPhoneContext,
    isValidEmail,
    isValidPhone,
    normalizeEmail,
    normalizePhone,
    sanitizeEmailList,
    sanitizePhoneList,
    splitContactValues
};
