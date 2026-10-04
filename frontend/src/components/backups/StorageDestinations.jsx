import { Activity, Archive, Cloud, HardDrive, Plus } from 'lucide-react';
import { formatBytes } from '@/utils/formatBytes';
import { Pill } from '@/components/ds';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

const PROVIDER_META = {
    s3: { name: 'S3-compatible', type: 'Object storage', icon: Cloud },
    b2: { name: 'Backblaze B2', type: 'Object storage', icon: Cloud },
};

// Where the archive can land, as a card per destination — the design mock's
// Storage section. Local disk is always present (it is where a backup is
// written before anything is uploaded); a configured remote joins it and takes
// the PRIMARY badge, because that is the copy that survives losing the box.
export default function StorageDestinations({
    stats, storageConfig, costSummary, onTest, onBrowse, onAdd, testing,
}) {
    const { t } = useTranslation();
    const provider = storageConfig?.provider || 'local';
    const rates = costSummary?.cost_rates || {};
    const remote = PROVIDER_META[provider];

    const cards = [];

    if (remote) {
        const bytes = stats?.remote_size || 0;
        cards.push({
            key: provider,
            icon: remote.icon,
            name: remote.name,
            type: remote.type,
            primary: true,
            connected: true,
            bytes,
            quota: null,
            cost: (bytes / 1024 ** 3) * (rates[provider] || 0),
            rows: [
                ['Bucket', storageConfig?.[provider]?.bucket || '—'],
                provider === 's3' ? ['Region', storageConfig?.s3?.region || '—'] : null,
                ['Path prefix', storageConfig?.[provider]?.path_prefix || '—'],
                ['Auto-upload', storageConfig?.auto_upload ? 'on' : 'off'],
            ].filter(Boolean),
            testable: true,
        });
    }

    const localBytes = stats?.total_size || 0;
    cards.push({
        key: 'local',
        icon: HardDrive,
        name: 'Local disk',
        type: 'On this server',
        primary: !remote,
        connected: true,
        bytes: localBytes,
        quota: null,
        cost: (localBytes / 1024 ** 3) * (rates.local || 0),
        rows: [
            ['Snapshots', String(stats?.total_backups || 0)],
            ['Kept after upload', storageConfig?.keep_local_copy === false ? 'no' : 'yes'],
        ],
        testable: false,
    });

    const peak = Math.max(...cards.map((c) => c.bytes), 1);

    return (
        <div className="bk-dests">
            {cards.map((card) => {
                const Icon = card.icon;
                return (
                    <article key={card.key} className={`bk-destcard${card.primary ? ' is-primary' : ''}`}>
                        <div className="bk-destcard__head">
                            <span className="bk-destcard__ico"><Icon size={19} /></span>
                            <div className="bk-destcard__id">
                                <div className="bk-destcard__name">
                                    {card.name}
                                    {card.primary && <span className="bk-dest__tag">PRIMARY</span>}
                                </div>
                                <div className="bk-destcard__type">{card.type}</div>
                            </div>
                            <Pill kind={card.connected ? 'green' : 'gray'}>
                                {card.connected ? 'connected' : 'not set up'}
                            </Pill>
                        </div>

                        <div className={`bk-dest__bar bk-dest__bar--${card.key === 'local' ? 'local' : 'remote'}`}>
                            <i style={{ width: `${Math.max(2, (card.bytes / peak) * 100)}%` }} />
                        </div>
                        <div className="bk-destcard__usage">
                            <span>{formatBytes(card.bytes, { defaultValue: '0 B' })} stored</span>
                            <span>{card.cost > 0 ? `$${card.cost.toFixed(2)}/mo` : 'no charge'}</span>
                        </div>

                        <dl className="bk-destcard__rows">
                            {card.rows.map(([k, v]) => (
                                <div key={k}>
                                    <dt>{k}</dt>
                                    <dd>{v}</dd>
                                </div>
                            ))}
                        </dl>

                        <div className="bk-destcard__actions">
                            {card.testable && (
                                <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
                                    <Activity size={14} /> {testing ? 'Testing…' : 'Test'}
                                </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={onBrowse}>
                                <Archive size={14} /> {t('app.storageDestinations.snapshots', 'Backups')}
                            </Button>
                        </div>
                    </article>
                );
            })}

            {/* Only one remote can be active at a time, so this reveals the
                configuration form below rather than adding a second card. */}
            <Button variant="unstyled" type="button" className="bk-destcard bk-destcard--add" onClick={onAdd}>
                <Plus size={24} />
                <span>{remote ? 'Change destination' : 'Add destination'}</span>
            </Button>
        </div>
    );
}
