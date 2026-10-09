import { t } from '../i18n/t.js';

/**
 * One door for error copy: "what failed" + "why" (+ "what to do").
 *
 *     toastError(toast, t('app.domains.deleteFailed', "Couldn't delete the domain."), err);
 *     // -> "Couldn't delete the domain. Domain is still attached to a service."
 *
 * The call site owns the first half (what failed, in the user's language);
 * the server owns the second (why). Before this, ~65 catch sites showed only
 * the first half and ~200 showed only the second (`err.message || t(...)`),
 * so a toast either said "Couldn't save" with no reason or "Not found" with no
 * subject.
 *
 * `errorReason` reads the reason from whatever the caller caught:
 *
 *   - an ApiClient error (services/api/client.js) — `err.message` is already
 *     translated when the server sent a known `code`, so it wins then;
 *     otherwise `err.data.error`, `err.data.message`, `err.message`;
 *   - a `{ success: false, error }` result object some services return;
 *   - a bare string.
 *
 * Generic transport text ("Request failed (500): /api/…", "Failed to fetch",
 * "Network Error") is dropped when a better source exists, and otherwise
 * replaced with a sentence that says what to do next.
 */

const NETWORK_ERROR = /^(failed to fetch|network ?error|networkerror when attempting to fetch resource\.?|load failed|the network connection was lost\.?)$/i;
const REQUEST_FAILED = /^Request failed \((\d{3})\)/;

function clean(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function isGeneric(text) {
    return NETWORK_ERROR.test(text) || REQUEST_FAILED.test(text);
}

/** A next step for a reason that names only the transport failure. */
function genericReason(text, status) {
    if (NETWORK_ERROR.test(text)) {
        return t('common.error.network',
            "The panel server didn't respond. Check your connection and that the server is running.");
    }
    const code = Number(status) || Number(REQUEST_FAILED.exec(text)?.[1]) || 0;
    if (code === 401) return t('common.error.unauthorized', 'Your session ended. Sign in again.');
    if (code === 403) return t('common.error.forbidden', "You don't have permission to do this.");
    if (code === 404) return t('common.error.notFound', "It doesn't exist anymore. Refresh the page.");
    if (code === 408 || code === 504) {
        return t('common.error.timeout', 'The server took too long to answer. Try again.');
    }
    if (code >= 500) {
        return t('common.error.server', 'The server hit an error. Try again, or check the server logs.');
    }
    return text;
}

/**
 * The server's reason for a failure, as one display string ('' if none).
 *
 * @param {unknown} err  an Error from the API client, a result object, or a string
 * @returns {string}
 */
export function errorReason(err) {
    if (err == null) return '';
    if (typeof err === 'string') {
        const text = clean(err);
        return isGeneric(text) ? genericReason(text) : text;
    }
    if (typeof err !== 'object') return '';

    const data = err.data && typeof err.data === 'object' ? err.data : null;
    const responseData = err.response?.data && typeof err.response.data === 'object'
        ? err.response.data : null;
    const message = clean(err.message);

    const candidates = [
        // A translated `code` beats the server's English (client.js sets
        // err.message from translateServerError).
        err.code && message && data && message !== clean(data.error) ? message : '',
        clean(data?.error),
        clean(data?.message),
        clean(responseData?.error),
        clean(responseData?.message),
        typeof err.error === 'string' ? clean(err.error) : '',
        message,
    ].filter(Boolean);

    const specific = candidates.find((text) => !isGeneric(text));
    if (specific) return specific;
    if (candidates.length) return genericReason(candidates[0], err.status ?? err.response?.status);
    if (err.status) return genericReason('', err.status);
    return '';
}

function withStop(text) {
    return /[.!?…:)]$/.test(text) ? text : `${text}.`;
}

/**
 * "What failed" + "why" as one sentence pair.
 *
 * @param {string} message  what failed, e.g. "Couldn't delete the domain."
 * @param {unknown} err     whatever was caught (see errorReason)
 * @returns {string}
 */
export function errorText(message, err) {
    const head = clean(message);
    const reason = errorReason(err);
    if (!reason) return head;
    if (!head) return withStop(reason);
    // A caller that already folded the reason into its own message.
    if (head.includes(reason)) return head;
    return `${withStop(head)} ${withStop(reason)}`;
}

/**
 * Toast a failure with its reason.
 *
 * @param {{ error: Function } | Function} toast  the useToast() value, or its
 *        `error` method (pages that keep `toast.error` in a stable const for
 *        hook dependency lists)
 * @param {string} message  what failed, e.g. "Couldn't delete the domain."
 * @param {unknown} err     whatever was caught
 * @param {object|number} [opts]  passed through to toast.error
 */
export function toastError(toast, message, err, opts) {
    const show = typeof toast === 'function' ? toast : toast.error;
    return show(errorText(message, err), opts);
}

export default errorReason;
