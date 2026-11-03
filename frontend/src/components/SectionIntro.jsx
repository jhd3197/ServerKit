import InfoTip from './InfoTip';

// One short line with the longer explanation tucked in an (i).
export default function SectionIntro({ children, info, className = '' }) {
    return (
        <p className={`section-intro ${className}`.trim()}>
            <span>{children}</span>
            {info && <InfoTip>{info}</InfoTip>}
        </p>
    );
}
