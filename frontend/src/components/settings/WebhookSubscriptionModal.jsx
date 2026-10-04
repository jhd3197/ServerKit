import { useState, useEffect } from 'react';
import api from '../../services/api';
import Modal from '../Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from 'react-i18next';

const WebhookSubscriptionModal = ({ subscription, onClose, onSubmit }) => {
    const { t } = useTranslation();
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
        if (!name.trim() || !url.trim() || selectedEvents.length === 0) return;
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
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div className="form-group">
                            <Label>{t('common.labels.name', 'Name')}</Label>
                            <Input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder={t('app.webhookSubscriptionModal.eGSlackNotificationsCiTrigger', 'e.g. Slack Notifications, CI Trigger')}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <Label>{t('app.webhookSubscriptionModal.payloadUrl', 'Payload URL')}</Label>
                            <Input
                                type="url"
                                value={url}
                                onChange={e => setUrl(e.target.value)}
                                placeholder="https://example.com/webhook"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <Label>{t('app.webhookSubscriptionModal.events', 'Events')}</Label>
                            <div className="webhook-modal__events">
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
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <Label>{t('app.webhookSubscriptionModal.retryCount', 'Retry count')}</Label>
                                <Input
                                    type="number"
                                    value={retryCount}
                                    onChange={e => setRetryCount(parseInt(e.target.value) || 3)}
                                    min={0}
                                    max={10}
                                />
                            </div>
                            <div className="form-group">
                                <Label>{t('app.webhookSubscriptionModal.timeoutSeconds', 'Timeout (seconds)')}</Label>
                                <Input
                                    type="number"
                                    value={timeoutSeconds}
                                    onChange={e => setTimeoutSeconds(parseInt(e.target.value) || 10)}
                                    min={1}
                                    max={30}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <Button type="button" variant="outline" onClick={onClose}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button
                            type="submit"
                            variant="default"
                            disabled={saving || !name.trim() || !url.trim() || selectedEvents.length === 0}
                        >
                            {saving ? 'Saving...' : (subscription ? 'Update' : 'Create')}
                        </Button>
                    </div>
                </form>
        </Modal>
    );
};

export default WebhookSubscriptionModal;
