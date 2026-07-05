<div align="center">

# 🔌 VSCode Extension Template

[![CI status][ci_badge]][ci]

A minimal repo configured with modern JavaScript tooling to scaffold new Visual Studio Code extensions

</div>

---

## 🚀 Getting Started

1. Use this template to create a new repository.
2. Search-and-replace `vscode-extension-template` with your extension's id and update the `publisher`, `displayName`, and `description` fields in [package.json](./package.json).
3. Update the `contributes` block and command ids to match your extension.
4. Implement your extension in [src/index.ts](./src/index.ts) (`activate` / `deactivate`).

## 🔧 Usage

The scaffold ships a single `Hello World` command. Run the extension with `F5` in VSCode (or `vp pack` then load the built `.vsix`) and invoke it from the Command Palette.

## 📦 Building & Publishing

Extensions are bundled to a self-contained CommonJS artifact and packaged into a `.vsix`. Publishing is handled automatically on merge to `main` by [Bumpy][bumpy] via the release workflow, targeting both the [VS Code Marketplace][vsce] and [Open VSX][ovsx].

```bash
vp pack                              # bundle src → dist/index.cjs
vp exec vsce package --no-dependencies   # build the .vsix locally
```

### One-time setup

Publishing is automated, but each marketplace needs an account, a publisher, and an access token before your first release. Do this once, then the release workflow handles every publish after.

#### 1. VS Code Marketplace (`VSCE_PAT`)

The Marketplace is backed by Azure DevOps, so the token is an Azure DevOps Personal Access Token — not a Marketplace-specific one.

1. Create an [Azure DevOps organization](https://dev.azure.com/) if you don't have one (a free personal account is fine).
2. Create your **publisher** at <https://marketplace.visualstudio.com/manage/createpublisher>. The publisher **ID** you choose here must match the `publisher` field in [package.json](./package.json).
3. Mint a token at <https://dev.azure.com/> → **User settings** (top-right avatar) → **Personal access tokens** → **New Token**:
   - **Organization:** set to **All accessible organizations** (required — a single-org token will fail with a 401).
   - **Scopes:** click **Show all scopes**, then grant **Marketplace → Manage**.
   - **Expiration:** set as long as allowed; you'll need to rotate the secret when it expires.
4. Copy the token (shown only once) and save it as the `VSCE_PAT` repository secret (see below).

#### 2. Open VSX (`OVSX_PAT`)

Open VSX is the vendor-neutral registry used by VSCodium, Cursor, Gitpod, and other non-Microsoft editors.

1. Sign in at <https://open-vsx.org/> with your GitHub account.
2. Open **Settings → Access Tokens**, click **Generate New Token**, and copy it.
3. Create a **namespace** matching your `publisher` id, then claim it: `vp exec ovsx create-namespace <publisher> -p <token>`.
4. Sign the [Eclipse Publisher Agreement](https://open-vsx.org/user-settings/extensions) — Open VSX blocks your first publish until this is accepted.
5. Save the token as the `OVSX_PAT` repository secret.

#### 3. Bumpy release token (`BUMPY_GH_TOKEN`)

Bumpy opens release PRs and creates GitHub Releases. Create a [fine-grained personal access token](https://github.com/settings/tokens?type=beta) scoped to this repository with **Contents: Read and write** and **Pull requests: Read and write**, then save it as `BUMPY_GH_TOKEN`.

#### 4. Add the secrets

In your repository, go to **Settings → Secrets and variables → Actions → New repository secret** and add each of:

| Secret           | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `VSCE_PAT`       | VS Code Marketplace personal access token (`vsce publish`) |
| `OVSX_PAT`       | Open VSX personal access token (`ovsx publish`)            |
| `BUMPY_GH_TOKEN` | Token Bumpy uses to open release PRs / GitHub Releases     |

To publish only to one marketplace, drop the other's `publishCommand` from the `bumpy` block in [package.json](./package.json) and remove its secret.

## 🤝 Contributing

The project uses [Vite+][viteplus] as a unified toolchain (Oxlint + Oxfmt + tsdown + Vitest) and [Bumpy][bumpy] for versioning and release.

```bash
vp install           # install dependencies
vp check --fix       # format + lint + typecheck (with autofixes)
vp test              # run Vitest
yarn bumpy add       # create a bump file for your PR
```

## 🥂 License

Released under the [MIT license][license] © [Drake Costa][personal-website].

[ci_badge]: https://github.com/Saeris/vscode-extension-template/actions/workflows/ci.yml/badge.svg
[ci]: https://github.com/Saeris/vscode-extension-template/actions/workflows/ci.yml
[viteplus]: https://viteplus.dev/
[bumpy]: https://bumpy.varlock.dev/
[vsce]: https://marketplace.visualstudio.com/
[ovsx]: https://open-vsx.org/
[license]: ./LICENSE.md
[personal-website]: https://saeris.gg
