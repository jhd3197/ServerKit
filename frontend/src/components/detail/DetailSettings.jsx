import { Button } from '@/components/ui/button';

// The settings shell every entity detail page shares (services, servers):
// a grouped section nav on the left, the active section's panels on the right.
// Pages keep their own sections, URL state, permissions and mutation handlers.
//
//   groups: [{ label, items: [{ id, label, icon }] }]
export function DetailSettings({ groups, value, onValueChange, ariaLabel, children }) {
    return (
        <div className="sk-detail-settings">
            <nav className="sk-detail-settings__nav" aria-label={ariaLabel}>
                {groups.map((group) => (
                    <div className="sk-detail-settings__group" key={group.label}>
                        <div className="sk-detail-settings__grouplabel">{group.label}</div>
                        {group.items.map(({ id, label, icon: Icon }) => (
                            <Button
                                variant="unstyled"
                                type="button"
                                key={id}
                                className={`sk-detail-settings__navitem ${value === id ? 'is-active' : ''}`}
                                aria-current={value === id ? 'page' : undefined}
                                onClick={() => onValueChange(id)}
                            >
                                <Icon size={15} aria-hidden="true" />
                                {label}
                            </Button>
                        ))}
                    </div>
                ))}
            </nav>
            <div className="sk-detail-settings__content">{children}</div>
        </div>
    );
}

// One section of the content column: a quiet title above its panel(s).
export function DetailSettingsSection({ title, children }) {
    return (
        <div className="sk-detail-settings__section">
            <h3 className="sk-detail-settings__section-title">{title}</h3>
            {children}
        </div>
    );
}
