#!/usr/bin/env node

import npmUpdateOutdated from '../src/index.js';

const args = process.argv.slice(2);
const autoWanted = args.includes('--auto-wanted') || args.includes('-w');

npmUpdateOutdated({ autoWanted });
