import os from 'node:os';
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

const makePretty = (outdatedPackage) => {
  const prettyOutput = outdatedPackage.slice();
  prettyOutput[0] = prettyOutput[1] === prettyOutput[2]
    ? colors.yellow(prettyOutput[0])
    : colors.red(prettyOutput[0]);
  prettyOutput[2] = colors.green(prettyOutput[2]);
  prettyOutput[3] = colors.magenta(prettyOutput[3]);
  return prettyOutput;
};

const processOutdatedPackage = async (rl, outdatedPackage, outHead, options = {}) => {
  const tableOpts = {
    align: ['l', 'r', 'r', 'r', 'l'],
    stringLength: (s) => util.stripVTControlCharacters(s).length,
  };
  rl.write('Package to update :');
  rl.write(os.EOL);
  rl.write(table([outHead.map((x) => colors.underline(x)), makePretty(outdatedPackage)], tableOpts));
  rl.write(os.EOL);

  const [packageName, currentVersion, wantedVersion, latestVersion] = outdatedPackage;

  if (options.autoWanted && currentVersion === wantedVersion) {
    rl.write(`${packageName}@${wantedVersion} (already up to date)`);
    rl.write(os.EOL);
    return undefined;
  }

  if (options.autoWanted && currentVersion !== wantedVersion) {
    rl.write(`Auto-selecting wanted version: ${packageName}@${wantedVersion}`);
    rl.write(os.EOL);
    return { name: packageName, version: wantedVersion };
  }

  const choices = [{ name: 'No' }];

  if (currentVersion !== wantedVersion && wantedVersion !== latestVersion) {
    choices.push({ message: `Wanted : ${packageName}@${wantedVersion}`, name: 'Wanted' });
  }

  choices.push({ message: `Latest : ${packageName}@${latestVersion}`, name: 'Latest' });

  const prompt = new enquirer.Select({
    name: 'Select',
    message: 'Update package',
    choices,
    initial: wantedVersion === latestVersion ? 'Latest' : 'Wanted',
  });

  try {
    const answer = await prompt.run();
    if (answer === 'No') return undefined;
    return { name: packageName, version: answer === 'Wanted' ? wantedVersion : latestVersion };
  } catch {
    rl.close();
    process.exit(-1);
    return undefined;
  }
};

const updateOutdatedPackage = async (rl, packagesToUpdate) => {
  for (const packageToUpdate of packagesToUpdate) { // eslint-disable-line no-restricted-syntax
    rl.write(`Running command npm install ${packageToUpdate.name}@${packageToUpdate.version}`);
    rl.write(os.EOL);
    await promisifySpawn(NPM_COMMAND, ['install', `${packageToUpdate.name}@${packageToUpdate.version}`]); // eslint-disable-line no-await-in-loop
  }
  return packagesToUpdate;
};

const processOutdated = async (outdated, options = {}) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  if (!outdated.length) {
    rl.write('No package to update');
    rl.close();
    process.exit(0);
  }

  const outList = outdated.split('\n').filter((p) => p).map((line) => line.split(/[ ]{2,}/));
  const outHead = outList.shift();

  const packagesToUpdate = [];
  for (const outdatedPackageToUpdate of outList) { // eslint-disable-line no-restricted-syntax
    const packageToUpdate = await processOutdatedPackage(rl, outdatedPackageToUpdate, outHead, options); // eslint-disable-line no-await-in-loop
    if (packageToUpdate) packagesToUpdate.push(packageToUpdate);
  }

  await updateOutdatedPackage(rl, packagesToUpdate);
  rl.write(`${packagesToUpdate.length} package(s) updated`);
  rl.close();
};

export default async function npmUpdateOutdated(options = {}) {
  await promisifySpawn(NPM_COMMAND, ['ci']);
  const outdated = await promisifySpawn(NPM_COMMAND, ['outdated']);
  return processOutdated(outdated, options);
}
