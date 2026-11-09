import { useState } from 'react';

import { createPrimaryActionStore } from './pagePrimaryActionStore.js';
import { PagePrimaryActionContext } from './pagePrimaryAction.js';

export function PagePrimaryActionProvider({ children }) {
    const [store] = useState(createPrimaryActionStore);
    return (
        <PagePrimaryActionContext.Provider value={store}>
            {children}
        </PagePrimaryActionContext.Provider>
    );
}

export default PagePrimaryActionProvider;
