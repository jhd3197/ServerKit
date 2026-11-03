import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import InfoTip from './InfoTip';

// 2-4 steps: icon tile, a short label and an optional (i) with the detail.
// steps = [{ icon: ReactNode, label: string, info?: ReactNode }]
export default function IconStepStrip({ steps, className = '' }) {
    return (
        <ol className={`icon-step-strip ${className}`.trim()}>
            {steps.map((s, i) => (
                <Fragment key={i}>
                    {i > 0 && <li className="icon-step-strip__arrow" aria-hidden="true"><ChevronRight /></li>}
                    <li className="icon-step-strip__step">
                        <span className="icon-step-strip__tile" aria-hidden="true">{s.icon}</span>
                        <span className="icon-step-strip__label">{s.label}</span>
                        {s.info && <InfoTip>{s.info}</InfoTip>}
                    </li>
                </Fragment>
            ))}
        </ol>
    );
}
