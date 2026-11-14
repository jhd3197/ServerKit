// Normalise a logs API response into displayable text.
//
// The two log paths return different shapes and always have: a local Docker app
// answers with the standard multi-source envelope (`lines[]`, `source`,
// `source_label` — see backend `sourced_result`), while a remote one comes back
// from the agent as a single `logs` string. Readers that only knew about `logs`
// showed "No logs available" for every local app no matter how much output
// there was, because the field they checked simply is not in that response.
//
// Returns '' when there is genuinely nothing, so callers can tell empty output
// apart from a failed request.
export function logsToText(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (typeof data.logs === 'string' && data.logs) return data.logs;
    if (Array.isArray(data.lines)) {
        return data.lines
            // A trailing '' from splitting on \n is noise, but blank lines in
            // the middle of the output are real and worth keeping.
            .filter((line, i, all) => line !== '' || (i > 0 && i < all.length - 1))
            .join('\n');
    }
    return '';
}
