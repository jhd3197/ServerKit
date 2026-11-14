import InfoTip from '@/components/InfoTip';
import { StatusDot } from '@/components/ds';

// The top-bar meta every entity detail page shares (services, servers):
// [status dot] [(i) with the facts the header used to spell out] [star].
// Anything page-specific (an "open" link) rides along as children.
//
//   status: { kind, label }           kind = Pill vocabulary
//   rows:   [{ label, value }]         falsy values are skipped
export default function DetailHeaderMeta({ status, infoTitle, rows, favorite, children }) {
    return (
        <>
            <StatusDot kind={status.kind} label={status.label} />
            <InfoTip size="md" title={infoTitle}>
                <dl className="sk-detail-info">
                    {rows.filter((row) => row.value).map((row) => (
                        <div className="sk-detail-info__row" key={row.label}>
                            <dt>{row.label}</dt>
                            <dd>{row.value}</dd>
                        </div>
                    ))}
                </dl>
            </InfoTip>
            {favorite}
            {children}
        </>
    );
}
