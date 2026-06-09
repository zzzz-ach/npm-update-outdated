# npm-update-outdated
Small tool to update npm packages

## Usage
With npx
`npx @zzzz-ach/npm-update-outdated`

For each outdated package, the tool prompts you to choose between the wanted and latest versions.

### Options

`--auto-minor` / `-m` — automatically update minor and patch versions, skip major bumps silently.

### npm workspaces

The tool automatically detects npm workspaces from the root `package.json`. When a workspace is detected, the dependent workspace(s) are shown in the prompt and `npm install` is run with `--workspace=<name>` for each affected package.

## Todos
- check node version
- force update on wanted/latest versions via command line options
