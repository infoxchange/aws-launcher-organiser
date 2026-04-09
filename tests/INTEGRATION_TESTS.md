# Integration Tests

This directory contains Playwright integration tests that validate the AWS Launcher Organiser extension against the actual AWS SSO page.

The tests load the built extension and verify that it:
- Injects correctly into the AWS SSO page
- Extracts accounts properly
- Displays the organized account tree structure
- Handles pagination and sorting correctly

## Setup

Integration tests are separate from unit tests because they require:
- A built extension (`.output/chrome-mv3`)
- A valid AWS SSO URL
- Expected number of AWS accounts
- Browser automation (Playwright)
- User login (on first run)
- Longer timeouts and interactions

## Running Integration Tests

### First Run - Setup Configuration

Before running tests, you must configure them:

```bash
npm run test:integration:setup
```

This will prompt you for:
1. **AWS SSO URL**: e.g., `https://yourdomain.awsapps.com/start/`
2. **Expected Account Count**: How many AWS accounts you expect to find (e.g., `5`)

Configuration is saved in `.test-config/config.json` (ignored by git).

### Run the Tests

```bash
npm run test:integration
```

This will:
1. Build the extension (`npm run build:chrome`)
2. Launch a Playwright browser with the extension loaded
3. Navigate to the AWS SSO page
4. Run the integration tests

On the first run:
- Browser will open in visible mode
- Tests will pause and show a message to log in
- Once you authenticate, tests will automatically resume
- Your session cookies will be cached

### Subsequent Runs

```bash
npm run test:integration
```

The cached session cookies will be reused, so manual login usually isn't needed.

### Watch Mode

```bash
npm run test:integration:watch
```

Runs integration tests in watch mode for development (rebuilds extension on changes).

## Configuration

### SSO URL and Account Count

Configuration is stored in `.test-config/config.json` after the first run using the setup script.

To reconfigure, run the setup script again:

```bash
npm run test:integration:setup
```

It will detect existing configuration and ask if you want to update it.

### Clear Authentication Cookies

If you need to clear cached authentication:

```bash
npm run test:integration:clear-cookies
```

Then run the tests again and log in when the browser appears.

## Troubleshooting

### Tests require setup
If you see an error like:
```
❌ Integration test configuration not found!
Please run the setup script first: npm run test:integration:setup
```

Run the setup script to configure your SSO URL and expected account count.

### Extension not loading
If the extension fails to load:
- Make sure the extension has been built: `npm run build:chrome`
- Check that `.output/chrome-mv3` directory exists
- Try deleting it and rebuilding: `npm run build:chrome`

### Wrong number of accounts found
If tests fail because they found a different number of accounts:
1. Verify the expected count in your configuration
2. Run `npm run test:integration:setup` and update the value
3. Or manually edit `.test-config/config.json`

### Login issues
- Make sure you use the browser when it appears
- If authentication expires, clear cookies: `npm run test:integration:clear-cookies`
- Run tests again and log in when prompted

## Expected Test Results

With proper configuration, all 6 tests should pass:
- ✓ should load the SSO page with the extension
- ✓ should inject the AccountTreeTable component
- ✓ should display the correct number of accounts
- ✓ should extract account data correctly
- ✓ should handle pagination correctly
- ✓ should navigate through pages without errors

## Test Files

### `extraction.test.ts` 
The main integration test file with 6 tests that validate the extension functionality.

## What the Tests Verify

1. **Extension Loading**: The extension is correctly loaded into the browser
2. **Component Injection**: The AccountTreeTable React component is injected into the AWS SSO page
3. **Account Detection**: All expected accounts are detected and shown
4. **Data Extraction**: Account details (ID, name, email) are correctly extracted
5. **Pagination**: Pagination controls work correctly
6. **Navigation**: Users can navigate through pages without errors

## Architecture

The tests work by:
1. Building the extension to `.output/chrome-mv3`
2. Launching Chromium with the extension pre-loaded
3. Navigating to the AWS SSO page
4. Using Playwright to inspect the DOM and verify the extension's modifications
5. Extracting and validating the rendered account data

## Adding New Tests

To add a new integration test:

1. Create a new file in `tests/integration/` (e.g., `tests/integration/my-feature.test.ts`)
2. Import the test context helper:
   ```typescript
   import { createTestContext, cleanupTestContext } from '../integration.setup';
   ```
3. Use the context in your tests:
   ```typescript
   describe('My Feature', () => {
     let ctx: IntegrationTestContext;

     beforeAll(async () => {
       ctx = await createTestContext();
     });

     afterAll(async () => {
       if (ctx) {
         await cleanupTestContext(ctx);
       }
     });

     it('should do something', async () => {
       // ctx.page, ctx.browser, ctx.context available here
       expect(ctx.page).toBeDefined();
     });
   });
   ```

## How It Works

1. **Configuration** (`src/utils/test-config.ts`)
   - Prompts for SSO URL on first run
   - Caches URL in `.test-config/config.json`
   - Normalized and validated

2. **Cookies** (`src/utils/test-cookies.ts`)
   - Loads existing cookies before each test
   - Saves new cookies after successful login
   - Cached in `.test-cookies/cookies.json`

3. **Browser Management** (`src/utils/test-browser.ts`)
   - Detects login pages automatically
   - Makes browser visible when login is required
   - Waits for user to complete authentication
   - Provides utilities for page interaction

4. **Test Setup** (`tests/integration.setup.ts`)
   - Creates browser contexts for each test
   - Handles cookie loading/saving
   - Detects when login is needed
   - Makes browser visible for user interaction

## Troubleshooting

### Browser doesn't open
If the browser doesn't open even without cached cookies, ensure:
- Playwright is installed: `npm install playwright`
- System has required browser dependencies
- No other Playwright process is running

### Cookies not saving
Check:
- `.test-cookies/` directory exists and is writable
- No permission errors in console
- Browser context properly closes after test

### Login page not detected
If the test doesn't detect a login page, check:
- SSO URL is correct
- AWS SSO website hasn't changed its login form selectors
- Try clearing cookies and running again: `npm run test:integration:clear-cookies`

### Timeout errors
If tests timeout:
- Increase timeout in `vitest.integration.config.ts`
- Check network connectivity to AWS SSO
- Verify AWS SSO URL is accessible
- Run in watch mode to debug interactively: `npm run test:integration:watch`

## CI/CD Integration

For CI/CD pipelines, you may need to:
1. Set SSO URL via environment or config before running
2. Provide pre-cached cookies in the repository (if doing unattended testing)
3. Use headless browser mode (default with cached cookies)

Example for GitHub Actions:
```yaml
- name: Run integration tests
  run: npm run test:integration
  env:
    # Optional: Set via environment if needed
    # Note: Current implementation uses interactive prompt
```

## Best Practices

- **Use cached cookies**: Let the first run cache cookies, then subsequent runs won't require login
- **Clear selectors if AWS changes UI**: Update selectors in `src/utils/test-browser.ts`
- **Don't commit credentials**: Never commit `.test-config/` or `.test-cookies/` to version control
- **Test in isolation**: Each test should be independent and not rely on others
- **Clean up**: Always use `cleanupTestContext()` in afterAll hooks
