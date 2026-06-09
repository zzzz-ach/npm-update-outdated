#!/usr/bin/env node

import npmUpdateOutdated from '../src/index.js';

const args = process.argv.slice(2);
const autoMinor = args.includes('--auto-minor') || args.includes('-m');

npmUpdateOutdated({ autoMinor });
