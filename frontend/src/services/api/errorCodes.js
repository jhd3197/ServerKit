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
 * WHY ONLY AUTH CODES SO FAR: plan 76 §C measured 23 sites that pick an HTTP
 * status by grepping their own error prose (`403 if 'denied' in error else
 * 400`). Until those services raise typed errors, translating that prose would
 * turn those 403s into 400s. The auth and onboarding routes carry codes today;
 * the rest waits on plan 76 milestone C rather than shipping a silent status
 * regression.
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
    };
}

export function translateServerError(code, serverMessage) {
    if (!code || typeof code !== 'string') return serverMessage;
    // Built per call, not at module load: a table resolved at import would
    // freeze the language of the session's first paint.
    return translatedServerErrors()[code] ?? serverMessage;
}

export default translateServerError;
