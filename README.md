# Oh My Pencil Actions

**Visual diff for [Pencil](https://pencil.dev) design files in GitHub Pull Requests.**

Automatically detect changes in `.pen` files, render before/after screenshots, and post a visual comparison directly in your PR comments — so your team can review design changes at a glance.

[![GitHub Action](https://img.shields.io/badge/GitHub-Action-2088FF?logo=github-actions&logoColor=white)](https://github.com/stoneHee99/oh-my-pencil-actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What It Does

When a Pull Request modifies `.pen` design files, this action:

1. **Detects** which `.pen` files changed between the base and head branches
2. **Diffs** the design nodes — identifies added, removed, and modified elements
3. **Renders** before/after screenshots of affected components using a lightweight HTML/CSS renderer
4. **Posts** a visual comparison report as a PR comment

### Example PR Comment

```
🎨 Design Changes: untitled.pen

> 3 modified nodes

📄 Header + Tabs + Strategy (Overview)

| Before | After |
|--------|-------|
| ![before](before.png) | ![after](after.png) |

🔍 Changed Nodes

✏️ studentName
> content changed

✏️ sectionTitle
> fontSize changed
```

---

## Quick Start

Add this workflow to your repository at `.github/workflows/pen-preview.yml`:

```yaml
name: Pencil Design Preview

on:
  pull_request:
    paths:
      - "**/*.pen"

permissions:
  contents: read
  pull-requests: write

jobs:
  design-preview:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Pencil Preview
        uses: stoneHee99/oh-my-pencil-actions@v1
```

That's it. Open a PR that changes a `.pen` file and watch the magic happen.

---

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `pen-paths` | Glob pattern for `.pen` files to watch | `**/*.pen` |
| `output-dir` | Directory to save screenshots | `.pencil-preview` |
| `comment` | Post a PR comment with visual diff | `true` |
| `artifact` | Upload screenshots as workflow artifact | `true` |
| `artifact-name` | Name of the uploaded artifact | `pencil-design-preview` |

### Example with custom inputs

```yaml
- name: Run Pencil Preview
  uses: stoneHee99/oh-my-pencil-actions@v1
  with:
    pen-paths: "designs/**/*.pen"
    output-dir: "preview-output"
    artifact-name: "my-design-preview"
```

---

## Outputs

| Output | Description |
|--------|-------------|
| `has-changes` | `true` if any `.pen` file changes were detected |
| `report` | Path to the generated markdown report directory |
| `changed-files` | List of changed `.pen` files |

### Using outputs in subsequent steps

```yaml
- name: Run Pencil Preview
  id: preview
  uses: stoneHee99/oh-my-pencil-actions@v1

- name: Check results
  if: steps.preview.outputs.has-changes == 'true'
  run: echo "Design changes detected!"
```

---

## How It Works

### Architecture

```
.pen (base)  ──┐
                ├──→  Diff Engine  ──→  Changed Nodes
.pen (head)  ──┘         │
                         ▼
              ┌─── HTML/CSS Renderer ───┐
              │                         │
              ▼                         ▼
        Before Screenshots       After Screenshots
              │                         │
              └────────┬────────────────┘
                       ▼
              Markdown Report → PR Comment
```

### Rendering Pipeline

This action includes a **lightweight `.pen` → HTML/CSS renderer** that converts Pencil's design format into browser-renderable HTML:

- **Layout**: Pencil's auto-layout (vertical/horizontal) maps to CSS Flexbox
- **Sizing**: `fill_container` → `flex: 1`, `hug_content` → auto sizing
- **Styling**: fills, strokes, shadows, corner radius, opacity, transforms
- **Typography**: font family, size, weight, line height, letter spacing (via Google Fonts)
- **Variables**: Pencil design tokens (`$--color-primary`) resolved to actual values

Screenshots are captured using [Playwright](https://playwright.dev) with Chromium at 2x resolution for crisp output.

### Diff Engine

The diff engine compares two `.pen` documents node-by-node:

- **Added nodes**: present in head but not in base
- **Removed nodes**: present in base but not in head
- **Modified nodes**: same ID but different visual properties (fill, stroke, size, content, etc.)

Screenshots are taken at two levels:
- **Overview**: top-level frames containing changes (full context)
- **Detail**: individual changed components (focused comparison)

---

## Supported `.pen` Features

| Feature | Status |
|---------|--------|
| Frames with auto-layout (horizontal/vertical) | Supported |
| Text nodes (content, font, color, alignment) | Supported |
| Fill (solid, gradient, image) | Supported |
| Stroke (uniform and per-side) | Supported |
| Effects (drop shadow, inner shadow) | Supported |
| Corner radius (uniform and per-corner) | Supported |
| Opacity and transforms (rotation, flip) | Supported |
| Design variables / tokens | Supported |
| Nested frames and components | Supported |
| Clip / overflow hidden | Supported |
| Blend modes | Not yet |
| Vector paths / shapes | Not yet |
| Masks | Not yet |

---

## Requirements

- **Pencil** (https://pencil.dev) — AI-native design tool that produces `.pen` files
- Your repository must contain `.pen` files committed to version control

No additional setup or API keys required.

---

## Local Development

```bash
# Clone
git clone https://github.com/stoneHee99/oh-my-pencil-actions.git
cd oh-my-pencil-actions

# Install
npm install
npx playwright install chromium

# Build
npm run build

# Run locally
node dist/main.js path/to/base.pen path/to/head.pen --output-dir screenshots
```

---

## Contributing

Contributions are welcome! Whether it's:

- Improving rendering accuracy for edge cases
- Adding support for new `.pen` features (blend modes, vectors, masks)
- Better error handling and logging
- Documentation improvements

Please open an issue first to discuss what you'd like to change.

---

## License

[MIT](LICENSE)

---

## Related

- [Pencil](https://pencil.dev) — AI-native design tool
- [open-pencil](https://github.com/open-pencil/open-pencil) — Open-source Pencil renderer (reference implementation)

---

<p align="center">
  Built with Pencil and Playwright<br>
  <sub>If this action helps your design workflow, give it a star!</sub>
</p>
