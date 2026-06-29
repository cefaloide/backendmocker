# Backend Mocker User Manual

Backend Mocker is a Chrome extension that intercepts matching requests and
returns mock responses from local rules.

## 1. Install the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

## 2. Understand the two switches

There are two levels of control:

- **Global mock engine** (popup): Turns all mocking on or off.
- **Rule enabled state** (dashboard): Turns each rule on or off individually.

Both must be enabled for a rule to apply.

## 3. Open the rules dashboard

1. Click the extension icon in Chrome.
2. Confirm the **Mock engine** switch is enabled if you want mocks active.
3. Click **Open rules dashboard**.

## 4. Create your first mock rule

In the dashboard form:

1. **Rule name**: Optional label for easier management.
2. **HTTP method**: Use `ANY` to match all methods, or pick a specific one.
3. **URL pattern**: Required. Supports `*` wildcard.
4. **HTTP status code**: Integer between `100` and `599`.
5. **Enabled**: Set to `Enabled` to activate immediately.
6. **Response headers**: Optional JSON object.
7. **Response body**: Text or JSON string to return.
8. Click **Save rule**.

Example rule:

- Rule name: `Todo item mock`
- HTTP method: `GET`
- URL pattern: `https://jsonplaceholder.typicode.com/todos/1`
- HTTP status code: `200`
- Enabled: `Enabled`
- Response headers:

```json
{ "Content-Type": "application/json" }
```

- Response body:

```json
{ "id": 1, "title": "Mocked todo", "completed": true }
```

## 5. Test a rule

1. Open the target website or app.
2. Trigger the request that matches your rule.
3. Verify in DevTools Network panel:
   - Response body matches your mock.
   - Optional headers are present.

Quick browser-console test:

```js
fetch("https://jsonplaceholder.typicode.com/todos/1")
  .then((res) => res.text())
  .then(console.log);
```

## 6. URL pattern matching

Patterns are wildcard based and are converted to a full regex internally, so the
pattern must match the full request URL.

Common examples:

- Exact URL: `https://api.example.com/users/42`
- Any user path: `https://api.example.com/users/*`
- Any protocol for one host: `*://api.example.com/*`
- Any subdomain: `https://*.example.com/v1/*`

Tips:

- If requests include query strings, account for them. Example:
  `https://api.example.com/search*`
- Start narrow, then widen with `*` only where needed.

## 7. Edit, enable, disable, and delete rules

In **Configured rules**:

- **Edit**: Load rule into form, change fields, save.
- **Enable/Disable**: Toggle a single rule without deleting it.
- **Delete**: Permanently remove the rule.

## 8. Global engine toggle behavior

The popup switch controls all rules at once:

- **Enabled**: All enabled rules are applied.
- **Disabled**: No rules are applied, even if individual rules are enabled.

## 9. Response details and limitations

Backend Mocker uses Manifest V3 declarativeNetRequest redirects to `data:` URLs.

What this means:

- Matching requests are redirected to local mocked content.
- Custom response headers are added when possible.
- True HTTP status rewriting is limited in MV3 DNR redirects.
- If status is not `200`, the extension exposes intended status through:
  `x-backendmocker-intended-status`.

## 10. Troubleshooting

If a mock is not applying:

1. Check popup switch: **Mock engine** must be enabled.
2. Check rule state: rule must be `Enabled`.
3. Verify URL pattern matches the full request URL.
4. Verify method matches (`ANY`, `GET`, `POST`, etc.).
5. Confirm headers field is valid JSON object syntax.
6. Reload the page and retry the request.

If your rule still does not match:

- Broaden pattern slightly with `*`.
- Inspect the exact request URL in DevTools and compare character by character.
- Ensure the request type is one the extension handles (navigation/subframe/XHR).

## 11. Best practices

- Keep rules specific to avoid accidental matches.
- Add clear names so teams understand each mock quickly.
- Disable rules you are not actively using instead of deleting immediately.
- Store representative JSON payloads for stable local testing.
