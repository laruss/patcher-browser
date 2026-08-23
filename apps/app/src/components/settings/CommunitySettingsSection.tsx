import { Button } from "@patcher/shared-ui/button";
import { Icon, type IconName } from "@patcher/shared-ui/icon";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

export const GITHUB_REPO_URL = "https://github.com/laruss/patcher-browser";

interface CommunityLinkRowProps {
  description: string;
  href: string;
  icon: IconName;
  label: string;
  openLabel: string;
}

function CommunityLinkRow({
  description,
  href,
  icon,
  label,
  openLabel,
}: CommunityLinkRowProps) {
  return (
    <SettingsWithControl label={label} description={description}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-xs"
        aria-label={openLabel}
        onClick={() => {
          openUrlInExternalBrowser(href);
        }}
      >
        <Icon name={icon} className="size-3.5 shrink-0" />
        {openLabel}
        <Icon
          name="ExternalLink"
          className="size-3 shrink-0 text-muted-foreground"
        />
      </Button>
    </SettingsWithControl>
  );
}

/**
 * Settings → Community: external links to the public GitHub repository (moved
 * out of the app sidebar footer).
 *
 * The Discord row was dropped with the Patcher rename: the invite it carried
 * was bb's server, and sending Patcher users there to ask Patcher questions
 * helps neither project. It comes back when Patcher has a server of its own.
 */
export function CommunitySettingsSection() {
  return (
    <SettingsSection
      title="Community"
      description="Follow Patcher development on GitHub."
    >
      <div className="space-y-5">
        <CommunityLinkRow
          label="GitHub"
          description="Source code, issues, and releases for the Patcher project."
          href={GITHUB_REPO_URL}
          icon="Github"
          openLabel="View on GitHub"
        />
      </div>
    </SettingsSection>
  );
}
