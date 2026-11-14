import InfoTip from './InfoTip';
import IconStepStrip from './IconStepStrip';

// One short line with the longer explanation tucked in an (i). With `icon`
// and/or `steps` it becomes a compact card banner: icon tile + title + (i),
// then the IconStepStrip (one row on desktop, two on mobile).
export default function SectionIntro({ children, info, icon, steps, className = '' }) {
    if (!icon && !steps) {
        return (
            <p className={`section-intro ${className}`.trim()}>
                <span>{children}</span>
                {info && <InfoTip>{info}</InfoTip>}
            </p>
        );
    }
    return (
        <div className={`section-intro section-intro--banner ${className}`.trim()}>
            <div className="section-intro__head">
                {icon && <span className="section-intro__icon" aria-hidden="true">{icon}</span>}
                <span className="section-intro__title">{children}</span>
                {info && <InfoTip title={children}>{info}</InfoTip>}
            </div>
            {steps && <IconStepStrip steps={steps} />}
        </div>
    );
}
