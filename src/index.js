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

const detectWorkspaceRootName = () => {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    return pkg.workspaces ? pkg.name : null;
  } catch {
    return null;
  }
};

const HEAD = ['Package', 'Current', 'Wanted', 'Latest'];
const HEAD_WORKSPACE = [...HEAD, 'Workspace'];

const makePretty = (pkg, isWorkspace) => {
  const nameColored = pkg.current === pkg.wanted
    ? colors.yellow(pkg.name)
    : colors.red(pkg.name);
  const row = [nameColored, pkg.current, colors.green(pkg.wanted), colors.magenta(pkg.latest)];
  if (isWorkspace) row.push(colors.cyan(pkg.dependent));
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

  if (options.autoWanted && current === wanted) {
    rl.write(`${name}@${wanted} (already up to date)`);
    rl.write(os.EOL);
    return undefined;
  }

  if (options.autoWanted && current !== wanted) {
    rl.write(`Auto-selecting wanted version: ${name}@${wanted}`);
    rl.write(os.EOL);
    return { ...pkg, version: wanted };
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

const updateOutdatedPackage = async (rl, packagesToUpdate, rootPackageName) => {
  for (const pkg of packagesToUpdate) { // eslint-disable-line no-restricted-syntax
    const isWorkspaceDep = rootPackageName && pkg.dependent !== rootPackageName;
    const args = ['install', `${pkg.name}@${pkg.version}`];
    if (isWorkspaceDep) args.push(`--workspace=${pkg.dependent}`);

    const workspaceLabel = isWorkspaceDep ? ` --workspace=${pkg.dependent}` : '';
    rl.write(`Running command npm install ${pkg.name}@${pkg.version}${workspaceLabel}`);
    rl.write(os.EOL);
    await promisifySpawn(NPM_COMMAND, args); // eslint-disable-line no-await-in-loop
  }
  return packagesToUpdate;
};

const processOutdated = async (outdatedJson, rootPackageName, options = {}) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const isWorkspace = !!rootPackageName;
  const outdatedMap = JSON.parse(outdatedJson || '{}');
  const packages = Object.entries(outdatedMap).map(([name, info]) => ({
    name,
    current: info.current,
    wanted: info.wanted,
    latest: info.latest,
    dependent: info.dependent,
  }));

  if (!packages.length) {
    rl.write('No package to update');
    rl.close();
    process.exit(0);
  }

  const packagesToUpdate = [];
  for (const pkg of packages) { // eslint-disable-line no-restricted-syntax
    const selected = await processOutdatedPackage(rl, pkg, isWorkspace, options); // eslint-disable-line no-await-in-loop
    if (selected) packagesToUpdate.push(selected);
  }

  await updateOutdatedPackage(rl, packagesToUpdate, rootPackageName);
  rl.write(`${packagesToUpdate.length} package(s) updated`);
  rl.close();
};

export default async function npmUpdateOutdated(options = {}) {
  const rootPackageName = detectWorkspaceRootName();
  await promisifySpawn(NPM_COMMAND, ['ci']);
  const outdated = await promisifySpawn(NPM_COMMAND, ['outdated', '--json']);
  return processOutdated(outdated, rootPackageName, options);
}
