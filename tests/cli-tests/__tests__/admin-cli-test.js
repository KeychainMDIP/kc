const { resolve } = require('path');
const { render } = require('cli-testing-library');

test('Is able to make terminal input and view in-progress stdout', async () => {
  const { clear, stdout, userEvent } = await render('node', [
    resolve(__dirname, './scripts/keychain-cli.js'),
    'resolve-id',
  ]);

  // Function to check if the expected string exists in the stdout
  const containsDID = (output) => {
    return output.split('\n').some(line => line.includes('did:test:z3v8AuaaYomCfPWCggFPaQpDXHmhbuxnwM6BZtCxuTTahPGAjmH'));
  };

  // Wait until the output contains the expected DID
  await new Promise((resolve) => {
    const interval = setInterval(() => {
      const currentOutput = stdout; // Access the stdout directly
      if (containsDID(currentOutput)) {
        clearInterval(interval);
        resolve();
      }
    }, 100); // Check every 100ms
  });

  // Assert that the DID was found in the stdout
  expect(stdout).toMatch(/did:test:z3v8AuaaYomCfPWCggFPaQpDXHmhbuxnwM6BZtCxuTTahPGAjmH/);

  // Clear the console for cleanup
  clear();
});
