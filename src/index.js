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

const processOutdatedPackage = (rl, outdatedPackage, outHead, options = {}) => new Promise((resolve) => {
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
    resolve();
    return;
  }

  if (options.autoWanted && currentVersion !== wantedVersion) {
    rl.write(`Auto-selecting wanted version: ${packageName}@${wantedVersion}`);
    rl.write(os.EOL);
    resolve({ name: packageName, version: wantedVersion });
    return;
  }

  const choices = [
    { name: 'No' },
  ];

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

  prompt.run()
    .then((answer) => {
      if (answer !== 'No') {
        resolve({
          name: packageName,
          version: answer === 'Wanted' ? wantedVersion : latestVersion,
        });
      }
      resolve();
    })
    .catch(() => {
      rl.close();
      process.exit(-1);
    });
});

const updateOutdatedPackage = (rl, packagesToUpdate) => packagesToUpdate.reduce((currentPromise, packageToUpdate) => currentPromise.then(() => {
  rl.write(`Running command npm install ${packageToUpdate.name}@${packageToUpdate.version}`);
  rl.write(os.EOL);
  return promisifySpawn(NPM_COMMAND, ['install', `${packageToUpdate.name}@${packageToUpdate.version}`]);
}), Promise.resolve())
  .then(() => Promise.resolve(packagesToUpdate));

const processOutdated = (outdated, options = {}) => {
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

  const outdatedPackagesToUpdate = outList.reduce((currentPackagesToUpdate, outdatedPackageToUpdate) => currentPackagesToUpdate
    .then((packagesToUpdate) => processOutdatedPackage(rl, outdatedPackageToUpdate, outHead, options)
      .then((packageToUpdate) => {
        if (packageToUpdate) {
          packagesToUpdate.push(packageToUpdate);
        }
        return Promise.resolve(packagesToUpdate);
      })), Promise.resolve([]));

  return outdatedPackagesToUpdate
    .then((packagesToUpdate) => updateOutdatedPackage(rl, packagesToUpdate))
    .then((packagesToUpdate) => {
      rl.write(`${packagesToUpdate.length} package(s) updated`);
      rl.close();
      return Promise.resolve();
    });
};

export default function npmUpdateOutdated(options = {}) {
  return promisifySpawn(NPM_COMMAND, ['ci'])
    .then(() => promisifySpawn(NPM_COMMAND, ['outdated']))
    .then((outdated) => processOutdated(outdated, options));
}
