import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { SegControl } from '@/components/ds';
import { getCategoryIcon, titleCase } from './extensionCatalog';

// Scrollable category chips (fade edges come from SegControl's sk-tabscroll).
export default function CategoryChips({ categories, value, onChange }) {
    const { t } = useTranslation();
    const options = [
        { value: '', label: t('app.marketplace.all', 'All'), icon: <Package size={14} aria-hidden="true" /> },
        ...categories.map((c) => {
            const Icon = getCategoryIcon(c);
            return { value: c, label: titleCase(c), icon: <Icon size={14} aria-hidden="true" /> };
        }),
    ];
    return (
        <SegControl
            className="marketplace-chips"
            aria-label={t('app.marketplace.categories', 'Categories')}
            options={options}
            value={value}
            onChange={onChange}
        />
    );
}
