import os from 'node:os';
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import util from 'node:util';

import colors from 'ansi-colors';
import table from 'text-table';
import enquirer from 'enquirer';

const NPM_COMMAND = os.platform() === 'win32' ? 'npm.cmd' : 'npm';

const promisifySpawn = (command, args) => new Promise((resolve, reject) => {
  const spwn = spawn(command, args);
  const error = [];
  const stdout = [];
  spwn.stdout.on('data', (data) => {
    stdout.push(data.toString());
  });

  spwn.on('error', (e) => {
    error.push(e.toString());
  });

  spwn.on('close', () => {
    if (error.length) reject(error.join(''));
    else resolve(stdout.join(''));
  });
});

// Returns { rootName, resolveWorkspaceName } or { rootName: null } if not a workspace.
// resolveWorkspaceName maps any identifier (dir name or package name) to the canonical
// package name required by npm --workspace=<name>.
const detectWorkspaceInfo = () => {
  try {
    const rootPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (!rootPkg.workspaces) return { rootName: null };

    const patterns = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : (rootPkg.workspaces.packages ?? []);

    const nameMap = new Map();
    patterns.forEach((pattern) => {
      const parts = pattern.split('/');
      const isGlob = parts[parts.length - 1] === '*';

      let searchPaths;
      if (isGlob) {
        const base = parts.slice(0, -1).join('/') || '.';
        try {
          searchPaths = fs.readdirSync(base, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => `${base}/${d.name}`);
        } catch {
          searchPaths = [];
        }
      } else {
        searchPaths = [pattern];
      }

      searchPaths.forEach((wsPath) => {
        try {
          const wsPkg = JSON.parse(fs.readFileSync(`${wsPath}/package.json`, 'utf8'));
          nameMap.set(wsPkg.name, wsPkg.name);
          nameMap.set(wsPath.split('/').pop(), wsPkg.name);
        } catch { /* workspace without package.json */ }
      });
    });

    return {
      rootName: rootPkg.name,
      resolveWorkspaceName: (id) => nameMap.get(id) ?? id,
    };
  } catch {
    return { rootName: null };
  }
};

// npm outdated --json values can be an object or an array of objects
// (array when multiple workspaces depend on the same package)
const parseOutdatedJson = (outdatedJson) => {
  const outdatedMap = JSON.parse(outdatedJson || '{}');
  const packageMap = new Map();

  Object.entries(outdatedMap).forEach(([name, info]) => {
    const infos = Array.isArray(info) ? info : [info];
    infos.forEach((i) => {
      if (!packageMap.has(name)) {
        packageMap.set(name, {
          name,
          current: i.current,
          wanted: i.wanted,
          latest: i.latest,
          dependents: [i.dependent],
        });
      } else {
        packageMap.get(name).dependents.push(i.dependent);
      }
    });
  });

  return Array.from(packageMap.values());
};

const HEAD = ['Package', 'Current', 'Wanted', 'Latest'];
const HEAD_WORKSPACE = [...HEAD, 'Workspaces'];

const makePretty = (pkg, isWorkspace) => {
  const nameColored = pkg.current === pkg.wanted
    ? colors.yellow(pkg.name)
    : colors.red(pkg.name);
  const row = [nameColored, pkg.current, colors.green(pkg.wanted), colors.magenta(pkg.latest)];
  if (isWorkspace) row.push(colors.cyan(pkg.dependents.join(', ')));
  return row;
};

const processOutdatedPackage = async (rl, pkg, isWorkspace, options = {}) => {
  const tableOpts = {
    align: ['l', 'r', 'r', 'r', 'l'],
    stringLength: (s) => util.stripVTControlCharacters(s).length,
  };
  const head = isWorkspace ? HEAD_WORKSPACE : HEAD;
  rl.write('Package to update :');
  rl.write(os.EOL);
  rl.write(table([head.map((x) => colors.underline(x)), makePretty(pkg, isWorkspace)], tableOpts));
  rl.write(os.EOL);

  const {
    name, current, wanted, latest,
  } = pkg;

  if (options.autoMinor) {
    const isMajorBump = parseInt(latest.split('.')[0], 10) > parseInt(current.split('.')[0], 10);
    const isPreRelease = latest.includes('-');
    if (isMajorBump || isPreRelease) return undefined;
    if (current === latest) {
      rl.write(`${name}@${latest} (already up to date)`);
      rl.write(os.EOL);
      return undefined;
    }
    rl.write(`Auto-selecting: ${name}@${latest}`);
    rl.write(os.EOL);
    return { ...pkg, version: latest };
  }

  const choices = [{ name: 'No' }];

  if (current !== wanted && wanted !== latest) {
    choices.push({ message: `Wanted : ${name}@${wanted}`, name: 'Wanted' });
  }

  choices.push({ message: `Latest : ${name}@${latest}`, name: 'Latest' });

  const prompt = new enquirer.Select({
    name: 'Select',
    message: 'Update package',
    choices,
    initial: wanted === latest ? 'Latest' : 'Wanted',
  });

  try {
    const answer = await prompt.run();
    if (answer === 'No') return undefined;
    return { ...pkg, version: answer === 'Wanted' ? wanted : latest };
  } catch {
    rl.close();
    process.exit(-1);
    return undefined;
  }
};

const updateOutdatedPackage = async (rl, packagesToUpdate, rootName, resolveWorkspaceName) => {
  for (const pkg of packagesToUpdate) {  
    const workspaceDependents = rootName
      ? pkg.dependents.filter((d) => d !== rootName)
      : [];
    const hasRootDep = !rootName || pkg.dependents.includes(rootName);

    if (hasRootDep) {
      rl.write(`Running command npm install ${pkg.name}@${pkg.version}`);
      rl.write(os.EOL);
      await promisifySpawn(NPM_COMMAND, ['install', `${pkg.name}@${pkg.version}`]);  
    }

    for (const dependent of workspaceDependents) {  
      const wsName = resolveWorkspaceName(dependent);
      rl.write(`Running command npm install ${pkg.name}@${pkg.version} --workspace=${wsName}`);
      rl.write(os.EOL);
      await promisifySpawn(NPM_COMMAND, ['install', `${pkg.name}@${pkg.version}`, `--workspace=${wsName}`]);  
    }
  }
  return packagesToUpdate;
};

const processOutdated = async (outdatedJson, rootName, resolveWorkspaceName, options = {}) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const isWorkspace = !!rootName;
  const packages = parseOutdatedJson(outdatedJson);

  if (!packages.length) {
    rl.write('No package to update');
    rl.close();
    process.exit(0);
  }

  const packagesToUpdate = [];
  for (const pkg of packages) {  
    const selected = await processOutdatedPackage(rl, pkg, isWorkspace, options);  
    if (selected) packagesToUpdate.push(selected);
  }

  await updateOutdatedPackage(rl, packagesToUpdate, rootName, resolveWorkspaceName);
  rl.write(`${packagesToUpdate.length} package(s) updated`);
  rl.close();
};

export default async function npmUpdateOutdated(options = {}) {
  const { rootName, resolveWorkspaceName = (id) => id } = detectWorkspaceInfo();
  await promisifySpawn(NPM_COMMAND, ['ci']);
  const outdated = await promisifySpawn(NPM_COMMAND, ['outdated', '--json']);
  return processOutdated(outdated, rootName, resolveWorkspaceName, options);
}
