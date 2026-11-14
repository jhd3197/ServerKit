import { SearchField } from './SearchField';

// The top-bar controls of a list page, in the one order every page uses:
//
//   [secondary …] [primary] [search]
//
//   secondary  buttons that reload or import (Sync, Import) — outline, small
//   primary    the page's create button, a <PagePrimaryButton>
//   search     { value, onSearch, placeholder } for the page's search box
//
// Nothing else belongs in the bar. Filters, fields, export and page extras
// live in the view selector's menu (GridViewPicker `filters` / `tools` /
// `extra`), so the create button and the search box sit in the same place on
// every page. Publish it with useListTopbar; a page that owns its own bar
// (PageLayout) passes <ListActions … /> as `actions`.
export function ListActions({ secondary, primary, search }) {
    return (
        <>
            {secondary}
            {primary}
            {search && <SearchField {...search} />}
        </>
    );
}

export default ListActions;
