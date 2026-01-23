import { useEffect } from 'react';

/**
 * Hook to set the page title
 * @param {string} title - The page title (will be appended with " | ServerKit")
 */
export function usePageTitle(title) {
    useEffect(() => {
        const previousTitle = document.title;
        document.title = title ? `${title} | ServerKit` : 'ServerKit';

        return () => {
            document.title = previousTitle;
        };
    }, [title]);
}

export default usePageTitle;
