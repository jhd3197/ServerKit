import { t } from '../../i18n/t.js';

/**
 * Translate a server error by its machine code (plan 79 F1).
 *
 * The problem: 257 render sites do `toast.error(err.message)`, showing a
 * string the backend authored in English. There is no key to translate
 * against, and the frontend cannot invent one — the same prose comes from
 * several routes and a route can change its wording.
 *
 * The backend already answers this. Plan 76 milestone B's typed-error door
 * (`app/exceptions.py` + the global handler) emits a stable body:
 *
 *     { "error": "Invalid username/email or password",
 *       "status": 401, "code": "auth.invalid_credentials", "request_id": "…" }
 *
 * so this maps `code` to a key, once, in the client.
 *
 * WHY A LITERAL REGISTRY RATHER THAN `t('errors.' + code)`: a computed key is
 * invisible to the extractor, so it would never appear in en.json and a
 * translator would have no way to discover that the string exists. The table
 * below is the list of server errors we have actually translated; anything
 * else falls through to the server's English, which is exactly today's
 * behaviour.
 *
 * WHICH CODES: plan 76 §C's 23 status-from-prose sites are gone (the status
 * sniffing ratchet is at 0), so translating a message can no longer change a
 * status. Beyond auth, plan 88 §C added the common families, each minted by a
 * factory in `backend/app/exceptions.py` with ONE fixed message per code:
 *
 *     not_found.<resource>   "<Resource> not found"
 *     validation.required    "<field> is required"        (details.field)
 *     permission.denied      generic "no permission" text
 *     conflict.exists        "<Resource> already exists"  (details.resource)
 *     agent.offline          the agent is not connected
 *
 * A code is only listed here when its message is fixed. The class defaults
 * (`not_found`, `validation_error`, `permission_denied`, `conflict`) carry
 * per-call prose, so they deliberately stay untranslated: swapping them for a
 * generic sentence would drop the specifics the server wrote.
 *
 * `details` (the body's `details` object) fills the two codes whose message
 * names something. Without it they fall back to the server's English, so a
 * caller that passes only (code, message) keeps today's behaviour.
 */
function translatedServerErrors() {
    return {
        'auth.invalid_credentials': t(
            'errors.auth.invalidCredentials', 'Invalid username/email or password'),
        'auth.account_deactivated': t(
            'errors.auth.accountDeactivated', 'Account is deactivated'),
        'auth.registration_disabled': t(
            'errors.auth.registrationDisabled', 'Registration is disabled'),
        'auth.password_login_disabled': t(
            'errors.auth.passwordLoginDisabled', 'Password sign-in is disabled. Please use SSO.'),
        'auth.missing_credentials': t(
            'errors.auth.missingCredentials', 'Missing email/username or password'),
        'auth.missing_fields': t(
            'errors.auth.missingFields', 'Missing required fields'),
        'auth.password_too_short': t(
            'errors.auth.passwordTooShort', 'Password must be at least 8 characters'),
        'auth.identity_unavailable': t(
            'errors.auth.identityUnavailable', 'This email or username is unavailable'),
        'auth.username_taken': t(
            'errors.auth.usernameTaken', 'Username already taken'),
        'auth.email_registered': t(
            'errors.auth.emailRegistered', 'Email already registered'),
        'auth.invitation_invalid': t(
            'errors.auth.invitationInvalid', 'Invalid or expired invitation'),
        'auth.link_invalid': t(
            'errors.auth.linkInvalid', 'Invalid or expired link'),

        // One literal per resource kind, so each is a key a translator can see
        // (and so a language with grammatical gender can agree per noun).
        'not_found.service': t('errors.notFound.service', 'Service not found'),
        'not_found.server': t('errors.notFound.server', 'Server not found'),
        'not_found.domain': t('errors.notFound.domain', 'Domain not found'),
        'not_found.database': t('errors.notFound.database', 'Database not found'),
        'not_found.backup': t('errors.notFound.backup', 'Backup not found'),
        'not_found.snapshot': t('errors.notFound.snapshot', 'Snapshot not found'),
        'not_found.config_checkpoint': t(
            'errors.notFound.configCheckpoint', 'Config checkpoint not found'),
        'not_found.deployment': t('errors.notFound.deployment', 'Deployment not found'),
        'not_found.template': t('errors.notFound.template', 'Template not found'),
        'not_found.user': t('errors.notFound.user', 'User not found'),

        'permission.denied': t(
            'errors.permission.denied',
            "You don't have permission to do this. Ask an admin for access."),

        'agent.offline': agentOffline(),
        // The agent dispatcher's own result code. Command results reach the
        // client verbatim on some routes, and its meaning is the same.
        AGENT_OFFLINE: agentOffline(),
    };
}

function agentOffline() {
    return t(
        'errors.agent.offline',
        "The server's agent is offline. Start the agent on that server, then try again.");
}

/** Codes whose message names something carried in the body's `details`. */
function detailedServerError(code, details) {
    if (!details || typeof details !== 'object') return undefined;
    if (code === 'validation.required' && typeof details.field === 'string') {
        return t('errors.validation.required', '{{field}} is required', { field: details.field });
    }
    if (code === 'conflict.exists') {
        const exists = {
            domain: t('errors.conflict.domainExists', 'Domain already exists'),
        };
        return exists[details.resource];
    }
    return undefined;
}

export function translateServerError(code, serverMessage, details) {
    if (!code || typeof code !== 'string') return serverMessage;
    // Built per call, not at module load: a table resolved at import would
    // freeze the language of the session's first paint.
    return translatedServerErrors()[code]
        ?? detailedServerError(code, details)
        ?? serverMessage;
}

export default translateServerError;
