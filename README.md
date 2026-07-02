# Backendmocker

<p align="center">
	<img src="icons/logo.png" alt="BackendMocker logo" width="220" />
</p>

Chrome Extension (Manifest V3) that mocks HTTP API responses in-browser using
dynamic `chrome.declarativeNetRequest` rules.

## Features

- Create/edit/delete mock rules in Options dashboard
- Enable/disable individual rules
- Global on/off switch in popup
- Rule matching by wildcard URL pattern + HTTP method
- Mock payload redirection through Data URLs
- Rules persisted in `chrome.storage.local`

## User manual

For a complete step-by-step guide (creating rules, pattern matching, testing,
troubleshooting, and limitations), see [MANUAL.md](MANUAL.md).

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder

## Notes about MV3 limits

This implementation uses DNR redirect rules to `data:` URLs, which works well
for body mocking. In MV3, true arbitrary HTTP status rewriting is not available
with DNR-only redirects, so non-200 status values are tracked and surfaced as
metadata headers (`x-backendmocker-intended-status`) where possible.
