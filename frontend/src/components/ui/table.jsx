import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

// The wrapper becomes a focusable scroll region only while the table really
// overflows; data-fade-start/-end drive the edge fade in _ui.scss.
const Table = React.forwardRef(({ className, ...props }, ref) => {
  const { t } = useTranslation();
  const wrapRef = React.useRef(null);
  const [scroll, setScroll] = React.useState({ overflow: false, start: false, end: false });

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const x = Math.abs(el.scrollLeft); // abs: RTL scrollLeft is negative
      const next = { overflow: max > 1, start: x > 1, end: x < max - 1 };
      setScroll((prev) => (prev.overflow === next.overflow && prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener('scroll', update, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', update); };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="ui-table-wrapper"
      data-fade-start={scroll.start || undefined}
      data-fade-end={scroll.end || undefined}
      {...(scroll.overflow ? {
        tabIndex: 0,
        role: 'region',
        'aria-label': t('app.dataTable.scrollableTable', 'Scrollable table'),
      } : {})}
    >
      <table ref={ref} className={cn('ui-table', className)} {...props} />
    </div>
  );
});
Table.displayName = 'Table';

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('ui-table-header', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('ui-table-body', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn('ui-table-footer', className)} {...props} />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn('ui-table-row', className)} {...props} />
));
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th ref={ref} className={cn('ui-table-head', className)} {...props} />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('ui-table-cell', className)} {...props} />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('ui-table-caption', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
