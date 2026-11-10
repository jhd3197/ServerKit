import { useState, useEffect, useId } from 'react';
import api from '../../services/api';
import Modal from '../Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField, FormRow } from '../FormField';
import useFieldErrors from '../../hooks/useFieldErrors';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from 'react-i18next';

const WebhookSubscriptionModal = ({ subscription, onClose, onSubmit }) => {
    const { t } = useTranslation();
    const fieldId = useId();
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [selectedEvents, setSelectedEvents] = useState([]);
    const [retryCount, setRetryCount] = useState(3);
    const [timeoutSeconds, setTimeoutSeconds] = useState(10);
    const [availableEvents, setAvailableEvents] = useState([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getAvailableEvents().then(data => {
            setAvailableEvents(data.events || []);
        }).catch(() => {});

        if (subscription) {
            setName(subscription.name || '');
            setUrl(subscription.url || '');
            setSelectedEvents(subscription.events || []);
            setRetryCount(subscription.retry_count || 3);
            setTimeoutSeconds(subscription.timeout_seconds || 10);
        }
    }, [subscription]);

    const isUrl = (value) => { try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; } };
    const fe = useFieldErrors({
        name: name.trim() ? null : t('common.validation.required', 'This field is required.'),
        url: !url.trim()
            ? t('common.validation.required', 'This field is required.')
            : (isUrl(url.trim()) ? null : t('common.validation.urlInvalid', 'Enter a valid URL, e.g. https://example.com/webhook.')),
        events: selectedEvents.length ? null : t('app.webhookSubscriptionModal.eventsRequired', 'Select at least one event.'),
    }, fieldId);

    const handleEventToggle = (eventType) => {
        setSelectedEvents(prev =>
            prev.includes(eventType)
                ? prev.filter(e => e !== eventType)
                : [...prev, eventType]
        );
    };

    const handleCategoryToggle = (category) => {
        const categoryEvents = availableEvents
            .filter(e => e.category === category)
            .map(e => e.type);
        const allSelected = categoryEvents.every(e => selectedEvents.includes(e));
        if (allSelected) {
            setSelectedEvents(prev => prev.filter(e => !categoryEvents.includes(e)));
        } else {
            setSelectedEvents(prev => [...new Set([...prev, ...categoryEvents])]);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!fe.attempt()) return;
        setSaving(true);
        try {
            await onSubmit({
                name: name.trim(),
                url: url.trim(),
                events: selectedEvents,
                retry_count: retryCount,
                timeout_seconds: timeoutSeconds,
            });
        } finally {
            setSaving(false);
        }
    };

    // Group events by category
    const groupedEvents = availableEvents.reduce((acc, event) => {
        if (!acc[event.category]) acc[event.category] = [];
        acc[event.category].push(event);
        return acc;
    }, {});

    return (
        <Modal open={true} onClose={onClose} title={subscription ? t('app.webhookSubscriptionModal.editSubscription', 'Edit subscription') : t('app.webhookSubscriptionModal.createWebhookSubscription', 'Create webhook subscription')} className="webhook-modal">
                <form onSubmit={handleSubmit} noValidate>
                    <div className="modal-body">
                        <FormField label={t('common.labels.name', 'Name')} htmlFor={`${fieldId}-name`} required error={fe.error('name')}>
                            <Input
                                id={`${fieldId}-name`}
                                type="text"
                                value={name}
                                onChange={e => { fe.clear('name'); setName(e.target.value); }}
                                onBlur={() => fe.touch('name')}
                                placeholder={t('app.webhookSubscriptionModal.eGSlackNotificationsCiTrigger', 'e.g. Slack Notifications, CI Trigger')}
                            />
                        </FormField>

                        <FormField label={t('app.webhookSubscriptionModal.payloadUrl', 'Payload URL')} htmlFor={`${fieldId}-url`} required error={fe.error('url')}>
                            <Input
                                id={`${fieldId}-url`}
                                type="url"
                                value={url}
                                onChange={e => { fe.clear('url'); setUrl(e.target.value); }}
                                onBlur={() => fe.touch('url')}
                                placeholder="https://example.com/webhook"
                            />
                        </FormField>

                        <FormField label={t('app.webhookSubscriptionModal.events', 'Events')} htmlFor={`${fieldId}-events`} required error={fe.error('events')}>
                            <div className="webhook-modal__events" id={`${fieldId}-events`} tabIndex={-1} role="group">
                                {Object.entries(groupedEvents).map(([category, events]) => {
                                    const categoryEvents = events.map(e => e.type);
                                    const allSelected = categoryEvents.every(e => selectedEvents.includes(e));
                                    return (
                                        <div key={category} className="webhook-modal__event-group">
                                            <label className="webhook-modal__category">
                                                <Checkbox
                                                    checked={allSelected}
                                                    onCheckedChange={() => handleCategoryToggle(category)}
                                                />
                                                <strong>{category}</strong>
                                            </label>
                                            <div className="webhook-modal__event-list">
                                                {events.map(event => (
                                                    <label key={event.type} className="webhook-modal__event-item">
                                                        <Checkbox
                                                            checked={selectedEvents.includes(event.type)}
                                                            onCheckedChange={() => handleEventToggle(event.type)}
                                                        />
                                                        <span className="webhook-modal__event-type">{event.type}</span>
                                                        <span className="webhook-modal__event-desc">{event.description}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </FormField>

                        <FormRow>
                            <FormField label={t('app.webhookSubscriptionModal.retryCount', 'Retry count')} htmlFor={`${fieldId}-retry-count`}>
                                <Input
                                    id={`${fieldId}-retry-count`}
                                    type="number"
                                    value={retryCount}
                                    onChange={e => setRetryCount(parseInt(e.target.value) || 3)}
                                    min={0}
                                    max={10}
                                />
                            </FormField>
                            <FormField label={t('app.webhookSubscriptionModal.timeoutSeconds', 'Timeout (seconds)')} htmlFor={`${fieldId}-timeout`}>
                                <Input
                                    id={`${fieldId}-timeout`}
                                    type="number"
                                    value={timeoutSeconds}
                                    onChange={e => setTimeoutSeconds(parseInt(e.target.value) || 10)}
                                    min={1}
                                    max={30}
                                />
                            </FormField>
                        </FormRow>
                    </div>
                    <div className="modal-footer">
                        <Button type="button" variant="outline" onClick={onClose}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button type="submit" variant="default" disabled={saving}>
                            {saving ? t('common.saving', 'Saving…') : (subscription ? t('app.webhookSubscriptionModal.update', 'Update') : t('common.actions.create', 'Create'))}
                        </Button>
                    </div>
                </form>
        </Modal>
    );
};

export default WebhookSubscriptionModal;
