# patcher-plugin-composer-customization

A small reference plugin for every `app.composer.customize(...)` region:

- `actions`: a React button using `useComposer()` and `useComposerView()` to
  lock and decorate the bound draft;
- `plusMenu`: a host-rendered command that appends a checklist;
- `banners`: a card showing reactive draft and scope information;
- `richText.effects`: a paint-only rule highlighting `TODO`; and
- `richText.onDraftChange`: debounced structured-draft observation.

The CSS uses Patcher's public `--canvas`, `--ink`, and `--accent` theme anchors.
Production plugins should vendor the Patcher prompt icon-button recipe for action
chrome and keep custom action buttons keyboard accessible.

## Install and try it

Run:

```sh
patcher plugin install ./examples/plugins/composer-customization
```

Open any expanded composer, type `TODO`, use the `+` menu command, and activate
the `Polish` action. The action toggles the input lock and whole-draft effect;
activate `Unlock` before submitting. After source edits, run
`patcher plugin reload composer-customization`.
