import { Icon, type IconName } from "@patcher/shared-ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@patcher/shared-ui/popover";
import { cn } from "@patcher/shared-ui/lib/utils";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { usePluginSiteInfo } from "@/hooks/queries/plugin-contribution-queries";
import {
  describeBrowserPageSecurity,
  type BrowserPageSecurity,
} from "@/lib/browser-page-security";

/**
 * What the padlock opens: what the browser can honestly say about this site, and
 * what plugins know about it.
 *
 * The padlock **is** the trigger, which is the point of the panel existing. A
 * glyph nobody can click is a claim nobody can check, and the claim it used to
 * make — "secure", from the scheme in the address bar — was wrong in both
 * directions. See `browser-page-security.ts` for what is and is not claimed.
 */
const SECURITY_ICONS: Record<BrowserPageSecurity["kind"], IconName> = {
  encrypted: "Lock",
  // Chromium refuses this connection until a human overrules it, and the glyph
  // says so rather than showing a padlock with a footnote.
  "certificate-untrusted": "AlertTriangle",
  plain: "AlertTriangle",
  local: "Laptop",
  none: "Search",
};

const SECURITY_TONES: Record<BrowserPageSecurity["kind"], string | null> = {
  encrypted: "text-success",
  "certificate-untrusted": "text-destructive",
  plain: "text-warning",
  local: null,
  none: null,
};

export interface BrowserSiteInfoProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  security: BrowserPageSecurity;
  tabId: string;
  url: string;
}

export function BrowserSiteInfo({
  open,
  onOpenChange,
  security,
  tabId,
  url,
}: BrowserSiteInfoProps) {
  const copy = describeBrowserPageSecurity(security);
  const tone = SECURITY_TONES[security.kind];
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // The name says the state rather than the control, because the state is
          // what the user is checking. With no page there is no claim to read, so
          // the button keeps a plain name instead of announcing "nothing".
          aria-label={copy.label ?? "Site information"}
          className="flex shrink-0 items-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon
            name={SECURITY_ICONS[security.kind]}
            className={cn("size-4", tone ?? "text-muted-foreground")}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0"
        mobileTitle="Site information"
      >
        <div className="flex flex-col gap-1 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Icon
              name={SECURITY_ICONS[security.kind]}
              className={cn("size-4 shrink-0", tone ?? "text-muted-foreground")}
              aria-hidden
            />
            <span className="text-sm font-medium">{copy.title}</span>
          </div>
          {security.host.length === 0 ? null : (
            <span className="truncate text-xs text-muted-foreground">
              {security.host}
            </span>
          )}
          <p className="text-xs text-muted-foreground">{copy.detail}</p>
        </div>
        <BrowserSiteInfoPluginSections tabId={tabId} url={url} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The plugin half, in its own component *inside* the popover — so the request
 * happens when the panel opens and not before. Structural rather than an
 * `enabled` flag, because a closed popover renders no content at all: a provider
 * may do real work to answer, and nothing should ask it while nobody is looking.
 */
function BrowserSiteInfoPluginSections({
  tabId,
  url,
}: {
  tabId: string;
  url: string;
}) {
  const sections = usePluginSiteInfo(
    { tabId, url },
    { enabled: url.length > 0 },
  );
  return (
    <>
      {(sections.data ?? []).map((section) => (
        <div
          key={`${section.pluginId}:${section.providerId}`}
          className="flex flex-col gap-1 border-b border-border p-3 last:border-b-0"
        >
          <div className="flex items-center gap-2">
            <Icon
              name={pluginIconName(null)}
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="text-xs font-medium">{section.label}</span>
          </div>
          {section.rows.map((row, index) => (
            <div
              key={`${row.label}:${index}`}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="shrink-0 text-muted-foreground">
                {row.label}
              </span>
              {/* A plugin's value is text, and `break-all` is what keeps a long
                    one from widening the panel past the address bar it hangs
                    from. */}
              <span className="min-w-0 break-all text-right">{row.value}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
