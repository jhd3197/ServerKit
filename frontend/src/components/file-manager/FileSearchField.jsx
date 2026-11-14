import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

// The Files search box. It searches the server on Enter (not on every
// keystroke: this walks a directory tree), and the clear button also cancels a
// search that is still running. It looks like every other top-bar search
// because it is hosted there; the page falls back to its own toolbar only when
// it is rendered without a top bar.
export default function FileSearchField({ searchQuery, setSearchQuery, handleSearch, searchResults, clearSearch }) {
    const { t } = useTranslation();
    const label = t('app.fileManager.searchFiles', 'Search files…');
    return (
        <div className="sk-searchfield fm-search">
            <Search className="sk-searchfield__icon" aria-hidden="true" />
            <input
                type="text"
                className="sk-searchfield__input"
                placeholder={label}
                aria-label={label}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            {(searchResults || searchQuery) && (
                <Button
                    variant="unstyled"
                    type="button"
                    className="search-field-clear"
                    onClick={clearSearch}
                    title={t('common.actions.clear', 'Clear')}
                    aria-label={t('common.actions.clear', 'Clear')}
                >
                    <X size={12} />
                </Button>
            )}
        </div>
    );
}
