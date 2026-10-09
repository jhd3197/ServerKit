// ServerKit redesign design-system primitives (see docs/REDESIGN_MAP.md §3).
// Shared, reusable building blocks for the new "infra console" look. Styles
// live in styles/components/_design-system.scss (sk-* namespace).
export { Pill } from './Pill';
export {
    statusKind, statusVariant, statusDotClass, statusLabel,
    alertStatusKind, processStateVariant, envActionKind,
    serviceStatusKind, serviceStatusVariant, serviceStatusDotClass,
} from './status';
export { EnvTag } from './EnvTag';
export { SegControl } from './SegControl';
export { MetricCard } from './MetricCard';
export { KpiBand } from './KpiBand';
export { Gauge } from './Gauge';
export { ServiceTile } from './ServiceTile';
export { Sparkline } from './Sparkline';
export { AreaChart } from './AreaChart';
export { ScoreGauge } from './ScoreGauge';
export { Feed, FeedItem } from './Feed';
export { Drawer } from './Drawer';
export { SearchField } from './SearchField';
export { FilterDrawer, FilterButton } from './FilterDrawer';
export { countActiveFilters, emptyFilterValue } from './filterValues';
export { PageTopbar } from './PageTopbar';
export { DataTable } from './DataTable';
export { CatalogCard, CatalogGrid } from './CatalogCard';
export { SortChipBar } from './SortChipBar';
export { DataTableFooter } from './DataTableFooter';
export { ListToolbar } from './ListToolbar';

// DEPRECATED toolbar menus — ZERO render sites left in the app.
//
// Each one is a toolbar-level copy of something DataTable's per-column "⋮"
// menu now does next to the column it acts on: SortMenu -> sort, ColumnsMenu ->
// hide/show, GroupMenu -> group by (that one never had a render site at all).
// ViewMenu is replaced by grid/GridViewPicker, which renders the active view as
// the page HEADING rather than as one more button among buttons.
//
// Still exported because extensions may deep-import '@/components/ds' (see the
// note in plugins/sdk/index.js) — none of the four is on the SDK's blessed
// list, so they can go in the next SDK major. Do not reach for them in core.
export { SortMenu } from './SortMenu';
export { ColumnsMenu } from './ColumnsMenu';
export { GroupMenu } from './GroupMenu';
export { ViewMenu } from './ViewMenu';
export { ResourceCard, ResourceList } from './ResourceCard';
export { svcGrad, initials, gaugeColor } from './utils';
