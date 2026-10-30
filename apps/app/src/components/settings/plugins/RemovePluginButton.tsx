import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@patcher/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@patcher/shared-ui/dialog";
import { Icon } from "@patcher/shared-ui/icon";
import { appToast } from "@/components/ui/app-toast";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  removePlugin,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";

export function RemovePluginButton({
  plugin,
  onRemoved,
}: {
  plugin: PluginListItem;
  onRemoved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isBuiltin = plugin.provenance === "builtin";
  const isPathSource = plugin.sourceDisplay.toLowerCase().startsWith("path");
  const name = plugin.name ?? plugin.id;
  const remove = useMutation({
    mutationFn: () => removePlugin(fetch, plugin.id),
    onSuccess: () => {
      invalidatePluginList({ queryClient });
      appToast.success(`Removed ${name}`);
      setConfirmOpen(false);
      onRemoved?.();
    },
    onError: (error) => {
      appToast.error(`Removing ${name} failed`, {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 px-2.5 text-xs text-destructive-text"
        onClick={() => setConfirmOpen(true)}
      >
        Remove
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {name}?</DialogTitle>
            <DialogDescription>
              {isBuiltin
                ? "This removes the plugin and its stored settings. Patcher remembers the removal so the plugin stays hidden after restart; its bundled files remain in place."
                : isPathSource
                  ? "This uninstalls the plugin and removes its stored settings. Its local source files stay on disk, so you can reinstall it."
                  : "This uninstalls the plugin, deletes its downloaded files, and removes its stored settings."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              aria-busy={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? (
                <Icon name="Spinner" className="animate-spin" />
              ) : null}
              Remove plugin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
