import { Info, ChevronRight } from 'lucide-react';
import InfoTip from './InfoTip';

// 2-4 steps as equal-width pills (icon + short label) joined by chevrons.
// A step with `info` makes its whole pill the tap/hover target for the detail.
// steps = [{ icon: ReactNode, label: string, info?: ReactNode }]
export default function IconStepStrip({ steps, className = '' }) {
    return (
        <ol className={`icon-step-strip ${className}`.trim()}>
            {steps.map((s, i) => {
                const body = (
                    <>
                        <span className="icon-step-strip__icon" aria-hidden="true">{s.icon}</span>
                        <span className="icon-step-strip__label">{s.label}</span>
                    </>
                );
                return (
                    <li className="icon-step-strip__step" key={i}>
                        {i > 0 && <ChevronRight className="icon-step-strip__arrow" aria-hidden="true" />}
                        {s.info ? (
                            <InfoTip
                                className="icon-step-strip__pill icon-step-strip__pill--info"
                                title={s.label}
                                trigger={<>{body}<Info className="icon-step-strip__more" aria-hidden="true" /></>}
                            >
                                {s.info}
                            </InfoTip>
                        ) : (
                            <span className="icon-step-strip__pill">{body}</span>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
