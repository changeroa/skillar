import type { ComponentChildren } from "preact";

export function Sidebar({ label, children, header, footer, collapsed = false }: {
  readonly label: string; readonly children: ComponentChildren;
  readonly header?: ComponentChildren; readonly footer?: ComponentChildren; readonly collapsed?: boolean;
}) {
  return <aside class="lf-sidebar" aria-label={label} data-collapsed={collapsed}>
    {header}
    <nav aria-label={label}>{children}</nav>
    {footer && <footer class="lf-sidebar__footer">{footer}</footer>}
  </aside>;
}

export function NavGroup({ label, children }: {
  readonly label: string; readonly children: ComponentChildren;
}) {
  return <div class="lf-nav-group" role="group" aria-label={label}>
    <div class="lf-nav-group__label">{label}</div>{children}</div>;
}

export function NavItem({ href, label, current = false, icon, disabled = false }: {
  readonly href: string; readonly label: string; readonly current?: boolean;
  readonly icon?: ComponentChildren; readonly disabled?: boolean;
}) {
  return <a class="lf-nav-item" href={disabled ? undefined : href} title={label}
    aria-current={current ? "page" : undefined} aria-disabled={disabled || undefined}
    tabIndex={disabled ? -1 : undefined}>
    {icon}<span>{label}</span>{current && <span class="lf-nav-check" aria-hidden="true" />}
  </a>;
}

export type Crumb = { readonly label: string; readonly href?: string };
export function Breadcrumb({ items, label = "현재 위치" }: {
  readonly items: readonly Crumb[]; readonly label?: string;
}) {
  return <nav class="lf-breadcrumb" aria-label={label}><ol>
    {items.map((item, index) => <li key={`${index}-${item.label}`}>
      {index > 0 && <span class="lf-breadcrumb__separator" aria-hidden="true">/</span>}
      {item.href && index !== items.length - 1 ? <a href={item.href}>{item.label}</a>
        : <span aria-current={index === items.length - 1 ? "page" : undefined} title={item.label}>{item.label}</span>}
    </li>)}
  </ol></nav>;
}

export function Topbar({ children, actions }: {
  readonly children: ComponentChildren; readonly actions?: ComponentChildren;
}) {
  return <header class="lf-topbar"><div class="lf-topbar__inner">
    <div class="lf-topbar__leading">{children}</div>
    {actions && <div class="lf-topbar__actions">{actions}</div>}</div></header>;
}

export function PageHeader({ title, children, actions }: {
  readonly title: string; readonly children?: ComponentChildren; readonly actions?: ComponentChildren;
}) {
  return <header class="lf-page-header"><div class="lf-page-header__inner"><div><h1>{title}</h1>{children}</div>
    {actions && <div class="lf-topbar__actions">{actions}</div>}</div></header>;
}
