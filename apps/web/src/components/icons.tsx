import type { ReactNode } from "react";

export interface IconProps {
  readonly className?: string;
  readonly size?: number;
}

interface IconBaseProps extends IconProps {
  readonly children: ReactNode;
}

function IconBase({ className, size = 16, children }: IconBaseProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function IconWater(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 8a2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 1 4.5 0 2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 1 4.5 0" />
      <path d="M3 13.5a2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 1 4.5 0 2.25 2.25 0 0 0 4.5 0" />
    </IconBase>
  );
}

export function IconGauge(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 18.5a8.5 8.5 0 1 1 15 0" />
      <path d="M12 18.5 16 13" />
    </IconBase>
  );
}

export function IconNetwork(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M12 7v3" />
      <path d="m10.7 13.5-3.4 4" />
      <path d="m13.3 13.5 3.4 4" />
    </IconBase>
  );
}

export function IconSchedule(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3.5v3" />
      <path d="M16 3.5v3" />
      <circle cx="14.5" cy="14.5" r="3.2" />
      <path d="M14.5 13.1v1.6l1.2.7" />
    </IconBase>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10.7 5.1a1.5 1.5 0 0 1 2.6 0l7.4 12.8a1.5 1.5 0 0 1-1.3 2.3H4.6a1.5 1.5 0 0 1-1.3-2.3Z" />
      <path d="M12 10v4" />
      <path d="M12 17.2h.01" />
    </IconBase>
  );
}

export function IconBell(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M18 9a6 6 0 1 0-12 0c0 4-1.5 5.2-1.5 5.2h15S18 13 18 9Z" />
      <path d="M10.3 18.2a2 2 0 0 0 3.4 0" />
    </IconBase>
  );
}

export function IconArchive(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="5.5" width="16" height="3.2" rx="1" />
      <path d="M5.2 8.7V18a1.3 1.3 0 0 0 1.3 1.3h11a1.3 1.3 0 0 0 1.3-1.3V8.7" />
      <path d="M10 12.2h4" />
    </IconBase>
  );
}

export function IconFlask(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9.5 3.5h5" />
      <path d="M10.1 3.5v5.2L5.6 17a2.6 2.6 0 0 0 2.3 3.9h8.2a2.6 2.6 0 0 0 2.3-3.9L13.9 8.7V3.5" />
      <path d="M8.3 14.8h7.4" />
    </IconBase>
  );
}

export function IconRun(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m10 8.8 5 3.2-5 3.2Z" />
    </IconBase>
  );
}

export function IconTarget(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.9" />
    </IconBase>
  );
}

export function IconChart(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 19.5h16" />
      <path d="M7 19.5v-6" />
      <path d="M12 19.5V9" />
      <path d="M17 19.5v-4" />
    </IconBase>
  );
}

export function IconChip(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
      <rect x="10" y="10" width="4" height="4" />
      <path d="M10 3.5v3" />
      <path d="M14 3.5v3" />
      <path d="M10 17.5v3" />
      <path d="M14 17.5v3" />
      <path d="M3.5 10h3" />
      <path d="M3.5 14h3" />
      <path d="M17.5 10h3" />
      <path d="M17.5 14h3" />
    </IconBase>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7.5h5.5" />
      <path d="M14.5 7.5h5.5" />
      <circle cx="12" cy="7.5" r="2.1" />
      <path d="M4 15.5h9.9" />
      <path d="M18.1 15.5h1.9" />
      <circle cx="16" cy="15.5" r="2.1" />
    </IconBase>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 7h15" />
      <path d="M4.5 12h15" />
      <path d="M4.5 17h15" />
    </IconBase>
  );
}

export function IconClock(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 1.9" />
    </IconBase>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4.5 12.5 5 5L19.5 7" />
    </IconBase>
  );
}

export function IconClose(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </IconBase>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2" />
      <path d="M12 7.9h.01" />
    </IconBase>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </IconBase>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </IconBase>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </IconBase>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 5.4v13.2L19 12Z" />
    </IconBase>
  );
}

export function IconPause(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 5.5v13" />
      <path d="M15 5.5v13" />
    </IconBase>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4v10.5" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19.5h14" />
    </IconBase>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="9" width="11" height="11" rx="1.8" />
      <path d="M15 6.5V5.7A1.7 1.7 0 0 0 13.3 4H5.7A1.7 1.7 0 0 0 4 5.7v7.6A1.7 1.7 0 0 0 5.7 15h.8" />
    </IconBase>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4" />
      <path d="M20.5 3.6v4.8h-4.8" />
    </IconBase>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14.5 4.5H6.8A1.8 1.8 0 0 0 5 6.3v11.4a1.8 1.8 0 0 0 1.8 1.8h7.7" />
      <path d="M9.8 12h8.7" />
      <path d="m15.5 8.5 3.5 3.5-3.5 3.5" />
    </IconBase>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

export function IconTrendUp(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 16.5 10 10l3.5 3.5L20 7" />
      <path d="M15 7h5v5" />
    </IconBase>
  );
}

export function IconTrendDown(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7.5 10 14l3.5-3.5L20 17" />
      <path d="M15 17h5v-5" />
    </IconBase>
  );
}

export function IconTrendFlat(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 12H20" />
      <path d="M16.8 8.8 20 12l-3.2 3.2" />
    </IconBase>
  );
}