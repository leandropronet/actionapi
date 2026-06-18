'use strict';
const readline = require('readline');
const { hashPassword } = require('../src/security/password');

const passwordFromArg = process.argv[2];

if (passwordFromArg) {
  console.log(hashPassword(passwordFromArg));
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Senha administrativa (mínimo 12 caracteres): ', (password) => {
  try {
    console.log(hashPassword(password));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
});
