import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import api from '../services/api';
import { t } from '../i18n/t';
import usePageContext from '../hooks/ai/usePageContext';
import {
    addAttachment as appendAttachment,
    applyAttachmentWarning,
    attachmentKey,
    markAttachmentsResolved,
    normalizeAttachment,
    removeAttachment as discardAttachment,
    toAttachmentPayload,
} from '../lib/ai/attachments';

import { AIContext } from './useServerkitAI.js';

const AI_CONFIG_CHANGED_EVENT = 'serverkit:ai-config-changed';

const newId = () => (globalThis.crypto?.randomUUID?.() || `m_${Math.random().toString(36).slice(2)}`);

const initialState = {
    open: false,
    mode: 'assistant',           // 'assistant' (tools + context) | 'simple'
    includeContext: true,
    providerConfigured: false,
    enabled: false,
    profile: '',
    workflow: 'chat',
    statusLoaded: false,
    conversations: [],
    connections: [],
    selectedConnection: '',
    selectedModel: '',
    activeId: null,
    attachments: [],
    messages: [],                // [{ id, role, content, toolCalls, thinking, status, error }]
    isStreaming: false,
    error: null,
    pendingConfirm: null,
    unread: 0,
};

// Mutate the last assistant message (the one currently streaming).
function patchLastAssistant(messages, patch) {
    const next = [...messages];
    for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
            next[i] = typeof patch === 'function' ? patch(next[i]) : { ...next[i], ...patch };
            break;
        }
    }
    return next;
}

function patchLastUser(messages, patch) {
    const next = [...messages];
    for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === 'user') {
            next[i] = typeof patch === 'function' ? patch(next[i]) : { ...next[i], ...patch };
            break;
        }
    }
    return next;
}

function reducer(state, action) {
    switch (action.type) {
        case 'SET_OPEN':
            return { ...state, open: action.open, unread: action.open ? 0 : state.unread };
        case 'TOGGLE_OPEN':
            return { ...state, open: !state.open, unread: !state.open ? 0 : state.unread };
        case 'SET_MODE':
            return { ...state, mode: action.mode };
        case 'SET_INCLUDE_CONTEXT':
            return { ...state, includeContext: action.value };
        case 'SET_STATUS':
            return { ...state, enabled: action.enabled, providerConfigured: action.configured, statusLoaded: true };
        case 'SET_CONNECTIONS': {
            const selected = action.connections.find((connection) => connection.id === state.selectedConnection);
            return { ...state, connections: action.connections, selectedConnection: selected?.id || '',
                selectedModel: selected ? state.selectedModel : '' };
        }
        case 'SELECT_PROFILE':
            return { ...state, profile: action.profile, selectedConnection: '', selectedModel: '' };
        case 'SELECT_WORKFLOW':
            return { ...state, workflow: action.workflow, profile: '', selectedConnection: '', selectedModel: '' };
        case 'RUN_START':
            return { ...state, messages: patchLastAssistant(state.messages, (message) => ({ ...message, selection: action.selection })) };
        case 'SELECT_CONNECTION': {
            const connection = state.connections.find((item) => item.id === action.id);
            return { ...state, selectedConnection: action.id, selectedModel: connection?.model || '' };
        }
        case 'SELECT_MODEL':
            return { ...state, selectedModel: action.model };
        case 'SET_CONVERSATIONS':
            return { ...state, conversations: action.conversations };
        case 'SET_ACTIVE':
            return { ...state, activeId: action.id };
        case 'LOAD_MESSAGES':
            return {
                ...state, messages: action.messages, activeId: action.id,
                attachments: [], pendingConfirm: null, error: null,
            };
        case 'NEW_CONVERSATION':
            return {
                ...state, activeId: null, messages: [], attachments: [],
                pendingConfirm: null, error: null,
            };
        case 'ADD_ATTACHMENT':
            return { ...state, attachments: appendAttachment(state.attachments, action.attachment) };
        case 'REMOVE_ATTACHMENT':
            return { ...state, attachments: discardAttachment(state.attachments, action.key) };
        case 'CLEAR_ATTACHMENTS':
            return { ...state, attachments: [] };
        case 'ADD_USER_MESSAGE':
            return {
                ...state,
                messages: [...state.messages, {
                    id: action.id,
                    role: 'user',
                    content: action.content,
                    attachments: action.attachments || [],
                    status: 'done',
                }],
            };
        case 'BEGIN_ASSISTANT':
            return {
                ...state,
                isStreaming: true,
                error: null,
                messages: [...state.messages, {
                    id: action.id, role: 'assistant', content: '', thinking: '',
                    toolCalls: [], status: 'streaming',
                }],
            };
        case 'APPEND_TEXT':
            return { ...state, messages: patchLastAssistant(state.messages, (m) => ({ ...m, content: m.content + action.text })) };
        case 'APPEND_THINKING':
            return { ...state, messages: patchLastAssistant(state.messages, (m) => ({ ...m, thinking: (m.thinking || '') + action.text })) };
        case 'TOOL_START':
            return {
                ...state,
                messages: patchLastAssistant(state.messages, (m) => ({
                    ...m,
                    toolCalls: [...m.toolCalls, { id: action.id, name: action.name, input: {}, output: null, isError: false, status: 'running' }],
                })),
            };
        case 'TOOL_INPUT_DELTA':
            return {
                ...state,
                messages: patchLastAssistant(state.messages, (m) => ({
                    ...m,
                    toolCalls: m.toolCalls.map((tc) => (tc.id === action.id
                        ? { ...tc, inputRaw: (tc.inputRaw || '') + action.fragment } : tc)),
                })),
            };
        case 'TOOL_STOP':
            return {
                ...state,
                messages: patchLastAssistant(state.messages, (m) => ({
                    ...m,
                    toolCalls: m.toolCalls.map((tc) => (tc.id === action.id
                        ? { ...tc, input: action.input || tc.input, name: action.name || tc.name } : tc)),
                })),
            };
        case 'TOOL_RESULT':
            return {
                ...state,
                messages: patchLastAssistant(state.messages, (m) => ({
                    ...m,
                    toolCalls: m.toolCalls.map((tc) => (tc.id === action.id
                        ? { ...tc, output: action.output, isError: action.isError, status: action.isError ? 'error' : 'done' } : tc)),
                })),
            };
        case 'SET_PENDING_CONFIRM':
            return { ...state, pendingConfirm: action.payload };
        case 'ATTACHMENT_WARNING':
            return {
                ...state,
                messages: patchLastUser(state.messages, (message) => ({
                    ...message,
                    attachments: applyAttachmentWarning(message.attachments || [], action.warning),
                })),
            };
        case 'CLEAR_PENDING_CONFIRM':
            return { ...state, pendingConfirm: null };
        case 'TURN_DONE':
            return {
                ...state,
                isStreaming: false,
                activeId: action.conversationId || state.activeId,
                unread: state.open ? 0 : state.unread + 1,
                messages: patchLastAssistant(
                    patchLastUser(state.messages, (message) => ({
                        ...message,
                        attachments: markAttachmentsResolved(message.attachments || []),
                    })),
                    (message) => ({
                        ...message,
                        status: message.status === 'streaming' ? 'done' : message.status,
                        usage: action.usage || message.usage,
                    }),
                ),
            };
        case 'SET_ERROR':
            return {
                ...state,
                isStreaming: false,
                error: action.message,
                messages: patchLastAssistant(state.messages, (m) => (
                    m.status === 'streaming' ? { ...m, status: 'error', error: action.message } : m
                )),
            };
        case 'SET_STREAMING':
            return { ...state, isStreaming: action.value };
        default:
            return state;
    }
}

export function AIProvider({ children }) {
    const [state, dispatch] = useReducer(reducer, initialState);
    const pageContext = usePageContext();

    const abortRef = useRef(null);
    const activeIdRef = useRef(null);
    const contextProviders = useRef(new Map());   // routePattern -> fn
    const toolRenderers = useRef(new Map());       // toolName -> Component

    useEffect(() => { activeIdRef.current = state.activeId; }, [state.activeId]);

    // --- status ---
    const loadStatus = useCallback(() => {
        api.aiGetConnections()
            .then((data) => dispatch({ type: 'SET_CONNECTIONS', connections: data.connections || [], defaultId: data.default_connection_id }))
            .catch(() => {});
        api.aiStatus()
            .then((s) => dispatch({ type: 'SET_STATUS', enabled: !!s.enabled, configured: !!s.enabled && !!s.configured }))
            .catch(() => dispatch({ type: 'SET_STATUS', enabled: false, configured: false }));
    }, []);

    useEffect(() => {
        loadStatus();
        const onChanged = () => loadStatus();
        window.addEventListener(AI_CONFIG_CHANGED_EVENT, onChanged);
        return () => window.removeEventListener(AI_CONFIG_CHANGED_EVENT, onChanged);
    }, [loadStatus]);

    // --- conversations ---
    const loadConversations = useCallback(() => {
        api.aiListConversations()
            .then((d) => dispatch({ type: 'SET_CONVERSATIONS', conversations: d.conversations || [] }))
            .catch(() => {});
    }, []);

    const switchConversation = useCallback(async (id) => {
        try {
            const data = await api.aiGetConversation(id);
            const messages = (data.messages || []).map((m) => ({
                id: `srv_${m.id}`,
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content || '',
                usage: m.usage,
                attachments: (m.attachments || []).map(normalizeAttachment).filter(Boolean),
                toolCalls: (m.tool_calls || []).map((tc) => ({
                    id: tc.id, name: tc.name, input: tc.input, output: tc.output,
                    isError: tc.is_error, status: tc.is_error ? 'error' : 'done',
                })),
                status: 'done',
            })).filter((m) => m.role === 'user' || m.content || m.toolCalls.length);
            dispatch({ type: 'LOAD_MESSAGES', messages, id });
        } catch { /* ignore */ }
    }, []);

    const newConversation = useCallback(() => dispatch({ type: 'NEW_CONVERSATION' }), []);

    const deleteConversation = useCallback(async (id) => {
        try { await api.aiDeleteConversation(id); } catch { /* ignore */ }
        if (activeIdRef.current === id) dispatch({ type: 'NEW_CONVERSATION' });
        loadConversations();
    }, [loadConversations]);

    // --- page context assembly (core + plugin providers + caller extra) ---
    const buildPageContext = useCallback((extra) => {
        const ctx = { route: pageContext.route, label: pageContext.label, ids: { ...pageContext.ids } };
        for (const [pattern, fn] of contextProviders.current.entries()) {
            try {
                if (matchRoute(pattern, pageContext.route)) {
                    const provided = fn();
                    if (provided && typeof provided === 'object') Object.assign(ctx, provided);
                }
            } catch { /* ignore provider errors */ }
        }
        if (extra && typeof extra === 'object') Object.assign(ctx, extra);
        return ctx;
    }, [pageContext]);

    // --- SSE event handling ---
    const handleEvent = useCallback(({ event, data }) => {
        switch (event) {
            case 'open':
                if (data.conversation_id) { activeIdRef.current = data.conversation_id; dispatch({ type: 'SET_ACTIVE', id: data.conversation_id }); }
                break;
            case 'text_delta': dispatch({ type: 'APPEND_TEXT', text: data.text || '' }); break;
            case 'thinking_delta': dispatch({ type: 'APPEND_THINKING', text: data.text || '' }); break;
            case 'tool_use_start': dispatch({ type: 'TOOL_START', id: data.id, name: data.name }); break;
            case 'tool_input_delta': dispatch({ type: 'TOOL_INPUT_DELTA', id: data.id, fragment: data.fragment || '' }); break;
            case 'tool_use_stop': dispatch({ type: 'TOOL_STOP', id: data.id, name: data.name, input: data.input }); break;
            case 'tool_result': dispatch({ type: 'TOOL_RESULT', id: data.id, output: data.output, isError: !!data.is_error }); break;
            case 'pending_action': dispatch({ type: 'SET_PENDING_CONFIRM', payload: data }); break;
            case 'attachment_warning': dispatch({ type: 'ATTACHMENT_WARNING', warning: data }); break;
            case 'error': dispatch({ type: 'SET_ERROR', message: data.message || t('app.aiContext.assistantError', 'The assistant hit an error.') }); break;
            case 'run_start': dispatch({ type: 'RUN_START', selection: data }); break;
            case 'done': dispatch({ type: 'TURN_DONE', conversationId: data.conversation_id, usage: data.usage }); break;
            default: break;
        }
    }, []);

    // --- send a message ---
    const send = useCallback(async (prompt, opts = {}) => {
        const text = (prompt || '').trim();
        if (!text || state.isStreaming || !state.providerConfigured) return;
        const mode = opts.mode || state.mode;
        const requestedAttachments = (opts.attachments || []).reduce(
            (items, attachment) => appendAttachment(items, attachment),
            state.attachments,
        );
        const payload = {
            conversation_id: activeIdRef.current || undefined,
            message: text,
            mode,
            connection_id: activeIdRef.current ? undefined : state.selectedConnection || undefined,
            model: activeIdRef.current ? undefined : state.selectedModel || undefined,
            profile: activeIdRef.current ? undefined : opts.profile || state.profile || undefined,
            workflow: activeIdRef.current ? undefined : opts.workflow || state.workflow,
        };
        if (requestedAttachments.length) {
            payload.attachments = requestedAttachments.map(toAttachmentPayload).filter(Boolean);
        }
        if (mode === 'assistant' && state.includeContext) {
            payload.page_context = buildPageContext(opts.context);
        } else if (opts.context) {
            payload.page_context = opts.context;
        }

        dispatch({
            type: 'ADD_USER_MESSAGE',
            id: newId(),
            content: text,
            attachments: requestedAttachments,
        });
        dispatch({ type: 'CLEAR_ATTACHMENTS' });
        dispatch({ type: 'BEGIN_ASSISTANT', id: newId() });

        const controller = new AbortController();
        abortRef.current = controller;
        try {
            await api.aiStreamChat(payload, { signal: controller.signal, onEvent: handleEvent });
        } catch (e) {
            if (e.name !== 'AbortError') {
                dispatch({ type: 'SET_ERROR', message: e.message || t('app.aiContext.requestFailed', "Couldn't reach the assistant.") });
            } else {
                dispatch({ type: 'SET_STREAMING', value: false });
            }
        } finally {
            abortRef.current = null;
            loadConversations();
        }
    }, [
        state.isStreaming, state.providerConfigured, state.mode, state.includeContext, state.attachments,
        state.selectedConnection, state.selectedModel,
        state.profile, state.workflow,
        buildPageContext, handleEvent, loadConversations,
    ]);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        const id = activeIdRef.current;
        if (id) api.aiCancel(id).catch(() => {});
        dispatch({ type: 'CLEAR_PENDING_CONFIRM' });
    }, []);

    const confirmAction = useCallback(async (decision) => {
        const pending = state.pendingConfirm;
        if (!pending) return;
        dispatch({ type: 'CLEAR_PENDING_CONFIRM' });
        try {
            await api.aiConfirmAction({
                conversation_id: activeIdRef.current,
                action_token: pending.action_token,
                decision,
            });
            // The worker resumes on the SAME open stream — no new request needed.
        } catch (e) {
            dispatch({ type: 'SET_ERROR', message: e.message || t('app.aiContext.decisionFailed', "Couldn't submit your decision.") });
        }
    }, [state.pendingConfirm]);

    // --- imperative controls ---
    const open = useCallback((prompt, opts) => {
        dispatch({ type: 'SET_OPEN', open: true });
        if (!state.conversations.length) loadConversations();
        if (prompt) setTimeout(() => send(prompt, opts), 0);
    }, [send, loadConversations, state.conversations.length]);

    const close = useCallback(() => dispatch({ type: 'SET_OPEN', open: false }), []);
    const toggle = useCallback(() => {
        dispatch({ type: 'TOGGLE_OPEN' });
        if (!state.open && !state.conversations.length) loadConversations();
    }, [state.open, state.conversations.length, loadConversations]);

    const ask = useCallback((prompt, opts = {}) => {
        if (opts.open !== false) dispatch({ type: 'SET_OPEN', open: true });
        if (opts.mode) dispatch({ type: 'SET_MODE', mode: opts.mode });
        send(prompt, opts);
    }, [send]);

    const setMode = useCallback((mode) => dispatch({ type: 'SET_MODE', mode }), []);
    const setIncludeContext = useCallback((value) => dispatch({ type: 'SET_INCLUDE_CONTEXT', value }), []);
    const addAttachment = useCallback((attachment, options = {}) => {
        dispatch({ type: 'ADD_ATTACHMENT', attachment });
        if (options.open !== false) dispatch({ type: 'SET_OPEN', open: true });
    }, []);
    const removeAttachment = useCallback((attachment) => {
        const key = typeof attachment === 'string' ? attachment : attachmentKey(attachment);
        dispatch({ type: 'REMOVE_ATTACHMENT', key });
    }, []);

    // --- plugin registries (returned to plugin components via useServerkitAI) ---
    const registerContextProvider = useCallback((routePattern, fn) => {
        contextProviders.current.set(routePattern, fn);
        return () => contextProviders.current.delete(routePattern);
    }, []);
    const registerToolRenderer = useCallback((toolName, Component) => {
        toolRenderers.current.set(toolName, Component);
        return () => toolRenderers.current.delete(toolName);
    }, []);
    const getToolRenderer = useCallback((toolName) => toolRenderers.current.get(toolName) || null, []);

    const value = useMemo(() => ({
        // state
        ...state,
        isOpen: state.open,
        selectConnection: (id) => dispatch({ type: 'SELECT_CONNECTION', id }),
        selectModel: (model) => dispatch({ type: 'SELECT_MODEL', model }),
        selectProfile: (profile) => dispatch({ type: 'SELECT_PROFILE', profile }),
        selectWorkflow: (workflow) => dispatch({ type: 'SELECT_WORKFLOW', workflow }),
        pageContext,
        // controls
        open, close, toggle, ask, send, stop, confirmAction, setMode, setIncludeContext,
        addAttachment, removeAttachment,
        loadConversations, switchConversation, newConversation, deleteConversation, loadStatus,
        // plugin SDK surface
        registerContextProvider, registerToolRenderer, getToolRenderer,
    }), [
        state, pageContext, open, close, toggle, ask, send, stop, confirmAction, setMode,
        setIncludeContext, addAttachment, removeAttachment,
        loadConversations, switchConversation, newConversation,
        deleteConversation, loadStatus, registerContextProvider, registerToolRenderer, getToolRenderer,
    ]);

    return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

function matchRoute(pattern, route) {
    if (!pattern || !route) return false;
    if (pattern === route) return true;
    if (pattern.endsWith('/*')) return route.startsWith(pattern.slice(0, -1));
    if (pattern.endsWith('*')) return route.startsWith(pattern.slice(0, -1));
    return route === pattern || route.startsWith(`${pattern}/`);
}
