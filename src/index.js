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

const processOutdatedPackage = (rl, outdatedPackage, outHead) => new Promise((resolve) => {
  const tableOpts = {
    align: ['l', 'r', 'r', 'r', 'l'],
    stringLength: (s) => util.stripVTControlCharacters(s).length,
  };
  rl.write('Package to update :');
  rl.write(os.EOL);
  rl.write(table([outHead.map((x) => colors.underline(x)), makePretty(outdatedPackage)], tableOpts));
  rl.write(os.EOL);

  const [packageName, currentVersion, wantedVersion, latestVersion] = outdatedPackage;

  const choices = [
    { name: 'No' },
  ];

  if (currentVersion !== wantedVersion && wantedVersion !== latestVersion) {
    choices.push({ message: `Wanted : ${packageName}@${wantedVersion}`, name: 'Wanted' });
  }

  choices.push({ message: `Latest : ${packageName}@${latestVersion}`, name: 'Latest' });

  const prompt = new enquirer.Select({
    name: 'color',
    message: 'Update package',
    choices,
  });

  prompt.run()
    .then((answer) => {
      if (answer !== 'No') {
        resolve({
          package: packageName,
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

const updateOutdatedPackage = (rl, packagesToUpdate) => Promise.all(packagesToUpdate.map((pp) => {
  rl.write(`Running command npm install ${pp.package}@${pp.version}`);
  rl.write(os.EOL);
  return promisifySpawn(NPM_COMMAND, ['install', `${pp.package}@${pp.version}`]);
}))
  .then(() => Promise.resolve(packagesToUpdate));

const processOutdated = (outdated) => {
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
    .then((packagesToUpdate) => processOutdatedPackage(rl, outdatedPackageToUpdate, outHead)
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

export default function npmUpdateOutdated() {
  return promisifySpawn(NPM_COMMAND, ['outdated'])
    .then(processOutdated);
}
